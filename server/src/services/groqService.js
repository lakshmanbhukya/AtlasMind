const Groq = require('groq-sdk');
const { buildSystemPrompt } = require('../prompts/systemPrompt');

/** @type {Groq|null} */
let groqClient = null;

/**
 * Get or create the Groq client singleton.
 * @returns {Groq}
 */
function getGroqClient() {
    if (!groqClient) {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error('GROQ_API_KEY environment variable is not set');
        }
        groqClient = new Groq({
            apiKey,
            fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined,
        });
    }
    return groqClient;
}

const {
    QuotaExhaustedError,
    getModelLimits,
    estimatePromptTokens,
    consumeQuota,
    refundQuota,
    recordActualUsage,
    probeJsonModeSupport,
} = require('./quotaLimiter');

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/**
 * Generate an MQL aggregation pipeline from natural language.
 *
 * @param {string} naturalLanguage - The user's query in plain English
 * @param {string} schemaContext - Minified schema string
 * @param {object[]} fewShotExamples - Similar NL→MQL examples
 * @param {string} [model='openai/gpt-oss-120b'] - Groq LLM model ID
 * @param {object} [options={}] - Options controlling generation mode
 * @returns {Promise<{ pipeline: object[], collection: string, chartType: string, explanation: string|null, usage: object, model: string, rawText: string, timings: object, retries: number, jsonModeUsed: boolean }>}
 */
async function generateMQL(naturalLanguage, schemaContext, fewShotExamples, model = DEFAULT_MODEL, options = {}) {
    const client = getGroqClient();
    let systemPrompt = buildSystemPrompt(schemaContext, fewShotExamples, options);
    const targetModel = model || DEFAULT_MODEL;

    const isEvalMode = process.env.EVAL_MODE === '1';
    const strictModel = isEvalMode && process.env.STRICT_MODEL === '1';
    const modelLimits = isEvalMode ? getModelLimits(targetModel) : null;
    const maxTokens = (isEvalMode && modelLimits?.maxTokens) ? modelLimits.maxTokens : (options.max_tokens || 2048);
    const extraParams = (isEvalMode && modelLimits?.extraParams) ? modelLimits.extraParams : {};

    // Probe JSON-mode support in evaluation mode
    let jsonModeUsed = true;
    if (isEvalMode) {
        try {
            jsonModeUsed = await probeJsonModeSupport(client, targetModel);
        } catch {
            // Default to true if probe fails non-definitively
            jsonModeUsed = true;
        }
    }

    if (!jsonModeUsed) {
        systemPrompt += '\n\nOUTPUT FORMAT: Return ONLY a raw JSON object with keys: pipeline, collection, chartType, explanation. Do not wrap in markdown or backticks.';
    }

    const nlText = typeof naturalLanguage === 'string'
        ? naturalLanguage
        : (naturalLanguage?.query || naturalLanguage?.naturalLanguage || JSON.stringify(naturalLanguage));

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: nlText },
    ];

    let consumed = 0;
    if (isEvalMode && modelLimits) {
        const estimated = estimatePromptTokens(messages, maxTokens);
        consumed = await consumeQuota(targetModel, estimated, modelLimits);
    }

    const maxRetries = 6;
    let retries = 0;
    let chatCompletion = null;
    const callStart = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const createParams = {
                messages,
                model: targetModel,
                temperature: options.temperature !== undefined ? options.temperature : 0.1,
                max_tokens: maxTokens,
                top_p: 1,
                ...(jsonModeUsed ? { response_format: { type: 'json_object' } } : {}),
                ...extraParams,
            };
            chatCompletion = await client.chat.completions.create(createParams);
            break;
        } catch (err) {
            const isRetryable = err.status === 429 || (err.status >= 500 && err.status < 600);
            if (isRetryable && attempt < maxRetries) {
                retries++;
                const retryAfterSec = err.headers?.['retry-after'] || (typeof err.headers?.get === 'function' ? err.headers.get('retry-after') : null);
                let delayMs = retryAfterSec ? parseFloat(retryAfterSec) * 1000 : (1000 * Math.pow(2, attempt));
                delayMs = Math.min(delayMs, 32000) + Math.random() * 500;
                await new Promise((r) => setTimeout(r, delayMs));
                continue;
            }

            if (consumed > 0) {
                refundQuota(targetModel, consumed);
                consumed = 0;
            }

            if (strictModel) {
                throw err;
            }

            if (targetModel !== DEFAULT_MODEL) {
                console.warn(`⚠️ Custom model "${targetModel}" execution failed, falling back to "${DEFAULT_MODEL}":`, err.message);
                chatCompletion = await client.chat.completions.create({
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: naturalLanguage },
                    ],
                    model: DEFAULT_MODEL,
                    temperature: options.temperature !== undefined ? options.temperature : 0.1,
                    max_tokens: 2048,
                    top_p: 1,
                    response_format: { type: 'json_object' },
                });
                break;
            }

            throw err;
        }
    }

    const llmMs = Date.now() - callStart;

    if (consumed > 0 && isEvalMode && modelLimits) {
        const actualTokens = chatCompletion?.usage?.total_tokens || 0;
        recordActualUsage(targetModel, consumed, actualTokens, modelLimits);
    }

    const content = chatCompletion?.choices[0]?.message?.content;

    if (!content) {
        throw new Error('LLM returned empty response');
    }

    // Parse the JSON response
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (parseError) {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[1].trim());
        } else {
            throw new Error(`Failed to parse LLM response as JSON: ${content.substring(0, 200)}`);
        }
    }

    const usage = {
        prompt_tokens: chatCompletion?.usage?.prompt_tokens ?? 0,
        completion_tokens: chatCompletion?.usage?.completion_tokens ?? 0,
        total_tokens: chatCompletion?.usage?.total_tokens ?? 0,
    };
    const modelId = chatCompletion?.model || targetModel;
    const finishReason = chatCompletion?.choices?.[0]?.finish_reason || 'stop';

    // If the LLM indicates clarification is needed
    if (parsed.needsClarification === true) {
        return {
            needsClarification: true,
            questions: parsed.questions || [],
            missingCollections: parsed.missingCollections || [],
            pipeline: parsed.pipeline || [],
            collection: parsed.collection || '',
            chartType: parsed.chartType || 'table',
            explanation: parsed.explanation || null,
            usage,
            model: modelId,
            rawText: content,
            finishReason,
            timings: { llmMs },
            retries,
            jsonModeUsed,
        };
    }

    // Validate the response structure
    const validationErrors = [];
    if (!parsed.pipeline || !Array.isArray(parsed.pipeline)) {
        validationErrors.push('missing or invalid "pipeline" array');
    }
    if (parsed.collection === undefined || parsed.collection === null) {
        parsed.collection = '';
    }
    if (typeof parsed.collection !== 'string') {
        validationErrors.push('invalid "collection" string');
    }

    if (validationErrors.length > 0) {
        console.error(`⚠️ LLM response validation failed: ${validationErrors.join(', ')}`);
        console.error('Raw content:', content);
        throw new Error(`LLM response validation failed: ${validationErrors[0]}`);
    }

    const result = {
        pipeline: parsed.pipeline,
        collection: parsed.collection,
        chartType: parsed.chartType || 'table',
        explanation: parsed.explanation || null,
        usage,
        model: modelId,
        rawText: content,
        finishReason,
        timings: { llmMs },
        retries,
        jsonModeUsed,
    };
    if (parsed.needsClarification !== undefined) {
        result.needsClarification = parsed.needsClarification;
    }
    if (parsed.questions !== undefined) {
        result.questions = parsed.questions;
    }
    if (parsed.missingCollections !== undefined) {
        result.missingCollections = parsed.missingCollections;
    }

    return result;
}

/**
 * Transcribe an audio file using Groq Whisper.
 *
 * @param {Buffer} audioBuffer - The audio file buffer
 * @param {string} filename - Original filename (for format detection)
 * @returns {Promise<{ text: string, language?: string, duration?: number }>}
 */
async function transcribeAudio(audioBuffer, filename = 'recording.webm') {
    const client = getGroqClient();
    const { toFile } = require('groq-sdk');

    const file = await toFile(audioBuffer, filename);

    let transcription;
    try {
        transcription = await client.audio.transcriptions.create({
            model: 'whisper-large-v3-turbo',
            file,
            language: 'en',
            response_format: 'verbose_json',
        });
    } catch (err) {
        console.warn('⚠️ whisper-large-v3-turbo transcription failed, trying whisper-large-v3:', err.message);
        const fallbackFile = await toFile(audioBuffer, filename);
        transcription = await client.audio.transcriptions.create({
            model: 'whisper-large-v3',
            file: fallbackFile,
            language: 'en',
            response_format: 'verbose_json',
        });
    }

    return {
        text: transcription.text,
        language: transcription.language,
        duration: transcription.duration,
    };
}

/**
 * Set the Groq client instance (for testing/mocking).
 * @param {Groq|null} client
 */
function setGroqClient(client) {
    groqClient = client;
}

module.exports = { generateMQL, transcribeAudio, DEFAULT_MODEL, getGroqClient, setGroqClient };

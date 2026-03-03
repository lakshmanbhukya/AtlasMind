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
        groqClient = new Groq({ apiKey });
    }
    return groqClient;
}

/**
 * Generate an MQL aggregation pipeline from natural language.
 *
 * @param {string} naturalLanguage - The user's query in plain English
 * @param {string} schemaContext - Minified schema string
 * @param {object[]} fewShotExamples - Similar NL→MQL examples
 * @returns {Promise<{ pipeline: object[], collection: string, chartType: string }>}
 */
async function generateMQL(naturalLanguage, schemaContext, fewShotExamples) {
    const client = getGroqClient();
    const systemPrompt = buildSystemPrompt(schemaContext, fewShotExamples);

    const chatCompletion = await client.chat.completions.create({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: naturalLanguage },
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,          // Low temperature for deterministic query generation
        max_tokens: 2048,
        top_p: 1,
        response_format: { type: 'json_object' },
    });

    const content = chatCompletion.choices[0]?.message?.content;

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

    return {
        pipeline: parsed.pipeline,
        collection: parsed.collection,
        chartType: parsed.chartType || 'table',
        explanation: parsed.explanation || null,
    };
}

/**
 * Transcribe an audio file using Groq Whisper.
 *
 * @param {Buffer} audioBuffer - The audio file buffer
 * @param {string} filename - Original filename (for format detection)
 * @returns {Promise<{ text: string, language?: string, duration?: number }>}
 */
async function transcribeAudio(audioBuffer, filename) {
    const client = getGroqClient();
    const { toFile } = require('groq-sdk');

    const file = await toFile(audioBuffer, filename);

    const transcription = await client.audio.transcriptions.create({
        model: 'whisper-large-v3-turbo',
        file,
        language: 'en',
        response_format: 'verbose_json',
    });

    return {
        text: transcription.text,
        language: transcription.language,
        duration: transcription.duration,
    };
}

module.exports = { generateMQL, transcribeAudio };

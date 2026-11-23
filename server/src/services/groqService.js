// @ts-check
// The typings model Groq as an ES default export; the CommonJS entry is the class itself.
const Groq = /** @type {typeof import('groq-sdk').default} */ (/** @type {unknown} */ (require('groq-sdk')));
const { toFile } = require('groq-sdk');
const { buildSystemPrompt } = require('../prompts/systemPrompt');
const { ProviderError } = require('./engineErrors');
const { managedModels, SUPPORTED_MODELS } = require('./providerConfig');
const credentialStore = require('../stores/providerCredentialStore');
const allowance = require('./allowance');
const { prepareManagedAudio } = require('./managedAudio');
const log = require('../utils/logger').logger.child({ module: 'groqService' });

/** @type {import('groq-sdk').default|null} */
let groqClient = null;

/**
 * Build a Groq client. Managed and personal clients share these settings.
 * @param {string} apiKey
 * @returns {import('groq-sdk').default}
 */
function createClient(apiKey) {
    return new Groq({
        apiKey,
        fetch: typeof globalThis.fetch === 'function' ? nativeFetchWithStreamBodies : undefined,
        // Fail fast: generateMQL's loop is the only retry layer, and no call
        // may hold a request open for the SDK's long default timeout.
        maxRetries: 0,
        timeout: 30_000,
    });
}

/**
 * Get or create the managed Groq client singleton (GROQ_API_KEY, read lazily).
 * @returns {import('groq-sdk').default}
 */
function getGroqClient() {
    if (!groqClient) {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error('GROQ_API_KEY environment variable is not set');
        }
        groqClient = createClient(apiKey);
    }
    return groqClient;
}

/** HTTP status of an SDK error, or null for network errors and timeouts. */
function statusOf(err) {
    return err && typeof err.status === 'number' ? err.status : null;
}

/** The `retry-after` header of an SDK error in seconds, or null. */
function retryAfterOf(err) {
    const headers = err && err.headers;
    if (!headers) return null;
    const raw = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
    const value = raw === undefined || raw === null ? NaN : parseFloat(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

const INVALID_KEY_MESSAGE = {
    personal: 'Your Groq API key was rejected. Update the key or switch to the AtlasMind allowance.',
    managed: 'The AtlasMind Groq key was rejected. Please contact the operator.',
};

/**
 * Validate a personal key with `models.list()`: it costs no tokens and sends
 * no user data. Resolves when the key works.
 * @param {string} apiKey
 * @param {(key: string) => { models: { list: () => Promise<any> } }} [factory] - test seam
 * @throws {ProviderError} provider_key_invalid (422) or provider_unavailable (502)
 */
async function validateApiKey(apiKey, factory = createClient) {
    try {
        await factory(apiKey).models.list();
    } catch (err) {
        const status = statusOf(err);
        if (status === 401 || status === 403) {
            throw new ProviderError('provider_key_invalid', 'Groq rejected this API key. Check it and try again.', 422, { payer: 'personal' });
        }
        // Never echo SDK text: it can quote request details.
        log.warn({ status }, 'Groq key validation failed for a reason other than the key');
        throw new ProviderError('provider_unavailable', 'Groq could not be reached to check the key. Please try again.', 502, { payer: 'personal' });
    }
}

/**
 * Node's built-in fetch refuses a streamed request body unless `duplex: 'half'` is set
 * ("RequestInit: duplex option is required when sending a body"). The SDK sends multipart
 * uploads (Whisper transcription) as a Node stream, so add it for those; JSON bodies are unchanged.
 */
function nativeFetchWithStreamBodies(url, init) {
    const body = init && init.body;
    const isStream = body && typeof body === 'object' && typeof body.pipe === 'function';
    return globalThis.fetch(url, isStream ? { ...init, duplex: 'half' } : init);
}

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/**
 * Who pays for a call and the client that uses their key. Built once per
 * request by resolveProvider and passed to generateMQL / transcribeAudio.
 * @typedef {object} Provider
 * @property {'managed'|'personal'} payer
 * @property {any} client - a Groq client (or a test double)
 * @property {string[]} allowedModels - models the payer may pick; managed traffic is held to these
 * @property {string} defaultModel - used when a picked model is not allowed, and for fallbacks
 * @property {string} [connectionId]
 * @property {import('./allowance').Meter|null} [meter] - managed allowance accounting (services/allowance.js);
 *           null for personal keys and when GROQ_ALLOWANCE_MODE is off
 */

/** True when an SDK error says the model is missing or not permitted for this key. */
function isModelUnavailable(err) {
    const status = statusOf(err);
    const body = err && err.error && typeof err.error === 'object' ? err.error : {};
    const inner = body.error && typeof body.error === 'object' ? body.error : body;
    const code = String(inner.code || '');
    if (/model/i.test(code)) return true;
    if (status === 404) return true;
    const message = String(inner.message || '');
    return (status === 400 || status === 403)
        && /\bmodel\b.*(does not exist|not found|decommissioned|not (be )?(available|permitted|supported)|access)/i.test(message);
}

/**
 * Turn an SDK failure into a ProviderError with our own message (SDK text can
 * quote request details, so it never reaches the client). Errors that are not
 * from the provider (bad JSON from the model, our own bugs) pass through.
 * @param {any} err
 * @param {'managed'|'personal'} payer
 * @returns {any}
 */
function classifyProviderError(err, payer) {
    if (err instanceof ProviderError) return err;
    const status = statusOf(err);
    const isSdkError = status !== null
        || /APIConnection|Timeout|APIUserAbort/.test(String(err && (err.name || (err.constructor && err.constructor.name))));
    if (!isSdkError) return err;

    let classified;
    if (isModelUnavailable(err)) {
        classified = new ProviderError('provider_model_unavailable',
            payer === 'personal'
                ? 'That model is not available for your Groq key. Pick another model.'
                : 'That model is not available right now. Pick another model.',
            422, { payer });
    } else if (status === 401 || status === 403) {
        classified = new ProviderError('provider_key_invalid', INVALID_KEY_MESSAGE[payer], 422, { payer });
    } else if (status === 429) {
        const retryAfter = retryAfterOf(err);
        classified = new ProviderError('provider_rate_limited',
            payer === 'personal'
                ? 'Your Groq key hit its rate limit. Please try again shortly.'
                : 'The language model is rate limited. Please try again shortly.',
            429, { payer, ...(retryAfter !== null ? { retryAfterSeconds: Math.max(1, Math.ceil(retryAfter)) } : {}) });
    } else {
        classified = new ProviderError('provider_unavailable', 'The language model is unavailable right now. Please try again.', 502, { payer });
    }
    classified.cause = err;
    return classified;
}

/** 401/403 that is about the key, not the model: never retried, never falls back. */
function isKeyRejected(err) {
    const status = statusOf(err);
    return (status === 401 || status === 403) && !isModelUnavailable(err);
}

/** Personal clients, cached per sign-in so each request doesn't rebuild one. */
const PERSONAL_CLIENT_CACHE_MAX = 100;
/** @type {Map<string, { apiKey: string, client: any }>} */
const personalClients = new Map();

/** @type {(apiKey: string) => any} */
let personalClientFactory = createClient;

function personalClientFor(sessionId, apiKey) {
    const cached = personalClients.get(sessionId);
    if (cached && cached.apiKey === apiKey) {
        personalClients.delete(sessionId);
        personalClients.set(sessionId, cached);
        return cached.client;
    }
    const client = personalClientFactory(apiKey);
    personalClients.set(sessionId, { apiKey, client });
    while (personalClients.size > PERSONAL_CLIENT_CACHE_MAX) {
        personalClients.delete(personalClients.keys().next().value);
    }
    return client;
}

/**
 * Drop this sign-in's cached personal client (and the plaintext key it holds).
 * Called on key delete and logout. Only this process's cache is affected; other
 * instances keep theirs until replaced, which is harmless because every request
 * reads the stored key again and a deleted or revoked key is never found.
 * @param {string|null|undefined} sessionId
 */
function forgetPersonalClient(sessionId) {
    if (typeof sessionId === 'string' && sessionId) personalClients.delete(sessionId);
}

/**
 * Decide who pays for this request's Groq calls.
 *
 * A sign-in in personal mode uses its own key (and may pick any model); every
 * other request uses the managed key, held to MANAGED_MODELS. The managed key
 * is read only when a managed call needs it, so personal traffic works
 * without GROQ_API_KEY.
 *
 * When expectedPayer is given and differs from the stored mode (settings
 * changed in another tab), throws 409 settings_changed before any Groq call.
 *
 * @param {{ connectionId: string, sessionId?: string|null, expectedPayer?: unknown }} params
 * @returns {Promise<Provider>}
 */
async function resolveProvider({ connectionId, sessionId, expectedPayer }) {
    const active = typeof sessionId === 'string' && sessionId
        ? await credentialStore.getActiveKey(connectionId, sessionId)
        : null;
    const payer = active ? 'personal' : 'managed';

    if ((expectedPayer === 'managed' || expectedPayer === 'personal') && expectedPayer !== payer) {
        throw new ProviderError('settings_changed', 'Your Groq settings changed in another tab. Review them and send again.', 409, { payer });
    }

    if (active) {
        return {
            payer: 'personal',
            client: personalClientFor(/** @type {string} */ (sessionId), active.apiKey),
            allowedModels: [...SUPPORTED_MODELS],
            defaultModel: DEFAULT_MODEL,
            connectionId,
            meter: null,
        };
    }

    const allowedModels = managedModels();
    let client;
    try {
        client = getGroqClient();
    } catch {
        throw new ProviderError('provider_unavailable', 'The AtlasMind allowance is not configured on this server. Use your own Groq key.', 503, { payer: 'managed' });
    }
    return {
        payer: 'managed',
        client,
        allowedModels,
        defaultModel: allowedModels.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : allowedModels[0],
        connectionId,
        meter: allowance.createMeter(connectionId),
    };
}

/** generateMQL retries on 429/5xx: 1 call + MAX_RETRIES retries, each delay capped. */
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 8000;

/** Whisper uploads (up to 25 MB) get longer than the client's 30 s default. */
const TRANSCRIPTION_TIMEOUT_MS = 60_000;

/**
 * Generate an MQL aggregation pipeline from natural language.
 *
 * @param {string|Record<string, any>} naturalLanguage - The user's query in plain English (or an object carrying `query`/`naturalLanguage`)
 * @param {string} schemaContext - Minified schema string
 * @param {Record<string, any>[]} fewShotExamples - Similar NL→MQL examples
 * @param {string} [model='openai/gpt-oss-120b'] - Groq LLM model ID
 * @param {object} [options={}] - Options controlling generation mode (also passed to buildSystemPrompt)
 * @param {number} [options.temperature]
 * @param {number} [options.max_tokens]
 * @param {import('./experiment').LlmHooks} [options.llm] - Research hooks (quota, JSON-mode probing,
 *        strict model). Supplied only through an ExperimentConfig; production passes none.
 * @param {Provider} [options.provider] - Who pays (resolveProvider). Without it the managed
 *        singleton is used and SDK errors are thrown as is (experiments, tests).
 * @returns {Promise<{ pipeline: Record<string, any>[], collection: string, chartType: string, explanation: string|null, usage: Record<string, any>, model: string, rawText: string, timings: { llmMs?: number, [k: string]: any }, retries: number, jsonModeUsed: boolean, needsClarification?: boolean, questions?: any[], missingCollections?: string[], [k: string]: any }>}
 */
async function generateMQL(naturalLanguage, schemaContext, fewShotExamples, model = DEFAULT_MODEL, options = {}) {
    /** @type {Provider|null} */
    const provider = options.provider || null;
    const client = provider ? provider.client : getGroqClient();
    let systemPrompt = buildSystemPrompt(schemaContext, fewShotExamples, options);
    const defaultModel = (provider && provider.defaultModel) || DEFAULT_MODEL;
    let targetModel = model || defaultModel;
    // Managed traffic can't select a model outside the budgeted list.
    if (provider && provider.payer === 'managed' && !provider.allowedModels.includes(targetModel)) {
        targetModel = defaultModel;
    }
    const classify = (err) => (provider ? classifyProviderError(err, provider.payer) : err);

    const llm = options.llm || {};
    const strictModel = Boolean(llm.strictModel);
    const maxTokens = llm.maxTokens || options.max_tokens || 2048;
    const extraParams = llm.extraParams || {};

    let jsonModeUsed = true;
    if (typeof llm.resolveJsonMode === 'function') {
        try {
            jsonModeUsed = await llm.resolveJsonMode(client, targetModel);
        } catch {
            // Default to JSON mode if the probe fails non-definitively
            jsonModeUsed = true;
        }
    }

    if (!jsonModeUsed) {
        systemPrompt += '\n\nOUTPUT FORMAT: Return ONLY a raw JSON object with keys: pipeline, collection, chartType, explanation. Do not wrap in markdown or backticks.';
    }

    const nlText = typeof naturalLanguage === 'string'
        ? naturalLanguage
        : (naturalLanguage?.query || naturalLanguage?.naturalLanguage || JSON.stringify(naturalLanguage));

    /** @type {import('groq-sdk/resources/chat/completions').ChatCompletionMessageParam[]} */
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: nlText },
    ];

    const meter = (provider && provider.meter) || null;
    const promptChars = systemPrompt.length + nlText.length;
    /**
     * One SDK attempt. A managed call reserves its estimate first (an exhausted
     * allowance throws before Groq is called) and settles once it ends.
     * @param {import('groq-sdk/resources/chat/completions').ChatCompletionCreateParamsNonStreaming} params
     */
    const metered = async (params) => {
        if (!meter) return client.chat.completions.create(params);
        const reservation = await meter.reserveText({ promptChars, maxTokens: params.max_tokens || maxTokens, model: params.model });
        /** @type {import('./allowance').Outcome} */
        let outcome = 'unknown';
        let actual;
        try {
            const completion = await client.chat.completions.create(params);
            outcome = 'ok';
            actual = completion && completion.usage ? completion.usage.total_tokens : undefined;
            return completion;
        } catch (err) {
            outcome = allowance.outcomeOf(err);
            throw err;
        } finally {
            await meter.settle(reservation, { outcome, actual });
        }
    };

    const ticket = typeof llm.beforeCall === 'function'
        ? await llm.beforeCall({ model: targetModel, messages, maxTokens })
        : null;

    const maxRetries = MAX_RETRIES;
    let retries = 0;
    let chatCompletion = null;
    const callStart = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // extraParams come from an ExperimentConfig and are passed through as is.
            const createParams = /** @type {import('groq-sdk/resources/chat/completions').ChatCompletionCreateParamsNonStreaming} */ ({
                messages,
                model: targetModel,
                temperature: options.temperature !== undefined ? options.temperature : 0.1,
                max_tokens: maxTokens,
                top_p: 1,
                ...(jsonModeUsed ? { response_format: { type: 'json_object' } } : {}),
                ...extraParams,
            });
            chatCompletion = await metered(createParams);
            break;
        } catch (err) {
            if (provider) {
                // An exhausted allowance (or a ledger outage) is final: no retry, no fallback.
                if (err instanceof ProviderError) {
                    if (typeof llm.onFailure === 'function') llm.onFailure(ticket, err);
                    throw err;
                }
                // A rejected key never retries, falls back, or switches to another key.
                if (isKeyRejected(err)) {
                    if (typeof llm.onFailure === 'function') llm.onFailure(ticket, err);
                    throw classify(err);
                }
                // A long retry-after is surfaced at once instead of holding the request.
                const retryAfter = statusOf(err) === 429 ? retryAfterOf(err) : null;
                if (retryAfter !== null && retryAfter * 1000 > MAX_RETRY_DELAY_MS) {
                    if (typeof llm.onFailure === 'function') llm.onFailure(ticket, err);
                    throw classify(err);
                }
            }
            const isRetryable = err.status === 429 || (err.status >= 500 && err.status < 600);
            if (isRetryable && attempt < maxRetries) {
                retries++;
                const retryAfterSec = err.headers?.['retry-after'] || (typeof err.headers?.get === 'function' ? err.headers.get('retry-after') : null);
                let delayMs = retryAfterSec ? parseFloat(retryAfterSec) * 1000 : (1000 * Math.pow(2, attempt));
                delayMs = Math.min(delayMs, MAX_RETRY_DELAY_MS) + Math.random() * 500;
                await new Promise((r) => setTimeout(r, delayMs));
                continue;
            }

            if (typeof llm.onFailure === 'function') {
                llm.onFailure(ticket, err);
            }

            if (strictModel) {
                throw classify(err);
            }

            // A rate limit is per key: another model would only spend more of it.
            if (provider && statusOf(err) === 429) {
                throw classify(err);
            }

            if (targetModel !== defaultModel) {
                log.warn({ err: provider ? { status: statusOf(err) } : err, model: targetModel, fallback: defaultModel }, 'Custom model failed, falling back to default');
                try {
                    chatCompletion = await metered({
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: nlText },
                        ],
                        model: defaultModel,
                        temperature: options.temperature !== undefined ? options.temperature : 0.1,
                        max_tokens: 2048,
                        top_p: 1,
                        response_format: { type: 'json_object' },
                    });
                } catch (fallbackErr) {
                    throw classify(fallbackErr);
                }
                break;
            }

            throw classify(err);
        }
    }

    const llmMs = Date.now() - callStart;

    if (typeof llm.afterCall === 'function') {
        llm.afterCall(ticket, chatCompletion?.usage || {});
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
        // The raw LLM output can echo the question, so only its length is logged.
        log.error({ validationErrors, contentLength: content.length }, 'LLM response validation failed');
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
 * @param {Provider} [provider] - Who pays (resolveProvider); without it the managed singleton
 * @returns {Promise<{ text: string, language?: string, duration?: number }>}
 */
async function transcribeAudio(audioBuffer, filename = 'recording.webm', provider) {
    const client = provider ? provider.client : getGroqClient();
    const classify = (err) => (provider ? classifyProviderError(err, provider.payer) : err);

    const meter = (provider && provider.meter) || null;

    const managedAudio = provider?.payer === 'personal' ? null : await prepareManagedAudio(audioBuffer);
    const call = async (model) => client.audio.transcriptions.create({
        model,
        file: await toFile(managedAudio?.wav ?? audioBuffer, managedAudio ? 'recording.wav' : filename),
        language: 'en',
        response_format: 'verbose_json',
    }, { timeout: TRANSCRIPTION_TIMEOUT_MS });

    /** One Whisper attempt; a managed one is reserved first and settled by `duration`. */
    const transcribe = async (model) => {
        if (!meter) return call(model);
        const reservation = await meter.reserveAudio({ model, seconds: managedAudio.seconds });
        /** @type {import('./allowance').Outcome} */
        let outcome = 'unknown';
        let actual;
        try {
            const result = await call(model);
            outcome = 'ok';
            actual = result && typeof result.duration === 'number' ? result.duration : undefined;
            return result;
        } catch (err) {
            outcome = allowance.outcomeOf(err);
            throw err;
        } finally {
            await meter.settle(reservation, { outcome, actual });
        }
    };

    let transcription;
    try {
        transcription = await transcribe('whisper-large-v3-turbo');
    } catch (err) {
        // An exhausted allowance, a rejected key or a rate limit applies to both Whisper models.
        if (err instanceof ProviderError) throw err;
        if (provider && (isKeyRejected(err) || statusOf(err) === 429)) throw classify(err);
        log.warn({ err: provider ? { status: statusOf(err) } : err }, 'whisper-large-v3-turbo transcription failed, trying whisper-large-v3');
        try {
            transcription = await transcribe('whisper-large-v3');
        } catch (fallbackErr) {
            throw classify(fallbackErr);
        }
    }

    return {
        text: transcription.text,
        language: transcription.language,
        duration: transcription.duration,
    };
}

/**
 * Set the Groq client instance (for testing/mocking).
 * @param {import('groq-sdk').default|null} client
 */
function setGroqClient(client) {
    groqClient = client;
}

/**
 * Set the personal-client factory (for testing/mocking). Passing null restores
 * the real one and empties the per-session cache.
 * @param {((apiKey: string) => any)|null} factory
 */
function setPersonalClientFactory(factory) {
    personalClientFactory = factory || createClient;
    personalClients.clear();
}

module.exports = {
    generateMQL,
    transcribeAudio,
    resolveProvider,
    validateApiKey,
    classifyProviderError,
    createClient,
    setGroqClient,
    setPersonalClientFactory,
    forgetPersonalClient,
    DEFAULT_MODEL,
};

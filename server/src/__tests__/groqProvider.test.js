'use strict';

/**
 * Provider-aware Groq calls: who pays (resolveProvider), the managed model
 * allow-list, and how SDK failures are classified when a provider is passed.
 */

const { createFakeCollection } = require('../../test-support/fakeMongo');

let mockLedger;
jest.mock('../db/connection', () => ({ getDb: () => ({ collection: () => mockLedger }) }));

const mockGetActiveKey = jest.fn();
jest.mock('../stores/providerCredentialStore', () => ({
    getActiveKey: (...args) => mockGetActiveKey(...args),
}));

const {
    generateMQL,
    transcribeAudio,
    resolveProvider,
    setGroqClient,
    setPersonalClientFactory,
} = require('../services/groqService');
const { ProviderError } = require('../services/engineErrors');

const KEY = 'gsk_test_SECRET';

function completion(content) {
    return {
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
}

function fakeClient(label) {
    return {
        label,
        chat: { completions: { create: jest.fn().mockResolvedValue(completion({ pipeline: [], collection: 'orders' })) } },
        audio: { transcriptions: { create: jest.fn().mockResolvedValue({ text: 'show orders', language: 'en', duration: 3 }) } },
    };
}

const sdkError = (status, extra = {}) => Object.assign(new Error(`${status} raw SDK text with ${KEY}`), { status, ...extra });

let managed;
let personal;
let factory;
const originalEnv = { ...process.env };

beforeEach(() => {
    jest.clearAllMocks();
    process.env.GROQ_API_KEY = 'gsk_managed';
    delete process.env.MANAGED_MODELS;
    delete process.env.GROQ_ALLOWANCE_MODE;
    delete process.env.GROQ_CONNECTION_DAILY_TOKENS;
    delete process.env.GROQ_CONNECTION_DAILY_AUDIO_SECONDS;
    mockLedger = createFakeCollection({ unique: [['_id']] });
    managed = fakeClient('managed');
    personal = fakeClient('personal');
    factory = jest.fn(() => personal);
    setGroqClient(managed);
    setPersonalClientFactory(factory);
    mockGetActiveKey.mockResolvedValue(null);
});

afterEach(() => {
    process.env = { ...originalEnv };
    setGroqClient(null);
    setPersonalClientFactory(null);
    jest.restoreAllMocks();
});

describe('resolveProvider', () => {
    test('managed by default, held to MANAGED_MODELS', async () => {
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        expect(provider.payer).toBe('managed');
        expect(provider.client).toBe(managed);
        expect(provider.allowedModels).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
        expect(factory).not.toHaveBeenCalled();
    });

    test('a sign-in in personal mode gets its own client, cached per session', async () => {
        mockGetActiveKey.mockResolvedValue({ apiKey: KEY, keyLast4: 'CRET' });
        const a = await resolveProvider({ connectionId: 'c', sessionId: 's1' });
        const b = await resolveProvider({ connectionId: 'c', sessionId: 's1' });
        expect(a.payer).toBe('personal');
        expect(a.client).toBe(personal);
        expect(b.client).toBe(personal);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(factory).toHaveBeenCalledWith(KEY);
        expect(a.allowedModels).toContain('groq/compound');
    });

    test('a session without sid never reads the credential store', async () => {
        const provider = await resolveProvider({ connectionId: 'c', sessionId: null });
        expect(provider.payer).toBe('managed');
        expect(mockGetActiveKey).not.toHaveBeenCalled();
    });

    test('personal traffic works without GROQ_API_KEY; managed gets a clear 503', async () => {
        delete process.env.GROQ_API_KEY;
        setGroqClient(null);
        mockGetActiveKey.mockResolvedValueOnce({ apiKey: KEY });
        await expect(resolveProvider({ connectionId: 'c', sessionId: 's' })).resolves.toMatchObject({ payer: 'personal' });
        const err = await resolveProvider({ connectionId: 'c', sessionId: 's' }).catch((e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.statusCode).toBe(503);
    });

    test('expectedPayer mismatch → 409 settings_changed', async () => {
        const err = await resolveProvider({ connectionId: 'c', sessionId: 's', expectedPayer: 'personal' }).catch((e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect(err).toMatchObject({ code: 'settings_changed', statusCode: 409, payer: 'managed' });
        await expect(resolveProvider({ connectionId: 'c', sessionId: 's', expectedPayer: 'managed' })).resolves.toBeTruthy();
        await expect(resolveProvider({ connectionId: 'c', sessionId: 's' })).resolves.toBeTruthy();
    });
});

describe('generateMQL with a provider', () => {
    test('a personal request uses the personal client for Whisper and text', async () => {
        mockGetActiveKey.mockResolvedValue({ apiKey: KEY });
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        await transcribeAudio(Buffer.from('abc'), 'a.webm', provider);
        await generateMQL('show orders', 'Database: db', [], 'groq/compound', { provider });

        expect(personal.audio.transcriptions.create).toHaveBeenCalledTimes(1);
        expect(personal.chat.completions.create).toHaveBeenCalledTimes(1);
        expect(personal.chat.completions.create.mock.calls[0][0].model).toBe('groq/compound');
        expect(managed.audio.transcriptions.create).not.toHaveBeenCalled();
        expect(managed.chat.completions.create).not.toHaveBeenCalled();
    });

    test('managed traffic for an unbudgeted model uses the default model', async () => {
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        await generateMQL('show orders', 'Database: db', [], 'groq/compound', { provider });
        expect(managed.chat.completions.create.mock.calls[0][0].model).toBe('openai/gpt-oss-120b');
        await generateMQL('show orders', 'Database: db', [], 'openai/gpt-oss-20b', { provider });
        expect(managed.chat.completions.create.mock.calls[1][0].model).toBe('openai/gpt-oss-20b');
    });

    test('a 401 makes zero retries, zero fallbacks and zero managed calls', async () => {
        mockGetActiveKey.mockResolvedValue({ apiKey: KEY });
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        personal.chat.completions.create.mockRejectedValue(sdkError(401));

        const err = await generateMQL('q', 'Database: db', [], 'groq/compound', { provider }).catch((e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect(err).toMatchObject({ code: 'provider_key_invalid', statusCode: 422, payer: 'personal' });
        expect(err.message).not.toContain(KEY);
        expect(personal.chat.completions.create).toHaveBeenCalledTimes(1);
        expect(managed.chat.completions.create).not.toHaveBeenCalled();
    });

    test('a 401 on Whisper skips the fallback model', async () => {
        mockGetActiveKey.mockResolvedValue({ apiKey: KEY });
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        personal.audio.transcriptions.create.mockRejectedValue(sdkError(401));
        const err = await transcribeAudio(Buffer.from('abc'), 'a.webm', provider).catch((e) => e);
        expect(err.code).toBe('provider_key_invalid');
        expect(personal.audio.transcriptions.create).toHaveBeenCalledTimes(1);
        expect(managed.audio.transcriptions.create).not.toHaveBeenCalled();
    });

    test('a long retry-after is surfaced immediately', async () => {
        const timers = jest.spyOn(global, 'setTimeout');
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        managed.chat.completions.create.mockRejectedValue(sdkError(429, { headers: { 'retry-after': '42' } }));

        const err = await generateMQL('q', 'Database: db', [], undefined, { provider }).catch((e) => e);
        expect(err).toMatchObject({ code: 'provider_rate_limited', statusCode: 429, retryAfterSeconds: 42, payer: 'managed' });
        expect(managed.chat.completions.create).toHaveBeenCalledTimes(1);
        expect(timers).not.toHaveBeenCalled();
    });

    test('a short 429 is retried, then surfaced without a model fallback', async () => {
        jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        managed.chat.completions.create.mockRejectedValue(sdkError(429, { headers: { 'retry-after': '1' } }));

        const err = await generateMQL('q', 'Database: db', [], 'openai/gpt-oss-20b', { provider }).catch((e) => e);
        expect(err.code).toBe('provider_rate_limited');
        expect(managed.chat.completions.create).toHaveBeenCalledTimes(3);
        managed.chat.completions.create.mock.calls.forEach(([params]) => expect(params.model).toBe('openai/gpt-oss-20b'));
    });

    test('a model the key may not use falls back to the default, then reports model unavailable', async () => {
        mockGetActiveKey.mockResolvedValue({ apiKey: KEY });
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        const notFound = sdkError(404, { error: { error: { code: 'model_not_found', message: 'The model does not exist' } } });
        personal.chat.completions.create.mockRejectedValueOnce(notFound).mockRejectedValueOnce(notFound);

        const err = await generateMQL('q', 'Database: db', [], 'qwen/qwen3.8-27b', { provider }).catch((e) => e);
        expect(err).toMatchObject({ code: 'provider_model_unavailable', statusCode: 422 });
        expect(personal.chat.completions.create).toHaveBeenCalledTimes(2);
        expect(personal.chat.completions.create.mock.calls[1][0].model).toBe('openai/gpt-oss-120b');
    });

    test('a 5xx becomes provider_unavailable without SDK text', async () => {
        jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        managed.chat.completions.create.mockRejectedValue(sdkError(503));
        const err = await generateMQL('q', 'Database: db', [], undefined, { provider }).catch((e) => e);
        expect(err).toMatchObject({ code: 'provider_unavailable', statusCode: 502 });
        expect(err.message).not.toContain('raw SDK text');
    });

    test('without a provider, SDK errors are thrown unchanged (experiments)', async () => {
        const raw = sdkError(401);
        managed.chat.completions.create.mockRejectedValue(raw);
        await expect(generateMQL('q', 'Database: db', [])).rejects.toBe(raw);
    });
});

describe('managed allowance on every Groq attempt', () => {
    const ledgerDay = () => mockLedger.docs[0];

    test('managed providers carry a meter; personal and off-mode providers do not', async () => {
        expect((await resolveProvider({ connectionId: 'c', sessionId: 's' })).meter).toBeTruthy();
        process.env.GROQ_ALLOWANCE_MODE = 'off';
        expect((await resolveProvider({ connectionId: 'c', sessionId: 's' })).meter).toBeNull();
        mockGetActiveKey.mockResolvedValue({ apiKey: KEY });
        delete process.env.GROQ_ALLOWANCE_MODE;
        expect((await resolveProvider({ connectionId: 'c', sessionId: 's' })).meter).toBeNull();
    });

    test('a finished call is charged its actual usage', async () => {
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        await generateMQL('show orders', 'Database: db', [], undefined, { provider });
        expect(ledgerDay()).toMatchObject({ tokens: 15, conn: { c: { tokens: 15 } } });
    });

    test('every attempt reserves: retries and the default-model fallback', async () => {
        jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        const reserve = jest.spyOn(provider.meter, 'reserveText');
        managed.chat.completions.create
            .mockRejectedValueOnce(sdkError(503))
            .mockRejectedValueOnce(sdkError(503))
            .mockRejectedValueOnce(sdkError(503));

        await generateMQL('q', 'Database: db', [], 'openai/gpt-oss-20b', { provider });
        expect(managed.chat.completions.create).toHaveBeenCalledTimes(4);
        expect(reserve).toHaveBeenCalledTimes(4);
        expect(reserve.mock.calls.map(([r]) => r.model)).toEqual([
            'openai/gpt-oss-20b', 'openai/gpt-oss-20b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b',
        ]);
        // Three 5xx keep their estimates; the successful fallback is charged its usage.
        const estimate = reserve.mock.calls[0][0].promptChars;
        expect(ledgerDay().tokens).toBe(3 * (Math.ceil(estimate / 3) + 2048) + 15);
    });

    test('a 401 on the managed key releases its reservation', async () => {
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        managed.chat.completions.create.mockRejectedValue(sdkError(401));
        await generateMQL('q', 'Database: db', [], undefined, { provider }).catch(() => {});
        expect(ledgerDay().tokens).toBe(0);
    });

    test('an exhausted allowance makes zero SDK calls and is not retried', async () => {
        process.env.GROQ_CONNECTION_DAILY_TOKENS = '100';
        const timers = jest.spyOn(global, 'setTimeout');
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        const onFailure = jest.fn();

        const err = await generateMQL('q', 'Database: db', [], 'openai/gpt-oss-20b', { provider, llm: { onFailure } }).catch((e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect(err).toMatchObject({ code: 'managed_allowance_exhausted', statusCode: 429, payer: 'managed' });
        expect(err.resetAt).toMatch(/T00:00:00\.000Z$/);
        expect(managed.chat.completions.create).not.toHaveBeenCalled();
        expect(timers).not.toHaveBeenCalled();
        expect(onFailure).toHaveBeenCalledTimes(1);
    });

    test('voice is charged even when the following text call is refused', async () => {
        process.env.GROQ_CONNECTION_DAILY_TOKENS = '100';
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        await transcribeAudio(Buffer.from('abc'), 'a.webm', provider);
        const err = await generateMQL('show orders', 'Database: db', [], undefined, { provider }).catch((e) => e);
        expect(err.code).toBe('managed_allowance_exhausted');
        expect(ledgerDay()).toMatchObject({ audioSeconds: 10, tokens: 0 }); // 3 s billed at the 10 s floor
    });

    test('an exhausted voice allowance skips both Whisper models', async () => {
        process.env.GROQ_CONNECTION_DAILY_AUDIO_SECONDS = '30';
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        const err = await transcribeAudio(Buffer.from('abc'), 'a.webm', provider).catch((e) => e);
        expect(err.code).toBe('managed_allowance_exhausted');
        expect(managed.audio.transcriptions.create).not.toHaveBeenCalled();
    });

    test('each Whisper attempt reserves; a failed one keeps its estimate', async () => {
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        managed.audio.transcriptions.create.mockRejectedValueOnce(sdkError(500));
        await transcribeAudio(Buffer.from('abc'), 'a.webm', provider);
        expect(managed.audio.transcriptions.create).toHaveBeenCalledTimes(2);
        expect(ledgerDay().audioSeconds).toBe(60 + 10);
    });

    test('personal-key calls make no ledger writes', async () => {
        mockGetActiveKey.mockResolvedValue({ apiKey: KEY });
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        await transcribeAudio(Buffer.from('abc'), 'a.webm', provider);
        await generateMQL('show orders', 'Database: db', [], undefined, { provider });
        expect(mockLedger.docs).toHaveLength(0);
    });

    test('a ledger outage gives 503 for managed calls before any SDK call', async () => {
        mockLedger.updateOne = jest.fn().mockRejectedValue(new Error('down'));
        const provider = await resolveProvider({ connectionId: 'c', sessionId: 's' });
        const err = await generateMQL('q', 'Database: db', [], undefined, { provider }).catch((e) => e);
        expect(err).toMatchObject({ code: 'managed_accounting_unavailable', statusCode: 503 });
        expect(managed.chat.completions.create).not.toHaveBeenCalled();
    });
});

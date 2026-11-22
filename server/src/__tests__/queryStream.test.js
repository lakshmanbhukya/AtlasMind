'use strict';

const express = require('express');
const request = require('supertest');

const mockExecuteNaturalLanguageQuery = jest.fn();
const { ScopeError, RateLimitError, ProviderError } = jest.requireActual('../services/engineErrors');

jest.mock('../services/queryExecutionEngine', () => ({
    ...jest.requireActual('../services/queryExecutionEngine'),
    QueryExecutionEngine: {
        executeNaturalLanguageQuery: (...args) => mockExecuteNaturalLanguageQuery(...args),
        executeApprovedWrite: jest.fn(),
    },
}));
jest.mock('../db/connection', () => ({ getDb: jest.fn() }));
const mockProvider = { payer: 'managed', client: {}, allowedModels: ['openai/gpt-oss-120b'], defaultModel: 'openai/gpt-oss-120b' };
const mockResolveProvider = jest.fn(async () => mockProvider);
jest.mock('../services/groqService', () => ({
    resolveProvider: (...args) => mockResolveProvider(...args),
}));

const queryRouter = require('../routes/query');

/** Parse an SSE body into [{ event, data }], skipping comment lines. */
function parseEvents(text) {
    return text
        .split('\n\n')
        .map((block) => block.trim())
        .filter((block) => block && !block.startsWith(':'))
        .map((block) => {
            const lines = block.split('\n');
            const event = lines.find((l) => l.startsWith('event: ')).slice(7);
            const data = lines.filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
            return { event, data: JSON.parse(data) };
        });
}

function streamRequest(app, body = { text: 'show high value orders' }) {
    return request(app)
        .post('/api/query/stream')
        .send(body)
        .buffer(true)
        .parse((res, cb) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => cb(null, data));
        });
}

describe('POST /api/query/stream', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.connectionId = 'stream-conn-1';
            next();
        });
        app.use('/api/query', queryRouter);
    });

    test('streams progress events, then exactly one result with the POST / status and body', async () => {
        mockExecuteNaturalLanguageQuery.mockImplementationOnce(async ({ onProgress }) => {
            ['scope', 'schema', 'ambiguity', 'generating', 'safety', 'executing'].forEach((s) => onProgress(s));
            return { type: 'success', data: { success: true, aiMessage: 'done', results: [{ n: 1 }] } };
        });

        const res = await streamRequest(app);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
        expect(res.headers['cache-control']).toBe('no-cache, no-transform');
        expect(res.headers['x-accel-buffering']).toBe('no');

        const events = parseEvents(res.body);
        expect(events.map((e) => e.event)).toEqual([
            'progress', 'progress', 'progress', 'progress', 'progress', 'progress', 'result',
        ]);
        expect(events.slice(0, 6).map((e) => e.data.stage)).toEqual(
            ['scope', 'schema', 'ambiguity', 'generating', 'safety', 'executing']
        );
        expect(events[6].data).toEqual({
            status: 200,
            body: { success: true, aiMessage: 'done', results: [{ n: 1 }] },
        });
    });

    test('passes the same engine params as POST /, never an experiment from the body', async () => {
        mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({ type: 'success', data: { success: true } });

        await streamRequest(app, {
            text: 'q', collections: ['orders'], workspaceId: 'w1', bypassAmbiguity: true,
            experiment: { disableSafetyGuard: true },
        });

        const params = mockExecuteNaturalLanguageQuery.mock.calls[0][0];
        expect(params).toMatchObject({
            connectionId: 'stream-conn-1', text: 'q', collections: ['orders'], workspaceId: 'w1',
            bypassAmbiguity: true, source: 'query',
        });
        expect(params.experiment).toBeUndefined();
        expect(typeof params.onProgress).toBe('function');
    });

    test('a safety block arrives as result.status 422 with the blocked body', async () => {
        mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({
            type: 'safety_blocked',
            data: { success: false, error: { code: 'safety_violation', message: 'Blocked stage $out' } },
        });

        const events = parseEvents((await streamRequest(app)).body);

        expect(events).toHaveLength(1);
        expect(events[0].event).toBe('result');
        expect(events[0].data.status).toBe(422);
        expect(events[0].data.body.error.code).toBe('safety_violation');
    });

    test('a typed engine error maps to its own status and code', async () => {
        mockExecuteNaturalLanguageQuery.mockRejectedValueOnce(new ScopeError('Workspace not found', 'workspace_not_found'));
        const scope = parseEvents((await streamRequest(app)).body);
        expect(scope[0].data).toEqual({
            status: 400,
            body: { success: false, error: { code: 'workspace_not_found', message: 'Workspace not found' } },
        });

        mockExecuteNaturalLanguageQuery.mockRejectedValueOnce(new RateLimitError('Too many requests'));
        const limited = parseEvents((await streamRequest(app)).body);
        expect(limited[0].data.status).toBe(429);
    });

    test('provider errors arrive in the result event with the same body as POST /', async () => {
        const exhausted = new ProviderError('managed_allowance_exhausted', 'The AtlasMind allowance for today is used up.', 429,
            { payer: 'managed', resetAt: '2026-11-23T00:00:00.000Z' });
        mockExecuteNaturalLanguageQuery.mockRejectedValueOnce(exhausted);
        const [a] = parseEvents((await streamRequest(app)).body);
        expect(a).toEqual({ event: 'result', data: { status: 429, body: { success: false, error: {
            code: 'managed_allowance_exhausted', message: exhausted.message, payer: 'managed', resetAt: '2026-11-23T00:00:00.000Z',
        } } } });

        mockExecuteNaturalLanguageQuery.mockRejectedValueOnce(new ProviderError('provider_rate_limited', 'Rate limited.', 429,
            { payer: 'personal', retryAfterSeconds: 42 }));
        const [b] = parseEvents((await streamRequest(app)).body);
        expect(b.data).toEqual({ status: 429, body: { success: false, error: {
            code: 'provider_rate_limited', message: 'Rate limited.', payer: 'personal', retryAfterSeconds: 42,
        } } });
    });

    test('a ledger outage found while resolving the provider also arrives as the result event', async () => {
        mockResolveProvider.mockRejectedValueOnce(new ProviderError('managed_accounting_unavailable', 'Cannot check.', 503, { payer: 'managed' }));
        const events = parseEvents((await streamRequest(app)).body);
        expect(events.at(-1).data.status).toBe(503);
        expect(events.at(-1).data.body.error).toMatchObject({ code: 'managed_accounting_unavailable', payer: 'managed' });
        expect(mockExecuteNaturalLanguageQuery).not.toHaveBeenCalled();
    });

    test('an unexpected error maps to 500 query_error', async () => {
        mockExecuteNaturalLanguageQuery.mockRejectedValueOnce(new Error('boom'));
        const events = parseEvents((await streamRequest(app)).body);
        expect(events).toHaveLength(1);
        expect(events[0].data.status).toBe(500);
        expect(events[0].data.body.error.code).toBe('query_error');
    });
});

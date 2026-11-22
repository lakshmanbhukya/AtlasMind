'use strict';

const express = require('express');
const request = require('supertest');

// Mock groqService transcribeAudio and generateMQL
const mockProvider = { payer: 'managed', client: {}, allowedModels: ['openai/gpt-oss-120b'], defaultModel: 'openai/gpt-oss-120b' };
const mockResolveProvider = jest.fn(async () => mockProvider);
jest.mock('../services/groqService', () => ({
    transcribeAudio: jest.fn(),
    generateMQL: jest.fn(),
    resolveProvider: (...args) => mockResolveProvider(...args),
}));

// Mock QueryExecutionEngine
const mockExecuteNaturalLanguageQuery = jest.fn();
const mockExecuteApprovedWrite = jest.fn();
const {
    ValidationError,
    ScopeError,
    TokenExpiredError,
    UnauthorizedTokenError,
    TokenAlreadyUsedError,
    SafetyViolationError,
    ExecutionError,
    RateLimitError,
} = jest.requireActual('../services/engineErrors');

jest.mock('../services/queryExecutionEngine', () => ({
    ...jest.requireActual('../services/queryExecutionEngine'),
    QueryExecutionEngine: {
        executeNaturalLanguageQuery: (...args) => mockExecuteNaturalLanguageQuery(...args),
        executeApprovedWrite: (...args) => mockExecuteApprovedWrite(...args),
    },
}));

// Central DB mock for query router history endpoints
const mockHistoryUpdateOne = jest.fn();
const mockCentralDb = {
    collection: jest.fn().mockReturnValue({
        find: jest.fn().mockReturnValue({
            sort: () => ({ limit: () => ({ project: () => ({ toArray: () => [] }) }) }),
        }),
        updateOne: (...args) => mockHistoryUpdateOne(...args),
    }),
};
jest.mock('../db/connection', () => ({
    getDb: jest.fn(() => mockCentralDb),
}));

const queryRouter = require('../routes/query');
const voiceRouter = require('../routes/voice');
const { transcribeAudio } = require('../services/groqService');

describe('Route Adapters Smoke Tests (POST /api/query and POST /api/voice)', () => {
    let app;
    const testConnectionId = 'smoke-test-conn-1';

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(express.json());
        // Simulating requireAuth middleware
        app.use((req, _res, next) => {
            req.connectionId = testConnectionId;
            next();
        });
        app.use('/api/query', queryRouter);
        app.use('/api/voice', voiceRouter);
    });

    describe('POST /api/query route adapter', () => {
        test('maps outcome type "success" to HTTP 200', async () => {
            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({
                type: 'success',
                data: {
                    success: true,
                    naturalLanguage: 'count users',
                    pipeline: [{ $count: 'total' }],
                    results: [{ total: 42 }],
                },
            });

            const res = await request(app)
                .post('/api/query')
                .send({ text: 'count users' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.results).toEqual([{ total: 42 }]);
        });

        test('maps outcome type "clarification_required" to HTTP 200', async () => {
            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({
                type: 'clarification_required',
                data: {
                    success: true,
                    needsClarification: true,
                    naturalLanguage: 'top orders',
                    questions: [{ question: 'By what metric?' }],
                },
            });

            const res = await request(app)
                .post('/api/query')
                .send({ text: 'top orders' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.needsClarification).toBe(true);
            expect(res.body.questions).toBeDefined();
        });

        test('maps outcome type "approval_required" to HTTP 200', async () => {
            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({
                type: 'approval_required',
                approvalToken: 'signed-approval-token',
                data: {
                    success: true,
                    safetyStatus: 'approval-required',
                    approvalToken: 'signed-approval-token',
                },
            });

            const res = await request(app)
                .post('/api/query')
                .send({ text: 'delete cancelled orders' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.safetyStatus).toBe('approval-required');
            expect(res.body.approvalToken).toBe('signed-approval-token');
        });

        test('maps outcome type "safety_blocked" to HTTP 422', async () => {
            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({
                type: 'safety_blocked',
                data: {
                    success: false,
                    error: { code: 'safety_violation', message: 'Restricted collection access' },
                    safetyBlocked: true,
                },
            });

            const res = await request(app)
                .post('/api/query')
                .send({ text: 'access system.users' });

            expect(res.status).toBe(422);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('safety_violation');
        });

        test('maps ValidationError to HTTP 400', async () => {
            mockExecuteNaturalLanguageQuery.mockRejectedValueOnce(
                new ValidationError('Request body must include a non-empty "text" field')
            );

            const res = await request(app)
                .post('/api/query')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('validation_error');
        });

        test('maps ExecutionError or unexpected failure to HTTP 500', async () => {
            mockExecuteNaturalLanguageQuery.mockRejectedValueOnce(
                new ExecutionError('Database connectivity timeout')
            );

            const res = await request(app)
                .post('/api/query')
                .send({ text: 'count users' });

            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('execution_error');
        });
    });

    describe('engine error mapping', () => {
        test('maps RateLimitError to HTTP 429', async () => {
            mockExecuteNaturalLanguageQuery.mockRejectedValueOnce(new RateLimitError());
            const res = await request(app).post('/api/query').send({ text: 'count users' });
            expect(res.status).toBe(429);
            expect(res.body.error.code).toBe('rate_limited');
        });

        test('a non-engine error maps to 500 and never forwards its own status', async () => {
            mockExecuteNaturalLanguageQuery.mockRejectedValueOnce(
                Object.assign(new Error('boom'), { status: 401, code: 'upstream_auth' })
            );
            const res = await request(app).post('/api/query').send({ text: 'count users' });
            expect(res.status).toBe(500);
            expect(res.body.error.code).toBe('query_error');
        });

        test('never forwards evalOptions / experiment from the request body', async () => {
            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({ type: 'success', data: { success: true } });
            await request(app).post('/api/query').send({
                text: 'count users',
                evalOptions: { disableSafetyGuard: true },
                experiment: { disableSafetyGuard: true },
            });
            const params = mockExecuteNaturalLanguageQuery.mock.calls[0][0];
            expect(params.evalOptions).toBeUndefined();
            expect(params.experiment).toBeUndefined();
        });

        test('maps approve-flow TokenAlreadyUsedError to HTTP 409', async () => {
            mockExecuteApprovedWrite.mockRejectedValueOnce(new TokenAlreadyUsedError());
            const res = await request(app).post('/api/query/approve').send({ approvalToken: 't' });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('token_already_used');
        });
    });

    describe('POST /api/voice route adapter', () => {
        test('returns HTTP 400 when no audio file is uploaded', async () => {
            const res = await request(app)
                .post('/api/voice')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('validation_error');
        });

        test('transcribes audio at intake seam and maps outcome type "success" to HTTP 200 with voice metadata', async () => {
            transcribeAudio.mockResolvedValueOnce({
                text: 'show total revenue',
                language: 'english',
                duration: 2.5,
            });

            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({
                type: 'success',
                data: {
                    success: true,
                    naturalLanguage: 'show total revenue',
                    pipeline: [{ $group: { _id: null, total: { $sum: '$amount' } } }],
                    results: [{ total: 5000 }],
                },
            });

            const fakeAudioBuffer = Buffer.from('fake audio data');

            const res = await request(app)
                .post('/api/voice')
                .attach('audio', fakeAudioBuffer, 'test_recording.wav');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.transcript).toBe('show total revenue');
            expect(res.body.language).toBe('english');
            expect(res.body.duration).toBe(2.5);
            expect(res.body.meta.transcriptionMeta).toBeDefined();
            expect(res.body.meta.transcriptionMeta.filename).toBe('test_recording.wav');

            expect(mockExecuteNaturalLanguageQuery).toHaveBeenCalledWith(
                expect.objectContaining({
                    connectionId: testConnectionId,
                    text: 'show total revenue',
                    source: 'voice',
                })
            );
        });

        test('parses multipart "collections" JSON and forwards workspaceId to the engine', async () => {
            transcribeAudio.mockResolvedValueOnce({ text: 'top orders' });
            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({
                type: 'success',
                data: { success: true, results: [] },
            });

            const res = await request(app)
                .post('/api/voice')
                .field('collections', '["orders"]')
                .field('workspaceId', 'ws-1')
                .attach('audio', Buffer.from('fake audio data'), 'speech.mp3');

            expect(res.status).toBe(200);
            expect(mockExecuteNaturalLanguageQuery).toHaveBeenCalledWith(
                expect.objectContaining({ collections: ['orders'], workspaceId: 'ws-1', source: 'voice' })
            );
        });

        test.each([['not json'], ['{"a":1}']])('rejects malformed multipart "collections" %p with HTTP 400', async (raw) => {
            const res = await request(app)
                .post('/api/voice')
                .field('collections', raw)
                .attach('audio', Buffer.from('fake audio data'), 'speech.mp3');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('validation_error');
            expect(transcribeAudio).not.toHaveBeenCalled();
            expect(mockExecuteNaturalLanguageQuery).not.toHaveBeenCalled();
        });

        test('voice queries inherit ambiguity gating and map "clarification_required" to HTTP 200', async () => {
            transcribeAudio.mockResolvedValueOnce({
                text: 'top orders',
                language: 'english',
                duration: 1.2,
            });

            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({
                type: 'clarification_required',
                data: {
                    success: true,
                    needsClarification: true,
                    naturalLanguage: 'top orders',
                    questions: [{ question: 'By what metric?' }],
                },
            });

            const fakeAudioBuffer = Buffer.from('fake audio');

            const res = await request(app)
                .post('/api/voice')
                .attach('audio', fakeAudioBuffer, 'speech.mp3');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.needsClarification).toBe(true);
            expect(res.body.transcript).toBe('top orders');
            expect(res.body.questions).toBeDefined();
        });

        test('voice queries inherit write approval and map "approval_required" to HTTP 200', async () => {
            transcribeAudio.mockResolvedValueOnce({
                text: 'archive old orders',
                language: 'english',
                duration: 1.8,
            });

            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({
                type: 'approval_required',
                approvalToken: 'voice-approval-token',
                data: {
                    success: true,
                    safetyStatus: 'approval-required',
                    approvalToken: 'voice-approval-token',
                },
            });

            const fakeAudioBuffer = Buffer.from('fake audio');

            const res = await request(app)
                .post('/api/voice')
                .attach('audio', fakeAudioBuffer, 'speech.mp3');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.safetyStatus).toBe('approval-required');
            expect(res.body.approvalToken).toBe('voice-approval-token');
            expect(res.body.transcript).toBe('archive old orders');
        });

        test('voice queries map "safety_blocked" to HTTP 422', async () => {
            transcribeAudio.mockResolvedValueOnce({
                text: 'drop system users',
                language: 'english',
                duration: 1.5,
            });

            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({
                type: 'safety_blocked',
                data: {
                    success: false,
                    error: { code: 'safety_violation', message: 'Unauthorized system collection' },
                    safetyBlocked: true,
                },
            });

            const fakeAudioBuffer = Buffer.from('fake audio');

            const res = await request(app)
                .post('/api/voice')
                .attach('audio', fakeAudioBuffer, 'speech.mp3');

            expect(res.status).toBe(422);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('safety_violation');
            expect(res.body.transcript).toBe('drop system users');
        });
    });

    describe('PATCH /api/query/history/:id', () => {
        const historyId = '64b7f0000000000000000abc';

        test('pins a history item for this connection', async () => {
            mockHistoryUpdateOne.mockResolvedValueOnce({ matchedCount: 1 });

            const res = await request(app)
                .patch(`/api/query/history/${historyId}`)
                .send({ pinned: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const [filter, update] = mockHistoryUpdateOne.mock.calls[0];
            expect(filter.connectionId).toBe(testConnectionId);
            expect(filter._id.toString()).toBe(historyId);
            expect(update.$set.pinned).toBe(true);
            expect(update.$set.naturalLanguage).toBeUndefined();
        });

        test('renames and unpins in one request', async () => {
            mockHistoryUpdateOne.mockResolvedValueOnce({ matchedCount: 1 });

            const res = await request(app)
                .patch(`/api/query/history/${historyId}`)
                .send({ name: '  Revenue by region  ', pinned: false });

            expect(res.status).toBe(200);
            const update = mockHistoryUpdateOne.mock.calls[0][1];
            expect(update.$set).toMatchObject({ naturalLanguage: 'Revenue by region', pinned: false, pinnedAt: null });
        });

        test.each([
            [{}],
            [{ pinned: 'yes' }],
            [{ name: '   ' }],
        ])('rejects invalid body %p with 400', async (body) => {
            const res = await request(app).patch(`/api/query/history/${historyId}`).send(body);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('validation_error');
            expect(mockHistoryUpdateOne).not.toHaveBeenCalled();
        });

        test('returns 404 when the item belongs to no history of this connection', async () => {
            mockHistoryUpdateOne.mockResolvedValueOnce({ matchedCount: 0 });
            const res = await request(app).patch(`/api/query/history/${historyId}`).send({ pinned: true });
            expect(res.status).toBe(404);
        });
    });

    describe('multi-select clarifications', () => {
        test('POST /api/query forwards array clarification values to the engine unchanged', async () => {
            mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({ type: 'success', data: { success: true } });
            const clarifications = [{ id: 'metric', value: ['total', 'subtotal'] }];

            const res = await request(app)
                .post('/api/query')
                .send({ text: 'compare sales', clarifications });

            expect(res.status).toBe(200);
            expect(mockExecuteNaturalLanguageQuery).toHaveBeenCalledWith(
                expect.objectContaining({ clarifications })
            );
        });
    });
});

describe('security headers (full app)', () => {
    test('GET /api/health carries helmet headers', async () => {
        const app = require('../index');
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-powered-by']).toBeUndefined();
    });
});

describe('payer checks before any Groq call', () => {
    const { ProviderError } = jest.requireActual('../services/engineErrors');
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.connectionId = 'payer-conn';
            req.sessionId = 'sid-1';
            next();
        });
        app.use('/api/query', queryRouter);
        app.use('/api/voice', voiceRouter);
    });

    const settingsChanged = () => new ProviderError('settings_changed', 'Your Groq settings changed in another tab.', 409, { payer: 'managed' });

    test('POST /api/query passes sessionId and expectedPayer, and the provider to the engine', async () => {
        mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({ type: 'success', data: { success: true } });
        await request(app).post('/api/query').send({ text: 'q', expectedPayer: 'managed' });
        expect(mockResolveProvider).toHaveBeenCalledWith({ connectionId: 'payer-conn', sessionId: 'sid-1', expectedPayer: 'managed' });
        expect(mockExecuteNaturalLanguageQuery.mock.calls[0][0].provider).toBe(mockProvider);
    });

    test('settings_changed on POST /api/query answers 409 without running the engine', async () => {
        mockResolveProvider.mockRejectedValueOnce(settingsChanged());
        const res = await request(app).post('/api/query').send({ text: 'q', expectedPayer: 'personal' });
        expect(res.status).toBe(409);
        expect(res.body.error).toMatchObject({ code: 'settings_changed', payer: 'managed' });
        expect(mockExecuteNaturalLanguageQuery).not.toHaveBeenCalled();
    });

    test('settings_changed on POST /api/voice makes no Whisper call', async () => {
        mockResolveProvider.mockRejectedValueOnce(settingsChanged());
        const res = await request(app)
            .post('/api/voice')
            .field('expectedPayer', 'personal')
            .attach('audio', Buffer.from('fake audio data'), 'speech.webm');
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('settings_changed');
        expect(mockResolveProvider.mock.calls[0][0].expectedPayer).toBe('personal');
        expect(transcribeAudio).not.toHaveBeenCalled();
        expect(mockExecuteNaturalLanguageQuery).not.toHaveBeenCalled();
    });

    test('voice uses one provider for Whisper and the text stage', async () => {
        transcribeAudio.mockResolvedValueOnce({ text: 'show orders', language: 'en', duration: 2 });
        mockExecuteNaturalLanguageQuery.mockResolvedValueOnce({ type: 'success', data: { success: true } });
        await request(app).post('/api/voice').attach('audio', Buffer.from('fake audio data'), 'speech.webm');
        expect(transcribeAudio.mock.calls[0][2]).toBe(mockProvider);
        expect(mockExecuteNaturalLanguageQuery.mock.calls[0][0].provider).toBe(mockProvider);
    });
});

describe('origin check (full app)', () => {
    const app = require('../index');

    test('a foreign Origin gets 403 on a state-changing request', async () => {
        const res = await request(app).post('/api/query').set('Origin', 'https://evil.example').send({ text: 'q' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('origin_not_allowed');
    });
});

describe('request IDs (full app)', () => {
    const app = require('../index');
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    test('every response carries a generated X-Request-Id', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.headers['x-request-id']).toMatch(UUID);
    });

    test('a safe incoming x-request-id is echoed back', async () => {
        const res = await request(app).get('/api/health').set('x-request-id', 'abc-123');
        expect(res.headers['x-request-id']).toBe('abc-123');
    });

    test('an unsafe or oversized x-request-id is replaced', async () => {
        const bad = await request(app).get('/api/health').set('x-request-id', 'a b<script>');
        expect(bad.headers['x-request-id']).toMatch(UUID);
        const long = await request(app).get('/api/health').set('x-request-id', 'a'.repeat(65));
        expect(long.headers['x-request-id']).toMatch(UUID);
    });

    test('a 404 also carries X-Request-Id', async () => {
        const res = await request(app).get('/api/nope');
        expect(res.status).toBe(404);
        expect(res.headers['x-request-id']).toMatch(UUID);
    });
});

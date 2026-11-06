'use strict';

const express = require('express');
const request = require('supertest');

// Mock groqService transcribeAudio and generateMQL
jest.mock('../services/groqService', () => ({
    transcribeAudio: jest.fn(),
    generateMQL: jest.fn(),
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
} = jest.requireActual('../services/queryExecutionEngine');

jest.mock('../services/queryExecutionEngine', () => ({
    ...jest.requireActual('../services/queryExecutionEngine'),
    QueryExecutionEngine: {
        executeNaturalLanguageQuery: (...args) => mockExecuteNaturalLanguageQuery(...args),
        executeApprovedWrite: (...args) => mockExecuteApprovedWrite(...args),
    },
}));

// Central DB mock for query router history endpoints
const mockCentralDb = {
    collection: jest.fn().mockReturnValue({
        find: jest.fn().mockReturnValue({
            sort: () => ({ limit: () => ({ project: () => ({ toArray: () => [] }) }) }),
        }),
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
});

'use strict';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Central DB mock
const mockApprovalTokensCollection = {
    createIndex: jest.fn().mockResolvedValue('ok'),
    insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
};
const mockCentralDb = {
    collection: jest.fn().mockImplementation((name) => {
        if (name === 'approval_tokens') return mockApprovalTokensCollection;
        return {
            insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
            find: jest.fn().mockReturnValue({ sort: () => ({ limit: () => ({ project: () => ({ toArray: () => [] }) }) }) }),
        };
    }),
};
jest.mock('../db/connection', () => ({
    getDb: jest.fn(() => mockCentralDb),
}));

// User DB mock
const mockUserDb = {
    databaseName: 'user_test_db',
    collection: jest.fn().mockReturnValue({
        aggregate: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([{ modified: 1 }]),
        }),
    }),
};
jest.mock('../services/userDbPool', () => ({
    getUserDb: jest.fn().mockResolvedValue(mockUserDb),
}));

// Query executor mock
jest.mock('../services/queryExecutor', () => ({
    executePipeline: jest.fn().mockResolvedValue({
        results: [{ modified: 1 }],
        executionTimeMs: 15,
    }),
    saveQueryHistory: jest.fn(),
}));

const queryRouter = require('../routes/query');
const { executePipeline } = require('../services/queryExecutor');

describe('B3: POST /api/query/approve security guards', () => {
    let app;
    const testSecret = 'secret-for-signing-write-approval-tokens-32chars';
    const testConnectionId = 'tenant-conn-123';

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JWT_SECRET = testSecret;

        app = express();
        app.use(express.json());
        // Middleware simulating requireAuth
        app.use((req, _res, next) => {
            req.connectionId = testConnectionId;
            next();
        });
        app.use('/api/query', queryRouter);
    });

    function createTestToken(payloadOverrides = {}) {
        const payload = {
            jti: crypto.randomUUID(),
            connectionId: testConnectionId,
            collection: 'orders',
            pipeline: [{ $match: { status: 'cancelled' } }, { $merge: { into: 'archived_orders' } }],
            query: 'archive cancelled orders',
            type: 'write-approval',
            ...payloadOverrides,
        };
        return jwt.sign(payload, testSecret, { expiresIn: '10m' });
    }

    test('accepts valid approval token and executes write pipeline', async () => {
        const token = createTestToken();

        const res = await request(app)
            .post('/api/query/approve')
            .send({ approvalToken: token });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.safetyStatus).toBe('write-executed');
        expect(mockApprovalTokensCollection.insertOne).toHaveBeenCalledTimes(1);
        expect(executePipeline).toHaveBeenCalledWith(
            mockUserDb,
            'orders',
            expect.any(Array)
        );
    });

    test('rejects with 403 forbidden when token connectionId does not match session', async () => {
        const token = createTestToken({ connectionId: 'different-tenant-conn' });

        const res = await request(app)
            .post('/api/query/approve')
            .send({ approvalToken: token });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('forbidden');
        expect(executePipeline).not.toHaveBeenCalled();
        expect(mockApprovalTokensCollection.insertOne).not.toHaveBeenCalled();
    });

    test('re-validates collection name and rejects invalid/system collections with 422', async () => {
        const token = createTestToken({ collection: 'system.users' });

        const res = await request(app)
            .post('/api/query/approve')
            .send({ approvalToken: token });

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('safety_violation');
        expect(executePipeline).not.toHaveBeenCalled();
    });

    test('re-validates pipeline and rejects invalid pipeline with 422', async () => {
        const token = createTestToken({
            pipeline: [],
        });

        const res = await request(app)
            .post('/api/query/approve')
            .send({ approvalToken: token });

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('safety_violation');
        expect(executePipeline).not.toHaveBeenCalled();
    });

    test('re-validates pipeline and rejects hard-denied code execution operators ($where, $function) with 422', async () => {
        const token = createTestToken({
            pipeline: [{ $match: { $where: 'sleep(1000)' } }],
        });

        const res = await request(app)
            .post('/api/query/approve')
            .send({ approvalToken: token });

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('safety_violation');
        expect(executePipeline).not.toHaveBeenCalled();
    });

    test('rejects token without jti with 400 invalid_token', async () => {
        const token = createTestToken({ jti: undefined });

        const res = await request(app)
            .post('/api/query/approve')
            .send({ approvalToken: token });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('invalid_token');
        expect(executePipeline).not.toHaveBeenCalled();
    });

    test('prevents replay: returns 409 token_already_used when jti is already in approval_tokens (E11000)', async () => {
        const duplicateErr = new Error('E11000 duplicate key error collection: approval_tokens index: jti_1 dup key');
        duplicateErr.code = 11000;
        mockApprovalTokensCollection.insertOne.mockRejectedValueOnce(duplicateErr);

        const token = createTestToken();

        const res = await request(app)
            .post('/api/query/approve')
            .send({ approvalToken: token });

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('token_already_used');
        expect(executePipeline).not.toHaveBeenCalled();
    });

    test('rejects expired or invalid token with 401', async () => {
        const expiredToken = jwt.sign(
            { jti: 'test-jti', type: 'write-approval', connectionId: testConnectionId },
            testSecret,
            { expiresIn: '-1s' }
        );

        const res = await request(app)
            .post('/api/query/approve')
            .send({ approvalToken: expiredToken });

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('expired_token');
    });
});

'use strict';

const express = require('express');
const request = require('supertest');

const mockConnect = jest.fn();
const mockClose = jest.fn();
const mockListDatabases = jest.fn();
const mockListCollections = jest.fn();

jest.mock('mongodb', () => ({
    MongoClient: jest.fn().mockImplementation(() => ({
        connect: mockConnect,
        close: mockClose,
        db: (name) => ({
            admin: () => ({ listDatabases: mockListDatabases }),
            listCollections: () => ({ toArray: () => mockListCollections(name) }),
        }),
    })),
}));

// The router module pulls these in; this test never reaches them.
jest.mock('../models/UserConnection', () => ({ upsertConnection: jest.fn(), getConnectionById: jest.fn() }));
jest.mock('../auth/session', () => ({ issueSession: jest.fn() }));
jest.mock('../middleware/auth', () => ({ requireAuth: (_req, _res, next) => next() }));
jest.mock('../services/userDbPool', () => ({ evictUserDb: jest.fn() }));
jest.mock('../utils/encryption', () => ({ encrypt: jest.fn(), hashString: jest.fn() }));

const connectionsRouter = require('../routes/connections');

describe('POST /api/connections/databases', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockConnect.mockResolvedValue();
        mockClose.mockResolvedValue();
        app = express();
        app.use(express.json());
        app.use('/api/connections', connectionsRouter);
    });

    test('rejects a missing or malformed connection string with 400', async () => {
        const res = await request(app).post('/api/connections/databases').send({ connectionString: 'postgres://x' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(mockConnect).not.toHaveBeenCalled();
    });

    test('returns non-internal, non-empty databases with collection counts and closes the client', async () => {
        mockListDatabases.mockResolvedValue({
            databases: [{ name: 'admin' }, { name: 'analytics_prod' }, { name: 'empty_db' }, { name: 'local' }],
        });
        mockListCollections.mockImplementation((name) => {
            if (name === 'analytics_prod') return [{ name: 'orders' }, { name: 'customers' }, { name: 'system.views' }];
            return [];
        });

        const res = await request(app)
            .post('/api/connections/databases')
            .send({ connectionString: 'mongodb+srv://u:p@cluster0.example.net' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, databases: [{ name: 'analytics_prod', collectionCount: 2 }] });
        expect(mockClose).toHaveBeenCalledTimes(1);
    });

    test('returns an empty list when listDatabases is not permitted', async () => {
        mockListDatabases.mockRejectedValue(new Error('not authorized'));

        const res = await request(app)
            .post('/api/connections/databases')
            .send({ connectionString: 'mongodb://localhost:27017' });

        expect(res.status).toBe(200);
        expect(res.body.databases).toEqual([]);
    });

    test('maps an unreachable cluster to 400 and still closes the client', async () => {
        const err = new Error('timeout');
        err.name = 'MongoServerSelectionError';
        mockConnect.mockRejectedValue(err);

        const res = await request(app)
            .post('/api/connections/databases')
            .send({ connectionString: 'mongodb://unreachable:27017' });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('connection_failed');
        expect(res.body.error.message).toMatch(/Could not connect/);
        expect(mockClose).toHaveBeenCalledTimes(1);
    });

    test('rejects a malformed connection string with validation_error', async () => {
        const res = await request(app).post('/api/connections/databases').send({ connectionString: 'postgres://x' });
        expect(res.body.error.code).toBe('validation_error');
    });

    test('maps an unexpected failure to 500 list_databases_failed', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        mockConnect.mockRejectedValue(new Error('boom'));

        const res = await request(app)
            .post('/api/connections/databases')
            .send({ connectionString: 'mongodb://localhost:27017' });

        expect(res.status).toBe(500);
        expect(res.body.error).toEqual({ code: 'list_databases_failed', message: 'Failed to list databases' });
        console.error.mockRestore();
    });
});

describe('POST /api/connections/connect failures', () => {
    const { upsertConnection } = require('../models/UserConnection');
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockConnect.mockResolvedValue();
        mockClose.mockResolvedValue();
        app = express();
        app.use(express.json());
        app.use('/api/connections', connectionsRouter);
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => console.error.mockRestore());

    test('maps an unreachable cluster to 400 connection_failed', async () => {
        const err = new Error('timeout');
        err.name = 'MongoServerSelectionError';
        mockConnect.mockRejectedValue(err);

        const res = await request(app)
            .post('/api/connections/connect')
            .send({ connectionString: 'mongodb://unreachable:27017', dbName: 'shop' });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('connection_failed');
    });

    test('maps a failed save to 500 connection_save_failed', async () => {
        mockListCollections.mockResolvedValue([{ name: 'orders' }]);
        upsertConnection.mockRejectedValue(new Error('central db down'));

        const res = await request(app)
            .post('/api/connections/connect')
            .send({ connectionString: 'mongodb://localhost:27017', dbName: 'shop' });

        expect(res.status).toBe(500);
        expect(res.body.error).toEqual({ code: 'connection_save_failed', message: 'Failed to securely save connection' });
    });
});

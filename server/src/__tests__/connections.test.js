'use strict';

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const connectionRouter = require('../routes/connections');
const userConnectionModel = require('../models/UserConnection');
const jwt = require('jsonwebtoken');

const signToken = (connectionId) => jwt.sign({ connectionId }, process.env.JWT_SECRET, { expiresIn: '7d' });

describe('B2: routes/connections.js GET /:connectionId authorization', () => {
    let app;
    let getConnectionByIdSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long-123456';

        getConnectionByIdSpy = jest.spyOn(userConnectionModel, 'getConnectionById').mockResolvedValue({
            connectionId: 'conn-123',
            dbName: 'sample_db',
            label: 'Production DB',
            lastConnectedAt: new Date(),
            createdAt: new Date(),
        });

        app = express();
        app.use(express.json());
        app.use(cookieParser());
        app.use('/api/connections', connectionRouter);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('returns 401 unauthenticated when no am_token cookie is provided', async () => {
        const res = await request(app)
            .get('/api/connections/conn-123');

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('unauthenticated');
        expect(getConnectionByIdSpy).not.toHaveBeenCalled();
    });

    test('returns 401 session_expired when invalid am_token cookie is provided', async () => {
        const res = await request(app)
            .get('/api/connections/conn-123')
            .set('Cookie', ['am_token=invalid.jwt.token']);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('session_expired');
        expect(getConnectionByIdSpy).not.toHaveBeenCalled();
    });

    test('returns 403 forbidden when cookie connectionId does not match url param', async () => {
        const otherToken = signToken('conn-other');

        const res = await request(app)
            .get('/api/connections/conn-123')
            .set('Cookie', [`am_token=${otherToken}`]);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('forbidden');
        expect(getConnectionByIdSpy).not.toHaveBeenCalled();
    });

    test('returns 200 with connection details when cookie connectionId matches param', async () => {
        const validToken = signToken('conn-123');

        const res = await request(app)
            .get('/api/connections/conn-123')
            .set('Cookie', [`am_token=${validToken}`]);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.connection.connectionId).toBe('conn-123');
        expect(res.body.connection.dbName).toBe('sample_db');
        expect(getConnectionByIdSpy).toHaveBeenCalledWith('conn-123');
    });

    test('returns 404 when connectionId matches authenticated user but does not exist in DB', async () => {
        getConnectionByIdSpy.mockResolvedValueOnce(null);
        const validToken = signToken('conn-123');

        const res = await request(app)
            .get('/api/connections/conn-123')
            .set('Cookie', [`am_token=${validToken}`]);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('not_found');
    });

    test('returns 500 connection_fetch_failed when the lookup throws', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        getConnectionByIdSpy.mockRejectedValueOnce(new Error('central db down'));

        const res = await request(app)
            .get('/api/connections/conn-123')
            .set('Cookie', [`am_token=${signToken('conn-123')}`]);

        expect(res.status).toBe(500);
        expect(res.body).toEqual({
            success: false,
            error: { code: 'connection_fetch_failed', message: 'Failed to fetch connection details' },
        });
    });
});

describe('POST /api/connections/connect error envelope', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use('/api/connections', connectionRouter);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('400 validation_error for a malformed connection string', async () => {
        const res = await request(app).post('/api/connections/connect').send({ connectionString: 'postgres://x', dbName: 'shop' });
        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({ code: 'validation_error', message: 'Invalid MongoDB connection string format' });
    });

    // The scheme is valid but the driver cannot parse the URI (real driver, no mock).
    test('400 validation_error for a URI the driver cannot parse (/connect)', async () => {
        const res = await request(app).post('/api/connections/connect').send({ connectionString: 'mongodb://host:notaport', dbName: 'shop' });
        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({ code: 'validation_error', message: 'Invalid MongoDB connection string format' });
    });

    test('400 validation_error for a URI the driver cannot parse (/databases)', async () => {
        const res = await request(app).post('/api/connections/databases').send({ connectionString: 'mongodb://host:notaport' });
        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({ code: 'validation_error', message: 'Invalid MongoDB connection string format' });
    });

    test('400 validation_error when dbName is missing', async () => {
        const res = await request(app).post('/api/connections/connect').send({ connectionString: 'mongodb://localhost:27017' });
        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({ code: 'validation_error', message: 'dbName is required' });
    });
});


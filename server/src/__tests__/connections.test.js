'use strict';

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const connectionRouter = require('../routes/connections');
const userConnectionModel = require('../models/UserConnection');
const { signToken } = require('../utils/jwt');

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
    });
});

'use strict';

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

jest.mock('../models/UserConnection', () => ({ getConnectionById: jest.fn() }));

const { getConnectionById } = require('../models/UserConnection');
const authRouter = require('../routes/auth');

const cookieFor = (connectionId) => `am_token=${jwt.sign({ connectionId }, process.env.JWT_SECRET, { expiresIn: '7d' })}`;

describe('GET /api/auth/me', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(cookieParser());
        app.use('/api/auth', authRouter);
    });

    test('returns the connection for a valid session', async () => {
        getConnectionById.mockResolvedValue({ connectionId: 'abc', dbName: 'shop', label: 'Prod' });
        const res = await request(app).get('/api/auth/me').set('Cookie', cookieFor('abc'));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, connectionId: 'abc', dbName: 'shop' });
    });

    // F15: after the connectionId migration, old cookies carry an ID that no longer
    // exists. The client calls /me on every load, so this sends users back to connect.
    test('answers 401 connection_not_found and clears the cookie for an unknown connectionId', async () => {
        getConnectionById.mockResolvedValue(null);
        const res = await request(app).get('/api/auth/me').set('Cookie', cookieFor('pre-migration-id'));

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('connection_not_found');
        const setCookie = (res.headers['set-cookie'] || []).join(';');
        expect(setCookie).toMatch(/am_token=;/);
    });
});

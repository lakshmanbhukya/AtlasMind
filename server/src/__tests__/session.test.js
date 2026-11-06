'use strict';

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const {
    COOKIE_NAME,
    APPROVAL_TOKEN_TYPE,
    SessionError,
    issueSession,
    readSession,
    signApprovalToken,
    verifyApprovalToken,
} = require('../auth/session');
const { requireAuth } = require('../middleware/auth');

const originalEnv = { ...process.env };
afterEach(() => {
    process.env = { ...originalEnv };
});

function appWithSession() {
    const app = express();
    app.use(cookieParser());
    app.post('/login/:id', (req, res) => {
        issueSession(res, req.params.id);
        res.json({ ok: true });
    });
    app.get('/whoami', requireAuth, (req, res) => res.json({ connectionId: req.connectionId }));
    return app;
}

describe('session cookie', () => {
    test('issueSession + requireAuth round-trip the connectionId', async () => {
        const app = appWithSession();
        const login = await request(app).post('/login/conn-42');
        const cookie = login.headers['set-cookie'][0];

        expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=`));
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Lax/);

        const me = await request(app).get('/whoami').set('Cookie', cookie.split(';')[0]);
        expect(me.status).toBe(200);
        expect(me.body.connectionId).toBe('conn-42');
    });

    test('production cookies are Secure and SameSite=None', async () => {
        process.env.NODE_ENV = 'production';
        const login = await request(appWithSession()).post('/login/conn-1');
        const cookie = login.headers['set-cookie'][0];
        expect(cookie).toMatch(/Secure/);
        expect(cookie).toMatch(/SameSite=None/);
    });

    test('no cookie -> 401 unauthenticated', async () => {
        const res = await request(appWithSession()).get('/whoami');
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('unauthenticated');
    });

    test('tampered cookie -> 401 session_expired and the cookie is cleared', async () => {
        const forged = jwt.sign({ connectionId: 'victim' }, 'not-the-secret');
        const res = await request(appWithSession()).get('/whoami').set('Cookie', `${COOKIE_NAME}=${forged}`);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('session_expired');
        expect(res.headers['set-cookie'][0]).toMatch(new RegExp(`^${COOKIE_NAME}=;`));
    });

    test('a token without a connectionId is rejected', () => {
        const token = jwt.sign({ something: 'else' }, process.env.JWT_SECRET);
        expect(() => readSession({ cookies: { [COOKIE_NAME]: token } })).toThrow(SessionError);
    });

    test('the secret is read at use time, not import time', () => {
        process.env.JWT_SECRET = 'rotated-secret-value-for-this-test-123';
        const token = jwt.sign({ connectionId: 'c' }, 'rotated-secret-value-for-this-test-123');
        expect(readSession({ cookies: { [COOKIE_NAME]: token } })).toBe('c');
    });
});

describe('Write Approval Token', () => {
    test('carries the staged write, a unique jti, its type and a 10 minute expiry', () => {
        const write = { connectionId: 'c', collection: 'orders', pipeline: [{ $merge: 'x' }], query: 'q', scope: ['orders'] };
        const a = verifyApprovalToken(signApprovalToken(write));
        const b = verifyApprovalToken(signApprovalToken(write));

        expect(a).toMatchObject({ ...write, type: APPROVAL_TOKEN_TYPE });
        expect(a.jti).toEqual(expect.any(String));
        expect(a.jti).not.toBe(b.jti);
        expect(a.exp - a.iat).toBe(600);
    });

    test('a session token is not a valid approval token type', () => {
        const sessionToken = jwt.sign({ connectionId: 'c' }, process.env.JWT_SECRET);
        expect(verifyApprovalToken(sessionToken).type).toBeUndefined();
    });
});

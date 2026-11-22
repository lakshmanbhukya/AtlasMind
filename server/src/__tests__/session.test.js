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
    readSessionClaims,
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
    app.get('/whoami', requireAuth, (req, res) => res.json({
        connectionId: req.connectionId,
        sessionId: req.sessionId,
        expiresAt: req.sessionExpiresAt,
    }));
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

describe('session id (sid)', () => {
    const cookieOf = (login) => login.headers['set-cookie'][0].split(';')[0];

    test('new cookies carry a random sid that requireAuth exposes', async () => {
        const app = appWithSession();
        const a = cookieOf(await request(app).post('/login/shared-conn'));
        const b = cookieOf(await request(app).post('/login/shared-conn'));

        const meA = await request(app).get('/whoami').set('Cookie', a);
        const meB = await request(app).get('/whoami').set('Cookie', b);
        expect(meA.body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
        expect(meA.body.sessionId).not.toBe(meB.body.sessionId);
        expect(meA.body.connectionId).toBe(meB.body.connectionId);
        expect(new Date(meA.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    });

    test('old cookies without sid still authenticate, with sessionId null', async () => {
        const token = jwt.sign({ connectionId: 'old' }, process.env.JWT_SECRET, { expiresIn: '7d' });
        const me = await request(appWithSession()).get('/whoami').set('Cookie', `${COOKIE_NAME}=${token}`);
        expect(me.status).toBe(200);
        expect(me.body).toMatchObject({ connectionId: 'old', sessionId: null });
    });

    test('readSession still returns the connectionId string; readSessionClaims returns all claims', () => {
        const token = jwt.sign({ connectionId: 'c', sid: 's-1' }, process.env.JWT_SECRET, { expiresIn: '7d' });
        const req = { cookies: { [COOKIE_NAME]: token } };
        expect(readSession(req)).toBe('c');
        const claims = readSessionClaims(req);
        expect(claims).toMatchObject({ connectionId: 'c', sid: 's-1' });
        expect(claims.expiresAt).toBeInstanceOf(Date);
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

'use strict';

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { Writable } = require('stream');
const { createFakeCollection } = require('../../test-support/fakeMongo');

let mockColl;
jest.mock('../db/connection', () => ({ getDb: () => ({ collection: () => mockColl }) }));
jest.mock('../models/UserConnection', () => ({ getConnectionById: jest.fn() }));

const groqService = require('../services/groqService');
const { ProviderError } = require('../services/engineErrors');
const { requireAuth } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const providerSettingsRouter = require('../routes/providerSettings');
const authRouter = require('../routes/auth');

const KEY = 'gsk_test_SECRET';
const cookieFor = (claims) => `am_token=${jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '7d' })}`;
const sessionA = cookieFor({ connectionId: 'conn-1', sid: 'sid-a' });
const sessionB = cookieFor({ connectionId: 'conn-1', sid: 'sid-b' });
const legacy = cookieFor({ connectionId: 'conn-1' });

let logLines;
function buildApp() {
    logLines = [];
    const log = createLogger({
        level: 'debug',
        destination: new Writable({ write(chunk, _enc, cb) { logLines.push(chunk.toString()); cb(); } }),
    });
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use((req, _res, next) => { req.log = log; next(); });
    app.use('/api/auth', authRouter);
    app.use('/api/provider-settings', requireAuth, providerSettingsRouter);
    return app;
}

let app;
let validate;
beforeEach(() => {
    mockColl = createFakeCollection({ unique: [['connectionId', 'sessionId']] });
    validate = jest.spyOn(groqService, 'validateApiKey').mockResolvedValue(undefined);
    app = buildApp();
});
afterEach(() => jest.restoreAllMocks());

const get = (cookie) => request(app).get('/api/provider-settings').set('Cookie', cookie);
const putKey = (cookie, apiKey = KEY) => request(app).put('/api/provider-settings/key').set('Cookie', cookie).send({ apiKey });

describe('GET /api/provider-settings', () => {
    test('a new session starts managed, with no-store', async () => {
        const res = await get(sessionA);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toMatchObject({ success: true, mode: 'managed', hasKey: false, keyLast4: null });
        expect(res.body.requiresReconnectForPersonal).toBeUndefined();
    });

    test('a cookie without sid gets managed only', async () => {
        const res = await get(legacy);
        expect(res.body).toMatchObject({ mode: 'managed', requiresReconnectForPersonal: true });
        const put = await putKey(legacy);
        expect(put.status).toBe(409);
        expect(put.body.error.code).toBe('reconnect_required');
        expect(validate).not.toHaveBeenCalled();
    });

    test('requires a session', async () => {
        const res = await request(app).get('/api/provider-settings');
        expect(res.status).toBe(401);
    });
});

describe('PUT /api/provider-settings/key', () => {
    test('validates, stores and switches to personal; the key never comes back', async () => {
        const res = await putKey(sessionA);
        expect(res.status).toBe(200);
        expect(validate).toHaveBeenCalledWith(KEY);
        expect(res.body).toMatchObject({ mode: 'personal', hasKey: true, keyLast4: 'CRET' });
        expect(res.body.keyExpiresAt).toEqual(expect.any(String));
        expect(JSON.stringify(res.body)).not.toContain(KEY);

        const again = await get(sessionA);
        expect(again.body).toMatchObject({ mode: 'personal', hasKey: true });
        expect(JSON.stringify(again.body)).not.toContain(KEY);
    });

    test('two sessions on one connection are isolated', async () => {
        await putKey(sessionA);
        const other = await get(sessionB);
        expect(other.body).toMatchObject({ mode: 'managed', hasKey: false });
    });

    test('an invalid key answers 422 and keeps the previous state', async () => {
        await putKey(sessionA, 'gsk_test_FIRSTKEY');
        validate.mockRejectedValueOnce(new ProviderError('provider_key_invalid', 'Groq rejected this API key.', 422, { payer: 'personal' }));

        const res = await putKey(sessionA, 'gsk_test_BADKEY99');
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('provider_key_invalid');

        const state = await get(sessionA);
        expect(state.body).toMatchObject({ mode: 'personal', keyLast4: 'TKEY' });
    });

    test('a malformed key is rejected without calling Groq', async () => {
        const res = await putKey(sessionA, 'not a key!');
        expect(res.status).toBe(400);
        expect(validate).not.toHaveBeenCalled();
    });

    test('a logout tombstone beats a PUT that was still validating', async () => {
        let release;
        validate.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        // supertest sends on .then(); start the PUT, then wait until it is parked in validation.
        const pending = putKey(sessionA).then((r) => r);
        for (let i = 0; i < 400 && !release; i++) await new Promise((r) => setTimeout(r, 5));
        expect(release).toEqual(expect.any(Function));

        const logout = await request(app).post('/api/auth/logout').set('Cookie', sessionA);
        expect(logout.status).toBe(200);
        release();
        const res = await pending;

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('session_revoked');
        expect(mockColl.docs).toHaveLength(1);
        expect(mockColl.docs[0]).toMatchObject({ revoked: true, encryptedKey: null });
    });

    test('the key never appears in responses or captured logs, even on failure', async () => {
        await putKey(sessionA);
        validate.mockRejectedValueOnce(new ProviderError('provider_unavailable', 'Groq could not be reached.', 502));
        const failed = await putKey(sessionA);
        expect(JSON.stringify(failed.body)).not.toContain(KEY);
        await request(app).post('/api/auth/logout').set('Cookie', sessionA);
        expect(logLines.length).toBeGreaterThan(0);
        expect(logLines.join('')).not.toContain(KEY);
    });
});

describe('PATCH and DELETE', () => {
    test('personal mode needs a stored key', async () => {
        const res = await request(app).patch('/api/provider-settings').set('Cookie', sessionA).send({ mode: 'personal' });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('provider_key_missing');
    });

    test('switch to managed and back, then delete', async () => {
        await putKey(sessionA);
        let res = await request(app).patch('/api/provider-settings').set('Cookie', sessionA).send({ mode: 'managed' });
        expect(res.body).toMatchObject({ mode: 'managed', hasKey: true });
        res = await request(app).patch('/api/provider-settings').set('Cookie', sessionA).send({ mode: 'personal' });
        expect(res.body).toMatchObject({ mode: 'personal' });
        res = await request(app).delete('/api/provider-settings/key').set('Cookie', sessionA);
        expect(res.body).toMatchObject({ mode: 'managed', hasKey: false, keyLast4: null });
    });

    test('an unknown mode is a validation error', async () => {
        const res = await request(app).patch('/api/provider-settings').set('Cookie', sessionA).send({ mode: 'free' });
        expect(res.status).toBe(400);
    });
});

describe('POST /api/auth/logout', () => {
    test('revokes this sign-in only', async () => {
        await putKey(sessionA);
        await putKey(sessionB);
        await request(app).post('/api/auth/logout').set('Cookie', sessionA);
        const a = mockColl.docs.find((d) => d.sessionId === 'sid-a');
        const b = mockColl.docs.find((d) => d.sessionId === 'sid-b');
        expect(a).toMatchObject({ revoked: true, encryptedKey: null });
        expect(b).toMatchObject({ mode: 'personal' });
    });

    const expired = `am_token=${jwt.sign({ connectionId: 'c', sid: 's', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET)}`;
    test.each([
        ['no cookie', null],
        ['an expired cookie', expired],
        ['a legacy cookie', legacy],
    ])('still answers 200 with %s', async (_label, cookie) => {
        const req = request(app).post('/api/auth/logout');
        const res = cookie ? await req.set('Cookie', cookie) : await req;
        expect(res.status).toBe(200);
        expect(mockColl.docs).toHaveLength(0);
    });
});

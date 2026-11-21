'use strict';

const express = require('express');
const request = require('supertest');
const { llmLimiter, LLM_LIMIT } = require('../middleware/rateLimiter');

/** Tiny app: a fake requireAuth reads the connectionId from a header, then the limiter. */
function buildApp() {
    const app = express();
    app.use((req, _res, next) => {
        req.connectionId = req.get('x-test-connection');
        next();
    });
    app.use('/api/query', llmLimiter, (_req, res) => res.json({ success: true }));
    return app;
}

const ask = (app, connectionId) => request(app).post('/api/query').set('x-test-connection', connectionId);

describe('llmLimiter', () => {
    test('allows 30 requests per connection and returns 429 too_many_requests on the 31st', async () => {
        expect(LLM_LIMIT).toBe(30);
        const app = buildApp();
        for (let i = 0; i < LLM_LIMIT; i++) {
            const res = await ask(app, 'conn-a');
            expect(res.status).toBe(200);
        }
        const res = await ask(app, 'conn-a');
        expect(res.status).toBe(429);
        expect(res.body).toEqual({
            success: false,
            error: { code: 'too_many_requests', message: expect.any(String) },
        });
    });

    test('each connection has its own budget', async () => {
        const app = buildApp();
        for (let i = 0; i < LLM_LIMIT; i++) await ask(app, 'conn-b');
        expect((await ask(app, 'conn-b')).status).toBe(429);
        expect((await ask(app, 'conn-c')).status).toBe(200);
    });

    test('history reads (non-POST) are not counted', async () => {
        const app = buildApp();
        for (let i = 0; i < LLM_LIMIT; i++) await ask(app, 'conn-d');
        const res = await request(app).get('/api/query').set('x-test-connection', 'conn-d');
        expect(res.status).toBe(200);
    });
});

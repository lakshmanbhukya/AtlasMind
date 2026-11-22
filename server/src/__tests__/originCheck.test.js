'use strict';

const express = require('express');
const request = require('supertest');
const { originCheck } = require('../middleware/originCheck');

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

function appWithCheck() {
    const app = express();
    app.use('/api/', originCheck);
    app.post('/api/query', (_req, res) => res.json({ ok: true }));
    app.post('/api/query/stream', (_req, res) => res.json({ ok: true }));
    app.put('/api/provider-settings/key', (_req, res) => res.json({ ok: true }));
    app.post('/api/voice', (_req, res) => res.json({ ok: true }));
    app.get('/api/query/history', (_req, res) => res.json({ ok: true }));
    return app;
}

describe('originCheck', () => {
    test.each(['/api/query', '/api/query/stream', '/api/voice'])('a foreign Origin gets 403 on POST %s', async (path) => {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com';
        const res = await request(appWithCheck()).post(path).set('Origin', 'https://evil.example');
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('origin_not_allowed');
    });

    test('an allowed Origin passes', async () => {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com, https://other.example.com';
        const res = await request(appWithCheck()).put('/api/provider-settings/key').set('Origin', 'https://other.example.com');
        expect(res.status).toBe(200);
    });

    test('requests without Origin pass (curl, server-to-server)', async () => {
        process.env.NODE_ENV = 'production';
        const res = await request(appWithCheck()).post('/api/query');
        expect(res.status).toBe(200);
    });

    test('GET is never blocked', async () => {
        process.env.NODE_ENV = 'production';
        const res = await request(appWithCheck()).get('/api/query/history').set('Origin', 'https://evil.example');
        expect(res.status).toBe(200);
    });

    test('development allows the Vite origin but not others', async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.CORS_ALLOWED_ORIGINS;
        const ok = await request(appWithCheck()).post('/api/query').set('Origin', 'http://localhost:5173');
        expect(ok.status).toBe(200);
        const bad = await request(appWithCheck()).post('/api/query').set('Origin', 'http://localhost:9999');
        expect(bad.status).toBe(403);
    });
});

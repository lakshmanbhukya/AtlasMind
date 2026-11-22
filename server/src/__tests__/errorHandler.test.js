'use strict';

const express = require('express');
const request = require('supertest');
const { Writable } = require('stream');
const { createLogger } = require('../utils/logger');
const { errorHandler } = require('../middleware/errorHandler');
const { logPipelineError } = require('../routes/engineHttp');
const { ProviderError } = require('../services/engineErrors');

const SECRET = 'gsk_SECRETSECRETSECRETSECRET1234';

function capture() {
    const lines = [];
    const stream = new Writable({
        write(chunk, _enc, cb) {
            lines.push(...chunk.toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
            cb();
        },
    });
    return { lines, log: createLogger({ level: 'info', destination: stream }) };
}

function appWith(log) {
    const app = express();
    app.use((req, _res, next) => { req.log = log; next(); });
    app.use(express.json());
    app.put('/key', (_req, res) => res.json({ success: true }));
    app.get('/boom', () => { throw Object.assign(new Error('boom'), { code: 'boom_code' }); });
    app.use(errorHandler);
    return app;
}

describe('errorHandler', () => {
    test('malformed JSON: fixed 400 and nothing from the body in the log or response', async () => {
        const { lines, log } = capture();
        const res = await request(appWith(log))
            .put('/key')
            .set('Content-Type', 'application/json')
            .send(`{"apiKey":"${SECRET}"`);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
            success: false,
            error: { code: 'invalid_json', message: 'Request body is not valid JSON.' },
        });
        expect(lines).toHaveLength(1);
        expect(lines[0].level).toBe(40);
        expect(JSON.stringify(lines)).not.toContain('SECRET');
        expect(JSON.stringify(res.body)).not.toContain('SECRET');
    });

    test('other errors keep the existing envelope and are logged as errors', async () => {
        const { lines, log } = capture();
        const res = await request(appWith(log)).get('/boom');

        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('boom_code');
        expect(lines[0].level).toBe(50);
        expect(lines[0].msg).toBe('Unhandled error');
    });

    test('err.body is redacted even if a parse error reaches another logger', () => {
        const { lines, log } = capture();
        log.error({ err: Object.assign(new Error('x'), { body: `{"apiKey":"${SECRET}"` }) }, 'Unhandled error');
        expect(lines[0].err.body).toBe('[Redacted]');
        expect(JSON.stringify(lines)).not.toContain('SECRET');
    });
});

describe('logPipelineError', () => {
    test('an expected provider refusal is a warn without a stack', () => {
        const { lines, log } = capture();
        const err = new ProviderError('managed_allowance_exhausted', 'used up', 429, { payer: 'managed' });
        logPipelineError(log, err, 'Query pipeline error');

        expect(lines[0].level).toBe(40);
        expect(lines[0]).toMatchObject({ code: 'managed_allowance_exhausted', status: 429, payer: 'managed' });
        expect(lines[0].err).toBeUndefined();
    });

    test('provider outages and other failures stay errors with err', () => {
        const { lines, log } = capture();
        logPipelineError(log, new ProviderError('provider_unavailable', 'down', 502), 'Query pipeline error');
        logPipelineError(log, new Error('mongo'), 'Query pipeline error');

        expect(lines.map((l) => l.level)).toEqual([50, 50]);
        expect(lines[0].err.type).toBe('ProviderError');
        expect(lines[1].err.message).toBe('mongo');
    });
});

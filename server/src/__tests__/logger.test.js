'use strict';

const { Writable } = require('stream');
const { createLogger, forRequest, logger } = require('../utils/logger');

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

describe('logger', () => {
    test('redacts connection strings and encrypted URIs', () => {
        const { lines, log } = capture();
        log.info({ connectionString: 'mongodb://u:p@h', encryptedUri: 'v2:abc' }, 'connect');
        log.info({ conn: { uri: 'mongodb+srv://u:p@h' } }, 'nested');

        expect(lines[0].connectionString).toBe('[Redacted]');
        expect(lines[0].encryptedUri).toBe('[Redacted]');
        expect(lines[1].conn.uri).toBe('[Redacted]');
        expect(JSON.stringify(lines)).not.toContain('u:p@h');
    });

    test('redacts cookie and authorization request headers and set-cookie', () => {
        const { lines, log } = capture();
        log.info({
            req: { headers: { cookie: 'am_token=secret', authorization: 'Bearer secret', host: 'x' } },
            res: { headers: { 'set-cookie': 'am_token=secret' } },
        }, 'request completed');

        expect(lines[0].req.headers.cookie).toBe('[Redacted]');
        expect(lines[0].req.headers.authorization).toBe('[Redacted]');
        expect(lines[0].req.headers.host).toBe('x');
        expect(lines[0].res.headers['set-cookie']).toBe('[Redacted]');
    });

    test('serializes errors passed as { err }', () => {
        const { lines, log } = capture();
        log.error({ err: new Error('boom') }, 'failed');
        expect(lines[0].err).toMatchObject({ type: 'Error', message: 'boom' });
        expect(lines[0].err.stack).toEqual(expect.any(String));
    });

    test('the root logger is silent under Jest', () => {
        expect(logger.level).toBe('silent');
    });

    test('forRequest prefers req.log and falls back to the root logger', () => {
        const child = logger.child({ reqId: 'r1' });
        expect(forRequest({ log: child })).toBe(child);
        expect(forRequest({})).toBe(logger);
    });
});

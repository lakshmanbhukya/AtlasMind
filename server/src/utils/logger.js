// @ts-check
const pino = require('pino');

/**
 * Structured logging. One root logger for the server; modules take a
 * child (`logger.child({ module: 'name' })`) and route handlers use the
 * per-request `req.log` that pino-http attaches (it carries the request ID,
 * plus the connectionId once `requireAuth` has run).
 *
 * Output is JSON lines. In dev, `npm run dev` pipes it through pino-pretty.
 * `LOG_LEVEL` is operational config (default `info`); the logger is silent
 * under Jest so test output stays clean.
 *
 * Never log question text or connection URIs. The redact paths below are a
 * backstop, not permission to pass secrets in.
 */
const REDACT_PATHS = [
    'connectionString',
    'encryptedUri',
    'uri',
    '*.connectionString',
    '*.encryptedUri',
    '*.uri',
    'apiKey',
    '*.apiKey',
    'authorization',
    '*.authorization',
    'req.headers.cookie',
    'req.headers.authorization',
    'res.headers["set-cookie"]',
];

function defaultLevel() {
    if (process.env.JEST_WORKER_ID) return 'silent';
    return process.env.LOG_LEVEL || 'info';
}

/**
 * Build a logger. Exported for tests, which pass their own destination stream.
 * @param {{ level?: string, destination?: import('pino').DestinationStream }} [opts]
 */
function createLogger({ level = defaultLevel(), destination } = {}) {
    const options = {
        level,
        redact: { paths: REDACT_PATHS },
        serializers: { err: pino.stdSerializers.err },
    };
    return destination ? pino(options, destination) : pino(options);
}

const logger = createLogger();

/**
 * The request's logger (`req.log`, set by pino-http), or the root logger when
 * a router runs without pino-http, as in route unit tests.
 * @param {{ log?: import('pino').Logger }} req
 */
function forRequest(req) {
    return (req && req.log) || logger;
}

module.exports = { logger, createLogger, forRequest, REDACT_PATHS };

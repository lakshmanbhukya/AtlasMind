// @ts-check
const { logger } = require('../utils/logger');

/**
 * Last-resort Express error handler, mounted after every route in index.js.
 *
 * A body that `express.json()` cannot parse is answered with a fixed 400 and
 * logged without its contents: body-parser's error carries the raw text in
 * `err.body`, and Node's JSON.parse message quotes the start of it, so either
 * one could put a personal Groq key (PUT /api/provider-settings/key) in the log.
 *
 * @type {import('express').ErrorRequestHandler}
 */
function errorHandler(err, req, res, _next) {
    const log = req.log || logger;

    if (err && err.type === 'entity.parse.failed') {
        log.warn({ type: err.type, status: 400 }, 'Malformed JSON body');
        return res.status(400).json({
            success: false,
            error: { code: 'invalid_json', message: 'Request body is not valid JSON.' },
        });
    }

    log.error({ err }, 'Unhandled error');
    return res.status(err.statusCode || 500).json({
        success: false,
        error: {
            code: err.code || 'internal_error',
            message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        },
    });
}

module.exports = { errorHandler };

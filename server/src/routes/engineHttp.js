// @ts-check
'use strict';

const { QueryEngineError, ProviderError } = require('../services/engineErrors');

/**
 * HTTP mapping for QueryExecutionEngine outcomes and errors.
 * Shared by the query, voice and approve intake adapters so all three map
 * the engine's typed results to status codes the same way. The pure helpers
 * (outcomeStatus, errorResult) are also used by the SSE stream, which sends
 * the same status and body inside its `result` event.
 */

const OUTCOME_STATUS = {
    success: 200,
    clarification_required: 200,
    approval_required: 200,
    safety_blocked: 422,
};

/**
 * @param {{ type: string }} outcome
 * @returns {number}
 */
function outcomeStatus(outcome) {
    return OUTCOME_STATUS[outcome.type] || 200;
}

/**
 * Typed engine errors carry their own status, code and message. A
 * ProviderError also carries who paid (`payer`) and, when known,
 * `retryAfterSeconds` / `resetAt`. Anything else is an unexpected failure in
 * the adapter itself and maps to 500 with `fallbackCode` and
 * `fallbackMessage`: its own message (SDK or driver text) is never sent.
 * The same body goes out over JSON, the SSE `result` event and voice.
 * @param {any} error
 * @param {string} fallbackCode
 * @param {string} fallbackMessage
 * @returns {{ status: number, body: { success: false, error: { code: string, message: string, payer?: string, retryAfterSeconds?: number, resetAt?: string } } }}
 */
function errorResult(error, fallbackCode, fallbackMessage) {
    if (!(error instanceof QueryEngineError)) {
        return {
            status: 500,
            body: { success: false, error: { code: fallbackCode, message: fallbackMessage } },
        };
    }
    /** @type {{ code: string, message: string, payer?: string, retryAfterSeconds?: number, resetAt?: string }} */
    const body = { code: error.code, message: error.message || fallbackMessage };
    if (error instanceof ProviderError) {
        if (error.payer) body.payer = error.payer;
        if (error.retryAfterSeconds !== undefined) body.retryAfterSeconds = error.retryAfterSeconds;
        if (error.resetAt !== undefined) body.resetAt = error.resetAt;
    }
    return { status: error.statusCode, body: { success: false, error: body } };
}

function sendOutcome(res, outcome, body = outcome.data) {
    return res.status(outcomeStatus(outcome)).json(body);
}

function sendError(res, error, fallbackCode, fallbackMessage) {
    const { status, body } = errorResult(error, fallbackCode, fallbackMessage);
    return res.status(status).json(body);
}

/**
 * Log a pipeline failure. A ProviderError below 500 (allowance used up, key
 * rejected, Groq rate limit, stale payer) is an expected answer the user can
 * act on, so it is a `warn` with its code and payer and no stack. Everything
 * else, including provider outages, stays an `error` with the full `err`.
 * @param {import('pino').Logger} log
 * @param {any} error
 * @param {string} message
 */
function logPipelineError(log, error, message) {
    if (error instanceof ProviderError && error.statusCode < 500) {
        log.warn({ code: error.code, status: error.statusCode, payer: error.payer }, message);
        return;
    }
    log.error({ err: error }, message);
}

module.exports = { sendOutcome, sendError, outcomeStatus, errorResult, logPipelineError };

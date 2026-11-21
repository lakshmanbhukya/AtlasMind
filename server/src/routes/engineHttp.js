// @ts-check
'use strict';

const { QueryEngineError } = require('../services/engineErrors');

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
 * Typed engine errors carry their own status and code. Anything else is an
 * unexpected failure in the adapter itself and maps to 500 with `fallbackCode`.
 * @param {any} error
 * @param {string} fallbackCode
 * @param {string} fallbackMessage
 * @returns {{ status: number, body: { success: false, error: { code: string, message: string } } }}
 */
function errorResult(error, fallbackCode, fallbackMessage) {
    const isEngineError = error instanceof QueryEngineError;
    return {
        status: isEngineError ? error.statusCode : 500,
        body: {
            success: false,
            error: {
                code: isEngineError ? error.code : fallbackCode,
                message: (error && error.message) || fallbackMessage,
            },
        },
    };
}

function sendOutcome(res, outcome, body = outcome.data) {
    return res.status(outcomeStatus(outcome)).json(body);
}

function sendError(res, error, fallbackCode, fallbackMessage) {
    const { status, body } = errorResult(error, fallbackCode, fallbackMessage);
    return res.status(status).json(body);
}

module.exports = { sendOutcome, sendError, outcomeStatus, errorResult };

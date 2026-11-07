'use strict';

const { QueryEngineError } = require('../services/engineErrors');

/**
 * HTTP mapping for QueryExecutionEngine outcomes and errors.
 * Shared by the query, voice and approve intake adapters so all three map
 * the engine's typed results to status codes the same way.
 */

const OUTCOME_STATUS = {
    success: 200,
    clarification_required: 200,
    approval_required: 200,
    safety_blocked: 422,
};

function sendOutcome(res, outcome, body = outcome.data) {
    const status = OUTCOME_STATUS[outcome.type] || 200;
    return res.status(status).json(body);
}

/**
 * Typed engine errors carry their own status and code. Anything else is an
 * unexpected failure in the adapter itself and maps to 500 with `fallbackCode`.
 */
function sendError(res, error, fallbackCode, fallbackMessage) {
    const isEngineError = error instanceof QueryEngineError;
    const status = isEngineError ? error.statusCode : 500;
    const code = isEngineError ? error.code : fallbackCode;
    return res.status(status).json({
        success: false,
        error: {
            code,
            message: (error && error.message) || fallbackMessage,
        },
    });
}

module.exports = { sendOutcome, sendError };

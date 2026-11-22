// @ts-check
'use strict';

const {
    QueryEngineError,
    ValidationError,
    ScopeError,
    TokenExpiredError,
    UnauthorizedTokenError,
    TokenAlreadyUsedError,
    SafetyViolationError,
    ExecutionError,
    RateLimitError,
} = require('./engineErrors');
const { runNaturalLanguageQuery } = require('./engine/naturalLanguageQuery');
const { runApprovedWrite } = require('./engine/approvedWrite');

/**
 * Translate any failure escaping the engine into a typed QueryEngineError,
 * so HTTP adapters never see raw driver / SDK errors (or their status codes).
 */
function toEngineError(err) {
    if (err instanceof QueryEngineError) return err;
    if (err && err.statusCode === 404) {
        const notFound = new QueryEngineError(err.message || 'Connection not found', 'connection_not_found', 404);
        notFound.cause = err;
        return notFound;
    }
    const isRateLimited = err && (err.status === 429 || err.code === 'QUOTA_EXHAUSTED');
    const wrapped = isRateLimited
        ? new RateLimitError(err.message || undefined)
        : new ExecutionError((err && err.message) || 'Query execution failed');
    wrapped.cause = err;
    return wrapped;
}

/** Accepts (params), (connectionId, params) or (context, params). */
function normalizeParams(contextOrParams, inputParams) {
    if (typeof contextOrParams === 'string') {
        return { connectionId: contextOrParams, ...(inputParams || {}) };
    }
    if (contextOrParams && typeof contextOrParams === 'object' && inputParams && typeof inputParams === 'object') {
        return { ...contextOrParams, ...inputParams };
    }
    return { ...(contextOrParams || {}) };
}

/**
 * What the engine returns for a handled query (routes/engineHttp.js maps it to
 * HTTP). Failures are thrown as QueryEngineError instead (engineErrors.js).
 * @typedef {{ type: 'success'|'clarification_required'|'approval_required'|'safety_blocked', data: Record<string, any>, approvalToken?: string }} QueryOutcome
 */

class QueryExecutionEngine {
    /**
     * Central natural language query processing method.
     * Transport- and media-agnostic domain engine.
     *
     * @param {object|string} contextOrParams - Context object or connectionId string or combined params
     * @param {object} [inputParams] - Input params if context was provided as 1st arg
     *   Optional `onProgress(stage)` receives 'scope', 'schema', 'ambiguity', 'generating',
     *   'safety' and 'executing' as the query reaches each stage (route-supplied).
     *   Optional `provider` (groqService.resolveProvider) says who pays for the Groq call;
     *   like onProgress it is route-supplied, never read from a request body.
     * @returns {Promise<QueryOutcome>}
     */
    static async executeNaturalLanguageQuery(contextOrParams, inputParams) {
        try {
            return await runNaturalLanguageQuery(normalizeParams(contextOrParams, inputParams));
        } catch (err) {
            throw toEngineError(err);
        }
    }

    /**
     * Mutating write validation and execution.
     * Absorbs JWT decoding, single-use replay prevention, safety re-validation,
     * and user database execution into the engine.
     *
     * @param {object|string} contextOrParams - Context object or connectionId or combined params
     * @param {object} [inputParams] - Input params if context was provided as 1st arg
     * @returns {Promise<QueryOutcome & { type: 'success' }>}
     */
    static async executeApprovedWrite(contextOrParams, inputParams) {
        try {
            return await runApprovedWrite(normalizeParams(contextOrParams, inputParams));
        } catch (err) {
            throw toEngineError(err);
        }
    }
}

module.exports = { QueryExecutionEngine };

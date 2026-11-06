'use strict';

const {
    QueryExecutionEngine,
    validateRequestedCollections,
} = require('./queryExecutionEngine');

/**
 * Backwards-compatible shim for processNaturalLanguageQuery.
 * Delegates all natural language query processing to QueryExecutionEngine.
 *
 * @param {object} params
 * @returns {Promise<{ statusCode: number, response: object, data: object }>}
 */
async function processNaturalLanguageQuery(params) {
    try {
        const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery(params);
        let statusCode = 200;
        if (outcome.type === 'safety_blocked') {
            statusCode = 422;
        }
        return {
            statusCode,
            response: outcome.data,
            data: outcome.data,
        };
    } catch (err) {
        const statusCode = err.statusCode || (err.name === 'ValidationError' || err.name === 'ScopeError' ? 400 : 500);
        const code = err.code || (statusCode === 400 ? 'validation_error' : 'query_error');
        const payload = {
            success: false,
            error: {
                code,
                message: err.message,
            },
        };
        return {
            statusCode,
            response: payload,
            data: payload,
        };
    }
}

module.exports = {
    processNaturalLanguageQuery,
    validateRequestedCollections,
};

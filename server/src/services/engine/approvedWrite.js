// @ts-check
/** Query engine: executing an approved write (token checks, single-use jti, safety re-validation). */
'use strict';

/** @typedef {import('../queryExecutionEngine').QueryOutcome} QueryOutcome */

const { signApprovalToken, verifyApprovalToken, APPROVAL_TOKEN_TYPE } = require('../../auth/session');
const { executePipeline, classifyExecution, UnsafePipelineError } = require('../queryExecutor');
const queryHistoryStore = require('../../stores/queryHistoryStore');
const { getUserDb } = require('../userDbPool');
const { getDb } = require('../../db/connection');
const log = require('../../utils/logger').logger.child({ module: 'queryExecutionEngine' });
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
} = require('../engineErrors');
const { tenantDatabaseOf } = require('./shared');

let approvalIndexesInitialized = false;

async function ensureApprovalIndexes(db) {
    if (approvalIndexesInitialized) return;
    try {
        const approvalTokens = db.collection('approval_tokens');
        if (approvalTokens && typeof approvalTokens.createIndex === 'function') {
            await approvalTokens.createIndex({ jti: 1 }, { unique: true });
            await approvalTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
            approvalIndexesInitialized = true;
        }
    } catch (err) {
        log.warn({ err }, 'Could not ensure approval_tokens indexes');
    }
}

/**
 * @param {Record<string, any>} params - normalized by normalizeParams
 * @returns {Promise<QueryOutcome & { type: 'success' }>}
 */
async function runApprovedWrite(params) {
    const { approvalToken, connectionId } = params;
    const startTime = Date.now();

    if (!connectionId) {
        throw new ValidationError('connectionId is required', 'validation_error');
    }

    if (!approvalToken) {
        throw new ValidationError('Missing "approvalToken" field in request body', 'validation_error');
    }

    let decoded;
    try {
        decoded = verifyApprovalToken(approvalToken);
    } catch (err) {
        throw new TokenExpiredError('Approval draft has expired or is invalid. Please resend query.');
    }

    if (decoded.type !== APPROVAL_TOKEN_TYPE) {
        throw new ValidationError('Invalid token signature type', 'invalid_token');
    }

    const { connectionId: tokenConnectionId, collection, pipeline, query, jti, scope } = decoded;

    // Ownership verification
    if (tokenConnectionId !== connectionId) {
        throw new UnauthorizedTokenError('Access denied: token connectionId does not match current session');
    }

    if (!jti) {
        throw new ValidationError('Token missing unique identifier (jti)', 'invalid_token');
    }

    // Get User DB (pooled connection); its name is the only database a write may target
    let userDb;
    try {
        userDb = await getUserDb(connectionId);
    } catch (err) {
        throw new ExecutionError(err.message || 'Failed to connect to user database');
    }

    // Safe Execution verdict with the token's scope: only needs_approval (or a plain read) may run
    const verdict = classifyExecution({
        collection,
        pipeline,
        scope: scope || null,
        tenantDatabase: tenantDatabaseOf(userDb),
    });
    if (verdict.kind !== 'needs_approval' && verdict.kind !== 'runnable') {
        throw new SafetyViolationError(
            verdict.reason || 'Pipeline failed the safety guard',
            'safety_violation'
        );
    }

    // Atomic single-use jti via unique index in central DB (spent only after the verdict passes)
    const centralDb = getDb();
    await ensureApprovalIndexes(centralDb);
    const approvalTokens = centralDb.collection('approval_tokens');

    try {
        await approvalTokens.insertOne({
            jti,
            connectionId,
            usedAt: new Date(),
            expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 10 * 60 * 1000),
        });
    } catch (err) {
        if (err.code === 11000) {
            throw new TokenAlreadyUsedError('Approval token has already been used');
        }
        throw new ExecutionError(err.message);
    }

    // Run mutating aggregation pipeline directly on database collection
    let results, executionTimeMs;
    try {
        const execRes = await executePipeline(
            userDb,
            collection,
            verdict.pipeline,
            { scope: scope || null, approvedWrite: true }
        );
        results = execRes.results;
        executionTimeMs = execRes.executionTimeMs;
    } catch (err) {
        if (err instanceof UnsafePipelineError) {
            throw new SafetyViolationError(err.message, 'safety_violation');
        }
        throw new ExecutionError(err.message || 'Failed to apply approved write transaction');
    }

    // Log transaction to central query history
    queryHistoryStore.record({
        connectionId,
        naturalLanguage: query,
        generatedPipeline: pipeline,
        collection,
        chartType: 'table',
        resultCount: results.length,
        confidenceScore: 100,
        similarQueriesCount: 0,
        schemaContext: 'Transaction Authorized (Human-in-the-Loop Approved Write)',
        results,
    });

    return {
        type: 'success',
        data: {
            success: true,
            naturalLanguage: query,
            aiMessage: `✅ Transaction Authorized: Successfully executed the approved write to collection "${(verdict.kind === 'needs_approval' && verdict.write?.targetCollection) || collection}".`,
            pipeline,
            mql: pipeline,
            collection,
            chartType: 'table',
            results,
            executionTimeMs,
            safetyStatus: 'write-executed',
            meta: {
                resultCount: results.length,
                executionTimeMs,
                totalTimeMs: Date.now() - startTime,
                similarQueriesCount: 0,
                confidenceScore: 100,
            },
        },
    };
}

module.exports = {
    runApprovedWrite,
};

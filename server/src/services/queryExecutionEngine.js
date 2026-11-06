'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { formatMinifiedSchema, formatFieldNamesOnly, profileSchema } = require('./schemaProfiler');
const { getSimilarExamples, addExample } = require('./fewShotRetriever');
const { generateMQL } = require('./groqService');
const { validatePipeline, validateCollectionName } = require('./safetyGuard');
const { executePipeline, saveQueryHistory } = require('./queryExecutor');
const { getUserDb } = require('./userDbPool');
const { getDb } = require('../db/connection');
const {
    hasWriteIntent,
    analyzeAmbiguity,
    validateClarifications,
    buildEnrichedQuery,
    recordAmbiguityMetric,
} = require('./ambiguityGate');
const { verifyInterpretationCompliance } = require('./interpretationComplianceVerifier');

// Domain Error Hierarchy
class QueryEngineError extends Error {
    constructor(message, code, statusCode) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
    }
}

class ValidationError extends QueryEngineError {
    constructor(message, code = 'validation_error') {
        super(message, code, 400);
    }
}

class ScopeError extends QueryEngineError {
    constructor(message, code = 'validation_error') {
        super(message, code, 400);
    }
}

class TokenExpiredError extends QueryEngineError {
    constructor(message = 'Approval draft has expired or is invalid. Please resend query.') {
        super(message, 'expired_token', 401);
    }
}

class UnauthorizedTokenError extends QueryEngineError {
    constructor(message = 'Access denied: token connectionId does not match current session') {
        super(message, 'forbidden', 403);
    }
}

class TokenAlreadyUsedError extends QueryEngineError {
    constructor(message = 'Approval token has already been used') {
        super(message, 'token_already_used', 409);
    }
}

class SafetyViolationError extends QueryEngineError {
    constructor(message, code = 'safety_violation') {
        super(message, code, 422);
    }
}

class ExecutionError extends QueryEngineError {
    constructor(message, code = 'execution_error') {
        super(message, code, 500);
    }
}

class RateLimitError extends QueryEngineError {
    constructor(message = 'The language model is rate limited. Please retry shortly.', code = 'rate_limited') {
        super(message, code, 429);
    }
}

/**
 * Translate any failure escaping the engine into a typed QueryEngineError,
 * so HTTP adapters never see raw driver / SDK errors (or their status codes).
 */
function toEngineError(err) {
    if (err instanceof QueryEngineError) return err;
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

const SYSTEM_COLLECTIONS = new Set([
    'few_shot_examples',
    'query_history',
    'dashboards',
    'user_connections',
    'workspaces',
    'approval_tokens',
    'system.views',
]);

/**
 * Validate requested collection scope against the user's real DB collections.
 *
 * @param {import('mongodb').Db} userDb
 * @param {string[]|undefined|null} collections
 * @param {object} [options={}]
 * @param {boolean} [options.dropMissing=false]
 * @returns {Promise<{ valid: boolean, error?: { status: number, code: string, message: string }, effectiveScope: string[], allUserCollections: string[] }>}
 */
async function validateRequestedCollections(userDb, collections, options = {}) {
    const dbCollections = await userDb.listCollections().toArray();
    const allUserCollections = dbCollections
        .map((c) => c.name)
        .filter((name) => !SYSTEM_COLLECTIONS.has(name) && !name.startsWith('system.'));
    const userCollSet = new Set(allUserCollections);

    if (collections === undefined || collections === null) {
        return { valid: true, effectiveScope: allUserCollections, allUserCollections };
    }

    if (!Array.isArray(collections)) {
        return {
            valid: false,
            error: {
                status: 400,
                code: 'validation_error',
                message: '"collections" must be an array of collection names',
            },
            effectiveScope: allUserCollections,
            allUserCollections,
        };
    }

    if (collections.length === 0) {
        return { valid: true, effectiveScope: allUserCollections, allUserCollections };
    }

    const { dropMissing = false } = options;

    for (const name of collections) {
        if (typeof name !== 'string' || !name.trim()) {
            return {
                valid: false,
                error: {
                    status: 400,
                    code: 'validation_error',
                    message: 'Each collection in "collections" must be a non-empty string',
                },
                effectiveScope: allUserCollections,
                allUserCollections,
            };
        }
        if (!userCollSet.has(name) && !dropMissing) {
            return {
                valid: false,
                error: {
                    status: 400,
                    code: 'validation_error',
                    kind: 'unknown_collection',
                    message: `Unknown collection: "${name}"`,
                },
                effectiveScope: allUserCollections,
                allUserCollections,
            };
        }
    }

    const filteredCollections = dropMissing
        ? collections.filter((c) => userCollSet.has(c))
        : collections;

    const effectiveScope = filteredCollections.length > 0
        ? Array.from(new Set(filteredCollections))
        : allUserCollections;

    return { valid: true, effectiveScope, allUserCollections };
}

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
    } catch (_) {}
}

class QueryExecutionEngine {
    /**
     * Central natural language query processing method.
     * Transport- and media-agnostic domain engine.
     *
     * @param {object|string} contextOrParams - Context object or connectionId string or combined params
     * @param {object} [inputParams] - Input params if context was provided as 1st arg
     * @returns {Promise<{ type: 'success'|'clarification_required'|'approval_required'|'safety_blocked', data: object, approvalToken?: string }>}
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
     * @returns {Promise<{ type: 'success', data: object }>}
     */
    static async executeApprovedWrite(contextOrParams, inputParams) {
        try {
            return await runApprovedWrite(normalizeParams(contextOrParams, inputParams));
        } catch (err) {
            throw toEngineError(err);
        }
    }
}

async function runNaturalLanguageQuery(params) {
    const {
        connectionId,
        text,
        query: queryParam,
        db: dbParam,
        collections,
        workspaceId,
        dropMissing,
        model,
        clarifications,
        bypassAmbiguity,
        isEdit,
        startTime = Date.now(),
        source = 'query',
        evalOptions = {},
    } = params;

    // Input validation
    const rawText = text !== undefined ? text : queryParam;
    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
        throw new ValidationError('Request body must include a non-empty "text" field', 'validation_error');
    }

    const query = rawText.trim();
    if (query.length > 2000) {
        throw new ValidationError('Query text must be under 2000 characters', 'validation_error');
    }

    if (!connectionId) {
        throw new ValidationError('connectionId is required', 'validation_error');
    }

    const isEvalMode = process.env.EVAL_MODE === '1';
    const evalOpts = isEvalMode ? (evalOptions || {}) : {};

    const hrNow = () => process.hrtime.bigint();
    const toMs = (startNs) => Number(process.hrtime.bigint() - startNs) / 1e6;
    const totalStartNs = hrNow();

    let gateMs = 0;
    let schemaMs = 0;
    let fewShotMs = 0;
    let llmMs = 0;
    let validateMs = 0;
    let dbMs = 0;
    let gateInfo = { reason: null, matchedTerms: [] };
    let safetyInfo = { code: null, reason: null };
    let currentLlmResult = null;
    let clarificationSource = null;
    let complianceInfo = { checked: false, compliant: true, reason: null };

    const buildOutcomePayload = (payload) => {
        if (payload.needsClarification && clarificationSource) {
            payload.clarificationSource = clarificationSource;
        }
        if (payload.meta) {
            payload.meta.compliance = complianceInfo;
        }
        if (isEvalMode) {
            payload.diagnostics = {
                timings: {
                    gateMs,
                    schemaMs,
                    fewShotMs,
                    llmMs,
                    validateMs,
                    dbMs,
                    totalMs: toMs(totalStartNs),
                },
                usage: currentLlmResult?.usage || null,
                model: currentLlmResult?.model || evalOpts.model || model || null,
                retries: currentLlmResult?.retries || 0,
                gate: gateInfo,
                safety: safetyInfo,
                compliance: complianceInfo,
                clarificationSource,
                rawText: currentLlmResult?.rawText || null,
                finishReason: currentLlmResult?.finishReason || null,
            };
        }
        return payload;
    };

    // 1. Get User DB from pool (or evalOptions.db / dbParam in evaluation mode)
    const userDb = (isEvalMode && (evalOpts.db || dbParam))
        ? (evalOpts.db || dbParam)
        : await getUserDb(connectionId);

    // If workspaceId was provided, resolve its collections
    let effectiveCollections = collections;
    if (workspaceId && !collections) {
        const Workspace = require('../models/Workspace');
        const ws = await Workspace.getWorkspaceById(workspaceId, connectionId);
        if (ws && Array.isArray(ws.collections)) {
            effectiveCollections = ws.collections;
        }
    }

    // 2. Validate collection scope against DB
    const scopeCheck = await validateRequestedCollections(userDb, effectiveCollections, {
        dropMissing: Boolean(dropMissing || workspaceId),
    });
    if (!scopeCheck.valid) {
        if (scopeCheck.error.kind === 'unknown_collection') {
            throw new ScopeError(scopeCheck.error.message, scopeCheck.error.code || 'validation_error');
        }
        throw new ValidationError(scopeCheck.error.message, scopeCheck.error.code || 'validation_error');
    }

    let { effectiveScope } = scopeCheck;
    let isRestrictedScope = Array.isArray(collections) && collections.length > 0;

    // evalOptions.disableScope: override scoping to all user collections
    if (evalOpts.disableScope) {
        effectiveScope = scopeCheck.allUserCollections;
        isRestrictedScope = false;
    }

    // 3. Profile schema + retrieve few-shot examples (scoped by connectionId and collections)
    const fewShotLimit = evalOpts.fewShotLimit !== undefined ? evalOpts.fewShotLimit : 3;

    const tSchemaStart = hrNow();
    const rawSchema = await profileSchema(userDb, {
        forceRefresh: false,
        connectionId,
        collections: effectiveScope,
    });
    schemaMs = toMs(tSchemaStart);

    const tFewShotStart = hrNow();
    let fewShotExamples = [];
    try {
        fewShotExamples = await getSimilarExamples(
            query,
            fewShotLimit,
            connectionId,
            isRestrictedScope ? effectiveScope : null
        );
    } catch {
        fewShotExamples = [];
    }
    fewShotMs = toMs(tFewShotStart);

    // evalOptions.disableSchemaContext: field names only without types, samples, or relationship hints
    const schemaContext = evalOpts.disableSchemaContext
        ? formatFieldNamesOnly(rawSchema)
        : formatMinifiedSchema(rawSchema);

    const similarQueriesCount = fewShotExamples.length;
    recordAmbiguityMetric('query_evaluated', { connectionId, source });

    // 4. Ambiguity Resolution & Prompt Enrichment
    let queryForGeneration = query;
    let sanitizedClarifications = null;
    const isWriteQuery = hasWriteIntent(query);
    let isClarificationPass = bypassAmbiguity === true || isWriteQuery;

    if (clarifications !== undefined && clarifications !== null) {
        const valResult = validateClarifications(clarifications, rawSchema);
        if (!valResult.valid) {
            throw new ValidationError('Invalid clarification value provided.', 'validation_error');
        }
        sanitizedClarifications = valResult.sanitized;
        queryForGeneration = buildEnrichedQuery(query, sanitizedClarifications);
        isClarificationPass = true;
        gateInfo = { reason: 'clarified', matchedTerms: [] };
        if (isEdit) {
            recordAmbiguityMetric('clarification_edit', { connectionId, source });
        } else {
            recordAmbiguityMetric('ambiguity_resolved', { connectionId, source });
        }
    } else if (bypassAmbiguity === true) {
        recordAmbiguityMetric('ambiguity_bypassed', { connectionId, source });
        gateInfo = { reason: 'bypassed', matchedTerms: [] };
    } else if (isWriteQuery) {
        gateInfo = { reason: 'write_intent', matchedTerms: [] };
    } else if (evalOpts.disableGate) {
        gateInfo = { reason: 'gate_disabled', matchedTerms: [] };
    } else {
        try {
            const tGateStart = hrNow();
            const ambiguityAnalysis = analyzeAmbiguity(query, rawSchema);
            gateMs = toMs(tGateStart);

            gateInfo = {
                reason: ambiguityAnalysis.diagnostics.reason,
                matchedTerms: ambiguityAnalysis.diagnostics.matchedTerms,
            };

            if (ambiguityAnalysis.result && ambiguityAnalysis.result.needsClarification) {
                clarificationSource = 'gate';
                recordAmbiguityMetric('ambiguity_asked', { connectionId, source });
                return {
                    type: 'clarification_required',
                    data: buildOutcomePayload({
                        success: true,
                        needsClarification: true,
                        naturalLanguage: query,
                        questions: ambiguityAnalysis.result.questions,
                        scope: effectiveScope,
                    }),
                };
            }
        } catch (ambErr) {
            console.warn(`⚠️ Deterministic ambiguity gate error (${source}, failing open):`, ambErr.message);
        }
    }

    // 5. Generate MQL via Groq LLM
    const targetModel = evalOpts.model || model;
    const llmGenOptions = {
        isClarificationPass,
        disableClarificationMode: Boolean(evalOpts.disableClarificationMode),
        forceFinalQueryMode: Boolean(evalOpts.forceFinalQueryMode),
        rawSchema,
        scopedCollections: isRestrictedScope ? effectiveScope : [],
        ...(evalOpts.temperature !== undefined ? { temperature: evalOpts.temperature } : {}),
    };

    const tLlmStart = hrNow();
    const llmResult = await generateMQL(
        queryForGeneration,
        schemaContext,
        fewShotExamples,
        targetModel,
        llmGenOptions
    );
    llmMs = llmResult.timings?.llmMs !== undefined ? llmResult.timings.llmMs : toMs(tLlmStart);
    currentLlmResult = llmResult;

    // If LLM indicates clarification is needed
    if (llmResult.needsClarification === true && !isClarificationPass) {
        clarificationSource = 'llm';
        recordAmbiguityMetric('ambiguity_asked', { connectionId, source });
        return {
            type: 'clarification_required',
            data: buildOutcomePayload({
                success: true,
                needsClarification: true,
                naturalLanguage: query,
                questions: llmResult.questions,
                scope: effectiveScope,
            }),
        };
    }

    if (!sanitizedClarifications && !bypassAmbiguity) {
        recordAmbiguityMetric('ambiguity_skipped', { connectionId, source });
    }

    // 6. Check for LLM-signaled missing collections (scope-insufficient)
    if (Array.isArray(llmResult.missingCollections) && llmResult.missingCollections.length > 0) {
        return {
            type: 'success',
            data: buildOutcomePayload({
                success: true,
                needsClarification: false,
                naturalLanguage: query,
                aiMessage: llmResult.explanation || `This query requires collection(s) outside your active scope: ${llmResult.missingCollections.join(', ')}.`,
                explanation: llmResult.explanation || `This query requires collection(s) outside your active scope: ${llmResult.missingCollections.join(', ')}.`,
                pipeline: [],
                mql: [],
                collection: '',
                chartType: 'table',
                safetyStatus: 'scope-insufficient',
                safetyBlocked: false,
                suggestedCollections: llmResult.missingCollections,
                scope: effectiveScope,
                results: [],
                result: [],
                meta: {
                    resultCount: 0,
                    executionTimeMs: 0,
                    totalTimeMs: Date.now() - startTime,
                    examplesUsed: similarQueriesCount,
                    similarQueriesCount,
                    confidenceScore: 0,
                    scope: effectiveScope,
                },
                schemaContext,
            }),
        };
    }

    // 7. Handle AI fallback (no pipeline generated)
    if (!llmResult.pipeline || llmResult.pipeline.length === 0) {
        return {
            type: 'success',
            data: buildOutcomePayload({
                success: true,
                needsClarification: false,
                naturalLanguage: query,
                aiMessage: llmResult.explanation || "I couldn't generate a query for that request.",
                pipeline: [],
                mql: [],
                collection: '',
                chartType: 'table',
                explanation: llmResult.explanation || "I couldn't generate a query for that request.",
                safetyStatus: 'read-only',
                results: [],
                result: [],
                scope: effectiveScope,
                meta: {
                    resultCount: 0,
                    executionTimeMs: 0,
                    totalTimeMs: Date.now() - startTime,
                    examplesUsed: similarQueriesCount,
                    similarQueriesCount,
                    confidenceScore: 0,
                    scope: effectiveScope,
                },
                schemaContext,
                executionTimeMs: 0,
                confidenceScore: 0,
                similarQueriesCount,
            }),
        };
    }

    // 7.5 Interpretation Compliance Check (Post-Clarification Verification)
    if (sanitizedClarifications && sanitizedClarifications.length > 0 && Array.isArray(llmResult.pipeline) && llmResult.pipeline.length > 0) {
        const targetClarification = sanitizedClarifications.find((c) => c.value && c.value !== '__other__') || sanitizedClarifications[0];
        const compRes = verifyInterpretationCompliance(llmResult.pipeline, targetClarification, query);
        complianceInfo = {
            checked: true,
            compliant: compRes.compliant,
            reason: compRes.reason || null,
            details: compRes.details || null,
        };
        if (!compRes.compliant) {
            console.warn(`⚠️ [COMPLIANCE WARNING] Pipeline failed interpretation compliance: ${compRes.reason}`);
        }
    }

    // 8. Safety validation & Scope enforcement
    let pipelineCheck;

    if (evalOpts.disableSafetyGuard) {
        pipelineCheck = { safe: true, pipeline: llmResult.pipeline };
        safetyInfo = { code: null, reason: null };
    } else {
        const tValStart = hrNow();
        const collectionCheck = validateCollectionName(llmResult.collection);
        if (!collectionCheck.safe) {
            validateMs = toMs(tValStart);
            safetyInfo = { code: 'safety_violation', reason: collectionCheck.reason };
            return {
                type: 'safety_blocked',
                data: buildOutcomePayload({
                    success: false,
                    error: { code: 'safety_violation', message: collectionCheck.reason },
                    naturalLanguage: query,
                    aiMessage: collectionCheck.reason,
                    explanation: llmResult.explanation,
                    safetyStatus: 'approval-required',
                    safetyBlocked: true,
                    similarQueriesCount,
                    schemaContext,
                    scope: effectiveScope,
                }),
            };
        }

        pipelineCheck = validatePipeline(llmResult.pipeline, {
            allowedCollections: isRestrictedScope ? effectiveScope : null,
            targetCollection: llmResult.collection,
        });
        validateMs = toMs(tValStart);
        safetyInfo = { code: pipelineCheck.code || null, reason: pipelineCheck.reason || null };

        if (!pipelineCheck.safe) {
            // Missing collection / scope violation fallback
            if (pipelineCheck.code === 'scope_violation') {
                return {
                    type: 'success',
                    data: buildOutcomePayload({
                        success: true,
                        needsClarification: false,
                        naturalLanguage: query,
                        aiMessage: pipelineCheck.reason,
                        explanation: llmResult.explanation || pipelineCheck.reason,
                        pipeline: [],
                        mql: [],
                        collection: '',
                        chartType: 'table',
                        safetyStatus: 'scope-insufficient',
                        safetyBlocked: false,
                        suggestedCollections: pipelineCheck.violatingCollections || [],
                        scope: effectiveScope,
                        results: [],
                        result: [],
                        meta: {
                            resultCount: 0,
                            executionTimeMs: 0,
                            totalTimeMs: Date.now() - startTime,
                            similarQueriesCount,
                            confidenceScore: 0,
                            scope: effectiveScope,
                        },
                        schemaContext,
                    }),
                };
            }

            // Mutating write intercepted for human approval
            if (pipelineCheck.isWrite) {
                const approvalToken = jwt.sign(
                    {
                        jti: crypto.randomUUID(),
                        connectionId,
                        collection: llmResult.collection,
                        pipeline: llmResult.pipeline,
                        query,
                        scope: effectiveScope,
                        type: 'write-approval',
                    },
                    process.env.JWT_SECRET,
                    { expiresIn: '10m' }
                );

                const payloadData = buildOutcomePayload({
                    success: true,
                    naturalLanguage: query,
                    aiMessage: `⚠️ Database Write Intercepted: This action will modify your collection "${llmResult.collection}". To execute this change, review and approve it.`,
                    pipeline: llmResult.pipeline,
                    mql: llmResult.pipeline,
                    collection: llmResult.collection,
                    chartType: llmResult.chartType || 'table',
                    explanation: llmResult.explanation,
                    safetyStatus: 'approval-required',
                    safetyBlocked: false,
                    approvalToken,
                    scope: effectiveScope,
                    results: [],
                    result: [],
                    meta: {
                        resultCount: 0,
                        executionTimeMs: 0,
                        totalTimeMs: Date.now() - startTime,
                        similarQueriesCount,
                        confidenceScore: 100,
                        scope: effectiveScope,
                    },
                });

                return {
                    type: 'approval_required',
                    approvalToken,
                    data: payloadData,
                };
            }

            return {
                type: 'safety_blocked',
                data: buildOutcomePayload({
                    success: false,
                    error: { code: 'safety_violation', message: pipelineCheck.reason },
                    naturalLanguage: query,
                    aiMessage: pipelineCheck.reason,
                    pipeline: llmResult.pipeline,
                    mql: llmResult.pipeline,
                    explanation: llmResult.explanation,
                    safetyStatus: 'approval-required',
                    safetyBlocked: true,
                    similarQueriesCount,
                    schemaContext,
                    scope: effectiveScope,
                }),
            };
        }
    }

    // 9. Execute aggregation against USER DB
    const tDbStart = hrNow();
    const { results, executionTimeMs } = await executePipeline(
        userDb,
        llmResult.collection,
        pipelineCheck.pipeline
    );
    dbMs = toMs(tDbStart);

    // 10. Confidence score
    const CONFIDENCE_MAP = { 0: 60, 1: 75, 2: 85, 3: 92 };
    const confidenceScore = CONFIDENCE_MAP[Math.min(similarQueriesCount, 3)] || 92;

    if (sanitizedClarifications || bypassAmbiguity) {
        recordAmbiguityMetric('generation_after_clarification', { connectionId, source });
    }

    // 11. Save to query_history and few-shot examples
    saveQueryHistory({
        connectionId,
        naturalLanguage: query,
        clarifications: sanitizedClarifications || null,
        isEdit: Boolean(isEdit),
        generatedPipeline: pipelineCheck.pipeline,
        collection: llmResult.collection,
        chartType: llmResult.chartType,
        resultCount: results.length,
        confidenceScore,
        similarQueriesCount,
        schemaContext,
        results,
        scope: effectiveScope,
        source,
    });

    // Add example only when result is non-empty and memory writing is not disabled
    if (results && results.length > 0 && !evalOpts.disableMemoryWrite) {
        addExample({
            naturalLanguage: query,
            mqlPipeline: pipelineCheck.pipeline,
            collection: llmResult.collection,
            connectionId,
        });
    }

    const totalTimeMs = Date.now() - startTime;

    return {
        type: 'success',
        data: buildOutcomePayload({
            success: true,
            needsClarification: false,
            naturalLanguage: query,
            clarifications: sanitizedClarifications || null,
            aiMessage: llmResult.explanation || `Generated pipeline for "${llmResult.collection}" collection.`,
            explanation: llmResult.explanation,
            pipeline: pipelineCheck.pipeline,
            mql: pipelineCheck.pipeline,
            collection: llmResult.collection,
            chartType: llmResult.chartType,
            safetyStatus: 'read-only',
            safetyBlocked: false,
            results,
            result: results,
            executionTimeMs,
            confidenceScore,
            similarQueriesCount,
            schemaContext,
            scope: effectiveScope,
            meta: {
                resultCount: results.length,
                executionTimeMs,
                totalTimeMs,
                examplesUsed: similarQueriesCount,
                similarQueriesCount,
                confidenceScore,
                scope: effectiveScope,
            },
        }),
    };
}

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
        decoded = jwt.verify(approvalToken, process.env.JWT_SECRET);
    } catch (err) {
        throw new TokenExpiredError('Approval draft has expired or is invalid. Please resend query.');
    }

    if (decoded.type !== 'write-approval') {
        throw new ValidationError('Invalid token signature type', 'invalid_token');
    }

    const { connectionId: tokenConnectionId, collection, pipeline, query, jti, scope } = decoded;

    // Ownership verification
    if (tokenConnectionId !== connectionId) {
        throw new UnauthorizedTokenError('Access denied: token connectionId does not match current session');
    }

    // Safety verification: collection & pipeline
    const collectionCheck = validateCollectionName(collection);
    if (!collectionCheck.safe) {
        throw new SafetyViolationError(collectionCheck.reason, 'safety_violation');
    }

    const pipelineCheck = validatePipeline(pipeline, {
        allowedCollections: scope || null,
        targetCollection: collection,
    });

    if (!pipelineCheck.safe && !pipelineCheck.isWrite) {
        throw new SafetyViolationError(pipelineCheck.reason, 'safety_violation');
    }

    // Atomic single-use jti via unique index in central DB
    if (!jti) {
        throw new ValidationError('Token missing unique identifier (jti)', 'invalid_token');
    }

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

    // Get User DB (pooled connection)
    let userDb;
    try {
        userDb = await getUserDb(connectionId);
    } catch (err) {
        throw new ExecutionError(err.message || 'Failed to connect to user database');
    }

    // Run mutating aggregation pipeline directly on database collection
    let results, executionTimeMs;
    try {
        const execRes = await executePipeline(
            userDb,
            collection,
            pipelineCheck.pipeline || pipeline
        );
        results = execRes.results;
        executionTimeMs = execRes.executionTimeMs;
    } catch (err) {
        throw new ExecutionError(err.message || 'Failed to apply approved write transaction');
    }

    // Log transaction to central query history
    saveQueryHistory({
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
            aiMessage: `✅ Transaction Authorized: Successfully executed approved write/update operation on database collection "${collection}".`,
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
    QueryExecutionEngine,
    executeNaturalLanguageQuery: QueryExecutionEngine.executeNaturalLanguageQuery,
    executeApprovedWrite: QueryExecutionEngine.executeApprovedWrite,
    validateRequestedCollections,
    QueryEngineError,
    ValidationError,
    ScopeError,
    TokenExpiredError,
    UnauthorizedTokenError,
    TokenAlreadyUsedError,
    SafetyViolationError,
    ExecutionError,
    RateLimitError,
};

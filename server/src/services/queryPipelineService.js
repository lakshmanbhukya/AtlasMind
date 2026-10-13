const { formatMinifiedSchema, profileSchema } = require('./schemaProfiler');
const { getSimilarExamples, addExample } = require('./fewShotRetriever');
const { generateMQL } = require('./groqService');
const { validatePipeline, validateCollectionName } = require('./safetyGuard');
const { executePipeline, saveQueryHistory } = require('./queryExecutor');
const { getUserDb } = require('./userDbPool');
const {
    hasWriteIntent,
    checkDeterministicAmbiguity,
    analyzeAmbiguity,
    validateClarifications,
    buildEnrichedQuery,
    recordAmbiguityMetric,
} = require('./ambiguityGate');

const SYSTEM_COLLECTIONS = new Set([
    'few_shot_examples',
    'query_history',
    'dashboards',
    'user_connections',
    'workspaces',
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
                    message: `Unknown collection: "${name}"`,
                },
                effectiveScope: allUserCollections,
                allUserCollections,
            };
        }
    }

    // Filter to existing collections if dropMissing is enabled
    const filteredCollections = dropMissing
        ? collections.filter((c) => userCollSet.has(c))
        : collections;

    const effectiveScope = filteredCollections.length > 0
        ? Array.from(new Set(filteredCollections))
        : allUserCollections;

    return { valid: true, effectiveScope, allUserCollections };
}

/**
 * Shared natural language query execution pipeline.
 * Used by POST /api/query and POST /api/voice to guarantee consistent
 * validation, scoping, prompt enrichment, safety checks, and history logging.
 *
 * @param {object} params
 * @param {string} params.connectionId
 * @param {string} params.text
 * @param {string[]} [params.collections]
 * @param {string} [params.workspaceId]
 * @param {boolean} [params.dropMissing]
 * @param {string} [params.model]
 * @param {object[]} [params.clarifications]
 * @param {boolean} [params.bypassAmbiguity]
 * @param {boolean} [params.isEdit]
 * @param {number} [params.startTime]
 * @param {'query'|'voice'} [params.source='query']
 * @returns {Promise<{ statusCode: number, response: object }>}
 */
async function processNaturalLanguageQuery({
    connectionId,
    text,
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
}) {
    const query = text.trim();

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

    const wrapResponse = (statusCode, payload) => {
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
            };
        }
        return { statusCode, response: payload };
    };

    // 1. Get User DB from pool
    const userDb = await getUserDb(connectionId);

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
        return wrapResponse(scopeCheck.error.status, {
            success: false,
            error: {
                code: scopeCheck.error.code,
                message: scopeCheck.error.message,
            },
        });
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
    const fewShotExamples = await getSimilarExamples(
        query,
        fewShotLimit,
        connectionId,
        isRestrictedScope ? effectiveScope : null
    );
    fewShotMs = toMs(tFewShotStart);

    // evalOptions.disableSchemaContext: blank out schema context
    const schemaContext = evalOpts.disableSchemaContext ? '' : formatMinifiedSchema(rawSchema);

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
            return wrapResponse(400, {
                success: false,
                error: {
                    code: 'validation_error',
                    message: 'Invalid clarification value provided.',
                },
            });
        }
        sanitizedClarifications = valResult.sanitized;
        queryForGeneration = buildEnrichedQuery(query, sanitizedClarifications);
        isClarificationPass = true;
        if (isEdit) {
            recordAmbiguityMetric('clarification_edit', { connectionId, source });
        } else {
            recordAmbiguityMetric('ambiguity_resolved', { connectionId, source });
        }
    } else if (bypassAmbiguity === true) {
        recordAmbiguityMetric('ambiguity_bypassed', { connectionId, source });
    } else if (!isWriteQuery && !evalOpts.disableGate) {
        try {
            const tGateStart = hrNow();
            const ambiguityAnalysis = analyzeAmbiguity(query, rawSchema);
            gateMs = toMs(tGateStart);

            gateInfo = {
                reason: ambiguityAnalysis.diagnostics.reason,
                matchedTerms: ambiguityAnalysis.diagnostics.matchedTerms,
            };

            if (ambiguityAnalysis.result && ambiguityAnalysis.result.needsClarification) {
                recordAmbiguityMetric('ambiguity_asked', { connectionId, source });
                return wrapResponse(200, {
                    success: true,
                    needsClarification: true,
                    naturalLanguage: query,
                    questions: ambiguityAnalysis.result.questions,
                    scope: effectiveScope,
                });
            }
        } catch (ambErr) {
            console.warn(`⚠️ Deterministic ambiguity gate error (${source}, failing open):`, ambErr.message);
        }
    }

    // 5. Generate MQL via Groq LLM
    const targetModel = evalOpts.model || model;
    const llmGenOptions = {
        isClarificationPass,
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
        recordAmbiguityMetric('ambiguity_asked', { connectionId, source });
        return wrapResponse(200, {
            success: true,
            needsClarification: true,
            naturalLanguage: query,
            questions: llmResult.questions,
            scope: effectiveScope,
        });
    }

    if (!sanitizedClarifications && !bypassAmbiguity) {
        recordAmbiguityMetric('ambiguity_skipped', { connectionId, source });
    }

    // 6. Check for LLM-signaled missing collections (scope-insufficient)
    if (Array.isArray(llmResult.missingCollections) && llmResult.missingCollections.length > 0) {
        return wrapResponse(200, {
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
        });
    }

    // 7. Handle AI fallback (no pipeline generated)
    if (!llmResult.pipeline || llmResult.pipeline.length === 0) {
        return wrapResponse(200, {
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
        });
    }

    // 8. Safety validation & Scope enforcement
    // WARNING: evalOptions.disableSafetyGuard runs unvalidated LLM pipelines on the real DB.
    // Evaluate with a read-only Mongo user when this flag is enabled.
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
            return wrapResponse(422, {
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
            });
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
                return wrapResponse(200, {
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
                });
            }

            // Mutating write intercepted for human approval
            if (pipelineCheck.isWrite) {
                const jwt = require('jsonwebtoken');
                const crypto = require('crypto');
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

                return wrapResponse(200, {
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
            }

            return wrapResponse(422, {
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
            });
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

    return wrapResponse(200, {
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
    });
}

module.exports = {
    processNaturalLanguageQuery,
    validateRequestedCollections,
};

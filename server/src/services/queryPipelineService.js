const { formatMinifiedSchema, profileSchema } = require('./schemaProfiler');
const { getSimilarExamples, addExample } = require('./fewShotRetriever');
const { generateMQL } = require('./groqService');
const { validatePipeline, validateCollectionName } = require('./safetyGuard');
const { executePipeline, saveQueryHistory } = require('./queryExecutor');
const { getUserDb } = require('./userDbPool');
const {
    hasWriteIntent,
    checkDeterministicAmbiguity,
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
}) {
    const query = text.trim();

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
        return {
            statusCode: scopeCheck.error.status,
            response: {
                success: false,
                error: {
                    code: scopeCheck.error.code,
                    message: scopeCheck.error.message,
                },
            },
        };
    }

    const { effectiveScope } = scopeCheck;
    const isRestrictedScope = Array.isArray(collections) && collections.length > 0;

    // 3. Profile schema + retrieve few-shot examples (scoped by connectionId and collections)
    const [rawSchema, fewShotExamples] = await Promise.all([
        profileSchema(userDb, {
            forceRefresh: false,
            connectionId,
            collections: effectiveScope,
        }),
        getSimilarExamples(query, 3, connectionId, isRestrictedScope ? effectiveScope : null),
    ]);
    const schemaContext = formatMinifiedSchema(rawSchema);

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
            return {
                statusCode: 400,
                response: {
                    success: false,
                    error: {
                        code: 'validation_error',
                        message: 'Invalid clarification value provided.',
                    },
                },
            };
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
    } else if (!isWriteQuery) {
        try {
            const deterministicCheck = checkDeterministicAmbiguity(query, rawSchema);
            if (deterministicCheck && deterministicCheck.needsClarification) {
                recordAmbiguityMetric('ambiguity_asked', { connectionId, source });
                return {
                    statusCode: 200,
                    response: {
                        success: true,
                        needsClarification: true,
                        naturalLanguage: query,
                        questions: deterministicCheck.questions,
                        scope: effectiveScope,
                    },
                };
            }
        } catch (ambErr) {
            console.warn(`⚠️ Deterministic ambiguity gate error (${source}, failing open):`, ambErr.message);
        }
    }

    // 5. Generate MQL via Groq LLM
    const llmResult = await generateMQL(
        queryForGeneration,
        schemaContext,
        fewShotExamples,
        model,
        {
            isClarificationPass,
            rawSchema,
            scopedCollections: isRestrictedScope ? effectiveScope : [],
        }
    );

    // If LLM determines query needs clarification
    if (llmResult.needsClarification === true && !isClarificationPass) {
        recordAmbiguityMetric('ambiguity_asked', { connectionId, source });
        return {
            statusCode: 200,
            response: {
                success: true,
                needsClarification: true,
                naturalLanguage: query,
                questions: llmResult.questions,
                scope: effectiveScope,
            },
        };
    }

    if (!sanitizedClarifications && !bypassAmbiguity) {
        recordAmbiguityMetric('ambiguity_skipped', { connectionId, source });
    }

    // 6. Check for LLM-signaled missing collections (scope-insufficient)
    if (Array.isArray(llmResult.missingCollections) && llmResult.missingCollections.length > 0) {
        return {
            statusCode: 200,
            response: {
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
            },
        };
    }

    // 7. Handle AI fallback (no pipeline generated)
    if (!llmResult.pipeline || llmResult.pipeline.length === 0) {
        return {
            statusCode: 200,
            response: {
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
            },
        };
    }

    // 8. Safety validation & Scope enforcement
    const collectionCheck = validateCollectionName(llmResult.collection);
    if (!collectionCheck.safe) {
        return {
            statusCode: 422,
            response: {
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
            },
        };
    }

    const pipelineCheck = validatePipeline(llmResult.pipeline, {
        allowedCollections: isRestrictedScope ? effectiveScope : null,
        targetCollection: llmResult.collection,
    });

    if (!pipelineCheck.safe) {
        // Missing collection / scope violation fallback
        if (pipelineCheck.code === 'scope_violation') {
            return {
                statusCode: 200,
                response: {
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
                },
            };
        }

        // Mutating write intercepted for human approval
        if (pipelineCheck.isWrite) {
            const jwt = require('jsonwebtoken');
            const approvalToken = jwt.sign(
                {
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

            return {
                statusCode: 200,
                response: {
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
                },
            };
        }

        return {
            statusCode: 422,
            response: {
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
            },
        };
    }

    // 9. Execute aggregation against USER DB
    const { results, executionTimeMs } = await executePipeline(
        userDb,
        llmResult.collection,
        pipelineCheck.pipeline
    );

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

    addExample({
        naturalLanguage: query,
        mqlPipeline: pipelineCheck.pipeline,
        collection: llmResult.collection,
        connectionId,
    });

    const totalTimeMs = Date.now() - startTime;

    return {
        statusCode: 200,
        response: {
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
        },
    };
}

module.exports = {
    processNaturalLanguageQuery,
    validateRequestedCollections,
};

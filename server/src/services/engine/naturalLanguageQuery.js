// @ts-check
/** Query engine: the natural-language flow (steps 1-11: scope, schema and few-shot context, ambiguity gate, generation, Safe Execution verdict, execution, history). */
'use strict';

/** @typedef {import('../queryExecutionEngine').QueryOutcome} QueryOutcome */

const { signApprovalToken, verifyApprovalToken, APPROVAL_TOKEN_TYPE } = require('../../auth/session');
const { formatMinifiedSchema, formatFieldNamesOnly, profileSchema } = require('../schemaProfiler');
const { getSimilarExamples, addExample } = require('../fewShotRetriever');
const { generateMQL } = require('../groqService');
const { describeWrite } = require('../safetyGuard');
const { executePipeline, classifyExecution, UnsafePipelineError } = require('../queryExecutor');
const queryHistoryStore = require('../../stores/queryHistoryStore');
const { getUserDb } = require('../userDbPool');
const ambiguityGate = require('../ambiguityGate');
const { verifyInterpretationCompliance } = require('../interpretationComplianceVerifier');
const { resolveExperiment } = require('../experiment');
const { resolve: resolveEffectiveScope } = require('../effectiveScope');
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
const { approvalExpiresAt, tenantDatabaseOf } = require('./shared');

/**
 * @param {Record<string, any>} params - normalized by normalizeParams
 * @returns {Promise<QueryOutcome>}
 */
async function runNaturalLanguageQuery(params) {
    const {
        connectionId,
        text,
        query: queryParam,
        collections,
        workspaceId,
        dropMissing,
        model,
        clarifications,
        bypassAmbiguity,
        isEdit,
        startTime = Date.now(),
        source = 'query',
        experiment: experimentInput,
        onProgress,
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

    // Research seam: only in-process callers can supply an ExperimentConfig.
    const evalOpts = resolveExperiment(experimentInput);
    const collectDiagnostics = Boolean(evalOpts.diagnostics);

    // Stage progress for streaming callers: scope, schema, ambiguity,
    // generating, safety, executing. Like `experiment`, it is passed in-process
    // by the route, never read from a request body. A throwing callback is
    // ignored, so it can never break a query.
    const progress = (stage) => {
        if (typeof onProgress !== 'function') return;
        try {
            onProgress(stage);
        } catch {
            // ignored by design
        }
    };

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
        if (collectDiagnostics) {
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

    /** @type {(questions: any[]) => QueryOutcome} */
    const clarificationOutcome = (questions) => ({
        type: 'clarification_required',
        data: buildOutcomePayload({
            success: true,
            needsClarification: true,
            naturalLanguage: query,
            questions,
            scope: effectiveScope,
        }),
    });

    // 1. Get User DB from pool (an experiment may supply its own)
    progress('scope');
    const userDb = evalOpts.db || await getUserDb(connectionId);

    // 2. Resolve the Effective Scope (explicit collections, else workspace, else all); fails closed
    const scope = await resolveEffectiveScope({
        userDb,
        connectionId,
        collections,
        workspaceId,
        dropMissing,
    });

    let effectiveScope = scope.collections;
    let isRestrictedScope = scope.restricted;

    // experiment.disableScope: override scoping to all user collections
    if (evalOpts.disableScope) {
        effectiveScope = scope.all;
        isRestrictedScope = false;
    }

    // 3. Profile schema + retrieve few-shot examples (scoped by connectionId and collections)
    progress('schema');
    const fewShotLimit = evalOpts.fewShotLimit !== undefined ? evalOpts.fewShotLimit : 3;

    const tSchemaStart = hrNow();
    const rawSchema = await profileSchema(userDb, {
        forceRefresh: false,
        connectionId,
        collections: effectiveScope,
        snapshot: evalOpts.schemaSnapshot,
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

    // experiment.disableSchemaContext: field names only without types, samples, or relationship hints
    const schemaContext = evalOpts.disableSchemaContext
        ? formatFieldNamesOnly(rawSchema)
        : formatMinifiedSchema(rawSchema);

    const similarQueriesCount = fewShotExamples.length;

    // 4. Ambiguity Gate: clarification validation, prompt enrichment, deterministic check
    progress('ambiguity');
    const gateContext = { connectionId, source };
    const gate = ambiguityGate.decide({
        query,
        schema: rawSchema,
        clarifications,
        bypass: bypassAmbiguity === true,
        isEdit: Boolean(isEdit),
        disabled: Boolean(evalOpts.disableGate),
        gateOptions: {
            mode: evalOpts.ambiguityMode,
            vagueTerms: evalOpts.vagueTerms,
            enableBindFix: !evalOpts.disableBindFix,
        },
        context: gateContext,
    });
    gateInfo = gate.diagnostics;
    gateMs = gate.gateMs;
    const sanitizedClarifications = gate.clarifications;

    if (gate.action === 'reject') {
        throw new ValidationError('Invalid clarification value provided.', 'validation_error');
    }
    if (gate.action === 'ask') {
        clarificationSource = 'gate';
        return clarificationOutcome(gate.questions);
    }

    // 5. Generate MQL via Groq LLM
    progress('generating');
    const targetModel = evalOpts.model || model;
    const llmGenOptions = {
        isClarificationPass: gate.isClarificationPass,
        allowWriteStage: gate.saveIntent === true,
        disableClarificationMode: Boolean(evalOpts.disableClarificationMode),
        forceFinalQueryMode: Boolean(evalOpts.forceFinalQueryMode),
        rawSchema,
        scopedCollections: isRestrictedScope ? effectiveScope : [],
        ...(evalOpts.temperature !== undefined ? { temperature: evalOpts.temperature } : {}),
        ...(evalOpts.llm ? { llm: evalOpts.llm } : {}),
    };

    const tLlmStart = hrNow();
    const llmResult = await generateMQL(
        gate.queryForGeneration,
        schemaContext,
        fewShotExamples,
        targetModel,
        llmGenOptions
    );
    llmMs = llmResult.timings?.llmMs !== undefined ? llmResult.timings.llmMs : toMs(tLlmStart);
    currentLlmResult = llmResult;

    // The LLM may ask for clarification; the gate only shows schema-valid questions
    const modelReview = ambiguityGate.reviewModelQuestions(gate, llmResult, rawSchema, gateContext);
    if (modelReview.action === 'ask') {
        clarificationSource = 'llm';
        return clarificationOutcome(modelReview.questions);
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
        const targetClarification = sanitizedClarifications.find((c) => typeof c.value === 'string' && c.value && c.value !== '__other__')
            || sanitizedClarifications.find((c) => typeof c.value === 'string')
            || null;
        const compRes = verifyInterpretationCompliance(llmResult.pipeline, targetClarification, query);
        complianceInfo = {
            checked: true,
            compliant: compRes.compliant,
            reason: compRes.reason || null,
            details: compRes.details || null,
        };
        if (!compRes.compliant) {
            log.warn({ reason: compRes.reason }, 'Pipeline failed interpretation compliance');
        }
    }

    // 8. Safe Execution verdict: one classification of (collection, pipeline, Effective Scope)
    progress('safety');
    let pipelineToRun;

    if (evalOpts.disableSafetyGuard) {
        pipelineToRun = llmResult.pipeline;
        safetyInfo = { code: null, reason: null };
    } else {
        const tValStart = hrNow();
        const verdict = classifyExecution({
            collection: llmResult.collection,
            pipeline: llmResult.pipeline,
            scope: isRestrictedScope ? effectiveScope : null,
            tenantDatabase: tenantDatabaseOf(userDb),
        });
        validateMs = toMs(tValStart);
        // Only blocked and scope_insufficient verdicts carry code/reason.
        const verdictInfo = /** @type {{ code?: string, reason?: string }} */ (verdict);
        safetyInfo = { code: verdictInfo.code || null, reason: verdictInfo.reason || null };

        if (verdict.kind === 'scope_insufficient') {
            return {
                type: 'success',
                data: buildOutcomePayload({
                    success: true,
                    needsClarification: false,
                    naturalLanguage: query,
                    aiMessage: verdict.reason,
                    explanation: llmResult.explanation || verdict.reason,
                    pipeline: [],
                    mql: [],
                    collection: '',
                    chartType: 'table',
                    safetyStatus: 'scope-insufficient',
                    safetyBlocked: false,
                    suggestedCollections: verdict.violatingCollections || [],
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

        // A write that is safe in every other respect: intercepted for human approval
        if (verdict.kind === 'needs_approval') {
            const approvalToken = signApprovalToken({
                connectionId,
                collection: llmResult.collection,
                pipeline: llmResult.pipeline,
                query,
                // Unrestricted scope is signed as null so the approve path classifies it the same way.
                scope: isRestrictedScope ? effectiveScope : null,
            });

            const payloadData = buildOutcomePayload({
                success: true,
                naturalLanguage: query,
                aiMessage: `⚠️ Database Write Intercepted: This action will write to your collection "${verdict.write?.targetCollection || llmResult.collection}". To execute this change, review and approve it.`,
                pipeline: llmResult.pipeline,
                mql: llmResult.pipeline,
                collection: llmResult.collection,
                chartType: llmResult.chartType || 'table',
                explanation: llmResult.explanation,
                safetyStatus: 'approval-required',
                safetyBlocked: false,
                approvalToken,
                approval: {
                    expiresAt: approvalExpiresAt(approvalToken),
                    ...describeWrite(llmResult.pipeline, llmResult.collection),
                },
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

        if (verdict.kind === 'blocked') {
            return {
                type: 'safety_blocked',
                data: buildOutcomePayload({
                    success: false,
                    error: { code: 'safety_violation', message: verdict.reason },
                    naturalLanguage: query,
                    aiMessage: verdict.reason,
                    explanation: llmResult.explanation,
                    pipeline: Array.isArray(llmResult.pipeline) ? llmResult.pipeline : [],
                    mql: Array.isArray(llmResult.pipeline) ? llmResult.pipeline : [],
                    collection: typeof llmResult.collection === 'string' ? llmResult.collection : '',
                    safetyStatus: 'blocked',
                    safetyBlocked: true,
                    safetyBlock: verdict.block ? { ...verdict.block, reason: verdict.reason } : null,
                    similarQueriesCount,
                    schemaContext,
                    scope: effectiveScope,
                }),
            };
        }

        pipelineToRun = verdict.pipeline;
    }

    // 9. Execute aggregation against USER DB
    progress('executing');
    const tDbStart = hrNow();
    const { results, executionTimeMs } = await executePipeline(
        userDb,
        llmResult.collection,
        pipelineToRun,
        {
            scope: isRestrictedScope ? effectiveScope : null,
            unsafeSkipGuard: Boolean(evalOpts.disableSafetyGuard),
        }
    );
    dbMs = toMs(tDbStart);

    // 10. Confidence score
    const CONFIDENCE_MAP = { 0: 60, 1: 75, 2: 85, 3: 92 };
    const confidenceScore = CONFIDENCE_MAP[Math.min(similarQueriesCount, 3)] || 92;

    ambiguityGate.recordGeneration(gate, gateContext);

    // 11. Save to query_history and few-shot examples
    queryHistoryStore.record({
        connectionId,
        naturalLanguage: query,
        clarifications: sanitizedClarifications || null,
        isEdit: Boolean(isEdit),
        generatedPipeline: pipelineToRun,
        collection: llmResult.collection,
        chartType: llmResult.chartType,
        explanation: llmResult.explanation || '',
        executionTimeMs,
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
            mqlPipeline: pipelineToRun,
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
            pipeline: pipelineToRun,
            mql: pipelineToRun,
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

module.exports = {
    runNaturalLanguageQuery,
};

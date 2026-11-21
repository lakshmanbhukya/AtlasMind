// @ts-check
/** Ambiguity Gate: decide, reviewModelQuestions and recordGeneration (the gate's interface). */

const log = require('../../utils/logger').logger.child({ module: 'ambiguityGate' });
const { recordAmbiguityMetric } = require('./metrics');
const { hasWriteIntent } = require('./vagueTerms');
const { buildEnrichedQuery, validateClarifications, validateModelClarification } = require('./clarifications');
const { analyzeAmbiguity } = require('./analysis');

// ---------------------------------------------------------------------------
// Interface: the three calls the QueryExecutionEngine makes
// ---------------------------------------------------------------------------

/**
 * Decide, before MQL generation, whether to ask the user a clarification.
 *
 * Owns the whole pre-generation gate: write-intent bypass, user bypass,
 * clarification validation (prompt-injection allowlist) and prompt
 * enrichment, the deterministic ambiguity check, and its metrics.
 *
 * @param {object} input
 * @param {string} input.query
 * @param {object} input.schema - raw profileSchema() result
 * @param {Array<{ id: string, value: string, customText?: string }>|null} [input.clarifications]
 * @param {boolean} [input.bypass=false] - user chose "run anyway"
 * @param {boolean} [input.isEdit=false] - clarification edited after results
 * @param {boolean} [input.disabled=false] - skip the deterministic check (experiments)
 * @param {Record<string, any>} [input.gateOptions] - { mode, vagueTerms, enableBindFix } for analyzeAmbiguity
 * @param {{ connectionId?: string, source?: string }} [input.context] - metric labels
 * @returns {GateDecision}
 *
 * @typedef {Record<string, any>} GateDecision
 * @property {'ask'|'proceed'|'reject'} action
 * @property {Array} [questions] - when action is 'ask'
 * @property {string[]} [errors] - when action is 'reject' (invalid clarifications)
 * @property {string} queryForGeneration - the query, enriched with validated clarifications
 * @property {Array|null} clarifications - sanitized clarifications, if any
 * @property {boolean} isClarificationPass - the LLM must not ask again
 * @property {boolean} bypassed
 * @property {{ reason: string|null, matchedTerms: string[] }} diagnostics
 * @property {number} gateMs - time spent in the deterministic check
 */
function decide({
    query,
    schema,
    clarifications = null,
    bypass = false,
    isEdit = false,
    disabled = false,
    gateOptions = {},
    context = {},
}) {
    recordAmbiguityMetric('query_evaluated', context);

    const isWriteQuery = hasWriteIntent(query);
    const decision = {
        action: 'proceed',
        queryForGeneration: query,
        clarifications: null,
        isClarificationPass: bypass === true || isWriteQuery,
        bypassed: false,
        diagnostics: { reason: null, matchedTerms: [] },
        gateMs: 0,
    };

    if (clarifications !== undefined && clarifications !== null) {
        const validation = validateClarifications(clarifications, schema);
        if (!validation.valid) {
            return { ...decision, action: 'reject', errors: validation.errors };
        }
        recordAmbiguityMetric(isEdit ? 'clarification_edit' : 'ambiguity_resolved', context);
        return {
            ...decision,
            queryForGeneration: buildEnrichedQuery(query, validation.sanitized),
            clarifications: validation.sanitized,
            isClarificationPass: true,
            diagnostics: { reason: 'clarified', matchedTerms: [] },
        };
    }

    if (bypass === true) {
        recordAmbiguityMetric('ambiguity_bypassed', context);
        return { ...decision, bypassed: true, diagnostics: { reason: 'bypassed', matchedTerms: [] } };
    }

    if (isWriteQuery) {
        return { ...decision, diagnostics: { reason: 'write_intent', matchedTerms: [] } };
    }

    if (disabled) {
        return { ...decision, diagnostics: { reason: 'gate_disabled', matchedTerms: [] } };
    }

    try {
        const start = process.hrtime.bigint();
        const analysis = analyzeAmbiguity(query, schema, gateOptions);
        const gateMs = Number(process.hrtime.bigint() - start) / 1e6;
        const diagnostics = {
            reason: analysis.diagnostics.reason,
            matchedTerms: analysis.diagnostics.matchedTerms,
        };

        if (analysis.result && analysis.result.needsClarification) {
            recordAmbiguityMetric('ambiguity_asked', context);
            return { ...decision, action: 'ask', questions: analysis.result.questions, diagnostics, gateMs };
        }
        return { ...decision, diagnostics, gateMs };
    } catch (err) {
        // Fail open: a gate bug must not block the query
        log.warn({ err, source: context.source || 'query' }, 'Deterministic ambiguity gate error, failing open');
        return decision;
    }
}

/**
 * After generation: decide whether a clarification the LLM asked for is
 * shown to the user. LLM questions are only shown when they pass
 * validateModelClarification (options must be real schema fields); otherwise
 * the gate proceeds rather than show invented options.
 *
 * @param {GateDecision} decision - from decide()
 * @param {{ needsClarification?: boolean, questions?: Array }} llmResult
 * @param {Record<string, any>} schema
 * @param {{ connectionId?: string, source?: string }} [context]
 * @returns {{ action: 'ask', questions: Array } | { action: 'proceed' }}
 */
function reviewModelQuestions(decision, llmResult, schema, context = {}) {
    if (llmResult && llmResult.needsClarification === true && !decision.isClarificationPass) {
        const review = validateModelClarification(llmResult.questions, schema);
        if (review.valid) {
            recordAmbiguityMetric('ambiguity_asked', context);
            return { action: 'ask', questions: review.questions };
        }
        log.warn({ reason: review.reason }, 'Discarded LLM clarification');
    }

    if (!decision.clarifications && !decision.bypassed) {
        recordAmbiguityMetric('ambiguity_skipped', context);
    }
    return { action: 'proceed' };
}

/** After a pipeline ran: count generations that followed a clarification or bypass. */
function recordGeneration(decision, context = {}) {
    if (decision.clarifications || decision.bypassed) {
        recordAmbiguityMetric('generation_after_clarification', context);
    }
}

module.exports = {
    decide,
    recordGeneration,
    reviewModelQuestions,
};

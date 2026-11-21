// @ts-check
/**
 * Ambiguity Gate for AtlasMind.
 * Detects ambiguous NL queries and generates structured clarification questions
 * grounded in the actual database schema.
 *
 * Flow:
 *  1. checkDeterministicAmbiguity() — fast, schema-aware, no LLM call needed.
 *  2. If ambiguous → return clarification payload to client.
 *  3. Client re-submits with clarifications[] + bypassAmbiguity:true.
 *  4. validateClarifications() — sanitize user answers against schema field names.
 *  5. buildEnrichedQuery() — merge original query + answers into enriched prompt.
 *  6. Pass enriched query to LLM with isClarificationPass:true.
 */

const { DEFAULT_VAGUE_TERMS, IDIOMATIC_COLLOCATIONS, extractNumericFields, hasWriteIntent, hasSaveIntent, toLabel } = require('./ambiguity/vagueTerms');
const { analyzeAmbiguity, checkDeterministicAmbiguity, detectHyphenatedCompound, detectInlineProximityBinding, queryAlreadyNamesSpecificField } = require('./ambiguity/analysis');
const { buildEnrichedQuery, validateClarifications, validateModelClarification } = require('./ambiguity/clarifications');
const { getAmbiguityMetrics, recordAmbiguityMetric, resetAmbiguityMetrics } = require('./ambiguity/metrics');
const { decide, recordGeneration, reviewModelQuestions } = require('./ambiguity/decide');

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Building blocks of the gate. Exposed for the gate's own unit tests and for
 * offline evaluation; production callers use decide / reviewModelQuestions /
 * recordGeneration.
 */
const internals = {
    hasWriteIntent,
    hasSaveIntent,
    checkDeterministicAmbiguity,
    analyzeAmbiguity,
    validateModelClarification,
    validateClarifications,
    buildEnrichedQuery,
    recordAmbiguityMetric,
    getAmbiguityMetrics,
    resetAmbiguityMetrics,
    DEFAULT_VAGUE_TERMS,
    extractNumericFields,
    toLabel,
    detectInlineProximityBinding,
    detectHyphenatedCompound,
    queryAlreadyNamesSpecificField,
    IDIOMATIC_COLLOCATIONS,
};

module.exports = {
    decide,
    reviewModelQuestions,
    recordGeneration,
    getAmbiguityMetrics,
    resetAmbiguityMetrics,
    DEFAULT_VAGUE_TERMS,
    internals,
};

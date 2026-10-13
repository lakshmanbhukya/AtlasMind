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

const { isMetricCandidate } = require('./schemaProfiler');

const AMBIGUITY_MODE = process.env.AMBIGUITY_MODE || 'hybrid';

// ---------------------------------------------------------------------------
// Term Sets
// ---------------------------------------------------------------------------

/**
 * Default vague terms that MAY indicate ambiguity when multiple metrics exist in schema.
 * @type {Set<string>}
 */
const DEFAULT_VAGUE_TERMS = new Set([
    'top', 'best', 'highest', 'lowest', 'largest', 'smallest',
    'most', 'least', 'popular', 'performance', 'sales', 'revenue',
    'growth', 'worst', 'biggest',
]);

/**
 * Active vague terms set. In EVAL_MODE, can be overridden via EVAL_VAGUE_TERMS env var.
 * @type {Set<string>}
 */
const VAGUE_TERMS = (process.env.EVAL_MODE === '1' && process.env.EVAL_VAGUE_TERMS)
    ? new Set(process.env.EVAL_VAGUE_TERMS.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))
    : new Set(DEFAULT_VAGUE_TERMS);

/**
 * Write-intent patterns — skip the ambiguity gate entirely for these.
 * The safety guard handles write intent downstream.
 * Uses word-boundary regular expressions so substring matches
 * (e.g. "dataset", "company addresses", "created accounts", "stock exchange", "dropout")
 * do not falsely trigger write intent, while real write operations do.
 * @type {RegExp[]}
 */
const WRITE_INTENT_PATTERNS = [
    /\b(?:delete|remove|truncate|modify|insert|replace|upsert)\b/i,
    /\bdrop\b/i,
    /\bupdate\b/i,
    /\b(?:add|create)\s+(?:new|an?|the)?\s*\w+/i,
    /^(?:add|create)\b/i,
    /\bchange\s+(?:the|an?|all)?\s*\w+\s*(?:to|=)/i,
    /\bset\s+[\w.]+\s*=/i,
    /\bset\s+[\w.]+\s*(?:to|=)\b/i,
    /\$set\b/i,
];

/**
 * Explicit qualifier phrases where a word like "top" is already qualified by a clear metric.
 * @type {RegExp[]}
 */
const EXPLICIT_QUALIFIER_PATTERNS = [
    /\btop\s+rated\b/i,
    /\bhighest\s+rated\b/i,
    /\blowest\s+rated\b/i,
    /\bmost\s+voted\b/i,
];

// ---------------------------------------------------------------------------
// Lightweight Instrumentation / Metrics
// ---------------------------------------------------------------------------

const metricsStore = {
    totalQueriesEvaluated: 0,
    ambiguity_asked: 0,
    ambiguity_skipped: 0,
    ambiguity_resolved: 0,
    ambiguity_bypassed: 0,
    clarification_edit: 0,
    generation_after_clarification: 0,
};

/**
 * Record an ambiguity lifecycle metric event without logging sensitive query text.
 *
 * @param {'ambiguity_asked'|'ambiguity_skipped'|'ambiguity_resolved'|'ambiguity_bypassed'|'clarification_edit'|'generation_after_clarification'|'query_evaluated'} event
 * @param {object} [meta]
 */
function recordAmbiguityMetric(event, meta = {}) {
    if (event === 'query_evaluated') {
        metricsStore.totalQueriesEvaluated += 1;
        return;
    }
    if (Object.prototype.hasOwnProperty.call(metricsStore, event)) {
        metricsStore[event] += 1;
    }
    console.log('[AMBIGUITY_METRIC]', {
        event,
        connectionId: meta.connectionId || 'anonymous',
        source: meta.source || 'query',
        timestamp: new Date().toISOString(),
    });
}

/**
 * Retrieve current ambiguity metrics and derived rates.
 * @returns {object}
 */
function getAmbiguityMetrics() {
    const total = Math.max(metricsStore.totalQueriesEvaluated, metricsStore.ambiguity_asked + metricsStore.ambiguity_skipped, 1);
    const asked = Math.max(metricsStore.ambiguity_asked, 1);
    const resolved = Math.max(metricsStore.ambiguity_resolved, 1);

    return {
        counts: { ...metricsStore },
        rates: {
            askRate: Number((metricsStore.ambiguity_asked / total).toFixed(4)),
            skipRate: Number((metricsStore.ambiguity_bypassed / asked).toFixed(4)),
            resolutionRate: Number((metricsStore.ambiguity_resolved / asked).toFixed(4)),
            editAfterResultRate: Number((metricsStore.clarification_edit / resolved).toFixed(4)),
            successfulExecutionRateAfterClarification: Number(
                (metricsStore.generation_after_clarification / Math.max(metricsStore.ambiguity_resolved + metricsStore.ambiguity_bypassed, 1)).toFixed(4)
            ),
        },
    };
}

/**
 * Reset metrics counters (primarily for testing).
 */
function resetAmbiguityMetrics() {
    metricsStore.totalQueriesEvaluated = 0;
    metricsStore.ambiguity_asked = 0;
    metricsStore.ambiguity_skipped = 0;
    metricsStore.ambiguity_resolved = 0;
    metricsStore.ambiguity_bypassed = 0;
    metricsStore.clarification_edit = 0;
    metricsStore.generation_after_clarification = 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if query contains write intent — skip clarification for these.
 *
 * @param {string} queryText
 * @returns {boolean}
 */
function hasWriteIntent(queryText) {
    if (!queryText || typeof queryText !== 'string') return false;
    return WRITE_INTENT_PATTERNS.some((pattern) => pattern.test(queryText));
}

/**
 * Convert a raw field_name (snake_case, camelCase, dot-notation) to a
 * human-readable Label Format.
 *
 * @param {string} fieldName
 * @returns {string}
 */
function toLabel(fieldName) {
    return String(fieldName || '')
        .replace(/[_.\[\]]/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/**
 * Extract numeric fields from a schema profiler result object.
 * Only top-level fields and first-level array sub-fields are considered.
 *
 * @param {object} schemaObject - Result of profileSchema()
 * @returns {Array<{ collection: string, field: string, label: string }>}
 */
function extractNumericFields(schemaObject) {
    const fields = [];
    if (!schemaObject?.collections) return fields;

    for (const col of schemaObject.collections) {
        for (const field of col.fields || []) {
            if (!isMetricCandidate(field.name)) continue;

            const isNumeric =
                ['number', 'decimal', 'int', 'double', 'float'].includes(field.type) ||
                typeof field.sample === 'number';

            if (isNumeric) {
                fields.push({
                    collection: col.name,
                    field: field.name,
                    label: toLabel(field.name),
                });
            }
        }
    }

    return fields;
}

/**
 * Check if the user query already explicitly specifies one of the exact schema fields
 * (e.g., "top 10 orders by sales_amount" or "sum of order_total").
 * Whole-token matching is applied for compound names (camelCase, snake_case, dot-path).
 * Plain names require "by <field>".
 *
 * @param {string} lowerQuery
 * @param {Array<{ field: string, label: string }>} numericFields
 * @returns {boolean}
 */
function queryAlreadyNamesSpecificField(lowerQuery, numericFields) {
    if (EXPLICIT_QUALIFIER_PATTERNS.some((re) => re.test(lowerQuery))) {
        return true;
    }

    for (const nf of numericFields) {
        const rawField = nf.field.toLowerCase();
        const originalField = nf.field;
        const labelLower = nf.label.toLowerCase();

        // Check if the field is compound (snake_case, dot-path, or camelCase)
        const isCompound =
            originalField.includes('_') ||
            originalField.includes('.') ||
            (/[a-z]/.test(originalField) && /[A-Z]/.test(originalField));

        if (isCompound) {
            const escaped = rawField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const tokenRe = new RegExp(`(?<![a-z0-9_])${escaped}(?![a-z0-9_])`);
            if (tokenRe.test(lowerQuery)) {
                return true;
            }
        }

        // "by <field>" / "by <label>" applies to all fields
        if (
            lowerQuery.includes(`by ${rawField}`) ||
            lowerQuery.includes(`by ${labelLower}`)
        ) {
            return true;
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Analyze query ambiguity and return both result and diagnostics.
 *
 * @param {string} queryText
 * @param {object} schemaObject
 * @returns {{ result: object|null, diagnostics: { matchedTerms: string[], numericCandidateCount: number, explicitBindingFound: boolean, reason: 'no_vague_term'|'lt2_numeric'|'explicit_binding'|'write_intent'|'asked' } }}
 */
function analyzeAmbiguity(queryText, schemaObject) {
    const diagnostics = {
        matchedTerms: [],
        numericCandidateCount: 0,
        explicitBindingFound: false,
        reason: 'no_vague_term',
    };

    if (AMBIGUITY_MODE === 'off' || AMBIGUITY_MODE === 'llm') {
        return { result: null, diagnostics };
    }

    if (!queryText || typeof queryText !== 'string') {
        return { result: null, diagnostics };
    }
    const lower = queryText.toLowerCase();

    if (hasWriteIntent(lower)) {
        diagnostics.reason = 'write_intent';
        return { result: null, diagnostics };
    }

    const numericFields = extractNumericFields(schemaObject);
    diagnostics.numericCandidateCount = numericFields.length;

    if (numericFields.length < 2) {
        diagnostics.reason = 'lt2_numeric';
        return { result: null, diagnostics };
    }

    const words = lower.replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(Boolean);
    const matchedTerms = words.filter((word) => VAGUE_TERMS.has(word));
    diagnostics.matchedTerms = matchedTerms;

    if (matchedTerms.length === 0) {
        diagnostics.reason = 'no_vague_term';
        return { result: null, diagnostics };
    }

    if (queryAlreadyNamesSpecificField(lower, numericFields)) {
        diagnostics.explicitBindingFound = true;
        diagnostics.reason = 'explicit_binding';
        return { result: null, diagnostics };
    }

    diagnostics.reason = 'asked';

    const topFields = numericFields.slice(0, 4);
    const options = topFields.map((f, i) => ({
        value: f.field,
        label: f.label,
        collection: f.collection,
        ...(i === 0 ? { recommended: true } : {}),
    }));
    options.push({ value: '__other__', label: 'Other (type it)' });

    const result = {
        needsClarification: true,
        questions: [
            {
                id: 'metric',
                question: 'Which metric best represents what you mean by this query?',
                type: 'single',
                options,
            },
        ],
        diagnostics,
    };

    return { result, diagnostics };
}

/**
 * Deterministic ambiguity check: does this query + schema produce ambiguity?
 * Returns a clarification payload when ambiguous, or null when the query is clear.
 *
 * This runs entirely in-process (no LLM call) and is very fast.
 *
 * @param {string} queryText - The raw NL query string
 * @param {object} schemaObject - The raw profileSchema() result (NOT the minified string)
 * @returns {object|null} - Clarification payload or null
 */
function checkDeterministicAmbiguity(queryText, schemaObject) {
    const analysis = analyzeAmbiguity(queryText, schemaObject);
    return analysis.result;
}

/**
 * Validate an LLM-returned clarification questions array against structural rules
 * and the actual database schema (fail-open safety).
 *
 * Rules enforced:
 *  - 1 to 3 questions maximum
 *  - Each question has id, question, and 2–4 real options (+ optional __other__)
 *  - Option values (other than __other__) must exist in schemaObject when schema fields exist
 *
 * @param {Array} questions
 * @param {object|null} schemaObject
 * @returns {{ valid: boolean, questions: Array, reason?: string }}
 */
function validateModelClarification(questions, schemaObject = null) {
    if (!Array.isArray(questions) || questions.length === 0) {
        return { valid: false, questions: [], reason: 'questions must be a non-empty array' };
    }

    if (questions.length > 3) {
        return { valid: false, questions: [], reason: 'too many clarification questions (max 3)' };
    }

    const allFieldNames = new Set();
    if (schemaObject?.collections) {
        for (const col of schemaObject.collections) {
            for (const field of col.fields || []) {
                allFieldNames.add(field.name);
            }
        }
    }

    const normalizedQuestions = [];

    for (const q of questions) {
        if (!q || typeof q.id !== 'string' || typeof q.question !== 'string' || !Array.isArray(q.options)) {
            return { valid: false, questions: [], reason: 'malformed question structure' };
        }

        const realOptions = q.options.filter((o) => o && typeof o.value === 'string' && o.value !== '__other__');
        if (realOptions.length < 2 || realOptions.length > 4) {
            return { valid: false, questions: [], reason: 'each question must have between 2 and 4 schema options' };
        }

        // Verify all option values exist in schema if schema has fields
        if (allFieldNames.size > 0) {
            for (const opt of realOptions) {
                if (!allFieldNames.has(opt.value)) {
                    return {
                        valid: false,
                        questions: [],
                        reason: `invented schema field "${opt.value}" in clarification options`,
                    };
                }
            }
        }

        const sanitizedOptions = realOptions.map((opt, idx) => ({
            value: opt.value,
            label: typeof opt.label === 'string' && opt.label.trim() ? opt.label.trim() : toLabel(opt.value),
            ...(opt.recommended || idx === 0 ? { recommended: Boolean(opt.recommended || idx === 0) } : {}),
        }));

        // Ensure at least one option is marked recommended
        if (!sanitizedOptions.some((o) => o.recommended)) {
            sanitizedOptions[0].recommended = true;
        }

        sanitizedOptions.push({ value: '__other__', label: 'Other (type it)' });

        normalizedQuestions.push({
            id: q.id,
            question: q.question,
            type: q.type === 'multiple' || q.type === 'multi' ? 'multiple' : 'single',
            options: sanitizedOptions,
        });
    }

    return { valid: true, questions: normalizedQuestions };
}

/**
 * Validate incoming clarification answers against the live schema and offered options.
 * Rejects prompt-injection attempts by requiring all values (including custom "Other" text)
 * to resolve to real schema field names, and rejects values not in offered options when provided.
 *
 * @param {Array<{ id: string, value: string, customText?: string }>} clarifications
 * @param {object} schemaObject - The raw profileSchema() result
 * @param {Array<object>|object} [offeredQuestions=null] - Optional list of offered questions/options
 * @returns {{ valid: boolean, sanitized: Array, errors: string[] }}
 */
function validateClarifications(clarifications, schemaObject, offeredQuestions = null) {
    if (!Array.isArray(clarifications) || clarifications.length === 0) {
        return { valid: false, sanitized: [], errors: ['clarifications must be a non-empty array'] };
    }

    let questionsList = null;
    if (offeredQuestions) {
        questionsList = Array.isArray(offeredQuestions)
            ? offeredQuestions
            : (Array.isArray(offeredQuestions.questions) ? offeredQuestions.questions : null);
    }

    // Build lookup maps of known schema field names and their human labels
    const allFieldNames = new Set();
    const labelToFieldMap = new Map();
    if (schemaObject?.collections) {
        for (const col of schemaObject.collections) {
            for (const field of col.fields || []) {
                allFieldNames.add(field.name);
                labelToFieldMap.set(field.name.toLowerCase(), field.name);
                labelToFieldMap.set(toLabel(field.name).toLowerCase(), field.name);
            }
        }
    }

    const sanitized = [];
    const errors = [];

    for (const c of clarifications) {
        // Structural check
        if (!c || typeof c.id !== 'string' || typeof c.value !== 'string') {
            errors.push(`Invalid clarification entry: ${JSON.stringify(c)}`);
            continue;
        }

        const cleanId = c.id.trim().replace(/[^a-zA-Z0-9_-]/g, '');
        if (!cleanId) {
            errors.push('Invalid clarification id');
            continue;
        }

        const rawValue = c.value.trim();

        // Handle __other__ escape hatch: if customText is provided, validate customText against schema
        if (rawValue === '__other__') {
            const custom = typeof c.customText === 'string' ? c.customText.trim() : '';
            if (!custom) {
                sanitized.push({ id: cleanId, value: '__other__', customText: '' });
                continue;
            }
            const resolvedCustom = allFieldNames.has(custom)
                ? custom
                : labelToFieldMap.get(custom.toLowerCase());
            if (!resolvedCustom) {
                errors.push(`Custom clarification value "${custom}" is not a valid schema field`);
                continue;
            }
            sanitized.push({ id: cleanId, value: resolvedCustom });
            continue;
        }

        // When offered options are provided, reject values that were not offered
        if (questionsList) {
            const targetQ = questionsList.find((q) => q && q.id === cleanId);
            if (targetQ && Array.isArray(targetQ.options)) {
                const offeredValues = new Set(
                    targetQ.options
                        .map((opt) => opt && opt.value)
                        .filter((v) => v && v !== '__other__')
                );
                const offeredLabels = new Set(
                    targetQ.options
                        .map((opt) => opt && opt.label && opt.label.toLowerCase())
                        .filter(Boolean)
                );
                const matchesValue = offeredValues.has(rawValue);
                const matchesLabel = offeredLabels.has(rawValue.toLowerCase());
                if (!matchesValue && !matchesLabel) {
                    errors.push(`Clarification value "${rawValue}" was not among the offered options for question "${cleanId}"`);
                    continue;
                }
            }
        }

        // Strict allowlist: value MUST match an exact schema field name or its human-readable label
        const resolvedField = allFieldNames.has(rawValue)
            ? rawValue
            : labelToFieldMap.get(rawValue.toLowerCase());

        if (!resolvedField) {
            errors.push(`Clarification value "${rawValue}" is not a valid schema field`);
            continue;
        }

        sanitized.push({ id: cleanId, value: resolvedField });
    }

    return {
        valid: errors.length === 0,
        sanitized,
        errors,
    };
}

/**
 * Build an enriched query string from the original query + sanitized clarifications.
 * Only schema-approved field values are injected — __other__ entries are excluded.
 *
 * The resulting string is safe to pass to the LLM as the user message.
 *
 * @param {string} originalQuery
 * @param {Array<{ id: string, value: string, customText?: string }>} sanitizedClarifications
 * @returns {string}
 */
function buildEnrichedQuery(originalQuery, sanitizedClarifications) {
    if (!sanitizedClarifications || sanitizedClarifications.length === 0) {
        return originalQuery;
    }

    const clarificationLines = sanitizedClarifications
        .filter((c) => c.value && c.value !== '__other__')
        .map((c) => `${c.id}:\n${c.value}`);

    if (clarificationLines.length === 0) return originalQuery;

    return `${originalQuery}\n\nValidated user clarification:\n\n${clarificationLines.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    hasWriteIntent,
    checkDeterministicAmbiguity,
    analyzeAmbiguity,
    validateModelClarification,
    validateClarifications,
    buildEnrichedQuery,
    recordAmbiguityMetric,
    getAmbiguityMetrics,
    resetAmbiguityMetrics,
    DEFAULT_VAGUE_TERMS,
    VAGUE_TERMS,
    // Exposed for testing
    extractNumericFields,
    toLabel,
};

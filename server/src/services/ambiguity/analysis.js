// @ts-check
/** Ambiguity Gate: the deterministic detectors and analyzeAmbiguity / checkDeterministicAmbiguity. */

const { IDIOMATIC_COLLOCATIONS, extractNumericFields, getFieldMetadata, hasWriteIntent, toVagueTermSet } = require('./vagueTerms');

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

// Synonyms and stems for common schema metrics
const METRIC_SYNONYM_MAP = {
    expensive: 'price',
    inexpensive: 'price',
    priced: 'price',
    cost: 'price',
    costs: 'price',
    costly: 'price',
    runtime: 'runtime',
    duration: 'runtime',
    votes: 'votes',
    vote: 'votes',
    voted: 'votes',
    rating: 'rating',
    ratings: 'rating',
    rated: 'rating',
    awards: 'awards',
    award: 'awards',
    wins: 'wins',
    win: 'wins',
    nominations: 'nominations',
    nomination: 'nominations',
    comments: 'comments',
    comment: 'comments',
    quantity: 'quantity',
    amount: 'amount',
    total: 'amount',
    price: 'amount',
    value: 'amount',
    units: 'amount',
    unit: 'amount',
    count: 'transaction_count',
    events: 'transaction_count',
    fresh: 'fresh',
    rotten: 'rotten',
    meter: 'meter',
    reviews: 'reviews',
    review: 'reviews'
};

function detectHyphenatedCompound(lowerQuery, numericFields) {
    const hyphenRe = /\b(top|best|highest|lowest|most|least|worst|largest|smallest|biggest|greatest)\s*-\s*(\w+)\b/gi;
    let m;

    const { fieldFragments } = getFieldMetadata(numericFields);

    while ((m = hyphenRe.exec(lowerQuery)) !== null) {
        const fragment = m[2].toLowerCase();
        if (fieldFragments.has(fragment)) return true;
        for (const ff of fieldFragments) {
            if (ff.startsWith(fragment) || fragment.startsWith(ff)) return true;
        }
        if ((fragment === 'priced' || fragment === 'pricing') && fieldFragments.has('price')) return true;
        if ((fragment === 'rated' || fragment === 'rating') && fieldFragments.has('rating')) return true;
    }
    return false;
}

function detectInlineProximityBinding(lowerQuery, matchedTriggers, numericFields, delta = 3) {
    if (!matchedTriggers || !matchedTriggers.length || !numericFields || !numericFields.length) return false;

    const { leaves, spacedNames, fieldFragments, fullFields } = getFieldMetadata(numericFields);

    for (const [syn, mappedLeaf] of Object.entries(METRIC_SYNONYM_MAP)) {
        if (leaves.has(mappedLeaf) || fieldFragments.has(mappedLeaf) || fullFields.has(mappedLeaf)) {
            fieldFragments.add(syn);
        }
    }

    const tokens = lowerQuery.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);

    for (let i = 0; i < tokens.length; i++) {
        if (!matchedTriggers.includes(tokens[i])) continue;

        const start = Math.max(0, i - delta);
        const end = Math.min(i + delta, tokens.length - 1);

        for (let j = start; j <= end; j++) {
            if (i === j) continue;
            const tok = tokens[j];
            if (fieldFragments.has(tok)) {
                if (tok === 'rating' || tok === 'ratings' || tok === 'rated') {
                    const hasMultipleRatings = spacedNames.some((s) => s.field.includes('imdb.rating')) &&
                                              spacedNames.some((s) => s.field.includes('tomatoes'));
                    if (hasMultipleRatings) {
                        const hasQualifier = /imdb|rotten|tomatoes|critic|viewer/.test(lowerQuery);
                        if (!hasQualifier) continue;
                    }
                }
                return true;
            }
        }
    }

    return false;
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
function queryAlreadyNamesSpecificField(lowerQuery, numericFields, enableBindFix = false) {
    if (EXPLICIT_QUALIFIER_PATTERNS.some((re) => re.test(lowerQuery))) {
        return true;
    }

    const bindFixActive = Boolean(enableBindFix);

    // Explicit bound or comparison operator with numeric constants
    const hasNumericBound = bindFixActive && (
        /\b(?:priced\s+at|rating\s+of|aged|score\s+of|runtime\s+of|quantity\s+of)\s+\d+(?:\.\d+)?\b/i.test(lowerQuery) ||
        /\b\d+(?:\.\d+)?\s*(?:years\s+old|minutes|mins|stars|reviews|votes|items|dollars)\b/i.test(lowerQuery) ||
        /\b(?:greater\s+than|more\s+than|less\s+than|fewer\s+than|at\s+least|at\s+most|above|below|over|under)\s+\d+(?:\.\d+)?\b/i.test(lowerQuery) ||
        /\b[><=]\s*\d+(?:\.\d+)?\b/.test(lowerQuery)
    );

    for (const nf of numericFields) {
        const rawField = nf.field.toLowerCase();
        const originalField = nf.field;
        const labelLower = nf.label.toLowerCase();

        // Check if the field is compound (snake_case, dot-path, or camelCase)
        const isCompound =
            originalField.includes("_") ||
            originalField.includes(".") ||
            (/[a-z]/.test(originalField) && /[A-Z]/.test(originalField));

        if (isCompound) {
            const escaped = rawField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const tokenRe = new RegExp("(?<![a-z0-9_])" + escaped + "(?![a-z0-9_])");
            if (tokenRe.test(lowerQuery)) {
                return true;
            }

            if (bindFixActive) {
                const spaced = originalField.replace(/[_.]/g, " ").toLowerCase();
                const spacedEscaped = spaced.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                if (new RegExp("(?<![a-z0-9])" + spacedEscaped + "(?![a-z0-9])").test(lowerQuery)) {
                    return true;
                }

                // Reversed two-part order: e.g. "rotten tomatoes" for "tomatoes.rotten"
                const parts = originalField.split(/[._]/).map((p) => p.toLowerCase());
                if (parts.length === 2) {
                    const reversed = parts[1] + " " + parts[0];
                    if (lowerQuery.includes(reversed)) {
                        return true;
                    }
                }
            }
        }

        // "by <field>" / "by <label>" applies to all fields
        if (
            lowerQuery.includes("by " + rawField) ||
            lowerQuery.includes("by " + labelLower)
        ) {
            return true;
        }

        if (bindFixActive) {
            const leaf = originalField.split(/[._\[\]]/).filter(Boolean).pop()?.toLowerCase();
            const spaced = originalField.replace(/[_.\[\]]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

            if (
                lowerQuery.includes("by " + spaced) ||
                lowerQuery.includes("ordered by " + spaced) ||
                lowerQuery.includes("sorted by " + spaced) ||
                lowerQuery.includes("ranked by " + spaced) ||
                (leaf && leaf.length >= 3 && (
                    lowerQuery.includes("by " + leaf) ||
                    lowerQuery.includes("ordered by " + leaf) ||
                    lowerQuery.includes("sorted by " + leaf) ||
                    lowerQuery.includes("ranked by " + leaf)
                ))
            ) {
                return true;
            }

            const singularSpaced = spaced.replace(/\b([a-z]+)s\b/g, '$1');
            if (
                lowerQuery.includes("by " + singularSpaced) ||
                lowerQuery.includes("ordered by " + singularSpaced) ||
                lowerQuery.includes("sorted by " + singularSpaced) ||
                lowerQuery.includes("ranked by " + singularSpaced)
            ) {
                return true;
            }

            // Leaf with quantifier or metric descriptor
            if (leaf.length >= 3 && (
                lowerQuery.includes(leaf + " count") ||
                lowerQuery.includes(leaf + " purchased") ||
                lowerQuery.includes(leaf + " values") ||
                lowerQuery.includes(leaf + " rating")
            )) {
                return true;
            }

            // If explicit bound is present and leaf/field is named in query
            if (hasNumericBound && leaf && leaf.length >= 3) {
                if (lowerQuery.includes(leaf) ||
                    (leaf === "price" && lowerQuery.includes("priced")) ||
                    (leaf === "age" && lowerQuery.includes("aged"))) {
                    return true;
                }
            }
        }
    }

    if (bindFixActive) {
        const { leaves, fullFields } = getFieldMetadata(numericFields);
        if (leaves.has('amount')) {
            if (lowerQuery.includes('by total') || lowerQuery.includes('by value') ||
                lowerQuery.includes('by price') || lowerQuery.includes('by unit price')) {
                return true;
            }
        }
        if (leaves.has('transaction_count') || fullFields.has('transaction_count')) {
            if (lowerQuery.includes('transaction events') || lowerQuery.includes('transactions count') ||
                lowerQuery.includes('number of transaction')) {
                return true;
            }
        }
    }

    return false;
}

// Core API
// ---------------------------------------------------------------------------

/**
 * Why the deterministic check did (or did not) ask.
 * @typedef {{ matchedTerms: string[], numericCandidateCount: number, explicitBindingFound: boolean, reason: 'no_vague_term'|'lt2_numeric'|'explicit_binding'|'write_intent'|'asked' }} AmbiguityDiagnostics
 */

/**
 * Analyze query ambiguity and return both result and diagnostics.
 *
 * @param {string} queryText
 * @param {Record<string, any>} schemaObject
 * @param {object} [gateOptions]
 * @param {'hybrid'|'deterministic'|'llm'|'off'} [gateOptions.mode='hybrid'] 'off'/'llm' skip the deterministic gate
 * @param {Iterable<string>} [gateOptions.vagueTerms] Override DEFAULT_VAGUE_TERMS
 * @param {boolean} [gateOptions.enableBindFix=true]
 * @returns {{ result: Record<string, any>|null, diagnostics: AmbiguityDiagnostics }}
 */
function analyzeAmbiguity(queryText, schemaObject, gateOptions = {}) {
    const bindFixActive = gateOptions.enableBindFix !== false;
    const mode = gateOptions.mode || 'hybrid';
    const vagueTerms = toVagueTermSet(gateOptions.vagueTerms);
    /** @type {AmbiguityDiagnostics} */
    const diagnostics = {
        matchedTerms: [],
        numericCandidateCount: 0,
        explicitBindingFound: false,
        reason: 'no_vague_term',
    };

    if (mode === 'off' || mode === 'llm') {
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
    let matchedTerms = words.filter((word) => vagueTerms.has(word));

    // Strip idiomatic non-metric collocations
    for (const idiomRe of IDIOMATIC_COLLOCATIONS) {
        const m = lower.match(idiomRe);
        if (m) {
            const idiomTokens = m[0].replace(/[^a-z0-9]/g, ' ').split(/\s+/);
            matchedTerms = matchedTerms.filter((t) => !idiomTokens.includes(t));
        }
    }

    diagnostics.matchedTerms = matchedTerms;

    if (matchedTerms.length === 0) {
        diagnostics.reason = 'no_vague_term';
        return { result: null, diagnostics };
    }

    const isExplicitlyBound =
        queryAlreadyNamesSpecificField(lower, numericFields, bindFixActive) ||
        detectInlineProximityBinding(lower, matchedTerms, numericFields, 3) ||
        detectHyphenatedCompound(lower, numericFields);

    if (isExplicitlyBound) {
        diagnostics.explicitBindingFound = true;
        diagnostics.reason = 'explicit_binding';
        return { result: null, diagnostics };
    }

    diagnostics.reason = 'asked';

    const topFields = numericFields.slice(0, 4);
    /** @type {Array<{ value: string, label: string, collection?: string, recommended?: boolean }>} */
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
 * @param {Record<string, any>} schemaObject - The raw profileSchema() result (NOT the minified string)
 * @returns {Record<string, any>|null} - Clarification payload or null
 */
function checkDeterministicAmbiguity(queryText, schemaObject) {
    const analysis = analyzeAmbiguity(queryText, schemaObject);
    return analysis.result;
}

module.exports = {
    analyzeAmbiguity,
    checkDeterministicAmbiguity,
    detectHyphenatedCompound,
    detectInlineProximityBinding,
    queryAlreadyNamesSpecificField,
};

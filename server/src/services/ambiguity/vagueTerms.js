// @ts-check
/** Ambiguity Gate: vague-term lists, write intent, and schema field helpers (labels, numeric fields, field metadata). */

const { isMetricCandidate } = require('../schemaProfiler');

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

function toVagueTermSet(terms) {
    if (!terms) return DEFAULT_VAGUE_TERMS;
    return new Set(Array.from(terms, (t) => String(t).trim().toLowerCase()).filter(Boolean));
}

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
 * Non-metric idiomatic collocations that should NEVER trigger the gate.
 * Strip the trigger token from matchedTerms when these patterns appear.
 * @type {RegExp[]}
 */
const IDIOMATIC_COLLOCATIONS = [
    /\bat\s+least\s+(one|a|an|\d)/i,
    /\bat\s+most\s+(one|a|an|\d)/i,
    /\bmost\s+of\s+(the|them|these|those)\b/i,
    /\bbest\s+of\s+(luck|wishes|all)\b/i,
    /\bsales\s+(location|rep|store|person|channel|district)\b/i,
];

// Non-metric container / entity words to ignore as field fragments
const CONTAINER_WORDS = new Set(['items', 'transactions', 'accounts', 'movies', 'customers', 'sales']);

function getFieldMetadata(numericFields) {
    const leaves = new Set();
    const spacedNames = [];
    const fieldFragments = new Set();
    const fullFields = new Set();

    for (const nf of numericFields) {
        const raw = nf.field.toLowerCase();
        fullFields.add(raw);
        const leaf = nf.field.split(/[._\[\]]/).filter(Boolean).pop()?.toLowerCase();
        if (leaf && leaf.length >= 3 && !CONTAINER_WORDS.has(leaf)) {
            leaves.add(leaf);
            fieldFragments.add(leaf);
        }

        const parts = nf.field.split(/[._\[\]]/).filter(Boolean).map((p) => p.toLowerCase());
        for (const p of parts) {
            if (p.length >= 3 && !CONTAINER_WORDS.has(p)) {
                fieldFragments.add(p);
            }
        }

        const spaced = nf.field.replace(/[._\[\]]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        spacedNames.push({ spaced, leaf, field: nf.field, label: nf.label.toLowerCase() });

        for (const tok of nf.label.toLowerCase().split(/\s+/)) {
            if (tok.length >= 3 && !CONTAINER_WORDS.has(tok)) {
                fieldFragments.add(tok);
            }
        }
    }

    return { leaves, spacedNames, fieldFragments, fullFields };
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
 * @param {Record<string, any>} schemaObject - Result of profileSchema()
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

module.exports = {
    DEFAULT_VAGUE_TERMS,
    IDIOMATIC_COLLOCATIONS,
    extractNumericFields,
    getFieldMetadata,
    hasWriteIntent,
    toLabel,
    toVagueTermSet,
};

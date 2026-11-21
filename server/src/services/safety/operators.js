// @ts-check
/** Safety Guard: stage allow/block lists, blocked and hard-denied operators, and the operator finders. */

// Analytical stages permitted for read-only aggregation execution
// Note: $set (alias for $addFields) and $unset (projection exclusion) operate
// as in-memory document reshaping stages in aggregation pipelines and are permitted.
const ALLOWED_STAGES = new Set([
    '$match',
    '$group',
    '$sort',
    '$limit',
    '$skip',
    '$project',
    '$unwind',
    '$addFields',
    '$set',
    '$unset',
    '$count',
    '$lookup',
    '$facet',
    '$bucket',
    '$bucketAuto',
    '$sortByCount',
    '$replaceRoot',
    '$replaceWith',
    '$unionWith',
    '$graphLookup',
]);

// Stages that persistently write or mutate database data on disk
const BLOCKED_STAGES = new Set([
    '$out',
    '$merge',
    '$delete',
    '$drop',
    '$update',
    // NOTE: $set and $unset are read-only reshaping stages in aggregation pipelines and are intentionally permitted
    // NOTE: $replaceRoot and $replaceWith are read-only and are intentionally NOT blocked
]);

// Keys that should never appear anywhere in the pipeline
const BLOCKED_OPERATORS = [
    '$deleteMany',
    '$deleteOne',
    '$updateMany',
    '$updateOne',
    '$insertOne',
    '$insertMany',
    '$dropDatabase',
    '$dropCollection',
];

// Operators that allow arbitrary code execution in MongoDB.
// These are strictly forbidden and NEVER approvable (no isWrite flag).
const HARD_DENY_OPERATORS = new Set([
    '$function',
    '$accumulator',
    '$where',
]);

/**
 * Recursively check for hard-denied code execution operators.
 * @param {*} obj
 * @returns {string|null}
 */
function findHardDenyOperator(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return null;

    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            const found = findHardDenyOperator(obj[i]);
            if (found) return found;
        }
        return null;
    }

    for (const [key, value] of Object.entries(obj)) {
        if (HARD_DENY_OPERATORS.has(key)) return key;
        const nested = findHardDenyOperator(value);
        if (nested) return nested;
    }

    return null;
}

/**
 * Recursively check an object for blocked operators.
 * @param {*} obj
 * @returns {string|null} The blocked operator found, or null
 */
function findBlockedOperator(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return null;

    for (const key of Object.keys(obj)) {
        if (BLOCKED_OPERATORS.includes(key)) return key;

        const nested = findBlockedOperator(obj[key]);
        if (nested) return nested;
    }

    return null;
}

module.exports = {
    ALLOWED_STAGES,
    BLOCKED_STAGES,
    findBlockedOperator,
    findHardDenyOperator,
};

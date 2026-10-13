/**
 * Safety Guard — validates generated MQL pipelines before execution.
 *
 * Blocks destructive write operations ($out, $merge, $delete, $drop, $set for writes).
 * Injects a result limit if none is present.
 *
 * NOTE: $replaceRoot and $replaceWith are intentionally ALLOWED — they are
 * read-only reshaping stages, not write operations.
 */

// Analytical stages permitted for read-only aggregation execution
const ALLOWED_STAGES = new Set([
    '$match',
    '$group',
    '$sort',
    '$limit',
    '$skip',
    '$project',
    '$unwind',
    '$addFields',
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

// Stages that can write or mutate data
const BLOCKED_STAGES = new Set([
    '$out',
    '$merge',
    '$delete',
    '$drop',
    '$update',
    '$set',             // $set at top-level can mutate; we block it as a stage
    '$unset',           // $unset as a stage removes fields permanently
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

const MAX_RESULT_LIMIT = 1000;

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

/**
 * Recursively find collections referenced in pipeline stages.
 * @param {Array} stages
 * @returns {string[]}
 */
function findReferencedCollections(stages) {
    if (!Array.isArray(stages)) return [];
    const referenced = [];

    for (const stage of stages) {
        if (!stage || typeof stage !== 'object') continue;

        if (stage.$lookup) {
            if (typeof stage.$lookup.from === 'string') {
                referenced.push(stage.$lookup.from);
            }
            if (Array.isArray(stage.$lookup.pipeline)) {
                referenced.push(...findReferencedCollections(stage.$lookup.pipeline));
            }
        }

        if (stage.$unionWith) {
            if (typeof stage.$unionWith === 'string') {
                referenced.push(stage.$unionWith);
            } else if (typeof stage.$unionWith === 'object' && stage.$unionWith !== null) {
                if (typeof stage.$unionWith.coll === 'string') {
                    referenced.push(stage.$unionWith.coll);
                }
                if (Array.isArray(stage.$unionWith.pipeline)) {
                    referenced.push(...findReferencedCollections(stage.$unionWith.pipeline));
                }
            }
        }

        if (stage.$graphLookup) {
            if (typeof stage.$graphLookup.from === 'string') {
                referenced.push(stage.$graphLookup.from);
            }
        }

        if (stage.$facet && typeof stage.$facet === 'object') {
            for (const facetPipeline of Object.values(stage.$facet)) {
                if (Array.isArray(facetPipeline)) {
                    referenced.push(...findReferencedCollections(facetPipeline));
                }
            }
        }
    }

    return referenced;
}

/**
 * Validate an aggregation pipeline for safety.
 *
 * @param {object[]} pipeline - The MongoDB aggregation pipeline
 * @param {object} [options={}] - Validation options (allowedCollections, targetCollection)
 * @returns {{ safe: boolean, reason?: string, pipeline: object[], code?: string, violatingCollections?: string[] }}
 *   Returns the (potentially modified) pipeline with a $limit injected if needed.
 */
function validatePipeline(pipeline, options = {}) {
    if (!Array.isArray(pipeline)) {
        return { safe: false, reason: 'Pipeline must be an array', pipeline: [] };
    }

    if (pipeline.length === 0) {
        return { safe: false, reason: 'Pipeline is empty', pipeline: [] };
    }

    if (pipeline.length > 20) {
        return { safe: false, reason: 'Pipeline has too many stages (max 20)', pipeline };
    }

    // Check for hard-denied code execution operators ($function, $accumulator, $where)
    // NOTE: Returns safe: false WITHOUT isWrite: true, so this cannot be staged or approved.
    const hardDenyOp = findHardDenyOperator(pipeline);
    if (hardDenyOp) {
        return {
            safe: false,
            code: 'hard_blocked_operator',
            reason: `Arbitrary code execution operator "${hardDenyOp}" is strictly forbidden.`,
            pipeline,
        };
    }

    const { allowedCollections, targetCollection } = options;
    if (allowedCollections !== undefined && allowedCollections !== null) {
        const allowedSet = allowedCollections instanceof Set ? allowedCollections : new Set(allowedCollections);

        if (targetCollection && !allowedSet.has(targetCollection)) {
            return {
                safe: false,
                code: 'scope_violation',
                violatingCollections: [targetCollection],
                reason: `Target collection "${targetCollection}" is outside the allowed scope`,
                pipeline,
            };
        }

        const referenced = findReferencedCollections(pipeline);
        const violating = referenced.filter((c) => !allowedSet.has(c));
        if (violating.length > 0) {
            const firstViolator = violating[0];
            return {
                safe: false,
                code: 'scope_violation',
                violatingCollections: Array.from(new Set(violating)),
                reason: `Collection "${firstViolator}" is outside the allowed scope`,
                pipeline,
            };
        }
    }

    // Check each stage for blocked operations
    for (let i = 0; i < pipeline.length; i++) {
        const stage = pipeline[i];
        const stageKeys = Object.keys(stage);

        for (const key of stageKeys) {
            if (BLOCKED_STAGES.has(key)) {
                return {
                    safe: false,
                    reason: `Blocked stage "${key}" found at position ${i}. Write operations are not permitted.`,
                    pipeline,
                    isWrite: true,
                };
            }
            if (!ALLOWED_STAGES.has(key)) {
                return {
                    safe: false,
                    reason: `Unrecognized or restricted pipeline stage "${key}" at position ${i}. Only standard analytical stages are permitted.`,
                    pipeline,
                };
            }
        }

        // Deep-check for blocked operators inside stage values
        const blockedOp = findBlockedOperator(stage);
        if (blockedOp) {
            return {
                safe: false,
                reason: `Blocked operator "${blockedOp}" found at stage ${i}. Mutating operations are not permitted.`,
                pipeline,
                isWrite: true,
            };
        }
    }

    // Check if a $limit stage exists — inject one if not
    const hasLimit = pipeline.some((stage) => '$limit' in stage);

    const safePipeline = hasLimit
        ? pipeline
        : [...pipeline, { $limit: MAX_RESULT_LIMIT }];

    return { safe: true, pipeline: safePipeline };
}

/**
 * Validate a collection name — must be a simple identifier.
 * @param {string} collectionName
 * @returns {{ safe: boolean, reason?: string }}
 */
function validateCollectionName(collectionName) {
    if (!collectionName || typeof collectionName !== 'string') {
        return { safe: false, reason: 'Collection name is required' };
    }

    // Only allow alphanumeric + underscores
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(collectionName)) {
        return { safe: false, reason: `Invalid collection name: "${collectionName}"` };
    }

    // Block system collections
    const blockedCollections = ['system', 'admin', 'local', 'config'];
    if (blockedCollections.some((blocked) => collectionName.startsWith(blocked))) {
        return { safe: false, reason: `Access to "${collectionName}" is not allowed` };
    }

    return { safe: true };
}

module.exports = { validatePipeline, validateCollectionName, MAX_RESULT_LIMIT, ALLOWED_STAGES, BLOCKED_STAGES };

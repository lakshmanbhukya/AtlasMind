/**
 * Safety Guard — validates generated MQL pipelines before execution.
 *
 * Blocks destructive write operations ($out, $merge, $delete, $drop, $set for writes).
 * Injects a result limit if none is present.
 *
 * NOTE: $replaceRoot and $replaceWith are intentionally ALLOWED — they are
 * read-only reshaping stages, not write operations.
 */

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

const MAX_RESULT_LIMIT = 1000;

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
 * Validate an aggregation pipeline for safety.
 *
 * @param {object[]} pipeline - The MongoDB aggregation pipeline
 * @returns {{ safe: boolean, reason?: string, pipeline: object[] }}
 *   Returns the (potentially modified) pipeline with a $limit injected if needed.
 */
function validatePipeline(pipeline) {
    if (!Array.isArray(pipeline)) {
        return { safe: false, reason: 'Pipeline must be an array', pipeline: [] };
    }

    if (pipeline.length === 0) {
        return { safe: false, reason: 'Pipeline is empty', pipeline: [] };
    }

    if (pipeline.length > 20) {
        return { safe: false, reason: 'Pipeline has too many stages (max 20)', pipeline };
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

module.exports = { validatePipeline, validateCollectionName, MAX_RESULT_LIMIT };

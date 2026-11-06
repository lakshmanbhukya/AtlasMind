const { normalizeBson } = require('../utils/normalizeBson');
const { validateCollectionName, validatePipeline } = require('./safetyGuard');

/**
 * Thrown when a pipeline fails the safety guard at execution time.
 * `isWrite` is true when the only problem is a write stage that was not approved.
 */
class UnsafePipelineError extends Error {
    constructor(reason, { code = 'safety_violation', isWrite = false } = {}) {
        super(reason);
        this.name = 'UnsafePipelineError';
        this.code = code;
        this.isWrite = isWrite;
    }
}

/**
 * Apply the safety guard to (collection, pipeline). Returns the pipeline to run
 * (the guard may append a $limit) or throws UnsafePipelineError.
 */
function guardPipeline(collectionName, pipeline, { scope = null, approvedWrite = false } = {}) {
    const collectionCheck = validateCollectionName(collectionName);
    if (!collectionCheck.safe) {
        throw new UnsafePipelineError(collectionCheck.reason);
    }

    const pipelineCheck = validatePipeline(pipeline, {
        allowedCollections: Array.isArray(scope) && scope.length > 0 ? scope : null,
        targetCollection: collectionName,
    });
    if (pipelineCheck.safe) return pipelineCheck.pipeline;
    if (pipelineCheck.isWrite && approvedWrite) return pipeline;

    throw new UnsafePipelineError(pipelineCheck.reason, {
        code: pipelineCheck.code || 'safety_violation',
        isWrite: Boolean(pipelineCheck.isWrite),
    });
}

/**
 * Execute an aggregation pipeline against a tenant collection.
 *
 * The safety guard ALWAYS runs here: callers cannot execute a pipeline that
 * fails validateCollectionName / validatePipeline, so a forgotten check at a
 * call site (e.g. dashboard refresh of a stored pipeline) cannot run $out,
 * $merge or $function against a user's database.
 *
 * @param {import('mongodb').Db} db - The user's database instance
 * @param {string} collectionName - Target collection name
 * @param {object[]} pipeline - The aggregation pipeline
 * @param {object} [options]
 * @param {string[]|null} [options.scope] - Effective Scope; references outside it are rejected
 * @param {boolean} [options.approvedWrite=false] - Permit write stages (only after Write Approval Token checks)
 * @param {boolean} [options.unsafeSkipGuard=false] - Offline evaluation only (ExperimentConfig.disableSafetyGuard)
 * @param {number} [options.maxTimeMS=30000] - Max execution time
 * @param {boolean} [options.allowDiskUse=true] - Allow disk use for large sorts
 * @returns {Promise<{ results: object[], executionTimeMs: number }>}
 * @throws {UnsafePipelineError}
 */
async function executePipeline(db, collectionName, pipeline, options = {}) {
    const {
        maxTimeMS = 30000,
        allowDiskUse = true,
        scope = null,
        approvedWrite = false,
        unsafeSkipGuard = false,
    } = options;

    const pipelineToRun = unsafeSkipGuard
        ? pipeline
        : guardPipeline(collectionName, pipeline, { scope, approvedWrite });

    const collection = db.collection(collectionName);

    const startTime = Date.now();

    const cursor = collection.aggregate(pipelineToRun, {
        maxTimeMS,
        allowDiskUse,
    });

    const rawResults = await cursor.toArray();
    const results = rawResults.map(normalizeBson);
    const executionTimeMs = Date.now() - startTime;

    return { results, executionTimeMs };
}

module.exports = {
    executePipeline,
    assertSafePipeline: guardPipeline,
    UnsafePipelineError,
};

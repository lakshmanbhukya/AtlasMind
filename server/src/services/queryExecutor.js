const { normalizeBson } = require('../utils/normalizeBson');
const { classifyExecution } = require('./safetyGuard');

/**
 * Thrown when a pipeline fails the safety guard at execution time.
 * `isWrite` is true when the only problem is an approvable write stage that was not approved.
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
 *
 * @param {string} collectionName
 * @param {object[]} pipeline
 * @param {object} [options]
 * @param {string[]|null} [options.scope] - Effective Scope (non-empty array = restricted)
 * @param {boolean} [options.approvedWrite=false] - Permit a `needs_approval` pipeline
 * @param {string|null} [options.tenantDatabase] - Connected database name; unknown blocks any explicit `db`
 */
function guardPipeline(collectionName, pipeline, { scope = null, approvedWrite = false, tenantDatabase = null } = {}) {
    const verdict = classifyExecution({ collection: collectionName, pipeline, scope, tenantDatabase });
    if (verdict.kind === 'runnable') return verdict.pipeline;
    if (verdict.kind === 'needs_approval') {
        if (approvedWrite) return verdict.pipeline;
        throw new UnsafePipelineError(
            `Write stage "${verdict.write.stage}" needs a Write Approval Token before it runs.`,
            { code: 'safety_violation', isWrite: true }
        );
    }
    throw new UnsafePipelineError(verdict.reason, { code: verdict.code || 'safety_violation' });
}

/**
 * Execute an aggregation pipeline against a tenant collection.
 *
 * The safety guard ALWAYS runs here (classifyExecution): callers cannot run a
 * pipeline whose verdict is not `runnable`, or `needs_approval` with
 * approvedWrite, so a forgotten check at a call site (e.g. dashboard refresh of
 * a stored pipeline) cannot run $out, $merge or $function against a user's
 * database. The tenant database name is read from `db.databaseName`.
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
        : guardPipeline(collectionName, pipeline, {
            scope,
            approvedWrite,
            tenantDatabase: (db && typeof db.databaseName === 'string') ? db.databaseName : null,
        });

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
    classifyExecution,
    assertSafePipeline: guardPipeline,
    UnsafePipelineError,
};

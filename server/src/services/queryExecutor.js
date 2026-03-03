const { getDb } = require('../db/connection');

/**
 * Execute a validated aggregation pipeline against a collection.
 *
 * @param {import('mongodb').Db} db - The user's database instance
 * @param {string} collectionName - Target collection name
 * @param {object[]} pipeline - The aggregation pipeline (already validated)
 * @param {object} [options]
 * @param {number} [options.maxTimeMS=30000] - Max execution time
 * @param {boolean} [options.allowDiskUse=true] - Allow disk use for large sorts
 * @returns {Promise<{ results: object[], executionTimeMs: number }>}
 */
async function executePipeline(db, collectionName, pipeline, options = {}) {
    const {
        maxTimeMS = 30000,
        allowDiskUse = true,
    } = options;

    const collection = db.collection(collectionName);

    const startTime = Date.now();

    const cursor = collection.aggregate(pipeline, {
        maxTimeMS,
        allowDiskUse,
    });

    const results = await cursor.toArray();
    const executionTimeMs = Date.now() - startTime;

    return { results, executionTimeMs };
}

/**
 * Save a query to the history collection for analytics and replay.
 *
 * @param {object} entry
 * @param {string} entry.naturalLanguage - Original user query
 * @param {object[]} entry.generatedPipeline - The MQL pipeline
 * @param {string} entry.collection - Target collection
 * @param {string} entry.chartType - Suggested chart type
 * @param {number} entry.resultCount - Number of results returned
 * @param {number} entry.executionTimeMs - How long the query took
 */
async function saveQueryHistory(entry) {
    try {
        const db = getDb();
        await db.collection('query_history').insertOne({
            ...entry,
            timestamp: new Date(),
        });
    } catch (error) {
        // Non-critical — log but don't throw
        console.warn('⚠️ Failed to save query history:', error.message);
    }
}

module.exports = { executePipeline, saveQueryHistory };

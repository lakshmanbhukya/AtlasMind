const dbConnection = require('../db/connection');

/**
 * Escape regular expression special characters in user input.
 *
 * @param {string} string
 * @returns {string}
 */
function escapeRegex(string) {
    if (!string || typeof string !== 'string') return '';
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build tenant and collection isolation filter for few-shot examples.
 *
 * @param {string|null} [connectionId]
 * @param {string[]|null} [collections]
 * @returns {object}
 */
function buildExampleFilter(connectionId, collections = null) {
    const tenantOr = connectionId
        ? {
            $or: [
                { connectionId },
                { connectionId: null },
                { connectionId: { $exists: false } },
            ],
        }
        : {
            $or: [
                { connectionId: null },
                { connectionId: { $exists: false } },
            ],
        };

    if (collections && Array.isArray(collections) && collections.length > 0) {
        return {
            $and: [
                { collection: { $in: collections } },
                tenantOr,
            ],
        };
    }

    return tenantOr;
}

/**
 * Retrieve similar NL→MQL examples for few-shot prompting (Few-Shot Memory).
 *
 * Every search path (Atlas Search, regex fallback, random sample) applies the
 * same tenant filter: the caller's own examples plus global seed examples,
 * never another tenant's. Without a connectionId only global seeds match.
 *
 * Primary: Atlas Search ($search) on natural_language
 * Fallback: Text regex matching on the natural_language field
 *
 * @param {string} queryText - The user's natural language query
 * @param {number} [limit=3] - Number of examples to return
 * @param {string|null} [connectionId=null] - Multi-tenant connection ID
 * @param {string[]|null} [collections=null] - Allowed collections scope
 * @returns {Promise<object[]>}
 */
async function getSimilarExamples(queryText, limit = 3, connectionId = null, collections = null) {
    let db;
    try {
        db = dbConnection.getDb();
    } catch {
        return [];
    }
    const collection = db.collection('few_shot_examples');

    // Check if the collection exists and has documents
    const count = await collection.estimatedDocumentCount();
    if (count === 0) {
        console.warn('⚠️ No few-shot examples found. Returning empty array.');
        return [];
    }

    const tenantFilter = buildExampleFilter(connectionId, collections);

    // Try Atlas Search first (requires a search index)
    try {
        const vectorResults = await attemptAtlasSearch(collection, queryText, limit, tenantFilter);
        if (vectorResults.length > 0) {
            return vectorResults;
        }
    } catch (error) {
        // Vector search index not configured — fall back to text matching
        console.warn('⚠️ Vector search unavailable, using text fallback:', error.message);
    }

    // Fallback: regex-based text matching
    return await textFallbackSearch(collection, queryText, limit, tenantFilter);
}

function sampleExamples(collection, limit, tenantFilter) {
    return collection
        .aggregate([
            { $match: tenantFilter },
            { $sample: { size: limit } },
            { $project: { _id: 0, embedding: 0 } },
        ])
        .toArray();
}

/**
 * Attempt Atlas Vector Search using $vectorSearch aggregation stage.
 * Requires a vector search index named "default" on the "embedding" field.
 *
 * @param {import('mongodb').Collection} collection
 * @param {string} queryText
 * @param {number} limit
 * @param {object} tenantFilter - from buildExampleFilter
 * @returns {Promise<object[]>}
 */
async function attemptAtlasSearch(collection, queryText, limit, tenantFilter) {
    // For vector search, we need an embedding of the query text.
    // In a production system, you'd call an embedding API here.
    // For now, we use Atlas Search text-based approach as a proxy.
    const pipeline = [
        {
            $search: {
                index: 'default',
                text: {
                    query: queryText,
                    path: 'natural_language',
                    fuzzy: { maxEdits: 1 },
                },
            },
        },
        { $match: tenantFilter },
        { $limit: limit },
        {
            $project: {
                _id: 0,
                natural_language: 1,
                mql_pipeline: 1,
                collection: 1,
                tags: 1,
                score: { $meta: 'searchScore' },
            },
        },
    ];

    return await collection.aggregate(pipeline).toArray();
}

/**
 * Fallback: simple text matching using regex on keywords.
 *
 * @param {import('mongodb').Collection} collection
 * @param {string} queryText
 * @param {number} limit
 * @param {object} tenantFilter - from buildExampleFilter
 * @returns {Promise<object[]>}
 */
async function textFallbackSearch(collection, queryText, limit, tenantFilter) {
    // Extract significant keywords (remove stopwords)
    const stopwords = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
        'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
        'would', 'could', 'should', 'may', 'might', 'shall', 'can',
        'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
        'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my',
        'your', 'his', 'its', 'our', 'their', 'what', 'which', 'who',
        'whom', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
        'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
        'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
        'just', 'because', 'as', 'until', 'while', 'of', 'at', 'by',
        'for', 'with', 'about', 'against', 'between', 'through',
        'during', 'before', 'after', 'above', 'below', 'to', 'from',
        'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
        'again', 'further', 'then', 'once', 'and', 'but', 'or',
        'nor', 'if', 'show', 'me', 'get', 'find', 'list', 'give',
        'tell', 'display', 'many', 'much',
    ]);

    const keywords = queryText
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((word) => word.length > 2 && !stopwords.has(word));

    if (keywords.length === 0) {
        // Return random examples if no meaningful keywords
        return await sampleExamples(collection, limit, tenantFilter);
    }

    // Build a regex OR pattern from escaped keywords
    const regexPattern = keywords.map(escapeRegex).join('|');

    const searchQuery = {
        natural_language: { $regex: regexPattern, $options: 'i' },
        $and: tenantFilter.$and ? tenantFilter.$and : [tenantFilter],
    };

    const results = await collection
        .find(
            searchQuery,
            { projection: { _id: 0, embedding: 0 } }
        )
        .limit(limit)
        .toArray();

    // If regex finds nothing, return random samples
    if (results.length === 0) {
        return await sampleExamples(collection, limit, tenantFilter);
    }

    return results;
}

/**
 * Save a successful NL→MQL interaction as a few-shot example for future queries.
 * Examples are always stored under the caller's connectionId; without one,
 * nothing is stored (only the seeder writes global examples).
 * @param {object} param0
 * @param {string} param0.naturalLanguage
 * @param {object[]} param0.mqlPipeline
 * @param {string} param0.collection
 * @param {string} [param0.connectionId]
 */
async function addExample({ naturalLanguage, mqlPipeline, collection, connectionId }) {
    try {
        if (!connectionId) {
            console.warn('⚠️ Skipped saving memory example without a connectionId');
            return;
        }
        const db = dbConnection.getDb();
        const coll = db.collection('few_shot_examples');

        // Check if this query already exists for this tenant to avoid duplicates
        const exists = await coll.findOne({ natural_language: naturalLanguage, connectionId });
        if (exists) return;

        const doc = {
            natural_language: naturalLanguage,
            mql_pipeline: mqlPipeline,
            collection: collection,
            tags: ['user-generated'],
            timestamp: new Date(),
            connectionId,
        };

        await coll.insertOne(doc);
        if (process.env.NODE_ENV !== 'production') console.log('Saved new few-shot memory example');
    } catch (error) {
        console.error('❌ Failed to save memory example:', error.message);
    }
}

module.exports = { getSimilarExamples, addExample, escapeRegex, buildExampleFilter };

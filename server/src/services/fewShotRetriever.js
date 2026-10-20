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
 * Retrieve similar NL→MQL examples for few-shot prompting.
 *
 * Primary: Atlas Vector Search ($vectorSearch stage)
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

    // Try Atlas Vector Search first (requires a vector search index)
    try {
        const vectorResults = await attemptVectorSearch(collection, queryText, limit);
        if (vectorResults.length > 0) {
            return vectorResults;
        }
    } catch (error) {
        // Vector search index not configured — fall back to text matching
        console.warn('⚠️ Vector search unavailable, using text fallback:', error.message);
    }

    // Fallback: regex-based text matching
    return await textFallbackSearch(collection, queryText, limit, connectionId, collections);
}

/**
 * Attempt Atlas Vector Search using $vectorSearch aggregation stage.
 * Requires a vector search index named "default" on the "embedding" field.
 *
 * @param {import('mongodb').Collection} collection
 * @param {string} queryText
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function attemptVectorSearch(collection, queryText, limit) {
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
 * @param {string|null} [connectionId=null]
 * @param {string[]|null} [collections=null]
 * @returns {Promise<object[]>}
 */
async function textFallbackSearch(collection, queryText, limit, connectionId = null, collections = null) {
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
        return await collection
            .aggregate([
                { $sample: { size: limit } },
                { $project: { _id: 0, embedding: 0 } },
            ])
            .toArray();
    }

    // Build a regex OR pattern from escaped keywords
    const regexPattern = keywords.map(escapeRegex).join('|');
    const filter = buildExampleFilter(connectionId, collections);

    const searchQuery = {
        natural_language: { $regex: regexPattern, $options: 'i' },
        ...(connectionId ? { connectionId } : {}),
    };

    if (filter.$and) {
        searchQuery.$and = filter.$and;
    } else if (filter.$or) {
        searchQuery.$and = [filter];
    }

    const results = await collection
        .find(
            searchQuery,
            { projection: { _id: 0, embedding: 0 } }
        )
        .limit(limit)
        .toArray();

    // If regex finds nothing, return random samples
    if (results.length === 0) {
        return await collection
            .aggregate([
                { $sample: { size: limit } },
                { $project: { _id: 0, embedding: 0 } },
            ])
            .toArray();
    }

    return results;
}

/**
 * Save a successful NL→MQL interaction as a few-shot example for future queries.
 * @param {object} param0
 * @param {string} param0.naturalLanguage
 * @param {object[]} param0.mqlPipeline
 * @param {string} param0.collection
 * @param {string} [param0.connectionId]
 */
async function addExample({ naturalLanguage, mqlPipeline, collection, connectionId }) {
    try {
        const db = dbConnection.getDb();
        const coll = db.collection('few_shot_examples');

        // Check if this query already exists to avoid duplicates
        const existsQuery = { natural_language: naturalLanguage };
        if (connectionId) existsQuery.connectionId = connectionId;
        const exists = await coll.findOne(existsQuery);
        if (exists) return;

        const doc = {
            natural_language: naturalLanguage,
            mql_pipeline: mqlPipeline,
            collection: collection,
            tags: ['user-generated'],
            timestamp: new Date(),
        };
        if (connectionId) {
            doc.connectionId = connectionId;
        }

        await coll.insertOne(doc);
        console.log(`✅ Saved new memory example: "${naturalLanguage}"`);
    } catch (error) {
        console.error('❌ Failed to save memory example:', error.message);
    }
}

module.exports = { getSimilarExamples, addExample, escapeRegex, buildExampleFilter };

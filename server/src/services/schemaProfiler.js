const { getDb } = require('../db/connection');

// Collections to exclude from schema profiling (system/internal collections)
const SYSTEM_COLLECTIONS = new Set([
    'few_shot_examples',
    'query_history',
    'dashboards',
    'user_connections',  // AtlasMind internal — not user data
    'system.views',
]);

// Cache for schema results, keyed by db.databaseName
const schemaCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Infer the JavaScript type of a BSON value.
 * @param {*} value
 * @returns {string}
 */
function inferType(value) {
    if (value === null || value === undefined) return 'null';
    if (value instanceof Date) return 'date';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object' && value._bsontype === 'ObjectId') return 'objectId';
    if (typeof value === 'object' && value._bsontype === 'Decimal128') return 'decimal';
    return typeof value;
}

/**
 * Recursively extract sub-fields from an array of objects.
 * Returns fields in dot-notation: "items[].price", "items[].name", etc.
 *
 * @param {string} parentKey - e.g. "items"
 * @param {Array} arrayValue  - the actual array from the sampled document
 * @param {Map<string,object>} fieldMap - the shared fieldMap to insert into
 */
function extractArraySubFields(parentKey, arrayValue, fieldMap) {
    if (!Array.isArray(arrayValue) || arrayValue.length === 0) return;
    const firstElem = arrayValue[0];
    if (!firstElem || typeof firstElem !== 'object' || Array.isArray(firstElem)) return;

    for (const [subKey, subValue] of Object.entries(firstElem)) {
        const compositeKey = `${parentKey}[].${subKey}`;
        if (!fieldMap.has(compositeKey)) {
            fieldMap.set(compositeKey, {
                name: compositeKey,
                type: inferType(subValue),
                sample: subValue instanceof Date
                    ? subValue.toISOString()
                    : (typeof subValue === 'object' ? JSON.stringify(subValue).slice(0, 50) : subValue),
                // Mark as a nested array field so the LLM knows to $unwind the parent first
                isArrayItem: true,
                parentArray: parentKey,
            });
        }
    }
}

/**
 * Profile a single collection: count docs, sample fields with types.
 * @param {import('mongodb').Db} db
 * @param {string} collectionName
 * @returns {Promise<object>}
 */
async function profileCollection(db, collectionName) {
    const collection = db.collection(collectionName);

    // Get document count
    const documentCount = await collection.estimatedDocumentCount();

    // Sample a few documents to extract field names, types, and sample values
    const sampleDocs = await collection.aggregate([{ $sample: { size: 5 } }]).toArray();

    const fieldMap = new Map();

    for (const doc of sampleDocs) {
        for (const [key, value] of Object.entries(doc)) {
            if (key === '_id') continue; // Skip _id field

            if (!fieldMap.has(key)) {
                fieldMap.set(key, {
                    name: key,
                    type: inferType(value),
                    sample: value instanceof Date
                        ? value.toISOString()
                        : (typeof value === 'object' && !Array.isArray(value)
                            ? JSON.stringify(value).slice(0, 50)
                            : value),
                });
            }

            // Recurse into arrays of objects to expose sub-fields to the LLM
            if (Array.isArray(value) && value.length > 0) {
                extractArraySubFields(key, value, fieldMap);
            }
        }
    }

    // Truncate long sample values for prompt efficiency
    const fields = Array.from(fieldMap.values()).map((field) => ({
        ...field,
        sample: typeof field.sample === 'string' && field.sample.length > 60
            ? field.sample.substring(0, 60) + '...'
            : field.sample,
    }));

    return {
        name: collectionName,
        documentCount,
        fields,
        sampleDocumentCount: sampleDocs.length,
    };
}

/**
 * Profile the entire database — all user-facing collections.
 * Results are cached for 5 minutes.
 * @param {import('mongodb').Db} db
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh=false] Bypass the cache
 * @returns {Promise<object>}
 */
async function profileSchema(dbOrOptions, options = {}) {
    // Handle cases where db is omitted or just options are passed
    let db = dbOrOptions;
    let actualOptions = options;

    if (!db || typeof db.listCollections !== 'function') {
        actualOptions = db || {};
        db = getDb(); // Fetch global DB from connection helper
    }

    const now = Date.now();
    const dbName = db.databaseName;

    if (!actualOptions.forceRefresh && schemaCache.has(dbName)) {
        const cached = schemaCache.get(dbName);
        if (now - cached.timestamp < CACHE_TTL_MS) {
            return cached.schema;
        }
    }

    const collections = await db.listCollections().toArray();

    const userCollections = collections
        .map((c) => c.name)
        .filter((name) => !SYSTEM_COLLECTIONS.has(name) && !name.startsWith('system.'));

    const profiles = await Promise.all(
        userCollections.map((name) => profileCollection(db, name))
    );

    const schema = {
        database: db.databaseName,
        collections: profiles,
        profiledAt: new Date().toISOString(),
    };

    // Update cache
    schemaCache.set(dbName, { schema, timestamp: now });

    return schema;
}

/**
 * Build a minified schema string suitable for LLM prompts.
 * Includes nested array sub-fields so the LLM can generate $unwind + $group correctly.
 * @param {import('mongodb').Db} db
 * @returns {Promise<string>}
 */
async function getMinifiedSchema(db, options = {}) {
    const schema = await profileSchema(db, options);


    const lines = [`Database: ${schema.database}`];

    for (const col of schema.collections) {
        lines.push(`\nCollection: ${col.name} (${col.documentCount} docs)`);
        lines.push('Fields:');

        const topLevel = col.fields.filter((f) => !f.isArrayItem);
        const nested   = col.fields.filter((f) => f.isArrayItem);

        for (const field of topLevel) {
            const sampleStr = typeof field.sample === 'object'
                ? JSON.stringify(field.sample)
                : String(field.sample ?? '');
            lines.push(`  - ${field.name} (${field.type}) e.g. ${sampleStr}`);
        }

        if (nested.length > 0) {
            lines.push('  Array sub-fields (use $unwind on parent array before grouping):');
            for (const field of nested) {
                const sampleStr = typeof field.sample === 'object'
                    ? JSON.stringify(field.sample)
                    : String(field.sample ?? '');
                lines.push(`    - ${field.name} (${field.type}) e.g. ${sampleStr}`);
            }
        }
    }

    return lines.join('\n');
}

/**
 * Invalidate the schema cache (e.g., after seeding).
 * @param {string} [dbName] - If undefined, clears all.
 */
function invalidateSchemaCache(dbName) {
    if (dbName) {
        schemaCache.delete(dbName);
    } else {
        schemaCache.clear();
    }
}

module.exports = { profileSchema, getMinifiedSchema, invalidateSchemaCache };

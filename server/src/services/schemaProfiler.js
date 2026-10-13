const { getDb } = require('../db/connection');

// Collections to exclude from schema profiling (system/internal collections)
const SYSTEM_COLLECTIONS = new Set([
    'few_shot_examples',
    'query_history',
    'dashboards',
    'user_connections',  // AtlasMind internal — not user data
    'system.views',
]);

// Skip collections whose name contains 'embed' (evaluation default; cannot be overridden by options)
const EMBED_SKIP_RE = /embed/i;

// Cache for schema results, keyed by ${connectionId || 'default'}:${db.databaseName}:sz${sampleSize}
const schemaCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Metric Candidate ────────────────────────────────────────────────────────
// Tests the *last segment* of a dot-path (e.g. "customer.id" → test "id").
// id-like: id, _id, *Id, *_id, *ID (patterns: id, _id, *Id, *_id, *ID)
// year-like: year, *Year, *_year
const ID_LIKE_LAST_SEG_RE   = /^_?id$|Id$|_id$|ID$/;
const YEAR_LIKE_LAST_SEG_RE = /^year$|Year$|_year$/;

/**
 * Returns true when the field name is a plausible numeric metric.
 * Tests the last dot-path segment to handle nested paths like "customer.id".
 * Excludes id-like and year-like field names.
 * @param {string} fieldName
 * @returns {boolean}
 */
function isMetricCandidate(fieldName) {
    if (typeof fieldName !== 'string') return false;
    const seg = fieldName.includes('.')
        ? fieldName.split('.').pop()
        : fieldName;
    if (ID_LIKE_LAST_SEG_RE.test(seg))   return false;
    if (YEAR_LIKE_LAST_SEG_RE.test(seg)) return false;
    return true;
}

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
    if (typeof value === 'object' && value._bsontype === 'Int32')  return 'number';
    if (typeof value === 'object' && value._bsontype === 'Long')   return 'number';
    if (typeof value === 'object' && value._bsontype === 'Double') return 'number';
    return typeof value;
}

/**
 * Flatten a plain sub-document into dot-path keys (max depth 3 segments, e.g. "a.b.c").
 * Skips arrays, Date objects, and BSON typed objects.
 *
 * @param {string} parentKey - e.g. "a"
 * @param {*} subDoc - nested object value
 * @param {Map<string,object>} fieldMap
 * @param {number} subLevel - nesting level relative to parent (1 for "a.b", 2 for "a.b.c")
 */
function flattenSubDoc(parentKey, subDoc, fieldMap, subLevel) {
    // subLevel 1 yields 2-segment keys ("a.b")
    // subLevel 2 yields 3-segment keys ("a.b.c")
    // subLevel 3 would yield 4-segment keys ("a.b.c.d") and is halted
    if (subLevel > 2) return;
    if (!subDoc || typeof subDoc !== 'object') return;
    if (Array.isArray(subDoc) || subDoc instanceof Date) return;
    if (subDoc._bsontype) return;

    for (const [k, v] of Object.entries(subDoc)) {
        const dotKey = `${parentKey}.${k}`;
        const type = inferType(v);
        if (!fieldMap.has(dotKey)) {
            fieldMap.set(dotKey, {
                name: dotKey,
                type,
                sample: v instanceof Date
                    ? v.toISOString()
                    : (typeof v === 'object' ? JSON.stringify(v).slice(0, 50) : v),
            });
        }
        if (type === 'object') {
            flattenSubDoc(dotKey, v, fieldMap, subLevel + 1);
        }
    }
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
 * @param {object} [options]
 * @param {number} [options.sampleSize=5]
 * @returns {Promise<object>}
 */
async function profileCollection(db, collectionName, { sampleSize = 5 } = {}) {
    const collection = db.collection(collectionName);

    // Get document count
    const documentCount = await collection.estimatedDocumentCount();

    // Sample documents to extract field names, types, and sample values
    const sampleDocs = await collection.aggregate([{ $sample: { size: sampleSize } }]).toArray();

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
                        : (typeof value === 'object' && !Array.isArray(value) && !value?._bsontype
                            ? JSON.stringify(value).slice(0, 50)
                            : value),
                });
            }

            // Flatten plain sub-documents (max depth 3)
            if (inferType(value) === 'object') {
                flattenSubDoc(key, value, fieldMap, 1);
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
 * @param {number} [options.sampleSize=5] Number of sample documents per collection
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

    const sampleSize = actualOptions.sampleSize || 5;
    const now = Date.now();
    const dbName = db.databaseName;

    if (process.env.EVAL_MODE === '1' && process.env.EVAL_SCHEMA_SNAPSHOT) {
        const snapAll = JSON.parse(require('fs').readFileSync(process.env.EVAL_SCHEMA_SNAPSHOT, 'utf8'));
        const snap = snapAll[dbName];
        if (!snap) throw new Error(`no schema snapshot for ${dbName}`);
        const want = actualOptions.collections ? new Set(actualOptions.collections) : null;
        return want ? { ...snap, collections: snap.collections.filter((c) => want.has(c.name)) } : snap;
    }

    const cacheKey = `${actualOptions.connectionId || 'default'}:${dbName}:sz${sampleSize}`;

    let cachedOrFresh = null;

    if (!actualOptions.forceRefresh && schemaCache.has(cacheKey)) {
        const cached = schemaCache.get(cacheKey);
        if (now - cached.timestamp < CACHE_TTL_MS) {
            cachedOrFresh = cached;
        }
    }

    if (!cachedOrFresh) {
        const collections = await db.listCollections().toArray();

        const userCollections = collections
            .map((c) => c.name)
            .filter((name) => {
                if (SYSTEM_COLLECTIONS.has(name) || name.startsWith('system.')) return false;
                if (EMBED_SKIP_RE.test(name)) return false;
                return true;
            });

        const profiles = await Promise.all(
            userCollections.map((name) => profileCollection(db, name, { sampleSize }))
        );

        const schema = {
            database: db.databaseName,
            collections: profiles,
            profiledAt: new Date().toISOString(),
        };

        cachedOrFresh = { schema, timestamp: now };
        // Update cache
        schemaCache.set(cacheKey, cachedOrFresh);
    }

    if (actualOptions.collections && Array.isArray(actualOptions.collections)) {
        const reqSet = new Set(actualOptions.collections);
        return {
            ...cachedOrFresh.schema,
            collections: (cachedOrFresh.schema.collections || []).filter((c) => reqSet.has(c.name)),
        };
    }

    return cachedOrFresh.schema;
}

/**
 * Infer probable foreign-key style relationships between collections in scope.
 * Looks for fields ending in Id, _id, etc., matching another collection's name.
 *
 * @param {Array<object>} collections - Array of profiled collection objects
 * @returns {string[]} List of relationship hints (e.g. "orders.customerId -> customers._id")
 */
function inferRelationships(collections) {
    if (!Array.isArray(collections) || collections.length <= 1) {
        return [];
    }

    const hints = [];
    // Map collection base names (e.g. "customers" -> "customer", "products" -> "product")
    const colMap = new Map();
    for (const col of collections) {
        if (!col || !col.name) continue;
        const nameLower = col.name.toLowerCase();
        // exact name
        colMap.set(nameLower, col.name);
        // singular without trailing 's'
        if (nameLower.endsWith('s')) {
            colMap.set(nameLower.slice(0, -1), col.name);
        }
        // singular without trailing 'es' (e.g. boxes -> box)
        if (nameLower.endsWith('es')) {
            colMap.set(nameLower.slice(0, -2), col.name);
        }
    }

    for (const sourceCol of collections) {
        if (!sourceCol || !sourceCol.fields) continue;
        for (const field of sourceCol.fields) {
            const fieldName = field.name;
            const fieldLower = fieldName.toLowerCase();

            // Match patterns like customerId, customer_id, product_id, productId
            let stem = null;
            if (fieldLower.endsWith('_id') && fieldLower.length > 3) {
                stem = fieldLower.slice(0, -3);
            } else if (fieldLower.endsWith('id') && fieldLower.length > 2 && fieldLower !== '_id') {
                stem = fieldLower.slice(0, -2);
            }

            if (stem && colMap.has(stem)) {
                const targetColName = colMap.get(stem);
                if (targetColName !== sourceCol.name) {
                    hints.push(`${sourceCol.name}.${fieldName} -> ${targetColName}._id`);
                }
            }
        }
    }

    return hints;
}

/**
 * Format an already-profiled schema object into the minified text format used for LLM context.
 * @param {object} schema - Result of profileSchema()
 * @returns {string}
 */
function formatMinifiedSchema(schema) {
    if (!schema) return '';
    const lines = [`Database: ${schema.database || ''}`];

    for (const col of schema.collections || []) {
        lines.push(`\nCollection: ${col.name} (${col.documentCount || 0} docs)`);
        lines.push('Fields:');

        const topLevel = (col.fields || []).filter((f) => !f.isArrayItem);
        const nested   = (col.fields || []).filter((f) => f.isArrayItem);

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

    const hints = inferRelationships(schema.collections || []);
    if (hints.length > 0) {
        lines.push('\nLikely relationships (inferred hints, not facts):');
        for (const hint of hints) {
            lines.push(`- ${hint}`);
        }
    }

    return lines.join('\n');
}

/**
 * Format an already-profiled schema object into a stripped text format
 * containing collection names and field names only (no types, samples, or hints).
 * Used for schema context ablation studies in EVAL_MODE.
 * @param {object} schema - Result of profileSchema()
 * @returns {string}
 */
function formatFieldNamesOnly(schema) {
    if (!schema) return '';
    const lines = [`Database: ${schema.database || ''}`];

    for (const col of schema.collections || []) {
        lines.push(`\nCollection: ${col.name}`);
        const fieldNames = (col.fields || []).map((f) => f.name).join(', ');
        lines.push(`Fields: ${fieldNames}`);
    }

    return lines.join('\n');
}

/**
 * Minify the database schema into a compact, LLM-friendly string format.
 * Caches results per database for 5 minutes.
 *
 * @param {import('mongodb').Db} db
 * @param {object} [options]
 * @returns {Promise<string>}
 */
async function getMinifiedSchema(db, options = {}) {
    const schema = await profileSchema(db, options);
    return formatMinifiedSchema(schema);
}

/**
 * Invalidate the schema cache (e.g., after seeding).
 * @param {string} [dbName] - If undefined, clears all.
 */
function invalidateSchemaCache(dbName) {
    if (dbName) {
        for (const key of schemaCache.keys()) {
            if (key === dbName || key.includes(`:${dbName}:`) || key.endsWith(`:${dbName}`)) {
                schemaCache.delete(key);
            }
        }
    } else {
        schemaCache.clear();
    }
}

module.exports = {
    profileSchema,
    formatMinifiedSchema,
    formatFieldNamesOnly,
    getMinifiedSchema,
    invalidateSchemaCache,
    inferRelationships,
    isMetricCandidate,
};

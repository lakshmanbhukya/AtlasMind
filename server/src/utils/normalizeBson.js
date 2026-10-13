'use strict';

/**
 * BSON numeric _bsontype values that should be converted to JS Number.
 */
const NUMERIC_BSON_TYPES = new Set(['Decimal128', 'Int32', 'Long', 'Double']);

/**
 * Recursively normalize BSON types to plain JSON-safe values:
 *   Decimal128, Int32, Long, Double  → Number (via parseFloat(value.toString()))
 *   ObjectId                          → string (via .toString())
 *   Date                              → ISO 8601 string (via .toISOString())
 *   Arrays                            → recursively normalized
 *   Plain objects                     → recursively normalized
 *   Primitives (string/number/bool)   → unchanged
 *
 * @param {*} value
 * @returns {*}
 */
function normalizeBson(value) {
    if (value === null || value === undefined) return value;

    // Date instance
    if (value instanceof Date) return value.toISOString();

    if (value !== null && typeof value === 'object') {
        const bsonType = value._bsontype;

        if (bsonType === 'ObjectId') {
            return value.toString();
        }

        if (NUMERIC_BSON_TYPES.has(bsonType)) {
            return parseFloat(value.toString());
        }

        if (Array.isArray(value)) {
            return value.map(normalizeBson);
        }

        // Plain object — recurse into all entries
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = normalizeBson(v);
        }
        return out;
    }

    return value; // string, number, boolean, bigint, symbol
}

module.exports = { normalizeBson };

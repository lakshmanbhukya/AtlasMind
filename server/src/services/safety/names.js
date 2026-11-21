// @ts-check
/** Safety Guard: protected database/collection names and collection-name validation. */

/**
 * Validate a collection name — must be a simple identifier.
 * @param {string} collectionName
 * @returns {{ safe: boolean, reason?: string }}
 */
const PROTECTED_DATABASES = new Set(['admin', 'local', 'config']);

const PROTECTED_COLLECTIONS = new Set(['system', 'admin', 'local', 'config']);

/** Database names: MongoDB forbids "." in them, so they keep the strict identifier rule. */
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Collection names may also contain "-" and "." (e.g. "order-items", "sales.2024"). */
const COLLECTION_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const MAX_COLLECTION_NAME_LENGTH = 120;

/** Exact match on MongoDB's reserved databases. */
function isProtectedDatabaseName(name) {
    return PROTECTED_DATABASES.has(String(name));
}

/** MongoDB's reserved "system." namespace, plus the exact names system/admin/local/config. */
function isProtectedCollectionName(name) {
    const n = String(name);
    return n.startsWith('system.') || PROTECTED_COLLECTIONS.has(n);
}

function isValidCollectionName(name) {
    return typeof name === 'string'
        && name.length <= MAX_COLLECTION_NAME_LENGTH
        && COLLECTION_NAME_RE.test(name)
        && !name.includes('..')
        && !name.endsWith('.');
}

function validateCollectionName(collectionName) {
    if (!collectionName || typeof collectionName !== 'string') {
        return { safe: false, reason: 'Collection name is required and must be a string' };
    }

    // Block system collections
    if (isProtectedCollectionName(collectionName)) {
        return { safe: false, reason: `Access to "${collectionName}" is not allowed` };
    }

    if (!isValidCollectionName(collectionName)) {
        return { safe: false, reason: `Invalid collection name: "${collectionName}"` };
    }

    return { safe: true };
}

const PROTECTED_RULE = 'System and internal collections (system, admin, local, config) cannot be read or written.';

/** Structured block info for a rejected target collection name. */
function describeCollectionBlock(collectionName) {
    const name = typeof collectionName === 'string' ? collectionName : null;
    const isProtected = Boolean(name) && isProtectedCollectionName(name);
    return {
        code: isProtected ? 'protected_collection' : 'invalid_collection',
        rule: isProtected ? PROTECTED_RULE : 'Collection names must be simple identifiers.',
        referenceType: 'Target collection',
        reference: name,
        stage: null,
        stageIndex: null,
    };
}

module.exports = {
    IDENTIFIER_RE,
    PROTECTED_RULE,
    describeCollectionBlock,
    isProtectedCollectionName,
    isProtectedDatabaseName,
    validateCollectionName,
};

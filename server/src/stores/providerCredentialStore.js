// @ts-check
'use strict';

const connection = require('../db/connection');
const { encrypt, decrypt } = require('../utils/encryption');
const log = require('../utils/logger').logger.child({ module: 'providerCredentialStore' });

/**
 * Provider credential store: the only module that touches the central
 * `provider_credentials` collection. One document per sign-in
 * (`connectionId` + `sessionId`) records who pays for Groq calls:
 *
 *   { connectionId, sessionId, mode: 'managed'|'personal', encryptedKey|null,
 *     keyLast4|null, revoked, expiresAt, updatedAt }
 *
 * - Both IDs are required; calls without them throw (fail closed).
 * - `expiresAt` is the session JWT's `exp`. A TTL index removes documents
 *   after it, and every read also checks it because TTL deletion is lazy.
 * - Logout writes a tombstone (`revoked: true`, no key) instead of deleting.
 *   Every other write filters on `revoked: { $ne: true }`, so a key save still
 *   in flight cannot resurrect the credential: its upsert misses the filter,
 *   hits the unique index and is reported as revoked.
 * - The plaintext key is only returned by `getActiveKey`, for building a client.
 */

const COLLECTION = 'provider_credentials';
const DUPLICATE_KEY = 11000;

class CredentialScopeError extends Error {
    constructor(operation) {
        super(`connectionId and sessionId are required for ${operation}`);
        this.name = 'CredentialScopeError';
        this.code = 'tenant_required';
    }
}

/**
 * @param {unknown} connectionId
 * @param {unknown} sessionId
 * @param {string} operation
 * @returns {{ connectionId: string, sessionId: string }}
 */
function requireScope(connectionId, sessionId, operation) {
    if (typeof connectionId !== 'string' || !connectionId || typeof sessionId !== 'string' || !sessionId) {
        throw new CredentialScopeError(operation);
    }
    return { connectionId, sessionId };
}

function credentials() {
    return connection.getDb().collection(COLLECTION);
}

/** Ensure the unique and TTL indexes exist. Logs and continues on failure. */
async function initializeIndexes() {
    try {
        const coll = credentials();
        await coll.createIndex({ connectionId: 1, sessionId: 1 }, { unique: true });
        await coll.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        log.info({ collection: COLLECTION }, 'Initialized indexes');
    } catch (err) {
        log.error({ err, collection: COLLECTION }, 'Failed to initialize indexes');
    }
}

/**
 * @typedef {object} CredentialState
 * @property {'managed'|'personal'} mode
 * @property {boolean} hasKey
 * @property {string|null} keyLast4
 * @property {Date|null} keyExpiresAt
 */

/** @type {CredentialState} */
const MANAGED_DEFAULT = Object.freeze({ mode: 'managed', hasKey: false, keyLast4: null, keyExpiresAt: null });

/** A live document (not revoked, not expired), or null. */
async function findLive(scope) {
    const doc = await credentials().findOne({
        connectionId: scope.connectionId,
        sessionId: scope.sessionId,
        revoked: { $ne: true },
        expiresAt: { $gt: new Date() },
    });
    return doc || null;
}

/**
 * The payer state for one sign-in. No document means the managed default.
 * @param {string} connectionId
 * @param {string} sessionId
 * @returns {Promise<CredentialState>}
 */
async function getState(connectionId, sessionId) {
    const scope = requireScope(connectionId, sessionId, 'reading provider settings');
    const doc = await findLive(scope);
    if (!doc) return { ...MANAGED_DEFAULT };
    const hasKey = typeof doc.encryptedKey === 'string' && doc.encryptedKey.length > 0;
    return {
        mode: doc.mode === 'personal' && hasKey ? 'personal' : 'managed',
        hasKey,
        keyLast4: hasKey ? doc.keyLast4 || null : null,
        keyExpiresAt: hasKey ? doc.expiresAt : null,
    };
}

/**
 * The decrypted personal key when this sign-in is in personal mode, else null.
 * @param {string} connectionId
 * @param {string} sessionId
 * @returns {Promise<{ apiKey: string, keyLast4: string|null, updatedAt: Date|null }|null>}
 */
async function getActiveKey(connectionId, sessionId) {
    const scope = requireScope(connectionId, sessionId, 'reading a provider key');
    const doc = await findLive(scope);
    if (!doc || doc.mode !== 'personal' || typeof doc.encryptedKey !== 'string' || !doc.encryptedKey) return null;
    return { apiKey: decrypt(doc.encryptedKey), keyLast4: doc.keyLast4 || null, updatedAt: doc.updatedAt || null };
}

/**
 * Store a validated personal key and switch to personal mode.
 * @param {string} connectionId
 * @param {string} sessionId
 * @param {{ apiKey: string, expiresAt: Date }} input
 * @returns {Promise<boolean>} false when the sign-in was revoked (logged out) meanwhile
 */
async function saveKey(connectionId, sessionId, { apiKey, expiresAt }) {
    const scope = requireScope(connectionId, sessionId, 'saving a provider key');
    if (typeof apiKey !== 'string' || !apiKey) throw new Error('apiKey is required');
    if (!(expiresAt instanceof Date)) throw new Error('expiresAt is required');
    try {
        await credentials().updateOne(
            { ...scope, revoked: { $ne: true } },
            {
                $set: {
                    mode: 'personal',
                    encryptedKey: encrypt(apiKey),
                    keyLast4: apiKey.slice(-4),
                    expiresAt,
                    updatedAt: new Date(),
                },
                $setOnInsert: { revoked: false },
            },
            { upsert: true }
        );
        return true;
    } catch (err) {
        if (err && err.code === DUPLICATE_KEY) return false;
        throw err;
    }
}

/**
 * Switch payer. Personal mode needs a stored key.
 * @param {string} connectionId
 * @param {string} sessionId
 * @param {'managed'|'personal'} mode
 * @returns {Promise<boolean>} false when personal was asked for without a live key
 */
async function setMode(connectionId, sessionId, mode) {
    const scope = requireScope(connectionId, sessionId, 'changing the provider mode');
    if (mode !== 'managed' && mode !== 'personal') throw new Error(`invalid mode: ${mode}`);
    const filter = {
        ...scope,
        revoked: { $ne: true },
        expiresAt: { $gt: new Date() },
        ...(mode === 'personal' ? { encryptedKey: { $type: 'string' } } : {}),
    };
    const result = await credentials().updateOne(filter, { $set: { mode, updatedAt: new Date() } });
    // Managed is the default, so "no document" already means managed.
    return mode === 'managed' ? true : result.matchedCount > 0;
}

/**
 * Remove the personal key and switch to managed in one update.
 * @param {string} connectionId
 * @param {string} sessionId
 */
async function deleteKey(connectionId, sessionId) {
    const scope = requireScope(connectionId, sessionId, 'deleting a provider key');
    await credentials().updateOne(
        { ...scope, revoked: { $ne: true } },
        { $set: { mode: 'managed', encryptedKey: null, keyLast4: null, updatedAt: new Date() } }
    );
}

/**
 * Logout: replace the credential with a tombstone until the session would
 * have expired, so an in-flight saveKey cannot bring the key back.
 * @param {string} connectionId
 * @param {string} sessionId
 * @param {Date} expiresAt
 */
async function revoke(connectionId, sessionId, expiresAt) {
    const scope = requireScope(connectionId, sessionId, 'revoking a provider key');
    await credentials().updateOne(
        scope,
        {
            $set: {
                revoked: true,
                mode: 'managed',
                encryptedKey: null,
                keyLast4: null,
                expiresAt,
                updatedAt: new Date(),
            },
        },
        { upsert: true }
    );
}

module.exports = {
    COLLECTION,
    CredentialScopeError,
    initializeIndexes,
    getState,
    getActiveKey,
    saveKey,
    setMode,
    deleteKey,
    revoke,
};

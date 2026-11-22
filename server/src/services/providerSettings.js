// @ts-check
'use strict';

const credentialStore = require('../stores/providerCredentialStore');
const groqService = require('./groqService');
const { ValidationError, QueryEngineError } = require('./engineErrors');

/**
 * Provider settings: who pays for this sign-in's Groq calls.
 *
 * Every connection starts on the AtlasMind allowance (managed key). A user can
 * store their own Groq key for the current sign-in (`sessionId`); it lasts as
 * long as the session cookie and is revoked on logout. Sessions issued before
 * cookies carried a `sid` keep managed access only.
 */

/**
 * @typedef {object} SessionScope
 * @property {string} connectionId
 * @property {string|null|undefined} sessionId
 * @property {Date|undefined} [sessionExpiresAt]
 */

class ReconnectRequiredError extends QueryEngineError {
    constructor() {
        super('Sign in to your database again to use your own Groq key.', 'reconnect_required', 409);
    }
}

/** Groq keys look like `gsk_` + base62. Checked loosely: Groq has the final say. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

/** @param {SessionScope} scope */
function hasSession(scope) {
    return typeof scope.sessionId === 'string' && scope.sessionId.length > 0;
}

/**
 * @param {SessionScope} scope
 * @returns {Promise<Record<string, any>>}
 */
async function getSettings(scope) {
    if (!hasSession(scope)) {
        return {
            mode: 'managed',
            hasKey: false,
            keyLast4: null,
            keyExpiresAt: null,
            requiresReconnectForPersonal: true,
        };
    }
    const state = await credentialStore.getState(scope.connectionId, /** @type {string} */ (scope.sessionId));
    return {
        mode: state.mode,
        hasKey: state.hasKey,
        keyLast4: state.keyLast4,
        keyExpiresAt: state.keyExpiresAt ? state.keyExpiresAt.toISOString() : null,
    };
}

/**
 * Validate a key with Groq, then store it and switch to personal mode.
 * An invalid key leaves the previous state unchanged.
 * @param {SessionScope} scope
 * @param {unknown} apiKey
 */
async function saveKey(scope, apiKey) {
    if (!hasSession(scope)) throw new ReconnectRequiredError();
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!KEY_PATTERN.test(key)) {
        throw new ValidationError('Enter a Groq API key (it starts with "gsk_").', 'validation_error');
    }
    await groqService.validateApiKey(key);
    const expiresAt = scope.sessionExpiresAt instanceof Date ? scope.sessionExpiresAt : null;
    if (!expiresAt) throw new ReconnectRequiredError();
    const saved = await credentialStore.saveKey(scope.connectionId, /** @type {string} */ (scope.sessionId), {
        apiKey: key,
        expiresAt,
    });
    if (!saved) {
        throw new QueryEngineError('This sign-in has ended. Connect your database again.', 'session_revoked', 401);
    }
    return getSettings(scope);
}

/**
 * @param {SessionScope} scope
 * @param {unknown} mode
 */
async function setMode(scope, mode) {
    if (mode !== 'managed' && mode !== 'personal') {
        throw new ValidationError('"mode" must be "managed" or "personal"', 'validation_error');
    }
    if (mode === 'personal') {
        if (!hasSession(scope)) throw new ReconnectRequiredError();
        const ok = await credentialStore.setMode(scope.connectionId, /** @type {string} */ (scope.sessionId), 'personal');
        if (!ok) throw new ValidationError('Save a Groq API key before switching to it.', 'provider_key_missing');
    } else if (hasSession(scope)) {
        await credentialStore.setMode(scope.connectionId, /** @type {string} */ (scope.sessionId), 'managed');
    }
    return getSettings(scope);
}

/** @param {SessionScope} scope */
async function deleteKey(scope) {
    if (hasSession(scope)) {
        await credentialStore.deleteKey(scope.connectionId, /** @type {string} */ (scope.sessionId));
    }
    return getSettings(scope);
}

/**
 * Logout: revoke this sign-in's credential. A session without a sid has none.
 * @param {{ connectionId: string, sid: string|null, expiresAt: Date }} claims
 */
async function revokeSession(claims) {
    if (!claims.sid) return;
    await credentialStore.revoke(claims.connectionId, claims.sid, claims.expiresAt);
}

module.exports = {
    ReconnectRequiredError,
    getSettings,
    saveKey,
    setMode,
    deleteKey,
    revokeSession,
};

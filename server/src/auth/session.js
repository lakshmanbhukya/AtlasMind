'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * Session: everything about AtlasMind's two kinds of signed token.
 *
 * - Session cookie (`am_token`, 7 days): proves which connected DB a browser
 *   is using. There are no user accounts; a session is a connectionId.
 * - Write Approval Token (10 minutes, single use via its jti): carries a
 *   staged write pipeline for human-in-the-loop approval.
 *
 * Callers never touch cookie names, cookie options, JWT_SECRET or expiry.
 * The secret is read when a token is signed or verified, not at import.
 */

const COOKIE_NAME = 'am_token';
const SESSION_TTL = '7d';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const APPROVAL_TTL = '10m';
const APPROVAL_TOKEN_TYPE = 'write-approval';

class SessionError extends Error {
    /** @param {'unauthenticated'|'session_expired'} code */
    constructor(code, message) {
        super(message);
        this.name = 'SessionError';
        this.code = code;
    }
}

function secret() {
    const value = process.env.JWT_SECRET;
    if (!value) throw new Error('JWT_SECRET is not set');
    return value;
}

/** Production runs cross-site over HTTPS (sameSite none + secure); local dev uses lax. */
function cookieOptions() {
    const isProd = process.env.NODE_ENV === 'production';
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
    };
}

/** Sign a session for a connectionId and set it as the session cookie. */
function issueSession(res, connectionId) {
    const token = jwt.sign({ connectionId }, secret(), { expiresIn: SESSION_TTL });
    res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_MAX_AGE_MS });
    return token;
}

/** Remove the session cookie. */
function clearSession(res) {
    res.clearCookie(COOKIE_NAME, cookieOptions());
}

/**
 * Read and verify the session cookie.
 * @returns {string} connectionId
 * @throws {SessionError} 'unauthenticated' (no cookie) or 'session_expired' (invalid/expired)
 */
function readSession(req) {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) {
        throw new SessionError('unauthenticated', 'No session found. Please connect your database.');
    }
    try {
        const payload = jwt.verify(token, secret());
        if (!payload || typeof payload.connectionId !== 'string') throw new Error('malformed session');
        return payload.connectionId;
    } catch {
        throw new SessionError('session_expired', 'Session expired. Please reconnect.');
    }
}

/**
 * Sign a Write Approval Token for a staged write.
 * @param {{ connectionId: string, collection: string, pipeline: object[], query: string, scope?: string[] }} write
 * @returns {string}
 */
function signApprovalToken(write) {
    return jwt.sign(
        { ...write, jti: crypto.randomUUID(), type: APPROVAL_TOKEN_TYPE },
        secret(),
        { expiresIn: APPROVAL_TTL }
    );
}

/**
 * Verify a Write Approval Token's signature and expiry.
 * @returns {object} decoded payload (check `type === APPROVAL_TOKEN_TYPE`)
 * @throws if the signature is invalid or the token expired
 */
function verifyApprovalToken(token) {
    return jwt.verify(token, secret());
}

module.exports = {
    COOKIE_NAME,
    APPROVAL_TOKEN_TYPE,
    SessionError,
    issueSession,
    clearSession,
    readSession,
    signApprovalToken,
    verifyApprovalToken,
};

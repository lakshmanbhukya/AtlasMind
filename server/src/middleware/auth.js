// @ts-check
const { readSessionClaims, clearSession, SessionError } = require('../auth/session');

/**
 * Auth middleware: verifies the session cookie and sets `req.connectionId`,
 * `req.sessionId` (null for cookies issued before sessions carried a `sid`)
 * and `req.sessionExpiresAt` for downstream route handlers.
 *
 * Returns 401 `unauthenticated` when there is no session, or 401
 * `session_expired` (and clears the cookie) when it is invalid or expired.
 */
function requireAuth(req, res, next) {
    try {
        const claims = readSessionClaims(req);
        req.connectionId = claims.connectionId;
        req.sessionId = claims.sid;
        req.sessionExpiresAt = claims.expiresAt;
        // Tag this request's log lines with the tenant. `req.log` is absent
        // when a router is mounted without pino-http (unit tests).
        if (req.log) req.log = req.log.child({ connectionId: req.connectionId });
        return next();
    } catch (err) {
        if (!(err instanceof SessionError)) return next(err);
        if (err.code === 'session_expired') clearSession(res);
        return res.status(401).json({
            success: false,
            error: { code: err.code, message: err.message },
        });
    }
}

module.exports = { requireAuth };

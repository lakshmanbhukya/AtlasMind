const { readSession, clearSession, SessionError } = require('../auth/session');

/**
 * Auth middleware: verifies the session cookie and sets `req.connectionId`
 * for downstream route handlers.
 *
 * Returns 401 `unauthenticated` when there is no session, or 401
 * `session_expired` (and clears the cookie) when it is invalid or expired.
 */
function requireAuth(req, res, next) {
    try {
        req.connectionId = readSession(req);
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

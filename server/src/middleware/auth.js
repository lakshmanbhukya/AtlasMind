const { verifyToken } = require('../utils/jwt');

const COOKIE_NAME = 'am_token';

/**
 * Auth middleware — reads the httpOnly `am_token` cookie, verifies the JWT,
 * and attaches `req.connectionId` for downstream route handlers.
 *
 * Returns 401 if the cookie is missing or the token is invalid/expired.
 */
function requireAuth(req, res, next) {
    const token = req.cookies?.[COOKIE_NAME];

    if (!token) {
        return res.status(401).json({
            success: false,
            error: { code: 'unauthenticated', message: 'No session found. Please connect your database.' },
        });
    }

    try {
        const payload = verifyToken(token);
        req.connectionId = payload.connectionId;
        next();
    } catch (err) {
        // Token expired or tampered
        const isProd = process.env.NODE_ENV === 'production';
        res.clearCookie(COOKIE_NAME, { 
            httpOnly: true, 
            secure: isProd,
            sameSite: isProd ? 'none' : 'lax',
            path: '/' 
        });
        return res.status(401).json({
            success: false,
            error: { code: 'session_expired', message: 'Session expired. Please reconnect.' },
        });
    }
}

module.exports = { requireAuth };

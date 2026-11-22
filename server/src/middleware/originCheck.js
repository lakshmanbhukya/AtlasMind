// @ts-check
'use strict';

/**
 * Origin check for state-changing API requests.
 *
 * Production cookies are `SameSite=None`, so a browser sends the session
 * cookie on cross-site requests too. A non-GET `/api/*` request that carries
 * an `Origin` header must come from an allowed origin (`CORS_ALLOWED_ORIGINS`,
 * plus the Vite dev origin outside production); otherwise 403. Requests
 * without `Origin` (curl, server-to-server) pass, as before. This covers
 * settings, query, stream and multipart voice uploads in one place.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/** The allowed origins, read at call time so tests and config reloads see changes. */
function allowedOrigins() {
    const configured = (process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    return process.env.NODE_ENV === 'production' ? configured : [...configured, ...DEV_ORIGINS];
}

function originCheck(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    if (allowedOrigins().includes(origin)) return next();
    return res.status(403).json({
        success: false,
        error: { code: 'origin_not_allowed', message: 'This request came from an origin that is not allowed.' },
    });
}

module.exports = { originCheck, allowedOrigins };

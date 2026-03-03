const rateLimit = require('express-rate-limit');

/**
 * Common Rate Limiter Settings
 * ---------------------------------------------------------------------------
 * - windowMs: The timeframe for which hits are retained (15 mins)
 * - limit: The max number of requests per timeframe
 * - standardHeaders: Return rate limit info in the `RateLimit-*` headers
 * - legacyHeaders: Disable the `X-RateLimit-*` headers
 * - message: The response body to send when rate limit is exceeded
 */

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100,               // Limit each IP to 100 requests per `window`
    standardHeaders: true,    // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false,    // Disable the `X-RateLimit-*` headers
    message: {
        success: false,
        error: {
            code: 'too_many_requests',
            message: 'Too many requests from this IP, please try again after 15 minutes',
        },
    },
});

/**
 * Strict limiter for sensitive endpoints like login/auth
 */
const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 50,                 // Limit each IP to 50 auth requests per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 'auth_rate_limit_exceeded',
            message: 'Too many authentication attempts, please try again after an hour',
        },
    },
});

module.exports = {
    generalLimiter,
    authLimiter,
};

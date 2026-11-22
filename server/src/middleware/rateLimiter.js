// @ts-check
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

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
    limit: 300,               // Coarse per-IP flood guard; LLM cost is bounded per connection by llmLimiter
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

/**
 * Per-connection limiter for the routes that call the LLM (/api/query, /api/voice).
 * Mount it after requireAuth, which sets req.connectionId. Only POSTs count: the
 * history reads and edits under /api/query are cheap and must not use up the budget.
 */
const LLM_WINDOW_MS = 5 * 60 * 1000;
const LLM_LIMIT = 30;

const llmLimiter = rateLimit({
    windowMs: LLM_WINDOW_MS,
    limit: LLM_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST',
    // requireAuth always sets connectionId; the IP fallback (IPv6-subnet safe) only guards misuse.
    keyGenerator: (req) => (req.connectionId ? `conn:${req.connectionId}` : `ip:${ipKeyGenerator(req.ip)}`),
    message: {
        success: false,
        error: {
            code: 'too_many_requests',
            message: 'Too many queries for this connection, please try again in a few minutes',
        },
    },
});

/**
 * Limiter for personal-key validation (PUT /api/provider-settings/key): each
 * attempt makes a Groq call, so a session gets 10 per hour.
 */
const keyValidationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.sessionId
        ? `sess:${req.sessionId}`
        : req.connectionId ? `conn:${req.connectionId}` : `ip:${ipKeyGenerator(req.ip)}`),
    message: {
        success: false,
        error: {
            code: 'too_many_requests',
            message: 'Too many key checks for this session, please try again in an hour',
        },
    },
});

module.exports = {
    generalLimiter,
    authLimiter,
    llmLimiter,
    keyValidationLimiter,
    LLM_LIMIT,
};

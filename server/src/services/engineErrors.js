// @ts-check
'use strict';

// Domain Error Hierarchy
class QueryEngineError extends Error {
    constructor(message, code, statusCode) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
    }
}

class ValidationError extends QueryEngineError {
    constructor(message, code = 'validation_error') {
        super(message, code, 400);
    }
}

class ScopeError extends QueryEngineError {
    constructor(message, code = 'validation_error') {
        super(message, code, 400);
    }
}

class TokenExpiredError extends QueryEngineError {
    constructor(message = 'Approval draft has expired or is invalid. Please resend query.') {
        super(message, 'expired_token', 401);
    }
}

class UnauthorizedTokenError extends QueryEngineError {
    constructor(message = 'Access denied: token connectionId does not match current session') {
        super(message, 'forbidden', 403);
    }
}

class TokenAlreadyUsedError extends QueryEngineError {
    constructor(message = 'Approval token has already been used') {
        super(message, 'token_already_used', 409);
    }
}

class SafetyViolationError extends QueryEngineError {
    constructor(message, code = 'safety_violation') {
        super(message, code, 422);
    }
}

class ExecutionError extends QueryEngineError {
    constructor(message, code = 'execution_error') {
        super(message, code, 500);
    }
}

class RateLimitError extends QueryEngineError {
    constructor(message = 'The language model is rate limited. Please retry shortly.', code = 'rate_limited') {
        super(message, code, 429);
    }
}

/**
 * A failure that belongs to the LLM provider or to who pays for it: an invalid
 * personal key, a provider or managed-allowance limit, a model the payer may
 * not use. The message is always ours, never the SDK's text. `payer` says which
 * key the call used ('managed' | 'personal'); `retryAfterSeconds` and `resetAt`
 * are sent to the client when set.
 */
class ProviderError extends QueryEngineError {
    /**
     * @param {string} code
     * @param {string} message
     * @param {number} statusCode
     * @param {{ payer?: 'managed'|'personal'|null, retryAfterSeconds?: number, resetAt?: string }} [details]
     */
    constructor(code, message, statusCode, details = {}) {
        super(message, code, statusCode);
        this.payer = details.payer || null;
        if (details.retryAfterSeconds !== undefined) this.retryAfterSeconds = details.retryAfterSeconds;
        if (details.resetAt !== undefined) this.resetAt = details.resetAt;
    }
}

module.exports = {
    QueryEngineError,
    ProviderError,
    ValidationError,
    ScopeError,
    TokenExpiredError,
    UnauthorizedTokenError,
    TokenAlreadyUsedError,
    SafetyViolationError,
    ExecutionError,
    RateLimitError,
};

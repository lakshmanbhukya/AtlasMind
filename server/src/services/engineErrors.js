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

module.exports = {
    QueryEngineError,
    ValidationError,
    ScopeError,
    TokenExpiredError,
    UnauthorizedTokenError,
    TokenAlreadyUsedError,
    SafetyViolationError,
    ExecutionError,
    RateLimitError,
};

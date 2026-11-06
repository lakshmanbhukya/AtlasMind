'use strict';

const { ObjectId } = require('mongodb');

/**
 * Thrown when a tenant-scoped store is called without a connectionId.
 * Stores fail closed: a missing tenant never widens a query to all tenants.
 */
class TenantRequiredError extends Error {
    constructor(operation) {
        super(`connectionId is required for ${operation}`);
        this.name = 'TenantRequiredError';
        this.code = 'tenant_required';
    }
}

function requireTenant(connectionId, operation) {
    if (typeof connectionId !== 'string' || connectionId.length === 0) {
        throw new TenantRequiredError(operation);
    }
    return connectionId;
}

/** Parse a document id; returns null for anything that is not a valid ObjectId. */
function toObjectId(id) {
    return typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : null;
}

module.exports = { TenantRequiredError, requireTenant, toObjectId };

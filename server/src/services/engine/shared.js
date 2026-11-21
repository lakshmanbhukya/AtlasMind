// @ts-check
/** Query engine helpers shared by both flows: the tenant database name and the approval token expiry. */
'use strict';

/** @typedef {import('../queryExecutionEngine').QueryOutcome} QueryOutcome */

const jwt = require('jsonwebtoken');

/** The connected database's name, or null when the handle does not expose one (fails closed on explicit `db`). */
function tenantDatabaseOf(db) {
    return db && typeof db.databaseName === 'string' ? db.databaseName : null;
}

/** ISO expiry of a signed Write Approval Token (from its JWT `exp`). */
function approvalExpiresAt(token) {
    const decoded = /** @type {{ exp?: number } | null} */ (jwt.decode(token));
    return decoded && decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null;
}

module.exports = {
    approvalExpiresAt,
    tenantDatabaseOf,
};

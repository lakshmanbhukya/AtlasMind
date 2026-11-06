'use strict';

const { getUserDb } = require('./userDbPool');
const { profileSchema } = require('./schemaProfiler');
const { isUserCollection } = require('../db/systemCollections');
const { requireTenant } = require('../stores/tenant');

/**
 * Tenant Schema: what collections and fields a connected tenant has.
 * Every call takes the tenant's connectionId; it is also the schema cache
 * key, so two tenants whose databases share a name never share a cache entry.
 */

/** User (non-system) collection names in a database handle. */
async function listUserCollections(db) {
    const collections = await db.listCollections().toArray();
    return collections.map((c) => c.name).filter(isUserCollection);
}

/** User collection names for a tenant. */
async function getUserCollections(connectionId) {
    requireTenant(connectionId, 'listing collections');
    return listUserCollections(await getUserDb(connectionId));
}

/**
 * Profiled schema for a tenant (cached 5 minutes per tenant).
 * @param {string} connectionId
 * @param {object} [options]
 * @param {string[]} [options.collections] - Restrict the returned schema to these collections
 * @param {boolean} [options.forceRefresh=false]
 */
async function getSchema(connectionId, { collections, forceRefresh = false } = {}) {
    requireTenant(connectionId, 'profiling a schema');
    const db = await getUserDb(connectionId);
    return profileSchema(db, { connectionId, collections, forceRefresh });
}

module.exports = { listUserCollections, getUserCollections, getSchema };

'use strict';

const crypto = require('crypto');
const connection = require('../db/connection');
const { getUserDb } = require('../services/userDbPool');
const { executePipeline, assertSafePipeline } = require('../services/queryExecutor');
const { requireTenant, toObjectId } = require('./tenant');
const log = require('../utils/logger').logger.child({ module: 'dashboardStore' });

/**
 * Dashboard store: the only module that touches the central `dashboards`
 * collection. Tenant operations require a connectionId and filter on it.
 * A pinned pipeline is safety-checked when it is pinned and again (inside
 * executePipeline) every time it is refreshed.
 */

const COLLECTION = 'dashboards';

/** Fields a public share link may expose: never connectionId. */
const PUBLIC_PROJECTION = {
    _id: 1,
    name: 1,
    query: 1,
    pipeline: 1,
    collection: 1,
    results: 1,
    chartType: 1,
    pinnedAt: 1,
    lastRefreshedAt: 1,
    scope: 1,
};

/** Share tokens are 24 random bytes, base64url-encoded (32 chars). */
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

function pinsCollection() {
    return connection.getDb().collection(COLLECTION);
}

/** Ensure the dashboards indexes exist. Logs and continues on failure. */
async function initializeIndexes() {
    try {
        const pins = pinsCollection();
        await pins.createIndex({ connectionId: 1, pinnedAt: -1 });
        await pins.createIndex({ shareToken: 1 }, { unique: true, sparse: true });
        log.info({ collection: COLLECTION }, 'Initialized indexes');
    } catch (err) {
        log.error({ err, collection: COLLECTION }, 'Failed to initialize indexes');
    }
}

/**
 * List a tenant's pins. The share token itself is never listed (it only goes
 * to the client from share()); each pin carries a `shared` flag instead.
 */
async function list(connectionId) {
    requireTenant(connectionId, 'listing dashboard pins');
    const pins = await pinsCollection().find({ connectionId }).sort({ pinnedAt: -1 }).toArray();
    return pins.map(({ shareToken, ...pinDoc }) => ({ ...pinDoc, shared: Boolean(shareToken) }));
}

/**
 * Pin a query result as a dashboard widget.
 * @throws {import('../services/queryExecutor').UnsafePipelineError} if the pipeline fails the safety guard
 */
async function pin(connectionId, { query, pipeline, collection, chartType, name, results, scope }) {
    requireTenant(connectionId, 'pinning to the dashboard');
    const userDb = await getUserDb(connectionId);
    assertSafePipeline(collection, pipeline, {
        scope: scope || null,
        tenantDatabase: userDb && typeof userDb.databaseName === 'string' ? userDb.databaseName : null,
    });

    const doc = {
        connectionId,
        name: name || query.substring(0, 60),
        query,
        pipeline,
        collection,
        scope: scope || [],
        results,
        chartType: chartType || 'table',
        pinnedAt: new Date(),
    };
    const result = await pinsCollection().insertOne(doc);
    return { ...doc, _id: result.insertedId };
}

/** @returns {Promise<boolean>} false when the pin does not exist for this tenant */
async function remove(connectionId, id) {
    requireTenant(connectionId, 'removing a dashboard pin');
    const _id = toObjectId(id);
    if (!_id) return false;
    const result = await pinsCollection().deleteOne({ _id, connectionId });
    return result.deletedCount > 0;
}

/**
 * Re-run a pin's stored pipeline against the tenant's DB and save the results.
 * @returns {Promise<object|null>} the refreshed pin, or null when not found for this tenant
 * @throws {import('../services/queryExecutor').UnsafePipelineError}
 */
async function refresh(connectionId, id) {
    requireTenant(connectionId, 'refreshing a dashboard pin');
    const _id = toObjectId(id);
    if (!_id) return null;

    const pins = pinsCollection();
    const existing = await pins.findOne({ _id, connectionId });
    if (!existing) return null;

    const userDb = await getUserDb(connectionId);
    const { results, executionTimeMs } = await executePipeline(
        userDb,
        existing.collection,
        existing.pipeline,
        { scope: existing.scope || null }
    );

    const lastRefreshedAt = new Date();
    await pins.updateOne({ _id, connectionId }, { $set: { results, lastRefreshedAt } });

    return {
        ...existing,
        results,
        lastRefreshedAt,
        meta: { resultCount: results.length, executionTimeMs },
    };
}

/**
 * Make a pin publicly shareable. Reuses the pin's token if it already has one.
 * @returns {Promise<{shareToken: string}|null>} null when the pin does not exist for this tenant
 */
async function share(connectionId, id) {
    requireTenant(connectionId, 'sharing a dashboard pin');
    const _id = toObjectId(id);
    if (!_id) return null;

    const pins = pinsCollection();
    const existing = await pins.findOne({ _id, connectionId }, { projection: { shareToken: 1 } });
    if (!existing) return null;
    if (existing.shareToken) return { shareToken: existing.shareToken };

    const shareToken = crypto.randomBytes(24).toString('base64url');
    await pins.updateOne({ _id, connectionId }, { $set: { shareToken } });
    return { shareToken };
}

/**
 * Revoke a pin's public link. Sharing the pin again issues a new token.
 * @returns {Promise<boolean>} false when the pin does not exist for this tenant
 */
async function unshare(connectionId, id) {
    requireTenant(connectionId, 'unsharing a dashboard pin');
    const _id = toObjectId(id);
    if (!_id) return false;
    const result = await pinsCollection().updateOne({ _id, connectionId }, { $unset: { shareToken: '' } });
    return result.matchedCount > 0;
}

/**
 * Public, unauthenticated view of a shared pin (display fields only).
 * Only pins explicitly shared via share() are reachable, by their secret token.
 */
async function getShared(token) {
    if (typeof token !== 'string' || !SHARE_TOKEN_PATTERN.test(token)) return null;
    return pinsCollection().findOne({ shareToken: token }, { projection: PUBLIC_PROJECTION });
}

module.exports = {
    list, pin, remove, refresh, share, unshare, getShared, initializeIndexes,
    PUBLIC_PROJECTION, SHARE_TOKEN_PATTERN,
};

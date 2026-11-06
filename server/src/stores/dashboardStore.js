'use strict';

const connection = require('../db/connection');
const { getUserDb } = require('../services/userDbPool');
const { executePipeline, assertSafePipeline } = require('../services/queryExecutor');
const { requireTenant, toObjectId } = require('./tenant');

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

function pinsCollection() {
    return connection.getDb().collection(COLLECTION);
}

async function list(connectionId) {
    requireTenant(connectionId, 'listing dashboard pins');
    return pinsCollection().find({ connectionId }).sort({ pinnedAt: -1 }).toArray();
}

/**
 * Pin a query result as a dashboard widget.
 * @throws {import('../services/queryExecutor').UnsafePipelineError} if the pipeline fails the safety guard
 */
async function pin(connectionId, { query, pipeline, collection, chartType, name, results, scope }) {
    requireTenant(connectionId, 'pinning to the dashboard');
    assertSafePipeline(collection, pipeline, { scope: scope || null });

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

/** Public, unauthenticated view of a shared pin (display fields only). */
async function getShared(id) {
    const _id = toObjectId(id);
    if (!_id) return null;
    return pinsCollection().findOne({ _id }, { projection: PUBLIC_PROJECTION });
}

module.exports = { list, pin, remove, refresh, getShared, PUBLIC_PROJECTION };

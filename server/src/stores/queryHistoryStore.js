'use strict';

const connection = require('../db/connection');
const { requireTenant, toObjectId } = require('./tenant');

/**
 * Query History store: the only module that touches the central
 * `query_history` collection. Every tenant operation requires a connectionId
 * and filters on it, so a missing tenant can never read, rename or delete
 * another tenant's history.
 */

const COLLECTION = 'query_history';
const RESULT_SNAPSHOT_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;
const MAX_PINNED = 50;

function historyCollection() {
    return connection.getDb().collection(COLLECTION);
}

/** "Just now", "5 min ago", "2 hours ago", "Yesterday", "3 days ago". */
function relativeTimeLabel(timestamp, now = Date.now()) {
    const diff = now - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
}

/**
 * Record an executed query. Never throws: history is non-critical, and a
 * failure here must not fail the query that produced it. Entries without a
 * connectionId are dropped rather than stored untenanted.
 *
 * With `isEdit: true` the most recent entry for the same question is updated
 * in place (a clarification edit), instead of adding a second row.
 *
 * @param {object} entry - must include connectionId and naturalLanguage
 * @returns {Promise<void>}
 */
async function record(entry) {
    try {
        requireTenant(entry && entry.connectionId, 'recording query history');

        const doc = { ...entry };
        if (Array.isArray(entry.results)) {
            doc.results = entry.results.slice(0, RESULT_SNAPSHOT_LIMIT);
        }

        const coll = historyCollection();
        if (entry.isEdit === true && entry.naturalLanguage) {
            await coll.findOneAndUpdate(
                { connectionId: entry.connectionId, naturalLanguage: entry.naturalLanguage },
                { $set: { ...doc, updatedAt: new Date() } },
                { sort: { timestamp: -1 } }
            );
            return;
        }

        await coll.insertOne({ ...doc, timestamp: new Date() });
    } catch (error) {
        console.warn('⚠️ Failed to save query history:', error.message);
    }
}

const LIST_PROJECTION = {
    _id: 1,
    naturalLanguage: 1,
    timestamp: 1,
    collection: 1,
    resultCount: 1,
    schemaContext: 1,
    generatedPipeline: 1,
    chartType: 1,
    results: 1,
    explanation: 1,
    executionTimeMs: 1,
    confidenceScore: 1,
    scope: 1,
    pinned: 1,
};

/**
 * Most recent history items for a tenant, shaped for the client sidebar.
 * Pinned items are always included, even when older than the recent window.
 * The newest item is marked `active`.
 */
async function listRecent(connectionId, { limit = DEFAULT_LIST_LIMIT, now = Date.now() } = {}) {
    requireTenant(connectionId, 'listing query history');

    const coll = historyCollection();
    const [recent, pinned] = await Promise.all([
        coll.find({ connectionId }).sort({ timestamp: -1 }).limit(limit).project(LIST_PROJECTION).toArray(),
        coll.find({ connectionId, pinned: true }).sort({ timestamp: -1 }).limit(MAX_PINNED).project(LIST_PROJECTION).toArray(),
    ]);

    const seen = new Set();
    const rows = [...(recent || []), ...(pinned || [])].filter((item) => {
        const key = item._id.toString();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return rows.map((item, index) => ({
        id: item._id.toString(),
        query: item.naturalLanguage,
        time: relativeTimeLabel(item.timestamp, now),
        timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : null,
        collection: item.collection || '',
        resultCount: item.resultCount || 0,
        schemaContext: item.schemaContext || '',
        pipeline: item.generatedPipeline || [],
        chartType: item.chartType || 'table',
        results: item.results || [],
        explanation: item.explanation || '',
        executionTimeMs: typeof item.executionTimeMs === 'number' ? item.executionTimeMs : null,
        confidenceScore: typeof item.confidenceScore === 'number' ? item.confidenceScore : null,
        scope: Array.isArray(item.scope) ? item.scope : null,
        pinned: item.pinned === true,
        active: index === 0,
    }));
}

/**
 * Rename and/or pin a history item.
 * @param {{ name?: string, pinned?: boolean }} changes
 * @returns {Promise<boolean>} false when the item does not exist for this tenant
 */
async function update(connectionId, id, changes = {}) {
    requireTenant(connectionId, 'updating query history');
    const _id = toObjectId(id);
    if (!_id) return false;

    const $set = {};
    if (typeof changes.name === 'string') {
        $set.naturalLanguage = changes.name;
        $set.renamedAt = new Date();
    }
    if (typeof changes.pinned === 'boolean') {
        $set.pinned = changes.pinned;
        $set.pinnedAt = changes.pinned ? new Date() : null;
    }
    if (Object.keys($set).length === 0) return false;

    const result = await historyCollection().updateOne({ _id, connectionId }, { $set });
    return result.matchedCount > 0;
}

/** @returns {Promise<boolean>} false when the item does not exist for this tenant */
async function rename(connectionId, id, name) {
    return update(connectionId, id, { name });
}

/** @returns {Promise<boolean>} false when the item does not exist for this tenant */
async function remove(connectionId, id) {
    requireTenant(connectionId, 'deleting query history');
    const _id = toObjectId(id);
    if (!_id) return false;

    const result = await historyCollection().deleteOne({ _id, connectionId });
    return result.deletedCount > 0;
}

/**
 * Retention purge across all tenants (operator task, not a tenant operation).
 * @returns {Promise<number>} deleted count
 */
async function purgeOlderThan(cutoffDate) {
    const result = await historyCollection().deleteMany({
        $or: [
            { timestamp: { $lt: cutoffDate } },
            { createdAt: { $lt: cutoffDate } },
        ],
    });
    return result.deletedCount || 0;
}

/** Indexes for tenant listing and retention purge. */
async function ensureIndexes() {
    const coll = historyCollection();
    await coll.createIndex({ connectionId: 1, timestamp: -1 });
    await coll.createIndex({ timestamp: 1 });
}

module.exports = {
    record,
    listRecent,
    rename,
    update,
    remove,
    purgeOlderThan,
    ensureIndexes,
    relativeTimeLabel,
};

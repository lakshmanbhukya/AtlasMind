const { MongoClient } = require('mongodb');
const { getConnectionById } = require('../models/UserConnection');
const { decrypt } = require('../utils/encryption');

/**
 * User DB Connection Pool
 *
 * Caches MongoClient instances per connectionId so that repeat queries from
 * the same user reuse an already-established connection instead of paying the
 * ~150-350 ms TCP + TLS + Auth overhead on every request.
 *
 * Design:
 *   Map<connectionId, { client, db, lastUsed }>
 *   - Idle entries are evicted after IDLE_TTL_MS (default 5 min).
 *   - Total cached clients are capped at MAX_CACHED_CLIENTS (default 50).
 *     When the cap is reached, the least-recently-used entry is evicted.
 *   - A lightweight `ping` verifies liveness before returning a cached db.
 *
 * This mirrors the schemaCache pattern in schemaProfiler.js and the central
 * DB singleton in db/connection.js.
 */

/** @type {Map<string, { client: MongoClient, db: import('mongodb').Db, lastUsed: number }>} */
const pool = new Map();

const IDLE_TTL_MS = Number(process.env.USER_DB_IDLE_TTL_MS) || 5 * 60 * 1000;      // 5 minutes
const MAX_CACHED_CLIENTS = Number(process.env.USER_DB_MAX_CLIENTS) || 50;
const EVICTION_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

/** @type {NodeJS.Timeout|null} */
let evictionTimer = null;

/**
 * Get (or create) a connected Db handle for a user's database.
 *
 * @param {string} connectionId — The hashed connection identifier from the JWT.
 * @returns {Promise<import('mongodb').Db>}
 * @throws {Error} If the connection record is not found or the URI is invalid.
 */
async function getUserDb(connectionId) {
    const now = Date.now();

    // ── Cache hit ──────────────────────────────────────────────────────────
    if (pool.has(connectionId)) {
        const entry = pool.get(connectionId);
        entry.lastUsed = now;

        // Lightweight liveness check — if the connection died (failover, timeout),
        // evict and fall through to create a fresh one.
        try {
            await entry.db.admin().ping();
            return entry.db;
        } catch {
            console.warn(`⚠️ [UserDbPool] Stale connection for ${connectionId.slice(0, 8)}…, reconnecting.`);
            await safeClose(entry.client);
            pool.delete(connectionId);
        }
    }

    // ── Cache miss — create new client ─────────────────────────────────────

    // Enforce max-client cap: evict least-recently-used entry if at capacity.
    if (pool.size >= MAX_CACHED_CLIENTS) {
        evictLRU();
    }

    const userConn = await getConnectionById(connectionId);
    if (!userConn) {
        throw Object.assign(new Error('Connection not found or inactive'), { statusCode: 404 });
    }

    const uri = decrypt(userConn.encryptedUri);

    const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 5,          // Slightly larger pool per-client for concurrent requests
        minPoolSize: 1,
        connectTimeoutMS: 10000,
    });

    await client.connect();
    const db = client.db(userConn.dbName);

    pool.set(connectionId, { client, db, lastUsed: now });

    console.log(
        `✅ [UserDbPool] New connection cached for ${connectionId.slice(0, 8)}… ` +
        `(db: ${userConn.dbName}, pool size: ${pool.size}/${MAX_CACHED_CLIENTS})`
    );

    // Ensure eviction timer is running
    startEvictionTimer();

    return db;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Evict the least-recently-used entry from the pool.
 */
function evictLRU() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of pool) {
        if (entry.lastUsed < oldestTime) {
            oldestTime = entry.lastUsed;
            oldestKey = key;
        }
    }

    if (oldestKey) {
        const entry = pool.get(oldestKey);
        pool.delete(oldestKey);
        safeClose(entry.client);
        console.log(`🧹 [UserDbPool] Evicted LRU connection ${oldestKey.slice(0, 8)}… (pool size: ${pool.size})`);
    }
}

/**
 * Periodic sweep: close and remove entries idle for longer than IDLE_TTL_MS.
 */
function evictIdleEntries() {
    const now = Date.now();
    for (const [key, entry] of pool) {
        if (now - entry.lastUsed > IDLE_TTL_MS) {
            pool.delete(key);
            safeClose(entry.client);
            console.log(`🧹 [UserDbPool] Evicted idle connection ${key.slice(0, 8)}… (idle ${Math.round((now - entry.lastUsed) / 1000)}s)`);
        }
    }

    // Stop timer if pool is empty to avoid unnecessary wakeups.
    if (pool.size === 0) {
        stopEvictionTimer();
    }
}

/**
 * Start the background eviction timer (idempotent).
 */
function startEvictionTimer() {
    if (evictionTimer) return;
    evictionTimer = setInterval(evictIdleEntries, EVICTION_INTERVAL_MS);
    // Unref so the timer doesn't prevent graceful Node.js shutdown.
    if (typeof evictionTimer.unref === 'function') {
        evictionTimer.unref();
    }
}

/**
 * Stop the background eviction timer.
 */
function stopEvictionTimer() {
    if (evictionTimer) {
        clearInterval(evictionTimer);
        evictionTimer = null;
    }
}

/**
 * Close a MongoClient without throwing.
 * @param {MongoClient} client
 */
async function safeClose(client) {
    try {
        await client.close();
    } catch (err) {
        console.warn(`⚠️ [UserDbPool] Error closing client: ${err.message}`);
    }
}

/**
 * Gracefully close ALL cached connections.
 * Call this on server shutdown (SIGTERM/SIGINT).
 */
async function cleanupPool() {
    stopEvictionTimer();

    const entries = [...pool.entries()];
    pool.clear();

    if (entries.length === 0) return;

    console.log(`🔌 [UserDbPool] Closing ${entries.length} cached connection(s)…`);
    await Promise.allSettled(entries.map(([, entry]) => safeClose(entry.client)));
    console.log(`🔌 [UserDbPool] All user DB connections closed.`);
}

/**
 * Get the current pool size (useful for health checks / diagnostics).
 * @returns {number}
 */
function getPoolSize() {
    return pool.size;
}

module.exports = { getUserDb, cleanupPool, getPoolSize };

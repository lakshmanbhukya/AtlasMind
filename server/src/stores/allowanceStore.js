// @ts-check
'use strict';

const connection = require('../db/connection');
const { requireTenant } = require('./tenant');
const log = require('../utils/logger').logger.child({ module: 'allowanceStore' });

/**
 * Allowance store: the only module that touches the central `groq_allowance`
 * collection, the ledger for the managed (AtlasMind-paid) Groq key.
 *
 * One document per UTC day holds both scopes, so a single conditional
 * updateOne is atomic on any deployment (standalone, replica set, Atlas)
 * without transactions:
 *
 *   { _id: '2026-11-22', tokens, audioSeconds,
 *     conn: { '<connectionId>': { tokens, audioSeconds } }, expiresAt }
 *
 * `expiresAt` (a TTL index) drops a day's document a week after it ends.
 */

const COLLECTION = 'groq_allowance';
const RETENTION_DAYS = 8;
/** connectionIds are hex hashes; anything else could break out of the `conn.<id>` path. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DUPLICATE_KEY = 11000;

/** @typedef {'tokens'|'audioSeconds'} Unit */

function ledger() {
    return connection.getDb().collection(COLLECTION);
}

/** Ensure the TTL index exists. Logs and continues on failure. */
async function initializeIndexes() {
    try {
        await ledger().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        log.info({ collection: COLLECTION }, 'Initialized indexes');
    } catch (err) {
        log.error({ err, collection: COLLECTION }, 'Failed to initialize indexes');
    }
}

/** @param {Date} [now] @returns {string} the UTC calendar day, e.g. '2026-11-22' */
function dayKey(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

/** @param {string} day @returns {Date} the next UTC midnight after `day` begins */
function dayEnd(day) {
    const start = new Date(`${day}T00:00:00.000Z`);
    return new Date(start.getTime() + 24 * 3600 * 1000);
}

/** @param {string} connectionId @param {string} operation */
function connPath(connectionId, operation) {
    requireTenant(connectionId, operation);
    if (!SAFE_ID.test(connectionId)) throw new Error(`unsafe connectionId for ${operation}`);
    return `conn.${connectionId}`;
}

/** @param {Unit} unit */
function assertUnit(unit) {
    if (unit !== 'tokens' && unit !== 'audioSeconds') throw new Error(`unknown allowance unit: ${unit}`);
}

/** Create the day document if it is missing. Racing creators are fine. */
async function ensureDay(day) {
    try {
        await ledger().updateOne(
            { _id: /** @type {any} */ (day) },
            {
                $setOnInsert: {
                    tokens: 0,
                    audioSeconds: 0,
                    conn: {},
                    expiresAt: new Date(dayEnd(day).getTime() + RETENTION_DAYS * 24 * 3600 * 1000),
                },
            },
            { upsert: true }
        );
    } catch (err) {
        if (!(err && err.code === DUPLICATE_KEY)) throw err;
    }
}

/**
 * Reserve `amount` of `unit` for a connection, only if neither the global nor
 * the connection limit would be exceeded. `limits === null` records the
 * amount without checking (observe mode).
 * @param {{ day: string, connectionId: string, unit: Unit, amount: number, limits: { global: number, connection: number }|null }} input
 * @returns {Promise<boolean>} false when a limit would be exceeded
 */
async function reserve({ day, connectionId, unit, amount, limits }) {
    const path = `${connPath(connectionId, 'reserving managed allowance')}.${unit}`;
    assertUnit(unit);
    // The connection filter below matches a missing field, so an amount larger
    // than a whole limit must be refused here.
    if (limits && (amount > limits.global || amount > limits.connection)) return false;
    await ensureDay(day);
    /** @type {Record<string, any>} */
    const filter = { _id: day };
    if (limits) {
        filter[unit] = { $lte: limits.global - amount };
        // A connection with no usage yet has no field: $not/$gt matches it.
        filter[path] = { $not: { $gt: limits.connection - amount } };
    }
    const result = await ledger().updateOne(filter, { $inc: { [unit]: amount, [path]: amount } });
    return result.modifiedCount > 0;
}

/**
 * Correct a reservation on its original day by `delta` (actual − estimate).
 * @param {{ day: string, connectionId: string, unit: Unit, delta: number }} input
 */
async function adjust({ day, connectionId, unit, delta }) {
    const path = `${connPath(connectionId, 'settling managed allowance')}.${unit}`;
    assertUnit(unit);
    if (!delta) return;
    await ledger().updateOne({ _id: /** @type {any} */ (day) }, { $inc: { [unit]: delta, [path]: delta } });
}

/**
 * Usage so far today, globally and for one connection.
 * @param {{ day: string, connectionId: string }} input
 * @returns {Promise<{ tokens: number, audioSeconds: number, connTokens: number, connAudioSeconds: number }>}
 */
async function usage({ day, connectionId }) {
    connPath(connectionId, 'reading managed allowance');
    const doc = await ledger().findOne({ _id: /** @type {any} */ (day) });
    const conn = (doc && doc.conn && doc.conn[connectionId]) || {};
    return {
        tokens: (doc && doc.tokens) || 0,
        audioSeconds: (doc && doc.audioSeconds) || 0,
        connTokens: conn.tokens || 0,
        connAudioSeconds: conn.audioSeconds || 0,
    };
}

module.exports = { COLLECTION, initializeIndexes, dayKey, dayEnd, reserve, adjust, usage };

// @ts-check
'use strict';

/**
 * Migration 001 (F15): re-key every connection from
 * `hashString(connectionString)` to `connectionIdFor(connectionString, dbName)`.
 *
 *   npm run migrate:connection-ids -- --dry-run   # report only, writes nothing
 *   npm run migrate:connection-ids                # apply
 *
 * For each `user_connections` doc it moves the tenant rows in TENANT_COLLECTIONS
 * from the old ID to the new one, then updates the doc itself last. Re-running
 * is safe: a doc already on its new ID is skipped, and a run interrupted
 * between the two steps finishes on the next run (the doc still has the old ID,
 * so the remaining tenant rows are moved). Global few-shot seeds
 * (`connectionId: null` or missing) never match an exact ID and are not touched.
 *
 * This is a one-off ops script, so it reads the central collections directly;
 * at runtime the tenant stores remain the only access path. It logs counts and
 * hashed IDs only, never connection strings.
 *
 * Existing sessions carry the old ID. After the migration `/api/auth/me` answers
 * 401 `connection_not_found` and clears the cookie, so users reconnect once.
 * In-flight write-approval tokens (10-minute life) stop working.
 */

const { decrypt: defaultDecrypt, connectionIdFor: defaultConnectionIdFor } = require('../../utils/encryption');

const TENANT_COLLECTIONS = Object.freeze(['query_history', 'dashboards', 'workspaces', 'few_shot_examples']);

const short = (id) => `${String(id).slice(0, 12)}…`;

/**
 * @param {import('mongodb').Db} db - the central database
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - count what would move, write nothing
 * @param {(line: string) => void} [options.log]
 * @param {(encrypted: string) => string} [options.decrypt] - injectable for tests
 * @param {(uri: string, dbName: string) => string} [options.connectionIdFor] - injectable for tests
 * @returns {Promise<{ total: number, migrated: number, skipped: number, failed: number, moved: Record<string, number> }>}
 */
async function migrate(db, {
    dryRun = false,
    log = console.log,
    decrypt = defaultDecrypt,
    connectionIdFor = defaultConnectionIdFor,
} = {}) {
    const connections = db.collection('user_connections');
    const summary = { total: 0, migrated: 0, skipped: 0, failed: 0, moved: {} };
    for (const name of TENANT_COLLECTIONS) summary.moved[name] = 0;

    const docs = await connections.find({}, { projection: { _id: 1, connectionId: 1, encryptedUri: 1, dbName: 1 } }).toArray();

    for (const doc of docs) {
        summary.total += 1;
        const oldId = doc.connectionId;

        let newId;
        try {
            if (!doc.dbName) throw new Error('missing dbName');
            newId = connectionIdFor(decrypt(doc.encryptedUri), doc.dbName);
        } catch (err) {
            summary.failed += 1;
            log(`  ! ${short(oldId)} skipped: cannot compute new ID (${err.message})`);
            continue;
        }

        if (newId === oldId) {
            summary.skipped += 1;
            continue;
        }

        const counts = {};
        for (const name of TENANT_COLLECTIONS) {
            const collection = db.collection(name);
            counts[name] = dryRun
                ? await collection.countDocuments({ connectionId: oldId })
                : (await collection.updateMany({ connectionId: oldId }, { $set: { connectionId: newId } })).modifiedCount;
            summary.moved[name] += counts[name];
        }

        if (!dryRun) {
            await connections.updateOne({ _id: doc._id, connectionId: oldId }, { $set: { connectionId: newId } });
        }

        summary.migrated += 1;
        const detail = TENANT_COLLECTIONS.map((name) => `${name}=${counts[name]}`).join(' ');
        log(`  ${dryRun ? 'would move' : 'moved'} ${short(oldId)} -> ${short(newId)} (${detail})`);
    }

    return summary;
}

async function main() {
    require('dotenv').config();
    const { connectToDatabase, closeConnection } = require('../connection');
    const dryRun = process.argv.includes('--dry-run');

    console.log(`Migration 001: connectionId = hash(uri + dbName)${dryRun ? ' [DRY RUN, nothing is written]' : ''}`);
    const db = await connectToDatabase();
    try {
        const s = await migrate(db, { dryRun });
        console.log(`Done. connections=${s.total} ${dryRun ? 'to migrate' : 'migrated'}=${s.migrated} already-migrated=${s.skipped} failed=${s.failed}`);
        console.log(`Tenant rows ${dryRun ? 'to move' : 'moved'}: ${TENANT_COLLECTIONS.map((n) => `${n}=${s.moved[n]}`).join(' ')}`);
        if (s.failed > 0) process.exitCode = 1;
    } finally {
        await closeConnection();
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Migration failed:', err.message);
        process.exit(1);
    });
}

module.exports = { migrate, TENANT_COLLECTIONS };

'use strict';

const { encrypt, hashString, connectionIdFor } = require('../utils/encryption');
const { migrate, TENANT_COLLECTIONS } = require('../db/migrations/001-connection-id-with-db');

/** Minimal in-memory stand-in for the central Db: only what the migration calls. */
function fakeDb(seed) {
    const data = {};
    for (const [name, rows] of Object.entries(seed)) data[name] = rows.map((r) => ({ ...r }));
    const matches = (row, filter) => Object.entries(filter).every(([k, v]) => row[k] === v);
    const db = {
        data,
        writes: 0,
        collection(name) {
            data[name] = data[name] || [];
            const rows = data[name];
            return {
                find: () => ({ toArray: async () => rows.map((r) => ({ ...r })) }),
                countDocuments: async (filter) => rows.filter((r) => matches(r, filter)).length,
                updateMany: async (filter, { $set }) => {
                    db.writes += 1;
                    const hit = rows.filter((r) => matches(r, filter));
                    hit.forEach((r) => Object.assign(r, $set));
                    return { modifiedCount: hit.length };
                },
                updateOne: async (filter, { $set }) => {
                    db.writes += 1;
                    const hit = rows.find((r) => matches(r, filter));
                    if (hit) Object.assign(hit, $set);
                    return { modifiedCount: hit ? 1 : 0 };
                },
            };
        },
    };
    return db;
}

const URI_A = 'mongodb://user:pass@cluster-a:27017';
const URI_B = 'mongodb+srv://u:p@cluster-b.example.net';
const OLD_A = hashString(URI_A);
const OLD_B = hashString(URI_B);
const NEW_A = connectionIdFor(URI_A, 'shop');
const NEW_B = connectionIdFor(URI_B, 'analytics');

function seed() {
    return {
        user_connections: [
            { _id: 1, connectionId: OLD_A, encryptedUri: encrypt(URI_A), dbName: 'shop' },
            { _id: 2, connectionId: OLD_B, encryptedUri: encrypt(URI_B), dbName: 'analytics' },
        ],
        query_history: [{ connectionId: OLD_A }, { connectionId: OLD_A }, { connectionId: OLD_B }],
        dashboards: [{ connectionId: OLD_A, shareToken: 't1' }],
        workspaces: [{ connectionId: OLD_B, name: 'Sales' }],
        few_shot_examples: [{ connectionId: OLD_A }, { connectionId: null }, { question: 'global seed' }],
    };
}

const silent = () => {};

describe('migration 001: connectionId = hash(uri + dbName) (F15)', () => {
    test('re-keys user_connections and every tenant collection', async () => {
        const db = fakeDb(seed());
        const summary = await migrate(db, { log: silent });

        expect(summary).toMatchObject({ total: 2, migrated: 2, skipped: 0, failed: 0 });
        expect(summary.moved).toEqual({ query_history: 3, dashboards: 1, workspaces: 1, few_shot_examples: 1 });
        expect(db.data.user_connections.map((c) => c.connectionId)).toEqual([NEW_A, NEW_B]);
        expect(db.data.query_history.map((r) => r.connectionId)).toEqual([NEW_A, NEW_A, NEW_B]);
        expect(db.data.dashboards[0]).toEqual({ connectionId: NEW_A, shareToken: 't1' });
        expect(db.data.workspaces[0].connectionId).toBe(NEW_B);

        // No row is left on an old ID anywhere.
        for (const name of TENANT_COLLECTIONS) {
            expect(db.data[name].some((r) => r.connectionId === OLD_A || r.connectionId === OLD_B)).toBe(false);
        }
    });

    test('leaves global few-shot seeds alone', async () => {
        const db = fakeDb(seed());
        await migrate(db, { log: silent });
        expect(db.data.few_shot_examples).toEqual([
            { connectionId: NEW_A },
            { connectionId: null },
            { question: 'global seed' },
        ]);
    });

    test('--dry-run counts what would move and writes nothing', async () => {
        const db = fakeDb(seed());
        const before = JSON.stringify(db.data);
        const summary = await migrate(db, { dryRun: true, log: silent });

        expect(summary).toMatchObject({ total: 2, migrated: 2, failed: 0 });
        expect(summary.moved).toEqual({ query_history: 3, dashboards: 1, workspaces: 1, few_shot_examples: 1 });
        expect(db.writes).toBe(0);
        expect(JSON.stringify(db.data)).toBe(before);
    });

    test('is idempotent: a second run changes nothing', async () => {
        const db = fakeDb(seed());
        await migrate(db, { log: silent });
        const after = JSON.stringify(db.data);
        db.writes = 0;

        const summary = await migrate(db, { log: silent });
        expect(summary).toMatchObject({ total: 2, migrated: 0, skipped: 2 });
        expect(db.writes).toBe(0);
        expect(JSON.stringify(db.data)).toBe(after);
    });

    test('finishes a run that was interrupted before the connection doc was updated', async () => {
        const data = seed();
        // Tenant rows for A already moved, but user_connections still holds OLD_A.
        data.query_history = [{ connectionId: NEW_A }, { connectionId: OLD_A }, { connectionId: OLD_B }];
        const db = fakeDb(data);

        await migrate(db, { log: silent });
        expect(db.data.user_connections[0].connectionId).toBe(NEW_A);
        expect(db.data.query_history.map((r) => r.connectionId)).toEqual([NEW_A, NEW_A, NEW_B]);
    });

    test('skips a doc it cannot decrypt, reports it, and migrates the rest', async () => {
        const data = seed();
        data.user_connections[0].encryptedUri = 'v2:not:valid';
        const db = fakeDb(data);
        const lines = [];

        const summary = await migrate(db, { log: (l) => lines.push(l) });
        expect(summary).toMatchObject({ migrated: 1, failed: 1 });
        expect(db.data.user_connections[0].connectionId).toBe(OLD_A);
        expect(db.data.user_connections[1].connectionId).toBe(NEW_B);
        // Logs never contain a connection string.
        expect(lines.join('\n')).not.toMatch(/mongodb/);
    });
});

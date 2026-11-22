'use strict';

/**
 * The allowance ledger and the credential store against a real MongoDB.
 *
 * The other suites use test-support/fakeMongo.js, which cannot prove how real
 * Mongo evaluates `$not: { $gt }` on a dotted path, unique-index races or TTL
 * indexes. This suite does. It is skipped unless ALLOWANCE_TEST_MONGODB_URI is
 * set (CI has no database); see docs/DEVELOPMENT.md. Each run uses its own
 * throwaway database (`atlasmind_test_<random>`) and drops it afterwards.
 *
 * Optional: ALLOWANCE_TEST_DNS=8.8.8.8,1.1.1.1 when the local resolver refuses
 * mongodb+srv SRV lookups.
 */

const crypto = require('crypto');

const URI = process.env.ALLOWANCE_TEST_MONGODB_URI;
const describeMongo = URI ? describe : describe.skip;

let mockDb = null;
jest.mock('../db/connection', () => ({
    getDb: () => {
        if (!mockDb) throw new Error('test database not connected');
        return mockDb;
    },
}));

const store = require('../stores/allowanceStore');
const credentialStore = require('../stores/providerCredentialStore');

describeMongo('real MongoDB', () => {
    jest.setTimeout(60_000);

    let client;
    const dbName = `atlasmind_test_${crypto.randomBytes(6).toString('hex')}`;

    beforeAll(async () => {
        if (process.env.ALLOWANCE_TEST_DNS) {
            require('dns').setServers(process.env.ALLOWANCE_TEST_DNS.split(',').map((s) => s.trim()).filter(Boolean));
        }
        const { MongoClient } = require('mongodb');
        client = new MongoClient(/** @type {string} */ (URI), { maxPoolSize: 20 });
        await client.connect();
        mockDb = client.db(dbName);
    });

    afterAll(async () => {
        if (mockDb) await mockDb.dropDatabase().catch(() => {});
        mockDb = null;
        if (client) await client.close();
    });

    /** A fresh day key per test, so tests don't share a ledger document. */
    let n = 0;
    const freshDay = () => `2099-01-${String((n += 1)).padStart(2, '0')}`;

    describe('allowance ledger', () => {
        test('50 parallel reservations on one connection never exceed the connection cap', async () => {
            const day = freshDay();
            const limits = { global: 1_000_000, connection: 1000 };
            const results = await Promise.all(
                Array.from({ length: 50 }, () => store.reserve({ day, connectionId: 'connA', unit: 'tokens', amount: 70, limits }))
            );
            const granted = results.filter(Boolean).length;
            const used = await store.usage({ day, connectionId: 'connA' });
            expect(granted).toBe(Math.floor(1000 / 70)); // 14
            expect(used.connTokens).toBe(granted * 70);
            expect(used.connTokens).toBeLessThanOrEqual(limits.connection);
            expect(used.tokens).toBe(used.connTokens);
        });

        test('50 parallel reservations across connections never exceed the global cap', async () => {
            const day = freshDay();
            const limits = { global: 1000, connection: 400 };
            const ids = ['c1', 'c2', 'c3', 'c4', 'c5'];
            const results = await Promise.all(
                Array.from({ length: 50 }, (_, i) =>
                    store.reserve({ day, connectionId: ids[i % ids.length], unit: 'tokens', amount: 60, limits })
                )
            );
            const granted = results.filter(Boolean).length;
            const per = await Promise.all(ids.map((connectionId) => store.usage({ day, connectionId })));
            const total = per[0].tokens;
            expect(total).toBe(granted * 60);
            expect(total).toBeLessThanOrEqual(limits.global);
            expect(granted).toBe(Math.floor(1000 / 60)); // 16
            per.forEach((u) => expect(u.connTokens).toBeLessThanOrEqual(limits.connection));
            expect(per.reduce((sum, u) => sum + u.connTokens, 0)).toBe(total);
        });

        test('a connection with no usage yet passes the $not/$gt filter on the dotted path', async () => {
            const day = freshDay();
            const limits = { global: 1000, connection: 100 };
            expect(await store.reserve({ day, connectionId: 'fresh', unit: 'audioSeconds', amount: 100, limits })).toBe(true);
            expect(await store.reserve({ day, connectionId: 'fresh', unit: 'audioSeconds', amount: 1, limits })).toBe(false);
            expect(await store.reserve({ day, connectionId: 'other', unit: 'audioSeconds', amount: 1, limits })).toBe(true);
        });

        test('concurrent first writers of a day all succeed (E11000 in ensureDay is absorbed)', async () => {
            const day = freshDay();
            const limits = { global: 1_000_000, connection: 1_000_000 };
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => store.reserve({ day, connectionId: `r${i}`, unit: 'tokens', amount: 1, limits }))
            );
            expect(results.every(Boolean)).toBe(true);
            const docs = await mockDb.collection(store.COLLECTION).find({ _id: day }).toArray();
            expect(docs).toHaveLength(1);
            expect(docs[0].tokens).toBe(20);
            expect(docs[0].expiresAt).toBeInstanceOf(Date);
        });

        test('adjust settles against the original day', async () => {
            const day = freshDay();
            await store.reserve({ day, connectionId: 'adj', unit: 'tokens', amount: 100, limits: { global: 1000, connection: 1000 } });
            await store.adjust({ day, connectionId: 'adj', unit: 'tokens', delta: -40 });
            expect(await store.usage({ day, connectionId: 'adj' })).toMatchObject({ tokens: 60, connTokens: 60 });
        });

        test('initializeIndexes creates the TTL index', async () => {
            await store.initializeIndexes();
            const indexes = await mockDb.collection(store.COLLECTION).indexes();
            expect(indexes).toEqual(
                expect.arrayContaining([expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 })])
            );
        });
    });

    describe('credential store', () => {
        const KEY = 'gsk_real_mongo_test_key';
        const later = () => new Date(Date.now() + 3600_000);

        beforeAll(async () => {
            await credentialStore.initializeIndexes();
        });

        test('the unique and TTL indexes exist', async () => {
            const indexes = await mockDb.collection(credentialStore.COLLECTION).indexes();
            expect(indexes).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ key: { connectionId: 1, sessionId: 1 }, unique: true }),
                    expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
                ])
            );
        });

        test('save, read, delete', async () => {
            expect(await credentialStore.saveKey('conn', 'sid-1', { apiKey: KEY, expiresAt: later() })).toBe(true);
            expect(await credentialStore.getActiveKey('conn', 'sid-1')).toMatchObject({ apiKey: KEY, keyLast4: '_key' });
            const raw = await mockDb.collection(credentialStore.COLLECTION).findOne({ sessionId: 'sid-1' });
            expect(JSON.stringify(raw)).not.toContain(KEY);
            await credentialStore.deleteKey('conn', 'sid-1');
            expect(await credentialStore.getActiveKey('conn', 'sid-1')).toBeNull();
        });

        test('after revoke, a save hits the unique index and returns false; no key is readable', async () => {
            await credentialStore.saveKey('conn', 'sid-2', { apiKey: KEY, expiresAt: later() });
            await credentialStore.revoke('conn', 'sid-2', later());
            expect(await credentialStore.saveKey('conn', 'sid-2', { apiKey: KEY, expiresAt: later() })).toBe(false);
            expect(await credentialStore.getActiveKey('conn', 'sid-2')).toBeNull();
            const docs = await mockDb.collection(credentialStore.COLLECTION).find({ connectionId: 'conn', sessionId: 'sid-2' }).toArray();
            expect(docs).toHaveLength(1);
            expect(docs[0]).toMatchObject({ revoked: true, encryptedKey: null, keyLast4: null, mode: 'managed' });
        });

        test('a revoke before any save leaves a tombstone that blocks a later save', async () => {
            await credentialStore.revoke('conn', 'sid-3', later());
            expect(await credentialStore.saveKey('conn', 'sid-3', { apiKey: KEY, expiresAt: later() })).toBe(false);
            expect(await credentialStore.setMode('conn', 'sid-3', 'personal')).toBe(false);
        });
    });
});

if (!URI) {
    test.skip('real-MongoDB suite: set ALLOWANCE_TEST_MONGODB_URI to run it', () => {});
}

'use strict';

const mockClients = [];
jest.mock('mongodb', () => {
    const actual = jest.requireActual('mongodb');
    class MongoClient {
        constructor(uri) {
            this.uri = uri;
            this.closed = false;
            mockClients.push(this);
        }
        async connect() {
            await new Promise((r) => setTimeout(r, 5));
        }
        db(name) {
            return { databaseName: name, admin: () => ({ ping: async () => ({ ok: 1 }) }) };
        }
        async close() {
            this.closed = true;
        }
    }
    return { ...actual, MongoClient };
});

const mockGetConnectionById = jest.fn();
jest.mock('../models/UserConnection', () => ({
    getConnectionById: (...a) => mockGetConnectionById(...a),
}));
jest.mock('../utils/encryption', () => ({ decrypt: (v) => `mongodb://decrypted/${v}` }));

const { getUserDb, evictUserDb, cleanupPool, getPoolSize } = require('../services/userDbPool');

beforeEach(async () => {
    await cleanupPool();
    mockClients.length = 0;
    mockGetConnectionById.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('concurrent cache misses share one client', async () => {
    mockGetConnectionById.mockResolvedValue({ encryptedUri: 'enc', dbName: 'shop' });

    const [a, b, c] = await Promise.all([getUserDb('conn-1'), getUserDb('conn-1'), getUserDb('conn-1')]);

    expect(mockClients).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(getPoolSize()).toBe(1);
});

test('evictUserDb closes the client so the next call picks up a changed dbName', async () => {
    mockGetConnectionById.mockResolvedValueOnce({ encryptedUri: 'enc', dbName: 'old_db' });
    const before = await getUserDb('conn-1');
    expect(before.databaseName).toBe('old_db');

    await evictUserDb('conn-1');
    expect(mockClients[0].closed).toBe(true);

    mockGetConnectionById.mockResolvedValueOnce({ encryptedUri: 'enc', dbName: 'new_db' });
    const after = await getUserDb('conn-1');
    expect(after.databaseName).toBe('new_db');
});

test('a failed creation is not cached and can be retried', async () => {
    mockGetConnectionById.mockResolvedValueOnce(null);
    await expect(getUserDb('conn-x')).rejects.toMatchObject({ statusCode: 404 });

    mockGetConnectionById.mockResolvedValueOnce({ encryptedUri: 'enc', dbName: 'shop' });
    await expect(getUserDb('conn-x')).resolves.toMatchObject({ databaseName: 'shop' });
});

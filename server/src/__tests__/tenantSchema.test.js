'use strict';

const mockGetUserDb = jest.fn();
jest.mock('../services/userDbPool', () => ({ getUserDb: (...a) => mockGetUserDb(...a) }));

const { getSchema, getUserCollections, listUserCollections } = require('../services/tenantSchema');
const { profileSchema, invalidateSchemaCache } = require('../services/schemaProfiler');
const { suggestCollections } = require('../services/scopeSuggestion');
const { TenantRequiredError } = require('../stores/tenant');
const { SYSTEM_COLLECTIONS } = require('../db/systemCollections');

function fakeDb(databaseName, collectionNames) {
    const listCollections = jest.fn(() => ({
        toArray: async () => collectionNames.map((name) => ({ name })),
    }));
    return {
        databaseName,
        listCollections,
        collection: () => ({
            estimatedDocumentCount: async () => 1,
            aggregate: () => ({ toArray: async () => [{ amount: 1 }] }),
        }),
    };
}

beforeEach(() => {
    invalidateSchemaCache();
    mockGetUserDb.mockReset();
});

describe('Tenant Schema', () => {
    test('requires a connectionId', async () => {
        await expect(getSchema(undefined)).rejects.toBeInstanceOf(TenantRequiredError);
        await expect(getUserCollections('')).rejects.toBeInstanceOf(TenantRequiredError);
        expect(mockGetUserDb).not.toHaveBeenCalled();
    });

    test('two tenants with the same database name get separate cache entries', async () => {
        const dbA = fakeDb('shop', ['orders']);
        const dbB = fakeDb('shop', ['invoices']);
        mockGetUserDb.mockImplementation(async (id) => (id === 'tenant-a' ? dbA : dbB));

        const a = await getSchema('tenant-a');
        const b = await getSchema('tenant-b');

        expect(a.collections.map((c) => c.name)).toEqual(['orders']);
        expect(b.collections.map((c) => c.name)).toEqual(['invoices']);
    });

    test('caches per tenant and honours forceRefresh', async () => {
        const db = fakeDb('shop', ['orders']);
        mockGetUserDb.mockResolvedValue(db);

        await getSchema('tenant-a');
        await getSchema('tenant-a');
        expect(db.listCollections).toHaveBeenCalledTimes(1);

        await getSchema('tenant-a', { forceRefresh: true });
        expect(db.listCollections).toHaveBeenCalledTimes(2);
    });

    test('profileSchema without a connectionId never caches', async () => {
        const db = fakeDb('shop', ['orders']);
        await profileSchema(db);
        await profileSchema(db);
        expect(db.listCollections).toHaveBeenCalledTimes(2);
    });

    test('profileSchema refuses to run without a database handle', async () => {
        await expect(profileSchema({ connectionId: 'x' })).rejects.toThrow(TypeError);
    });

    test('system collections are never reported as user collections', async () => {
        const db = fakeDb('shop', ['orders', ...SYSTEM_COLLECTIONS, 'system.users']);
        await expect(listUserCollections(db)).resolves.toEqual(['orders']);
    });
});

describe('suggestCollections', () => {
    const schema = {
        collections: [
            { name: 'orders', fields: [{ name: 'amount' }, { name: 'status' }] },
            { name: 'customers', fields: [{ name: 'city' }] },
            { name: 'logs', fields: [{ name: 'level' }] },
        ],
    };

    test('ranks name, singular, field and memory signals', () => {
        const result = suggestCollections('total order amount by customer city', schema, [
            { collection: 'customers' },
        ]);
        expect(result.map((r) => r.collection)).toEqual(['customers', 'orders']);
        expect(result[0].score).toBe(35 + 15 + 25);
        expect(result[1].score).toBe(35 + 15);
        expect(result[1].reasons).toContain('Field match ("amount")');
    });

    test('omits collections with no signal and caps scores at 100', () => {
        const result = suggestCollections('orders orders status amount', schema, [
            { collection: 'orders' }, { collection: 'orders' },
        ]);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ collection: 'orders', score: 100 });
    });
});

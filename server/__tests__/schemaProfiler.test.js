/**
 * Unit tests for schemaProfiler.js
 * Mocks MongoDB to test schema inference and caching logic.
 */
const {
    profileSchema,
    getMinifiedSchema,
    invalidateSchemaCache
} = require('../src/services/schemaProfiler');

// Mock db/connection
const mockCollection = {
    estimatedDocumentCount: jest.fn(),
    aggregate: jest.fn(),
};

const mockDb = {
    databaseName: 'test_db',
    listCollections: jest.fn(),
    collection: jest.fn().mockReturnValue(mockCollection),
};

jest.mock('../src/db/connection', () => ({
    getDb: jest.fn(() => mockDb),
}));

describe('schemaProfiler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        invalidateSchemaCache();
    });

    // ── profileSchema ───────────────────────────────────────────
    describe('profileSchema', () => {
        it('profiles user collections and ignores system ones', async () => {
            // Mock listCollections
            mockDb.listCollections.mockReturnValue({
                toArray: jest.fn().mockResolvedValue([
                    { name: 'users' },
                    { name: 'system.views' }, // Should be ignored
                    { name: 'dashboards' },   // Should be ignored (in SYSTEM_COLLECTIONS)
                    { name: 'orders' },
                ]),
            });

            // Mock document counts
            mockCollection.estimatedDocumentCount
                .mockResolvedValueOnce(100)  // users
                .mockResolvedValueOnce(50);  // orders

            // Mock sample docs for 'users'
            mockCollection.aggregate.mockReturnValueOnce({
                toArray: jest.fn().mockResolvedValue([
                    { name: 'Alice', age: 30, active: true },
                ]),
            });

            // Mock sample docs for 'orders'
            mockCollection.aggregate.mockReturnValueOnce({
                toArray: jest.fn().mockResolvedValue([
                    { _id: 'o1', total: 99.99, date: new Date('2024-01-01') },
                ]),
            });

            const schema = await profileSchema();

            expect(mockDb.listCollections).toHaveBeenCalled();
            expect(schema.database).toBe('test_db');
            expect(schema.collections).toHaveLength(2);

            const users = schema.collections.find(c => c.name === 'users');
            expect(users).toBeDefined();
            expect(users.documentCount).toBe(100);
            expect(users.fields).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: 'name', type: 'string' }),
                expect.objectContaining({ name: 'age', type: 'number' }),
                expect.objectContaining({ name: 'active', type: 'boolean' }),
            ]));

            const orders = schema.collections.find(c => c.name === 'orders');
            expect(orders).toBeDefined();
            expect(orders.fields).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: 'total', type: 'number' }),
                expect.objectContaining({ name: 'date', type: 'date' }),
            ]));
        });

        it('caches results', async () => {
            mockDb.listCollections.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

            await profileSchema();
            await profileSchema(); // Should hit cache

            expect(mockDb.listCollections).toHaveBeenCalledTimes(1);
        });

        it('forces refresh when requested', async () => {
            mockDb.listCollections.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

            await profileSchema();
            await profileSchema({ forceRefresh: true });

            expect(mockDb.listCollections).toHaveBeenCalledTimes(2);
        });
    });

    // ── getMinifiedSchema ───────────────────────────────────────
    describe('getMinifiedSchema', () => {
        it('returns a formatted string string', async () => {
            mockDb.listCollections.mockReturnValue({
                toArray: jest.fn().mockResolvedValue([{ name: 'products' }]),
            });

            mockCollection.estimatedDocumentCount.mockResolvedValue(10);
            mockCollection.aggregate.mockReturnValue({
                toArray: jest.fn().mockResolvedValue([
                    { name: 'Widget', tags: ['a', 'b'] },
                ]),
            });

            const minified = await getMinifiedSchema();

            expect(minified).toContain('Database: test_db');
            expect(minified).toContain('Collection: products (10 docs)');
            expect(minified).toContain('name (string)');
            expect(minified).toContain('tags (array)');
        });

        it('truncates long sample values', async () => {
            mockDb.listCollections.mockReturnValue({
                toArray: jest.fn().mockResolvedValue([{ name: 'logs' }]),
            });

            const longString = 'a'.repeat(100);
            mockCollection.aggregate.mockReturnValue({
                toArray: jest.fn().mockResolvedValue([{ message: longString }]),
            });
            mockCollection.estimatedDocumentCount.mockResolvedValue(1);

            const minified = await getMinifiedSchema();

            // Check truncation
            expect(minified).toContain('message (string)');
            expect(minified).toContain('...');
            expect(minified.length).toBeLessThan(longString.length + 100);
        });
    });
});

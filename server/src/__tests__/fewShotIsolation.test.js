const { getSimilarExamples, addExample, escapeRegex, buildExampleFilter } = require('../services/fewShotRetriever');
const { getDb } = require('../db/connection');

jest.mock('../db/connection', () => ({
    getDb: jest.fn(),
}));

describe('Phase 2: Few-Shot Memory Isolation & Filter Tests', () => {
    let mockFind;
    let mockInsertOne;
    let mockCollection;

    beforeEach(() => {
        mockFind = jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([
                    { natural_language: 'top products for tenant A', connectionId: 'conn-A', collection: 'products' },
                ]),
            }),
        });

        mockInsertOne = jest.fn().mockResolvedValue({ insertedId: '123' });

        mockCollection = {
            estimatedDocumentCount: jest.fn().mockResolvedValue(10),
            findOne: jest.fn().mockResolvedValue(null),
            insertOne: mockInsertOne,
            find: mockFind,
            aggregate: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([]),
            }),
        };

        getDb.mockReturnValue({
            collection: jest.fn().mockReturnValue(mockCollection),
        });
    });

    test('buildExampleFilter includes tenant connectionId and global seeded examples', () => {
        const filterWithConn = buildExampleFilter('conn-A');
        expect(filterWithConn.$or).toEqual([
            { connectionId: 'conn-A' },
            { connectionId: null },
            { connectionId: { $exists: false } },
        ]);

        const filterGlobalOnly = buildExampleFilter(null);
        expect(filterGlobalOnly.$or).toEqual([
            { connectionId: null },
            { connectionId: { $exists: false } },
        ]);
    });

    test('buildExampleFilter filters by collections when provided', () => {
        const filter = buildExampleFilter('conn-A', ['orders', 'customers']);
        expect(filter.$and).toBeDefined();
        expect(filter.$and).toContainEqual({
            collection: { $in: ['orders', 'customers'] },
        });
        expect(filter.$and).toContainEqual({
            $or: [
                { connectionId: 'conn-A' },
                { connectionId: null },
                { connectionId: { $exists: false } },
            ],
        });
    });

    test('escapeRegex escapes user-derived regex special characters', () => {
        const dangerousInput = 'price [100%]+ (sale*?^$)';
        const escaped = escapeRegex(dangerousInput);
        expect(escaped).toBe('price \\[100%\\]\\+ \\(sale\\*\\?\\^\\$\\)');
    });

    test('getSimilarExamples applies connectionId and collection scope to search query', async () => {
        await getSimilarExamples('top products', 3, 'conn-A', ['products']);

        expect(mockFind).toHaveBeenCalled();
        const queryArg = mockFind.mock.calls[0][0];

        // Should combine tenant filter and collection filter
        expect(queryArg.$and).toBeDefined();
        expect(queryArg.$and).toContainEqual(
            expect.objectContaining({
                $or: [
                    { connectionId: 'conn-A' },
                    { connectionId: null },
                    { connectionId: { $exists: false } },
                ],
            })
        );
        expect(queryArg.$and).toContainEqual({
            collection: { $in: ['products'] },
        });
        expect(queryArg.natural_language.$regex).toBeDefined();
    });

    test('addExample attaches connectionId to stored memory document', async () => {
        await addExample({
            naturalLanguage: 'top products',
            mqlPipeline: [{ $limit: 10 }],
            collection: 'products',
            connectionId: 'conn-A',
        });

        expect(mockInsertOne).toHaveBeenCalled();
        const insertedDoc = mockInsertOne.mock.calls[0][0];
        expect(insertedDoc.connectionId).toBe('conn-A');
        expect(insertedDoc.natural_language).toBe('top products');
    });
});

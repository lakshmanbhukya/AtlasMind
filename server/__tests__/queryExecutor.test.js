/**
 * Unit tests for queryExecutor.js
 * Mocks the MongoDB driver to test execution logic without a real DB.
 */
const { executePipeline, saveQueryHistory } = require('../src/services/queryExecutor');

// Mock db/connection
const mockCollection = {
    aggregate: jest.fn(),
    insertOne: jest.fn(),
};

const mockDb = {
    collection: jest.fn().mockReturnValue(mockCollection),
};

jest.mock('../src/db/connection', () => ({
    getDb: jest.fn(() => mockDb),
}));

describe('queryExecutor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ── executePipeline ─────────────────────────────────────────
    describe('executePipeline', () => {
        it('executes a pipeline and returns results', async () => {
            const mockResults = [{ _id: 1, total: 100 }];
            const mockToArray = jest.fn().mockResolvedValue(mockResults);

            mockCollection.aggregate.mockReturnValue({
                toArray: mockToArray,
            });

            const pipeline = [{ $match: {} }];
            const result = await executePipeline(mockDb, 'sales', pipeline);

            expect(mockDb.collection).toHaveBeenCalledWith('sales');
            expect(mockCollection.aggregate).toHaveBeenCalledWith(pipeline, expect.objectContaining({
                maxTimeMS: 30000,
                allowDiskUse: true,
            }));
            expect(result.results).toEqual(mockResults);
            expect(typeof result.executionTimeMs).toBe('number');
        });

        it('uses custom options when provided', async () => {
            const mockToArray = jest.fn().mockResolvedValue([]);
            mockCollection.aggregate.mockReturnValue({ toArray: mockToArray });

            await executePipeline(mockDb, 'sales', [], { maxTimeMS: 5000, allowDiskUse: false });

            expect(mockCollection.aggregate).toHaveBeenCalledWith([], {
                maxTimeMS: 5000,
                allowDiskUse: false,
            });
        });

        it('propagates errors from MongoDB', async () => {
            mockCollection.aggregate.mockReturnValue({
                toArray: jest.fn().mockRejectedValue(new Error('DB Connection Failed')),
            });

            await expect(executePipeline(mockDb, 'sales', []))
                .rejects.toThrow('DB Connection Failed');
        });
    });

    // ── saveQueryHistory ────────────────────────────────────────
    describe('saveQueryHistory', () => {
        it('saves successful query entry', async () => {
            const entry = {
                naturalLanguage: 'test query',
                generatedPipeline: [],
                collection: 'sales',
                resultCount: 5,
                executionTimeMs: 100,
            };

            await saveQueryHistory(entry);

            expect(mockDb.collection).toHaveBeenCalledWith('query_history');
            expect(mockCollection.insertOne).toHaveBeenCalledWith(expect.objectContaining({
                ...entry,
                timestamp: expect.any(Date),
            }));
        });

        it('swallows errors during save (logging only)', async () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
            mockCollection.insertOne.mockRejectedValue(new Error('Insert failed'));

            // Should not throw
            await saveQueryHistory({ naturalLanguage: 'test' });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to save query history'),
                'Insert failed'
            );
            consoleSpy.mockRestore();
        });
    });
});

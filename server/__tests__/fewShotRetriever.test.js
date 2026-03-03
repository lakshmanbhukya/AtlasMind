/**
 * Unit tests for fewShotRetriever.js
 * Tests the fallback logic: Vector -> Text Regex -> Random.
 */
const { getSimilarExamples } = require('../src/services/fewShotRetriever');

// Mock db/connection
const mockCollection = {
    estimatedDocumentCount: jest.fn(),
    aggregate: jest.fn(),
    find: jest.fn(),
};

const mockDb = {
    collection: jest.fn().mockReturnValue(mockCollection),
};

jest.mock('../src/db/connection', () => ({
    getDb: jest.fn(() => mockDb),
}));

describe('fewShotRetriever', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns empty array if collection is empty', async () => {
        mockCollection.estimatedDocumentCount.mockResolvedValue(0);
        const results = await getSimilarExamples('test query');
        expect(results).toEqual([]);
    });

    it('uses vector search if available (primary strategy)', async () => {
        mockCollection.estimatedDocumentCount.mockResolvedValue(100);

        // Mock successful vector search
        const mockVectorResults = [{ natural_language: 'similar query', score: 0.9 }];
        mockCollection.aggregate.mockReturnValueOnce({
            toArray: jest.fn().mockResolvedValue(mockVectorResults),
        });

        const results = await getSimilarExamples('show sales');

        // Check that it tried vector search pipeline ($search)
        const callArgs = mockCollection.aggregate.mock.calls[0][0];
        expect(callArgs[0]).toHaveProperty('$search');
        expect(results).toEqual(mockVectorResults);
    });

    it('falls back to text regex if vector search fails', async () => {
        mockCollection.estimatedDocumentCount.mockResolvedValue(100);

        // Vector search fails/returns empty
        mockCollection.aggregate.mockReturnValueOnce({
            toArray: jest.fn().mockResolvedValue([]), // Empty vector results
        });

        // Text search succeeds
        const mockTextResults = [{ natural_language: 'regex match' }];
        const mockFindLimit = {
            toArray: jest.fn().mockResolvedValue(mockTextResults),
        };
        mockCollection.find.mockReturnValue({
            limit: jest.fn().mockReturnValue(mockFindLimit),
        });

        const results = await getSimilarExamples('search keyword');

        expect(results).toEqual(mockTextResults);
        // Should have called find with regex
        expect(mockCollection.find).toHaveBeenCalledWith(
            expect.objectContaining({
                natural_language: expect.objectContaining({ $regex: expect.any(String) }),
            }),
            expect.any(Object)
        );
    });

    it('falls back to random sampling if text search yields no results', async () => {
        mockCollection.estimatedDocumentCount.mockResolvedValue(100);

        // Vector search returns empty
        mockCollection.aggregate.mockReturnValueOnce({
            toArray: jest.fn().mockResolvedValue([]),
        });

        // Text search returns empty
        mockCollection.find.mockReturnValue({
            limit: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([]),
            }),
        });

        // Random sampling (called via aggregate)
        const mockRandomResults = [{ natural_language: 'random 1' }];
        mockCollection.aggregate.mockReturnValueOnce({
            toArray: jest.fn().mockResolvedValue(mockRandomResults),
        });

        const results = await getSimilarExamples('gibberish query');

        expect(results).toEqual(mockRandomResults);
        // Check for $sample stage
        const lastAggregateCall = mockCollection.aggregate.mock.calls[1][0];
        expect(lastAggregateCall[0]).toHaveProperty('$sample');
    });

    it('handles database errors gracefully', async () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        mockCollection.estimatedDocumentCount.mockRejectedValue(new Error('DB Error'));

        await expect(getSimilarExamples('test')).rejects.toThrow('DB Error');
        consoleSpy.mockRestore();
    });
});

/**
 * Unit tests for groqService.js
 * Mocks the Groq SDK to test generateMQL logic without real API calls.
 */

// Set env var before importing module
process.env.GROQ_API_KEY = 'test-api-key-for-jest';

// Mock groq-sdk
jest.mock('groq-sdk', () => {
    const mockCreate = jest.fn();
    return jest.fn().mockImplementation(() => ({
        chat: {
            completions: { create: mockCreate },
        },
        audio: {
            transcriptions: { create: jest.fn() },
        },
    }));
});

const Groq = require('groq-sdk');
const { generateMQL } = require('../src/services/groqService');

// Helper to get the mocked create function
function getMockCreate() {
    const instance = new Groq({ apiKey: 'test' });
    return instance.chat.completions.create;
}

describe('generateMQL', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset module singleton by clearing its internal variable
        // We need to re-require to reset the singleton
    });

    const sampleSchema = 'Database: test\nCollection: sales';
    const fewShots = [];

    it('parses a valid JSON response from LLM', async () => {
        const mockResponse = {
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            pipeline: [{ $match: { status: 'active' } }],
                            collection: 'sales',
                            chartType: 'bar',
                            explanation: 'Filter active sales',
                        }),
                    },
                },
            ],
        };

        jest.resetModules();
        process.env.GROQ_API_KEY = 'test-api-key-for-jest';

        // Use doMock to avoid hoisting and allow access to local variables if needed
        // (though here we can just return the object directly)
        jest.doMock('groq-sdk', () => {
            return jest.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue(mockResponse),
                    },
                },
            }));
        });

        const { generateMQL: freshGenerate } = require('../src/services/groqService');
        const result = await freshGenerate('Show active sales', sampleSchema, fewShots);

        expect(result.pipeline).toEqual([{ $match: { status: 'active' } }]);
        expect(result.collection).toBe('sales');
        expect(result.chartType).toBe('bar');
        expect(result.explanation).toBe('Filter active sales');
    });

    it('throws when LLM returns empty response', async () => {
        jest.resetModules();
        process.env.GROQ_API_KEY = 'test-api-key-for-jest';
        jest.doMock('groq-sdk', () => {
            return jest.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [{ message: { content: '' } }],
                        }),
                    },
                },
            }));
        });

        const { generateMQL: freshGenerate } = require('../src/services/groqService');
        await expect(freshGenerate('test', sampleSchema, [])).rejects.toThrow('empty response');
    });

    it('throws when response is missing pipeline array', async () => {
        jest.resetModules();
        process.env.GROQ_API_KEY = 'test-api-key-for-jest';
        jest.doMock('groq-sdk', () => {
            return jest.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [{
                                message: {
                                    content: JSON.stringify({ collection: 'sales', chartType: 'bar' }),
                                },
                            }],
                        }),
                    },
                },
            }));
        });

        const { generateMQL: freshGenerate } = require('../src/services/groqService');
        await expect(freshGenerate('test', sampleSchema, [])).rejects.toThrow('pipeline');
    });

    it('defaults collection to empty string when not provided', async () => {
        jest.resetModules();
        process.env.GROQ_API_KEY = 'test-api-key-for-jest';
        jest.doMock('groq-sdk', () => {
            return jest.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [{
                                message: {
                                    content: JSON.stringify({
                                        pipeline: [{ $match: {} }],
                                        chartType: 'bar',
                                    }),
                                },
                            }],
                        }),
                    },
                },
            }));
        });

        const { generateMQL: freshGenerate } = require('../src/services/groqService');
        const result = await freshGenerate('test', sampleSchema, []);
        expect(result.collection).toBe('');
    });

    it('defaults chartType to table when not provided', async () => {
        jest.resetModules();
        process.env.GROQ_API_KEY = 'test-api-key-for-jest';
        jest.doMock('groq-sdk', () => {
            return jest.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [{
                                message: {
                                    content: JSON.stringify({
                                        pipeline: [{ $match: {} }],
                                        collection: 'orders',
                                    }),
                                },
                            }],
                        }),
                    },
                },
            }));
        });

        const { generateMQL: freshGenerate } = require('../src/services/groqService');
        const result = await freshGenerate('list orders', sampleSchema, []);
        expect(result.chartType).toBe('table');
    });

    it('extracts JSON from markdown code blocks', async () => {
        const jsonContent = JSON.stringify({
            pipeline: [{ $count: 'total' }],
            collection: 'items',
            chartType: 'table',
        });
        jest.resetModules();
        process.env.GROQ_API_KEY = 'test-api-key-for-jest';
        jest.doMock('groq-sdk', () => {
            return jest.fn().mockImplementation(() => ({
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [{
                                message: {
                                    content: '```json\n' + jsonContent + '\n```',
                                },
                            }],
                        }),
                    },
                },
            }));
        });

        const { generateMQL: freshGenerate } = require('../src/services/groqService');
        const result = await freshGenerate('count items', sampleSchema, []);
        expect(result.collection).toBe('items');
        expect(result.pipeline).toEqual([{ $count: 'total' }]);
    });
});

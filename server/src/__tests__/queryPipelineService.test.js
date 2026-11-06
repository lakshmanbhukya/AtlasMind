'use strict';

// Mock dependencies before requiring queryPipelineService
const mockUserDb = {
    databaseName: 'eval_test_db',
    listCollections: () => ({
        toArray: async () => [{ name: 'orders' }, { name: 'customers' }],
    }),
};

const mockGetUserDb = jest.fn().mockResolvedValue(mockUserDb);
jest.mock('../services/userDbPool', () => ({
    getUserDb: (...args) => mockGetUserDb(...args),
}));

const mockProfileSchema = jest.fn();
jest.mock('../services/schemaProfiler', () => ({
    ...jest.requireActual('../services/schemaProfiler'),
    profileSchema: (...args) => mockProfileSchema(...args),
}));

const mockGetSimilarExamples = jest.fn();
const mockAddExample = jest.fn();
jest.mock('../services/fewShotRetriever', () => ({
    ...jest.requireActual('../services/fewShotRetriever'),
    getSimilarExamples: (...args) => mockGetSimilarExamples(...args),
    addExample: (...args) => mockAddExample(...args),
}));

const mockGenerateMQL = jest.fn();
jest.mock('../services/groqService', () => ({
    ...jest.requireActual('../services/groqService'),
    generateMQL: (...args) => mockGenerateMQL(...args),
}));

const mockExecutePipeline = jest.fn();
const mockSaveQueryHistory = jest.fn();
jest.mock('../services/queryExecutor', () => ({
    ...jest.requireActual('../services/queryExecutor'),
    executePipeline: (...args) => mockExecutePipeline(...args),
}));
jest.mock('../stores/queryHistoryStore', () => ({
    record: (...args) => mockSaveQueryHistory(...args),
}));

const mockValidatePipeline = jest.fn((...args) => {
    const actual = jest.requireActual('../services/safetyGuard');
    return actual.validatePipeline(...args);
});
jest.mock('../services/safetyGuard', () => ({
    ...jest.requireActual('../services/safetyGuard'),
    validatePipeline: (...args) => mockValidatePipeline(...args),
}));

const { processNaturalLanguageQuery } = require('../services/queryPipelineService');

describe('queryPipelineService shim: legacy evalOptions map to an ExperimentConfig', () => {
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        process.env.JWT_SECRET = 'test-secret-123456';
        jest.clearAllMocks();

        mockGetUserDb.mockResolvedValue(mockUserDb);

        mockProfileSchema.mockResolvedValue({
            database: 'eval_test_db',
            collections: [
                {
                    name: 'orders',
                    fields: [
                        { name: 'order_id', type: 'string' },
                        { name: 'amount', type: 'number' },
                        { name: 'units', type: 'number' },
                    ],
                },
                {
                    name: 'customers',
                    fields: [
                        { name: 'customer_id', type: 'string' },
                        { name: 'name', type: 'string' },
                    ],
                },
            ],
        });

        mockGetSimilarExamples.mockResolvedValue([
            { natural_language: 'count orders', pipeline: [{ $count: 'total' }] },
        ]);

        mockGenerateMQL.mockResolvedValue({
            pipeline: [{ $match: { amount: { $gt: 50 } } }],
            collection: 'orders',
            chartType: 'table',
            explanation: 'Filtered orders',
            usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
            model: 'test-model-v1',
            retries: 0,
            timings: { llmMs: 45.2 },
        });

        mockExecutePipeline.mockResolvedValue({
            results: [{ _id: '1', amount: 100 }],
            executionTimeMs: 12.5,
        });
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('with an experiment (evalOptions)', () => {
        test('returns float ms timings, usage, model, and diagnostics', async () => {
            const res = await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
                evalOptions: {},
            });

            expect(res.statusCode).toBe(200);
            expect(res.response.diagnostics).toBeDefined();

            const { timings, usage, model, retries, gate, safety } = res.response.diagnostics;
            expect(typeof timings.totalMs).toBe('number');
            expect(typeof timings.llmMs).toBe('number');
            expect(typeof timings.dbMs).toBe('number');
            expect(typeof timings.validateMs).toBe('number');
            expect(typeof timings.schemaMs).toBe('number');
            expect(typeof timings.fewShotMs).toBe('number');
            expect(typeof timings.gateMs).toBe('number');

            expect(usage).toEqual({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 });
            expect(model).toBe('test-model-v1');
            expect(retries).toBe(0);
            expect(gate).toBeDefined();
            expect(safety).toBeDefined();
        });

        test('evalOptions.disableMemoryWrite prevents addExample when true', async () => {
            await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
                evalOptions: { disableMemoryWrite: true },
            });

            expect(mockAddExample).not.toHaveBeenCalled();
        });

        test('addExample IS called when results are non-empty and disableMemoryWrite is not set', async () => {
            await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
                evalOptions: {},
            });

            expect(mockAddExample).toHaveBeenCalledTimes(1);
        });

        test('addExample is NOT called when query execution returns empty results', async () => {
            mockExecutePipeline.mockResolvedValueOnce({
                results: [],
                executionTimeMs: 5.0,
            });

            await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
                evalOptions: {},
            });

            expect(mockAddExample).not.toHaveBeenCalled();
        });

        test('evalOptions.disableGate bypasses ambiguity check', async () => {
            // "top orders" has multiple numeric fields (amount, units) and vague term "top"
            const resWithGate = await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get the top orders',
                evalOptions: { disableGate: false },
            });
            expect(resWithGate.response.needsClarification).toBe(true);

            // Now with disableGate: true
            const resDisabledGate = await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get the top orders',
                evalOptions: { disableGate: true },
            });
            expect(resDisabledGate.response.needsClarification).toBe(false);
            expect(mockGenerateMQL).toHaveBeenCalled();
        });

        test('evalOptions.disableSchemaContext sends field names only without types/samples', async () => {
            await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
                evalOptions: { disableSchemaContext: true },
            });

            expect(mockGenerateMQL).toHaveBeenCalledWith(
                'get high value orders',
                expect.stringMatching(/Collection: orders[\s\S]*Fields: order_id, amount, units/),
                expect.any(Array),
                undefined,
                expect.any(Object)
            );
        });

        test('diagnostics.gate.reason is populated when gate is disabled or write query', async () => {
            const resDisabled = await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
                evalOptions: { disableGate: true },
            });
            expect(resDisabled.response.diagnostics.gate.reason).toBe('gate_disabled');

            const resWrite = await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'delete all orders',
                evalOptions: {},
            });
            expect(resWrite.response.diagnostics.gate.reason).toBe('write_intent');
        });

        test('evalOptions.fewShotLimit controls example limit', async () => {
            await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
                evalOptions: { fewShotLimit: 1 },
            });

            expect(mockGetSimilarExamples).toHaveBeenCalledWith(
                'get high value orders',
                1,
                'conn-1',
                null
            );
        });

        test('evalOptions.disableScope overrides collection restrictions', async () => {
            await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
                collections: ['orders'],
                evalOptions: { disableScope: true },
            });

            // Scoping should have been reset to all collections
            expect(mockGenerateMQL).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(Array),
                undefined,
                expect.objectContaining({ scopedCollections: [] })
            );
        });

        test('evalOptions.disableSafetyGuard bypasses safetyGuard validation', async () => {
            await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
                evalOptions: { disableSafetyGuard: true },
            });

            expect(mockValidatePipeline).not.toHaveBeenCalled();
            expect(mockExecutePipeline).toHaveBeenCalled();
        });

        test('evalOptions.model and temperature are passed to generateMQL', async () => {
            await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
                evalOptions: {
                    model: 'custom-eval-model',
                    temperature: 0.2,
                },
            });

            expect(mockGenerateMQL).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(Array),
                'custom-eval-model',
                expect.objectContaining({ temperature: 0.2 })
            );
        });
    });

    describe('production (no experiment)', () => {
        test('does NOT return diagnostics', async () => {
            const res = await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
            });

            expect(res.response.diagnostics).toBeUndefined();
        });

        test('EVAL_MODE=1 in the environment does not enable experiment behaviour', async () => {
            process.env.EVAL_MODE = '1';
            const res = await processNaturalLanguageQuery({
                connectionId: 'conn-1',
                text: 'get high value orders',
            });

            expect(res.response.diagnostics).toBeUndefined();
            expect(mockValidatePipeline).toHaveBeenCalled();
            expect(mockAddExample).toHaveBeenCalledTimes(1);
        });
    });
});

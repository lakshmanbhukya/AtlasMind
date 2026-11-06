'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Central DB mock
const mockApprovalTokensCollection = {
    createIndex: jest.fn().mockResolvedValue('ok'),
    insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
};
const mockCentralDb = {
    collection: jest.fn().mockImplementation((name) => {
        if (name === 'approval_tokens') return mockApprovalTokensCollection;
        return {
            insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
            find: jest.fn().mockReturnValue({ sort: () => ({ limit: () => ({ project: () => ({ toArray: () => [] }) }) }) }),
        };
    }),
};
jest.mock('../db/connection', () => ({
    getDb: jest.fn(() => mockCentralDb),
}));

// User DB mock
const mockUserDb = {
    databaseName: 'test_engine_db',
    listCollections: () => ({
        toArray: async () => [{ name: 'orders' }, { name: 'customers' }],
    }),
    collection: jest.fn().mockReturnValue({
        aggregate: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([{ modified: 1 }]),
        }),
    }),
};
const mockGetUserDb = jest.fn().mockResolvedValue(mockUserDb);
jest.mock('../services/userDbPool', () => ({
    getUserDb: (...args) => mockGetUserDb(...args),
}));

// Schema profiler mock
const mockProfileSchema = jest.fn();
jest.mock('../services/schemaProfiler', () => ({
    ...jest.requireActual('../services/schemaProfiler'),
    profileSchema: (...args) => mockProfileSchema(...args),
}));

// Few shot mock
const mockGetSimilarExamples = jest.fn();
const mockAddExample = jest.fn();
jest.mock('../services/fewShotRetriever', () => ({
    ...jest.requireActual('../services/fewShotRetriever'),
    getSimilarExamples: (...args) => mockGetSimilarExamples(...args),
    addExample: (...args) => mockAddExample(...args),
}));

// Groq service mock
const mockGenerateMQL = jest.fn();
jest.mock('../services/groqService', () => ({
    ...jest.requireActual('../services/groqService'),
    generateMQL: (...args) => mockGenerateMQL(...args),
}));

// Query executor mock
const mockExecutePipeline = jest.fn();
const mockSaveQueryHistory = jest.fn();
jest.mock('../services/queryExecutor', () => ({
    executePipeline: (...args) => mockExecutePipeline(...args),
}));
jest.mock('../stores/queryHistoryStore', () => ({
    record: (...args) => mockSaveQueryHistory(...args),
}));

const {
    QueryExecutionEngine,
    ValidationError,
    ScopeError,
    TokenExpiredError,
    UnauthorizedTokenError,
    TokenAlreadyUsedError,
    SafetyViolationError,
    ExecutionError,
    RateLimitError,
} = require('../services/queryExecutionEngine');

describe('QueryExecutionEngine Interface Tests', () => {
    const testSecret = 'engine-test-secret-32-chars-long-123456';
    const testConnectionId = 'test-conn-engine-1';

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JWT_SECRET = testSecret;

        mockGetUserDb.mockResolvedValue(mockUserDb);

        mockProfileSchema.mockResolvedValue({
            database: 'test_engine_db',
            collections: [
                {
                    name: 'orders',
                    fields: [
                        { name: 'amount', type: 'number' },
                        { name: 'status', type: 'string' },
                        { name: 'units', type: 'number' },
                    ],
                },
                {
                    name: 'customers',
                    fields: [
                        { name: 'name', type: 'string' },
                        { name: 'city', type: 'string' },
                    ],
                },
            ],
        });

        mockGetSimilarExamples.mockResolvedValue([]);

        mockGenerateMQL.mockResolvedValue({
            pipeline: [{ $match: { amount: { $gt: 100 } } }],
            collection: 'orders',
            chartType: 'table',
            explanation: 'Filtered orders with amount > 100',
        });

        mockExecutePipeline.mockResolvedValue({
            results: [{ _id: '1', amount: 150 }],
            executionTimeMs: 12,
        });
    });

    describe('executeNaturalLanguageQuery', () => {
        test('returns { type: "success", data } for valid query', async () => {
            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show high value orders',
            });

            expect(outcome.type).toBe('success');
            expect(outcome.data.success).toBe(true);
            expect(outcome.data.naturalLanguage).toBe('show high value orders');
            expect(outcome.data.pipeline).toEqual([
                { $match: { amount: { $gt: 100 } } },
                { $limit: 1000 },
            ]);
            expect(outcome.data.results).toEqual([{ _id: '1', amount: 150 }]);
            expect(mockExecutePipeline).toHaveBeenCalledTimes(1);
            expect(mockSaveQueryHistory).toHaveBeenCalledTimes(1);
        });

        test('returns { type: "clarification_required", data } for vague queries triggering ambiguity gate', async () => {
            // "top orders" has multiple numeric fields (amount, units) and vague term "top"
            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'get the top orders',
            });

            expect(outcome.type).toBe('clarification_required');
            expect(outcome.data.success).toBe(true);
            expect(outcome.data.needsClarification).toBe(true);
            expect(outcome.data.questions).toBeDefined();
            expect(outcome.data.questions.length).toBeGreaterThan(0);
            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        test('returns { type: "approval_required", approvalToken, data } for mutating write queries', async () => {
            mockGenerateMQL.mockResolvedValueOnce({
                pipeline: [{ $match: { status: 'cancelled' } }, { $out: 'archived_orders' }],
                collection: 'orders',
                chartType: 'table',
                explanation: 'Archive cancelled orders',
            });

            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'archive cancelled orders',
            });

            expect(outcome.type).toBe('approval_required');
            expect(outcome.approvalToken).toBeDefined();
            expect(outcome.data.success).toBe(true);
            expect(outcome.data.safetyStatus).toBe('approval-required');
            expect(outcome.data.safetyBlocked).toBe(false);
            expect(mockExecutePipeline).not.toHaveBeenCalled();

            // Verify the generated approvalToken
            const decoded = jwt.verify(outcome.approvalToken, testSecret);
            expect(decoded.connectionId).toBe(testConnectionId);
            expect(decoded.collection).toBe('orders');
            expect(decoded.type).toBe('write-approval');
            expect(decoded.jti).toBeDefined();
        });

        test('returns { type: "safety_blocked", data } for disallowed operations like system collections', async () => {
            mockGenerateMQL.mockResolvedValueOnce({
                pipeline: [{ $match: {} }],
                collection: 'system.users',
                chartType: 'table',
                explanation: 'Access system users',
            });

            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show system users',
            });

            expect(outcome.type).toBe('safety_blocked');
            expect(outcome.data.success).toBe(false);
            expect(outcome.data.error.code).toBe('safety_violation');
            expect(outcome.data.safetyBlocked).toBe(true);
            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        test('throws ValidationError when text is missing, empty, or not a string', async () => {
            await expect(
                QueryExecutionEngine.executeNaturalLanguageQuery({
                    connectionId: testConnectionId,
                    text: '',
                })
            ).rejects.toThrow(ValidationError);

            await expect(
                QueryExecutionEngine.executeNaturalLanguageQuery({
                    connectionId: testConnectionId,
                    text: null,
                })
            ).rejects.toThrow(ValidationError);
        });

        test('throws ValidationError when connectionId is missing', async () => {
            await expect(
                QueryExecutionEngine.executeNaturalLanguageQuery({
                    text: 'show orders',
                })
            ).rejects.toThrow(ValidationError);
        });

        test('throws ScopeError when an unknown collection is requested', async () => {
            await expect(
                QueryExecutionEngine.executeNaturalLanguageQuery({
                    connectionId: testConnectionId,
                    text: 'show orders',
                    collections: ['non_existent_collection'],
                })
            ).rejects.toThrow(ScopeError);
        });

        test('shows schema-valid LLM clarification questions', async () => {
            mockGenerateMQL.mockResolvedValueOnce({
                needsClarification: true,
                pipeline: [],
                collection: '',
                questions: [{ id: 'metric', question: 'Which metric?', options: [{ value: 'amount' }, { value: 'units' }] }],
            });
            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show orders over 100',
            });
            expect(outcome.type).toBe('clarification_required');
            expect(outcome.data.clarificationSource).toBe('llm');
            expect(outcome.data.questions[0].options.map((o) => o.value)).toEqual(['amount', 'units', '__other__']);
        });

        test('discards LLM clarification options that are not schema fields', async () => {
            mockGenerateMQL.mockResolvedValueOnce({
                needsClarification: true,
                pipeline: [],
                collection: '',
                questions: [{ id: 'metric', question: 'Which metric?', options: [{ value: 'amount' }, { value: 'password_hash' }] }],
            });
            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show orders over 100',
            });
            expect(outcome.type).toBe('success');
            expect(outcome.data.needsClarification).toBe(false);
            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        test('wraps unexpected infrastructure failures in ExecutionError', async () => {
            mockGetUserDb.mockRejectedValueOnce(new Error('connection refused'));
            const err = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show orders',
            }).catch((e) => e);
            expect(err).toBeInstanceOf(ExecutionError);
            expect(err.statusCode).toBe(500);
            expect(err.message).toBe('connection refused');
        });

        test('maps a missing connection record to 404 connection_not_found', async () => {
            mockGetUserDb.mockRejectedValueOnce(
                Object.assign(new Error('Connection not found or inactive'), { statusCode: 404 })
            );
            const err = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show orders',
            }).catch((e) => e);
            expect(err.statusCode).toBe(404);
            expect(err.code).toBe('connection_not_found');
        });

        test('maps an upstream LLM 429 to RateLimitError', async () => {
            const upstream = Object.assign(new Error('Rate limit reached'), { status: 429 });
            mockGenerateMQL.mockRejectedValueOnce(upstream);
            const err = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show orders over 100',
            }).catch((e) => e);
            expect(err).toBeInstanceOf(RateLimitError);
            expect(err.statusCode).toBe(429);
            expect(err.code).toBe('rate_limited');
        });

        test('does not leak an upstream status code other than 429', async () => {
            const upstream = Object.assign(new Error('invalid api key'), { status: 401 });
            mockGenerateMQL.mockRejectedValueOnce(upstream);
            const err = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show orders over 100',
            }).catch((e) => e);
            expect(err).toBeInstanceOf(ExecutionError);
            expect(err.statusCode).toBe(500);
        });

        test('verifies behavioral equivalence between text and voice queries', async () => {
            const queryText = 'show orders over 100';

            const textOutcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: queryText,
                source: 'query',
            });

            const voiceOutcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: queryText,
                source: 'voice',
            });

            expect(textOutcome.type).toBe(voiceOutcome.type);
            expect(textOutcome.data.pipeline).toEqual(voiceOutcome.data.pipeline);
            expect(textOutcome.data.safetyStatus).toEqual(voiceOutcome.data.safetyStatus);
            expect(textOutcome.data.results).toEqual(voiceOutcome.data.results);
        });
    });

    describe('executeApprovedWrite', () => {
        function createValidToken(overrides = {}) {
            const payload = {
                jti: crypto.randomUUID(),
                connectionId: testConnectionId,
                collection: 'orders',
                pipeline: [{ $match: { status: 'cancelled' } }, { $merge: { into: 'archived_orders' } }],
                query: 'archive cancelled orders',
                type: 'write-approval',
                ...overrides,
            };
            return jwt.sign(payload, testSecret, { expiresIn: '10m' });
        }

        test('successfully executes approved write query', async () => {
            const token = createValidToken();

            const outcome = await QueryExecutionEngine.executeApprovedWrite({
                connectionId: testConnectionId,
                approvalToken: token,
            });

            expect(outcome.type).toBe('success');
            expect(outcome.data.success).toBe(true);
            expect(outcome.data.safetyStatus).toBe('write-executed');
            expect(mockApprovalTokensCollection.insertOne).toHaveBeenCalledTimes(1);
            expect(mockExecutePipeline).toHaveBeenCalledWith(
                mockUserDb,
                'orders',
                expect.any(Array),
                expect.objectContaining({ approvedWrite: true })
            );
            expect(mockSaveQueryHistory).toHaveBeenCalledTimes(1);
        });

        test('prevents replay: throws TokenAlreadyUsedError when jti is duplicate', async () => {
            const duplicateErr = new Error('E11000 duplicate key error');
            duplicateErr.code = 11000;
            mockApprovalTokensCollection.insertOne.mockRejectedValueOnce(duplicateErr);

            const token = createValidToken();

            await expect(
                QueryExecutionEngine.executeApprovedWrite({
                    connectionId: testConnectionId,
                    approvalToken: token,
                })
            ).rejects.toThrow(TokenAlreadyUsedError);

            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        test('throws TokenExpiredError when approval token is expired', async () => {
            const expiredToken = jwt.sign(
                { jti: 'test-jti', type: 'write-approval', connectionId: testConnectionId },
                testSecret,
                { expiresIn: '-1s' }
            );

            await expect(
                QueryExecutionEngine.executeApprovedWrite({
                    connectionId: testConnectionId,
                    approvalToken: expiredToken,
                })
            ).rejects.toThrow(TokenExpiredError);

            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        test('throws UnauthorizedTokenError when token connectionId does not match session', async () => {
            const token = createValidToken({ connectionId: 'different-tenant-conn' });

            await expect(
                QueryExecutionEngine.executeApprovedWrite({
                    connectionId: testConnectionId,
                    approvalToken: token,
                })
            ).rejects.toThrow(UnauthorizedTokenError);

            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        test('throws SafetyViolationError when token targets an unsafe collection or pipeline', async () => {
            const tokenUnsafeColl = createValidToken({ collection: 'system.users' });

            await expect(
                QueryExecutionEngine.executeApprovedWrite({
                    connectionId: testConnectionId,
                    approvalToken: tokenUnsafeColl,
                })
            ).rejects.toThrow(SafetyViolationError);

            const tokenUnsafePipe = createValidToken({
                pipeline: [{ $match: { $where: 'sleep(1000)' } }],
            });

            await expect(
                QueryExecutionEngine.executeApprovedWrite({
                    connectionId: testConnectionId,
                    approvalToken: tokenUnsafePipe,
                })
            ).rejects.toThrow(SafetyViolationError);
        });

        test('throws ValidationError when connectionId is missing', async () => {
            await expect(
                QueryExecutionEngine.executeApprovedWrite({ approvalToken: createValidToken() })
            ).rejects.toThrow(ValidationError);
        });

        test('throws ValidationError when approvalToken or jti is missing', async () => {
            await expect(
                QueryExecutionEngine.executeApprovedWrite({
                    connectionId: testConnectionId,
                    approvalToken: null,
                })
            ).rejects.toThrow(ValidationError);

            const tokenWithoutJti = createValidToken({ jti: undefined });
            await expect(
                QueryExecutionEngine.executeApprovedWrite({
                    connectionId: testConnectionId,
                    approvalToken: tokenWithoutJti,
                })
            ).rejects.toThrow(ValidationError);
        });
    });
});

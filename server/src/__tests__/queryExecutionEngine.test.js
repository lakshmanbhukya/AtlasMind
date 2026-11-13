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
    ...jest.requireActual('../services/queryExecutor'),
    executePipeline: (...args) => mockExecutePipeline(...args),
}));
jest.mock('../stores/queryHistoryStore', () => ({
    record: (...args) => mockSaveQueryHistory(...args),
}));

// Workspace model mock (Effective Scope resolves workspaces through it)
const mockGetWorkspaceById = jest.fn();
jest.mock('../models/Workspace', () => ({
    getWorkspaceById: (...args) => mockGetWorkspaceById(...args),
}));

const { QueryExecutionEngine } = require('../services/queryExecutionEngine');
const {
    ValidationError,
    ScopeError,
    TokenExpiredError,
    UnauthorizedTokenError,
    TokenAlreadyUsedError,
    SafetyViolationError,
    ExecutionError,
    RateLimitError,
} = require('../services/engineErrors');

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

            // Structured approval details for the approval card
            expect(outcome.data.approval).toEqual({
                expiresAt: new Date(decoded.exp * 1000).toISOString(),
                writeStage: '$out',
                writeStageIndex: 1,
                sourceCollection: 'orders',
                targetCollection: 'archived_orders',
                fieldsWritten: [],
            });
        });

        test('approval details list the fields written before a $merge', async () => {
            mockGenerateMQL.mockResolvedValueOnce({
                pipeline: [
                    { $match: { createdAt: { $lt: '2023-11-07' } } },
                    { $set: { archived: true, archivedAt: '$$NOW' } },
                    { $merge: { into: 'orders_archive', whenMatched: 'replace' } },
                ],
                collection: 'orders',
                chartType: 'table',
                explanation: 'Archive old orders',
            });

            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'archive orders older than 3 years',
            });

            expect(outcome.type).toBe('approval_required');
            expect(outcome.data.approval).toMatchObject({
                writeStage: '$merge',
                writeStageIndex: 2,
                targetCollection: 'orders_archive',
                fieldsWritten: ['archived', 'archivedAt'],
            });
            expect(Date.parse(outcome.data.approval.expiresAt)).toBeGreaterThan(Date.now());
        });

        test('a $lookup into a protected collection is blocked with structured details, not scope-insufficient', async () => {
            const pipeline = [
                { $match: { status: 'paid' } },
                { $lookup: { from: 'system_users', localField: 'userId', foreignField: '_id', as: 'user' } },
            ];
            mockGenerateMQL.mockResolvedValueOnce({
                pipeline,
                collection: 'orders',
                chartType: 'table',
                explanation: 'Orders with users',
            });

            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show paid orders with their user',
            });

            expect(outcome.type).toBe('safety_blocked');
            expect(outcome.data.error.code).toBe('safety_violation');
            expect(outcome.data.safetyStatus).toBe('blocked');
            expect(outcome.data.collection).toBe('orders');
            expect(outcome.data.pipeline).toEqual(pipeline);
            expect(outcome.data.safetyBlock).toMatchObject({
                code: 'protected_collection',
                referenceType: '$lookup collection',
                reference: 'system_users',
                stage: '$lookup',
                stageIndex: 1,
            });
            expect(outcome.data.safetyBlock.rule).toEqual(expect.any(String));
            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        test('a write that reads outside the scope returns scope-insufficient with no approval token', async () => {
            mockGenerateMQL.mockResolvedValueOnce({
                pipeline: [
                    { $lookup: { from: 'customers', localField: 'customerId', foreignField: '_id', as: 'c' } },
                    { $merge: { into: 'orders' } },
                ],
                collection: 'orders',
                chartType: 'table',
                explanation: 'Copy customers onto orders',
            });

            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'copy customer details into orders',
                collections: ['orders'],
            });

            expect(outcome.type).toBe('success');
            expect(outcome.data.safetyStatus).toBe('scope-insufficient');
            expect(outcome.data.suggestedCollections).toEqual(['customers']);
            expect(outcome.approvalToken).toBeUndefined();
            expect(outcome.data.approvalToken).toBeUndefined();
            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        test('a write that reads a protected collection is blocked', async () => {
            mockGenerateMQL.mockResolvedValueOnce({
                pipeline: [
                    { $lookup: { from: 'system_users', localField: 'userId', foreignField: '_id', as: 'u' } },
                    { $merge: { into: 'orders' } },
                ],
                collection: 'orders',
                chartType: 'table',
                explanation: 'Copy users onto orders',
            });

            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'copy user details into orders',
            });

            expect(outcome.type).toBe('safety_blocked');
            expect(outcome.data.safetyBlock).toMatchObject({ code: 'protected_collection', reference: 'system_users' });
            expect(outcome.approvalToken).toBeUndefined();
            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        test('a write target outside the restricted scope is blocked', async () => {
            mockGenerateMQL.mockResolvedValueOnce({
                pipeline: [{ $match: { status: 'paid' } }, { $merge: { into: 'customers' } }],
                collection: 'orders',
                chartType: 'table',
                explanation: 'Copy paid orders into customers',
            });

            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'copy paid orders into customers',
                collections: ['orders'],
            });

            expect(outcome.type).toBe('safety_blocked');
            expect(outcome.data.safetyBlock).toMatchObject({
                code: 'out_of_scope_collection',
                referenceType: 'Write target collection',
                reference: 'customers',
                stage: '$merge',
                stageIndex: 1,
            });
            expect(outcome.approvalToken).toBeUndefined();
        });

        test('the approval token carries the scope only when it is restricted', async () => {
            const write = {
                pipeline: [{ $match: { status: 'cancelled' } }, { $merge: { into: 'orders' } }],
                collection: 'orders',
                chartType: 'table',
                explanation: 'Rewrite orders',
            };

            mockGenerateMQL.mockResolvedValueOnce(write);
            const open = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'rewrite cancelled orders',
            });
            expect(jwt.verify(open.approvalToken, testSecret).scope).toBeNull();

            mockGenerateMQL.mockResolvedValueOnce(write);
            const restricted = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'rewrite cancelled orders',
                collections: ['orders'],
            });
            expect(jwt.verify(restricted.approvalToken, testSecret).scope).toEqual(['orders']);
        });

        test('a hard-denied operator is blocked with the operator as the reference', async () => {
            mockGenerateMQL.mockResolvedValueOnce({
                pipeline: [{ $match: { $where: 'this.total > 10' } }],
                collection: 'orders',
                chartType: 'table',
                explanation: 'Where clause',
            });

            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'orders over 10 using where',
            });

            expect(outcome.type).toBe('safety_blocked');
            expect(outcome.data.safetyBlock).toMatchObject({
                code: 'hard_blocked_operator',
                referenceType: 'Operator',
                reference: '$where',
                stageIndex: 0,
            });
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
            expect(outcome.data.safetyStatus).toBe('blocked');
            expect(outcome.data.safetyBlock).toMatchObject({
                code: 'protected_collection',
                referenceType: 'Target collection',
                reference: 'system.users',
            });
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

    describe('workspace scope (Effective Scope regression)', () => {
        beforeEach(() => {
            mockGetWorkspaceById.mockResolvedValue({ name: 'Sales', collections: ['orders'] });
        });

        test('a workspaceId-only query is restricted to the workspace collections', async () => {
            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show high value orders',
                workspaceId: '64b7f0000000000000000001',
            });

            expect(outcome.type).toBe('success');
            expect(mockGetWorkspaceById).toHaveBeenCalledWith('64b7f0000000000000000001', testConnectionId);
            expect(mockGetSimilarExamples).toHaveBeenCalledWith(
                'show high value orders', expect.any(Number), testConnectionId, ['orders']
            );
            expect(mockExecutePipeline).toHaveBeenCalledWith(
                mockUserDb, 'orders', expect.any(Array), expect.objectContaining({ scope: ['orders'] })
            );
        });

        test('a $lookup outside the workspace is scope-insufficient, not executed', async () => {
            mockGenerateMQL.mockResolvedValueOnce({
                pipeline: [
                    { $lookup: { from: 'customers', localField: 'customerId', foreignField: '_id', as: 'customer' } },
                ],
                collection: 'orders',
                chartType: 'table',
                explanation: 'Orders joined with customers',
            });

            const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show orders with customer names',
                workspaceId: '64b7f0000000000000000001',
            });

            expect(outcome.data.safetyStatus).toBe('scope-insufficient');
            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        test('an unknown workspace fails closed', async () => {
            mockGetWorkspaceById.mockResolvedValueOnce(null);

            await expect(QueryExecutionEngine.executeNaturalLanguageQuery({
                connectionId: testConnectionId,
                text: 'show high value orders',
                workspaceId: '64b7f0000000000000000002',
            })).rejects.toMatchObject({ code: 'workspace_not_found', statusCode: 400 });
            expect(mockGenerateMQL).not.toHaveBeenCalled();
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

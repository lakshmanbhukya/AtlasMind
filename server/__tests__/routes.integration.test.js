/**
 * Integration tests for API routes.
 * Mocks the database connection and service layer to test route handling and middleware.
 */
const request = require('supertest');
const app = require('../src/index');

// Mock MongoClient to prevent real connections
jest.mock('mongodb', () => {
    const mockDb = {
        collection: jest.fn(() => ({
            aggregate: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([]),
            insertOne: jest.fn().mockResolvedValue({}),
            findOne: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
        })),
        databaseName: 'test-db',
    };
    const mockClient = {
        connect: jest.fn().mockResolvedValue(true),
        db: jest.fn(() => mockDb),
        close: jest.fn().mockResolvedValue(true),
    };
    return {
        MongoClient: jest.fn(() => mockClient),
    };
});

// Mock DB connection
jest.mock('../src/db/connection', () => ({
    getDb: jest.fn(() => ({
        collection: jest.fn(() => ({
            aggregate: jest.fn(),
            insertOne: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([]),
        })),
    })),
    connectToDatabase: jest.fn(),
}));

// Mock services to isolate route logic
jest.mock('../src/services/schemaProfiler', () => ({
    getMinifiedSchema: jest.fn().mockResolvedValue('Database: test'),
    profileSchema: jest.fn().mockResolvedValue({ collections: [] }),
}));

jest.mock('../src/services/fewShotRetriever', () => ({
    getSimilarExamples: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/services/groqService', () => ({
    generateMQL: jest.fn().mockResolvedValue({
        pipeline: [],
        collection: 'test_col',
        chartType: 'table',
        explanation: 'test explanation',
    }),
}));

jest.mock('../src/models/UserConnection', () => ({
    getConnectionById: jest.fn().mockResolvedValue({
        connectionId: 'mock-id',
        encryptedUri: 'mock-uri',
        dbName: 'test-db',
        label: 'Test'
    }),
    initializeCollection: jest.fn(),
}));

jest.mock('../src/utils/encryption', () => ({
    decrypt: jest.fn().mockReturnValue('mongodb://localhost:27017'),
    encrypt: jest.fn().mockReturnValue('mock-encrypted'),
    hashString: jest.fn().mockReturnValue('mock-hash'),
}));

jest.mock('../src/services/queryExecutor', () => ({
    executePipeline: jest.fn().mockResolvedValue({
        results: [],
        executionTimeMs: 10,
    }),
    saveQueryHistory: jest.fn(),
}));

jest.mock('../src/services/safetyGuard', () => ({
    validatePipeline: jest.fn().mockReturnValue({ safe: true, pipeline: [] }),
    validateCollectionName: jest.fn().mockReturnValue({ safe: true }),
}));

jest.mock('../src/services/fewShotRetriever', () => ({
    getSimilarExamples: jest.fn().mockResolvedValue([]),
    addExample: jest.fn(),
}));

// Mock JWT to bypass auth
jest.mock('../src/utils/jwt', () => ({
    signToken: jest.fn(() => 'mock-token'),
    verifyToken: jest.fn(() => ({ connectionId: 'mock-id' })),
}));

const mockToken = 'mock-token';
const cookie = `am_token=${mockToken}`;

describe('API Routes Integration', () => {

    // ── Health Check ────────────────────────────────────────────
    describe('GET /api/health', () => {
        it('returns 200 OK', async () => {
            const res = await request(app).get('/api/health');
            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('ok');
        });
    });

    // ── Query Route ─────────────────────────────────────────────
    describe('POST /api/query', () => {
        it('processes a valid natural language query', async () => {
            const res = await request(app)
                .post('/api/query')
                .set('Cookie', [cookie])
                .send({ text: 'show sales' });

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body).toHaveProperty('results');
            expect(res.body).toHaveProperty('pipeline');
            expect(res.body).toHaveProperty('explanation', 'test explanation');
        });

        it('returns 400 for missing query', async () => {
            const res = await request(app)
                .post('/api/query')
                .set('Cookie', [cookie])
                .send({}); // missing text

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('handles service errors gracefully', async () => {
            const { generateMQL } = require('../src/services/groqService');
            generateMQL.mockRejectedValueOnce(new Error('LLM Error'));

            const res = await request(app)
                .post('/api/query')
                .set('Cookie', [cookie])
                .send({ text: 'crash me' });

            expect(res.statusCode).toBe(500);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toContain('LLM Error');
        });
    });

    // ── Schema Route ────────────────────────────────────────────
    describe('GET /api/schema', () => {
        it('returns schema profile', async () => {
            const res = await request(app)
                .get('/api/schema')
                .set('Cookie', [cookie]);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('collections');
        });
    });
});

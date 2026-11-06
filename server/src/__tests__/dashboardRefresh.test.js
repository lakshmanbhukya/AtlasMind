const { executePipeline } = require('../services/queryExecutor');
const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

jest.mock('../db/connection', () => ({
    getDb: jest.fn(),
}));

jest.mock('../services/userDbPool', () => ({
    getUserDb: jest.fn(),
}));

jest.mock('../services/queryExecutor', () => ({
    ...jest.requireActual('../services/queryExecutor'),
    executePipeline: jest.fn().mockResolvedValue({
        results: [{ total: 100 }],
        executionTimeMs: 15,
    }),
}));

const dashboardRouter = require('../routes/dashboard');
const { getDb } = require('../db/connection');
const { getUserDb } = require('../services/userDbPool');

describe('Dashboard Refresh & Scope Persistence Tests', () => {
    let app;
    let mockCentralDb;
    let mockUserDb;
    let mockPinsCollection;

    beforeEach(() => {
        jest.clearAllMocks();

        mockPinsCollection = {
            insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
            findOne: jest.fn(),
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
            deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
            find: jest.fn().mockReturnValue({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([]),
                }),
            }),
        };

        mockCentralDb = {
            collection: jest.fn().mockReturnValue(mockPinsCollection),
        };
        getDb.mockReturnValue(mockCentralDb);

        mockUserDb = {
            databaseName: 'user_sales_db',
            collection: jest.fn().mockReturnValue({
                aggregate: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([{ total: 100 }]),
                }),
            }),
        };
        getUserDb.mockResolvedValue(mockUserDb);

        app = express();
        app.use(express.json());
        // Middleware simulating requireAuth setting req.connectionId
        app.use((req, _res, next) => {
            req.connectionId = 'tenant-conn-123';
            next();
        });
        app.use('/api/dashboard', dashboardRouter);
    });

    test('executePipeline guards then runs (db, collectionName, pipeline)', async () => {
        const mockToArray = jest.fn().mockResolvedValue([{ count: 42 }]);
        const mockAggregate = jest.fn().mockReturnValue({ toArray: mockToArray });
        const mockCollection = jest.fn().mockReturnValue({ aggregate: mockAggregate });
        const mockDb = { collection: mockCollection };

        // Test the direct function logic
        const realQueryExecutor = jest.requireActual('../services/queryExecutor');
        const result = await realQueryExecutor.executePipeline(mockDb, 'orders', [{ $count: 'count' }]);

        expect(mockCollection).toHaveBeenCalledWith('orders');
        expect(mockAggregate).toHaveBeenCalledWith(
            [{ $count: 'count' }, { $limit: 1000 }],
            expect.objectContaining({ maxTimeMS: 30000 })
        );
        expect(result.results).toEqual([{ count: 42 }]);
        expect(typeof result.executionTimeMs).toBe('number');
    });

    test('POST /api/dashboard/pin persists scope on pin', async () => {
        const response = await request(app)
            .post('/api/dashboard/pin')
            .send({
                query: 'total revenue',
                pipeline: [{ $group: { _id: null, total: { $sum: '$amount' } } }],
                collection: 'orders',
                scope: ['orders', 'customers'],
            });

        expect(response.status).toBe(201);
        expect(mockPinsCollection.insertOne).toHaveBeenCalled();
        const savedPin = mockPinsCollection.insertOne.mock.calls[0][0];
        expect(savedPin.scope).toEqual(['orders', 'customers']);
        expect(savedPin.connectionId).toBe('tenant-conn-123');
    });

    test('POST /api/dashboard/:id/refresh uses getUserDb(req.connectionId) and executes with db handle', async () => {
        const pinId = new ObjectId().toString();
        const storedPin = {
            _id: new ObjectId(pinId),
            connectionId: 'tenant-conn-123',
            collection: 'orders',
            pipeline: [{ $count: 'total' }],
            scope: ['orders'],
        };
        mockPinsCollection.findOne.mockResolvedValue(storedPin);

        const response = await request(app)
            .post(`/api/dashboard/${pinId}/refresh`);

        expect(response.status).toBe(200);
        expect(getUserDb).toHaveBeenCalledWith('tenant-conn-123');
        expect(executePipeline).toHaveBeenCalledWith(
            mockUserDb,
            'orders',
            storedPin.pipeline,
            { scope: ['orders'] }
        );
        expect(mockPinsCollection.updateOne).toHaveBeenCalledWith(
            { _id: new ObjectId(pinId), connectionId: 'tenant-conn-123' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    results: [{ total: 100 }],
                }),
            })
        );
    });
});

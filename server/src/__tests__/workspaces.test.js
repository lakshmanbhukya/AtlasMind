const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

jest.mock('../db/connection', () => ({
    getDb: jest.fn(),
}));

jest.mock('../services/userDbPool', () => ({
    getUserDb: jest.fn(),
}));

const workspaceRouter = require('../routes/workspaces');
const { getDb } = require('../db/connection');
const { getUserDb } = require('../services/userDbPool');

describe('Phase 4: Saved Workspaces API & Model Tests', () => {
    let app;
    let mockWorkspacesCollection;
    let mockCentralDb;
    let mockUserDb;

    beforeEach(() => {
        jest.clearAllMocks();

        mockWorkspacesCollection = {
            createIndex: jest.fn().mockResolvedValue('connectionId_1_name_1'),
            find: jest.fn(),
            findOne: jest.fn(),
            insertOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
            deleteOne: jest.fn(),
        };

        mockCentralDb = {
            collection: jest.fn().mockReturnValue(mockWorkspacesCollection),
        };
        getDb.mockReturnValue(mockCentralDb);

        mockUserDb = {
            databaseName: 'retail_db',
            listCollections: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([
                    { name: 'orders' },
                    { name: 'customers' },
                    { name: 'inventory' },
                ]),
            }),
        };
        getUserDb.mockResolvedValue(mockUserDb);

        app = express();
        app.use(express.json());
        // Simulates requireAuth middleware setting req.connectionId
        app.use((req, _res, next) => {
            req.connectionId = 'tenant-123';
            next();
        });
        app.use('/api/workspaces', workspaceRouter);
    });

    test('GET /api/workspaces lists workspaces and flags collections no longer in DB', async () => {
        const storedWorkspaces = [
            {
                _id: new ObjectId('60d5ec49f1b24b1234567891'),
                connectionId: 'tenant-123',
                name: 'Sales Scope',
                collections: ['orders', 'customers', 'deleted_collection'],
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];

        mockWorkspacesCollection.find.mockReturnValue({
            sort: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue(storedWorkspaces),
            }),
        });

        const res = await request(app).get('/api/workspaces');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBe(1);

        const ws = res.body.data[0];
        expect(ws.name).toBe('Sales Scope');
        expect(ws.collections).toEqual(['orders', 'customers', 'deleted_collection']);
        expect(ws.availableCollections).toEqual(['orders', 'customers']);
        expect(ws.missingCollections).toEqual(['deleted_collection']);
        expect(ws.hasMissingCollections).toBe(true);
    });

    test('POST /api/workspaces validates collections against user DB and creates workspace', async () => {
        mockWorkspacesCollection.insertOne.mockResolvedValue({
            insertedId: new ObjectId('60d5ec49f1b24b1234567892'),
        });

        const res = await request(app)
            .post('/api/workspaces')
            .send({
                name: 'Orders & Inventory',
                collections: ['orders', 'inventory'],
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe('Orders & Inventory');
        expect(res.body.data.collections).toEqual(['orders', 'inventory']);
        expect(mockWorkspacesCollection.insertOne).toHaveBeenCalledWith(
            expect.objectContaining({
                connectionId: 'tenant-123',
                name: 'Orders & Inventory',
                collections: ['orders', 'inventory'],
            })
        );
    });

    test('POST /api/workspaces rejects unknown collections with 400 validation_error', async () => {
        const res = await request(app)
            .post('/api/workspaces')
            .send({
                name: 'Invalid Scope',
                collections: ['orders', 'unknown_table'],
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('validation_error');
        expect(res.body.error.message).toContain('Unknown collection: "unknown_table"');
        expect(mockWorkspacesCollection.insertOne).not.toHaveBeenCalled();
    });

    test('POST /api/workspaces handles duplicate workspace name with 409 conflict', async () => {
        const mongoDuplicateError = new Error('E11000 duplicate key error');
        mongoDuplicateError.code = 11000;
        mockWorkspacesCollection.insertOne.mockRejectedValue(mongoDuplicateError);

        const res = await request(app)
            .post('/api/workspaces')
            .send({
                name: 'Orders & Inventory',
                collections: ['orders'],
            });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('duplicate_workspace_name');
    });

    test('PATCH /api/workspaces/:id updates workspace successfully', async () => {
        const wsId = new ObjectId('60d5ec49f1b24b1234567893').toString();
        mockWorkspacesCollection.findOne.mockResolvedValue({
            _id: new ObjectId(wsId),
            connectionId: 'tenant-123',
            name: 'Old Name',
            collections: ['orders'],
        });

        mockWorkspacesCollection.findOneAndUpdate.mockResolvedValue({
            _id: new ObjectId(wsId),
            connectionId: 'tenant-123',
            name: 'Updated Name',
            collections: ['orders', 'customers'],
            updatedAt: new Date(),
        });

        const res = await request(app)
            .patch(`/api/workspaces/${wsId}`)
            .send({
                name: 'Updated Name',
                collections: ['orders', 'customers'],
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe('Updated Name');
    });

    test('DELETE /api/workspaces/:id deletes workspace scoped by connectionId', async () => {
        const wsId = new ObjectId('60d5ec49f1b24b1234567894').toString();
        mockWorkspacesCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

        const res = await request(app).delete(`/api/workspaces/${wsId}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockWorkspacesCollection.deleteOne).toHaveBeenCalledWith({
            _id: new ObjectId(wsId),
            connectionId: 'tenant-123',
        });
    });
});

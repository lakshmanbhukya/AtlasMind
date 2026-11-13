'use strict';

/**
 * Safe execution: executePipeline is the only way to run a pipeline against a
 * tenant DB, and it always applies the safety guard. These tests use the real
 * executor and a fake Db so nothing below the interface is mocked.
 */

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

jest.mock('../db/connection', () => ({ getDb: jest.fn() }));
jest.mock('../services/userDbPool', () => ({ getUserDb: jest.fn() }));

const { executePipeline, UnsafePipelineError } = require('../services/queryExecutor');
const dashboardRouter = require('../routes/dashboard');
const { getDb } = require('../db/connection');
const { getUserDb } = require('../services/userDbPool');

function fakeUserDb(rows = [{ ok: 1 }]) {
    const aggregate = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(rows) });
    return { aggregate, db: { collection: jest.fn().mockReturnValue({ aggregate }) } };
}

describe('executePipeline always applies the safety guard', () => {
    test.each([
        ['$out', [{ $match: {} }, { $out: 'stolen' }]],
        ['$merge', [{ $merge: { into: 'other' } }]],
        ['$function', [{ $addFields: { x: { $function: { body: 'return 1', args: [], lang: 'js' } } } }]],
        ['$where', [{ $match: { $where: 'sleep(1000)' } }]],
    ])('rejects %s without touching the database', async (_label, pipeline) => {
        const { db, aggregate } = fakeUserDb();
        await expect(executePipeline(db, 'orders', pipeline)).rejects.toBeInstanceOf(UnsafePipelineError);
        expect(aggregate).not.toHaveBeenCalled();
    });

    test('rejects a system collection target', async () => {
        const { db, aggregate } = fakeUserDb();
        await expect(executePipeline(db, 'system.users', [{ $match: {} }])).rejects.toBeInstanceOf(UnsafePipelineError);
        expect(aggregate).not.toHaveBeenCalled();
    });

    test('rejects a $lookup outside the Effective Scope', async () => {
        const { db } = fakeUserDb();
        const pipeline = [{ $lookup: { from: 'secrets', localField: 'a', foreignField: 'b', as: 'c' } }];
        await expect(executePipeline(db, 'orders', pipeline, { scope: ['orders'] }))
            .rejects.toMatchObject({ code: 'scope_violation' });
    });

    test('flags an unapproved write with isWrite', async () => {
        const { db } = fakeUserDb();
        await expect(executePipeline(db, 'orders', [{ $merge: { into: 'orders_archive' } }]))
            .rejects.toMatchObject({ isWrite: true });
    });

    test('runs an approved write unchanged', async () => {
        const { db, aggregate } = fakeUserDb();
        const pipeline = [{ $match: { status: 'old' } }, { $merge: { into: 'orders_archive' } }];
        await executePipeline(db, 'orders', pipeline, { approvedWrite: true });
        expect(aggregate).toHaveBeenCalledWith(pipeline, expect.any(Object));
    });

    test('approvedWrite does not unlock code-execution operators', async () => {
        const { db, aggregate } = fakeUserDb();
        const pipeline = [{ $match: { $where: 'true' } }, { $merge: { into: 'x' } }];
        await expect(executePipeline(db, 'orders', pipeline, { approvedWrite: true }))
            .rejects.toBeInstanceOf(UnsafePipelineError);
        expect(aggregate).not.toHaveBeenCalled();
    });

    test.each([
        ['an out-of-scope lookup', [{ $lookup: { from: 'secrets', localField: 'a', foreignField: 'b', as: 'c' } }, { $merge: { into: 'orders' } }]],
        ['a protected lookup', [{ $lookup: { from: 'system_users', localField: 'a', foreignField: 'b', as: 'c' } }, { $merge: { into: 'orders' } }]],
        ['a cross-database target', [{ $match: {} }, { $merge: { into: { db: 'otherdb', coll: 'orders' } } }]],
        ['an out-of-scope target', [{ $match: {} }, { $merge: { into: 'elsewhere' } }]],
    ])('approvedWrite does not unlock %s', async (_label, pipeline) => {
        const { db, aggregate } = fakeUserDb();
        db.databaseName = 'shop';
        await expect(executePipeline(db, 'orders', pipeline, { scope: ['orders'], approvedWrite: true }))
            .rejects.toMatchObject({ name: 'UnsafePipelineError', isWrite: false });
        expect(aggregate).not.toHaveBeenCalled();
    });

    test('reads the tenant database name from the db handle', async () => {
        const { db, aggregate } = fakeUserDb();
        db.databaseName = 'shop';
        const pipeline = [{ $lookup: { from: { db: 'shop', coll: 'customers' }, localField: 'a', foreignField: 'b', as: 'c' } }];
        await executePipeline(db, 'orders', pipeline);
        expect(aggregate).toHaveBeenCalledTimes(1);

        await expect(executePipeline(db, 'orders', [{ $lookup: { from: { db: 'otherdb', coll: 'customers' }, as: 'c' } }]))
            .rejects.toBeInstanceOf(UnsafePipelineError);
    });

    test('appends the result $limit to a safe read', async () => {
        const { db, aggregate } = fakeUserDb();
        await executePipeline(db, 'orders', [{ $match: {} }]);
        expect(aggregate.mock.calls[0][0]).toEqual([{ $match: {} }, { $limit: 1000 }]);
    });
});

describe('dashboard pins go through the guard', () => {
    let app;
    let pins;

    beforeEach(() => {
        jest.clearAllMocks();
        pins = {
            insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
            findOne: jest.fn(),
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        };
        getDb.mockReturnValue({ collection: jest.fn().mockReturnValue(pins) });
        app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.connectionId = 'tenant-1';
            next();
        });
        app.use('/api/dashboard', dashboardRouter);
    });

    test('refresh refuses to run a stored $out pipeline', async () => {
        const { db, aggregate } = fakeUserDb();
        getUserDb.mockResolvedValue(db);
        const id = new ObjectId();
        pins.findOne.mockResolvedValue({
            _id: id,
            connectionId: 'tenant-1',
            collection: 'orders',
            pipeline: [{ $match: {} }, { $out: 'orders_copy' }],
        });

        const res = await request(app).post(`/api/dashboard/${id}/refresh`);

        expect(res.status).toBe(422);
        expect(aggregate).not.toHaveBeenCalled();
        expect(pins.updateOne).not.toHaveBeenCalled();
    });

    test('pin refuses to store an unsafe pipeline', async () => {
        const res = await request(app).post('/api/dashboard/pin').send({
            query: 'copy orders',
            collection: 'orders',
            pipeline: [{ $merge: { into: 'elsewhere' } }],
        });

        expect(res.status).toBe(422);
        expect(pins.insertOne).not.toHaveBeenCalled();
    });

    test('refresh runs a safe stored pipeline', async () => {
        const { db, aggregate } = fakeUserDb([{ total: 3 }]);
        getUserDb.mockResolvedValue(db);
        const id = new ObjectId();
        pins.findOne.mockResolvedValue({
            _id: id,
            connectionId: 'tenant-1',
            collection: 'orders',
            pipeline: [{ $count: 'total' }],
        });

        const res = await request(app).post(`/api/dashboard/${id}/refresh`);

        expect(res.status).toBe(200);
        expect(res.body.data.results).toEqual([{ total: 3 }]);
        expect(aggregate).toHaveBeenCalledTimes(1);
    });
});

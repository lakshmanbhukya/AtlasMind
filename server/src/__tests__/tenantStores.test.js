'use strict';

/**
 * Tenant stores fail closed: a missing connectionId never widens a query to
 * all tenants, and every filter carries the caller's connectionId.
 */

const { ObjectId } = require('mongodb');

jest.mock('../db/connection', () => ({ getDb: jest.fn() }));
jest.mock('../services/userDbPool', () => ({ getUserDb: jest.fn() }));

const { getDb } = require('../db/connection');
const queryHistoryStore = require('../stores/queryHistoryStore');
const dashboardStore = require('../stores/dashboardStore');
const { TenantRequiredError } = require('../stores/tenant');

function fakeCollection() {
    const cursor = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
    };
    return {
        cursor,
        find: jest.fn().mockReturnValue(cursor),
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 0 }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
        findOneAndUpdate: jest.fn().mockResolvedValue(null),
    };
}

let coll;
beforeEach(() => {
    coll = fakeCollection();
    getDb.mockReturnValue({ collection: jest.fn().mockReturnValue(coll) });
});

describe.each([undefined, null, ''])('connectionId = %p', (missing) => {
    test.each([
        ['history listRecent', () => queryHistoryStore.listRecent(missing)],
        ['history rename', () => queryHistoryStore.rename(missing, new ObjectId().toString(), 'n')],
        ['history remove', () => queryHistoryStore.remove(missing, new ObjectId().toString())],
        ['dashboard list', () => dashboardStore.list(missing)],
        ['dashboard pin', () => dashboardStore.pin(missing, { query: 'q', pipeline: [{ $match: {} }], collection: 'c' })],
        ['dashboard remove', () => dashboardStore.remove(missing, new ObjectId().toString())],
        ['dashboard refresh', () => dashboardStore.refresh(missing, new ObjectId().toString())],
    ])('%s throws TenantRequiredError and touches nothing', async (_label, call) => {
        await expect(call()).rejects.toBeInstanceOf(TenantRequiredError);
        expect(coll.find).not.toHaveBeenCalled();
        expect(coll.updateOne).not.toHaveBeenCalled();
        expect(coll.deleteOne).not.toHaveBeenCalled();
        expect(coll.insertOne).not.toHaveBeenCalled();
    });

    test('history record drops the entry instead of storing it untenanted', async () => {
        await queryHistoryStore.record({ connectionId: missing, naturalLanguage: 'q' });
        expect(coll.insertOne).not.toHaveBeenCalled();
    });
});

describe('queries are filtered by the caller', () => {
    test('history list, rename and remove filter on connectionId', async () => {
        const id = new ObjectId();
        await queryHistoryStore.listRecent('tenant-a');
        await queryHistoryStore.rename('tenant-a', id.toString(), 'new name');
        await queryHistoryStore.remove('tenant-a', id.toString());

        expect(coll.find).toHaveBeenCalledWith({ connectionId: 'tenant-a' });
        expect(coll.updateOne.mock.calls[0][0]).toEqual({ _id: id, connectionId: 'tenant-a' });
        expect(coll.deleteOne.mock.calls[0][0]).toEqual({ _id: id, connectionId: 'tenant-a' });
    });

    test('an invalid history id is "not found", not a 500', async () => {
        await expect(queryHistoryStore.rename('tenant-a', 'not-an-id', 'x')).resolves.toBe(false);
        await expect(queryHistoryStore.remove('tenant-a', 'not-an-id')).resolves.toBe(false);
    });

    test('history list shapes rows and marks the newest active', async () => {
        const now = Date.parse('2026-11-06T12:00:00Z');
        coll.cursor.toArray.mockResolvedValue([
            { _id: new ObjectId(), naturalLanguage: 'a', timestamp: new Date(now - 5 * 60000) },
            { _id: new ObjectId(), naturalLanguage: 'b', timestamp: new Date(now - 26 * 3600000) },
        ]);
        const items = await queryHistoryStore.listRecent('tenant-a', { now });
        expect(items.map((i) => [i.query, i.time, i.active])).toEqual([
            ['a', '5 min ago', true],
            ['b', 'Yesterday', false],
        ]);
    });

    test('dashboard refresh only loads a pin owned by the caller', async () => {
        const id = new ObjectId();
        await expect(dashboardStore.refresh('tenant-a', id.toString())).resolves.toBeNull();
        expect(coll.findOne).toHaveBeenCalledWith({ _id: id, connectionId: 'tenant-a' });
    });

    test('shared view projects out connectionId', async () => {
        const id = new ObjectId();
        await dashboardStore.getShared(id.toString());
        const options = coll.findOne.mock.calls[0][1];
        expect(options.projection.connectionId).toBeUndefined();
        expect(Object.values(options.projection).every((v) => v === 1)).toBe(true);
    });
});

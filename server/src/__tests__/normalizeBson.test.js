'use strict';

const { normalizeBson } = require('../utils/normalizeBson');
const { executePipeline } = require('../services/queryExecutor');

describe('A5: normalizeBson', () => {
    test('passes through null and undefined', () => {
        expect(normalizeBson(null)).toBeNull();
        expect(normalizeBson(undefined)).toBeUndefined();
    });

    test('passes through primitives unchanged', () => {
        expect(normalizeBson('hello')).toBe('hello');
        expect(normalizeBson(42)).toBe(42);
        expect(normalizeBson(true)).toBe(true);
        expect(normalizeBson(false)).toBe(false);
    });

    test('converts Date to ISO string', () => {
        const d = new Date('2024-01-15T12:00:00.000Z');
        expect(normalizeBson(d)).toBe('2024-01-15T12:00:00.000Z');
    });

    test('converts ObjectId to string', () => {
        const oid = { _bsontype: 'ObjectId', toString: () => '507f1f77bcf86cd799439011' };
        expect(normalizeBson(oid)).toBe('507f1f77bcf86cd799439011');
    });

    test('converts Decimal128 to Number', () => {
        const dec = { _bsontype: 'Decimal128', toString: () => '3.14159' };
        expect(normalizeBson(dec)).toBeCloseTo(3.14159);
    });

    test('converts Int32 to Number', () => {
        const int32 = { _bsontype: 'Int32', toString: () => '42' };
        expect(normalizeBson(int32)).toBe(42);
    });

    test('converts Long to Number', () => {
        const long = { _bsontype: 'Long', toString: () => '9007199254740991' };
        expect(normalizeBson(long)).toBe(9007199254740991);
    });

    test('converts Double to Number', () => {
        const dbl = { _bsontype: 'Double', toString: () => '1.5' };
        expect(normalizeBson(dbl)).toBe(1.5);
    });

    test('recursively normalizes arrays', () => {
        const arr = [
            { _bsontype: 'ObjectId', toString: () => 'abc' },
            new Date('2024-01-01T00:00:00.000Z'),
            42,
        ];
        const result = normalizeBson(arr);
        expect(result).toEqual(['abc', '2024-01-01T00:00:00.000Z', 42]);
    });

    test('recursively normalizes nested objects', () => {
        const doc = {
            _id: { _bsontype: 'ObjectId', toString: () => 'aaa' },
            amount: { _bsontype: 'Decimal128', toString: () => '99.99' },
            nested: {
                qty: { _bsontype: 'Int32', toString: () => '3' },
                name: 'widget',
            },
        };
        const result = normalizeBson(doc);
        expect(result._id).toBe('aaa');
        expect(result.amount).toBeCloseTo(99.99);
        expect(result.nested.qty).toBe(3);
        expect(result.nested.name).toBe('widget');
    });

    test('handles mixed array of BSON and plain values', () => {
        const arr = [null, undefined, 'text', { _bsontype: 'Long', toString: () => '1000' }];
        const result = normalizeBson(arr);
        expect(result[0]).toBeNull();
        expect(result[1]).toBeUndefined();
        expect(result[2]).toBe('text');
        expect(result[3]).toBe(1000);
    });

    test('executePipeline applies normalizeBson to query results', async () => {
        const mockRawResults = [
            {
                _id: { _bsontype: 'ObjectId', toString: () => '60d5ec49f1a2c8a123456789' },
                created: new Date('2025-01-01T00:00:00.000Z'),
                amount: { _bsontype: 'Decimal128', toString: () => '250.75' },
                count: { _bsontype: 'Int32', toString: () => '5' },
            },
        ];

        const mockDb = {
            collection: () => ({
                aggregate: () => ({
                    toArray: async () => mockRawResults,
                }),
            }),
        };

        const { results } = await executePipeline(mockDb, 'orders', [{ $match: {} }]);
        expect(results).toHaveLength(1);
        expect(results[0]._id).toBe('60d5ec49f1a2c8a123456789');
        expect(results[0].created).toBe('2025-01-01T00:00:00.000Z');
        expect(results[0].amount).toBeCloseTo(250.75);
        expect(results[0].count).toBe(5);
    });
});

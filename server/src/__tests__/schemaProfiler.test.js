'use strict';

const { isMetricCandidate, profileSchema, invalidateSchemaCache } = require('../services/schemaProfiler');

describe('A1: schemaProfiler', () => {
    // ── isMetricCandidate ────────────────────────────────────────────────────
    describe('isMetricCandidate', () => {
        test('accepts plain metric names', () => {
            expect(isMetricCandidate('revenue')).toBe(true);
            expect(isMetricCandidate('sales_amount')).toBe(true);
            expect(isMetricCandidate('price')).toBe(true);
            expect(isMetricCandidate('total')).toBe(true);
        });

        test('rejects id-like names (plain)', () => {
            expect(isMetricCandidate('id')).toBe(false);
            expect(isMetricCandidate('_id')).toBe(false);
            expect(isMetricCandidate('customerId')).toBe(false);
            expect(isMetricCandidate('customer_id')).toBe(false);
            expect(isMetricCandidate('customerID')).toBe(false);
            expect(isMetricCandidate('orderId')).toBe(false);
        });

        test('rejects id-like on last dot-path segment (customer.id, order.customerId)', () => {
            expect(isMetricCandidate('customer.id')).toBe(false);
            expect(isMetricCandidate('order.customerId')).toBe(false);
            expect(isMetricCandidate('nested.deep.userId')).toBe(false);
        });

        test('rejects year-like names (plain)', () => {
            expect(isMetricCandidate('year')).toBe(false);
            expect(isMetricCandidate('fiscalYear')).toBe(false);
            expect(isMetricCandidate('fiscal_year')).toBe(false);
        });

        test('rejects year-like on last dot-path segment (released.year)', () => {
            expect(isMetricCandidate('released.year')).toBe(false);
            expect(isMetricCandidate('stats.fiscalYear')).toBe(false);
        });

        test('accepts dot-path metrics when last segment is fine', () => {
            expect(isMetricCandidate('order.total')).toBe(true);
            expect(isMetricCandidate('product.price')).toBe(true);
        });

        test('rejects non-string input', () => {
            expect(isMetricCandidate(null)).toBe(false);
            expect(isMetricCandidate(123)).toBe(false);
        });
    });

    // ── profileSchema — embed skip ──────────────────────────────────────────
    describe('profileSchema — embed-collection skip', () => {
        afterEach(() => invalidateSchemaCache());

        test('skips collections whose name contains "embed"', async () => {
            // Mock DB
            const mockDb = {
                databaseName: 'test_embed_db',
                listCollections: () => ({
                    toArray: async () => [
                        { name: 'orders' },
                        { name: 'product_embeds' },
                        { name: 'embeddings' },
                        { name: 'customers' },
                    ],
                }),
                collection: () => ({
                    estimatedDocumentCount: async () => 10,
                    aggregate: () => ({ toArray: async () => [] }),
                }),
            };

            const schema = await profileSchema(mockDb, { forceRefresh: true });
            const collectionNames = schema.collections.map((c) => c.name);
            expect(collectionNames).toContain('orders');
            expect(collectionNames).toContain('customers');
            expect(collectionNames).not.toContain('product_embeds');
            expect(collectionNames).not.toContain('embeddings');
        });
    });

    // ── profileSchema — sampleSize cache key ────────────────────────────────
    describe('profileSchema — sampleSize cache isolation', () => {
        afterEach(() => invalidateSchemaCache());

        test('different sampleSize values use separate cache keys', async () => {
            let capturedSizes = [];
            const mockDb = {
                databaseName: 'test_size_db',
                listCollections: () => ({ toArray: async () => [{ name: 'orders' }] }),
                collection: () => ({
                    estimatedDocumentCount: async () => 5,
                    aggregate: (pipeline = []) => ({
                        toArray: async () => {
                            if (pipeline[0] && pipeline[0].$sample) {
                                capturedSizes.push(pipeline[0].$sample.size);
                            }
                            return [];
                        },
                    }),
                }),
            };

            await profileSchema(mockDb, { forceRefresh: true, sampleSize: 5 });
            await profileSchema(mockDb, { forceRefresh: false, sampleSize: 10 }); // different key → fresh fetch

            expect(capturedSizes).toContain(5);
            expect(capturedSizes).toContain(10);
        });
    });

    // ── flattenSubDoc — via profileSchema ───────────────────────────────────
    describe('profileSchema — sub-document flattening', () => {
        afterEach(() => invalidateSchemaCache());

        test('flattens plain nested objects into dot-path fields', async () => {
            const mockDoc = {
                _id: 'oid1',
                revenue: 100,
                address: { city: 'Boston', zip: 2101 },
            };
            const mockDb = {
                databaseName: 'test_flatten_db',
                listCollections: () => ({ toArray: async () => [{ name: 'stores' }] }),
                collection: () => ({
                    estimatedDocumentCount: async () => 1,
                    aggregate: () => ({ toArray: async () => [mockDoc] }),
                }),
            };

            const schema = await profileSchema(mockDb, { forceRefresh: true });
            const fields = schema.collections[0].fields.map((f) => f.name);
            expect(fields).toContain('revenue');
            expect(fields).toContain('address.city');
            expect(fields).toContain('address.zip');
        });

        test('does not flatten beyond depth 3', async () => {
            const mockDoc = {
                _id: 'oid2',
                a: { b: { c: { d: { tooDeep: 99 } } } },
            };
            const mockDb = {
                databaseName: 'test_depth_db',
                listCollections: () => ({ toArray: async () => [{ name: 'items' }] }),
                collection: () => ({
                    estimatedDocumentCount: async () => 1,
                    aggregate: () => ({ toArray: async () => [mockDoc] }),
                }),
            };

            const schema = await profileSchema(mockDb, { forceRefresh: true });
            const fields = schema.collections[0].fields.map((f) => f.name);
            expect(fields).toContain('a.b');
            expect(fields).toContain('a.b.c');
            expect(fields).not.toContain('a.b.c.d');
            expect(fields).not.toContain('a.b.c.d.tooDeep');
        });

        test('does not flatten arrays or Date objects inside sub-docs', async () => {
            const mockDoc = {
                _id: 'oid3',
                meta: { tags: ['a', 'b'], createdAt: new Date() },
            };
            const mockDb = {
                databaseName: 'test_array_date_db',
                listCollections: () => ({ toArray: async () => [{ name: 'posts' }] }),
                collection: () => ({
                    estimatedDocumentCount: async () => 1,
                    aggregate: () => ({ toArray: async () => [mockDoc] }),
                }),
            };

            const schema = await profileSchema(mockDb, { forceRefresh: true });
            const fields = schema.collections[0].fields.map((f) => f.name);
            expect(fields).not.toContain('meta.tags.0');
        });
    });

    // ── inferType — BSON numeric types ──────────────────────────────────────
    describe('BSON numeric type inference via profileSchema', () => {
        afterEach(() => invalidateSchemaCache());

        test('infers Int32, Long, Double as "number" and Decimal128 as "decimal"', async () => {
            const mockDoc = {
                _id: 'oid4',
                qty:   { _bsontype: 'Int32',  valueOf: () => 5,   toString: () => '5'   },
                large: { _bsontype: 'Long',   valueOf: () => 999, toString: () => '999' },
                rate:  { _bsontype: 'Double', valueOf: () => 1.5, toString: () => '1.5' },
                amt:   { _bsontype: 'Decimal128', valueOf: () => 10.5, toString: () => '10.5' },
            };
            const mockDb = {
                databaseName: 'test_bson_db',
                listCollections: () => ({ toArray: async () => [{ name: 'metrics' }] }),
                collection: () => ({
                    estimatedDocumentCount: async () => 1,
                    aggregate: () => ({ toArray: async () => [mockDoc] }),
                }),
            };

            const schema = await profileSchema(mockDb, { forceRefresh: true });
            const fieldMap = Object.fromEntries(schema.collections[0].fields.map((f) => [f.name, f]));
            expect(fieldMap.qty.type).toBe('number');
            expect(fieldMap.large.type).toBe('number');
            expect(fieldMap.rate.type).toBe('number');
            expect(fieldMap.amt.type).toBe('decimal');
        });
    });
});

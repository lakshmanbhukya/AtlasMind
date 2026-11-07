const { validatePipeline } = require('../services/safetyGuard');
const { profileSchema, getMinifiedSchema, invalidateSchemaCache } = require('../services/schemaProfiler');

describe('Phase 1: Scope Validation and Safety Enforcement', () => {
    describe('safetyGuard.validatePipeline Scope Enforcement', () => {
        const allowedScope = ['orders', 'customers'];

        test('passes when target collection and pipeline stages are strictly within scope', () => {
            const pipeline = [
                { $match: { status: 'completed' } },
                {
                    $lookup: {
                        from: 'customers',
                        localField: 'customerId',
                        foreignField: '_id',
                        as: 'customer',
                    },
                },
            ];

            const result = validatePipeline(pipeline, {
                allowedCollections: allowedScope,
                targetCollection: 'orders',
            });

            expect(result.safe).toBe(true);
            expect(result.pipeline.some((s) => '$limit' in s)).toBe(true);
        });

        test('blocks pipeline when target collection is outside scope', () => {
            const pipeline = [{ $match: { price: { $gt: 100 } } }];
            const result = validatePipeline(pipeline, {
                allowedCollections: allowedScope,
                targetCollection: 'products',
            });

            expect(result.safe).toBe(false);
            expect(result.code).toBe('scope_violation');
            expect(result.violatingCollections).toEqual(['products']);
            expect(result.reason).toContain('Target collection "products" is outside the allowed scope');
        });

        test('blocks pipeline when $lookup.from references out-of-scope collection', () => {
            const pipeline = [
                {
                    $lookup: {
                        from: 'inventory',
                        localField: 'sku',
                        foreignField: 'sku',
                        as: 'stock',
                    },
                },
            ];

            const result = validatePipeline(pipeline, {
                allowedCollections: allowedScope,
                targetCollection: 'orders',
            });

            expect(result.safe).toBe(false);
            expect(result.code).toBe('scope_violation');
            expect(result.violatingCollections).toContain('inventory');
        });

        test('blocks pipeline when $unionWith references out-of-scope collection (string or object)', () => {
            const pipeline1 = [{ $unionWith: 'archive_orders' }];
            const result1 = validatePipeline(pipeline1, {
                allowedCollections: allowedScope,
                targetCollection: 'orders',
            });
            expect(result1.safe).toBe(false);
            expect(result1.code).toBe('scope_violation');
            expect(result1.violatingCollections).toContain('archive_orders');

            const pipeline2 = [{ $unionWith: { coll: 'archive_orders' } }];
            const result2 = validatePipeline(pipeline2, {
                allowedCollections: allowedScope,
                targetCollection: 'orders',
            });
            expect(result2.safe).toBe(false);
            expect(result2.code).toBe('scope_violation');
            expect(result2.violatingCollections).toContain('archive_orders');
        });

        test('blocks pipeline when $graphLookup references out-of-scope collection', () => {
            const pipeline = [
                {
                    $graphLookup: {
                        from: 'categories',
                        startWith: '$parentId',
                        connectFromField: 'parentId',
                        connectToField: '_id',
                        as: 'hierarchy',
                    },
                },
            ];

            const result = validatePipeline(pipeline, {
                allowedCollections: allowedScope,
                targetCollection: 'orders',
            });

            expect(result.safe).toBe(false);
            expect(result.code).toBe('scope_violation');
            expect(result.violatingCollections).toContain('categories');
        });

        test('blocks nested $lookup inside $facet stages when referencing out-of-scope collection', () => {
            const pipeline = [
                {
                    $facet: {
                        topOrders: [{ $limit: 5 }],
                        ordersWithSuppliers: [
                            {
                                $lookup: {
                                    from: 'suppliers',
                                    localField: 'supplierId',
                                    foreignField: '_id',
                                    as: 'supplier',
                                },
                            },
                        ],
                    },
                },
            ];

            const result = validatePipeline(pipeline, {
                allowedCollections: allowedScope,
                targetCollection: 'orders',
            });

            expect(result.safe).toBe(false);
            expect(result.code).toBe('scope_violation');
            expect(result.violatingCollections).toContain('suppliers');
        });

        test('backward compatible: allows valid pipeline when allowedCollections is not provided', () => {
            const pipeline = [
                {
                    $lookup: {
                        from: 'any_collection',
                        localField: 'a',
                        foreignField: 'b',
                        as: 'joined',
                    },
                },
            ];

            const result = validatePipeline(pipeline);
            expect(result.safe).toBe(true);
        });
    });

    describe('schemaProfiler Caching & Filtering', () => {
        let mockDb;

        beforeEach(() => {
            invalidateSchemaCache();
            mockDb = {
                databaseName: 'analytics_db',
                listCollections: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([
                        { name: 'orders' },
                        { name: 'customers' },
                        { name: 'products' },
                    ]),
                }),
                collection: jest.fn().mockImplementation((name) => ({
                    estimatedDocumentCount: jest.fn().mockResolvedValue(100),
                    aggregate: jest.fn().mockReturnValue({
                        toArray: jest.fn().mockResolvedValue([
                            { _id: '1', amount: 50, name: 'Sample' },
                        ]),
                    }),
                })),
            };
        });

        test('caches full schema and isolates cache by connectionId', async () => {
            // First call with connection-1
            const schema1 = await profileSchema(mockDb, { connectionId: 'conn-1' });
            expect(schema1.collections.length).toBe(3);
            expect(mockDb.listCollections).toHaveBeenCalledTimes(1);

            // Second call with same connection-1 hits cache
            const schema2 = await profileSchema(mockDb, { connectionId: 'conn-1' });
            expect(schema2.collections.length).toBe(3);
            expect(mockDb.listCollections).toHaveBeenCalledTimes(1);

            // Third call with connection-2 uses distinct cache key even with identical databaseName
            const schema3 = await profileSchema(mockDb, { connectionId: 'conn-2' });
            expect(schema3.collections.length).toBe(3);
            expect(mockDb.listCollections).toHaveBeenCalledTimes(2);
        });

        test('filters collections AFTER cache lookup without mutating the cached full schema', async () => {
            // Cache full schema first
            await profileSchema(mockDb, { connectionId: 'conn-filter-test' });

            // Request with filtered collections
            const scopedSchema = await profileSchema(mockDb, {
                connectionId: 'conn-filter-test',
                collections: ['orders'],
            });

            expect(scopedSchema.collections.length).toBe(1);
            expect(scopedSchema.collections[0].name).toBe('orders');

            // Subsequent call requesting all collections still has full schema in cache
            const fullSchemaAgain = await profileSchema(mockDb, {
                connectionId: 'conn-filter-test',
            });
            expect(fullSchemaAgain.collections.length).toBe(3);
        });

        test('getMinifiedSchema formats only scoped collections when collections option is provided', async () => {
            const minified = await getMinifiedSchema(mockDb, {
                connectionId: 'conn-minified-test',
                collections: ['orders'],
            });

            expect(minified).toContain('Collection: orders');
            expect(minified).not.toContain('Collection: customers');
            expect(minified).not.toContain('Collection: products');
        });
    });
});

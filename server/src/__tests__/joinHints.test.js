const { inferRelationships, formatMinifiedSchema } = require('../services/schemaProfiler');

describe('Phase 3: Join Hints and Relationship Inference', () => {
    const mockCollections = [
        {
            name: 'orders',
            documentCount: 500,
            fields: [
                { name: 'customerId', type: 'objectId', sample: '60d5ec49f1b24b1234567890' },
                { name: 'product_id', type: 'string', sample: 'PROD-100' },
                { name: 'amount', type: 'number', sample: 49.99 },
                { name: 'supplierId', type: 'string', sample: 'SUP-1' }, // supplier not in scope!
            ],
        },
        {
            name: 'customers',
            documentCount: 200,
            fields: [
                { name: 'name', type: 'string', sample: 'Alice' },
                { name: 'email', type: 'string', sample: 'alice@example.com' },
            ],
        },
        {
            name: 'products',
            documentCount: 50,
            fields: [
                { name: 'title', type: 'string', sample: 'Wireless Mouse' },
                { name: 'price', type: 'number', sample: 29.99 },
            ],
        },
    ];

    test('infers foreign key relationships between collections in scope', () => {
        const hints = inferRelationships(mockCollections);

        expect(hints).toContain('orders.customerId -> customers._id');
        expect(hints).toContain('orders.product_id -> products._id');
        // supplierId should NOT be inferred because suppliers is not in scope!
        expect(hints.some((h) => h.includes('supplierId'))).toBe(false);
    });

    test('ignores self-referencing collections and collections without matches', () => {
        const singleCol = [mockCollections[0]];
        const hints = inferRelationships(singleCol);
        expect(hints).toEqual([]);
    });

    test('formatMinifiedSchema includes Likely relationships block marked as hints', () => {
        const schema = {
            database: 'ecommerce_db',
            collections: mockCollections,
        };

        const minified = formatMinifiedSchema(schema);

        expect(minified).toContain('Likely relationships (inferred hints, not facts):');
        expect(minified).toContain('- orders.customerId -> customers._id');
        expect(minified).toContain('- orders.product_id -> products._id');
    });

    test('formatMinifiedSchema omits Likely relationships block when no hints exist', () => {
        const schema = {
            database: 'standalone_db',
            collections: [
                {
                    name: 'logs',
                    documentCount: 1000,
                    fields: [{ name: 'message', type: 'string', sample: 'App started' }],
                },
            ],
        };

        const minified = formatMinifiedSchema(schema);
        expect(minified).not.toContain('Likely relationships');
    });
});

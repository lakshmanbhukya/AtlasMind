/**
 * Unit tests for safetyGuard.js
 * Following TDD-workflow skill patterns for comprehensive coverage.
 */
const {
    validatePipeline,
    validateCollectionName,
    MAX_RESULT_LIMIT,
} = require('../src/services/safetyGuard');

// ───────────────────────────────────────────────────────────────
// validatePipeline
// ───────────────────────────────────────────────────────────────
describe('validatePipeline', () => {
    // ── Happy-path ──────────────────────────────────────────────
    describe('safe read-only pipelines', () => {
        it('accepts a simple $match + $group pipeline', () => {
            const result = validatePipeline([
                { $match: { status: 'completed' } },
                { $group: { _id: '$region', total: { $sum: '$amount' } } },
            ]);
            expect(result.safe).toBe(true);
        });

        it('accepts a pipeline with $sort, $project, $limit', () => {
            const result = validatePipeline([
                { $match: { active: true } },
                { $sort: { createdAt: -1 } },
                { $project: { name: 1, score: 1 } },
                { $limit: 10 },
            ]);
            expect(result.safe).toBe(true);
        });

        it('accepts a pipeline with $unwind', () => {
            const result = validatePipeline([
                { $unwind: '$tags' },
                { $group: { _id: '$tags', count: { $sum: 1 } } },
            ]);
            expect(result.safe).toBe(true);
        });

        it('accepts a pipeline with $lookup', () => {
            const result = validatePipeline([
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user',
                    },
                },
            ]);
            expect(result.safe).toBe(true);
        });

        it('accepts a pipeline with $count', () => {
            const result = validatePipeline([
                { $match: { status: 'active' } },
                { $count: 'totalActive' },
            ]);
            expect(result.safe).toBe(true);
        });
    });

    // ── Blocked stages ──────────────────────────────────────────
    describe('blocked stages', () => {
        const blockedStages = [
            '$out', '$merge', '$delete', '$drop',
            '$update', '$set', '$unset',
            '$replaceRoot', '$replaceWith',
        ];

        it.each(blockedStages)('blocks %s stage', (stage) => {
            const result = validatePipeline([{ [stage]: {} }]);
            expect(result.safe).toBe(false);
            expect(result.reason).toContain(stage);
        });

        it('reports the correct position of the blocked stage', () => {
            const result = validatePipeline([
                { $match: { x: 1 } },
                { $out: 'hackers' },
            ]);
            expect(result.safe).toBe(false);
            expect(result.reason).toContain('position 1');
        });
    });

    // ── Blocked operators (nested) ──────────────────────────────
    describe('blocked operators (nested)', () => {
        const blockedOps = [
            '$deleteMany', '$deleteOne',
            '$updateMany', '$updateOne',
            '$insertOne', '$insertMany',
            '$dropDatabase', '$dropCollection',
        ];

        it.each(blockedOps)('blocks nested %s operator', (op) => {
            const result = validatePipeline([
                { $match: { nested: { [op]: true } } },
            ]);
            expect(result.safe).toBe(false);
            expect(result.reason).toContain(op);
        });

        it('detects deeply nested blocked operators', () => {
            const result = validatePipeline([
                {
                    $match: {
                        a: { b: { c: { $deleteMany: {} } } },
                    },
                },
            ]);
            expect(result.safe).toBe(false);
        });
    });

    // ── $limit injection ────────────────────────────────────────
    describe('auto $limit injection', () => {
        it('injects $limit when none is present', () => {
            const result = validatePipeline([{ $match: { region: 'Europe' } }]);
            expect(result.safe).toBe(true);
            const limitStage = result.pipeline.find((s) => '$limit' in s);
            expect(limitStage).toBeDefined();
            expect(limitStage.$limit).toBe(MAX_RESULT_LIMIT);
        });

        it('does NOT inject extra $limit when one already exists', () => {
            const pipeline = [
                { $match: {} },
                { $limit: 5 },
            ];
            const result = validatePipeline(pipeline);
            expect(result.safe).toBe(true);
            expect(result.pipeline).toHaveLength(2); // no extra $limit added
        });
    });

    // ── Edge cases ──────────────────────────────────────────────
    describe('edge cases', () => {
        it('rejects non-array input', () => {
            const result = validatePipeline('not an array');
            expect(result.safe).toBe(false);
            expect(result.reason).toContain('array');
        });

        it('rejects null input', () => {
            const result = validatePipeline(null);
            expect(result.safe).toBe(false);
        });

        it('rejects undefined input', () => {
            const result = validatePipeline(undefined);
            expect(result.safe).toBe(false);
        });

        it('rejects empty pipeline', () => {
            const result = validatePipeline([]);
            expect(result.safe).toBe(false);
            expect(result.reason).toContain('empty');
        });

        it('rejects pipeline with > 20 stages', () => {
            const longPipeline = Array.from({ length: 21 }, () => ({ $match: {} }));
            const result = validatePipeline(longPipeline);
            expect(result.safe).toBe(false);
            expect(result.reason).toContain('too many stages');
        });

        it('accepts pipeline with exactly 20 stages', () => {
            const pipeline = Array.from({ length: 20 }, () => ({ $match: {} }));
            const result = validatePipeline(pipeline);
            expect(result.safe).toBe(true);
        });
    });
});

// ───────────────────────────────────────────────────────────────
// validateCollectionName
// ───────────────────────────────────────────────────────────────
describe('validateCollectionName', () => {
    describe('valid names', () => {
        it.each([
            'sample_sales',
            'users',
            'Products',
            'order_items_2024',
            '_private',
        ])('accepts "%s"', (name) => {
            expect(validateCollectionName(name).safe).toBe(true);
        });
    });

    describe('invalid names', () => {
        it('rejects empty string', () => {
            expect(validateCollectionName('').safe).toBe(false);
        });

        it('rejects null', () => {
            expect(validateCollectionName(null).safe).toBe(false);
        });

        it('rejects undefined', () => {
            expect(validateCollectionName(undefined).safe).toBe(false);
        });

        it('rejects numeric start', () => {
            expect(validateCollectionName('123abc').safe).toBe(false);
        });

        it('rejects names with dots', () => {
            expect(validateCollectionName('my.collection').safe).toBe(false);
        });

        it('rejects names with spaces', () => {
            expect(validateCollectionName('my collection').safe).toBe(false);
        });

        it('rejects names with special chars', () => {
            expect(validateCollectionName('col$name').safe).toBe(false);
        });
    });

    describe('system collection blocking', () => {
        it.each([
            'system.users',
            'system.buckets',
            'admin_ops',
            'local_cache',
            'config_settings',
        ])('blocks "%s"', (name) => {
            const result = validateCollectionName(name);
            // system.users also fails regex, but system-prefixed should fail
            expect(result.safe).toBe(false);
        });
    });
});

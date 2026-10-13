'use strict';

const { validatePipeline } = require('../services/safetyGuard');

describe('B4: safetyGuard hard-deny code execution operators ($function, $accumulator, $where)', () => {
    test('blocks $where at stage level without isWrite', () => {
        const pipeline = [
            { $where: 'this.amount > 100' },
        ];
        const res = validatePipeline(pipeline);
        expect(res.safe).toBe(false);
        expect(res.isWrite).toBeFalsy();
        expect(res.code).toBe('hard_blocked_operator');
        expect(res.reason).toContain('$where');
    });

    test('blocks $where nested inside $match without isWrite', () => {
        const pipeline = [
            { $match: { $where: 'sleep(5000)' } },
        ];
        const res = validatePipeline(pipeline);
        expect(res.safe).toBe(false);
        expect(res.isWrite).toBeFalsy();
        expect(res.code).toBe('hard_blocked_operator');
        expect(res.reason).toContain('$where');
    });

    test('blocks $function inside $project without isWrite', () => {
        const pipeline = [
            {
                $project: {
                    computed: {
                        $function: {
                            body: 'function(name) { return name.toUpperCase(); }',
                            args: ['$name'],
                            lang: 'js',
                        },
                    },
                },
            },
        ];
        const res = validatePipeline(pipeline);
        expect(res.safe).toBe(false);
        expect(res.isWrite).toBeFalsy();
        expect(res.code).toBe('hard_blocked_operator');
        expect(res.reason).toContain('$function');
    });

    test('blocks $accumulator inside $group without isWrite', () => {
        const pipeline = [
            {
                $group: {
                    _id: '$category',
                    customSum: {
                        $accumulator: {
                            init: 'function() { return { count: 0 }; }',
                            accumulate: 'function(state, val) { return { count: state.count + val }; }',
                            accumulateArgs: ['$price'],
                            merge: 'function(state1, state2) { return { count: state1.count + state2.count }; }',
                            lang: 'js',
                        },
                    },
                },
            },
        ];
        const res = validatePipeline(pipeline);
        expect(res.safe).toBe(false);
        expect(res.isWrite).toBeFalsy();
        expect(res.code).toBe('hard_blocked_operator');
        expect(res.reason).toContain('$accumulator');
    });

    test('recursively blocks $function nested inside $facet stages', () => {
        const pipeline = [
            {
                $facet: {
                    metrics: [
                        {
                            $project: {
                                calc: {
                                    $function: { body: 'function() { return 1; }', args: [], lang: 'js' },
                                },
                            },
                        },
                    ],
                },
            },
        ];
        const res = validatePipeline(pipeline);
        expect(res.safe).toBe(false);
        expect(res.isWrite).toBeFalsy();
        expect(res.code).toBe('hard_blocked_operator');
        expect(res.reason).toContain('$function');
    });

    test('recursively blocks $where nested inside $lookup.pipeline', () => {
        const pipeline = [
            {
                $lookup: {
                    from: 'orders',
                    pipeline: [
                        { $match: { $where: 'this.qty > 0' } },
                    ],
                    as: 'matching_orders',
                },
            },
        ];
        const res = validatePipeline(pipeline);
        expect(res.safe).toBe(false);
        expect(res.isWrite).toBeFalsy();
        expect(res.code).toBe('hard_blocked_operator');
        expect(res.reason).toContain('$where');
    });

    test('mutating stages like $out and $merge still return isWrite: true for staging/approval', () => {
        const outRes = validatePipeline([{ $out: 'backup_orders' }]);
        expect(outRes.safe).toBe(false);
        expect(outRes.isWrite).toBe(true);

        const mergeRes = validatePipeline([{ $merge: { into: 'target_orders' } }]);
        expect(mergeRes.safe).toBe(false);
        expect(mergeRes.isWrite).toBe(true);
    });

    test('allows standard safe aggregation pipeline', () => {
        const pipeline = [
            { $match: { status: 'active' } },
            { $group: { _id: '$dept', total: { $sum: '$salary' } } },
            { $sort: { total: -1 } },
        ];
        const res = validatePipeline(pipeline);
        expect(res.safe).toBe(true);
        expect(res.pipeline).toBeDefined();
    });
});

'use strict';

/**
 * Safe Execution verdict: one classification of (collection, pipeline, Effective Scope).
 * See docs/adr/0004-safe-execution-verdict.md.
 */

const { classifyExecution } = require('../services/safetyGuard');

const SCOPE = ['orders', 'customers', 'orders_archive'];
const TENANT_DB = 'shop';
const lookup = (from) => ({ $lookup: { from, localField: 'a', foreignField: 'b', as: 'c' } });

const classify = (pipeline, { scope = SCOPE, tenantDatabase = TENANT_DB, collection = 'orders' } = {}) =>
    classifyExecution({ collection, pipeline, scope, tenantDatabase });

describe('classifyExecution', () => {
    test.each([
        // [label, pipeline, options, expected kind, expected block code]
        ['safe read', [{ $match: { status: 'paid' } }], {}, 'runnable', null],
        ['read + out-of-scope $lookup', [lookup('secrets')], {}, 'scope_insufficient', 'out_of_scope_collection'],
        ['read + protected $lookup', [lookup('system_users')], {}, 'blocked', 'protected_collection'],
        ['final $merge in scope', [{ $match: {} }, { $merge: { into: 'orders_archive' } }], {}, 'needs_approval', null],
        ['$merge + out-of-scope $lookup', [lookup('secrets'), { $merge: { into: 'orders_archive' } }], {}, 'scope_insufficient', 'out_of_scope_collection'],
        ['$merge + $lookup from system_users', [lookup('system_users'), { $merge: { into: 'orders' } }], {}, 'blocked', 'protected_collection'],
        ['$merge into {db:admin}', [{ $merge: { into: { db: 'admin', coll: 'x' } } }], {}, 'blocked', 'protected_collection'],
        ['$merge into another db', [{ $merge: { into: { db: 'otherdb', coll: 'orders' } } }], {}, 'blocked', 'out_of_scope_collection'],
        ['$merge into the tenant db', [{ $merge: { into: { db: TENANT_DB, coll: 'orders_archive' } } }], {}, 'needs_approval', null],
        ['$merge target out of scope', [{ $merge: { into: 'elsewhere' } }], {}, 'blocked', 'out_of_scope_collection'],
        ['$merge target with no scope', [{ $merge: { into: 'elsewhere' } }], { scope: null }, 'needs_approval', null],
        ['$merge target with empty scope', [{ $merge: { into: 'elsewhere' } }], { scope: [] }, 'needs_approval', null],
        ['$merge into a protected collection', [{ $merge: { into: 'system_users' } }], { scope: null }, 'blocked', 'protected_collection'],
        ['$out string form', [{ $match: {} }, { $out: 'orders_archive' }], {}, 'needs_approval', null],
        ['$out not last', [{ $out: 'orders_archive' }, { $match: {} }], {}, 'blocked', 'blocked_write_stage'],
        ['$out inside $facet', [{ $facet: { a: [{ $out: 'orders_archive' }] } }], {}, 'blocked', 'blocked_write_stage'],
        ['$out then unknown stage', [{ $out: 'x' }, { $notAStage: 1 }], { scope: null }, 'blocked', 'blocked_write_stage'],
        ['two write stages', [{ $out: 'orders_archive' }, { $merge: { into: 'orders_archive' } }], {}, 'blocked', 'blocked_write_stage'],
        ['$merge + $where', [{ $match: { $where: 'true' } }, { $merge: { into: 'orders_archive' } }], {}, 'blocked', 'hard_blocked_operator'],
        ['$deleteMany key', [{ $match: { $deleteMany: {} } }], {}, 'blocked', 'blocked_write_operator'],
        ['$delete stage', [{ $delete: {} }], {}, 'blocked', 'blocked_write_stage'],
        ['only a $merge', [{ $merge: { into: 'x' } }], { scope: null }, 'needs_approval', null],
        ['$merge whenMatched pipeline', [{ $merge: { into: 'orders_archive', whenMatched: [{ $set: { a: 1 } }] } }], {}, 'blocked', 'restricted_stage'],
        ['$merge whenMatched replace', [{ $merge: { into: 'orders_archive', whenMatched: 'replace' } }], {}, 'needs_approval', null],
        ['read with $lookup into another db', [lookup({ db: 'otherdb', coll: 'customers' })], {}, 'blocked', 'out_of_scope_collection'],
        ['read with $lookup into the tenant db', [lookup({ db: TENANT_DB, coll: 'customers' })], {}, 'runnable', null],
        ['explicit db with unknown tenant db', [lookup({ db: TENANT_DB, coll: 'customers' })], { tenantDatabase: null }, 'blocked', 'out_of_scope_collection'],
        ['write db with unknown tenant db', [{ $merge: { into: { db: TENANT_DB, coll: 'orders_archive' } } }], { tenantDatabase: null }, 'blocked', 'out_of_scope_collection'],
        ['malformed $merge', [{ $merge: { into: 42 } }], {}, 'blocked', 'malformed_pipeline'],
        ['empty pipeline', [], {}, 'blocked', 'malformed_pipeline'],
        ['target collection out of scope', [{ $match: {} }], { collection: 'secrets' }, 'scope_insufficient', 'out_of_scope_collection'],
        ['protected target collection', [{ $match: {} }], { collection: 'system_users' }, 'blocked', 'protected_collection'],
    ])('%s', (_label, pipeline, options, kind, blockCode) => {
        const verdict = classify(pipeline, options);
        expect(verdict.kind).toBe(kind);
        if (blockCode) expect(verdict.block.code).toBe(blockCode);
    });

    test('runnable appends the result $limit', () => {
        expect(classify([{ $match: {} }]).pipeline).toEqual([{ $match: {} }, { $limit: 1000 }]);
    });

    test('needs_approval returns the pipeline unchanged and names the target', () => {
        const pipeline = [{ $match: { status: 'old' } }, { $merge: { into: 'orders_archive' } }];
        const verdict = classify(pipeline);
        expect(verdict.pipeline).toBe(pipeline);
        expect(verdict.write).toEqual({ stage: '$merge', stageIndex: 1, targetCollection: 'orders_archive' });
    });

    test('scope_insufficient lists the collections to add', () => {
        const verdict = classify([lookup('secrets'), { $merge: { into: 'orders_archive' } }]);
        expect(verdict.violatingCollections).toEqual(['secrets']);
    });

    test('a blocked write target is located at the write stage', () => {
        const verdict = classify([{ $match: {} }, { $merge: { into: 'elsewhere' } }]);
        expect(verdict.block).toMatchObject({
            referenceType: 'Write target collection',
            reference: 'elsewhere',
            stage: '$merge',
            stageIndex: 1,
        });
    });

    test('the example from the review is no longer approvable', () => {
        const verdict = classify([{ $lookup: { from: 'system_users' } }, { $merge: { into: 'orders' } }], { scope: ['orders'] });
        expect(verdict.kind).toBe('blocked');
    });
});

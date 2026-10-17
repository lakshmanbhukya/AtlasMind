'use strict';

const { validatePipeline, validateCollectionName } = require('../services/safetyGuard');

describe('Phase 3: Nested Pipeline Safety & Document-form $lookup Validation', () => {

  // -------------------------------------------------------------------------
  // 1. Nested Stage Allowlist & Blocklist Validation
  // -------------------------------------------------------------------------
  describe('Nested Stage Validation ($facet, $lookup.pipeline, $unionWith.pipeline)', () => {
    const allowed = ['orders', 'customers', 'products'];

    test('blocks unallowed admin stages ($collStats, $currentOp) nested inside $facet', () => {
      const pipeline = [
        {
          $facet: {
            statsBranch: [{ $collStats: {} }],
            normalBranch: [{ $limit: 5 }],
          },
        },
      ];

      const res = validatePipeline(pipeline, { allowedCollections: allowed, targetCollection: 'orders' });
      expect(res.safe).toBe(false);
      expect(res.reason).toMatch(/Unrecognized or restricted pipeline stage "\$collStats"/);
    });

    test('blocks mutating write stages ($out, $merge) nested inside $lookup.pipeline', () => {
      const pipeline = [
        {
          $lookup: {
            from: 'customers',
            pipeline: [
              { $match: { active: true } },
              { $out: 'pwned_collection' },
            ],
            as: 'customerData',
          },
        },
      ];

      const res = validatePipeline(pipeline, { allowedCollections: allowed, targetCollection: 'orders' });
      expect(res.safe).toBe(false);
      expect(res.isWrite).toBe(true);
      expect(res.reason).toMatch(/Blocked stage "\$out"/);
    });

    test('blocks unallowed stages ($indexStats) nested inside $unionWith.pipeline', () => {
      const pipeline = [
        {
          $unionWith: {
            coll: 'products',
            pipeline: [{ $indexStats: {} }],
          },
        },
      ];

      const res = validatePipeline(pipeline, { allowedCollections: allowed, targetCollection: 'orders' });
      expect(res.safe).toBe(false);
      expect(res.reason).toMatch(/Unrecognized or restricted pipeline stage "\$indexStats"/);
    });

    test('allows valid analytical stages nested inside $facet, $lookup, and $unionWith', () => {
      const pipeline = [
        {
          $facet: {
            topProducts: [
              { $lookup: { from: 'products', pipeline: [{ $match: { inStock: true } }, { $project: { name: 1 } }], as: 'p' } },
              { $limit: 5 },
            ],
            totalCount: [
              { $unionWith: { coll: 'orders', pipeline: [{ $match: { completed: true } }] } },
              { $count: 'cnt' },
            ],
          },
        },
      ];

      const res = validatePipeline(pipeline, { allowedCollections: allowed, targetCollection: 'orders' });
      expect(res.safe).toBe(true);
      expect(res.pipeline).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Document-form $lookup.from Validation
  // -------------------------------------------------------------------------
  describe('Document-form $lookup.from Validation', () => {
    const allowed = ['orders', 'customers'];

    test('accepts valid document-form $lookup.from with authorized collection', () => {
      const pipeline = [
        {
          $lookup: {
            from: { coll: 'customers' },
            as: 'customerData',
          },
        },
      ];

      const res = validatePipeline(pipeline, { allowedCollections: allowed, targetCollection: 'orders' });
      expect(res.safe).toBe(true);
    });

    test('accepts valid document-form $lookup.from with matching targetDatabase', () => {
      const pipeline = [
        {
          $lookup: {
            from: { db: 'sales_db', coll: 'customers' },
            as: 'customerData',
          },
        },
      ];

      const res = validatePipeline(pipeline, {
        allowedCollections: allowed,
        targetCollection: 'orders',
        targetDatabase: 'sales_db',
      });
      expect(res.safe).toBe(true);
    });

    test('blocks document-form $lookup.from when database is admin or system', () => {
      const pipeline = [
        {
          $lookup: {
            from: { db: 'admin', coll: 'system.users' },
            as: 'leak',
          },
        },
      ];

      const res = validatePipeline(pipeline, { allowedCollections: allowed, targetCollection: 'orders' });
      expect(res.safe).toBe(false);
      expect(res.code).toBe('scope_violation');
      expect(res.reason).toMatch(/not allowed/i);
    });

    test('blocks document-form $lookup.from when database differs from targetDatabase (cross-db leak)', () => {
      const pipeline = [
        {
          $lookup: {
            from: { db: 'unauthorized_db', coll: 'customers' },
            as: 'leak',
          },
        },
      ];

      const res = validatePipeline(pipeline, {
        allowedCollections: allowed,
        targetCollection: 'orders',
        targetDatabase: 'sales_db',
      });
      expect(res.safe).toBe(false);
      expect(res.code).toBe('scope_violation');
      expect(res.reason).toMatch(/outside authorized scope/i);
    });

    test('blocks document-form $lookup.from when collection is out-of-scope', () => {
      const pipeline = [
        {
          $lookup: {
            from: { coll: 'confidential_payroll' },
            as: 'leak',
          },
        },
      ];

      const res = validatePipeline(pipeline, { allowedCollections: allowed, targetCollection: 'orders' });
      expect(res.safe).toBe(false);
      expect(res.code).toBe('scope_violation');
      expect(res.violatingCollections).toContain('confidential_payroll');
    });

    test('rejects malformed document-form $lookup.from with unexpected injection keys', () => {
      const pipeline = [
        {
          $lookup: {
            from: { coll: 'customers', unexpectedInjection: true },
            as: 'leak',
          },
        },
      ];

      const res = validatePipeline(pipeline, { allowedCollections: allowed, targetCollection: 'orders' });
      expect(res.safe).toBe(false);
      expect(res.reason).toMatch(/unexpected keys/i);
    });

    test('rejects malformed document-form $lookup.from with non-string coll property', () => {
      const pipeline = [
        {
          $lookup: {
            from: { coll: 12345 },
            as: 'leak',
          },
        },
      ];

      const res = validatePipeline(pipeline, { allowedCollections: allowed, targetCollection: 'orders' });
      expect(res.safe).toBe(false);
    });

    test('rejects malformed $lookup.from with invalid types (number, array)', () => {
      const pipeline1 = [{ $lookup: { from: 99999, as: 'leak' } }];
      const pipeline2 = [{ $lookup: { from: ['customers'], as: 'leak' } }];

      expect(validatePipeline(pipeline1).safe).toBe(false);
      expect(validatePipeline(pipeline2).safe).toBe(false);
    });
  });
});

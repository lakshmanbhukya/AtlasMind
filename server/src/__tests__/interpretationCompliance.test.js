'use strict';

const { verifyInterpretationCompliance, inferExpectedDirection } = require('../services/interpretationComplianceVerifier');

describe('Interpretation Compliance Verifier Tests', () => {
  test('correctly infers ranking direction from query text', () => {
    expect(inferExpectedDirection('Show top 10 products')).toBe(-1);
    expect(inferExpectedDirection('Which items have highest sales?')).toBe(-1);
    expect(inferExpectedDirection('Find the best movies')).toBe(-1);
    expect(inferExpectedDirection('List the worst performing items')).toBe(1);
    expect(inferExpectedDirection('Which accounts had the lowest balance?')).toBe(1);
  });

  test('passes direct-field ranking in requested direction', () => {
    const pipeline = [
      { $match: { type: 'movie' } },
      { $sort: { runtime: -1 } },
      { $limit: 10 }
    ];
    const res = verifyInterpretationCompliance(pipeline, 'runtime', 'Find longest movies');
    expect(res.compliant).toBe(true);
    expect(res.details.direction).toBe(-1);
  });

  test('passes unwound array with $group $sum accumulator and alias sort', () => {
    const pipeline = [
      { $unwind: '$items' },
      { $group: { _id: '$items.name', totalQuantity: { $sum: '$items.quantity' } } },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 }
    ];
    const res = verifyInterpretationCompliance(pipeline, 'items[].quantity', 'Show top products by sales');
    expect(res.compliant).toBe(true);
    expect(res.details.sortField).toBe('totalQuantity');
    expect(res.details.aliasMatch.op).toBe('$sum');
  });

  test('detects noncompliance when pipeline sorts on wrong metric', () => {
    // User clarified quantity, but LLM sorted on price!
    const pipeline = [
      { $unwind: '$items' },
      { $group: { _id: '$items.name', totalRevenue: { $sum: '$items.price' } } },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 }
    ];
    const res = verifyInterpretationCompliance(pipeline, 'items[].quantity', 'Show top products');
    expect(res.compliant).toBe(false);
    expect(res.reason).toContain('clarified metric "items.quantity"');
  });

  test('detects noncompliance when pipeline sorts in wrong direction', () => {
    // Query asked for "highest", but pipeline sorts ascending (1)
    const pipeline = [
      { $sort: { 'imdb.rating': 1 } },
      { $limit: 10 }
    ];
    const res = verifyInterpretationCompliance(pipeline, 'imdb.rating', 'Show highest rated films');
    expect(res.compliant).toBe(false);
    expect(res.reason).toContain('direction 1, expected -1');
  });

  test('detects noncompliance when query asked for ranking but pipeline has no $sort', () => {
    const pipeline = [
      { $match: { status: 'active' } },
      { $limit: 10 }
    ];
    const res = verifyInterpretationCompliance(pipeline, 'price', 'Show top items by price');
    expect(res.compliant).toBe(false);
    expect(res.reason).toContain('contains no $sort stage');
  });
});

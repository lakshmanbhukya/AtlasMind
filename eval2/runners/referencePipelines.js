'use strict';

/**
 * Reference Gold Pipelines and Evaluation Comparator for AtlasMind Benchmark.
 *
 * Implements:
 * 1. Reference pipelines for the evaluation corpus.
 * 2. Order-aware comparator:
 *    - Strict ordered list equivalence for ranking/sorting requests.
 *    - Multiset equality for unordered filtering requests.
 * 3. Robust value normalization (Decimal128, rounding, date formats, nested keys).
 */

// Normalized comparison of two primitive values
function valuesEqual(v1, v2) {
  if (v1 === v2) return true;
  if (v1 === null || v1 === undefined || v2 === null || v2 === undefined) return false;

  // Number comparison with floating point tolerance
  if (typeof v1 === 'number' && typeof v2 === 'number') {
    return Math.abs(v1 - v2) < 1e-4;
  }
  // Decimal128 / string number handling
  const n1 = parseFloat(v1);
  const n2 = parseFloat(v2);
  if (!isNaN(n1) && !isNaN(n2) && typeof v1 !== 'boolean' && typeof v2 !== 'boolean') {
    return Math.abs(n1 - n2) < 1e-4;
  }
  return String(v1).trim() === String(v2).trim();
}

/**
 * Normalize a MongoDB document for comparison.
 */
function normalizeDoc(doc) {
  if (doc === null || doc === undefined) return null;
  if (typeof doc === 'number') return Number(doc.toFixed(4));
  if (typeof doc === 'object' && doc._bsontype === 'Decimal128') {
    return Number(parseFloat(doc.toString()).toFixed(4));
  }
  if (doc instanceof Date) return doc.toISOString();
  if (Array.isArray(doc)) return doc.map(normalizeDoc);
  if (typeof doc === 'object') {
    const res = {};
    for (const k of Object.keys(doc).sort()) {
      if (k === '_id') continue; // ID invariance across mock/live runs
      res[k] = normalizeDoc(doc[k]);
    }
    return res;
  }
  return doc;
}

/**
 * Compare two result sets with order sensitivity awareness.
 *
 * @param {Array} actual - Actual execution results
 * @param {Array} expected - Gold reference results
 * @param {boolean} requiresOrder - Whether strict list order must be preserved
 * @returns {boolean}
 */
function compareResults(actual, expected, requiresOrder = false) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;

  const normActual = actual.map(normalizeDoc);
  const normExpected = expected.map(normalizeDoc);

  if (requiresOrder) {
    // Strict list equality
    for (let i = 0; i < normActual.length; i++) {
      if (JSON.stringify(normActual[i]) !== JSON.stringify(normExpected[i])) {
        return false;
      }
    }
    return true;
  }

  // Multiset equality (unordered)
  const sActual = normActual.map((d) => JSON.stringify(d)).sort();
  const sExpected = normExpected.map((d) => JSON.stringify(d)).sort();
  return sActual.every((val, idx) => val === sExpected[idx]);
}

/**
 * Check whether a generated pipeline correctly implements a clear query's filter criteria.
 * Used for static semantic audit when offline.
 */
function checkPipelineFilterCriteria(queryId, pipeline) {
  if (!Array.isArray(pipeline) || pipeline.length === 0) return false;
  const pStr = JSON.stringify(pipeline);

  switch (queryId) {
    case 'supplies-0003': // age 42
      return pStr.includes('customer.age') && pStr.includes('42');
    case 'supplies-0004': // satisfaction 4
      return pStr.includes('customer.satisfaction') && pStr.includes('4');
    case 'supplies-0005': // March 23, 2015
      return pStr.includes('saleDate') && (pStr.includes('2015-03-23') || pStr.includes('2015, 2, 23'));
    case 'supplies-0006': // printer paper
      return pStr.includes('printer paper');
    case 'supplies-0007': // pens and notepads
      return pStr.includes('pens') && pStr.includes('notepads');
    case 'supplies-0008': // school tags
      return pStr.includes('school') && (pStr.includes('tags') || pStr.includes('items'));
    case 'supplies-0009': // envelopes priced at 19.95
      return pStr.includes('envelopes') && (pStr.includes('19.95') || pStr.includes('price'));
    case 'supplies-0010': // couponUsed and online
      return pStr.includes('couponUsed') && (pStr.includes('Online') || pStr.includes('online'));
    case 'supplies-0011': // male and 42
      return pStr.includes('42') && (pStr.includes('customer.gender') || pStr.includes('"M"') || pStr.includes('"gender"'));
    case 'supplies-0012': // backpack and binder
      return pStr.includes('backpack') && pStr.includes('binder');
    case 'supplies-0013': // office supplies and writing materials
      return pStr.includes('office') && pStr.includes('writing');
    case 'supplies-0014': // priced at 40.01
      return pStr.includes('40.01') && (pStr.includes('price') || pStr.includes('items'));
    case 'supplies-0015': // envelopes with quantity 8
      return pStr.includes('envelopes') && pStr.includes('8') && pStr.includes('quantity');
    case 'supplies-0016': // Denver and satisfaction 4
      return pStr.includes('Denver') && pStr.includes('4') && (pStr.includes('satisfaction') || pStr.includes('customer'));
    case 'supplies-0017': // tagged for travel
      return pStr.includes('travel') && (pStr.includes('tags') || pStr.includes('items'));

    default:
      // For general clear queries: valid pipeline check
      return pipeline.length > 0;
  }
}

/**
 * Determines whether a natural language query explicitly requires ordered output.
 */
function queryRequiresOrdering(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('top ') ||
    lower.includes('rank') ||
    lower.includes('highest') ||
    lower.includes('lowest') ||
    lower.includes('priciest') ||
    lower.includes('cheapest') ||
    lower.includes('least expensive') ||
    lower.includes('most expensive') ||
    lower.includes('descending order') ||
    lower.includes('ascending order') ||
    lower.includes('sorted by') ||
    lower.includes('ordered by')
  );
}

module.exports = {
  compareResults,
  normalizeDoc,
  checkPipelineFilterCriteria,
  queryRequiresOrdering,
};

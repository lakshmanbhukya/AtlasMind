'use strict';

/**
 * Interpretation Compliance Verifier for AtlasMind.
 *
 * Verifies that a generated MongoDB aggregation pipeline faithfully implements
 * the user's selected clarification metric and requested ranking direction,
 * preventing silent drift or hallucinations where the LLM ignores the user's card choice.
 *
 * Architecture Position:
 *   User clarification -> Structured interpretation -> Pipeline generation
 *   -> Interpretation-compliance check -> Safety validation -> Execution
 *
 * Supported Patterns:
 *  1. Direct-field ranking: $sort: { <targetField>: direction }
 *  2. Unwound array aggregation: $unwind: "$array" -> $group: { <alias>: { $sum|$avg|$max|$min: "$array.<field>" } } -> $sort: { <alias>: direction }
 *  3. Group accumulator ranking: $group: { <alias>: { $sum|$avg|$max|$min: "$<targetField>" } } -> $sort: { <alias>: direction }
 *  4. Calculated metric ranking: $addFields / $project combining target field -> $sort
 *
 * Boundaries / Limitations:
 *  Explicitly restricted to direct-field ranking and single-hop aggregation patterns.
 *  Complex recursive graph pipelines, multi-hop sub-lookups, and custom reduce expressions
 *  are not verified semantically.
 */

const DESC_KEYWORDS = new Set(['top', 'highest', 'best', 'most', 'largest', 'biggest', 'greatest', 'strongest', 'leading', 'max', 'successful']);
const ASC_KEYWORDS = new Set(['lowest', 'least', 'worst', 'smallest', 'minimum', 'min']);

/**
 * Infer expected sort direction (-1 for desc, 1 for asc) from query text.
 */
function inferExpectedDirection(queryText) {
  if (!queryText || typeof queryText !== 'string') return -1;
  const lower = queryText.toLowerCase();
  const words = lower.replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(Boolean);

  for (const w of words) {
    if (ASC_KEYWORDS.has(w)) return 1;
    if (DESC_KEYWORDS.has(w)) return -1;
  }
  return -1; // Default to desc for vague superlative queries
}

/**
 * Extract target metric clean name and leaf name.
 */
function normalizeMetricField(metricStr) {
  if (!metricStr || typeof metricStr !== 'string') return { full: '', leaf: '', clean: '' };
  const clean = metricStr.replace(/\[\]/g, '').trim();
  const leaf = clean.includes('.') ? clean.split('.').pop() : clean;
  return { full: metricStr, clean, leaf };
}

/**
 * Verify interpretation compliance of a pipeline against a clarified metric.
 *
 * @param {Array<object>} pipeline - The generated aggregation pipeline
 * @param {string|object} clarifiedMetric - The metric selected by user (field name or clarification object)
 * @param {string} [queryText=''] - Original query text to infer ranking direction
 * @returns {{ compliant: boolean, reason?: string, details?: object }}
 */
function verifyInterpretationCompliance(pipeline, clarifiedMetric, queryText = '') {
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return {
      compliant: false,
      reason: 'Pipeline is empty or not an array',
      details: { supported: true },
    };
  }

  // Extract metric name
  let targetMetricRaw = '';
  if (typeof clarifiedMetric === 'string') {
    targetMetricRaw = clarifiedMetric;
  } else if (clarifiedMetric && typeof clarifiedMetric === 'object') {
    targetMetricRaw = clarifiedMetric.value || clarifiedMetric.customText || clarifiedMetric.text || '';
  }

  if (!targetMetricRaw || targetMetricRaw === '__other__') {
    // If user provided a raw text interpretation in __other__, check if a field can be identified
    if (clarifiedMetric?.customText) {
      targetMetricRaw = clarifiedMetric.customText;
    } else {
      return { compliant: true, details: { skipped: true, reason: 'unstructured_other_metric' } };
    }
  }

  const { clean: targetClean, leaf: targetLeaf } = normalizeMetricField(targetMetricRaw);
  const expectedDirection = inferExpectedDirection(queryText);

  // Track aliases defined in pipeline stages ($group, $addFields, $project)
  const aliasToFieldMap = new Map();
  let hasUnwindForArray = false;
  let arrayRoot = targetClean.includes('.') ? targetClean.split('.')[0] : null;

  // Scan stages in sequence
  for (const stage of pipeline) {
    if (!stage || typeof stage !== 'object') continue;

    // Check $unwind
    if (stage.$unwind) {
      const unwindPath = typeof stage.$unwind === 'string'
        ? stage.$unwind
        : (typeof stage.$unwind.path === 'string' ? stage.$unwind.path : '');
      const cleanUnwind = unwindPath.replace(/^\$/, '');
      if (arrayRoot && (cleanUnwind === arrayRoot || cleanUnwind.startsWith(arrayRoot))) {
        hasUnwindForArray = true;
      }
    }

    // Check $group accumulators
    if (stage.$group && typeof stage.$group === 'object') {
      for (const [key, expr] of Object.entries(stage.$group)) {
        if (key === '_id') continue;
        if (expr && typeof expr === 'object') {
          const accOp = Object.keys(expr)[0]; // e.g. $sum, $avg, $max, $min
          const accVal = expr[accOp];
          const accValStr = JSON.stringify(accVal);
          if (
            accValStr.includes(`$${targetClean}`) ||
            accValStr.includes(`$${targetLeaf}`) ||
            accValStr.includes(`"${targetClean}"`) ||
            accValStr.includes(`"${targetLeaf}"`)
          ) {
            aliasToFieldMap.set(key, { source: targetClean, op: accOp });
          }
        }
      }
    }

    // Check $addFields / $set
    const addFieldsStage = stage.$addFields || stage.$set;
    if (addFieldsStage && typeof addFieldsStage === 'object') {
      for (const [key, expr] of Object.entries(addFieldsStage)) {
        const exprStr = JSON.stringify(expr);
        if (
          exprStr.includes(`$${targetClean}`) ||
          exprStr.includes(`$${targetLeaf}`) ||
          exprStr.includes(`"${targetClean}"`) ||
          exprStr.includes(`"${targetLeaf}"`)
        ) {
          aliasToFieldMap.set(key, { source: targetClean, op: 'calculated' });
        }
      }
    }

    // Check $project
    if (stage.$project && typeof stage.$project === 'object') {
      for (const [key, expr] of Object.entries(stage.$project)) {
        if (expr && typeof expr === 'object') {
          const exprStr = JSON.stringify(expr);
          if (
            exprStr.includes(`$${targetClean}`) ||
            exprStr.includes(`$${targetLeaf}`)
          ) {
            aliasToFieldMap.set(key, { source: targetClean, op: 'projected' });
          }
        }
      }
    }
  }

  // Find $sort stages
  const sortStages = pipeline.filter((s) => s && s.$sort && typeof s.$sort === 'object');
  if (sortStages.length === 0) {
    // Pipeline has no sort stage, but query asked for ranking (top/best/worst)
    return {
      compliant: false,
      reason: `Query requested ranking but pipeline contains no $sort stage for metric "${targetClean}"`,
      details: { targetClean, expectedDirection, foundSort: false },
    };
  }

  // Check the last $sort stage (or any $sort stage)
  let foundCompliantSort = false;
  let sortMismatchReason = '';

  for (const sortStage of sortStages) {
    const sortObj = sortStage.$sort;
    for (const [sortField, sortDir] of Object.entries(sortObj)) {
      const cleanSortField = sortField.replace(/^\$/, '');
      const isDirectTarget =
        cleanSortField === targetClean ||
        cleanSortField === targetLeaf ||
        cleanSortField.endsWith('.' + targetLeaf);

      const aliasMatch = aliasToFieldMap.get(cleanSortField);
      const isCompliantMetric = isDirectTarget || Boolean(aliasMatch);

      if (isCompliantMetric) {
        // Metric matches! Now check direction:
        const dirNum = Number(sortDir);
        if (dirNum === expectedDirection) {
          foundCompliantSort = true;
          return {
            compliant: true,
            details: {
              targetMetric: targetClean,
              sortField: cleanSortField,
              direction: dirNum,
              aliasMatch: aliasMatch || null,
              unwindUsed: hasUnwindForArray,
            },
          };
        } else {
          sortMismatchReason = `Pipeline sorts on "${cleanSortField}" with direction ${dirNum}, expected ${expectedDirection}`;
        }
      } else {
        sortMismatchReason = `Pipeline sorts on "${cleanSortField}" instead of clarified metric "${targetClean}"`;
      }
    }
  }

  return {
    compliant: false,
    reason: sortMismatchReason || `Pipeline does not sort on clarified metric "${targetClean}"`,
    details: {
      targetClean,
      expectedDirection,
      aliasCount: aliasToFieldMap.size,
    },
  };
}

module.exports = {
  verifyInterpretationCompliance,
  inferExpectedDirection,
  normalizeMetricField,
};

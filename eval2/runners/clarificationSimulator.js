'use strict';

/**
 * Fair Clarification Simulator for AtlasMind Evaluations.
 *
 * Provides a standardized response policy across all evaluated systems (C0a, C0b, C2).
 * Follows the rigorous requirements:
 * 1. Store hidden intended interpretation for each ambiguous query.
 * 2. Uniform response policy:
 *    - If question asks about intended metric, provide that metric.
 *    - If choices offered, select correct choice if present.
 *    - If correct choice absent, select 'Other' / '__other__' with intended metric text.
 *    - If open-ended question, reply with the intended interpretation.
 *    - If asked on a clear query, trigger bypass / state unambiguous intent.
 * 3. Enforces identical turn budget across all systems (default max 1 clarification turn).
 * 4. Strictly never reveals reference pipeline or MQL code to the generator.
 */

// Normalized metric aliases for schema field matching
const FIELD_ALIASES = {
  'items[].price': ['price', 'items.price', 'item price', 'items[].price', 'unit price', 'revenue', 'sales amount'],
  'items[].quantity': ['quantity', 'items.quantity', 'quantity sold', 'total quantity', 'units sold', 'items[].quantity', 'units'],
  'customer.age': ['age', 'customer age', 'customer.age'],
  'customer.satisfaction': ['satisfaction', 'customer satisfaction', 'rating', 'customer.satisfaction'],
  'transactions[].amount': ['amount', 'trading amount', 'trade amount', 'transactions.amount', 'transactions[].amount', 'volume'],
  'transaction_count': ['transaction count', 'transaction_count', 'number of transactions', 'trades count'],
  'limit': ['limit', 'credit limit', 'account limit'],
  'awards.wins': ['awards wins', 'wins', 'awards.wins', 'award wins', 'number of awards'],
  'awards.nominations': ['awards nominations', 'nominations', 'awards.nominations'],
  'imdb.rating': ['imdb rating', 'rating', 'imdb.rating', 'score'],
  'imdb.votes': ['imdb votes', 'votes', 'imdb.votes', 'viewer votes'],
  'runtime': ['runtime', 'duration', 'length'],
  'tomatoes.viewer.rating': ['viewer rating', 'tomatoes.viewer.rating', 'audience score'],
  'tomatoes.critic.rating': ['critic rating', 'tomatoes.critic.rating', 'tomatometer'],
  'tomatoes.rotten': ['rotten count', 'rotten', 'tomatoes.rotten'],
  'tomatoes.fresh': ['fresh count', 'fresh', 'tomatoes.fresh'],
};

/**
 * Checks if a given option value or label matches the intended metric.
 */
function optionMatchesMetric(option, intendedMetric) {
  if (!option || !intendedMetric) return false;
  const optVal = String(option.value || '').trim().toLowerCase();
  const optLabel = String(option.label || '').trim().toLowerCase();
  const targetNorm = intendedMetric.toLowerCase().replace(/\[\]/g, '');

  if (optVal === targetNorm || optVal === intendedMetric.toLowerCase()) return true;
  if (optLabel === targetNorm || optLabel === intendedMetric.toLowerCase()) return true;

  const aliases = FIELD_ALIASES[intendedMetric] || [targetNorm];
  for (const alias of aliases) {
    const aliasNorm = alias.toLowerCase();
    if (optVal === aliasNorm || optLabel === aliasNorm) return true;
    if (optVal.includes(aliasNorm) || optLabel.includes(aliasNorm)) return true;
  }
  return false;
}

/**
 * Simulate response to clarification question.
 *
 * @param {object} params
 * @param {object} params.question - The question object (from gate or LLM)
 * @param {object} params.intended - The hidden intended interpretation for this query
 * @param {boolean} params.isClearQuery - Whether the query is human-labeled clear
 * @param {number} [params.turnIndex=0] - Current clarification turn index (0-based)
 * @param {number} [params.maxTurns=1] - Turn budget
 * @returns {object} { answered: boolean, response: any, bypass: boolean, unresolved: boolean, usedOther: boolean }
 */
function simulateClarificationResponse({
  question,
  intended,
  isClearQuery = false,
  turnIndex = 0,
  maxTurns = 1,
}) {
  // Check turn budget
  if (turnIndex >= maxTurns) {
    return {
      answered: false,
      response: null,
      bypass: false,
      unresolved: true,
      reason: 'turn_budget_exhausted',
    };
  }

  // If query is clear (gate or LLM asked an unnecessary clarification):
  if (isClearQuery) {
    return {
      answered: true,
      response: null,
      bypass: true,
      unresolved: false,
      usedOther: false,
      clarificationText: 'Please proceed with the query as originally specified.',
    };
  }

  // Ambiguous query: resolve using hidden intended interpretation
  const intendedMetric = intended?.intendedMetric || intended?.goldCandidate || '';
  const intendedText = intended?.intendedInterpretation || `Use ${intendedMetric}`;
  const qObj = question || {};
  const options = Array.isArray(qObj.options) ? qObj.options : [];

  if (options.length > 0) {
    // 1. Try to find intended metric in offered choices
    const matched = options.find((opt) => optionMatchesMetric(opt, intendedMetric));
    if (matched) {
      return {
        answered: true,
        response: {
          id: qObj.id || 'metric',
          value: matched.value,
          label: matched.label || matched.value,
        },
        bypass: false,
        unresolved: false,
        usedOther: false,
        clarificationText: `I want to use ${matched.label || matched.value}.`,
      };
    }

    // 2. Intended metric not in offered choices -> select 'Other' or '__other__'
    const otherOption = options.find(
      (opt) => opt.value === '__other__' || opt.value?.toLowerCase() === 'other' || opt.label?.toLowerCase().includes('other')
    );
    const otherVal = otherOption ? otherOption.value : '__other__';
    return {
      answered: true,
      response: {
        id: qObj.id || 'metric',
        value: otherVal,
        customText: intendedMetric || intendedText,
      },
      bypass: false,
      unresolved: false,
      usedOther: true,
      clarificationText: intendedText,
    };
  }

  // 3. Open-ended question (free text, common with LLM-initiated clarifications)
  return {
    answered: true,
    response: {
      id: qObj.id || 'clarification',
      value: intendedText,
      text: intendedText,
      customText: intendedText,
    },
    bypass: false,
    unresolved: false,
    usedOther: false,
    clarificationText: intendedText,
  };
}

module.exports = {
  simulateClarificationResponse,
  optionMatchesMetric,
  FIELD_ALIASES,
};

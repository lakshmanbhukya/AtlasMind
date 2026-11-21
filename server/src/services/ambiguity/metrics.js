// @ts-check
/** Ambiguity Gate: in-process ambiguity metrics. Holds module-level state, so there is exactly one instance. */

const log = require('../../utils/logger').logger.child({ module: 'ambiguityGate' });

// ---------------------------------------------------------------------------
// Lightweight Instrumentation / Metrics
// ---------------------------------------------------------------------------

const metricsStore = {
    totalQueriesEvaluated: 0,
    ambiguity_asked: 0,
    ambiguity_skipped: 0,
    ambiguity_resolved: 0,
    ambiguity_bypassed: 0,
    clarification_edit: 0,
    generation_after_clarification: 0,
};

/**
 * Record an ambiguity lifecycle metric event without logging sensitive query text.
 *
 * @param {'ambiguity_asked'|'ambiguity_skipped'|'ambiguity_resolved'|'ambiguity_bypassed'|'clarification_edit'|'generation_after_clarification'|'query_evaluated'} event
 * @param {Record<string, any>} [meta]
 */
function recordAmbiguityMetric(event, meta = {}) {
    if (event === 'query_evaluated') {
        metricsStore.totalQueriesEvaluated += 1;
        return;
    }
    if (Object.prototype.hasOwnProperty.call(metricsStore, event)) {
        metricsStore[event] += 1;
    }
    log.debug({
        event,
        connectionId: meta.connectionId || 'anonymous',
        source: meta.source || 'query',
    }, 'Ambiguity metric');
}

/**
 * Retrieve current ambiguity metrics and derived rates.
 * @returns {Record<string, any>}
 */
function getAmbiguityMetrics() {
    const total = Math.max(metricsStore.totalQueriesEvaluated, metricsStore.ambiguity_asked + metricsStore.ambiguity_skipped, 1);
    const asked = Math.max(metricsStore.ambiguity_asked, 1);
    const resolved = Math.max(metricsStore.ambiguity_resolved, 1);

    return {
        counts: { ...metricsStore },
        rates: {
            askRate: Number((metricsStore.ambiguity_asked / total).toFixed(4)),
            skipRate: Number((metricsStore.ambiguity_bypassed / asked).toFixed(4)),
            resolutionRate: Number((metricsStore.ambiguity_resolved / asked).toFixed(4)),
            editAfterResultRate: Number((metricsStore.clarification_edit / resolved).toFixed(4)),
            successfulExecutionRateAfterClarification: Number(
                (metricsStore.generation_after_clarification / Math.max(metricsStore.ambiguity_resolved + metricsStore.ambiguity_bypassed, 1)).toFixed(4)
            ),
        },
    };
}

/**
 * Reset metrics counters (primarily for testing).
 */
function resetAmbiguityMetrics() {
    metricsStore.totalQueriesEvaluated = 0;
    metricsStore.ambiguity_asked = 0;
    metricsStore.ambiguity_skipped = 0;
    metricsStore.ambiguity_resolved = 0;
    metricsStore.ambiguity_bypassed = 0;
    metricsStore.clarification_edit = 0;
    metricsStore.generation_after_clarification = 0;
}

module.exports = {
    getAmbiguityMetrics,
    recordAmbiguityMetric,
    resetAmbiguityMetrics,
};

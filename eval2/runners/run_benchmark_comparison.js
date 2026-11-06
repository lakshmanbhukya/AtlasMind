'use strict';

const fs = require('fs');
const path = require('path');
require(path.resolve(__dirname, '../../server/node_modules/dotenv')).config({
  path: path.resolve(__dirname, '../../server/.env'),
});

const { executeQueryUnderProtocol, validateSingleApiKey } = require('./run_fair_comparison');

async function runBenchmarkComparison(options = {}) {
  console.log('=== FAIR BASELINE COMPARISON EVALUATION ===\n');

  const apiKey = validateSingleApiKey();
  const targetModel = options.model || 'openai/gpt-oss-120b';
  const limit = options.limit || null; // e.g. 15 or null for all

  console.log(`Target Model: ${targetModel}`);
  console.log(`Limit:        ${limit ? limit + ' queries' : 'Full 100-query e2e_subset'}`);

  // Load benchmark subset
  const subsetPath = options.subsetPath || path.resolve(__dirname, '../benchmark/e2e_subset.jsonl');
  let queries = fs.readFileSync(subsetPath, 'utf8')
    .trim().split('\n').filter(Boolean).map(JSON.parse);

  if (limit && limit > 0) {
    queries = queries.slice(0, limit);
  }

  // Load hidden intentions
  const intentionsPath = path.resolve(__dirname, '../benchmark/hidden_intentions.json');
  const intentions = fs.existsSync(intentionsPath)
    ? JSON.parse(fs.readFileSync(intentionsPath, 'utf8'))
    : {};

  console.log(`Loaded ${queries.length} queries for evaluation.\n`);

  const configs = ['C0a', 'C0b', 'C2'];
  const resultsByConfig = {
    C0a: [],
    C0b: [],
    C2: [],
  };

  const resultsPath = path.resolve(__dirname, '../results/fair_comparison_records.jsonl');
  const outDir = path.dirname(resultsPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const cfg of configs) {
    console.log(`\n======================================================`);
    console.log(`EVALUATING CONFIGURATION: ${cfg}`);
    console.log(`======================================================`);

    for (let i = 0; i < queries.length; i++) {
      const item = queries[i];
      const intended = intentions[item.id] || null;

      console.log(`[${i + 1}/${queries.length}] (${cfg}) ${item.id} [${item.category}] [${item.dataset}]: "${item.text.slice(0, 45)}..."`);

      try {
        const record = await executeQueryUnderProtocol({
          item,
          config: cfg,
          model: targetModel,
          intended,
          maxTurns: 1,
        });

        resultsByConfig[cfg].push(record);
        fs.appendFileSync(resultsPath, JSON.stringify(record) + '\n');

        // Small pacing delay to respect Groq rate limits
        await new Promise((r) => setTimeout(r, 600));
      } catch (err) {
        console.error(`  ❌ Error evaluating ${item.id} on ${cfg}:`, err.message);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Aggregate Metrics for Each System
  // ---------------------------------------------------------------------------
  console.log('\n\n======================================================');
  console.log('SUMMARY COMPARISON TABLE');
  console.log('======================================================\n');

  function computeMetrics(records) {
    const total = records.length;
    if (total === 0) return {};

    const ambRecords = records.filter((r) => r.humanAmbiguous);
    const clrRecords = records.filter((r) => !r.humanAmbiguous);

    // Final result correctness
    const correctCount = records.filter((r) => r.isIntendedMatch).length;
    const correctnessPct = (correctCount / total * 100).toFixed(1);

    // Silent-assumption rate (on ambiguous queries)
    const silentCount = ambRecords.filter((r) => r.isSilentAssumption).length;
    const silentPct = ambRecords.length > 0 ? (silentCount / ambRecords.length * 100).toFixed(1) : '0.0';

    // Unnecessary clarification rate (on clear queries)
    const unnecCount = clrRecords.filter((r) => r.wasUnnecessaryClarification || r.askedClarification).length;
    const unnecPct = clrRecords.length > 0 ? (unnecCount / clrRecords.length * 100).toFixed(1) : '0.0';

    // Average clarification turns
    const totalTurns = records.reduce((sum, r) => sum + (r.clarificationTurns || 0), 0);
    const avgTurns = (totalTurns / total).toFixed(2);

    // Unresolved requests
    const unresolvedCount = records.filter((r) => r.wasUnresolved).length;
    const unresolvedPct = (unresolvedCount / total * 100).toFixed(1);

    // Model calls and tokens
    const totalCalls = records.reduce((sum, r) => sum + (r.modelCalls || 0), 0);
    const avgCalls = (totalCalls / total).toFixed(2);

    const totalTokens = records.reduce((sum, r) => sum + (r.tokens?.total || 0), 0);
    const avgTokens = Math.round(totalTokens / total);

    return {
      total,
      correctCount,
      correctnessPct: `${correctnessPct}%`,
      silentCount,
      ambTotal: ambRecords.length,
      silentPct: `${silentPct}%`,
      unnecCount,
      clrTotal: clrRecords.length,
      unnecPct: `${unnecPct}%`,
      avgTurns,
      unresolvedCount,
      unresolvedPct: `${unresolvedPct}%`,
      avgCalls,
      avgTokens,
    };
  }

  const tableSummary = {
    C0a: computeMetrics(resultsByConfig['C0a']),
    C0b: computeMetrics(resultsByConfig['C0b']),
    C2: computeMetrics(resultsByConfig['C2']),
  };

  console.table({
    'Final result correctness': {
      'C0a: No clarification': tableSummary.C0a.correctnessPct,
      'C0b: LLM-only': tableSummary.C0b.correctnessPct,
      'C2: Your system': tableSummary.C2.correctnessPct,
    },
    'Silent-assumption rate': {
      'C0a: No clarification': tableSummary.C0a.silentPct,
      'C0b: LLM-only': tableSummary.C0b.silentPct,
      'C2: Your system': tableSummary.C2.silentPct,
    },
    'Unnecessary clarification rate': {
      'C0a: No clarification': tableSummary.C0a.unnecPct,
      'C0b: LLM-only': tableSummary.C0b.unnecPct,
      'C2: Your system': tableSummary.C2.unnecPct,
    },
    'Average clarification turns': {
      'C0a: No clarification': tableSummary.C0a.avgTurns,
      'C0b: LLM-only': tableSummary.C0b.avgTurns,
      'C2: Your system': tableSummary.C2.avgTurns,
    },
    'Unresolved requests': {
      'C0a: No clarification': tableSummary.C0a.unresolvedPct,
      'C0b: LLM-only': tableSummary.C0b.unresolvedPct,
      'C2: Your system': tableSummary.C2.unresolvedPct,
    },
    'Model calls / query': {
      'C0a: No clarification': tableSummary.C0a.avgCalls,
      'C0b: LLM-only': tableSummary.C0b.avgCalls,
      'C2: Your system': tableSummary.C2.avgCalls,
    },
    'Tokens / query': {
      'C0a: No clarification': tableSummary.C0a.avgTokens,
      'C0b: LLM-only': tableSummary.C0b.avgTokens,
      'C2: Your system': tableSummary.C2.avgTokens,
    },
  });

  const outSummaryPath = path.resolve(__dirname, '../results/fair_comparison_summary.json');
  fs.writeFileSync(outSummaryPath, JSON.stringify(tableSummary, null, 2));
  console.log(`Saved summary to ${outSummaryPath}\n`);

  return tableSummary;
}

if (require.main === module) {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : null;
  const sampleArg = process.argv.indexOf('--sample');
  const subsetPath = sampleArg !== -1 ? path.resolve(process.cwd(), process.argv[sampleArg + 1]) : null;
  runBenchmarkComparison({ limit, subsetPath }).catch((err) => {
    console.error('Fatal error running benchmark comparison:', err);
    process.exit(1);
  });
}

module.exports = { runBenchmarkComparison };

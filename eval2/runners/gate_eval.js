'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { analyzeAmbiguity, VAGUE_TERMS } = require('../../server/src/services/ambiguityGate');

// ---------------------------------------------------------------------------
// Bootstrap CI Calculator
// ---------------------------------------------------------------------------
function computeBootstrapCI(values, nBoot = 1000, alpha = 0.05) {
  if (!values || values.length === 0) return { mean: 0, lower: 0, upper: 0 };
  const n = values.length;
  const bootMeans = [];

  for (let b = 0; b < nBoot; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * n);
      sum += values[idx];
    }
    bootMeans.push(sum / n);
  }

  bootMeans.sort((a, b) => a - b);
  const lowIdx = Math.floor((alpha / 2) * nBoot);
  const highIdx = Math.floor((1 - alpha / 2) * nBoot);
  const mean = values.reduce((a, b) => a + b, 0) / n;

  return {
    mean: Number(mean.toFixed(4)),
    lower: Number(bootMeans[lowIdx].toFixed(4)),
    upper: Number(bootMeans[highIdx].toFixed(4)),
  };
}

async function runGateEvaluation() {
  console.log('=== EVAL2 FROZEN AMBIGUITY GATE EVALUATION ===\n');

  // Load schemas snapshot
  const schemasPath = path.resolve(__dirname, '../schemas/schemas_snapshot.json');
  const schemasSnapshot = JSON.parse(fs.readFileSync(schemasPath, 'utf8'));

  // Load test split
  const testSplitPath = path.resolve(__dirname, '../benchmark/test_split.jsonl');
  const queries = fs.readFileSync(testSplitPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

  console.log(`Loaded ${queries.length} queries from test_split.jsonl (pilot split excluded).\n`);

  const resultsPath = path.resolve(__dirname, '../results/gate_eval_results.jsonl');
  const outDir = path.dirname(resultsPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(resultsPath, ''); // reset append log

  let TP = 0, FP = 0, TN = 0, FN = 0;
  const categoryStats = {};
  const termStats = {};
  for (const t of VAGUE_TERMS) {
    termStats[t] = { occurrences: 0, triggered: 0 };
  }

  const lexicalMisses = [];
  const structuralMisses = [];
  const falsePositives = [];

  const headlineSamples = []; // for bootstrap CI on humanAmbiguous && scopeCapable

  for (const q of queries) {
    const dbSnap = schemasSnapshot[q.dataset];
    if (!dbSnap) throw new Error(`Missing schema snapshot for dataset: ${q.dataset}`);

    // Filter collections by query scope
    const reqCols = new Set(q.scope);
    const scopedSchema = {
      database: dbSnap.database,
      collections: (dbSnap.collections || []).filter((c) => reqCols.has(c.name)),
    };

    const { result, diagnostics } = analyzeAmbiguity(q.text, scopedSchema);
    const gateTriggered = Boolean(result && result.needsClarification);

    const record = {
      id: q.id,
      dataset: q.dataset,
      text: q.text,
      category: q.category,
      scope: q.scope,
      scopeCapable: q.scopeCapable,
      humanAmbiguous: q.humanAmbiguous,
      gateTerms: q.gateTerms,
      gateDecision: gateTriggered ? 'ASK' : 'CLEAR',
      diagnosticsReason: diagnostics.reason,
      matchedTerms: diagnostics.matchedTerms || [],
      numericCandidateCount: diagnostics.numericCandidateCount || 0,
    };

    fs.appendFileSync(resultsPath, JSON.stringify(record) + '\n');

    // Track category performance
    if (!categoryStats[q.category]) {
      categoryStats[q.category] = { total: 0, asked: 0, clear: 0 };
    }
    categoryStats[q.category].total++;
    if (gateTriggered) categoryStats[q.category].asked++;
    else categoryStats[q.category].clear++;

    // Track term triggers
    for (const term of q.gateTerms) {
      if (termStats[term]) {
        termStats[term].occurrences++;
        if (gateTriggered) termStats[term].triggered++;
      }
    }

    // Evaluate ground truth
    // OOS_UNSCORED is reported separately
    if (q.category === 'OOS_UNSCORED') {
      continue;
    }

    const groundTruthAmbiguous = q.humanAmbiguous && q.scopeCapable;

    if (groundTruthAmbiguous) {
      headlineSamples.push(gateTriggered ? 1 : 0);
      if (gateTriggered) {
        TP++;
      } else {
        FN++;
        // Classify miss
        if (q.gateTerms.length === 0) {
          lexicalMisses.push({ id: q.id, text: q.text, category: q.category, reason: 'missing_vague_term' });
        } else {
          lexicalMisses.push({ id: q.id, text: q.text, category: q.category, reason: diagnostics.reason });
        }
      }
    } else {
      // Ground truth is Clear (either human says clear, or scopeCapable === false)
      if (gateTriggered) {
        FP++;
        falsePositives.push({ id: q.id, text: q.text, category: q.category, reason: diagnostics.reason, matched: diagnostics.matchedTerms });
      } else {
        TN++;
        // Check if human was ambiguous but scope had < 2 candidates -> structural miss
        if (q.humanAmbiguous && !q.scopeCapable) {
          structuralMisses.push({ id: q.id, text: q.text, scope: q.scope, candidates: diagnostics.numericCandidateCount });
        }
      }
    }
  }

  // Metrics computation
  const precision = (TP + FP) > 0 ? TP / (TP + FP) : 0;
  const recall = (TP + FN) > 0 ? TP / (TP + FN) : 0;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const specificity = (TN + FP) > 0 ? TN / (TN + FP) : 0;
  const ucr = (TP + FN) > 0 ? FN / (TP + FN) : 0;

  const recallCI = computeBootstrapCI(headlineSamples);

  console.log('--- CONFUSION MATRIX ---');
  console.log(`True Positives (TP):  ${TP}`);
  console.log(`False Positives (FP): ${FP}`);
  console.log(`True Negatives (TN):  ${TN}`);
  console.log(`False Negatives (FN): ${FN}`);
  console.log('\n--- CORE PERFORMANCE METRICS ---');
  console.log(`Headline Recall:     ${(recall * 100).toFixed(1)}% [95% CI: ${(recallCI.lower * 100).toFixed(1)}% - ${(recallCI.upper * 100).toFixed(1)}%]`);
  console.log(`Precision:           ${(precision * 100).toFixed(1)}%`);
  console.log(`Specificity:         ${(specificity * 100).toFixed(1)}%`);
  console.log(`F1 Score:            ${(f1 * 100).toFixed(1)}%`);
  console.log(`Undetected Clarification Rate (UCR): ${(ucr * 100).toFixed(1)}%`);

  console.log('\n--- MISS DECOMPOSITION ---');
  console.log(`Lexical Misses (Vague term outside dictionary): ${lexicalMisses.length}`);
  console.log(`Structural Misses (Scope contains <2 candidates): ${structuralMisses.length}`);

  console.log('\n--- PER-CATEGORY BREAKDOWN ---');
  for (const [cat, s] of Object.entries(categoryStats)) {
    const rate = ((s.asked / s.total) * 100).toFixed(1);
    console.log(`  [${cat.padEnd(13)}]: Total: ${String(s.total).padEnd(3)} | Asked: ${String(s.asked).padEnd(3)} | Trigger Rate: ${rate}%`);
  }

  console.log('\n--- VERBATIM FALSE POSITIVES (FP) ---');
  for (const fp of falsePositives.slice(0, 10)) {
    console.log(`  [${fp.id}] "${fp.text}" -> matched: [${fp.matched.join(', ')}] (${fp.reason})`);
  }
  if (falsePositives.length > 10) console.log(`  ... and ${falsePositives.length - 10} more.`);

  // -------------------------------------------------------------------------
  // Latency Microbenchmark (1,000 warmup + 10,000 iterations)
  // -------------------------------------------------------------------------
  console.log('\n--- EXECUTING LATENCY MICROBENCHMARK ---');
  console.log('Running 1,000 warmup iterations...');
  const sampleQuery = 'List top products with highest sales';
  const sampleSchema = schemasSnapshot['sample_supplies'];

  for (let i = 0; i < 1000; i++) {
    analyzeAmbiguity(sampleQuery, sampleSchema);
  }

  console.log('Running 10,000 timed microbenchmark iterations using process.hrtime.bigint()...');
  const latenciesNs = [];
  for (let i = 0; i < 10000; i++) {
    const t0 = process.hrtime.bigint();
    analyzeAmbiguity(sampleQuery, sampleSchema);
    const t1 = process.hrtime.bigint();
    latenciesNs.push(Number(t1 - t0));
  }

  latenciesNs.sort((a, b) => a - b);
  const latenciesUs = latenciesNs.map((ns) => ns / 1000);
  const sumUs = latenciesUs.reduce((a, b) => a + b, 0);
  const meanUs = sumUs / latenciesUs.length;
  const p50Us = latenciesUs[Math.floor(latenciesUs.length * 0.50)];
  const p95Us = latenciesUs[Math.floor(latenciesUs.length * 0.95)];
  const p99Us = latenciesUs[Math.floor(latenciesUs.length * 0.99)];
  const maxUs = latenciesUs[latenciesUs.length - 1];

  const cpus = os.cpus();
  const hardwareInfo = {
    cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown',
    cores: cpus.length,
    arch: os.arch(),
    platform: os.platform(),
    totalMemoryGb: (os.totalmem() / (1024 ** 3)).toFixed(2),
  };

  const microbenchResult = {
    iterations: 10000,
    warmup: 1000,
    unit: 'microseconds',
    mean: Number(meanUs.toFixed(2)),
    p50: Number(p50Us.toFixed(2)),
    p95: Number(p95Us.toFixed(2)),
    p99: Number(p99Us.toFixed(2)),
    max: Number(maxUs.toFixed(2)),
    hardware: hardwareInfo,
    recordedAt: new Date().toISOString(),
  };

  const microbenchPath = path.resolve(__dirname, '../results/gate_microbench.json');
  fs.writeFileSync(microbenchPath, JSON.stringify(microbenchResult, null, 2) + '\n');

  console.log(`Microbenchmark Results:`);
  console.log(`  Mean: ${microbenchResult.mean} μs`);
  console.log(`  p50:  ${microbenchResult.p50} μs`);
  console.log(`  p95:  ${microbenchResult.p95} μs`);
  console.log(`  p99:  ${microbenchResult.p99} μs`);
  console.log(`  Max:  ${microbenchResult.max} μs`);
  console.log(`Hardware: ${hardwareInfo.cpuModel} (${hardwareInfo.cores} cores, ${hardwareInfo.arch})\n`);

  console.log(`✅ Gate evaluation complete. Detailed traces saved to: ${resultsPath}`);
}

if (require.main === module) {
  runGateEvaluation().catch((err) => {
    console.error('Gate evaluation error:', err);
    process.exit(1);
  });
}

module.exports = { runGateEvaluation, computeBootstrapCI };

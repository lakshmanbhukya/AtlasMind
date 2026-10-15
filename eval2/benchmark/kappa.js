'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BENCHMARK_DIR = __dirname;
const TEST_SPLIT_PATH = path.join(BENCHMARK_DIR, 'test_split.jsonl');
const SCHEMAS_PATH = path.resolve(BENCHMARK_DIR, '../schemas/schemas_snapshot.json');
const MANIFEST_PATH = path.resolve(BENCHMARK_DIR, '../manifest.json');
const LABELING_SHEET_PATH = path.join(BENCHMARK_DIR, 'labeling_sheet.csv');
const LLM_LABELS_PATH = path.join(BENCHMARK_DIR, 'llm_labels.csv');
const DISAGREEMENTS_PATH = path.join(BENCHMARK_DIR, 'disagreements.csv');

// Ambiguity-capable strata definition: queries where the schema contains >= 2 candidate metrics
const AMBIGUITY_CAPABLE_STRATA = new Set(['AMB_LEX', 'AMB_PARA', 'CLR_FIELD', 'CLR_BOUND']);

/**
 * Escape a string field according to RFC 4180 CSV standard.
 */
function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Parse a standard RFC 4180 CSV string into array of objects.
 */
function parseCsv(content) {
  const lines = [];
  let currentRow = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') i++; // CRLF
      currentRow.push(currentField);
      currentField = '';
      if (currentRow.length > 0 && currentRow.some((f) => f.length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    lines.push(currentRow);
  }

  if (lines.length === 0) return [];

  const headers = lines[0].map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = lines[i][j] !== undefined ? lines[i][j] : '';
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Compute agreement statistics for a set of paired binary classifications.
 * Calculates: Po, Pe, Cohen's Kappa, PABAK, and 2x2 Confusion Matrix.
 */
function calculateAgreementStats(pairs, labelAKey = 'labelerA', labelBKey = 'labelerB') {
  const N = pairs.length;
  if (N === 0) {
    return { N: 0, Po: 0, Pe: 0, kappa: 0, pabak: 0, lowerCI: 0, upperCI: 0, confusionMatrix: { bothClear: 0, bothAmbiguous: 0, aClear_bAmb: 0, aAmb_bClear: 0 } };
  }

  let bothClear = 0;     // A=0, B=0
  let bothAmbiguous = 0; // A=1, B=1
  let aClear_bAmb = 0;   // A=0, B=1
  let aAmb_bClear = 0;   // A=1, B=0

  for (const p of pairs) {
    const a = parseInt(p[labelAKey], 10);
    const b = parseInt(p[labelBKey], 10);

    if (a === 0 && b === 0) bothClear++;
    else if (a === 1 && b === 1) bothAmbiguous++;
    else if (a === 0 && b === 1) aClear_bAmb++;
    else if (a === 1 && b === 0) aAmb_bClear++;
  }

  const totalAgreed = bothClear + bothAmbiguous;
  const Po = totalAgreed / N; // Observed agreement

  // Marginal probabilities
  const pA_amb = (bothAmbiguous + aAmb_bClear) / N;
  const pA_clr = (bothClear + aClear_bAmb) / N;
  const pB_amb = (bothAmbiguous + aClear_bAmb) / N;
  const pB_clr = (bothClear + aAmb_bClear) / N;

  const Pe = (pA_amb * pB_amb) + (pA_clr * pB_clr); // Expected chance agreement
  const kappa = Pe < 1 ? (Po - Pe) / (1 - Pe) : 1;

  // PABAK = Prevalence-Adjusted and Bias-Adjusted Kappa: 2*Po - 1
  const pabak = (2 * Po) - 1;

  // Standard error and 95% CI for Cohen's Kappa
  const seKappa = Math.sqrt((Po * (1 - Po)) / (N * Math.pow(Math.max(1 - Pe, 0.0001), 2)));
  const lowerCI = Math.max(-1, kappa - 1.96 * seKappa);
  const upperCI = Math.min(1, kappa + 1.96 * seKappa);

  return {
    N,
    totalAgreed,
    totalDisagreed: N - totalAgreed,
    Po,
    Pe,
    kappa,
    pabak,
    lowerCI,
    upperCI,
    confusionMatrix: {
      bothClear,
      bothAmbiguous,
      aClear_bAmb,
      aAmb_bClear,
    },
  };
}

/**
 * 1. Compute Cohen's Kappa on double-labeled subset, refusal if any cell empty,
 *    report on ambiguity-capable strata only, PABAK, and LLM-vs-human agreement.
 */
function computeKappa(options = {}) {
  console.log('\n=== EVAL2 INTER-ANNOTATOR AGREEMENT & KAPPA EVALUATION ===');

  if (!fs.existsSync(LABELING_SHEET_PATH)) {
    throw new Error(`labeling_sheet.csv not found at ${LABELING_SHEET_PATH}`);
  }

  const sheetRows = parseCsv(fs.readFileSync(LABELING_SHEET_PATH, 'utf8'));
  const doubleLabeledRows = sheetRows.filter((r) => r.doubleLabel === '1' || r.doubleLabel === 1);

  if (doubleLabeledRows.length === 0) {
    throw new Error('No double-label rows designated in labeling_sheet.csv (doubleLabel column has no 1s).');
  }

  // Refuse to run while ANY labelerA or labelerB cell on a doubleLabel row is empty
  const pendingDoubleLabelRows = doubleLabeledRows.filter(
    (r) => r.labelerA === '' || r.labelerA === null || r.labelerA === undefined ||
           r.labelerB === '' || r.labelerB === null || r.labelerB === undefined
  );

  if (pendingDoubleLabelRows.length > 0) {
    console.error(`\n❌ [REFUSAL] kappa.js refuses to execute while human annotations are pending.`);
    console.error(`   Found ${pendingDoubleLabelRows.length} of ${doubleLabeledRows.length} double-label rows with empty labelerA or labelerB cells.`);
    console.error(`   Both human labelers must complete all marked doubleLabel rows before kappa computation.\n`);

    if (options.throwOnRefusal) {
      throw new Error(`Refusal: ${pendingDoubleLabelRows.length} double-label rows have empty labelerA/labelerB cells.`);
    }

    return {
      refused: true,
      pendingCount: pendingDoubleLabelRows.length,
      totalDoubleLabel: doubleLabeledRows.length,
    };
  }

  console.log(`\nAll ${doubleLabeledRows.length} double-label rows are populated. Proceeding with agreement analysis.`);

  // Load test_split.jsonl to access categories for stratification
  const testSplitMap = new Map();
  if (fs.existsSync(TEST_SPLIT_PATH)) {
    const testQueries = fs.readFileSync(TEST_SPLIT_PATH, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    for (const q of testQueries) testSplitMap.set(q.id, q);
  }

  // A. Overall Double-Labeled Agreement
  const overallStats = calculateAgreementStats(doubleLabeledRows, 'labelerA', 'labelerB');

  console.log('\n--- 1. OVERALL INTER-ANNOTATOR AGREEMENT (Double-Labeled Sample) ---');
  console.log(`Sample Size (N):            ${overallStats.N} queries`);
  console.log(`Observed Agreement (Po):    ${(overallStats.Po * 100).toFixed(2)}% (${overallStats.totalAgreed}/${overallStats.N})`);
  console.log(`Chance Agreement (Pe):      ${(overallStats.Pe * 100).toFixed(2)}%`);
  console.log(`Cohen's Kappa (κ):          ${overallStats.kappa.toFixed(4)} [95% CI: ${overallStats.lowerCI.toFixed(3)}, ${overallStats.upperCI.toFixed(3)}]`);
  console.log(`PABAK (Adjusted Kappa):     ${overallStats.pabak.toFixed(4)}`);

  console.log('\nOverall Confusion Matrix (Labeler A vs Labeler B):');
  console.log('                  Labeler B: Clear (0)   Labeler B: Ambiguous (1)   Total');
  console.log(`Labeler A: Clear (0)         ${String(overallStats.confusionMatrix.bothClear).padStart(5)}                  ${String(overallStats.confusionMatrix.aClear_bAmb).padStart(5)}             ${String(overallStats.confusionMatrix.bothClear + overallStats.confusionMatrix.aClear_bAmb).padStart(5)}`);
  console.log(`Labeler A: Amb (1)           ${String(overallStats.confusionMatrix.aAmb_bClear).padStart(5)}                  ${String(overallStats.confusionMatrix.bothAmbiguous).padStart(5)}             ${String(overallStats.confusionMatrix.aAmb_bClear + overallStats.confusionMatrix.bothAmbiguous).padStart(5)}`);
  console.log(`Total                        ${String(overallStats.confusionMatrix.bothClear + overallStats.confusionMatrix.aAmb_bClear).padStart(5)}                  ${String(overallStats.confusionMatrix.aClear_bAmb + overallStats.confusionMatrix.bothAmbiguous).padStart(5)}             ${String(overallStats.N).padStart(5)}`);

  // B. Ambiguity-Capable Strata Only (AMB_*, CLR_FIELD, CLR_BOUND)
  const capableRows = doubleLabeledRows.filter((r) => {
    const q = testSplitMap.get(r.id);
    const cat = q?.category || '';
    return AMBIGUITY_CAPABLE_STRATA.has(cat);
  });

  const capableStats = calculateAgreementStats(capableRows, 'labelerA', 'labelerB');

  console.log('\n--- 2. AMBIGUITY-CAPABLE STRATA ONLY (AMB_*, CLR_FIELD, CLR_BOUND) ---');
  console.log(`Sample Size (N):            ${capableStats.N} queries (excludes CLR_AGG, CLR_PLAIN, OOS)`);
  console.log(`Observed Agreement (Po):    ${(capableStats.Po * 100).toFixed(2)}% (${capableStats.totalAgreed}/${capableStats.N})`);
  console.log(`Chance Agreement (Pe):      ${(capableStats.Pe * 100).toFixed(2)}%`);
  console.log(`Cohen's Kappa (κ):          ${capableStats.kappa.toFixed(4)} [95% CI: ${capableStats.lowerCI.toFixed(3)}, ${capableStats.upperCI.toFixed(3)}]`);
  console.log(`PABAK (Adjusted Kappa):     ${capableStats.pabak.toFixed(4)}`);

  // C. LLM-vs-Human Agreement (Separate Line)
  let llmVsHumanStats = null;
  if (fs.existsSync(LLM_LABELS_PATH)) {
    const llmRows = parseCsv(fs.readFileSync(LLM_LABELS_PATH, 'utf8'));
    const llmMap = new Map(llmRows.map((r) => [r.id, r]));

    const pairedWithHuman = [];
    for (const sheetRow of sheetRows) {
      if (sheetRow.finalLabel === '' || sheetRow.finalLabel === null || sheetRow.finalLabel === undefined) continue;
      const llmRow = llmMap.get(sheetRow.id);
      if (llmRow && llmRow.llmFinal !== '') {
        pairedWithHuman.push({
          id: sheetRow.id,
          humanFinal: sheetRow.finalLabel,
          llmFinal: llmRow.llmFinal,
        });
      }
    }

    if (pairedWithHuman.length > 0) {
      llmVsHumanStats = calculateAgreementStats(pairedWithHuman, 'humanFinal', 'llmFinal');

      console.log('\n--- 3. LLM-VS-HUMAN AGREEMENT (Baseline Comparison) ---');
      console.log(`Evaluated against Human Ground Truth (N = ${llmVsHumanStats.N}):`);
      console.log(`  • Observed Agreement (Po):  ${(llmVsHumanStats.Po * 100).toFixed(2)}% (${llmVsHumanStats.totalAgreed}/${llmVsHumanStats.N})`);
      console.log(`  • Cohen's Kappa (κ):        ${llmVsHumanStats.kappa.toFixed(4)} [95% CI: ${llmVsHumanStats.lowerCI.toFixed(3)}, ${llmVsHumanStats.upperCI.toFixed(3)}]`);
      console.log(`  • PABAK (Adjusted Kappa):   ${llmVsHumanStats.pabak.toFixed(4)}`);
      console.log(`  • LLM vs Human Disagreements: ${llmVsHumanStats.totalDisagreed}`);
    }
  }

  // D. Export Disagreements CSV
  const disagreements = doubleLabeledRows.filter((r) => r.labelerA !== r.labelerB);
  const disHeaders = ['id', 'dataset', 'scope', 'text', 'offered_options', 'doubleLabel', 'labelerA', 'labelerB', 'finalLabel', 'note'];
  const disCsvRows = [disHeaders.join(',')];

  for (const d of disagreements) {
    disCsvRows.push([
      escapeCsv(d.id),
      escapeCsv(d.dataset),
      escapeCsv(d.scope),
      escapeCsv(d.text),
      escapeCsv(d.offered_options),
      d.doubleLabel,
      escapeCsv(d.labelerA),
      escapeCsv(d.labelerB),
      escapeCsv(d.finalLabel),
      escapeCsv(d.note),
    ].join(','));
  }

  fs.writeFileSync(DISAGREEMENTS_PATH, disCsvRows.join('\n') + '\n', 'utf8');
  console.log(`\n✅ Saved ${disagreements.length} human disagreements to ${DISAGREEMENTS_PATH}`);

  return {
    refused: false,
    overall: overallStats,
    ambiguityCapable: capableStats,
    llmVsHuman: llmVsHumanStats,
    disagreementsCount: disagreements.length,
  };
}

/**
 * 2. Validate that finalLabel is non-empty, checks against test_split.jsonl,
 *    and supports merging human labels and updating manifest hash.
 */
function validateLabels(options = {}) {
  console.log('\n=== VALIDATING HUMAN GROUND TRUTH LABELS ===');

  if (!fs.existsSync(LABELING_SHEET_PATH)) {
    throw new Error(`labeling_sheet.csv not found at ${LABELING_SHEET_PATH}`);
  }
  if (!fs.existsSync(TEST_SPLIT_PATH)) {
    throw new Error(`test_split.jsonl not found at ${TEST_SPLIT_PATH}`);
  }

  const sheetRows = parseCsv(fs.readFileSync(LABELING_SHEET_PATH, 'utf8'));
  const queries = fs.readFileSync(TEST_SPLIT_PATH, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

  // Check 1: Empty finalLabel detection
  const emptyFinal = sheetRows.filter((r) => r.finalLabel === '' || r.finalLabel === null || r.finalLabel === undefined);
  if (emptyFinal.length > 0) {
    console.error(`❌ Validation Failure: Found ${emptyFinal.length} of ${sheetRows.length} rows with empty finalLabel in labeling_sheet.csv!`);
    console.error('   Human labeling is not yet complete. All 330 queries must have an adjudicated finalLabel.');
    if (options.throwOnError) {
      throw new Error(`Validation Failure: ${emptyFinal.length} empty finalLabels.`);
    }
    return { valid: false, reason: 'empty_final_labels', count: emptyFinal.length };
  }

  // Check 2: Reconciliation with test_split.jsonl
  const sheetMap = new Map(sheetRows.map((r) => [r.id, r]));
  const differences = [];

  for (const q of queries) {
    const sheetRow = sheetMap.get(q.id);
    if (!sheetRow) {
      differences.push({ id: q.id, reason: 'Missing in labeling_sheet.csv' });
      continue;
    }

    if (q.humanAmbiguous === null || q.humanAmbiguous === undefined) {
      differences.push({
        id: q.id,
        dataset: q.dataset,
        text: q.text,
        testSplitValue: null,
        finalLabelValue: parseInt(sheetRow.finalLabel, 10),
        reason: 'test_split.humanAmbiguous is null (pending merge)',
      });
      continue;
    }

    const sheetFinalBool = parseInt(sheetRow.finalLabel, 10) === 1;
    if (q.humanAmbiguous !== sheetFinalBool) {
      differences.push({
        id: q.id,
        dataset: q.dataset,
        text: q.text,
        testSplitValue: q.humanAmbiguous,
        finalLabelValue: sheetFinalBool,
        note: sheetRow.note,
      });
    }
  }

  if (differences.length > 0) {
    console.error(`\n❌ VALIDATION DIFF DETECTED: ${differences.length} discrepancies between test_split.jsonl and labeling_sheet.csv.`);
    console.error('Do not silently overwrite.');

    for (const d of differences.slice(0, 10)) {
      console.error(`  • [${d.id}] "${d.text?.slice(0, 45)}..."`);
      console.error(`     test_split.humanAmbiguous: ${d.testSplitValue} | labeling_sheet.finalLabel: ${d.finalLabelValue}`);
    }
    if (differences.length > 10) console.error(`     ... and ${differences.length - 10} more.`);

    if (options.merge) {
      console.log('\n[--merge specified] Merging adjudicated human labels into test_split.jsonl...');
      mergeHumanLabels(sheetMap);
      return { valid: true, merged: true, diffCount: differences.length };
    }

    console.error('\nTo merge human labels into test_split.jsonl and update manifest SHA-256 hash, run:');
    console.error('   node eval2/benchmark/kappa.js --merge\n');

    if (options.throwOnError) {
      throw new Error(`Validation diff: ${differences.length} discrepancies detected.`);
    }
    return { valid: false, reason: 'diffs_detected', diffCount: differences.length };
  }

  console.log(`✅ Validation Passed: All ${queries.length} queries match labeling_sheet.csv finalLabel perfectly (0 diffs).`);
  return { valid: true, merged: false, diffCount: 0 };
}

/**
 * 3. Merge human finalLabels into test_split.jsonl and update manifest.json hash.
 */
function mergeHumanLabels(sheetMap) {
  const queries = fs.readFileSync(TEST_SPLIT_PATH, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

  const updatedQueries = queries.map((q) => {
    const row = sheetMap.get(q.id);
    if (!row) return q;

    const finalBool = parseInt(row.finalLabel, 10) === 1;
    const lA = row.labelerA !== '' ? (parseInt(row.labelerA, 10) === 1 ? 'AMBIGUOUS' : 'CLEAR') : null;
    let lB = null;
    if (row.labelerB === '1') lB = 'AMBIGUOUS';
    else if (row.labelerB === '0') lB = 'CLEAR';

    return {
      ...q,
      humanAmbiguous: finalBool,
      labelerA: lA,
      labelerB: lB,
    };
  });

  const content = updatedQueries.map((q) => JSON.stringify(q)).join('\n') + '\n';
  fs.writeFileSync(TEST_SPLIT_PATH, content, 'utf8');

  // Compute new SHA-256 hash
  const newHash = crypto.createHash('sha256').update(fs.readFileSync(TEST_SPLIT_PATH)).digest('hex');
  console.log(`New test_split.jsonl SHA-256: ${newHash}`);

  // Update manifest.json
  if (fs.existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    manifest.testSplitHash = newHash;
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`✅ Updated ${MANIFEST_PATH} with new testSplitHash.`);
  }

  console.log(`\n✅ Successfully merged human labels into test_split.jsonl.`);
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const isMerge = args.includes('--merge') || args.includes('--sync');
  const isValidateOnly = args.includes('--validate');

  try {
    if (isValidateOnly) {
      const v = validateLabels({ merge: isMerge });
      if (!v.valid) process.exit(1);
    } else {
      const kappaRes = computeKappa();
      if (kappaRes.refused) {
        process.exit(1);
      }
      const v = validateLabels({ merge: isMerge });
      if (!v.valid) process.exit(1);
    }
  } catch (err) {
    console.error('Error in kappa.js:', err.message);
    process.exit(1);
  }
}

module.exports = {
  computeKappa,
  validateLabels,
  calculateAgreementStats,
  mergeHumanLabels,
};

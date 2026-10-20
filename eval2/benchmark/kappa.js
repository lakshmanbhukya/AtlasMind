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
const PROCEDURE_PATH = path.join(BENCHMARK_DIR, 'PROCEDURE.md');
const NEEDS_HUMAN_DECISION_PATH = path.join(BENCHMARK_DIR, 'needs_human_decision.csv');
const B_RELABEL_PATH = path.join(BENCHMARK_DIR, 'b_relabel.csv');

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
 * Extract procedure metadata from PROCEDURE.md without guessing or inferring.
 */
function loadProcedureMetadata() {
  if (!fs.existsSync(PROCEDURE_PATH)) {
    return {
      pass1_annotatorA: 'unspecified (PROCEDURE.md missing)',
      pass1_annotatorB: 'unspecified (PROCEDURE.md missing)',
      pass1_blind: 'unspecified (PROCEDURE.md missing)',
      relabel_annotatorB: 'unspecified (PROCEDURE.md missing)',
      relabel_blind: 'unspecified (PROCEDURE.md missing)',
      isConfirmed: false,
    };
  }

  const text = fs.readFileSync(PROCEDURE_PATH, 'utf8');
  const matchField = (field) => {
    const m = text.match(new RegExp(`${field}:\\s*["']?([^"'\\r\\n]+)["']?`));
    return m ? m[1].trim() : 'unspecified';
  };

  const aA = matchField('pass1_annotatorA');
  const aB = matchField('pass1_annotatorB');
  const blind1 = matchField('pass1_blind');
  const relabelB = matchField('relabel_annotatorB');
  const blindR = matchField('relabel_blind');
  const method = matchField('adjudication_method');

  const isPlaceholder = (val) =>
    !val || val === 'unspecified' || val.includes('[Pending') || val.includes('[CONFIRM') || val.includes('[HUMAN');

  return {
    pass1_annotatorA: aA,
    pass1_annotatorB: aB,
    pass1_blind: blind1,
    relabel_annotatorB: relabelB,
    relabel_blind: blindR,
    adjudication_method: method,
    isConfirmed: !isPlaceholder(aA) && !isPlaceholder(aB) && !isPlaceholder(blind1),
  };
}

/**
 * Identify query IDs explicitly designated for human adjudication.
 * Includes rows in needs_human_decision.csv and any rows with discordant A and B labels.
 * Does NOT impose a blanket requirement on all 330 rows.
 */
function getDesignatedAdjudicationIds(sheetRows) {
  const ids = new Set();

  if (fs.existsSync(NEEDS_HUMAN_DECISION_PATH)) {
    const nhdRows = parseCsv(fs.readFileSync(NEEDS_HUMAN_DECISION_PATH, 'utf8'));
    for (const r of nhdRows) {
      if (r.id) ids.add(r.id);
    }
  }

  for (const r of sheetRows) {
    if (r.labelerA !== '' && r.labelerB !== '' && r.labelerA !== r.labelerB) {
      ids.add(r.id);
    }
  }

  return ids;
}

/**
 * Compute agreement statistics for a set of paired binary classifications.
 * Calculates: Po, Pe, Cohen's Kappa, PABAK, and 2x2 Confusion Matrix.
 */
function calculateAgreementStats(pairs, labelAKey = 'labelerA', labelBKey = 'labelerB') {
  const N = pairs.length;
  if (N === 0) {
    return {
      N: 0,
      totalAgreed: 0,
      totalDisagreed: 0,
      Po: 0,
      Pe: 0,
      kappa: 0,
      pabak: 0,
      lowerCI: 0,
      upperCI: 0,
      confusionMatrix: { bothClear: 0, bothAmbiguous: 0, aClear_bAmb: 0, aAmb_bClear: 0 },
    };
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
 * 1. Compute Cohen's Kappa & PABAK on:
 *    (a) The designated stratified 91 rows (doubleLabel = 1)
 *    (b) Every row with two labels (labelerA !== '' && labelerB !== '')
 *    Lists exact row IDs used and prints procedure metadata from PROCEDURE.md.
 */
function computeKappa(options = {}) {
  console.log('\n=== EVAL2 INTER-ANNOTATOR AGREEMENT & KAPPA EVALUATION ===');

  const sheetPath = options.sheetPath || LABELING_SHEET_PATH;
  if (!fs.existsSync(sheetPath)) {
    throw new Error(`labeling_sheet.csv not found at ${sheetPath}`);
  }

  const sheetRows = parseCsv(fs.readFileSync(sheetPath, 'utf8'));

  // Load procedure metadata from PROCEDURE.md
  const procMeta = loadProcedureMetadata();
  console.log('\n--- ANNOTATOR PROCEDURE & BLINDING (from PROCEDURE.md) ---');
  console.log(`• Pass 1 Annotator A:  ${procMeta.pass1_annotatorA}`);
  console.log(`• Pass 1 Annotator B:  ${procMeta.pass1_annotatorB}`);
  console.log(`• Pass 1 Blinded:      ${procMeta.pass1_blind}`);
  console.log(`• Relabel Blinded:     ${procMeta.relabel_blind}`);
  console.log(`• Adjudication Method: ${procMeta.adjudication_method || 'unspecified'}`);
  if (!procMeta.isConfirmed) {
    console.log('⚠️ [NOTICE] Annotator procedure contains unconfirmed human placeholders in PROCEDURE.md.');
  }

  // Designated stratified double-label rows (doubleLabel = 1)
  const designatedRows = sheetRows.filter((r) => r.doubleLabel === '1' || r.doubleLabel === 1);
  const pendingDesignatedRows = designatedRows.filter(
    (r) => r.labelerB === '' || r.labelerB === null || r.labelerB === undefined
  );

  // All rows with two completed labels
  const allTwoLabelRows = sheetRows.filter(
    (r) => r.labelerA !== '' && r.labelerA !== null && r.labelerA !== undefined &&
           r.labelerB !== '' && r.labelerB !== null && r.labelerB !== undefined
  );

  const completedDesignatedRows = designatedRows.filter(
    (r) => r.labelerA !== '' && r.labelerA !== null && r.labelerA !== undefined &&
           r.labelerB !== '' && r.labelerB !== null && r.labelerB !== undefined
  );

  // Check if any designated doubleLabel row lacks labelerB
  const hasRefusal = pendingDesignatedRows.length > 0;
  if (hasRefusal) {
    console.error(`\n❌ [REFUSAL] kappa.js refuses to execute while designated doubleLabel rows lack labelerB.`);
    console.error(`   Found ${pendingDesignatedRows.length} of ${designatedRows.length} designated doubleLabel rows with empty labelerB cells.`);
    console.error(`   Pending row IDs: ${pendingDesignatedRows.map((r) => r.id).join(', ')}\n`);

    if (options.throwOnRefusal) {
      throw new Error(`Refusal: ${pendingDesignatedRows.length} designated doubleLabel rows lack labelerB.`);
    }
  }

  // (a) Compute agreement on designated stratified subset (rows with doubleLabel = 1 that have both labels)
  const designatedStats = calculateAgreementStats(completedDesignatedRows, 'labelerA', 'labelerB');
  console.log('\n--- (a) DESIGNATED STRATIFIED 91 ROWS (doubleLabel = 1) ---');
  console.log(`Target Stratified Rows:     ${designatedRows.length}`);
  console.log(`Completed with Both Labels: ${completedDesignatedRows.length}`);
  console.log(`Pending Labeler B:          ${pendingDesignatedRows.length}`);
  console.log(`Observed Agreement (Po):    ${(designatedStats.Po * 100).toFixed(2)}% (${designatedStats.totalAgreed}/${designatedStats.N})`);
  console.log(`Chance Agreement (Pe):      ${(designatedStats.Pe * 100).toFixed(2)}%`);
  console.log(`Cohen's Kappa (κ):          ${designatedStats.kappa.toFixed(4)} [95% CI: ${designatedStats.lowerCI.toFixed(3)}, ${designatedStats.upperCI.toFixed(3)}]`);
  console.log(`PABAK:                      ${designatedStats.pabak.toFixed(4)}`);
  console.log('Confusion Matrix:');
  console.log(`  bothClear: ${designatedStats.confusionMatrix.bothClear}, bothAmbiguous: ${designatedStats.confusionMatrix.bothAmbiguous}, aClear_bAmb: ${designatedStats.confusionMatrix.aClear_bAmb}, aAmb_bClear: ${designatedStats.confusionMatrix.aAmb_bClear}`);
  console.log(`Row IDs used in (a) [${completedDesignatedRows.length}]:\n  ${completedDesignatedRows.map((r) => r.id).join(', ')}`);

  // (b) Compute agreement on every row with two labels
  const allTwoLabelStats = calculateAgreementStats(allTwoLabelRows, 'labelerA', 'labelerB');
  console.log('\n--- (b) EVERY ROW WITH TWO LABELS (All Pairs) ---');
  console.log(`Total Rows with 2 Labels:   ${allTwoLabelRows.length}`);
  console.log(`Observed Agreement (Po):    ${(allTwoLabelStats.Po * 100).toFixed(2)}% (${allTwoLabelStats.totalAgreed}/${allTwoLabelStats.N})`);
  console.log(`Chance Agreement (Pe):      ${(allTwoLabelStats.Pe * 100).toFixed(2)}%`);
  console.log(`Cohen's Kappa (κ):          ${allTwoLabelStats.kappa.toFixed(4)} [95% CI: ${allTwoLabelStats.lowerCI.toFixed(3)}, ${allTwoLabelStats.upperCI.toFixed(3)}]`);
  console.log(`PABAK:                      ${allTwoLabelStats.pabak.toFixed(4)}`);
  console.log('Confusion Matrix:');
  console.log(`  bothClear: ${allTwoLabelStats.confusionMatrix.bothClear}, bothAmbiguous: ${allTwoLabelStats.confusionMatrix.bothAmbiguous}, aClear_bAmb: ${allTwoLabelStats.confusionMatrix.aClear_bAmb}, aAmb_bClear: ${allTwoLabelStats.confusionMatrix.aAmb_bClear}`);
  console.log(`Row IDs used in (b) [${allTwoLabelRows.length}]:\n  ${allTwoLabelRows.map((r) => r.id).join(', ')}`);

  // Export Disagreements CSV from all rows with two labels
  const disagreements = allTwoLabelRows.filter((r) => r.labelerA !== r.labelerB);
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
    refused: hasRefusal,
    pendingCount: pendingDesignatedRows.length,
    pendingIds: pendingDesignatedRows.map((r) => r.id),
    totalDesignated: designatedRows.length,
    designatedStats,
    allTwoLabelStats,
    disagreementsCount: disagreements.length,
    procedureMetadata: procMeta,
  };
}

/**
 * 2. Validate human labels for merge readiness:
 *    - Requires labelerB for all designated doubleLabel rows.
 *    - Requires finalLabel ONLY for rows explicitly designated for adjudication (needs_human_decision or disagreements).
 *    - Does NOT impose a blanket finalLabel requirement on all 330 rows.
 *    - Refuses --merge while any required field is empty.
 */
function validateLabels(options = {}) {
  console.log('\n=== VALIDATING HUMAN GROUND TRUTH LABELS ===');

  const sheetPath = options.sheetPath || LABELING_SHEET_PATH;
  const testSplitPath = options.testSplitPath || TEST_SPLIT_PATH;

  if (!fs.existsSync(sheetPath)) {
    throw new Error(`labeling_sheet.csv not found at ${sheetPath}`);
  }
  if (!fs.existsSync(testSplitPath)) {
    throw new Error(`test_split.jsonl not found at ${testSplitPath}`);
  }

  const sheetRows = parseCsv(fs.readFileSync(sheetPath, 'utf8'));
  const queries = fs.readFileSync(testSplitPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

  // Check 1: Designated doubleLabel rows must have labelerB
  const designatedRows = sheetRows.filter((r) => r.doubleLabel === '1' || r.doubleLabel === 1);
  const missingB = designatedRows.filter(
    (r) => r.labelerB === '' || r.labelerB === null || r.labelerB === undefined
  );
  if (missingB.length > 0) {
    console.error(`❌ Validation Failure: ${missingB.length} of ${designatedRows.length} designated doubleLabel rows lack labelerB.`);
    console.error(`   Affected IDs: ${missingB.map((r) => r.id).join(', ')}`);
    if (options.throwOnError) {
      throw new Error(`Validation Failure: ${missingB.length} designated doubleLabel rows lack labelerB.`);
    }
    return { valid: false, reason: 'missing_double_label_b', count: missingB.length, ids: missingB.map((r) => r.id) };
  }

  // Check 2: Explicitly designated adjudication rows must have finalLabel
  const adjudicationIds = getDesignatedAdjudicationIds(sheetRows);
  const emptyAdjudications = sheetRows.filter(
    (r) => adjudicationIds.has(r.id) && (r.finalLabel === '' || r.finalLabel === null || r.finalLabel === undefined)
  );

  if (emptyAdjudications.length > 0) {
    console.error(`❌ Validation Failure: Found ${emptyAdjudications.length} explicitly designated adjudication rows lacking finalLabel!`);
    for (const ea of emptyAdjudications) {
      console.error(`   - [${ea.id}] (${ea.dataset}) "${ea.text?.slice(0, 45)}..." (A: ${ea.labelerA}, B: ${ea.labelerB})`);
    }
    console.error('   All rows in needs_human_decision.csv and all disagreement rows must have an adjudicated finalLabel.\n');
    if (options.throwOnError) {
      throw new Error(`Validation Failure: ${emptyAdjudications.length} designated adjudication rows lack finalLabel.`);
    }
    return { valid: false, reason: 'empty_adjudication_final_labels', count: emptyAdjudications.length, ids: emptyAdjudications.map((r) => r.id) };
  }

  // Check 3: Check differences vs test_split.jsonl
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
        finalLabelValue: sheetRow.finalLabel !== '' ? parseInt(sheetRow.finalLabel, 10) : parseInt(sheetRow.labelerA, 10),
        reason: 'test_split.humanAmbiguous is null (pending merge)',
      });
      continue;
    }

    // Resolved final boolean: finalLabel if present, else labelerA
    const effectiveFinalBool = sheetRow.finalLabel !== ''
      ? parseInt(sheetRow.finalLabel, 10) === 1
      : parseInt(sheetRow.labelerA, 10) === 1;

    if (q.humanAmbiguous !== effectiveFinalBool) {
      differences.push({
        id: q.id,
        dataset: q.dataset,
        text: q.text,
        testSplitValue: q.humanAmbiguous,
        finalLabelValue: effectiveFinalBool,
        note: sheetRow.note,
      });
    }
  }

  if (differences.length > 0) {
    console.log(`\nℹ️ Notice: ${differences.length} differences detected between test_split.jsonl and labeling_sheet.csv.`);
    if (options.merge) {
      console.log('[--merge specified] Merging human labels into test_split.jsonl...');
      mergeHumanLabels(sheetMap);
      return { valid: true, merged: true, diffCount: differences.length };
    }
    return { valid: true, merged: false, diffCount: differences.length };
  }

  console.log(`✅ Validation Passed: Zero discrepancies found against test_split.jsonl.`);
  return { valid: true, merged: false, diffCount: 0 };
}

/**
 * 3. Merge human labels into test_split.jsonl and update manifest.json hash.
 */
function mergeHumanLabels(sheetMap) {
  const queries = fs.readFileSync(TEST_SPLIT_PATH, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

  const updatedQueries = queries.map((q) => {
    const row = sheetMap.get(q.id);
    if (!row) return q;

    const finalBool = row.finalLabel !== ''
      ? parseInt(row.finalLabel, 10) === 1
      : parseInt(row.labelerA, 10) === 1;

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
      const kappaRes = computeKappa({ throwOnRefusal: isMerge });
      if (isMerge && kappaRes.refused) {
        console.error('Cannot merge: designated doubleLabel rows lack annotations.');
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
  loadProcedureMetadata,
  getDesignatedAdjudicationIds,
  parseCsv,
  escapeCsv,
};

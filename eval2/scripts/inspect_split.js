'use strict';
const fs = require('fs');
const path = require('path');

const testSplit = fs.readFileSync(path.resolve(__dirname, '../benchmark/test_split.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

console.log('Total queries in test_split:', testSplit.length);

let humanAmb = 0;
let humanClr = 0;
for (const q of testSplit) {
  if (q.humanAmbiguous === true) humanAmb++;
  else if (q.humanAmbiguous === false) humanClr++;
  else console.log('Unknown humanAmbiguous:', q);
}
console.log('Original human labels: Ambiguous =', humanAmb, ', Clear =', humanClr);

// Check categories and gate scoring
const catCounts = {};
for (const q of testSplit) {
  catCounts[q.category] = (catCounts[q.category] || 0) + 1;
}
console.log('Category counts in test_split:', catCounts);

// Let's check how gate_eval scored queries
const gateResultsPath = path.resolve(__dirname, '../results/gate_eval_results.jsonl');
if (fs.existsSync(gateResultsPath)) {
  const gateResults = fs.readFileSync(gateResultsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log('Total in gate_eval_results:', gateResults.length);
  const scored = gateResults.filter(q => !q.excluded && q.category !== 'OOS_UNSCORED');
  console.log('Scored in gate_eval_results:', scored.length);
  const ambScored = scored.filter(q => q.humanAmbiguous);
  const clrScored = scored.filter(q => !q.humanAmbiguous);
  console.log('Scored Ambiguous =', ambScored.length, ', Scored Clear =', clrScored.length);
  
  const excluded = gateResults.filter(q => q.excluded || q.category === 'OOS_UNSCORED');
  console.log('Excluded count:', excluded.length);
  for (const ex of excluded) {
    console.log(`  Excluded [${ex.id}] category: ${ex.category}, reason: ${ex.excludeReason || ex.reason}`);
  }
}

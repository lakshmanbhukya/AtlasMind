'use strict';
const fs = require('fs');
const path = require('path');

const e2eSubset = fs.readFileSync(path.resolve(__dirname, '../benchmark/e2e_subset.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

console.log('Total queries in e2e_subset:', e2eSubset.length);
const catCounts = {};
let clearWithCand = 0;
let ambWithCand = 0;

for (const q of e2eSubset) {
  catCounts[q.category] = (catCounts[q.category] || 0) + 1;
  if (!q.humanAmbiguous && q.goldCandidate) clearWithCand++;
  if (q.humanAmbiguous && q.goldCandidate) ambWithCand++;
}

console.log('Categories in e2e_subset:', catCounts);
console.log('Clear queries with goldCandidate:', clearWithCand);
console.log('Ambiguous queries with goldCandidate:', ambWithCand);

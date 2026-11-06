'use strict';
const fs = require('fs');
const path = require('path');

const e2eSubset = fs.readFileSync(path.resolve(__dirname, '../benchmark/e2e_subset.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

const amb = e2eSubset.filter(q => q.humanAmbiguous);
console.log('Total ambiguous queries in e2e_subset:', amb.length);
for (const q of amb) {
  console.log(`[${q.id}] [${q.category}] [${q.dataset}]`);
  console.log(`  Text: "${q.text}"`);
  console.log(`  Gold candidate: "${q.goldCandidate}"`);
  console.log(`  Scope:`, q.scope);
}

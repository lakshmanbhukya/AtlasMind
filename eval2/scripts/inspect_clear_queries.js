'use strict';
const fs = require('fs');
const path = require('path');

const e2eSubset = fs.readFileSync(path.resolve(__dirname, '../benchmark/e2e_subset.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

const clearQueries = e2eSubset.filter(q => !q.humanAmbiguous);
console.log(`Found ${clearQueries.length} clear queries:`);

for (const q of clearQueries) {
  console.log(`[${q.id}] [${q.category}] [${q.dataset}]`);
  console.log(`  "${q.text}"`);
}

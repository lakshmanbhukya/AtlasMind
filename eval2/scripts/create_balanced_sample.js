'use strict';
const fs = require('fs');
const path = require('path');

const e2eSubset = fs.readFileSync(path.resolve(__dirname, '../benchmark/e2e_subset.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

const byCat = {};
for (const q of e2eSubset) {
  if (!byCat[q.category]) byCat[q.category] = [];
  byCat[q.category].push(q);
}

const sample = [];
const PER_CAT = 5;
for (const [cat, list] of Object.entries(byCat)) {
  sample.push(...list.slice(0, PER_CAT));
}

console.log(`Selected balanced sample of ${sample.length} queries:`);
for (const [cat, list] of Object.entries(byCat)) {
  console.log(`  ${cat}: ${Math.min(PER_CAT, list.length)}`);
}

fs.writeFileSync(
  path.resolve(__dirname, '../benchmark/balanced_sample.jsonl'),
  sample.map((q) => JSON.stringify(q)).join('\n') + '\n'
);

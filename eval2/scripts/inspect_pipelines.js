'use strict';
const fs = require('fs');
const path = require('path');

const e2eSubset = fs.readFileSync(path.resolve(__dirname, '../benchmark/e2e_subset.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

let dummyGold = 0;
let realGold = 0;
let noGold = 0;

for (const q of e2eSubset) {
  if (!q.goldPipeline) {
    noGold++;
  } else if (JSON.stringify(q.goldPipeline) === JSON.stringify([{ '$match': {} }, { '$limit': 10 }])) {
    dummyGold++;
  } else {
    realGold++;
    console.log(`Real gold pipeline in ${q.id} [${q.category}]:`, JSON.stringify(q.goldPipeline));
  }
}

console.log({ total: e2eSubset.length, dummyGold, realGold, noGold });

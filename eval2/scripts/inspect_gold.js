'use strict';
const fs = require('fs');
const path = require('path');

const e2eSubset = fs.readFileSync(path.resolve(__dirname, '../benchmark/e2e_subset.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

const testSplit = fs.readFileSync(path.resolve(__dirname, '../benchmark/test_split.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

const testSplitMap = new Map(testSplit.map(q => [q.id, q]));

console.log('e2eSubset total:', e2eSubset.length);
let countWithGoldCand = 0;
let clrWithGoldCand = 0;
for (const q of e2eSubset) {
  if (q.goldCandidate) {
    countWithGoldCand++;
    if (!q.humanAmbiguous) clrWithGoldCand++;
  }
}
console.log('e2eSubset with goldCandidate:', countWithGoldCand);
console.log('e2eSubset CLEAR with goldCandidate:', clrWithGoldCand);

const s4 = e2eSubset.find(q => q.id === 'supplies-0004');
console.log('supplies-0004 in e2e_subset:', s4);
const s4_ts = testSplitMap.get('supplies-0004');
console.log('supplies-0004 in test_split:', s4_ts);

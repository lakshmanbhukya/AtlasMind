'use strict';
const fs = require('fs');
const path = require('path');

const e2eSubset = fs.readFileSync(path.resolve(__dirname, '../benchmark/e2e_subset.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

const rawLines = fs.readFileSync(path.resolve(__dirname, '../results/e2e_raw.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

const byConfig = {};
for (const l of rawLines) {
  if (!byConfig[l.config]) byConfig[l.config] = {};
  byConfig[l.config][l.queryId] = l;
}

const auditIds = [
  'supplies-0004', 'supplies-0005', 'supplies-0007', 'supplies-0008',
  'supplies-0010', 'supplies-0011', 'supplies-0012', 'supplies-0014',
  'supplies-0016', 'supplies-0017'
];

for (const id of auditIds) {
  const item = e2eSubset.find(q => q.id === id);
  console.log(`\n=================== ${id} ===================`);
  console.log('Text:', item?.text);
  console.log('Category:', item?.category);
  console.log('Gold Candidate:', item?.goldCandidate);
  console.log('Human Ambiguous:', item?.humanAmbiguous);
  console.log('Scope:', item?.scope);
  const r0a = byConfig['C0a']?.[id];
  const r2 = byConfig['C2']?.[id];
  console.log('C0a isIntendedMatch:', r0a?.isIntendedMatch);
  console.log('C0a pipeline:', JSON.stringify(r0a?.pipeline));
  console.log('C2 isIntendedMatch:', r2?.isIntendedMatch);
  console.log('C2 pipeline:', JSON.stringify(r2?.pipeline));
}

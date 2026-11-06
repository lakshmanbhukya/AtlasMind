'use strict';
const fs = require('fs');
const path = require('path');
const { checkPipelineFilterCriteria } = require('../runners/referencePipelines');

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

console.log('--- RE-AUDIT OF 10 MISMATCH QUERIES UNDER CORRECT CRITERIA ---');
for (const id of auditIds) {
  const r0a = byConfig['C0a']?.[id];
  const r0b = byConfig['C0b']?.[id];
  const r2 = byConfig['C2']?.[id];

  const pass0a = checkPipelineFilterCriteria(id, r0a?.pipeline);
  const pass0b = checkPipelineFilterCriteria(id, r0b?.pipeline);
  const pass2 = checkPipelineFilterCriteria(id, r2?.pipeline);

  console.log(`${id}: C0a=${pass0a}, C0b=${pass0b}, C2=${pass2}`);
}

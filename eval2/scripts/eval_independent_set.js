'use strict';
const fs = require('fs');
const path = require('path');
const schemasSnapshot = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../schemas/schemas_snapshot.json'), 'utf8'));
const queries = fs.readFileSync(path.resolve(__dirname, '../benchmark/independent_test_set.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);
const { analyzeAmbiguity } = require('../../server/src/services/ambiguityGate');

console.log('=== EVALUATION ON INDEPENDENT BENCHMARK QUESTIONS ===\n');

const stats = {
  INDEP_AMB_NO_TRIGGERS: { total: 0, triggered: 0 },
  INDEP_CLR_WITH_TRIGGERS: { total: 0, triggered: 0 },
  INDEP_EXPLICIT_SYNONYMS: { total: 0, triggered: 0 },
  INDEP_NESTED_ARRAY: { total: 0, triggered: 0 },
  INDEP_ABSENT_METRIC: { total: 0, triggered: 0 },
};

for (const q of queries) {
  const dbSnap = schemasSnapshot[q.dataset];
  const reqCols = new Set(q.scope);
  const scopedSchema = {
    database: dbSnap.database,
    collections: (dbSnap.collections || []).filter((c) => reqCols.has(c.name)),
  };

  const res = analyzeAmbiguity(q.text, scopedSchema);
  const asked = Boolean(res.result && res.result.needsClarification);
  stats[q.category].total++;
  if (asked) stats[q.category].triggered++;

  console.log(`[${q.id}] [${q.category}] Asked: ${asked} | Text: "${q.text}" (Reason: ${res.diagnostics.reason})`);
}

console.log('\n--- SUMMARY BY INDEPENDENT CATEGORY ---');
for (const [cat, s] of Object.entries(stats)) {
  console.log(`${cat}: ${s.triggered}/${s.total} (${(s.triggered / s.total * 100).toFixed(1)}%) triggered`);
}

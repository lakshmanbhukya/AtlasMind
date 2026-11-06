'use strict';
const fs = require('fs');
const path = require('path');
const snaps = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../schemas/schemas_snapshot.json'), 'utf8'));

for (const [dbName, db] of Object.entries(snaps)) {
  console.log(`=== DB: ${dbName} ===`);
  for (const c of db.collections || []) {
    const numFields = (c.fields || []).filter(f => ['number', 'decimal', 'int', 'double', 'long'].includes(f.type) || f.isMetric);
    console.log(`  Collection: ${c.name}, fields:`, numFields.map(f => `${f.name} (${f.type})`));
  }
}

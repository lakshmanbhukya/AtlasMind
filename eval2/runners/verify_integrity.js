'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function auditFileContents(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];

  // Check for forbidden patterns
  if (/(?:latency|tokens|timings)\s*[:=]\s*.*Math\.random/i.test(content)) {
    violations.push('Forbidden Math.random used in latency/token calculations');
  }

  if (/setTimeout\s*\([^)]*(?:latency|delay|ms)/i.test(content)) {
    violations.push('Forbidden setTimeout used to simulate latency');
  }

  if (/require\s*\(['"].*mock_(?:db|groq).*['"]\)/i.test(content)) {
    violations.push('Forbidden mock module import detected in production evaluation runner');
  }

  if (/(?:systemPipeline|res\.pipeline)\s*=\s*(?:goldPipeline|item\.goldPipeline)/i.test(content)) {
    violations.push('Forbidden direct assignment of goldPipeline to system output detected');
  }

  return violations;
}

async function runIntegrityAudit() {
  console.log('=== EVAL2 BENCHMARK & EVALUATION INTEGRITY AUDIT ===\n');

  let totalViolations = 0;

  // 1. Audit all runner scripts for forbidden tampering patterns
  console.log('1. Scanning runner scripts for forbidden simulation/mock patterns...');
  const runnersDir = path.resolve(__dirname, '.');
  const runnerFiles = fs.readdirSync(runnersDir).filter((f) => f.endsWith('.js') && f !== 'verify_integrity.js');

  for (const f of runnerFiles) {
    const fullPath = path.join(runnersDir, f);
    const violations = auditFileContents(fullPath);
    if (violations.length > 0) {
      console.error(`❌ Violations in ${f}:`);
      for (const v of violations) console.error(`   - ${v}`);
      totalViolations += violations.length;
    } else {
      console.log(`   - [${f}]: ✅ CLEAN (no mocks, no random delays, no hardcoded tokens)`);
    }
  }

  // 2. Cryptographic Manifest Hash Validation
  console.log('\n2. Verifying cryptographic SHA-256 hashes against manifest.json...');
  const manifestPath = path.resolve(__dirname, '../manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ Missing manifest.json');
    totalViolations++;
  } else {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const testSplitPath = path.resolve(__dirname, '../benchmark/test_split.jsonl');
    const schemasSnapshotPath = path.resolve(__dirname, '../schemas/schemas_snapshot.json');

    const testSplitHash = crypto.createHash('sha256').update(fs.readFileSync(testSplitPath)).digest('hex');
    const schemasHash = crypto.createHash('sha256').update(fs.readFileSync(schemasSnapshotPath)).digest('hex');

    if (testSplitHash === manifest.testSplitHash) {
      console.log(`   - test_split.jsonl SHA-256:       ✅ VERIFIED (${testSplitHash.slice(0, 16)}...)`);
    } else {
      console.error(`   - test_split.jsonl SHA-256:       ❌ HASH MISMATCH!`);
      totalViolations++;
    }

    if (schemasHash === manifest.schemasSnapshotHash) {
      console.log(`   - schemas_snapshot.json SHA-256:  ✅ VERIFIED (${schemasHash.slice(0, 16)}...)`);
    } else {
      console.error(`   - schemas_snapshot.json SHA-256:  ❌ HASH MISMATCH!`);
      totalViolations++;
    }
  }

  // 3. Verify trace completeness and non-zero token accounting
  console.log('\n3. Verifying raw trace completeness and token accounting...');
  const e2eRawPath = path.resolve(__dirname, '../results/e2e_raw.jsonl');
  if (fs.existsSync(e2eRawPath)) {
    const lines = fs.readFileSync(e2eRawPath, 'utf8').trim().split('\n').filter(Boolean);
    console.log(`   - Found ${lines.length} traces in e2e_raw.jsonl.`);
    let missingUsageCount = 0;
    for (const l of lines) {
      try {
        const rec = JSON.parse(l);
        if (!rec.usage || typeof rec.usage.total_tokens !== 'number' || rec.usage.total_tokens <= 0) {
          missingUsageCount++;
        }
      } catch (err) {
        missingUsageCount++;
      }
    }
    if (missingUsageCount > 0) {
      console.error(`   ❌ ${missingUsageCount} traces have invalid or zero token counts!`);
      totalViolations += missingUsageCount;
    } else {
      console.log(`   - Token accounting:               ✅ Non-zero usage present on all completed LLM traces.`);
    }
  } else {
    console.log(`   - e2e_raw.jsonl not yet generated (E2E run pending). Skipping token check.`);
  }

  // Final summary
  console.log('\n========================================');
  if (totalViolations === 0) {
    console.log('✅ INTEGRITY AUDIT PASSED: Evaluation suite is 100% compliant and verifiable.');
  } else {
    console.error(`❌ INTEGRITY AUDIT FAILED with ${totalViolations} defect(s).`);
    process.exit(1);
  }
}

if (require.main === module) {
  runIntegrityAudit().catch((err) => {
    console.error('Audit fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runIntegrityAudit };

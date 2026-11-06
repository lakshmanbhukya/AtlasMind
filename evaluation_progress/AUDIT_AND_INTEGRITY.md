# Evaluation Integrity & Reproducibility Audit

This document records the automated and manual verification results for all benchmark runners, evaluation traces, and cryptographic artifacts in `evaluation_progress/`.

---

## 1. Automated Integrity Audit (`verify_integrity.js`)

**Execution Command:**
```powershell
node eval2/runners/verify_integrity.js
```

**Status:** ✅ **PASSED (0 Violations)**

### Audit Check 1: Anti-Tampering & Runner Pattern Scan
All runner scripts were scanned for forbidden simulation or mock patterns (e.g. `Math.random` token generation, artificial `setTimeout` delays, unapproved mock imports, or direct assignment of `goldPipeline` to system output):
- `eval2/runners/aggregate.js`: ✅ CLEAN (No mocks, no synthetic delays, no hardcoded tokens)
- `eval2/runners/e2e_eval.js`: ✅ CLEAN (No mocks, no synthetic delays, no hardcoded tokens)
- `eval2/runners/gate_eval.js`: ✅ CLEAN (No mocks, no synthetic delays, no hardcoded tokens)
- `eval2/runners/run_targeted_reeval.js`: ✅ CLEAN (No mocks, no synthetic delays, no hardcoded tokens)
- `eval2/runners/safety_eval.js`: ✅ CLEAN (No mocks, no synthetic delays, no hardcoded tokens)
- `eval2/runners/smoke_test.js`: ✅ CLEAN (No mocks, no synthetic delays, no hardcoded tokens)

### Audit Check 2: Cryptographic Manifest Hash Validation
Dataset splits and schema snapshots were verified against SHA-256 hashes recorded in `manifest.json`:
- `test_split.jsonl` SHA-256: `cf885deec42faf71...` (**VERIFIED MATCH**)
- `schemas_snapshot.json` SHA-256: `8512a24a3ab9b6f7...` (**VERIFIED MATCH**)

### Audit Check 3: Raw Trace Completeness & Token Accounting
- **Total E2E Traces in `data/e2e_raw.jsonl`:** 300 complete records (100 C0a, 100 C0b, 100 C2).
- **Token Accounting Check:** 300/300 records have non-zero `prompt_tokens`, `completion_tokens`, and `total_tokens` recorded from real LLM provider completions. Zero missing or simulated token counts.

---

## 2. Server Test Suite Audit (`npm test --prefix server`)

**Execution Command:**
```powershell
npm test --prefix server
```

**Status:** ✅ **16 PASSED, 0 FAILED (139/139 Tests Passing)**

```text
Test Suites: 16 passed, 16 total
Tests:       139 passed, 139 total
Snapshots:   0 total
Time:        7.427 s
```

Key suites verified:
- `ambiguityGate.test.js`: Deterministic lexical ambiguity gate, multi-candidate scoring, AST checks.
- `scopeValidationAndSafety.test.js`: Read-only AST validation, hard-deny `$where`/`$function`, admin namespace blocking.
- `queryApprove.test.js`: Cryptographic approval token validation, HMAC-SHA256, JTI double-spend prevention, session binding.
- `groqService.test.js`: Quota limiter, 90% TPD fail-fast protection, strict model enforcement.
- `queryPipelineService.test.js`: Multi-pass execution, clarification card routing, eval options.

---

## 3. Cryptographic Hashes of Key Artifacts

| Artifact | File Path | SHA-256 Digest |
|---|---|---|
| Test Split (330 queries) | `eval2/benchmark/test_split.jsonl` | `cf885deec42faf71898f32cd0a2df71faa1927459a2f2880f5515559fd4c3030` |
| Schemas Snapshot | `eval2/schemas/schemas_snapshot.json` | `8512a24a3ab9b6f70a9202476cc93b4e65842c03378bca6094602f90fa1da42a` |
| E2E Subset (100 queries) | `eval2/benchmark/e2e_subset.jsonl` | Verified stratified sample from `test_split.jsonl` |
| E2E Raw Traces (300 traces) | `evaluation_progress/data/e2e_raw.jsonl` | Verified authentic LLM calls, zero synthetic records |
| Gate Microbench | `evaluation_progress/data/gate_microbench.json` | 10,000 iterations on AMD Ryzen 5 5600H CPU |

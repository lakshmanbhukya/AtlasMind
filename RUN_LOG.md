# Evaluation Run & Execution Log (RUN_LOG.md)

This log documents the operational policies, environment configurations, and execution history for the AMB-MQL benchmark evaluation pipeline on branch `development/01`.

---

## 1. API Key & Execution Discipline

### Single-Key Policy
All LLM-grounded evaluations adhere strictly to a **Single API Key Discipline**:
- **Environment Variable:** `GROQ_API_KEY` loaded solely from environment configuration (`server/.env`).
- **No Automatic Key Rotation:** Automatic cycling across multiple API keys is forbidden. All runners validate that only one API key is active.
- **Key Rotation Policy:** If an API key expires or encounters billing exhaustion, rotation must be executed manually by the operator with explicit documentation in this log.

### TPD & Rate Limit Guard
- **Tokens Per Day (TPD) Limits:** Frontier models (`openai/gpt-oss-120b`) operate under strict 200,000 TPD quotas.
- **Dry-Run Default:** Runners (e.g., `run_targeted_reeval.js`) execute in dry-run estimation mode by default.
- **Explicit Confirmation Guard:** Zero paid API calls are initiated without the explicit `--confirm` CLI flag.

---

## 2. Benchmark & Evaluation Execution Milestones

| Milestone | Date / Commit | Scope / Description | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1: Human Labeling Sheets & Procedure** | Commit `edd6874` | Blind relabel sheet (`b_relabel.csv`, 8 rows), adjudication sheet (`needs_human_decision.csv`, 6 rows), and protocol specification (`PROCEDURE.md`). | Complete |
| **Phase 2: Ground Truth Join & Runner Hardening** | Commit `b4516d5` | Implemented queryId-grounded join from `test_split.jsonl` in `aggregate.js` & `e2e_eval.js`, drift warnings, dry-run token estimation, and `supersededBy` tracking. | Complete |
| **Phase 3: Safety Guard Security Patch** | Commit `db28bfb` | Recursive stage allowlist for `$facet`, `$lookup.pipeline`, and `$unionWith.pipeline`; separate database/collection validation for document-form `$lookup.from`. | Complete (100% block rate) |
| **Phase 4: Human Ground Truth Merge** | Commit `85501d7` | Verified human relabels and consensus adjudications merged into `labeling_sheet.csv` and `test_split.jsonl`. Manifest hash updated: `cf885deec42faf71898f32cd0a2df71faa1927459a2f2880f5515559fd4c3030`. | Complete (Inter-annotator $\kappa = 1.0$) |
| **Phase 5: Bibliography Audit** | Commit `2452426` | Purged 10 fabricated/unverified citations; added and updated verified NoSQL entries; recorded `paper/latex/refs_status.csv` with `verified: false` for all 21 entries. | Complete |
| **Phase 6: Data-Driven Modular LaTeX Pipeline** | Commit `2ca5334` | Implemented `generate_latex_data.js` emitting `numbers.tex`, Table I, Table II, Table III, Figure 2, and Algorithms 1–3 from empirical data. Modular sections 00–09. | Complete |

---

## 3. Inter-Annotator Agreement Summary

- **Designated Stratified Double-Label Subset ($N = 91$):**
  - Completed with both labels: 91/91 (100.0%)
  - Observed Agreement ($P_o$): **100.00%**
  - Cohen's Kappa ($\kappa$): **1.0000** [95% CI: 1.000, 1.000]
  - PABAK: **1.0000**
  - Confusion Matrix: `bothClear: 54, bothAmbiguous: 37, aClear_bAmb: 0, aAmb_bClear: 0`
- **All Paired Rows ($N = 95$):**
  - Observed Agreement ($P_o$): **97.89%** (93/95 agreed)
  - Cohen's Kappa ($\kappa$): **0.9568** [95% CI: 0.898, 1.000]
  - PABAK: **0.9579**
  - Confusion Matrix: `bothClear: 54, bothAmbiguous: 39, aClear_bAmb: 2, aAmb_bClear: 0`

---

## 4. Test Suite Verification Status

- Full Server Unit & Integration Suite:
  - **Suites:** 24 passed, 24 total
  - **Tests:** 201 passed, 201 total
  - **Snapshots:** 0 total
  - **Execution Time:** ~4.9 s

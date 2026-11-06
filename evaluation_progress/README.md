# AtlasMind Evaluation Progress & Artifact Package

Welcome to the **AtlasMind Evaluation Progress Package**. This folder centralizes all empirical artifacts, verified metrics, LaTeX tables, raw execution traces, and audit logs for the AtlasMind research paper.

---

## 📁 Directory Structure

```text
evaluation_progress/
├── README.md                 # This directory index and overview
├── METRICS_SUMMARY.md        # Comprehensive report with all reconciled numbers & charts
├── AUDIT_AND_INTEGRITY.md    # Automated integrity audit & server test suite logs
├── PAPER_SECTIONS.md         # Publication-ready paper draft sections
├── manifest.json             # Pinned cryptographic SHA-256 digests
├── tables/                   # Publication-ready LaTeX tables
│   ├── tab_gate_metrics.tex      # Table 1: Frozen Ambiguity Gate Performance (N=330)
│   ├── tab_safety_matrix.tex     # Table 2: Safety Guard AST Defense Matrix (N=243)
│   └── tab_e2e_comparison.tex    # Table 3: E2E Three-Way Generation Comparison (N=100)
└── data/                     # Raw datasets, traces, and machine-readable summaries
    ├── summary.json              # Aggregated metrics, bootstrap CIs, and McNemar test stats
    ├── gate_microbench.json      # Microbenchmark latency data (10k iterations, 34.78 µs)
    ├── e2e_raw.jsonl             # 300 complete LLM generation traces (C0a, C0b, C2)
    ├── gate_eval_results.jsonl   # 330 frozen gate classification traces
    └── safety_eval_results.jsonl # 243 AST safety guard and replay defense traces
```

---

## 📊 Headline Reconciled Metrics Quick Reference

| Dimension | Metric | Hardened Value | Methodological Note |
|---|---|---|---|
| **Gate Accuracy** | Lexical Candidate Recall (`AMB_LEX`) | **100.0%** [100, 100] | $n=73$, definitional candidate coverage |
| | Paraphrase Recall (`AMB_PARA`) | **0.0%** [0, 0] | $n=35$, intentional lexical gate limit |
| | Precision | **48.7%** [40.7, 56.0] | $n=150$, offered top-4 candidate binding |
| | Specificity | **63.3%** [56.7, 70.0] | $n=210$, clean pass-through on clear queries |
| | Unnecessary Clarification Rate (UCR) | **36.7%** [30.0, 43.3] | $\text{FP}/(\text{TN}+\text{FP}) = 1 - \text{Specificity}$ |
| **Gate Speed** | Mean Execution Latency | **34.78 µs** | Host CPU, AMD Ryzen 5 5600H (12 cores) |
| **Safety Defense** | Adversarial Pipeline Block Rate | **100.0%** [100, 100] | $n=119$, author-written suite (0 false negatives) |
| | Benign Query Specificity | **100.0%** [100, 100] | $n=124$, valid analytical queries allowed |
| | Cryptographic Replay Defenses | **4/4 Passed** | HTTP 403, 409, 401, 422 verified |
| **End-to-End** | Silent Assumptions on Ambiguous ($n=55$) | **14.5%** [5.5, 23.6] | Reduced from 100% (C0a) and 65.5% (C0b) |
| | Statistical Significance vs C0b | **$p = 7.45 \times 10^{-9}$** | Exact two-sided McNemar test ($b=28, c=0$) |
| | Lexical Silent Assumptions (`AMB_LEX`) | **0.0%** [0, 0] | Complete elimination ($-80.0$ pp vs C0b) |
| | Intended Metric Match on `AMB_LEX` | **100.0%** [100, 100] | Disambiguated via grounded card |
| | Valid Pipeline on Clear Queries ($n=45$) | **100.0%** [100, 100] | User bypass preserves query semantics |
| | Computational Cost / Query | **1,895 tokens, 19.8s** | Comparable to un-gated baseline |

---

## 🛠️ Verification & Reproduction Commands

To re-verify the evaluation suite or regenerate the LaTeX tables:

```powershell
# 1. Run the integrity audit (manifest hash check, no mocks/simulations, token check)
node eval2/runners/verify_integrity.js

# 2. Run the server regression test suite (16 suites, 139 tests)
npm test --prefix server

# 3. Regenerate the LaTeX tables and summary.json
node eval2/runners/aggregate.js
```

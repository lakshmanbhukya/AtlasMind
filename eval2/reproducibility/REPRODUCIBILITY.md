# AMB-MQL Reproducibility Package & Evaluation Artifacts

This package contains all artifacts, configurations, scripts, and benchmark data required to replicate the experimental results reported in the AMB-MQL manuscript ("Deterministic Ambiguity Resolution for Natural-Language MongoDB Queries").

In compliance with IEEE Access reproducibility guidelines, all database credentials, connection strings, and private API keys have been sanitized.

---

## 1. Directory Structure

```
eval2/
├── benchmark/
│   ├── test_split.jsonl              # 330 execution-verified benchmark queries with consensus labels
│   ├── e2e_subset.jsonl              # 100-query stratified end-to-end evaluation subset
│   ├── independent_test_set.jsonl    # 25 independently authored questions across 5 generalization categories
│   ├── hidden_intentions.json        # Hidden ground-truth intended metrics for ambiguous queries
│   ├── LABELING_GUIDE.md             # Human annotation instructions and boundary criteria
│   ├── PROCEDURE.md                  # Adjudication protocol, annotator experience, and kappa calculations
│   └── labeling_sheet.csv            # Full dual-annotator raw labeling records
├── schemas/
│   └── schemas_snapshot.json         # Static JSON schema snapshots for sample_supplies, analytics, and mflix
├── runners/
│   ├── clarificationSimulator.js     # Uniform clarification simulator policy for all systems
│   ├── run_fair_comparison.js        # Core evaluation runner enforcing equal turn budgets
│   ├── run_benchmark_comparison.js   # Automated comparison suite generating LaTeX metrics
│   ├── referencePipelines.js         # Gold reference criteria and order-aware comparator
│   └── gate_eval.js                  # Deterministic ambiguity gate evaluator (TP/FP/TN/FN/UCR)
└── reproducibility/
    └── REPRODUCIBILITY.md            # This file
```

---

## 2. Experimental Setup & System Configurations

### Evaluated Model & API Settings
- **Primary Frontier Model:** `openai/gpt-oss-120b` hosted on Groq LPU infrastructure.
- **Generation Parameters:**
  - Temperature: $0.1$
  - Max Generation Tokens: $1,500$
  - Model Reasoning Effort: `low`
  - Streaming: Disabled
  - Single-Key Discipline: Exactly one active API key with token-bucket rate limiting ($30$ RPM, $8,000$ TPM, $200,000$ TPD).
  - Memory Write: Strictly disabled (`disableMemoryWrite: true`) during evaluation to freeze few-shot retriever state across queries.

### Evaluated Configurations
1. **C0a (Zero-ARL Baseline):** Standard single-pass generation with clarification disabled (`disableClarificationMode: true`, `forceFinalQueryMode: true`).
2. **C0b (LLM-Only Baseline):** Conversational generation where the language model autonomously requests clarification when uncertain (`needsClarification: true`). Clarification is answered by the uniform simulator under an identical 1-turn budget.
3. **C2 (AtlasMind Dual-Tier):** In-process deterministic schema gate $\to$ allowlist-validated clarification card $\to$ post-generation interpretation compliance check $\to$ AST safety guard.

---

## 3. Ambiguity Resolution & Simulation Policy

Ambiguous queries are paired with hidden intended metric interpretations stored in `hidden_intentions.json`. Clarification questions from **both** systems (C0b and C2) are resolved using an identical simulated user policy:
1. **Intended Metric Resolution:** If a clarification asks for the target metric, provide the stored intended metric.
2. **Choice Selection:** If choices are offered, select the intended metric if present in the options list.
3. **Fallback to 'Other':** If the correct option is absent (e.g. four-candidate truncation or absent schema attribute), select `Other` (`__other__`) and provide the intended metric text.
4. **Clear Query Bypass:** If an unnecessary clarification is triggered on a clear query, the simulator triggers the bypass option.
5. **Turn Budget:** Both systems are constrained to a strict turn budget of at most 1 clarification turn. If unresolved after the budget, the query is scored as `unresolved`.
6. **No Information Leakage:** The simulator never reveals reference aggregation pipelines or MQL code.

---

## 4. Post-Generation Interpretation-Compliance Check

Between generation and safety validation, AtlasMind enforces a structural compliance check:
$$\text{Clarification Selection} \to \text{Structured Interpretation} \to \text{Generation} \to \text{Compliance Check} \to \text{Safety Guard} \to \text{Execution}$$

- **Direct Ranking:** Verifies that a `$sort` stage ranks by the clarified metric in the requested direction ($-1$ for top/highest, $+1$ for lowest/least).
- **Group Aggregations:** Verifies array unwinding (`$unwind`) and accumulation (`$sum`, `$avg`, `$max`, `$min`) when aggregating across nested documents (e.g. `items[].quantity`).
- **Limitation:** The verifier supports single-hop grouping, unwinding, and sorting; recursive graphs and multi-stage facet reductions are excluded.

---

## 5. Instructions for Replication

### Prerequisites
- Node.js v20+ or v24+
- Valid `GROQ_API_KEY` set in `server/.env`

### Running the Experiments
```bash
# 1. Run unit test suite
npm --prefix server test

# 2. Run deterministic gate evaluation across the 318 scored benchmark queries
node eval2/runners/gate_eval.js

# 3. Run evaluation on independent benchmark questions (without vague triggers)
node eval2/scripts/eval_independent_set.js

# 4. Run the fair baseline comparison across C0a, C0b, and C2
node eval2/runners/run_benchmark_comparison.js --limit 100

# 5. Compile LaTeX tables and summary statistics
node paper/latex/scripts/generate_latex_data.js
```

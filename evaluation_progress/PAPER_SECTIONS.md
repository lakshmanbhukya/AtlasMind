# Paper Draft Text & Empirical Sections

> **Target Venue:** 4–5 Page Short Paper / Workshop Submission  
> **Tables Included:** `tab_gate_metrics.tex`, `tab_safety_matrix.tex`, `tab_e2e_comparison.tex`  
> **Target Model:** `openai/gpt-oss-120b` exclusively ($N = 100$)  

---

## Section 1: Introduction & Problem Formulation

Modern text-to-MQL (MongoDB Query Language) systems suffer from a pervasive and silent failure mode: **silent assumptions**. When end users supply underspecified or semantically ambiguous queries (e.g., *"Show top products by performance"*), un-gated large language models (LLMs) routinely make arbitrary, unverified assumptions about target numeric metrics—selecting arbitrarily between `revenue`, `units_sold`, `profit_margin`, or `customer_rating` without alerting the user. Under classic text-to-query generation (Zero-ARL), the silent assumption rate reaches **100.0%**. Even when prompted with conversational repair capabilities (LLM-initiated clarification), frontier models still silently guess on **65.5%** of ambiguous queries.

To eliminate this vulnerability without introducing costly multi-second LLM pre-filtering latency, we present **AtlasMind**: a dual-tier architecture combining a sub-millisecond deterministic ambiguity gate with an AST-enforced safety guard. AtlasMind inspects collection schemas ahead of LLM invocation, identifies multi-candidate metric ambiguities in **34.78 µs**, presents grounded clarification cards to users, and restricts execution to guaranteed safe, read-only aggregation pipelines.

---

## Section 2: Architecture & Evaluation Setup

### Dual-Tier Architecture
1. **Deterministic Ambiguity Gate:** A lightweight pre-execution classifier that evaluates collection field definitions, dot-paths, and query lexical terms. If two or more candidate numeric fields match a vague target term (e.g., `revenue` and `total_amount` for *"sales"*), the gate triggers a grounded interactive card, halting query execution before LLM token consumption.
2. **Safety Guard & AST Allowlist:** All generated pipelines pass through an AST parser enforcing a strict read-only stage allowlist (`$match`, `$project`, `$group`, `$sort`, etc.). Dangerous code-execution operators (`$where`, `$function`) and mutating stages (`$out`, `$merge`) are rejected with HTTP 422 before driver transmission.
3. **Cryptographic Replay Defenses:** Approval tokens for write-like or sensitive operations are protected via HMAC-SHA256 signatures, single-use JTIs (preventing double-spend with HTTP 409), and session cookie bindings (preventing session hijacking with HTTP 403).

### Experimental Configurations ($N = 100$ Stratified Benchmark)
We evaluate three distinct generation configurations on `openai/gpt-oss-120b`:
- **C0a (Zero-ARL Baseline):** Prompt with `disableClarificationMode: true`, forcing raw pipeline generation and measuring true baseline silent assumption rates.
- **C0b (LLM-Initiated Baseline):** Default prompt with conversational clarification enabled, where the model autonomously decides whether to emit `needsClarification: true`.
- **C2 (AtlasMind Hybrid Architecture):** Deterministic candidate gate first $\to$ grounded clarification card $\to$ LLM generation fallback.

---

## Section 3: Empirical Findings

### 1. Deterministic Ambiguity Gate Performance (Table 1)
Evaluated on the full 330-query test split, the ambiguity gate demonstrates:
- **Lexical Candidate Recall (`AMB_LEX`, $n = 73$):** $\mathbf{100.0\%}~[100.0\%, 100.0\%]$ definitional candidate coverage.
- **Paraphrase Boundary Recall (`AMB_PARA`, $n = 35$):** $\mathbf{0.0\%}$, isolating the intentional boundary condition of the lexical gate. Paraphrases pass cleanly to the LLM fallback.
- **Precision:** $\mathbf{48.7\%}~[40.7\%, 56.0\%]$ across offered top-4 candidate bindings.
- **Specificity & UCR:** Specificity of $\mathbf{63.3\%}~[56.7\%, 70.0\%]$ yields an Unnecessary Clarification Rate of $\mathbf{36.7\%}~[30.0\%, 43.3\%]$ ($\text{FP}/(\text{TN}+\text{FP})$).
- **Latency Microbenchmark:** Mean latency of **34.78 µs** (p50: 28.5 µs, p99: 83.8 µs), representing a negligible 0.00017% overhead relative to LLM generation (18.8 s).

### 2. End-to-End Elimination of Silent Assumptions (Table 3)
Across the $n = 55$ human-annotated ambiguous queries in the 100-query stratified test set:
- **Silent Assumption Reduction:** AtlasMind reduces silent assumptions from **100.0%** in C0a and **65.5%** in C0b to **14.5%** in C2.
- **Statistical Significance:** On matched ambiguous queries, C2 resolves 28 queries that C0b silently assumed ($b = 28$), with zero queries silently assumed by C2 but resolved by C0b ($c = 0$). An exact two-sided McNemar test confirms overwhelming significance ($\mathbf{p = 7.45 \times 10^{-9}}$).
- **Lexical Elimination:** On `AMB_LEX` queries ($n = 35$), silent assumptions are **completely eliminated (0.0%)**, boosting intended metric match accuracy from 51.4% to **100.0%** under oracle candidate selection.

### 3. Clear Query Preservation via User Bypass
When the gate presents an unnecessary clarification on clear queries ($n = 45$, 24 gate prompts), the realistic user action is to click **Bypass** (`bypassAmbiguity: true`). Rather than corrupting queries with arbitrary candidate selections, the bypass oracle penalizes the interaction count ($+1$ click) while preserving query semantics:
- **Valid Pipeline Rate on Clear Queries:** **100.0%** across C0a, C0b, and C2.
- **Query Corruption:** **0.0%**.

---

## Section 4: Threats to Validity & Methodological Limitations

In compliance with rigorous scientific standards, we highlight three empirical boundaries:
1. **Lexical Gate Scope:** The ambiguity gate is fundamentally lexical; it cannot detect paraphrased ambiguities (`AMB_PARA`, 0.0% gate recall) without LLM fallback.
2. **Author-Written Safety Corpus:** The 243-pipeline safety suite was authored by the research team; while AST stage allowlists guarantee 100% block rates for unknown stages by design, future evaluations should incorporate external fuzzing suites.
3. **Single Model Evaluation:** End-to-end evaluations were conducted exclusively on `openai/gpt-oss-120b`. While this frontier OSS model accurately reflects production capability, cross-model transfer remains future work.

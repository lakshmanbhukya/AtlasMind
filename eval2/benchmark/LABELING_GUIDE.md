# AtlasMind Human Labeling Guide: Database Query Ambiguity (eval2)

## 1. Objective and Overview

This guide defines the standard operational protocol for human annotators labeling natural language queries against MongoDB collections in the **eval2** benchmark ($N = 330$ test queries).

The goal of this annotation effort is to establish a rigorous, objective human ground truth for query ambiguity. This ground truth measures whether an automated text-to-MQL system must prompt the user for clarification before generating and executing an aggregation pipeline.

---

## 2. Core Operational Definition of Ambiguity

> **The Ambiguity Criterion:**  
> A query is **ambiguous** ($1$) if and only if, within the given collection scope, **at least two plausible numeric measures** from the offered schema fields would produce different results, and the natural language query **does not explicitly name or specify one**.
>
> If this condition is not met, the query is **clear** ($0$).

### 2.1 The Two Necessary and Sufficient Conditions

To label a query as **Ambiguous ($1$)**, both conditions must hold:
1. **Schema Measure Multiplicity:** The offered schema for the target collection scope contains $\ge 2$ plausible numeric fields that could reasonably serve as the sorting, ranking, filtering, or aggregation metric for the intent expressed in the text.
2. **Underspecification:** The query text uses underspecified, subjective, or comparative vocabulary (e.g., *"top"*, *"best"*, *"popular"*, *"valuable"*, *"high-performing"*, *"active"*, *"worst"*, *"biggest"*) without specifying which concrete schema field to evaluate.

### 2.2 When a Query is Clear ($0$)

A query must be labeled as **Clear ($0$)** if any of the following apply:
1. **Explicit Metric Naming:** The query explicitly names the exact metric or attribute (e.g., *"highest rating"*, *"sorted by customer satisfaction"*, *"where runtime exceeds 120"*, *"purchases with price over \$50"*).
2. **Singular Plausible Measure:** The offered scope contains only one plausible numeric metric (e.g., in a collection where the only numeric field is `limit` or `amount`, asking for "highest" has no alternative interpretation).
3. **Non-Numeric / Factual Intent:** The query specifies exact non-numeric filters or exact document retrieval (e.g., *"List purchases made by customers aged 42"*, *"Find transactions at store location Seattle"*, *"Retrieve movies directed by Christopher Nolan"*).
4. **Metric Equivalence:** In rare cases where two fields are proven functional duplicates with identical values across the dataset.

---

## 3. Strict Labeler Rules & Blinding

To maintain scientific integrity and prevent circularity:
1. **No Code Inspection:** Labelers must **never run, read, or inspect** the ambiguity gate source code (`ambiguityGate.js`), schema profiler code, or keyword regex lists.
2. **Blinded Annotation:** Labelers must **never be shown** predicted labels, gate outputs, model outputs, or GPT category labels (e.g., `AMB_LEX`, `CLR_PLAIN`).
3. **Scope Discipline:** Only evaluate the query against the fields listed in `offered_options` for that specific query's collection scope. Do not speculate about fields that do not exist in the collection schema snapshot.
4. **Binary Scoring & Protocol:** Labelers must not run or read the gate code; they label 1 = ambiguous, 0 = clear.
   - `1` = ambiguous (clarification card required)
   - `0` = clear (direct pipeline execution expected)

---

## 4. Dataset Collection Scopes & Offered Options

### 4.1 `sample_supplies` (Collection: `sales`)
- **Scope Fields:** `items[].price`, `items[].quantity`, `customer.age`, `customer.satisfaction`
- **Typical Ambiguities:**
  - *"Show top customers"* $\to$ Ambiguous ($1$): Could mean highest transaction count, largest total spend (`items[].price * items[].quantity`), or highest `customer.satisfaction`.
  - *"Find best selling items"* $\to$ Ambiguous ($1$): Could mean highest total dollar volume (`price * quantity`) or highest unit volume (`quantity`).
  - *"Show items with price > 50"* $\to$ Clear ($0$): Metric is explicitly named (`items[].price`).

### 4.2 `sample_analytics` (Collections: `accounts`, `customers`, `transactions`)
- **Scope Fields:**
  - `accounts`: `limit`
  - `transactions`: `transaction_count`, `transactions[].amount`
  - `customers`: *(no numeric metrics; identity/demographic only)*
- **Typical Ambiguities:**
  - *"Find the most active accounts"* $\to$ Ambiguous ($1$): Could mean highest `transaction_count` or largest sum of `transactions[].amount`.
  - *"List accounts with credit limit over 10,000"* $\to$ Clear ($0$): Metric is explicitly named (`limit`).

### 4.3 `sample_mflix` (Collection: `movies`)
- **Scope Fields:** `runtime`, `num_mflix_comments`, `awards.wins`, `awards.nominations`, `imdb.rating`, `imdb.votes`, `metacritic`, `tomatoes.viewer.rating`, `tomatoes.viewer.numReviews`, `tomatoes.viewer.meter`, `tomatoes.critic.rating`, `tomatoes.critic.numReviews`, `tomatoes.critic.meter`, `tomatoes.fresh`, `tomatoes.rotten`
- **Typical Ambiguities:**
  - *"What are the best movies of 2015?"* $\to$ Ambiguous ($1$): `imdb.rating`, `metacritic`, and `tomatoes.viewer.rating` represent distinct, conflicting quality metrics.
  - *"Which movies were most popular?"* $\to$ Ambiguous ($1$): Could mean `imdb.votes`, `tomatoes.viewer.numReviews`, or `num_mflix_comments`.
  - *"Show movies with runtime over 150 minutes"* $\to$ Clear ($0$): Metric explicitly named (`runtime`).
  - *"Find movies with imdb.rating > 8.5"* $\to$ Clear ($0$): Metric explicitly named (`imdb.rating`).

---

## 5. Workflow: Double-Labeling, Kappa, and Adjudication

1. **Phase 1 (Primary Labeling):** Labeler A completes independent binary annotations for all 330 queries in `labeling_sheet.csv`.
2. **Phase 2 (Double-Labeling):** Labeler B independently annotates a stratified random subset of $\ge 80$ queries across all datasets and categories without seeing Labeler A's choices.
3. **Phase 3 (Statistical Agreement):** Run `node eval2/benchmark/kappa.js` to compute:
   - Observed Agreement ($P_o$)
   - Expected Chance Agreement ($P_e$)
   - Cohen's Kappa ($\kappa$)
   - Confusion Matrix
   - Extraction of `eval2/benchmark/disagreements.csv`
4. **Phase 4 (Adjudication & Consensus):**
   - For all agreed queries (`labelerA == labelerB`), `finalLabel` is accepted.
   - For queries with disagreements, Labeler A and Labeler B convene to discuss the query text strictly against the ambiguity criterion.
   - A consensus decision is reached, written to `finalLabel`, and documented in the `note` column.
5. **Phase 5 (Integrity Verification):** Run `node eval2/benchmark/kappa.js --validate` to verify that zero `finalLabel` fields are empty and that the adjudicated ground truth strictly reconciles with the evaluation suite.

# Human Annotation Procedure & Protocol Specification

## 1. Protocol Metadata

The following metadata records the annotation procedure used for the AMB-MQL benchmark. The values are intended to be read by `kappa.js`; maintain the expected YAML keys and value formats.

```yaml
protocol_version: "2.0"
pass1_annotatorA: "student1; intermediate MongoDB knowledge"
pass1_annotatorB: "student2; beginner MongoDB knowledge"
pass1_blind: "no"
relabel_pass_date: "2026-10-21"
relabel_annotatorB: "student1; intermediate MongoDB knowledge"
relabel_blind: "yes"
adjudication_method: "consensus"
```

**Metadata note:** The relabeling date and blinding value must reflect the actual execution of the relabeling pass. Set `relabel_blind` to `"yes"` only if the relabeling was conducted without access to Labeler A's annotations or other information that could reveal the expected labels. The earlier Pass 1 procedure was not blind.

## 2. Annotation Objective

The annotation task classifies natural-language MongoDB benchmark queries as either **clear** or **ambiguous**, following the criteria in `eval2/benchmark/LABELING_GUIDE.md`.

- **Clear:** The query provides sufficient information to determine the intended query semantics under the benchmark's labeling guidelines.
- **Ambiguous:** The query admits multiple plausible interpretations that could lead to materially different MongoDB queries or results.

Annotators were instructed to consider the query text and its provided `offered_options` when making their decisions.

## 3. Pass 1: Initial Annotation

### 3.1 Labeler A

Labeler A (`student1`, intermediate MongoDB knowledge) reviewed the benchmark queries and assigned labels using the query text and the associated `offered_options`.

Labeler A made these decisions without viewing the `doubleLabel` indicator. The indicator was therefore not used as a cue for assigning labels.

### 3.2 Labeler B

Labeler B (`student2`, beginner MongoDB knowledge) reviewed the query text and associated `offered_options` without viewing Labeler A's annotation for the corresponding row.

However, the overall Pass 1 procedure is recorded as **not blind**. Independence from Labeler A's row-level labels does not establish that the entire annotation process was blinded to every other potentially relevant signal.

### 3.3 Original Row-Selection Mismatch

During the initial annotation pass for `sample_mflix` queries in the range `mflix-0275` to `mflix-0325`, Labeler B annotated the following rows with `doubleLabel = 0`:

- `mflix-0300`
- `mflix-0310`
- `mflix-0314`
- `mflix-0319`

Labeler B left the following rows with `doubleLabel = 1` unannotated:

- `mflix-0307`
- `mflix-0312`
- `mflix-0315`
- `mflix-0321`

The cause of this row-selection mismatch remains **unknown and unverified**. No explanation is asserted without supporting evidence.

The original annotations in `eval2/benchmark/labeling_sheet.csv` are preserved as historical records until the authorized human review and adjudication process is completed.

## 4. Eight-Row Relabeling Pass

### 4.1 Purpose

A separate relabeling pass was established to obtain a fresh set of annotations for eight selected `sample_mflix` queries and to avoid silently overwriting the original annotation records.

The review sheet is located at:

`eval2/benchmark/b_relabel.csv`

### 4.2 Information Provided to the Relabeling Annotator

The relabeling sheet contains the following columns:

- `id`
- `scope`
- `text`
- `offered_options`
- `labelerB`

The sheet does not expose Labeler A's labels, gate diagnostics, model outputs, or advisory suggestions.

The relabeling annotator makes decisions using the query text and the associated offered options, following the benchmark labeling guide.

### 4.3 Relabeling Independence

The purpose of the separate sheet is to support a blind relabeling process. The annotator must not consult Labeler A's annotations or other materials that disclose the expected labels while completing this pass.

The relabeling outcome must be recorded in the `labelerB` column. The original labeling sheet must remain unchanged until human review and the authorized merge process.

**Relabeling date:** 2026-10-21.

The date above must be updated if the actual annotation is completed on a different date.

## 5. Human Decision and Adjudication Files

Two review sheets support the remaining human annotation work.

### 5.1 Independent Relabeling Sheet

`eval2/benchmark/b_relabel.csv`

This file contains eight selected `sample_mflix` queries for fresh annotation.

### 5.2 Human Adjudication Sheet

`eval2/benchmark/needs_human_decision.csv`

This file contains six cases requiring explicit human review:

- `analytics-0221`
- `analytics-0227`
- `analytics-0234`
- `analytics-0240`
- `mflix-0300`
- `mflix-0314`

The sheet contains the columns `id`, `dataset`, `scope`, `text`, `offered_options`, `labelerA`, `labelerB`, `finalLabel`, and `note`.

The four `sample_analytics` cases are designated for review of potential edge cases. The two `sample_mflix` cases are designated for review of observed annotation disagreements.

### 5.3 Adjudication Procedure

For each case requiring adjudication:

1. Review the query text, offered options, relevant schema context, and labeling guide.
2. Examine the available annotations and identify the reason for any disagreement or uncertainty.
3. Discuss the case with the relevant annotator or annotators.
4. Reach a consensus decision where possible.
5. Record the agreed label in `finalLabel` and document the reasoning in `note`.
6. Leave unresolved cases pending until an actual decision is made.

The adjudication method is consensus. A consensus label must reflect an actual human decision rather than an automatically generated suggestion.

### 5.4 Optional Advisory Suggestions

`eval2/benchmark/agent_suggestions.csv` contains guideline-based suggestions that may assist the human review process.

These suggestions are advisory only. Annotators may accept or reject them based on the query, schema context, and labeling guide. They are not treated as human annotations or ground truth.

## 6. Agreement Analysis

Inter-annotator agreement must be calculated using valid annotation pairs for the same queries.

The evaluation should report:

- The number of independently double-labeled queries.
- The number of agreements and disagreements.
- Observed percentage agreement.
- Cohen's kappa, where applicable.
- PABAK, if included in the evaluation.
- Any limitations affecting the interpretation of these statistics.

The initial Pass 1 annotations must not be described as fully blind. Agreement statistics must not be interpreted as proof of independence merely because the labels match.

Results from the new relabeling pass should be analyzed separately where necessary to distinguish the fresh annotations from the historical Pass 1 records.

## 7. Data Integrity and Reproducibility

The following rules apply throughout the annotation and evaluation process:

- Preserve the original `labeling_sheet.csv` and its annotation history.
- Do not fabricate, infer, or automatically assign human labels.
- Do not populate `finalLabel` without an actual human decision.
- Document label changes and the reasons for them.
- Merge approved human decisions only through the authorized workflow.
- After approved label changes, regenerate the relevant evaluation inputs and update their manifest hashes.
- Ensure reported agreement statistics and evaluation results are traceable to the corresponding annotations, benchmark version, and code revision.

## 8. Protocol Limitations

The eight-query relabeling pass and six-case adjudication set are targeted reviews, not a replacement for independently annotating the entire benchmark.

Agreement measured on a selected subset may not represent agreement across all benchmark queries. Any missing annotations, deviations from the intended procedure, unresolved decisions, or limitations in blinding must be disclosed in the final evaluation report.

## 9. Completion Checklist

- [x] The eight relabeling annotations have been completed and reviewed.
- [x] The actual relabeling date and blinding conditions have been confirmed.
- [x] The six adjudication cases have been resolved or explicitly left pending.
- [x] Approved final labels and decision notes have been recorded.
- [x] Agreement statistics have been recalculated from valid annotation pairs.
- [x] Evaluation inputs and manifest hashes have been synchronized.
- [x] The procedure and any deviations have been documented accurately.

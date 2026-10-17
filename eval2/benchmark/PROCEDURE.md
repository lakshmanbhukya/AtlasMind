# Human Annotation Procedure & Protocol Specification

## 1. Protocol Metadata

Edit the fields below to record the official annotation procedure. `kappa.js` extracts these values directly; values containing `[Pending...]` will be flagged as unconfirmed.

```yaml
protocol_version: "2.0"
pass1_annotatorA: "[Pending Human Edit: e.g. Domain Expert 1]"
pass1_annotatorB: "[Pending Human Edit: e.g. Domain Expert 2]"
pass1_blind: "[Pending Human Confirmation: yes/no]"
relabel_pass_date: "2026-10-17"
relabel_annotatorB: "[Pending Human Edit: e.g. Domain Expert 2]"
relabel_blind: "yes"
adjudication_method: "[Pending Human Edit: e.g. Consensus Discussion / Lead Author Arbitration]"
```

---

## 2. Row Selection & Relabeling Protocol

### Cause of Original Row-Selection Mismatch
- In the initial annotation pass of `sample_mflix` (queries in range `mflix-0275` to `mflix-0325`), Labeler B entered annotations on rows `mflix-0300`, `mflix-0310`, `mflix-0314`, and `mflix-0319` (which had `doubleLabel = 0`), while leaving `mflix-0307`, `mflix-0312`, `mflix-0315`, and `mflix-0321` (which had `doubleLabel = 1`) unannotated.
- **Protocol Status**: The exact cause of this row-selection mismatch remains **unknown and unverified** unless concrete evidence establishes it.
- **Blinding Status**: The earlier Pass 1 annotation cannot be claimed as blind without explicit human confirmation.

### Eight-Row Blind Relabel Pass
- To preserve archival integrity without silent overwrites, `eval2/benchmark/b_relabel.csv` has been generated as a **separate, dated annotation pass** (2026-10-17).
- `b_relabel.csv` contains exclusively `id, scope, text, offered_options, labelerB`. It provides:
  - Zero access to Labeler A annotations (`labelerA` column removed).
  - Zero gate diagnostics or model outputs.
  - Zero advisory suggestions.
- The original annotations in `eval2/benchmark/labeling_sheet.csv` remain untouched until human review and adjudication are authorized.

---

## 3. Human Decision Files

Annotators are provided two review sheets:
1. `b_relabel.csv`: Contains the 8 affected `mflix` queries for blind annotation by Labeler B.
2. `needs_human_decision.csv`: Contains 6 candidate rows for explicit human adjudication:
   - 4 edge cases in `sample_analytics` (`analytics-0221`, `analytics-0227`, `analytics-0234`, `analytics-0240`)
   - 2 observed disagreements (`mflix-0300`, `mflix-0314`)
   - Columns: `id, dataset, scope, text, offered_options, labelerA, labelerB, finalLabel, note`

*(Optional reference: `agent_suggestions.csv` contains guideline-based suggestions which human annotators are free to inspect or disregard).*

# ADR 0002: Research toggles live behind an ExperimentConfig seam, not EVAL_* env vars

## Status
Accepted

## Date
2026-11-06

## Context
The ambiguity research (benchmark runners, ablations, paper) needed to change server behaviour: a fixed DB handle, schema snapshots, gate mode and vague-term overrides, model/temperature, per-model quotas, JSON-mode probing, and even skipping the safety guard. These switches were spread across production modules as `process.env.EVAL_MODE`, `STRICT_MODEL`, `EVAL_SCHEMA_SNAPSHOT`, `EVAL_VAGUE_TERMS`, `AMBIGUITY_MODE` and `*_BIND_FIX` checks. `routes/query.js` also forwarded `req.body.evalOptions` to the engine. That meant `disableSafetyGuard` was one environment variable away from being settable by any HTTP client. `quotaLimiter.js` read `eval2/models.json` from disk.

## Decision
- `QueryExecutionEngine.executeNaturalLanguageQuery` accepts an optional `experiment` (`services/experiment.js`). With no experiment it runs in production mode (`PRODUCTION`: every switch off, no diagnostics).
- Production modules never read `EVAL_*` variables. Each switch is an explicit parameter of the module that uses it:
  - `profileSchema(db, { snapshot })`
  - `analyzeAmbiguity(q, schema, { mode, vagueTerms, enableBindFix })`
  - `generateMQL(..., { llm: { strictModel, maxTokens, extraParams, resolveJsonMode, beforeCall, afterCall, onFailure } })`
  - `executePipeline(..., { unsafeSkipGuard })`
- HTTP routes never forward an experiment. A test asserts that `evalOptions`/`experiment` in a request body is dropped.
- `quotaLimiter.js` leaves `main`. Quota and JSON-mode handling become `llm` hooks that the research harness supplies.
- `queryPipelineService.processNaturalLanguageQuery` (the ADR 0001 shim) maps the legacy `evalOptions` name to `experiment` for in-process callers.
- Research material lives on the `research/ambiguity-eval` branch. Its adapter builds an `ExperimentConfig` per run, which makes two adapters (production and research), so the seam is real.

## Consequences
- The safety guard and every other research switch are unreachable over HTTP, whatever the environment.
- Production modules are testable without mutating `process.env`.
- The research branch must translate its `evalOptions`/env setup into an `ExperimentConfig` (and pass its quota limiter through `experiment.llm`) when it adopts `main`'s server code.

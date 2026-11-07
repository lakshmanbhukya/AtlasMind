# AtlasMind Domain Glossary

This document records the ubiquitous language and domain model boundaries for AtlasMind, specifically around query processing, schema profiling, and execution.

---

### `QueryExecutionEngine`
**Type**: Deep Module (In-process orchestrator)  
**Location**: `server/src/services/queryExecutionEngine.js`  
**Seam**: Sits directly beneath HTTP intake adapters (`routes/query.js`, `routes/voice.js`).  
**Interface**:
- `executeNaturalLanguageQuery(params)`: returns `Promise<QueryOutcome>`
- `executeApprovedWrite(params)`: returns `Promise<QueryOutcome>`  
**Responsibility**: Encapsulates collection validation, schema context assembly, few-shot retrieval, ambiguity gating, MQL generation via LLM, safety AST validation, query execution against user DB, and post-execution telemetry/history recording. Transport-agnostic: has zero knowledge of Express, HTTP request/response objects, or status codes.

---

### `QueryOutcome`
**Type**: Tagged Union / Domain Result Object  
**Definition**: The explicit return value of query execution operations indicating one of:
- `success`: Query or write executed, results returned.
- `clarification_required`: Ambiguity gate paused execution, questions returned.
- `approval_required`: Potentially destructive write staged, approval token issued.
- `safety_blocked`: Operation blocked by AST safety rules.  
Mapped by HTTP adapters to status codes (`200`, `422`, etc.).

---

### `EngineErrors`
**Type**: Domain Error Classes  
**Definition**: Typed errors thrown across the engine seam for exceptional or unauthorized conditions. They live in `server/src/services/engineErrors.js`; `queryExecutor.UnsafePipelineError` is a separate family used by the guarded pipeline executor.

- `ValidationError`: Query string missing or over length limit, or `connectionId` missing (maps to 400).
- `ScopeError`: Requested collections do not belong to user DB (maps to 400).
- `TokenExpiredError`: Staged write approval token has passed TTL (maps to 401).
- `UnauthorizedTokenError`: Token connection identity does not match current session (maps to 403).
- `TokenAlreadyUsedError`: Token `jti` already recorded in database (maps to 409).
- `SafetyViolationError`: Operation fails AST safety policy (maps to 422).
- `RateLimitError`: Upstream LLM returned 429 (maps to 429 `rate_limited`).
- `ExecutionError`: Any other failure, including driver/SDK errors, which the engine wraps so their own status codes never leak (maps to 500).

---

### `NaturalLanguageQuery`
**Type**: Core Domain Value Object  
**Definition**: User-supplied query representation (text or transcribed audio) accompanied by tenant connection identity, optional collection constraints, and conversation clarification state.

---

### `Ambiguity Gate`
**Type**: Deep Module (in-process)  
**Location**: `server/src/services/ambiguityGate.js`  
**Interface**: `decide(input)` → `{ action: 'ask'|'proceed'|'reject', questions, queryForGeneration, clarifications, ... }`; `reviewModelQuestions(decision, llmResult, schema)`; `recordGeneration(decision)`.  
**Definition**: Decides before MQL generation whether to ask the user a clarification. Owns write-intent bypass, user bypass, clarification validation (schema-field allowlist against prompt injection), prompt enrichment, the deterministic vague-term check, and its metrics. After generation it only shows LLM-asked questions whose options are real schema fields. Building blocks are under `ambiguityGate.internals` for the gate's own tests.

---

### `Write Approval Token`
**Type**: Ephemeral Security Capability (JWT)  
**Definition**: A signed, time-limited, single-use token containing an intercepted mutating aggregation pipeline (`$out`, `$merge`, etc.) staged for Human-In-The-Loop explicit approval.

---

### `Effective Scope`
**Type**: Tenant Isolation Guard  
**Location**: `server/src/services/effectiveScope.js`
**Definition**: The verified subset of MongoDB collection names belonging to the user's active connection that are admissible for schema introspection and pipeline execution.
**Interface**: `resolve({ userDb, connectionId, collections, workspaceId, dropMissing })` → `{ collections, restricted, all, source, dropped }`; `requireKnownCollections(connectionId, names)` for saving workspaces.
**Rules**: a non-empty `collections` list wins, then a workspace, then all user collections (unrestricted). It fails closed: an unknown workspace throws `workspace_not_found`, a workspace whose collections are all gone throws `workspace_empty`; missing workspace collections are dropped and reported in `dropped`.

---

### `Few-Shot Memory`
**Type**: In-process / DB Store  
**Definition**: Historical repository of verified natural-language to MQL pipeline pairs retrieved dynamically to enrich LLM prompts, strictly scoped by `connectionId`.

---

### `ExperimentConfig`
**Type**: Seam (research)  
**Location**: `server/src/services/experiment.js`  
**Definition**: Optional object an in-process caller passes as `experiment` to `executeNaturalLanguageQuery` to change engine behaviour for offline evaluation (fixed DB, schema snapshot, gate mode/vague terms, model/temperature, LLM hooks for quota and JSON mode, `disableSafetyGuard`, diagnostics). HTTP routes never forward one, and no production module reads `EVAL_*` environment variables. Adapters: `PRODUCTION` (default, all off) and the evaluation harness on the `research/ambiguity-eval` branch.

---

### `Safe Execution`
**Type**: Invariant of `queryExecutor.executePipeline`  
**Definition**: Every pipeline run against a tenant DB passes `validateCollectionName` and `validatePipeline` (with the Effective Scope) inside `executePipeline`; it throws `UnsafePipelineError` otherwise. Write stages run only with `approvedWrite: true`, set by the Write Approval Token flow. Callers (engine, approve flow, dashboard refresh) cannot forget the check.

---

### `Tenant Store`
**Type**: Deep Modules (central DB)  
**Location**: `server/src/stores/` (`queryHistoryStore`, `dashboardStore`)  
**Definition**: The only code that touches the central `query_history` and `dashboards` collections. Every tenant operation requires a `connectionId` and filters on it; a missing one throws `TenantRequiredError` (fail closed) instead of widening the query to all tenants. `dashboardStore.getShared` returns the public projection (no `connectionId`).

---

### `Tenant Schema`
**Type**: Module  
**Location**: `server/src/services/tenantSchema.js`  
**Interface**: `getSchema(connectionId, { collections, forceRefresh })`, `getUserCollections(connectionId)`, `listUserCollections(db)`.  
**Definition**: What collections and fields a tenant has. The `connectionId` is the schema cache key, so tenants whose databases share a name never share a cache entry. Internal collections come from the single list in `server/src/db/systemCollections.js`.

---

### `Session`
**Type**: Module  
**Location**: `server/src/auth/session.js`  
**Definition**: Owns the `am_token` session cookie (name, options, 7-day TTL) and the Write Approval Token (sign/verify, `jti`, 10-minute TTL). `requireAuth`, the auth/connection routes and the engine use it; nothing else reads `JWT_SECRET` or sets the cookie.

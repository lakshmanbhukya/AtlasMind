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
**Definition**: Typed errors thrown across the engine seam for exceptional or unauthorized conditions:
- `ValidationError`: Query string missing or over length limit (maps to 400).
- `ScopeError`: Requested collections do not belong to user DB (maps to 400).
- `TokenExpiredError`: Staged write approval token has passed TTL (maps to 401).
- `UnauthorizedTokenError`: Token connection identity does not match current session (maps to 403).
- `TokenAlreadyUsedError`: Token `jti` already recorded in database (maps to 409).
- `SafetyViolationError`: Operation fails AST safety policy (maps to 422).
- `ExecutionError`: Target MongoDB execution failure (maps to 500).

---

### `NaturalLanguageQuery`
**Type**: Core Domain Value Object  
**Definition**: User-supplied query representation (text or transcribed audio) accompanied by tenant connection identity, optional collection constraints, and conversation clarification state.

---

### `Ambiguity Gate`
**Type**: Pre-Execution Interceptor  
**Definition**: Analyzes queries for vague terms, underspecified collection targets, or missing aggregation dimensions before sending to the MQL generator. Can pause query execution to request user clarifications.

---

### `Write Approval Token`
**Type**: Ephemeral Security Capability (JWT)  
**Definition**: A signed, time-limited, single-use token containing an intercepted mutating aggregation pipeline (`$out`, `$merge`, etc.) staged for Human-In-The-Loop explicit approval.

---

### `Effective Scope`
**Type**: Tenant Isolation Guard  
**Definition**: The verified subset of MongoDB collection names belonging to the user's active connection that are admissible for schema introspection and pipeline execution.

---

### `Few-Shot Memory`
**Type**: In-process / DB Store  
**Definition**: Historical repository of verified natural-language to MQL pipeline pairs retrieved dynamically to enrich LLM prompts, strictly scoped by `connectionId`.

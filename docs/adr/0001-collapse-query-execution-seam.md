# ADR 0001: Collapse Natural Language Query Execution Seam into Deep QueryExecutionEngine

## Status
Accepted

## Date
2026-10-29

## Context
In AtlasMind, natural language query orchestration leaked across the HTTP seam into route handlers:
1. `server/src/routes/voice.js` implemented an unmaintained duplicate zombie pipeline (~140 lines) that bypassed ambiguity gating, omitted multi-tenant collection scoping during few-shot retrieval, and failed to handle write-approval interceptions.
2. `server/src/routes/query.js` contained a fallback `try/catch` block that duplicated the legacy pipeline (~180 lines) whenever `queryPipelineService` threw an error, masking bugs and creating diverging behaviors.
3. Mutating write approvals (`/api/query/approve`) were validated and executed directly inside `server/src/routes/query.js`, binding database transactions, replay token indexes (`approval_tokens`), and history persistence directly to HTTP route handling.

This leakage severely undermined testability: unit testing query execution or write approval required spinning up Express instances or mocking HTTP request/response lifecycles.

## Decisions

### 1. Audio Ingestion at the Intake Adapter Seam
Audio transcription is explicitly kept outside the execution engine:
- The HTTP route adapter (`server/src/routes/voice.js`) handles multipart audio upload via `multer`, invokes `transcribeAudio(buffer, originalname)`, validates the resulting text, and hands the clean transcript to `QueryExecutionEngine.executeNaturalLanguageQuery(...)`.
- `QueryExecutionEngine` remains transport- and media-agnostic, accepting clean text with `source: 'voice'`.
- Unit tests for query execution do not require audio buffers or Whisper mocks.

### 2. Transport Decoupling & Typed Domain Outcomes
All HTTP transport concepts (`statusCode`, Express response envelopes) are removed from the engine core.
- `executeNaturalLanguageQuery` returns a typed `QueryOutcome` object:
  - `{ type: 'success', data: QueryExecutionResult }`
  - `{ type: 'clarification_required', data: ClarificationPrompt }`
  - `{ type: 'approval_required', data: StagedWritePayload, approvalToken: string }`
  - `{ type: 'safety_blocked', data: SafetyViolationDetails }`
- Domain errors are thrown as strongly-typed error classes:
  - `ValidationError` (maps to HTTP 400)
  - `ScopeError` (maps to HTTP 400)
  - `ExecutionError` (maps to HTTP 500)
- HTTP route adapters (`routes/query.js` and `routes/voice.js`) own mapping domain outcomes to HTTP status codes (`200`, `400`, `422`, `500`) and JSON envelopes.

### 3. Removal of Zombie Fallback Pipelines
The 180-line legacy fallback block in `server/src/routes/query.js` (lines 83–265) is completely eliminated.
- If `QueryExecutionEngine` encounters an unhandled exception, it fails fast and transparently propagates the failure.
- No silent fallback pipelines that hide engine regressions.

### 4. Write Approval Seam (`executeApprovedWrite`)
Mutating write validation and execution are moved inside `QueryExecutionEngine.executeApprovedWrite({ approvalToken, connectionId })`:
- Absorbs JWT decoding and expiration validation.
- Enforces single-use replay prevention via the `approval_tokens` MongoDB unique `jti` collection index.
- Validates connection ownership (`decoded.connectionId === connectionId`).
- Re-verifies AST safety rules (`validateCollectionName`, `validatePipeline`).
- Executes mutating pipeline against the user database and logs transaction history.
- Throws typed errors:
  - `TokenExpiredError` (maps to HTTP 401)
  - `TokenAlreadyUsedError` (maps to HTTP 409)
  - `UnauthorizedTokenError` (maps to HTTP 403)
  - `SafetyViolationError` (maps to HTTP 422)
- Allows testing write approval directly in unit tests without Express or Supertest.

### 5. Module Structure & Backwards Compatibility
- The deepened module is created at `server/src/services/queryExecutionEngine.js`.
- `server/src/services/queryPipelineService.js` is preserved as a backwards-compatible shim re-exporting the engine's functionality, ensuring existing evaluation scripts and tests continue to work.

### 6. Research Benchmarking (`evalOptions`) Preserved
- All evaluation switches (`disableGate`, `disableScope`, `disableSafetyGuard`, `fewShotLimit`, `model`, `temperature`) and diagnostic timing metrics (`diagnostics.timings`) are preserved inside `queryExecutionEngine.js`.
- Voice queries run with production defaults (`source: 'voice'`).

## Consequences

### Positive
- **Locality**: 100% of query processing, scoping, ambiguity gating, LLM translation, safety validation, database execution, and write authorization concentrate in one deep module.
- **Leverage**: Text queries and voice queries share identical tenant scoping, ambiguity gating, and write protection.
- **High Testability**: Core query and write approval workflows can be tested directly in Node/Jest without Express, Supertest, or HTTP server setups.
- **Code Deletion**: Over 280 lines of duplicate zombie pipeline code eliminated across `routes/query.js` and `routes/voice.js`.

### Trade-offs
- Route handlers must maintain explicit mapping from typed domain outcomes/errors to HTTP responses, but this mapping is concise (~10 lines per route).

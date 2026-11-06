# Spec: Collapse Natural Language Query Execution Seam

## Problem Statement

When using AtlasMind to query MongoDB databases, users experience severe behavioral inconsistencies between voice-based and text-based natural language queries. 

Voice queries silently bypass ambiguity detection, meaning that under-specified or vague voice queries produce arbitrary or incorrect MongoDB queries instead of asking clarifying questions. Furthermore, voice queries lack multi-tenant collection scoping during few-shot retrieval and cannot handle mutating write operations with human-in-the-loop safety approvals.

Behind the scenes, the application maintains two diverging copies of the query execution pipeline, totaling nearly 300 lines of duplicate orchestration code across HTTP route handlers. An unmaintained fallback in the text query endpoint silently hides engine failures by dropping down to an outdated legacy pipeline. Furthermore, testing query orchestration and write approvals currently forces developers to spin up complete Express HTTP test instances with Supertest mocks, slowing down regression feedback loops.

## Solution

Collapse all natural language query orchestration, tenant scoping, ambiguity gating, safety validation, database execution, telemetry logging, and mutating write approvals into a single, unified deep module: `QueryExecutionEngine`.

Both text and voice interfaces will route through this single engine. Voice input will be transcribed at the intake adapter and passed directly into the engine as clean text, ensuring voice queries inherit the exact same ambiguity detection, multi-tenant isolation, and human-in-the-loop write approval capabilities as text queries. All HTTP route handlers will become thin adapters that only extract HTTP parameters and translate domain outcomes into standard HTTP responses. The legacy fallback block will be completely eliminated so engine failures fail fast and transparently.

## User Stories

1. As an analyst speaking voice queries, I want vague voice queries to trigger clarifying questions, so that I am not returned misleading data due to unaddressed ambiguity.
2. As an analyst speaking voice queries, I want my voice queries to adhere to my workspace collection scoping, so that the AI does not reference unauthorized or irrelevant collections in my database.
3. As an analyst speaking voice queries, I want few-shot retrieval for my voice queries to be strictly scoped to my active database connection, so that proprietary query history from other tenants is never used in my AI prompts.
4. As an analyst issuing queries by voice that result in database write operations, I want the system to intercept the mutating query and return a secure approval token, so that I can review and confirm write operations before they alter my database.
5. As an analyst entering text queries, I want clear and non-ambiguous queries to execute directly against my database and return results with execution timings, so that I can analyze my data without unnecessary friction.
6. As an analyst entering text queries with vague terminology, I want the system to pause execution and present structured clarification choices, so that I can choose the exact dimension or metric I intended.
7. As an analyst entering text queries that attempt mutating operations (such as `$out` or `$merge`), I want the query to be intercepted and staged with a 10-minute single-use approval token, so that destructive changes require explicit authorization.
8. As a security-conscious administrator, I want write approval tokens to be single-use and tamper-proof, so that an approval token cannot be replayed or hijacked across different database connections.
9. As a security-conscious administrator, I want write approval execution to re-verify collection and pipeline safety rules before applying changes to the database, so that modified or out-of-scope payloads are rejected even if signed.
10. As a backend developer, I want all natural language query logic to live in a single deep engine module, so that bug fixes and performance improvements instantly benefit both text and voice interfaces.
11. As a backend developer, I want the query execution engine to return typed domain outcomes rather than HTTP status codes, so that the core domain logic remains decoupled from Express and HTTP transport mechanics.
12. As a backend developer, I want the legacy try/catch fallback in the text query route to be removed, so that bugs in the engine are surfaced immediately rather than masked by silent fallback to an unmaintained pipeline.
13. As a test engineer, I want to execute end-to-end query processing and write approval tests directly through the engine interface in Node/Jest, so that test suites run with high velocity without spinning up Express servers or HTTP mocks.
14. As an AI evaluation researcher, I want all research benchmark evaluation switches (such as disabling ambiguity gates, custom models, and timing collectors) to remain functional in the unified engine, so that scientific benchmark experiments continue without regressions.
15. As a frontend client developer, I want the JSON response schemas for `/api/query`, `/api/voice`, and `/api/query/approve` to remain fully backwards-compatible, so that no user-facing UI changes or breaking client changes are required.

## Implementation Decisions

### 1. Modules Built and Modified
- **`QueryExecutionEngine` (New Deep Module)**: Implements the central business logic for executing natural language queries and executing approved mutating writes. Takes no dependencies on Express, HTTP request/response objects, or transport status codes.
- **`QueryPipelineService` (Backwards-Compatibility Shim)**: Preserves existing external function signatures (`processNaturalLanguageQuery`) by delegating to `QueryExecutionEngine`, ensuring non-breaking compatibility with existing tests and scripts.
- **`QueryRoute` (Thin HTTP Adapter)**: Stripped of all inline pipeline execution, fallbacks, and inline write approvals. Reduced to parameter validation, engine invocation, and domain outcome translation.
- **`VoiceRoute` (Thin HTTP Adapter)**: Stripped of its 140-line duplicate pipeline. Handles audio upload and speech-to-text transcription via Whisper, then delegates normalized text directly to `QueryExecutionEngine`.

### 2. Interface Contracts
The `QueryExecutionEngine` presents exactly two public domain methods:

- `executeNaturalLanguageQuery(context, input)`:
  - **Inputs**: `connectionId` (required), `text` (required), `source` (`'query'` or `'voice'`), optional `collections`, `workspaceId`, `dropMissing`, `model`, `clarifications`, `bypassAmbiguity`, and `evalOptions`.
  - **Returns**: A tagged domain outcome union:
    - `{ type: 'success', data: QueryExecutionResult }`
    - `{ type: 'clarification_required', data: ClarificationPrompt }`
    - `{ type: 'approval_required', data: StagedWritePayload, approvalToken: string }`
    - `{ type: 'safety_blocked', data: SafetyViolationDetails }`
  - **Throws**: Typed domain errors: `ValidationError`, `ScopeError`, `ExecutionError`.

- `executeApprovedWrite(context, input)`:
  - **Inputs**: `connectionId` (required), `approvalToken` (required).
  - **Returns**: `{ type: 'success', data: ApprovedWriteExecutionResult }`
  - **Throws**: Typed domain errors:
    - `TokenExpiredError` (token past TTL)
    - `TokenAlreadyUsedError` (token JTI already consumed)
    - `UnauthorizedTokenError` (token connection does not match caller session)
    - `SafetyViolationError` (safety AST check failed on approved pipeline)
    - `ExecutionError` (database execution failure)

### 3. HTTP Adapter Status Code Mapping
The HTTP route adapters translate domain outcomes and errors deterministically:
- `outcome.type === 'success'` → HTTP `200`
- `outcome.type === 'clarification_required'` → HTTP `200` with `{ success: true, needsClarification: true, ... }`
- `outcome.type === 'approval_required'` → HTTP `200` with `{ success: true, safetyStatus: 'approval-required', ... }`
- `outcome.type === 'safety_blocked'` → HTTP `422` with `{ success: false, error: { code: 'safety_violation', ... } }`
- `ValidationError` / `ScopeError` → HTTP `400`
- `TokenExpiredError` → HTTP `401`
- `UnauthorizedTokenError` → HTTP `403`
- `TokenAlreadyUsedError` → HTTP `409`
- `SafetyViolationError` → HTTP `422`
- `ExecutionError` → HTTP `500`

### 4. Replay Prevention & Re-Validation
The engine encapsulates the atomic consumption of approval tokens by inserting the token's unique identifier (`jti`) into the central database's `approval_tokens` collection with a unique index. Staged pipelines must be re-validated through the safety guard before execution against the target user database.

## Testing Decisions

### What Makes a Good Test
- Tests must assert on observable outcomes and return values across the `QueryExecutionEngine` public interface, never probing private intermediate state.
- Old unit tests that relied on spinning up Express apps with Supertest just to exercise query approval or execution logic should be replaced with direct engine interface tests.
- Tests must verify behavioral equivalence between text queries and voice queries passing identical text.

### Modules Tested
- **`QueryExecutionEngine` Interface Tests**:
  - Valid queries producing successful MQL generation and aggregation execution.
  - Vague queries triggering clarification outcomes.
  - Mutating operations triggering approval-required outcomes with signed tokens.
  - Write execution consuming tokens, preventing replay attacks, and executing mutating pipelines.
  - Invalid collection scopes and missing query text throwing appropriate typed errors.
- **Route Adapters Smoke Tests**:
  - Validating that `POST /api/query`, `POST /api/voice`, and `POST /api/query/approve` correctly map domain outcomes and typed errors to expected HTTP status codes.

### Prior Art in Codebase
- `server/src/__tests__/queryPipelineService.test.js`: Provides established mocks for `getUserDb`, `schemaProfiler`, `fewShotRetriever`, `groqService`, and `safetyGuard`.
- `server/src/__tests__/queryApprove.test.js`: Documents the security invariants for approval token expiration, connection ownership matching, and replay protection.

## Out of Scope
- Modifying client-side UI components or frontend state management.
- Modifying Whisper transcription algorithms or supported audio file formats in `groqService`.
- Re-architecting the central database schema or the query history document structure.
- Migrating query history storage into a separate module (covered separately in Candidate 3).

## Further Notes
- This refactor directly fulfills **Candidate 1** from the architectural hotspot review report.
- Deleting the fallback pipeline removes 180 lines of dead code from the text route and 140 lines from the voice route, yielding a net deletion of over 280 lines of duplicate orchestration code.

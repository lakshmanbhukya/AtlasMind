# AtlasMind Technical Architecture & Design

AtlasMind is an intelligent Natural Language to MongoDB Aggregation Pipeline (NL-to-MQL) execution platform. It transforms plain English and voice prompts into production-grade, read-only MongoDB aggregation pipelines with automated schema grounding, deterministic ambiguity detection, dynamic workspace scoping, AST safety enforcement, cryptographic Human-in-the-Loop (HITL) write verification, and isolated multi-tenant execution pools.

---

## 1. High-Level Architecture Overview

AtlasMind enforces strict separation of concerns across six distinct architectural tiers:

1. **Client Tier**: Modern React 19 SPA featuring an interactive Clarification UI (`ClarificationTurn`), dynamic Scope Expansion (`ScopeTurn`), cryptographic HITL approval cards, chat streaming, chart visualizers, and workspace scope selectors.
2. **API Gateway & Routing Tier**: Express 4 server providing cookie-authenticated session management, workspace header resolution, and IP rate limiting.
3. **Prompt Grounding & Ambiguity Tier**: Per-connection schema cache profiler, deterministic & LLM ambiguity detection gate, workspace collection scoper, and connection-isolated few-shot vector retriever.
4. **AI Inference Tier**: High-throughput Groq LPU running dual-mode system prompts on DeepSeek / Llama 3.3 models alongside Whisper Large v3 Turbo audio transcription.
5. **Safety & Execution Tier**: Strict Abstract Syntax Tree (AST) pipeline validator, automatic `$limit` injection, cryptographic HITL write approval signer, and isolated `userDbPool` client connection manager.
6. **Storage Tier**: Strict physical separation between the AtlasMind Application Metadata Database (sessions, history, workspaces, dashboard pins) and external User Target Databases.

```mermaid
flowchart TD
    subgraph Client["Client Tier (React 19 SPA :5173)"]
        UI["AtlasMind UI (React 19)"]
        CC["ClarificationTurn (Ambiguity)"]
        SC["ScopeTurn (Scope Expansion)"]
        AC["HITL Write Approval Card"]
        WS["Workspace & Scope Selector"]
        API_C["API Client (Axios + Credentials)"]
        UI --> CC
        UI --> SC
        UI --> AC
        UI --> WS
        UI --> API_C
    end

    subgraph Gateway["API Gateway Tier (:3001)"]
        GW["Express API Gateway"]
        AUTH["Auth & Session Middleware"]
        RL["Rate Limiters (Auth & API)"]
        WS_MW["Workspace Scope Middleware"]
        ROUTER_Q["POST /api/query (Thin Route Adapter)"]
        ROUTER_V["POST /api/voice (Audio Intake Adapter)"]
        ROUTER_A["POST /api/query/approve (Approval Adapter)"]
        API_C -->|HTTPS + Cookie| GW
        GW --> AUTH
        GW --> RL
        GW --> WS_MW
        WS_MW --> ROUTER_Q
        WS_MW --> ROUTER_V
        WS_MW --> ROUTER_A
    end

    subgraph EngineTier["Deep Engine Tier (QueryExecutionEngine)"]
        ENGINE["QueryExecutionEngine Core\n(executeNaturalLanguageQuery / executeApprovedWrite)"]
        ROUTER_Q -->|"executeNaturalLanguageQuery(text, source: 'query')"| ENGINE
        ROUTER_V -->|"executeNaturalLanguageQuery(text, source: 'voice')"| ENGINE
        ROUTER_A -->|"executeApprovedWrite(approvalToken, connectionId)"| ENGINE
    end

    subgraph Grounding["Prompt Grounding & Ambiguity Tier"]
        AG["Ambiguity Gate (Deterministic & LLM)"]
        SP["Schema Profiler (Per-Connection Cache)"]
        FS["Few-Shot Matcher (Connection-Scoped)"]
        SS["Scope Suggestion Engine"]
        ENGINE <--> AG
        AG <--> SP
        AG <--> FS
        WS_MW --> SS
    end

    subgraph Inference["AI Inference Tier (Groq LPU)"]
        GROQ["Groq LLM Service (DeepSeek/Llama 3.3)"]
        WHISPER["Groq Whisper STT (Large v3 Turbo)"]
        PROMPT["Dual-Mode System Prompt"]
        ENGINE -->|Dual-Mode Prompt| GROQ
        ROUTER_V -.->|Audio Buffer| WHISPER
        WHISPER -.->|Clean Transcript| ROUTER_V
        GROQ --- PROMPT
    end

    subgraph Safety["Safety & Query Execution Tier"]
        SG["Safety Guard (AST Inspector & Write Detector)"]
        HITL_SIGN["HITL JWT Signer (10m TTL Approval)"]
        REPLAY["Atomic JTI Replay Prevention (approval_tokens)"]
        QE["Query Executor"]
        POOL["userDbPool Connection Manager"]
        GROQ -->|Raw MQL AST| SG
        SG -->|Mutating Write| HITL_SIGN
        SG -->|Safe Read-Only Pipeline| QE
        HITL_SIGN -.->|approvalToken| ENGINE
        ENGINE --> REPLAY
        QE <--> POOL
    end

    subgraph Storage["Storage Tier (Dual MongoDB Model)"]
        APP_DB[("AtlasMind Metadata DB\n(Connections, Workspaces, Pins, History, approval_tokens)")]
        USER_DB[("User Target Database\n(Analytics Target Collections)")]
        CLEANUP["Cleanup Cron (30-day History TTL)"]
        REPLAY <--> APP_DB
        GW <--> APP_DB
        CLEANUP --> APP_DB
        POOL <--> USER_DB
        SP -.->|Sample Schema| USER_DB
    end
```

---

## 2. End-to-End Query Lifecycles

### 2.1 Ambiguity Detection & Disambiguation Lifecycle

When a natural language query is submitted, AtlasMind executes an ambiguity-aware pipeline to guarantee that underspecified metrics (e.g., *"top sales"*, *"best customers"*, or *"growth"*) are never evaluated based on arbitrary LLM hallucinations.

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant Frontend as React UI (ClarificationTurn)
    participant Gateway as Express Gateway (/api/query)
    participant Engine as QueryExecutionEngine
    participant Ambiguity as Ambiguity Gate
    participant Schema as Schema Profiler
    participant Groq as Groq LPU (DeepSeek/Llama)
    participant Safety as Safety Guard
    participant Pool as userDbPool
    participant UserDB as User Database

    %% Pass 1: Submission
    User->>Frontend: Enter vague query: "Show top sales"
    Frontend->>Gateway: POST /api/query { text, connectionId }
    Gateway->>Engine: executeNaturalLanguageQuery({ text, connectionId })
    Engine->>Schema: profileSchema(connectionId)
    Schema-->>Engine: Cached collection & numeric fields
    Engine->>Ambiguity: checkDeterministicAmbiguity("Show top sales", schema)
    
    alt Deterministic Ambiguity Detected (2+ candidate metrics)
        Ambiguity-->>Engine: { needsClarification: true, questions: [...] }
        Engine-->>Gateway: { type: "clarification_required", data }
        Gateway-->>Frontend: HTTP 200 { needsClarification: true, questions: [...] }
        Frontend-->>User: Render ClarificationTurn (Pills: sales_amount, quantity, profit)
    else Clear Query or Single Metric
        Engine->>Groq: generateMQL(query, schema, examples, { isClarificationPass: false })
        Groq-->>Engine: Direct MQL output
    end

    %% Pass 2: Clarification Response
    User->>Frontend: Selects "sales_amount" and clicks Continue
    Frontend->>Gateway: POST /api/query { text, clarifications: [{ id: "metric", value: "sales_amount" }], bypassAmbiguity: true }
    Gateway->>Engine: executeNaturalLanguageQuery(clarifications)
    Engine->>Ambiguity: validateClarifications(clarifications, schema)
    Note over Ambiguity: Anti-Injection Verification:<br/>Validates values exist in real schema
    Ambiguity-->>Engine: { valid: true, sanitized: [...] }
    Engine->>Ambiguity: buildEnrichedQuery(text, sanitized)
    Engine->>Groq: generateMQL(enrichedQuery, schema, examples, { isClarificationPass: true })
    Groq-->>Engine: Final MQL Pipeline: [{ $group: ... }, { $sort: ... }, { $limit: ... }]
    
    %% Execution
    Engine->>Safety: validatePipeline(pipeline)
    Note over Safety: Blocks write operators, injects limit cap
    Safety-->>Engine: { safe: true, pipeline: validatedPipeline }
    Engine->>Pool: getUserDb(connectionId)
    Pool-->>Engine: Cached MongoClient db instance
    Engine->>UserDB: db.collection.aggregate(validatedPipeline)
    UserDB-->>Engine: Query results (BSON -> JSON)
    Engine-->>Gateway: { type: "success", data }
    Gateway-->>Frontend: HTTP 200 { results, pipeline, chartType, explanation }
    Frontend-->>User: Render Interactive Chart & Results Table
```

---

### 2.2 Cryptographic Human-in-the-Loop (HITL) Write Interception Lifecycle

AtlasMind treats data modification with zero-trust rigor. Any natural language command implying a write, update, or deletion triggers a cryptographic two-phase verification process:

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant Frontend as React UI (HITL Card)
    participant Gateway as Express Gateway (/api/query)
    participant Engine as QueryExecutionEngine
    participant Safety as Safety Guard
    participant CentralDB as Central DB (approval_tokens)
    participant Pool as userDbPool
    participant UserDB as User Database

    User->>Frontend: "Delete inactive accounts from customers"
    Frontend->>Gateway: POST /api/query { text }
    Gateway->>Engine: executeNaturalLanguageQuery({ text, connectionId })
    Engine->>Safety: validatePipeline(pipeline)
    Note over Safety: Detects mutating write operation (isWrite: true)
    Safety-->>Engine: { safe: false, isWrite: true, collection: "customers" }
    
    Note over Engine: Cryptographic Signing:<br/>Signs JWT approvalToken (10-minute TTL)<br/>containing connectionId, collection, and MQL payload
    Engine-->>Gateway: { type: "approval_required", approvalToken, data }
    Gateway-->>Frontend: HTTP 200 { safetyStatus: "approval-required", approvalToken, pipeline }
    Frontend-->>User: Renders amber HITL Approval Card with MQL Diff & Confirm button

    User->>Frontend: Clicks "Approve & Execute"
    Frontend->>Gateway: POST /api/query/approve { approvalToken }
    Gateway->>Engine: executeApprovedWrite({ approvalToken, connectionId })
    Note over Engine: Cryptographic & Replay Verification:<br/>1. Verifies JWT signature & expiration<br/>2. Validates connectionId matches active session<br/>3. Re-classifies the pipeline with the token's scope and the tenant DB name (must be needs_approval)<br/>4. Inserts unique jti into approval_tokens (prevents replay)
    Engine->>Pool: getUserDb(connectionId)
    Engine->>CentralDB: insertOne({ jti, connectionId, usedAt, expiresAt })
    Engine->>UserDB: Execute mutation transaction
    UserDB-->>Engine: { acknowledged: true, deletedCount: 14 }
    Engine-->>Gateway: { type: "success", data: { safetyStatus: "write-executed", ... } }
    Gateway-->>Frontend: HTTP 200 { success: true, result: [...] }
    Frontend-->>User: Displays green Success Confirmation & Execution Audit
```

---

### 2.3 Dynamic Scope Expansion & Fallback Protocol

When users restrict their active workspace to specific collections (e.g., `["orders"]`), queries referencing cross-collection context (e.g., *"Show orders with customer email addresses"*) are gracefully resolved via inline scope expansion:

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant Frontend as React UI (ScopeTurn)
    participant Gateway as Express Gateway (/api/query)
    participant Engine as QueryExecutionEngine
    participant Safety as Safety Guard

    User->>Frontend: "Join orders with customer names" (Active scope: ["orders"])
    Frontend->>Gateway: POST /api/query { text, collections: ["orders"] }
    Gateway->>Engine: executeNaturalLanguageQuery({ text, collections: ["orders"] })
    Engine->>Safety: validatePipeline(pipeline, { allowedCollections: ["orders"] })
    Safety-->>Engine: { safe: false, code: "scope_violation", violatingCollections: ["customers"] }
    Engine-->>Gateway: { type: "success", data: { safetyStatus: "scope-insufficient", suggestedCollections: ["customers"] } }
    Gateway-->>Frontend: HTTP 200 { safetyStatus: "scope-insufficient", suggestedCollections: ["customers"] }
    Frontend-->>User: Renders ScopeTurn ("Scope Expansion Required")
    
    alt User clicks "Add & Re-run"
        User->>Frontend: Adds "customers" to workspace
        Frontend->>Gateway: POST /api/query { text, collections: ["orders", "customers"] }
        Gateway-->>Frontend: Pipeline executes across expanded scope
    else User clicks "Run Across All Collections"
        User->>Frontend: Unrestricts scope
        Frontend->>Gateway: POST /api/query { text, collections: [] }
        Gateway-->>Frontend: Pipeline executes across full database
    end
```

---

## 3. Subsystem Breakdown & Implementation Details

### 3.1 Deep Query Execution Engine (`server/src/services/queryExecutionEngine.js`)
The central deep domain engine for AtlasMind:
- **Unified Domain Core**: Replaces legacy duplicate orchestration across HTTP routes. Powers both text (`POST /api/query`) and voice (`POST /api/voice`) through a single transport-agnostic interface:
  - `executeNaturalLanguageQuery(context, input)`: Complete natural language query lifecycle returning typed domain outcomes (`success`, `clarification_required`, `approval_required`, `safety_blocked`).
  - `executeApprovedWrite(context, input)`: Encapsulated Human-in-the-Loop mutating write validation, single-use `jti` replay prevention, and database execution.
- **Strongly-Typed Domain Errors**: Throws deterministic domain error classes (`ValidationError`, `ScopeError`, `TokenExpiredError`, `UnauthorizedTokenError`, `TokenAlreadyUsedError`, `SafetyViolationError`, `ExecutionError`) mapped to HTTP status codes by thin route adapters.
- **Phased Pipeline Stages**:
  1. Connection pool acquisition (`userDbPool`).
  2. Workspace collection scope resolution and schema filtering.
  3. Parallel schema profiling (`schemaProfiler`) and isolated few-shot example lookup (`fewShotRetriever`).
  4. Ambiguity Gate deterministic check and prompt enrichment.
  5. Groq LPU dual-mode LLM generation.
  6. Scope insufficiency and missing collection interception.
  7. AST safety validation and write interception.
  8. MongoDB aggregation execution with timeout cap.
  9. Telemetry recording and persistent query history save.

### 3.2 Ambiguity Gate Service (`server/src/services/ambiguityGate.js`)
Protects against hallucinated business logic:
- **Deterministic Check**: Evaluates vague terms against a curated dictionary (`top`, `best`, `highest`, `lowest`, `recent`, `growth`, `popular`, etc.). Clarification triggers immediately if two or more numeric field candidates exist across active collections.
- **Anti-Injection Validator (`validateClarifications`)**: Ensures clarification choices from the client match real schema fields. Discards hallucinated or malicious string injections.
- **Telemetry Observability Engine**: Records granular events (`ambiguity_asked`, `ambiguity_skipped`, `ambiguity_resolved`, `ambiguity_bypassed`, `clarification_edit`) to calculate empirical KPIs (Ask Rate, Resolution Rate, Edit-after-Result Rate).

### 3.3 Cryptographic Human-in-the-Loop Write Guard (`QueryExecutionEngine.executeApprovedWrite`)
- **Mutating Write Interception**: The Safe Execution verdict (`classifyExecution`, ADR 0004) decides. Only a pipeline whose single final top-level stage is `$out` or `$merge`, whose other stages pass every read check, and whose write target is in the connected database, not protected, and inside a restricted scope, is intercepted for approval (`needs_approval`). Write stages elsewhere and mutating operators (`$deleteMany`, `$updateMany`, `$insertOne`, ...) are blocked.
- **Signed Approval Tokens**: Generates an HMAC-SHA256 signed JWT (`approvalToken`) with a 10-minute expiration containing `jti` (UUID), `connectionId`, `collection`, `pipeline`, and `scope` (`null` when the scope is unrestricted).
- **Atomic Replay Prevention**: Write execution atomically inserts the token's `jti` into the central database's `approval_tokens` unique collection index. Duplicate submissions fail fast with `TokenAlreadyUsedError` (HTTP 409).
- **Execution Endpoint (`POST /api/query/approve`)**: Thin route adapter delegating directly to `QueryExecutionEngine.executeApprovedWrite`. Validates connection ownership, re-classifies the pipeline with the token's scope (anything other than `needs_approval` is a 422) before spending the `jti`, and applies the write to the user database.

### 3.4 Dynamic Workspace Scoping & Suggestion (`server/src/routes/workspaces.js`, `server/src/routes/scopeSuggest.js`)
- **Workspace Scoping**: Restricts query context to curated collection subsets, reducing LLM prompt size and preventing cross-domain confusion.
- **Scope Insufficient Handling**: When an MQL pipeline requires unselected collections, the system returns `safetyStatus: 'scope-insufficient'` and prompts users via `ScopeTurn`.
- **Dynamic Scope Discovery (`scopeSuggest.js`)**: Uses semantic clustering to recommend optimal workspace groupings (e.g., *Billing & Invoices*, *User Engagement*, *Catalog & Inventory*).

### 3.5 Schema Profiler & Isolated Caching (`server/src/services/schemaProfiler.js`)
- **Per-Connection Caching**: Caches schema definitions keyed by `connectionId || db.databaseName` with a 5-minute TTL.
- **Document Sampling**: Inspects up to 10 representative documents per collection to infer data types and nested fields without full collection scans.
- **Internal Collection Exclusion**: Excludes system collections (`system.*`) and AtlasMind metadata collections (`connections`, `dashboards`, `query_history`, `workspaces`, `few_shot_examples`).

### 3.6 Connection-Isolated Few-Shot Retriever (`server/src/services/fewShotRetriever.js`)
- **Hybrid Search**: Combines Atlas Vector Search (cosine similarity) with text regex fallbacks.
- **Strict Tenant Isolation**: All retrievals enforce `{ connectionId }` filtering. No query example from Database A is ever exposed to Database B.

### 3.7 Dual-Mode AI Inference Engine (`server/src/services/groqService.js`)
- **Two-Mode Prompting**:
  - *Pass 1 (Exploration)*: Model may return `{ needsClarification: true, questions: [...] }` or final MQL.
  - *Pass 2 (Execution)*: Clarification mode is disabled; model must output a valid MQL pipeline.
- **Multimodal STT (Whisper Large v3 Turbo)**: Transcribes audio buffers at the `POST /api/voice` intake boundary and hands normalized transcripts to `QueryExecutionEngine` with `source: 'voice'`.

### 3.8 AST Safety Guard (`server/src/services/safetyGuard.js`)
- `classifyExecution` returns one verdict per `(collection, pipeline, Effective Scope, tenant database)`: `runnable`, `needs_approval`, `scope_insufficient` or `blocked` (ADR 0004).
- Enforces a stage allowlist recursively (`$facet`, `$lookup.pipeline`, `$unionWith.pipeline`); hard-denies `$function`, `$accumulator`, `$where`.
- Blocks protected collections and any explicit `db` other than the connected database, in reads and write targets.
- `$out` / `$merge` are approvable only as the single final top-level stage; a `$merge.whenMatched` pipeline is blocked.
- Automatic limit clamping: appends a `$limit: 1000` stage to a runnable read that has none.

### 3.9 Connection Pool Manager (`server/src/services/userDbPool.js`)
- Maintains an LRU cache of `MongoClient` instances mapped by encrypted `connectionId`.
- Features connection reuse, pool caps (`maxPoolSize: 10`), and idle connection eviction (`maxIdleTimeMS: 30000`).

### 3.10 Storage Separation & Retention Service (`server/src/services/cleanupService.js`)
- Dual database model: Application metadata and user analytics databases are physically decoupled.
- Background cron runs daily to purge transient playground history older than 30 days. Pinned widgets and verified few-shot examples are permanently retained.

---

## 4. Component Matrix

| Layer | Component | Implementation | Primary Responsibility |
|---|---|---|---|
| **Frontend** | Application Shell | React 19, Vite, Tailwind CSS | UI orchestration, state management, layout |
| **Frontend** | Clarification Turn | `app/ClarificationTurn.jsx` | Disambiguation pills, custom metric inputs |
| **Frontend** | Scope Turn | `app/ScopeTurn.jsx` | Scope expansion prompts and re-runs |
| **Frontend** | HITL Approval Turn | `app/ApprovalTurn.jsx` | 2-step write verification modal |
| **Frontend** | Scope Picker & Workspaces | `app/ComposerPickers.jsx`, `app/WorkspacesDialog.jsx` | Active collection scoping & switching |
| **Frontend** | Visualizations | Recharts (`ChartRenderer.jsx`) | Interactive Bar, Line, Area, Pie, Radar charts |
| **Frontend** | Voice Input | `app/Composer.jsx`, `useVoice.js` | MediaRecorder WebM audio streaming |
| **Backend** | Query Route Adapter | `routes/query.js` | Thin HTTP adapter for `/api/query` and `/api/query/approve` |
| **Backend** | Voice Route Adapter | `routes/voice.js` | Audio intake boundary & Whisper transcription adapter |
| **Backend** | Deep Query Engine | `queryExecutionEngine.js` | Unified deep domain execution & write approval |
| **Backend** | Ambiguity Gate | `ambiguityGate.js` | Deterministic checks, prompt injection defense |
| **Backend** | Schema Profiler | `schemaProfiler.js` | Per-connection schema cache and document sampler |
| **Backend** | Few-Shot Matcher | `fewShotRetriever.js` | Connection-isolated vector memory |
| **Backend** | Safety Guard | `safetyGuard.js` | AST inspection, write detection, limit cap |
| **Backend** | AI & STT | `groqService.js` | DeepSeek/Llama 3.3 MQL & Whisper transcription |
| **Backend** | Connection Pool | `userDbPool.js` | Dynamic MongoClient pooling & LRU eviction |
| **Backend** | Auto-Cleaner | `cleanupService.js` | 30-day playground history TTL cron |

---

## 5. Security & Isolation Guarantees

1. **Zero Data Co-mingling**: User analytics databases are never co-located with AtlasMind application metadata.
2. **Cryptographic HITL Write Approval**: Destructive actions cannot execute without a signed, 10-minute JWT approved by the user.
3. **Tenant-Isolated Prompt Context**: Schema caches and few-shot memories are strictly isolated by `connectionId`.
4. **Anti-Injection Schema Whitelisting**: User inputs in clarification cards are validated against live schema ASTs before LLM prompt injection.
5. **AST Guard-First Execution**: Aggregation pipelines are parsed as JSON ASTs and vetted before execution against MongoDB driver instances.

---

*For detailed API contracts and endpoint payloads, see [API Documentation](./API.md).*
*For empirical benchmark metrics and regression evaluation, see [Ambiguity Research Report](./AMBIGUITY_RESEARCH_EVALUATION.md).*

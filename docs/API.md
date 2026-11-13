# AtlasMind REST API Specification

AtlasMind exposes a cookie-authenticated REST API for database connection management, natural language analytics, schema profiling, ambiguity resolution, workspace scoping, cryptographic Human-in-the-Loop write approvals, voice queries, and collaborative dashboards.

**Base Path**: `/api`

---

## 1. Authentication & Session

Session authentication uses an `httpOnly` secure cookie named `am_token`. Protected endpoints require this cookie and must be called with credentials enabled on the client (`credentials: 'include'`).

### POST `/api/connections/connect`
Validates a MongoDB connection string + database name, stores encrypted credentials in the AtlasMind metadata database, and issues the `am_token` session cookie.

**Request Body**:
```json
{
  "connectionString": "mongodb+srv://user:pass@cluster.mongodb.net",
  "dbName": "sample_analytics",
  "label": "Production Analytics"
}
```

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "dbName": "sample_analytics",
  "label": "Production Analytics",
  "collectionCount": 4,
  "collections": ["orders", "customers", "products", "events"],
  "message": "Connected! Found 4 collections in \"sample_analytics\"."
}
```

### POST `/api/connections/databases` *(Public - auth rate limiter)*
Lists the non-empty databases a connection string can see, so the landing page can offer them before connecting. Internal databases (`admin`, `local`, `config`) and `system.*` collections are skipped. Nothing is stored and no session cookie is issued. If the user lacks the `listDatabases` privilege the list is empty.

**Request Body**:
```json
{ "connectionString": "mongodb+srv://user:pass@cluster.mongodb.net" }
```

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "databases": [
    { "name": "analytics_prod", "collectionCount": 12 },
    { "name": "inventory", "collectionCount": 9 }
  ]
}
```

**Errors**: `400` for a malformed connection string or an unreachable cluster, `500` otherwise.

### GET `/api/auth/me`
Validates the current session cookie and returns active connection metadata.

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "connectionId": "65f3a9e1d8...",
  "dbName": "sample_analytics",
  "label": "Production Analytics",
  "lastConnectedAt": "2026-10-07T12:00:00.000Z"
}
```

### POST `/api/auth/logout`
Clears the `am_token` session cookie.

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "message": "Logged out"
}
```

---

## 2. Health & Status

### GET `/api/health`
Returns gateway status, uptime, and server timestamp. (Public endpoint)

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "status": "ok",
  "timestamp": "2026-10-07T12:00:00.000Z",
  "uptime": 1824.12
}
```

---

## 3. Query Execution, Ambiguity & Scope API

All query endpoints below are protected (require `am_token` cookie).

### POST `/api/query`
The primary query execution endpoint. Implements dual-pass ambiguity detection, collection scoping, AST safety verification, and aggregation execution.

#### A. Initial Request (Standard or Ambiguous NL Query)
```json
{
  "text": "get the top sales",
  "model": "openai/gpt-oss-120b",
  "collections": ["orders", "customers"],
  "workspaceId": "66f4..."
}
```

**Scope resolution** (Effective Scope): a non-empty `collections` array wins (unknown names are rejected, or dropped when `dropMissing` or a `workspaceId` is set). Otherwise `workspaceId` restricts the query to that workspace's collections; collections that no longer exist are dropped. With neither, every user collection is in scope. An unknown workspace (`workspace_not_found`) or one with no remaining collections (`workspace_empty`) is an error, never a widening to all collections.

#### B. Clarification Response (HTTP 200)
When the Ambiguity Gate detects underspecified metrics (2+ candidate schema fields):
```json
{
  "success": true,
  "needsClarification": true,
  "naturalLanguage": "get the top sales",
  "questions": [
    {
      "id": "metric",
      "question": "Which metric best represents what you mean by this query?",
      "type": "single",
      "options": [
        { "value": "sales_amount", "label": "Sales Amount", "recommended": true },
        { "value": "profit", "label": "Profit" },
        { "value": "quantity", "label": "Quantity" },
        { "value": "__other__", "label": "Other (type it)" }
      ]
    }
  ],
  "scope": ["orders", "customers"]
}
```
*Note: During clarification, no database execution occurs, no query history is saved, and no few-shot example is recorded.*

#### C. Disambiguation Resubmission
The client submits the user's selected choice from the clarification turn:
```json
{
  "text": "get the top sales",
  "model": "openai/gpt-oss-120b",
  "clarifications": [
    { "id": "metric", "value": "sales_amount" }
  ],
  "bypassAmbiguity": true
}
```

For a `"type": "multiple"` question, `value` may be an array of strings (1–10 entries), e.g. `{ "id": "metric", "value": ["total", "subtotal"] }`. Every entry is validated exactly like a single value: it must be an offered option and resolve to a real schema field. An `"__other__"` entry uses the clarification's `customText`. One invalid entry rejects the request with `400 validation_error`.

#### D. Scope Expansion Required Response (HTTP 200)
Returned when a query references collections outside the active workspace:
```json
{
  "success": true,
  "needsClarification": false,
  "naturalLanguage": "Show orders with customer email",
  "safetyStatus": "scope-insufficient",
  "suggestedCollections": ["customers"],
  "scope": ["orders"],
  "explanation": "This query requires the 'customers' collection which is outside your active workspace.",
  "pipeline": [],
  "results": []
}
```

#### E. Mutating Write Interception Response (HTTP 200)
Returned when a query specifies a database write, deletion, or modification:
```json
{
  "success": true,
  "naturalLanguage": "Delete inactive customers",
  "aiMessage": "⚠️ Database Write Intercepted: This action will modify your collection \"customers\". Review and approve to execute.",
  "safetyStatus": "approval-required",
  "safetyBlocked": false,
  "approvalToken": "eyJhbGciOiJIUzI1NiIsIn...",
  "approval": {
    "expiresAt": "2026-11-07T08:24:00.000Z",
    "writeStage": "$merge",
    "writeStageIndex": 2,
    "sourceCollection": "customers",
    "targetCollection": "customers_archive",
    "fieldsWritten": ["archived", "archivedAt"]
  },
  "collection": "customers",
  "pipeline": [
    { "$match": { "status": "inactive" } },
    { "$set": { "archived": true, "archivedAt": "$$NOW" } },
    { "$merge": { "into": "customers_archive" } }
  ],
  "results": []
}
```

`approval` describes the staged write for the approval UI. `expiresAt` is the token's JWT `exp` (10 minutes after issue). `writeStage` / `writeStageIndex` locate the `$merge`/`$out` stage, `targetCollection` is its destination, and `fieldsWritten` lists the `$set`/`$addFields`/`$unset` keys before it. Nothing has been written until `POST /api/query/approve` succeeds.

#### E2. Query Blocked Response (HTTP 422)
Returned when the pipeline fails the safety guard and is not approvable (code execution operators, protected/system collections, restricted stages, malformed pipelines, a write stage that is not the single final top-level `$out`/`$merge`, or a write whose target is another database, a protected collection, or a collection outside a restricted workspace scope). A write is approvable only when everything except its final write stage would pass as a read. Nothing is executed.
```json
{
  "success": false,
  "error": { "code": "safety_violation", "message": "Access to \"system_users\" is not allowed" },
  "safetyStatus": "blocked",
  "safetyBlocked": true,
  "collection": "orders",
  "pipeline": [
    { "$match": { "status": "paid" } },
    { "$lookup": { "from": "system_users", "localField": "userId", "foreignField": "_id", "as": "user" } }
  ],
  "safetyBlock": {
    "code": "protected_collection",
    "rule": "System and internal collections (system, admin, local, config) cannot be read or written.",
    "stage": "$lookup",
    "stageIndex": 1,
    "referenceType": "$lookup collection",
    "reference": "system_users",
    "reason": "Access to \"system_users\" is not allowed"
  }
}
```

`safetyBlock.code` is one of `hard_blocked_operator`, `blocked_write_stage`, `blocked_write_operator`, `protected_collection`, `out_of_scope_collection`, `invalid_collection`, `restricted_stage` or `malformed_pipeline`. A blocked write target has `referenceType: "Write target collection"` (or `"Write target database"`) and is located at the write stage. A `$lookup.from` naming another database is blocked with `referenceType: "$lookup database"`. `stageIndex` is the top-level stage that contains `reference` (`null` when the problem is the target collection or the whole pipeline). A read of a valid collection outside the workspace is not blocked: it returns the scope-expansion response (D), with no approval token even when the pipeline ends in a write.

#### F. Final Execution Response (HTTP 200)
Returned when a query is unambiguous or has been successfully clarified:
```json
{
  "success": true,
  "needsClarification": false,
  "naturalLanguage": "get the top sales",
  "explanation": "Aggregates orders grouped by customer and sorted by sales_amount in descending order.",
  "collection": "orders",
  "pipeline": [
    { "$group": { "_id": "$customerId", "total_sales": { "$sum": "$sales_amount" } } },
    { "$sort": { "total_sales": -1 } },
    { "$limit": 10 }
  ],
  "chartType": "bar",
  "clarifications": [
    { "id": "metric", "value": "sales_amount" }
  ],
  "results": [
    { "_id": "CUST-104", "total_sales": 84200 },
    { "_id": "CUST-089", "total_sales": 71500 }
  ],
  "executionTimeMs": 24,
  "confidenceScore": 92,
  "safetyStatus": "read-only",
  "safetyBlocked": false,
  "meta": {
    "resultCount": 2,
    "executionTimeMs": 24,
    "totalTimeMs": 210,
    "examplesUsed": 1
  }
}
```

---

## 4. Cryptographic Write Approval API

### POST `/api/query/approve`
Safely executes an intercepted mutating query using the signed `approvalToken` issued during write interception.

**Request Body**:
```json
{
  "approvalToken": "eyJhbGciOiJIUzI1NiIsIn..."
}
```

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "naturalLanguage": "Delete inactive customers",
  "action": "execute-approved-write",
  "collection": "customers",
  "acknowledged": true,
  "deletedCount": 14,
  "executionTimeMs": 18
}
```

Before executing, the server verifies the token signature and 10-minute expiry, checks that the token's `connectionId` matches the session, re-runs the safety guard with the token's scope (the pipeline must still be approvable; see E2), and only then records the token's `jti` so it can be used once.

| Status | `error.code` | Cause |
|---|---|---|
| 400 | `validation_error` / `invalid_token` | Missing token, wrong token type, or missing `jti` |
| 401 | `expired_token` | Signature invalid or token expired |
| 403 | `forbidden` | Token belongs to a different connection |
| 409 | `token_already_used` | Token was already executed |
| 422 | `safety_violation` | Pipeline is not approvable: it fails the safety guard beyond its final write stage, or the write target is not allowed |

**Error Response (Expired or Tampered Token - HTTP 401)**:
```json
{
  "success": false,
  "error": {
    "code": "expired_token",
    "message": "Approval draft has expired or is invalid. Please resend query."
  }
}
```

---

## 5. Query History Management

### GET `/api/query/history`
Returns the 20 most recent history items for the active connection, plus every pinned item (up to 50) even when it is older. Items are sorted newest first, and the newest is marked `active`.

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "6703...",
      "query": "get the top sales",
      "time": "5 min ago",
      "timestamp": "2026-11-07T07:58:12.000Z",
      "collection": "orders",
      "resultCount": 10,
      "chartType": "bar",
      "pipeline": [{ "$group": { "_id": "$customerId", "total_sales": { "$sum": "$sales_amount" } } }],
      "results": [{ "_id": "CUST-104", "total_sales": 84200 }],
      "schemaContext": "orders: _id, customerId, sales_amount, …",
      "explanation": "Aggregates orders grouped by customer…",
      "executionTimeMs": 24,
      "confidenceScore": 92,
      "scope": ["orders"],
      "pinned": false,
      "active": true
    }
  ],
  "meta": { "count": 1 }
}
```

`explanation`, `executionTimeMs`, `confidenceScore` and `scope` are `""`/`null` for items recorded before they were stored.

### PATCH `/api/query/history/:id`
Renames and/or pins a saved query history item. Send at least one field.

**Request Body**:
```json
{
  "name": "Q3 Top Revenue Orders",
  "pinned": true
}
```

`name` must be a non-empty string, and `pinned` must be a boolean. Anything else returns `400 validation_error`, and an id that does not belong to this connection returns `404 not_found`.

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "message": "History item updated successfully"
}
```

### DELETE `/api/query/history/:id`
Deletes a specific query history entry.

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "message": "History item deleted successfully"
}
```

---

## 6. Voice Transcription & Multimodal API

### POST `/api/voice`
Accepts `multipart/form-data` audio recordings and performs Whisper Large v3 Turbo transcription followed by the unified ambiguity and query pipeline.

**Form Fields**:
- `audio`: Audio file blob (`audio/webm`, `audio/mp3`, `audio/wav`, `audio/m4a`).
- `model` (optional): LLM model ID.
- `bypassAmbiguity` (optional): `"true"` to bypass clarification.
- `clarifications` (optional): JSON string of validated clarification answers.
- `collections` (optional): JSON array string of scoped collection names, e.g. `["orders"]`. Anything that is not a JSON array returns 400 `validation_error`.
- `workspaceId` (optional): Saved workspace to scope the query to (same rules as `/api/query`).

**Ambiguity Response**:
If the transcribed speech is ambiguous, returns `{ success: true, needsClarification: true, transcript: "...", questions: [...] }`.

---

## 7. Schema Introspection API

### GET `/api/schema`
Returns the cached minified schema profile for the current database connection.

### GET `/api/schema/refresh`
Invalidates the per-connection schema cache and executes a fresh sampling pass.

---

## 8. Workspaces & Scope API

### GET `/api/workspaces`
Lists all workspaces configured for the active connection.

### POST `/api/workspaces`
Creates a new workspace with a specific collection whitelist.

**Request Body**:
```json
{
  "name": "E-Commerce Orders",
  "description": "Order processing and inventory collections",
  "collections": ["orders", "products", "line_items"]
}
```

### PATCH `/api/workspaces/:id`
Updates workspace details or collection whitelist.

### DELETE `/api/workspaces/:id`
Removes a workspace.

### POST `/api/scope/suggest`
Suggests workspace scopes by keyword-scoring the collections against the question. Disabled unless `SCOPE_AUTO_SUGGEST=true`; the bundled client does not call it.

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "suggestions": [
    {
      "name": "Sales & Billing",
      "collections": ["invoices", "orders", "payments"],
      "confidence": 0.94
    },
    {
      "name": "User Engagement",
      "collections": ["sessions", "events", "users"],
      "confidence": 0.88
    }
  ]
}
```

---

## 9. Dashboard API & Public Sharing

### GET `/api/dashboard`
Returns all pinned dashboard widgets for the current authenticated user.

### POST `/api/dashboard/pin`
Pins a query and its chart visualization to the dashboard. Body: `{ query, pipeline, collection, chartType?, name?, results?, scope? }`. The pipeline is checked by the safety guard before it is stored; an unsafe pipeline returns **422** `safety_violation` (or `scope_violation`).

### POST `/api/dashboard/:id/refresh`
Re-runs the pinned MQL aggregation pipeline against the user's live database pool and stores refreshed results. The safety guard runs again on every refresh; a stored pipeline that fails it returns **422** and is not executed.

### DELETE `/api/dashboard/:id`
Deletes a dashboard pin.

### GET `/api/dashboard/shared/:id` *(Public Endpoint - No Auth Required)*
Fetches a read-only, sanitized dashboard widget for public sharing. Excludes internal credentials and connection URIs.

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "name": "Top Customers by Revenue",
    "query": "Top 5 customers by revenue",
    "chartType": "bar",
    "results": [
      { "_id": "C1", "rev": 84200 },
      { "_id": "C2", "rev": 71500 }
    ],
    "lastRefreshedAt": "2026-10-07T14:30:00.000Z"
  }
}
```

---

## 10. Standard Error Format

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Clarification value 'hacked_field' is not a valid schema field"
  }
}
```

Common Error Codes:
- `unauthenticated` (401): No `am_token` session cookie.
- `session_expired` (401): Session cookie invalid or expired; the cookie is cleared.
- `validation_error` (400): Invalid parameters, unknown collection, or prompt-injection attempt in clarifications.
- `workspace_not_found` (400): `workspaceId` does not name a workspace of the current connection.
- `workspace_empty` (400): None of the workspace's collections exist in the database any more.
- `connection_not_found` (404): The session's stored connection no longer exists.
- `expired_token` (401), `forbidden` (403), `token_already_used` (409): Write approval failures (see section 4).
- `safety_violation` (422): Unsafe stage or operator (`$function`, `$where`, system collection, restricted stage). On `POST /api/query` and `/api/voice` the body also carries `safetyBlock` (see section 3, E2). An approvable write (a single final `$out`/`$merge`) is not a 422 there: it returns the approval response (E).
- `scope_violation` (422): Dashboard pin/refresh only. The stored pipeline references a collection outside its scope. `POST /api/query` never returns this code: an out-of-scope collection is the HTTP 200 scope-expansion response (`safetyStatus: "scope-insufficient"`, section 3, D).
- `rate_limited` (429): The upstream LLM is rate limited; retry shortly.
- `execution_error` / `query_error` / `voice_pipeline_error` (500): Unexpected failure while running the query.

Upstream SDK or driver status codes are never forwarded: anything that is not one of the codes above is reported as a 500.

`POST /api/query` does not accept evaluation switches (`evalOptions`); they are only available to in-process evaluation code through an `ExperimentConfig`.

---

*For architectural flows and subsystem designs, see [Architecture Guide](./ARCHITECTURE.md).*

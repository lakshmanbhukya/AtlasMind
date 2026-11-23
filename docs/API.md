# AtlasMind REST API Specification

AtlasMind exposes a cookie-authenticated REST API for database connection management, natural language analytics, schema profiling, ambiguity resolution, workspace scoping, cryptographic Human-in-the-Loop write approvals, voice queries, and collaborative dashboards.

**Base Path**: `/api`

**Origin check**: a non-GET request to `/api/*` that carries an `Origin` header must come from an allowed origin (`CORS_ALLOWED_ORIGINS`, plus `http://localhost:5173` and `http://127.0.0.1:5173` outside production), otherwise 403 `origin_not_allowed`. Requests without an `Origin` header (curl, server-to-server) are not affected. Production cookies are `SameSite=None`, so this is what stops another site from spending a session's Groq budget.

**Request IDs**: every response carries an `X-Request-Id` header (exposed to the browser through CORS). Send your own `x-request-id` (1 to 64 letters, digits, `_` or `-`) to have it reused; anything else is replaced with a random UUID. Server log lines for the request carry the same ID.

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

**Errors** (every error carries `error.code`):
- `validation_error` (400): the connection string is not a `mongodb://` / `mongodb+srv://` URI, the driver cannot parse it (for example a non-numeric port), or `dbName` is missing.
- `empty_database` (400): the database has no collections; the body also carries `availableDatabases`.
- `connection_failed` (400): MongoDB could not be reached or rejected the connection string.
- `connection_save_failed` (500): any other failure while validating or storing the connection.

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

**Errors**: `validation_error` (400) for a malformed or unparseable connection string, `connection_failed` (400) for an unreachable cluster, `list_databases_failed` (500) otherwise.

### GET `/api/connections/:connectionId` *(Protected)*
Returns the stored details (`connectionId`, `dbName`, `label`, `lastConnectedAt`, `createdAt`) of the session's own connection.

**Errors**: `forbidden` (403) when `:connectionId` is not the session's connection, `not_found` (404), `connection_fetch_failed` (500).

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
Clears the `am_token` session cookie. When the cookie still verifies, the sign-in's personal Groq key (section 11) is revoked as well. A missing or expired cookie still returns 200.

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

**Who pays** (`expectedPayer`, optional): `"managed"` or `"personal"`, the payer the client showed when the question was sent (section 11). If it no longer matches this sign-in's stored mode (it was changed in another tab), the server answers 409 `settings_changed` before any Groq call. Without the field the stored mode is used. Managed requests for a model outside `MANAGED_MODELS` run on the managed default model.

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
Returned when a query specifies a database write, deletion, or modification. The model only generates a write stage when the question asks to save results into a collection (e.g. "save total revenue by region into a new collection called revenue_summary"): it then appends one final `$merge` (or `$out`). Questions that ask to delete, update or drop data get a read-only refusal with an empty `pipeline` instead:
```json
{
  "success": true,
  "naturalLanguage": "Delete inactive customers",
  "aiMessage": "⚠️ Database Write Intercepted: This action will write to your collection \"customers_archive\". To execute this change, review and approve it.",
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

### POST `/api/query/stream`
*(Protected, same `llmLimiter` as `POST /api/query`)*

Takes the same request body as `POST /api/query` and runs the same engine call, but streams stage progress as Server-Sent Events (`Content-Type: text/event-stream`). The client's text questions use it (`streamQuery` in `client/src/services/api.js`); voice still uses `POST /api/voice`. `POST /api/query` is unchanged.

```text
event: progress
data: {"stage":"scope"}

event: progress
data: {"stage":"generating"}

: ping

event: result
data: {"status":200,"body":{"success":true,"aiMessage":"...","pipeline":[...]}}
```

- `progress` events report the stage the engine has reached: `scope`, `schema`, `ambiguity`, `generating`, `safety`, `executing`, in that order. A query that stops early (a clarification, a safety block) sends only the stages it reached. Progress is stage-level only; there is no token streaming.
- Exactly one `result` event ends the stream. Once the stream has started the HTTP status is always 200, so `result.status` carries the status `POST /api/query` would have returned, and `result.body` is that response's envelope: 200 for an answer, clarification, approval or scope-expansion response, 422 with `safetyBlock` for a safety block, and the engine error's status and `{ success: false, error: { code, message } }` otherwise.
- A `: ping` comment is sent every 15 seconds while the stream is open. Clients ignore comment lines.
- Errors raised before the stream starts (401 from `requireAuth`, 429 from the rate limiter, 403 `origin_not_allowed`) are ordinary JSON responses, not event streams. Check `Content-Type` before parsing.
- A provider error (`settings_changed`, `managed_allowance_exhausted`, `provider_rate_limited`, …; section 10) has the same body whether it arrives as plain JSON, inside the `result` event, or from `POST /api/voice`.
- If the client disconnects, the server stops writing; the query itself still runs to completion.

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
Accepts `multipart/form-data` audio recordings and performs Whisper Large v3 Turbo transcription followed by the unified ambiguity and query pipeline. If the managed audio decoder is unavailable, the server returns 503 `audio_processing_unavailable`.

**Form Fields**:
- `audio`: Audio file blob (`audio/webm`, `audio/mp3`, `audio/wav`, `audio/m4a`).
- `model` (optional): LLM model ID.
- `bypassAmbiguity` (optional): `"true"` to bypass clarification.
- `clarifications` (optional): JSON string of validated clarification answers.
- `collections` (optional): JSON array string of scoped collection names, e.g. `["orders"]`. Anything that is not a JSON array returns 400 `validation_error`.
- `workspaceId` (optional): Saved workspace to scope the query to (same rules as `/api/query`).
- `expectedPayer` (optional): `managed` or `personal`, as on `/api/query`. One payer covers both the transcription and the query.

**Size limits**: uploads are capped at 25 MB. On the AtlasMind allowance (managed key) a recording over 5 MB is refused with 400 `upload_error` ("Recordings over 5 MB need your own Groq key.") before any Groq call. Managed recordings are decoded on the server and limited to 60 seconds. To allow for browser timer delays, the server trims recordings up to 60.5 seconds to the first 60 seconds. Each Whisper attempt reserves the decoded duration rounded up to whole seconds, with a 10-second minimum. Unreadable or overlong managed recordings return 400 `upload_error` before transcription.

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
Returns all pinned dashboard widgets for the current authenticated user. Each pin carries `shared: boolean` (whether it has a live public link); the share token itself is never listed and is only returned by `POST /api/dashboard/:id/share`.

### POST `/api/dashboard/pin`
Pins a query and its chart visualization to the dashboard. Body: `{ query, pipeline, collection, chartType?, name?, results?, scope? }`. The pipeline is checked by the safety guard before it is stored; an unsafe pipeline returns **422** `safety_violation` (or `scope_violation`).

### POST `/api/dashboard/:id/refresh`
Re-runs the pinned MQL aggregation pipeline against the user's live database pool and stores refreshed results. The safety guard runs again on every refresh; a stored pipeline that fails it returns **422** and is not executed.

### DELETE `/api/dashboard/:id`
Deletes a dashboard pin.

### POST `/api/dashboard/:id/share`
Makes a pin publicly shareable. Creates a secret, random 32-character share token for the pin, or returns the existing one if the pin was already shared. Returns **400** for a malformed pin ID and **404** if the pin does not belong to the current connection. Deleting the pin, or `DELETE /api/dashboard/:id/share`, revokes its link.

**Success Response (HTTP 200)**:
```json
{ "success": true, "data": { "shareToken": "q3N0yJb1d0v7C1o2XkYpQm9ZtRf4hL8w" } }
```

The client builds the public link as `${origin}/shared/<shareToken>`.

### DELETE `/api/dashboard/:id/share`
Revokes a pin's public link without deleting the pin. The old token stops resolving immediately (`GET /api/dashboard/shared/:token` returns **404**); sharing the pin again issues a new token. Returns **400** for a malformed pin ID and **404** if the pin does not belong to the current connection. Revoking a pin that is not currently shared succeeds.

**Success Response (HTTP 200)**:
```json
{ "success": true, "message": "Share link revoked" }
```

### GET `/api/dashboard/shared/:token` *(Public Endpoint - No Auth Required)*
Fetches a read-only, sanitized dashboard widget for public sharing, by its share token. Only pins explicitly shared via `POST /api/dashboard/:id/share` are reachable; a pin's ObjectId does not work here. Excludes internal credentials, connection URIs and the share token. A malformed or unknown token returns **404**.

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
- `rate_limited` (429): The upstream LLM is rate limited; retry shortly. Only reachable without a provider (in-process evaluation code); HTTP routes report `provider_rate_limited`.
- `too_many_requests` (429): AtlasMind's own request limiters (`llmLimiter`, the auth limiter, and 10 Groq key checks per hour per sign-in).
- `execution_error` / `query_error` / `voice_pipeline_error` (500): Unexpected failure while running the query.
- `upload_error` (400): Voice upload rejected (invalid multipart or unsupported format, over 25 MB, or an unreadable recording or one exceeding 5 MB or 60 seconds on the AtlasMind allowance).
- `origin_not_allowed` (403): A non-GET request from an origin that is not allowed (see the top of this document).
- `invalid_json` (400): The request body is not valid JSON. Nothing from the body is logged or echoed back.

**Provider (Groq) errors.** These carry `payer` (`"managed"` for the AtlasMind allowance, `"personal"` for the user's own key) and, when known, `retryAfterSeconds` or `resetAt`:

```json
{
  "success": false,
  "error": {
    "code": "managed_allowance_exhausted",
    "message": "The AtlasMind allowance for today is used up. Use your own Groq key, or try again after the reset.",
    "payer": "managed",
    "resetAt": "2026-11-23T00:00:00.000Z"
  }
}
```

| Code | Status | Meaning |
| --- | --- | --- |
| `settings_changed` | 409 | `expectedPayer` does not match the stored mode. Refetch `GET /api/provider-settings` and resend. No Groq call was made. |
| `provider_key_invalid` | 422 | Groq rejected the key. With `payer: "personal"`, update the key or switch to the allowance. With `payer: "managed"`, the operator's `GROQ_API_KEY` is wrong. Never retried and never falls back to another key. |
| `provider_model_unavailable` | 422 | The model is not available for this key. Pick another model. |
| `managed_allowance_exhausted` | 429 | Today's AtlasMind allowance (per connection or for the whole installation) is used up. `resetAt` is the next UTC midnight. |
| `provider_rate_limited` | 429 | Groq rate-limited the key. `retryAfterSeconds` is included when Groq sent `retry-after`. |
| `provider_unavailable` | 502 / 503 | Groq could not be reached or returned a 5xx (502), or the server has no `GROQ_API_KEY` for managed traffic (503). |
| `managed_accounting_unavailable` | 503 | The allowance ledger could not be read in `enforce` mode. Personal-key requests still work. |
| `reconnect_required` | 409 | A session from before personal keys existed tried to use one. Connect again. |
| `session_revoked` | 401 | A key was saved after the sign-in was logged out. |
| `provider_key_missing` | 400 | `PATCH /api/provider-settings` to `personal` without a stored key. |

A provider error never signs the user out.

Upstream SDK or driver status codes are never forwarded: anything that is not one of the codes above is reported as a 500.

`POST /api/query` does not accept evaluation switches (`evalOptions`); they are only available to in-process evaluation code through an `ExperimentConfig`.

---

## 11. Groq Provider Settings (who pays)

*(Protected; responses carry `Cache-Control: no-store`.)*

Every connection starts on the **AtlasMind allowance**: the server's own `GROQ_API_KEY`, with a daily token and voice budget per connection and for the whole installation (see `docs/DEPLOYMENT.md`). A user can store **their own Groq key** for the current sign-in instead. The key is encrypted on the server, lasts as long as the session cookie (7 days), and is revoked on logout. It is never returned, logged or included in an error.

### GET `/api/provider-settings`

```json
{
  "success": true,
  "mode": "managed",
  "hasKey": false,
  "keyLast4": null,
  "keyExpiresAt": null,
  "managedAllowance": {
    "tokensRemaining": 18400,
    "audioSecondsRemaining": 540,
    "resetAt": "2026-11-23T00:00:00.000Z",
    "mode": "enforce"
  },
  "allowedModels": ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
}
```

- `mode`: `managed` (AtlasMind allowance) or `personal` (own key). `keyLast4` and `keyExpiresAt` describe a stored key.
- `managedAllowance` is shown in both modes. Each remainder is the smaller of the connection's and the installation's. Both are `null` when the ledger cannot be read, or when `mode` is `off` (no metering).
- `allowedModels`: the models the client offers. In managed mode this is `MANAGED_MODELS`, and the server enforces it (any other model runs on the managed default). In personal mode it is every client model, but the server does not enforce it: a request paid by the user's own key may name any Groq model ID, and if Groq rejects that model the request falls back once to the default model.
- `requiresReconnectForPersonal: true`: the session cookie predates personal keys. It keeps managed access; connect again to store a key.

### PUT `/api/provider-settings/key`
Body: `{ "apiKey": "gsk_..." }`. Checks the key with Groq's model list (no tokens used, no user data sent), stores it and switches to `personal`. Returns the new settings. An invalid key returns 422 `provider_key_invalid` and leaves the previous settings unchanged; a malformed one returns 400 `validation_error`. Limited to 10 checks per hour per sign-in (`too_many_requests`).

### PATCH `/api/provider-settings`
Body: `{ "mode": "managed" | "personal" }`. `personal` needs a stored key (`provider_key_missing`). Returns the new settings.

### DELETE `/api/provider-settings/key`
Removes the key and switches to `managed` in one update. Returns the new settings.

---

*For architectural flows and subsystem designs, see [Architecture Guide](./ARCHITECTURE.md).*

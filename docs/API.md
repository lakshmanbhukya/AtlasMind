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
  "model": "deepseek-r1-distill-llama-70b",
  "collections": ["orders", "customers"],
  "workspaceId": "66f4..."
}
```

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
The client submits the user's selected choice from `ClarificationCard`:
```json
{
  "text": "get the top sales",
  "model": "deepseek-r1-distill-llama-70b",
  "clarifications": [
    { "id": "metric", "value": "sales_amount" }
  ],
  "bypassAmbiguity": true
}
```

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
  "collection": "customers",
  "pipeline": [{ "$match": { "status": "inactive" } }],
  "results": []
}
```

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
Returns recent query execution history for the active connection.

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "6703...",
      "query": "get the top sales",
      "time": "5 minutes ago",
      "collection": "orders",
      "resultCount": 10,
      "clarifications": [{ "id": "metric", "value": "sales_amount" }],
      "active": true
    }
  ],
  "meta": { "count": 1 }
}
```

### PATCH `/api/query/history/:id`
Renames a saved query history item.

**Request Body**:
```json
{
  "name": "Q3 Top Revenue Orders"
}
```

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "message": "History item renamed successfully"
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
- `collections` (optional): JSON array of scoped collection names.

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

### PUT `/api/workspaces/:id`
Updates workspace details or collection whitelist.

### DELETE `/api/workspaces/:id`
Removes a workspace.

### POST `/api/scope/suggest`
Analyzes all database collections using semantic LLM clustering and suggests optimal workspace scopes.

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
Pins a query and its chart visualization to the dashboard.

### POST `/api/dashboard/:id/refresh`
Re-runs the pinned MQL aggregation pipeline against the user's live database pool and stores refreshed results.

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
- `unauthorized`: Missing or invalid `am_token` cookie.
- `validation_error`: Invalid parameters or prompt-injection attempt.
- `expired_token`: HITL write approval token expired.
- `safety_violation`: Unsafe stage (`$out`, `$merge`) detected.
- `scope_violation`: Attempted cross-collection query outside active workspace.
- `database_error`: MongoDB driver execution failure.
- `groq_rate_limit`: Upstream LLM rate limit exceeded.

---

*For architectural flows and subsystem designs, see [Architecture Guide](./ARCHITECTURE.md).*

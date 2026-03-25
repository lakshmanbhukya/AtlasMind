# API Documentation

AtlasMind exposes a cookie-authenticated REST API for database connection management, natural language analytics, schema introspection, voice queries, and dashboard pinning.

Base path: /api

## Authentication and Session

Session auth uses an httpOnly cookie named am_token. Protected endpoints require this cookie and should be called with credentials enabled on the client.

### POST /api/connections/connect

Validates a MongoDB connection string + database name, stores encrypted connection metadata, and issues the am_token cookie.

Request body:

```json
{
  "connectionString": "mongodb+srv://...",
  "dbName": "sample_analytics",
  "label": "My Database"
}
```

Success response:

```json
{
  "success": true,
  "dbName": "sample_analytics",
  "label": "My Database",
  "collectionCount": 4,
  "collections": ["orders", "customers", "products", "events"],
  "message": "Connected! Found 4 collections in \"sample_analytics\"."
}
```

### GET /api/auth/me

Validates current cookie and returns active connection metadata.

```json
{
  "success": true,
  "connectionId": "f8a...",
  "dbName": "sample_analytics",
  "label": "My Database",
  "lastConnectedAt": "2026-03-25T09:00:00.000Z"
}
```

### POST /api/auth/logout

Clears session cookie.

```json
{
  "success": true,
  "message": "Logged out"
}
```

## Health

### GET /api/health

Service health + uptime.

```json
{
  "success": true,
  "status": "ok",
  "timestamp": "2026-03-25T09:00:00.000Z",
  "uptime": 123.45
}
```

## Query API

All query endpoints below are protected (require am_token cookie).

### POST /api/query

Runs NL -> MQL generation -> safety validation -> aggregation execution.

Request body:

```json
{
  "text": "Top 5 customers by total revenue"
}
```

Response (shape may include aliases for backward compatibility):

```json
{
  "success": true,
  "naturalLanguage": "Top 5 customers by total revenue",
  "aiMessage": "Groups orders by customer and ranks by revenue.",
  "explanation": "Groups orders by customer and ranks by revenue.",
  "collection": "orders",
  "pipeline": [
    { "$group": { "_id": "$customerId", "revenue": { "$sum": "$amount" } } },
    { "$sort": { "revenue": -1 } },
    { "$limit": 5 }
  ],
  "mql": [
    { "$group": { "_id": "$customerId", "revenue": { "$sum": "$amount" } } },
    { "$sort": { "revenue": -1 } },
    { "$limit": 5 }
  ],
  "chartType": "bar",
  "safetyStatus": "read-only",
  "safetyBlocked": false,
  "results": [],
  "result": [],
  "executionTimeMs": 38,
  "confidenceScore": 85,
  "similarQueriesCount": 2,
  "schemaContext": "Database: ...",
  "meta": {
    "resultCount": 0,
    "executionTimeMs": 38,
    "totalTimeMs": 176,
    "examplesUsed": 2,
    "similarQueriesCount": 2,
    "confidenceScore": 85
  }
}
```

### POST /api/query/export

Returns a JSON export payload for query results.

Request body:

```json
{
  "query": "Top customers",
  "collection": "orders",
  "pipeline": [
    { "$group": { "_id": "$customerId", "total": { "$sum": "$amount" } } }
  ],
  "results": [{ "_id": "C1", "total": 1200 }]
}
```

### GET /api/query/history

Returns recent query history for current connection.

```json
{
  "success": true,
  "data": [
    {
      "id": "65f...",
      "query": "Top customers",
      "time": "Just now",
      "collection": "orders",
      "resultCount": 10,
      "schemaContext": "Database: ...",
      "active": true
    }
  ],
  "meta": { "count": 1 }
}
```

## Schema API

Protected endpoints.

### GET /api/schema

Returns profiled schema for the connected user database.

### GET /api/schema/refresh

Force-refreshes schema cache and returns latest schema.

## Voice API

Protected endpoint.

### POST /api/voice

Accepts multipart/form-data with field audio and performs:

1. Speech transcription
2. NL -> MQL generation
3. Safety validation
4. Query execution

Supported audio formats: mp3, wav, webm, ogg, flac, m4a, and mp4 audio.

Returns the same core fields as POST /api/query plus transcript/text/language metadata.

## Dashboard API

Protected endpoints.

### GET /api/dashboard

Returns pinned dashboard items.

### POST /api/dashboard/pin

Pins query output as a dashboard widget.

Request body:

```json
{
  "query": "Top customers",
  "pipeline": [
    { "$group": { "_id": "$customerId", "total": { "$sum": "$amount" } } }
  ],
  "collection": "orders",
  "chartType": "bar",
  "name": "Top Customers",
  "results": [{ "_id": "C1", "total": 1200 }]
}
```

### DELETE /api/dashboard/:id

Deletes a pinned widget.

### POST /api/dashboard/:id/refresh

Re-runs a pinned query and returns updated payload.

## Error Format

Most failures use this envelope:

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "..."
  }
}
```

---

[Back to README](../README.md)

# 📡 API Documentation

AtlasMind exposes a RESTful API to handle natural language processing and data management.

## Core Endpoints

### 1. Query Generation & Execution
**POST** `/api/query`

Transforms natural language into an MQL aggregate pipeline and returns results.

| Parameter | Type | Description |
|---|---|---|
| `query` | String | The natural language question. |
| `history` | Array | (Optional) Conversation context for follow-up queries. |

**Example Response:**
```json
{
  "success": true,
  "aiMessage": "Here are your top 5 customers by revenue.",
  "pipeline": [
    { "$group": { "_id": "$customerId", "revenue": { "$sum": "$amount" } } },
    { "$sort": { "revenue": -1 } },
    { "$limit": 5 }
  ],
  "results": [...],
  "explanation": "Groups orders by customer and sorts by total expenditure.",
  "chartType": "bar"
}
```

### 2. Schema Profiling
**GET** `/api/schema`

Introspects the connected database and returns metadata.

**Example Response:**
```json
{
  "collections": [
    {
      "name": "orders",
      "documentCount": 1250,
      "fields": [
        { "name": "amount", "type": "Number" },
        { "name": "status", "type": "String" }
      ]
    }
  ]
}
```

### 3. Dashboard Management
**GET** `/api/dashboard`
Returns all pinned dashboard widgets.

**POST** `/api/dashboard`
Pins a new query result to the dashboard.

### 4. Voice Processing
**POST** `/api/voice`
Accepts a recording and performs end-to-end Speech -> Query -> Results.

---
[⬅️ Back to README](../README.md)

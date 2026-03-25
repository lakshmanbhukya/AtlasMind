# Key Features and Usage

AtlasMind is a conversational analytics experience for MongoDB with session-based access, AI-assisted query generation, and built-in safety checks.

## Conversational Analytics

- Natural language to MQL: ask questions without writing aggregation manually.
- Schema-aware generation: prompt context includes profiled collections and fields.
- Few-shot augmentation: similar historical examples improve generation quality.
- AI explanation output: responses include readable reasoning text.

## Voice to Insights

- Upload audio to run speech transcription and query execution in one flow.
- Uses Groq speech transcription then standard query pipeline.
- Returns transcript/text plus full query result payload.

## Dashboard Workflow

- Pin any successful query output to dashboard storage.
- List existing pins, delete pins, and request refresh for a pin.
- Chart rendering supports bar, line, area, pie, scatter, composed, and table views.

## Safety and Guardrails

- Write/mutate stages and operators are blocked before execution.
- Collection names are validated and restricted.
- If no limit stage exists, a max result limit is automatically added.
- Unsafe output is returned as a safety violation response.

## Session and Access Model

- Users connect a MongoDB database through the landing flow.
- Server issues an httpOnly JWT cookie session.
- Query/schema/voice/dashboard routes require authenticated session.

## Query History and Export

- Recent query history is available for sidebar recall.
- Query export endpoint returns JSON payload for results/pipeline metadata.

## Example Prompts

| Category    | Ask AtlasMind                                              |
| ----------- | ---------------------------------------------------------- |
| Basic       | List the first 10 customers                                |
| Revenue     | Total sales by category this quarter                       |
| Trend       | Monthly order count for the last 12 months as a line chart |
| Inventory   | Products with stock below 15                               |
| Correlation | Scatter plot of product price vs units sold                |

---

[Back to README](../README.md)

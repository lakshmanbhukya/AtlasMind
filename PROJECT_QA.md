# AtlasMind: Quick Interview Prep & Speaking Guide

> **Interview Tip:** Speak naturally in the first person ("I designed...", "I built..."). Each question below is distilled into **at most 5–6 conversational bullet points** that you can deliver smoothly in 30–60 seconds.

---

### 1. Explain your project in 2 minutes.
* **The Pitch:** I built **AtlasMind**, a conversational analytics platform for MongoDB that lets anyone ask questions in plain English or voice and instantly see interactive charts in under 200 milliseconds.
* **The Core Problem:** Most AI database tools blindly guess what you mean when a question is vague—like asking for *"top sales"*—leading to misleading business numbers. 
* **My Solution (Ambiguity Gate):** Instead of guessing, AtlasMind scans the database schema in real time and asks the user clarifying questions (e.g., *"Do you mean total revenue or units sold?"*) before running the query.
* **Performance:** I used Groq LPUs running Llama 3.3 and Whisper Turbo, which generates complex MongoDB aggregation queries almost instantaneously.
* **Safety & Security:** All queries go through an AST safety validator that blocks destructive commands, caps results, and requires explicit user approval for any data modifications.
* **End-to-End Experience:** Results are immediately transformed into interactive charts (bar, line, pie) that users can pin to a custom dashboard.

---

### 2. What problem does your project solve?
* **Complex Query Syntax:** MongoDB aggregation pipelines (`$group`, `$lookup`, `$unwind`) are hard to write, leaving business teams dependent on developers for simple ad-hoc reports.
* **AI "Silent Assumptions":** Standard LLM tools guess metrics silently when a prompt is vague, producing confident-looking reports based on the wrong data.
* **Database Destruction Risks:** Raw AI-generated queries can accidentally overwrite collections (`$out`, `$merge`) or execute harmful injected JavaScript code.
* **Resource Exhaustion (DoS):** Unbounded queries without `$limit` can pull millions of records, crashing both the database and the web browser.
* **The AtlasMind Fix:** It provides an interactive, self-verifying agent that clarifies ambiguities upfront, enforces read-only safety, and delivers instant self-serve analytics.

---

### 3. Why did you select this technology stack?
* **React 19 & Vite (Frontend):** React 19 gives smooth concurrent UI updates for live chat and chart rendering, while Vite provides fast local development and lightweight production builds.
* **Tailwind CSS & Recharts:** Tailwind made it fast to build a clean, responsive dark-mode UI, while Recharts handles rendering dynamic SVG charts directly from MongoDB JSON data.
* **Node.js & Express 4 (Backend):** Its event-driven, non-blocking I/O is ideal for handling concurrent API traffic, audio streaming for voice queries, and multiplexed database connections.
* **MongoDB Native Driver (6.x):** I avoided heavy ORMs like Mongoose so I could execute raw, dynamic aggregation pipelines and have fine-grained control over connection pooling.
* **Groq LPUs (AI Engine):** Traditional LLM APIs take 3–5 seconds to respond. Groq’s hardware delivers responses in under 200ms, making conversational analytics feel real-time.
* **AES-256 & httpOnly JWT (Security):** Keeps database credentials encrypted at rest while protecting session tokens from XSS and JavaScript injection attacks.

---

### 4. Explain your complete architecture.
* **1. Client Tier (React 19 SPA):** Handles the chat interface, voice recording, clarification pills, and Recharts visualization.
* **2. API Gateway (Express 4):** Manages rate limiting, cookie-based session verification, and request routing.
* **3. Grounding & Ambiguity Tier:** Connects to the user's database to profile collection schemas, run the Ambiguity Gate, and match few-shot example queries.
* **4. AI Inference Tier (Groq LPUs):** Feeds the grounded schema and prompt into Llama 3.3 70B (for MQL generation) or Whisper Large v3 (for voice transcription).
* **5. Safety & Execution Tier:** Validates the query syntax tree against an 18-stage allowlist, injects `$limit: 100`, and executes the query through a managed connection pool (`userDbPool`).
* **6. Storage Tier (Dual Databases):** Physically separates the AtlasMind platform database (sessions, history, pinned charts) from the user’s target business database.

---

### 5. Explain frontend-to-backend communication.
* **REST over HTTPS:** The client talks to the backend using Axios with JSON payloads for standard queries, dashboard pins, and schema fetching.
* **Automatic Cookie Auth:** Axios is configured with `withCredentials: true`, so the browser automatically sends the secure `am_token` JWT cookie with every request without manual headers.
* **Voice Upload via FormData:** When a user speaks, the browser's `MediaRecorder` captures audio into a WebM blob and streams it to `/api/voice` using `multipart/form-data`.
* **Smart Error Interceptors:** An Axios response interceptor catches HTTP errors while preserving structured metadata (like suggested database lists or clarification questions) so the UI can adapt.
* **Dynamic Environment Routing:** The base URL automatically adapts between the local development server and the deployed production backend on Render.

---

### 6. How does data flow from UI to database?
* **Step 1 — Input:** The user types or speaks a prompt (e.g., *"Show revenue by country"*).
* **Step 2 — Auth & Schema Lookup:** The request hits Express with the session cookie. The backend pulls the cached database schema and past query examples.
* **Step 3 — Ambiguity Check:** If the question has multiple interpretations (e.g. "top sales"), the server pauses and asks the user to pick a metric.
* **Step 4 — AI Generation:** Once clear, Groq LPU synthesizes the MongoDB Aggregation Pipeline in under 200ms.
* **Step 5 — Safety Guardrail:** The AST validator inspects the pipeline, blocks dangerous operators, injects `$limit: 100`, and verifies collection permissions.
* **Step 6 — Execution & Render:** The query runs against the user's database, logs metadata to the history collection, and returns JSON data that Recharts immediately plots on screen.

---

### 7. What database tables/collections did you create?
* **Decoupled Design:** I maintained two separate databases: a **Central Platform DB** for AtlasMind itself, and the **User's Target DB** which we only query read-only.
* **`user_connections`:** Stores encrypted connection strings, hashed connection IDs, and database labels.
* **`query_history`:** Stores past queries, generated pipelines, execution times, and a 30-day auto-expiry TTL index.
* **`dashboards`:** Stores user-pinned query cards, pipeline definitions, and chart configurations.
* **`few_shot_examples`:** Stores verified question-to-pipeline templates used for in-context AI learning.
* **`approval_tokens`:** Stores temporary cryptographic tokens used for approving staged mutating operations.

---

### 8. Explain your database schema.
* **`user_connections`:** Contains `connectionId` (unique SHA-256 hash), `encryptedUri` (AES-256 ciphertext + IV), `dbName`, and `lastConnectedAt`.
* **`query_history`:** Contains `connectionId`, `naturalLanguage` query text, `pipeline` (array of stages), `collection`, `executionTimeMs`, `status`, and `timestamp` (with a 30-day TTL index).
* **`dashboards`:** Contains `connectionId`, widget `name`, the `pipeline`, target `collection`, cached `results`, and `chartType` (`bar`, `line`, `pie`, etc.).
* **`few_shot_examples`:** Contains `connectionId`, sample `question`, target `pipeline`, `collection`, and semantic `tags`.
* **Indexing Strategy:** I added unique indexes on `connectionId` for instant lookups, compound indexes on `(connectionId, timestamp)` for query history, and a MongoDB TTL index to auto-purge history older than 30 days.

---

### 9. (13) Explain one REST API you implemented.
* **Endpoint:** `POST /api/query` — the primary engine that transforms natural language into verified data insights.
* **Request:** Takes `{ text: "Show top products by sales", model?: "..." }` along with the session cookie.
* **Step 1 — Auth & Profiling:** Verifies the JWT cookie, grabs the tenant's connection from `userDbPool`, and retrieves the cached schema.
* **Step 2 — AI Synthesis:** Sends the enriched prompt to Groq LPU to generate the MongoDB aggregation pipeline.
* **Step 3 — AST Safety Check:** Parses the pipeline to ensure it only uses approved read-only stages and automatically appends a `$limit: 100` stage.
* **Response (200 OK):** Returns `{ results, pipeline, chartType, explanation, meta }` with execution times, ready for the UI to display.

---

### 10. (14) How do you handle exceptions?
* **Central Express Error Middleware:** A single global error handler catches all unhandled async errors, formats them into a clean JSON `{ success: false, error: { code, message } }`, and hides raw stack traces in production.
* **Database-Specific Catch Blocks:** Distinguishes between network dropouts (`MongoNetworkError`), invalid connection strings, and empty databases, returning helpful user hints instead of generic 500 errors.
* **AST Validation Rejections:** Malformed or dangerous queries return a structured `422 Unprocessable Entity` with a clear explanation of which stage was blocked.
* **React Error Boundaries:** Critical UI widgets like charts are wrapped in an `ErrorBoundary` component, displaying a graceful retry button rather than crashing the whole page.
* **Axios Interceptor Handling:** The frontend interceptor preserves server error codes so the UI can trigger automatic recovery flows (such as prompting the user to pick an alternate database).

---

### 11. (15) How did you implement authentication?
* **No Plain Passwords:** Instead of traditional username/passwords, authentication is tied to verifying and securely storing the user's MongoDB connection string.
* **AES-256-CBC Encryption:** When a user connects, their connection URI is encrypted using AES-256 with a unique initialization vector (IV) before saving to the database.
* **Opaque Tenant ID:** The URI is hashed with SHA-256 to create a deterministic, non-reversible `connectionId`.
* **httpOnly JWT Cookie:** The server signs a JWT containing `{ connectionId }` and sets an `httpOnly`, `secure`, `sameSite` cookie named `am_token` (7-day expiry).
* **Protection Against Attacks:** Because the token is in an `httpOnly` cookie, JavaScript cannot read it, eliminating the risk of token theft via Cross-Site Scripting (XSS).
* **Route Middleware:** The `requireAuth` middleware verifies the cookie on all protected routes and automatically attaches `req.connectionId` to downstream controllers.

---

### 12. (16) What was your individual contribution?
* **Full-Stack Ownership:** I designed, developed, and deployed the entire application from end to end as the sole developer.
* **System Architecture:** Designed the decoupled dual-database model, connection pooling system (`userDbPool`), and cryptographic approval protocol.
* **Core Agentic AI Engine:** Invented and built the **Ambiguity Gate** algorithm to eliminate AI metric guessing, alongside the live BSON schema profiler.
* **Security & Safety:** Developed the AST pipeline safety parser with an 18-stage allowlist, auto-limit injector, and AES-256 credential encryption.
* **Frontend Experience:** Built the React 19 interface, voice recording pipeline via Web Audio API, and dynamic charting with Recharts.
* **DevOps & Cloud:** Configured GitHub Actions CI/CD workflows and deployed the production system on Netlify and Render.

---

### 13. (17) What was the most difficult technical challenge?
* **The Challenge:** The **"Silent Assumption" vulnerability** — when users ask vague questions like *"Show top customers"*, standard LLMs secretly guess which field to use (e.g. sorting by total spent vs. order frequency), producing plausible but incorrect business numbers.
* **Risk of Database Damage:** At the same time, naive LLM generation risks generating destructive write commands (`$out`, `$merge`) or freezing the database with unbounded scans.
* **Solution Part 1 (Ambiguity Gate):** I built a deterministic pre-check that scans user queries against a dictionary of ambiguous terms and compares them with real numeric schema fields. If multiple fields exist, it pauses and prompts the user with interactive pills.
* **Solution Part 2 (Recursive AST Guard):** I wrote a safety validator that parses the generated JSON pipeline as a syntax tree, enforcing an 18-stage analytical allowlist and blocking destructive or code-execution operators (`$where`, `$function`).
* **Solution Part 3 (Cryptographic HITL):** Any legitimate write operations are staged behind a 10-minute signed JWT token requiring two-factor user confirmation before execution.
* **Result:** In benchmark testing across 330 queries, this reduced metric guessing errors from **100% down to 0%** and successfully blocked **100% of injection attacks**.

---

### 14. (18) What would you improve if given more time?
* **Multi-Turn Conversational Context:** Add session memory so users can ask follow-up questions (e.g., *"Now filter that to just California"*) without restating the whole question.
* **Server-Sent Events (SSE) Streaming:** Stream the AI's reasoning and explanation token-by-token to make the initial response feel even faster.
* **Automated Index & Query Optimization:** Use MongoDB's `.explain("executionStats")` to detect slow collection scans and recommend compound indexes to the user.
* **Multi-Database Federation:** Expand the engine to query across both MongoDB and SQL databases (PostgreSQL, ClickHouse) through a unified semantic layer.
* **Team RBAC & PII Masking:** Add enterprise role-based access control and automatically mask sensitive customer fields (emails, credit cards) before displaying charts.

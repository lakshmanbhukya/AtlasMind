# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

AtlasMind is a conversational BI app for MongoDB: a user connects their own MongoDB database, asks questions in natural language (text or voice), and the server has a Groq-hosted LLM generate an aggregation pipeline. The pipeline is safety-checked, run against the user's DB, and returned with a chart type and an explanation. It has two independent npm packages: `server/` (Express, CommonJS) and `client/` (React 19 + Vite, ESM). There is no root package.json.

## Commands

Server (`cd server`):
- `npm run dev`: nodemon on port 3001 (needs `server/.env`; see `server/.env.example`: `MONGODB_URI`, `GROQ_API_KEY`, `ENCRYPTION_KEY` (64 hex chars), `JWT_SECRET`, optional `CORS_ALLOWED_ORIGINS`)
- `npm test`: Jest (`jest --verbose`). CI runs only this, on Node 24, and only when `server/**` changes
- Single test: `npx jest src/__tests__/routesSmoke.test.js` or `npx jest -t "test name"`
- `npm run test:coverage`, `npm run seed` (seeds the `sample_sales` collection)
- `test:smoke` points to `test-smoke.js`, which does not exist

Client (`cd client`):
- `npm run dev`: Vite on 5173; proxies `/api` to `localhost:3001`
- `npm run build`, `npm run lint` (ESLint flat config), `npm run test:e2e` (Playwright, `client/tests/e2e/`)
- `VITE_SERVER_URL` sets the API base URL; it defaults to same-origin `/api/`

`start.bat` starts both dev servers in separate windows (Windows).

## Architecture

### Two kinds of database
- **Central DB** (`server/src/db/connection.js`, fixed DB name `aggregatorflow_db`, from `MONGODB_URI`): app state only. It holds `user_connections` (users' encrypted connection strings), `query_history` (history, saved/pinned dashboard items), `few_shot_examples`, and `approval_tokens` (single-use write-approval `jti`s).
- **User DBs**: the databases users connect. `routes/connections.js` validates the URI, AES-256 encrypts it (`utils/encryption.js`), upserts it through `models/UserConnection.js`, and sets an httpOnly JWT cookie `am_token` that carries `connectionId`. `services/userDbPool.js` caches one `MongoClient` per `connectionId` (LRU plus idle TTL). Always get user DB handles with `getUserDb(connectionId)`. Do not open new clients.

### Auth
There are no user accounts. A session is a "connected DB". `middleware/auth.js` (`requireAuth`) checks the cookie and sets `req.connectionId`. In `index.js`, `/api/auth` and `/api/connections` are public (with the auth rate limiter). `/api/query`, `/api/voice`, `/api/schema`, and `/api/dashboard` are protected. The client sends cookies with `withCredentials: true` (`client/src/services/api.js`). In production, cookies use `sameSite: none` and `secure`, and CORS needs an explicit allow-list.

### NL → MQL pipeline (the core flow)
1. `schemaProfiler`: samples the user DB and builds a minified schema string for the prompt (cached; routes pass `forceRefresh: true`)
2. `fewShotRetriever`: finds similar past queries in `few_shot_examples`, and adds new ones after successful runs
3. `groqService.generateMQL`: prompt from `prompts/systemPrompt.js`. Default model is `openai/gpt-oss-120b` at temperature 0.1. If a model the client picked fails, it falls back to the default. `transcribeAudio` uses Whisper for voice.
4. `safetyGuard`: `validateCollectionName` blocks `system`/`admin`/`local`/`config`; `validatePipeline` walks the pipeline against `BLOCKED_STAGES`/`BLOCKED_OPERATORS`. Write stages are not just rejected (`isWrite`). They are staged for human-in-the-loop approval: the server returns a 10-minute JWT approval token, and `POST /api/query/approve` executes the write once.
5. `queryExecutor`: runs the pipeline on the user DB and saves to `query_history`

Response envelope: `{ success: true, ... }` or `{ success: false, error: { code, message } }`. Query responses also carry fields the client uses: `aiMessage`, `pipeline`/`mql`, `collection`, `chartType`, `results`/`result`, `safetyStatus`, and `meta`. If you change a route, keep `client/src/services/api.js` and `docs/API.md` in sync.

### In-progress refactor (ADR 0001): watch for broken state
`docs/adr/0001-collapse-query-execution-seam.md` and `docs/specs/0001-…` describe moving orchestration out of `routes/query.js` and `routes/voice.js` into `services/queryExecutionEngine.js`. The engine returns typed `QueryOutcome`s (`success` / `clarification_required` / `approval_required` / `safety_blocked`) and throws typed domain errors that the routes map to HTTP codes. It adds an ambiguity/clarification gate and `interpretationComplianceVerifier.js`, which checks that the generated sort/metric matches the clarification the user chose. Current state (untracked files):
- `queryExecutionEngine.js` requires `./ambiguityGate`, which does not exist yet
- The ADR's `queryPipelineService.js` shim does not exist
- `routes/query.js` and `routes/voice.js` still contain the old inline pipeline and do not call the engine
- `server/src/__tests__/` tests are written against the engine API (they mock `QueryExecutionEngine`)

Check this state before you assume the tests pass or that the routes use the engine.

### Client
React Router pages are in `client/src/pages/` (Chat, Dashboard, SharedDashboard). Server-state hooks are in `client/src/hooks/` (`useChat`, `useSchema`, `useAuth`, `useStreamingQuery`, `useVoice`), built on TanStack Query and the shared axios instance. `ChartRenderer.jsx` (Recharts) renders results based on the server's `chartType`. UI primitives are shadcn-style, in `components/ui/`. The `@` alias resolves to `client/src`.

## Conventions
- Keep route handlers thin: put orchestration and business logic in `server/src/services`.
- Never weaken the read-only safety guard. Generated pipelines must go through `validateCollectionName` and `validatePipeline` before execution, and writes go only through the approval-token flow.

## Repo-specific agent rules (`.agents/rules/rules.md`)
- "Do not break anything": check dependencies before changing existing code, and keep changes atomic.
- For bug reports, find the root cause before you propose a fix.
- Use context7 docs lookup for external libraries when it is available, instead of assuming APIs.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

AtlasMind is a conversational BI app for MongoDB: a user connects their own MongoDB database, asks questions in natural language (text or voice), and the server has a Groq-hosted LLM generate an aggregation pipeline. The pipeline is safety-checked, run against the user's DB, and returned with a chart type and an explanation. It has two independent npm packages: `server/` (Express, CommonJS) and `client/` (React 19 + Vite, ESM). There is no root package.json.

## Commands

Server (`cd server`):
- `npm run dev`: nodemon on port 3001 (needs `server/.env`; see `server/.env.example`: `MONGODB_URI`, `GROQ_API_KEY`, `ENCRYPTION_KEY` (64 hex chars), `JWT_SECRET`, optional `CORS_ALLOWED_ORIGINS`)
- `npm test`: Jest (`jest --verbose`). CI runs this on Node 24 when `server/**` changes
- Single test: `npx jest src/__tests__/routesSmoke.test.js` or `npx jest -t "test name"`
- `npm run test:coverage`, `npm run seed` (seeds the `sample_sales` collection)

Client (`cd client`):
- `npm run dev`: Vite on 5173; proxies `/api` to `localhost:3001`
- `npm test`: Vitest unit tests (`src/**/*.test.js`, node environment); single file: `npx vitest run src/lib/conversation.test.js`
- `npm run build`, `npm run lint` (ESLint flat config), `npm run test:e2e` (Playwright, `client/tests/e2e/`; `chat.spec.ts` stubs `/api` with fixtures from `src/lib/__fixtures__/`, so it needs no server)
- CI runs lint, unit tests, build and the Playwright specs when `client/**` changes. The client deploys to Netlify; only the server gets a Docker image
- `VITE_SERVER_URL` sets the API base URL; it defaults to same-origin `/api/`

`start.bat` starts both dev servers in separate windows (Windows).

The ambiguity research (`eval2/`, `paper/`, `evaluation_progress/`, benchmark runners) lives on the `research/ambiguity-eval` branch, not on `main`. These paths are gitignored here.

## Architecture

### Two kinds of database
- **Central DB** (`server/src/db/connection.js`, fixed DB name `aggregatorflow_db`, from `MONGODB_URI`): app state only. It holds `user_connections` (users' encrypted connection strings), `workspaces`, `query_history`, `dashboards`, `few_shot_examples`, and `approval_tokens` (single-use write-approval `jti`s). The internal-collection list is `db/systemCollections.js`; do not copy it.
- **Tenant stores** (`server/src/stores/`): `queryHistoryStore` and `dashboardStore` are the only code that touches `query_history` and `dashboards`. They require a `connectionId` and throw `TenantRequiredError` without one (fail closed, ADR 0003). Few-Shot Memory (`services/fewShotRetriever.js`) applies one tenant filter on every search path.
- **User DBs**: the databases users connect. `routes/connections.js` validates the URI, AES-256 encrypts it (`utils/encryption.js`), upserts it through `models/UserConnection.js`, evicts any pooled client, and issues the session cookie. `services/userDbPool.js` caches one `MongoClient` per `connectionId` (LRU, idle TTL, concurrent misses deduped). Always get user DB handles with `getUserDb(connectionId)`. Do not open new long-lived clients; the only exception is the short-lived client for a connection string that is not stored yet (`openTemporaryClient` in `services/databaseDiscovery.js`, used by `/connect` and `/databases`). Schema and user-collection lookups go through `services/tenantSchema.js` (`getSchema(connectionId)`), which keys the schema cache by tenant.

### Auth
There are no user accounts. A session is a "connected DB". `auth/session.js` owns the `am_token` cookie (name, options, 7-day JWT) and the 10-minute Write Approval Token; nothing else reads `JWT_SECRET` or sets the cookie. `middleware/auth.js` (`requireAuth`) uses it to set `req.connectionId`. In `index.js`, `/api/auth` and `/api/connections` are public (with the auth rate limiter). `/api/query`, `/api/voice`, `/api/schema`, `/api/dashboard`, `/api/workspaces`, and `/api/scope` are protected. The client sends cookies with `withCredentials: true` (`client/src/services/api.js`). In production, cookies use `sameSite: none` and `secure`, and CORS needs an explicit allow-list.

### NL → MQL pipeline (the core flow)
`routes/query.js` (`POST /`, `POST /approve`) and `routes/voice.js` are thin HTTP adapters over `services/queryExecutionEngine.js` (ADR 0001). The engine's interface is `executeNaturalLanguageQuery(params)` and `executeApprovedWrite(params)`. It returns a typed `QueryOutcome` (`success` / `clarification_required` / `approval_required` / `safety_blocked`) or throws a typed `QueryEngineError`; anything else is wrapped as `ExecutionError` (500), an upstream 429 as `RateLimitError`. `routes/engineHttp.js` maps both to HTTP. Voice transcribes at the route, then calls the engine with `source: 'voice'`. Inside the engine:
1. Effective Scope: `effectiveScope.resolve` checks the requested collections (or a workspace's) against the tenant's real collections, failing closed on an unknown or emptied workspace
2. `schemaProfiler` via the Tenant Schema cache, plus `fewShotRetriever` (Few-Shot Memory) examples
3. `ambiguityGate.decide(...)`: write-intent and user bypass, clarification validation and prompt enrichment, the deterministic vague-term check. It can return a clarification instead of generating.
4. `groqService.generateMQL`: prompt from `prompts/systemPrompt.js`. Default model is `openai/gpt-oss-120b` at temperature 0.1, falling back to the default if a picked model fails. `ambiguityGate.reviewModelQuestions` only shows LLM-asked questions whose options are real schema fields. `interpretationComplianceVerifier` checks (advisory only) that the sort/metric matches the chosen clarification.
5. `safetyGuard`: `validateCollectionName` blocks `system`/`admin`/`local`/`config`; `validatePipeline` walks the pipeline against `BLOCKED_STAGES`/`BLOCKED_OPERATORS`/hard-denied code operators. Write stages (`isWrite`) are staged for human-in-the-loop approval: the engine returns a Write Approval Token, and `POST /api/query/approve` executes the write once.
6. `queryExecutor.executePipeline`: always re-applies the safety guard itself (writes only with `approvedWrite`), runs on the user DB, and the result is recorded via `queryHistoryStore` and Few-Shot Memory

Research switches never come from env vars or request bodies. In-process evaluation code passes an `experiment` (`services/experiment.js`, ADR 0002) to `executeNaturalLanguageQuery`.

Response envelope: `{ success: true, ... }` or `{ success: false, error: { code, message } }`. Query responses also carry fields the client uses: `aiMessage`, `pipeline`/`mql`, `collection`, `chartType`, `results`/`result`, `safetyStatus`, and `meta`. If you change a route, keep `client/src/services/api.js`, `client/src/lib/conversation.js` (and its fixtures in `client/src/lib/__fixtures__/`) and `docs/API.md` in sync.

### Client
The authenticated chat app lives in `client/src/components/app/` (`AppShell` > `ChatThread` and one `*Turn` component per message kind) and the marketing page in `components/landing/`; React Router pages are in `client/src/pages/` (Dashboard, SharedDashboard). Hooks are in `client/src/hooks/` (`useChat`, `useSchema`, `useAuth`, `useVoice`, `useWorkspaces`) and use the shared axios instance; only `useSchema` and `useWorkspaces` use TanStack Query. `useChat` holds the conversation state with the reducer from `lib/conversation.js` (the Conversation module), which is the only code that maps server responses to chat turns and reads the response field names; `ChatThread` only draws. `ChartRenderer.jsx` (Recharts) renders results based on the server's `chartType`. Shared Verdigris primitives are in `components/ui/vg/`; Tailwind colors are the `vg-*` tokens backed by the `--vg-*` CSS variables in `index.css`. Use relative imports (there is no `@` alias).

## Conventions
- Keep route handlers thin: put orchestration and business logic in `server/src/services`, and central-DB access in `server/src/stores`.
- Never weaken the read-only safety guard. Pipelines run only through `queryExecutor.executePipeline`, which applies `validateCollectionName` and `validatePipeline`. Writes go only through the approval-token flow (`approvedWrite`).
- Tenant data is always filtered by `connectionId`. Never write `connectionId ? { connectionId } : {}`; use a store, which fails closed.
- Do not add `process.env` research toggles to production modules or forward evaluation options from requests. Extend `ExperimentConfig` instead.
- Architecture vocabulary (module, interface, seam, depth, adapter) and domain terms are in `GLOSSARY.md`; decisions are in `docs/adr/`.

## Repo-specific agent rules
- "Do not break anything": check dependencies before changing existing code, and keep changes atomic.
- For bug reports, find the root cause before you propose a fix.
- Use context7 docs lookup for external libraries when it is available, instead of assuming APIs.

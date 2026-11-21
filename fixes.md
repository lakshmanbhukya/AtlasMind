# Fixes and improvements

This file tracks the improvements backlog. When you finish an item, update its status, add the commit hash, and move it to **Done**.

Status: `todo` · `in progress` · `done` · `won't do`. Effort: S (under an hour), M (half a day to a day), L (several days).

## Done

| ID | Fix | Commit | Notes |
|----|-----|--------|-------|
| F1 | Share links use a secret `shareToken` instead of the pin's ObjectId | `e389ca3` | New `POST /api/dashboard/:id/share`. Old `/shared/<ObjectId>` links no longer work, which is intended. Deleting a pin revokes its link. |
| F3 | Groq calls fail fast: SDK retries off, 30 s timeout (60 s for Whisper), 2 retries capped at 8 s | `de79051` | A 429 still maps to `RateLimitError` / HTTP 429. |
| F4 | The 1000-row result cap is always enforced, even when the pipeline has its own `$limit` | `721f69f` | Writes and nested `$facet`/`$lookup` pipelines are unaffected. |
| F6 | Dockerfile: Node 24, `npm ci --omit=dev`, non-root `node` user, `HEALTHCHECK` | `dc1ae0f` | |
| F7 | Indexes on `dashboards`: `{connectionId, pinnedAt}` and a unique sparse index on `shareToken` | `e389ca3` | Shipped with F1. |
| F2 | Length limit on the question text | (already existed) | `queryExecutionEngine.js` rejects questions over 2000 characters. |
| F5 | Protected collection names: exact `system`/`admin`/`local`/`config` and the `system.` namespace; databases exact `admin`/`local`/`config`. Names may contain `-` and `.` (no `..`, no trailing `.`, max 120 chars) | `f314a04` | `configurations`, `order-items`, `sales.2024` are now allowed. Database names keep the strict identifier regex (`$lookup.from.db`, `$merge.into.db`). |
| F12 | `llmLimiter`: 30 POSTs per 5 min per `connectionId` on `/api/query` and `/api/voice` (after `requireAuth`), code `too_many_requests`; `generalLimiter` raised to 300 per 15 min per IP | `5b140f2` | History GET/PATCH/DELETE under `/api/query` are not counted. |
| F14 | Connection strings encrypted with AES-256-GCM as `v2:<iv>:<tag>:<ct>`; the legacy CBC `iv:ct` format still decrypts | `0a021d9` | No migration: `/connect` re-encrypts on every upsert. |

## To do: quick wins (S)

| ID | Fix | Status | Where | Notes |
|----|-----|--------|-------|-------|
| F8 | Make error responses consistent: add `code` to the `connections.js` errors, and stop returning `error.message` on 500 in `dashboard.js` `sendDashboardError` | in progress | `server/src/routes/connections.js`, `server/src/routes/dashboard.js` | `connections.js` part done in `73b64c7` (codes documented in `docs/API.md`); `dashboard.js` part is plan 3. The leak in the public `sharedDashboard.js` was fixed in F1. |
| F13 | Security headers: `helmet` on the server, CSP and `X-Frame-Options` in `client/netlify.toml` | in progress | `server/src/index.js`, `client/netlify.toml` | Server part (helmet defaults) done in `ccada60`; `netlify.toml` part is plan 3. Test the CSP against the Recharts and GSAP inline styles. |

## To do: medium effort (M)

| ID | Fix | Status | Where | Notes |
|----|-----|--------|-------|-------|
| F9 | Split the client bundle (currently 1.18 MB, 371 KB gzipped): `React.lazy` for the landing, app and dashboard pages, and Recharts in its own chunk | todo | `client/src/main.jsx`, `client/src/App.jsx`, `client/vite.config.js` | |
| F10 | Keep only one animation library (GSAP or framer-motion) | todo | about 8 files in `client/src/components/landing/`, `InsightDashboard.jsx`, `DashboardPage.jsx` | |
| F11 | Run the client in CI: lint, unit tests, build, and the Playwright `chat.spec.ts` (needs no server) | todo | `.github/workflows/ci.yml` | |
| F15 | Include `dbName` in the `connectionId` hash so two sessions using the same URI with different databases don't overwrite each other | todo | `server/src/routes/connections.js` | Changes existing IDs, so a migration is needed. |

## To do: larger investments (L)

| ID | Fix | Status | Notes |
|----|-----|--------|-------|
| F16 | Stream LLM progress and explanations over SSE | todo | |
| F17 | Structured logging with pino and a request ID | todo | |
| F18 | Split `ambiguityGate.js` (1033 lines), `safetyGuard.js` and `queryExecutionEngine.js` by stage | todo | |
| F19 | `// @ts-check` plus JSDoc on the server | todo | |

## Follow-ups from finished work

| ID | Fix | Status | Notes |
|----|-----|--------|-------|
| F20 | Add a revoke endpoint for share links (`DELETE /api/dashboard/:id/share`) and a button for it in the UI | todo | Comes from F1. Today, deleting the pin is the only way to revoke a link. |
| F21 | `/connect` and `/databases`: a URI the driver cannot parse (e.g. `mongodb://host:notaport`) throws `MongoRuntimeError`, which `connectionFailed` doesn't recognise, so it returns 500 `connection_save_failed` instead of 400 | todo | Found during F8. Map driver parse errors to `validation_error` (400). |

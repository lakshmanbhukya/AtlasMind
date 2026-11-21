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
| F8 | Consistent error responses: `code` on every `connections.js` error; `dashboard.js` `sendDashboardError` returns the generic `Dashboard operation failed` on 500 (the 422 safety message is kept) | `73b64c7`, `6f4c908` | Server `connections.js` part from plan 2, `dashboard.js` part from plan 3. The public `sharedDashboard.js` leak was fixed in F1. |
| F13 | Security headers: `helmet` defaults on the server; `client/netlify.toml` sends `nosniff`, `Referrer-Policy`, `Permissions-Policy: microphone=(self)` and a Report-Only CSP | `ccada60`, `bf38172` | CSP has `frame-ancestors 'none'` on `/` and `/index.html`, none on `/shared/*` (embeddable widgets). Set per route, not on `/*`, because Netlify combines matching rules. Enforcing it is F22. |
| F9 | Client bundle split with `React.lazy` (landing, app shell, dashboards, shared view); Recharts lands in its own chunk | `123541b` | 1,179 kB / 371 kB gzip in one chunk → landing path 181 kB gzip (entry 119 + LandingPage 62), no 500 kB warning. `lazyWithReload` reloads once on a stale chunk; `optimizeDeps.include` avoids cold-start 504s in dev. |
| F10 | framer-motion removed; GSAP stays for the landing page. Dashboard enter/exit fades are CSS (`.vg-enter`, `.vg-enter-scale`) and respect `prefers-reduced-motion` | `f0eec5b` | Bundle went from 371 kB to 331 kB gzip before the split. |
| F11 | CI `client` job: lint, unit tests, build, Playwright e2e on Node 24. `dorny/paths-filter` runs each job only for its own folder | `1d033f6` | The image `release` job depends only on the server job. First run happens on the next push. |
| F20 | Revoke share links: `DELETE /api/dashboard/:id/share` (`dashboardStore.unshare`), and a "Stop sharing" button next to Share | `fa2b43c`, `442f239`, `2846dc3` | `GET /api/dashboard` now returns `shared: boolean` instead of the token. The remove button moved into `InsightDashboard`'s action row; empty pins now render so they stay removable. |
| F21 | `/connect` and `/databases` return 400 `validation_error` for a URI the driver cannot parse (e.g. `mongodb://host:notaport`) instead of 500 | `6af5fde` | `openTemporaryClient` wraps the synchronous `new MongoClient` throw in `InvalidConnectionStringError`. `mongodb-connection-string-url` was not used: it accepts a non-numeric port. |
| F22 | CSP enforced (`Content-Security-Policy`, no longer Report-Only) with `connect-src 'self' https://atlasmind-on2d.onrender.com` | `dc29fd1` | Checked in headless Chromium against the production build: no violations on `/` or `/shared/*`. If the API moves off Render, update all three CSP blocks in `client/netlify.toml`. |
| F15 | `connectionId` = `connectionIdFor(uri, dbName)`, so one cluster connected with two databases gives two separate sessions | `da81f33` | **Run the migration once after deploying:** `npm run migrate:connection-ids -- --dry-run`, then without the flag (see `docs/DEPLOYMENT.md`). Users reconnect once. If the migration is skipped, old history, dashboards and workspaces stay under the old ID. |
| F17 | pino JSON logging (`utils/logger.js`, `LOG_LEVEL`, default `info`) and `pino-http` with an `X-Request-Id` on every response; `requireAuth` adds `connectionId` to the request's log lines | `eb369a5`, `7bf1ad8` | All `console.*` in `routes/`, `services/`, `stores/`, `models/`, `db/connection.js`, `utils/` and `index.js` replaced; `db/seed.js` and migrations stay on `console`. Redacts URIs, cookies and auth headers; the raw LLM output and voice filenames are no longer logged. `/api/health` is not logged. |
| F19 | `// @ts-check` on every non-test server file except `db/seed.js`; `npm run typecheck` (`tsc -p .`, no emit) runs in CI before `npm test` | `dc3d7a8`, `170255b`, `290db5e`, `a6e347d`, `d8ed206` | TypeScript 7.0.2, `strict: false`, `checkJs: false`. Typedefs `QueryOutcome`, `ExecutionVerdict`, `PipelineCheck`, `ScopeOptions`, `AmbiguityDiagnostics`; `types/express.d.ts` declares `req.connectionId`. Only JSDoc and casts changed, no runtime code. |
| F18 | `ambiguityGate.js` → `services/ambiguity/` (5 modules), `safetyGuard.js` → `services/safety/` (5 + `types.js`), `queryExecutionEngine.js` → `services/engine/` (`naturalLanguageQuery`, `approvedWrite`, `shared`), each behind a façade with identical exports | `ffc973f`, `4340381`, `8712e8f` | Pure moves: tests unchanged, a line-multiset comparison shows only require/export boilerplate. The engine's steps 1–11 stay in one function (see F23). |
| F16 | `POST /api/query/stream`: stage progress over SSE (`scope` → `executing`), then one `result` event `{ status, body }` with the status `POST /api/query` would use; the client's text questions stream and show the stage | `05c3009`, `719d102`, `f30084d` | Stage progress only, no token streaming. `POST /api/query` and voice unchanged. Verified on a local server with curl; still to confirm that Render doesn't batch the events after deploy (add a row if it does). |

## To do: quick wins (S)

| ID | Fix | Status | Where | Notes |
|----|-----|--------|-------|-------|

## To do: medium effort (M)

| ID | Fix | Status | Where | Notes |
|----|-----|--------|-------|-------|

## To do: larger investments (L)

| ID | Fix | Status | Notes |
|----|-----|--------|-------|

## Follow-ups from finished work

| ID | Fix | Status | Notes |
|----|-----|--------|-------|
| F23 | Split `runNaturalLanguageQuery` (`services/engine/naturalLanguageQuery.js`, ~500 lines) into per-stage modules (scope, context, ambiguity, generation, verdict, execute) | todo | Found in F18: steps 1–11 share about ten mutable locals (timings, `gateInfo`, `safetyInfo`, `currentLlmResult`, `clarificationSource`, `complianceInfo`) and the `buildOutcomePayload`/`clarificationOutcome` closures, and several steps return early. Needs a per-query run-context object, a behaviour-sensitive rewrite rather than a move, so it was left out of the pure-move rule. Pin the response shapes with tests first. |

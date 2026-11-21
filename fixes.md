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

## To do: quick wins (S)

| ID | Fix | Status | Where | Notes |
|----|-----|--------|-------|-------|
| F5 | Narrow the protected collection-name check: match exact names and the `system.` namespace, and allow `-` and `.` in names | todo | `server/src/services/safetyGuard.js` (`isProtectedName`, `IDENTIFIER_RE`) | `configurations`, `systems`, `order-items` and `sales.2024` are currently blocked. The tests mark prefix matching as intentional, so this is a product decision. |
| F8 | Make error responses consistent: add `code` to the `connections.js` errors, and stop returning `error.message` on 500 in `dashboard.js` `sendDashboardError` | todo | `server/src/routes/connections.js`, `server/src/routes/dashboard.js` | The leak in the public `sharedDashboard.js` was fixed in F1. |
| F13 | Security headers: `helmet` on the server, CSP and `X-Frame-Options` in `client/netlify.toml` | todo | `server/src/index.js`, `client/netlify.toml` | Test the CSP against the Recharts and GSAP inline styles. |

## To do: medium effort (M)

| ID | Fix | Status | Where | Notes |
|----|-----|--------|-------|-------|
| F9 | Split the client bundle (currently 1.18 MB, 371 KB gzipped): `React.lazy` for the landing, app and dashboard pages, and Recharts in its own chunk | todo | `client/src/main.jsx`, `client/src/App.jsx`, `client/vite.config.js` | |
| F10 | Keep only one animation library (GSAP or framer-motion) | todo | about 8 files in `client/src/components/landing/`, `InsightDashboard.jsx`, `DashboardPage.jsx` | |
| F11 | Run the client in CI: lint, unit tests, build, and the Playwright `chat.spec.ts` (needs no server) | todo | `.github/workflows/ci.yml` | |
| F12 | Rate-limit `/api/query` and `/api/voice` per `connectionId` instead of per IP | todo | `server/src/middleware/rateLimiter.js` | The current limit is 100 requests per 15 min per IP across all of `/api`, which users behind a shared NAT will hit. |
| F14 | Encrypt stored connection strings with AES-256-GCM instead of CBC | todo | `server/src/utils/encryption.js` | Use a `v2:` prefix and keep decrypting the old format. |
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

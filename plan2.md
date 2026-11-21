# Plan 2: Server hardening (batch 1 of 2)

**Fixes:** F5, F8 (`connections.js` part), F12, F13 (server part), F14 from `fixes.md`
**Branch:** `fix/server-hardening`, created from `fix/quick-wins` (or from `main` once that branch is merged)
**Runs in parallel with:** `plan3.md`. The two plans never edit the same file; see the file list below.

## How to run this plan (for the agent)
Work through these steps in order without stopping for confirmation. Ask the user only if a step fails in a way this file doesn't cover.

1. **Prerequisite.** From the repo root (`C:\Users\laxman\projects\AtlasMind`), run `git merge-base --is-ancestor e389ca3 main`. If it fails, stop and tell the user: "Merge fix/quick-wins into main first."
2. **Worktree.** Run `git worktree add ../AtlasMind-server -b fix/server-hardening main`. If the branch already exists, run `git worktree add ../AtlasMind-server fix/server-hardening`, or reuse the folder if it's already there. Do all remaining work inside `C:\Users\laxman\projects\AtlasMind-server`.
3. **Install.** Run `cd server && npm ci`. Copy `C:\Users\laxman\projects\AtlasMind\server\.env` to `server/.env` in the worktree. `.env` is gitignored, so never commit it.
4. **Baseline.** Run `npm test` in `server/`. It must pass before you change anything; if it doesn't, stop and report.
5. **Implement** each fix below, in order. Make one commit per fix, run `npm test` before each commit, and end each commit message with the repo's attribution line. Use these **default decisions** instead of asking the user:
   - F5: apply the recommended rule as written.
   - F12: use about 30 requests per 5 minutes per connection.
6. **Finish:**
   - Run the Verification steps.
   - Review your own diff with `git diff main...HEAD` and look for broken CLAUDE.md conventions (tenant filtering, the safety guard, the response envelope).
   - Update `fixes.md` and commit it.
   - Merge into main from the root checkout: `git -C C:/Users/laxman/projects/AtlasMind checkout main && git -C C:/Users/laxman/projects/AtlasMind merge --no-ff fix/server-hardening`. If `fixes.md` or `docs/API.md` conflicts with plan 3's merge, keep both sides' changes. If the root checkout has uncommitted changes, skip the merge and tell the user.
   - Finally, report to the user: what was done, commit hashes, test results, and the defaults you used.

## Context
`fixes.md` tracks what's left after the quick wins. This batch is server-only hardening: clearer validation rules, a consistent error envelope, rate limits that match cost, security headers, and authenticated encryption for stored connection strings.

## Files this session owns
`server/src/services/safetyGuard.js`, `server/src/routes/connections.js`, `server/src/middleware/rateLimiter.js`, `server/src/index.js`, `server/src/utils/encryption.js`, `server/package.json`, and their tests.

**Do not edit:** `server/src/routes/dashboard.js`, `server/src/stores/dashboardStore.js`, anything under `client/`, or `.github/`. Plan 3 owns those.

**Shared files:** in `fixes.md`, edit only the rows for this batch (F5, F8, F12, F13, F14). In `docs/API.md`, edit only the sections named below.

Make one commit per fix, and run `cd server && npm test` before each commit.

---

## F5. Narrow the protected collection-name rule (S)
Right now `isProtectedName` matches on a prefix, so `configurations`, `systems` and `administrators` are blocked. `IDENTIFIER_RE` also rejects `-` and `.`, which blocks `order-items` and `sales.2024`. The tests mark the prefix behavior as intentional, but the user has accepted the change below as the default. Update those tests to match.

Recommended rule, in `server/src/services/safetyGuard.js`:
- Protected **database** names: exact match on `admin`, `local` and `config`.
- Protected **collection** names: anything starting with `system.` (MongoDB's reserved namespace) or exactly equal to `system`, `admin`, `local` or `config`.
- Allowed names: `/^[A-Za-z_][A-Za-z0-9_.-]*$/`, with no `..`, no trailing `.`, and a maximum of 120 characters. MongoDB itself forbids `$` and null characters, and the regex already excludes them.
- `isProtectedName` is also used for `$merge.into.db` (around line 910). Keep the database check strict there.
- Tests: rewrite the prefix tests in `scopeValidationAndSafety.test.js` and `safetyGuardHardDeny.test.js` (search for `system_`/`config_`). Add cases: `configurations` allowed, `system.users` blocked, `order-items` allowed, `a..b` blocked.
- The internal-collection list in `db/systemCollections.js` is a separate check. Don't change it.

## F8a. Consistent error envelope in `connections.js` (S)
Every `error: { message }` in `server/src/routes/connections.js` (lines ~38–180) gets a `code`:
`validation_error` (bad URI or missing dbName), `connection_failed` (cannot reach MongoDB), `connection_save_failed`, `list_databases_failed`, `not_found`, `connection_fetch_failed`.
- The client only reads `error.message` on the connect form, so this change is additive. Confirm with `grep -rn "error?.code" client/src` and don't edit the client.
- Add the codes to the `/api/connections` section of `docs/API.md`.
- Test: extend `connections.test.js` to assert `error.code` on the 400 and 500 paths.

## F12. Rate-limit expensive routes per connection (M)
- `server/src/middleware/rateLimiter.js`: add `llmLimiter`. It is keyed on `req.connectionId` (`keyGenerator: (req) => req.connectionId`), with roughly 30 requests per 5 minutes and the same response envelope using code `too_many_requests`. Look up the express-rate-limit v8 docs (context7) for the `keyGenerator` validation flags so it doesn't warn about IPv6.
- `server/src/index.js`: mount it after `requireAuth`: `app.use("/api/query", requireAuth, llmLimiter, queryRoutes)`, and do the same for `/api/voice`.
- Raise `generalLimiter` from 100 to about 300 per 15 minutes per IP. It stays as a coarse flood guard.
- Test: a new `rateLimiter.test.js` uses supertest against a tiny express app, checks that two connectionIds have separate budgets, and checks that the 31st request returns 429.

## F13a. Security headers on the API (S)
- `npm i helmet` in `server/`. In `index.js`, call `app.use(helmet())` before `cors`.
- The API only returns JSON, so helmet's defaults are fine. Check that `crossOriginResourcePolicy` doesn't break the cross-site client; if it does, set it to `{ policy: 'cross-origin' }`, since the client is on Netlify and the API on another origin.
- Test: `routesSmoke.test.js` checks that `/api/health` has `x-content-type-options: nosniff`.

## F14. Encrypt connection strings with AES-256-GCM (M)
`server/src/utils/encryption.js`:
- `encrypt` writes `v2:<iv 12B hex>:<authTag hex>:<ciphertext hex>` using `aes-256-gcm`.
- `decrypt`: a `v2:` prefix goes through the GCM path (`setAuthTag`), and the old two-part `iv:ct` format still decrypts with CBC. That way existing stored values keep working.
- No migration script is needed: `/connect` re-encrypts on every upsert, so values move to v2 as users reconnect.
- `hashString` is unchanged.
- Tests in `encryption.test.js`: a v2 round-trip; a legacy CBC string (built inline with `crypto`) still decrypts; a modified v2 ciphertext or tag throws.

---

## Verification
1. `cd server && npm test`: everything passes, including the new tests.
2. Start the server from the worktree (`cd server && npm run dev`, in the background). Run `curl -i http://localhost:3001/api/health` and confirm the `X-Content-Type-Options: nosniff` header is there. Stop the server when you're done. Port 3001 is shared with the other session, so if it's busy, set `PORT=3002`.
3. Make sure the 429 path is covered by `rateLimiter.test.js`, and the legacy CBC decrypt path by `encryption.test.js`. Both are automated, so you don't need a browser.
4. Make sure the F5 tests cover `order-items` (allowed) and `system.users` (blocked).
5. Set F5, F8, F12, F13 and F14 to `done` in `fixes.md` with their commit hashes. Note that F8 also has a `dashboard.js` part in plan 3, and F13 a `netlify.toml` part; mark each of those done only when both parts are finished.

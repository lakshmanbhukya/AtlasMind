# Plan 4: Remaining fixes (F21, F22, F15, F17, F19, F18, F16)

**Fixes:** F15, F16, F17, F18, F19, F21, F22 from `fixes.md`
**Base:** `main` (plans 2 and 3 are merged)
**Runs:** one phase at a time, in order. The later phases touch the same server modules (`queryExecutionEngine.js`, `safetyGuard.js`, routes), so they can't run in parallel.

## Status tracking
Update this table as you go: set the status when a fix starts and when it finishes, and add its commit hashes. It's the one place to check progress. `fixes.md` gets updated only when a fix is `done`.

Status: `todo` · `in progress` · `blocked` · `done` · `won't do`

| Phase | ID | Fix | Effort | Branch | Status | Commits | Notes |
|-------|----|-----|--------|--------|--------|---------|-------|
| 1 | F21 | Driver URI parse errors → 400 `validation_error` | S | `fix/uri-validation` | done | `6af5fde` | Validated with the driver itself (`InvalidConnectionStringError` in `openTemporaryClient`): `mongodb-connection-string-url` accepts `host:notaport`, so the default below didn't work |
| 1 | F22 | Narrow CSP `connect-src` and enforce it | S | `fix/uri-validation` | done | `dc29fd1` | API origin `https://atlasmind-on2d.onrender.com`; no violations in headless Chromium on `/` and `/shared/*` |
| 2 | F15 | `dbName` in the `connectionId` hash, plus a migration | M | `fix/connection-id-db` | todo | | Run the migration only with the user's go-ahead |
| 3 | F17 | pino structured logging with a request ID | L | `feat/structured-logging` | todo | | |
| 4 | F19 | `// @ts-check` and JSDoc on the server, plus a `typecheck` CI step | L | `chore/server-ts-check` | todo | | |
| 5 | F18 | Split `ambiguityGate.js`, `safetyGuard.js` and `queryExecutionEngine.js` by stage | L | `refactor/split-by-stage` | todo | | Behaviour must not change |
| 6 | F16 | Stream query progress over SSE | L | `feat/query-sse` | todo | | |

**Progress log** (add one line per session: date, phase, result):
- 2026-11-21, phase 1: F21 and F22 done on `fix/uri-validation`. Server 432/432 tests, client lint, 29 unit, build and 11 e2e pass.
- 2026-11-21: checked phases 2–6 against the code and corrected them (see Review notes). Next session: start phase 2 (F15).

## How to run this plan (for the agent)
Work through the phases in order without stopping for confirmation. Ask the user only where a phase says to, or when a step fails in a way this file doesn't cover.

1. **Per phase:** create the branch from up-to-date `main` in a worktree: `git worktree add ../AtlasMind-p4 -b <branch> main`. Reuse the folder if it's already there. Run `npm ci` in `server/` (and in `client/` for phases 1 and 6), and copy `server/.env` from the root checkout. Never commit `.env`.
2. **Baseline:** `cd server && npm test` must pass, plus `cd client && npm run lint && npm test && npm run build` for phases that touch the client. If the baseline fails, stop and report.
3. **Implement:** one commit per fix (or per logical step for the L items). Run the tests before each commit. End each commit message with the repo's attribution line. Look up external libraries (pino, pino-http, TypeScript, mongodb-connection-string-url) with context7.
4. **Finish each phase:** review `git diff main...HEAD` against the CLAUDE.md conventions (tenant filtering through stores, the safety guard, the response envelope, keeping `api.js`, `conversation.js` and `docs/API.md` in sync). Update the status table here and the row in `fixes.md`, then commit. Merge with `git -C C:/Users/laxman/projects/AtlasMind merge --no-ff <branch>`, but skip the merge if the root checkout has uncommitted changes. Remove the worktree.
5. **Do not push.** The user pushes, which runs CI and releases the image.
6. **Report:** what was done, commit hashes, test results, and the defaults you used.

**Default decisions** (use these instead of asking):
- F15: migrate with a one-off idempotent script that has a dry-run mode. Old sessions already fall back to the connect screen through `/api/auth/me`.
- F17: `pino` plus `pino-http`. In dev, pretty-print by piping through `pino-pretty`; production gets plain JSON lines.
- F19: opt in per file with `// @ts-check` and `checkJs: false`.
- F18: pure moves behind façade files whose exports stay identical.
- F16: stream **stage progress** plus one final `{ status, body }` result; no token streaming. `POST /api/query` stays unchanged.

---

## Phase 1

### F21. URIs the driver can't parse return 400 (S)
In `server/src/routes/connections.js`, `isMongoUri` only checks the scheme, so `mongodb://host:notaport` gets through. The driver then throws `MongoRuntimeError`, which `connectionFailed` doesn't match, so the route returns 500 `connection_save_failed`.
- Add `mongodb-connection-string-url` as a direct dependency. It's already installed through `mongodb`; pin the same major. Replace `isMongoUri` with `parseMongoUri(s)`, which returns `true` only when `new ConnectionString(s)` doesn't throw. Use it in both `/connect` and `/databases`. Both 400 messages stay as they are.
- Keep `connectionFailed` as it is, so it still maps unreachable hosts to `connection_failed`.
- Tests: in `connections.test.js` and `connectionsDatabases.test.js`, `mongodb://host:notaport` returns 400 `validation_error` from both routes, and no client is opened (assert that `openTemporaryClient` and `discoverDatabases` aren't called).
- `docs/API.md`: note that `validation_error` also covers a URI that can't be parsed.

### F22. Narrow and enforce the CSP (S, done: origin `https://atlasmind-on2d.onrender.com`)
- **Ask the user** for the production API origin (the `VITE_SERVER_URL` value on Netlify). If they don't have it yet, leave F22 `blocked`, finish F21, and move on.
- In `client/netlify.toml`, on the three CSP blocks (`/`, `/index.html` and `/shared/*`), change `connect-src 'self' https:` to `connect-src 'self' <api-origin>` and rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy`. Keep `frame-ancestors 'none'` on `/` and `/index.html` only. Update the comment block.
- Check: `npm run build && npx netlify-cli dev` if it's available, or `npx vite preview` with the same headers. Load the landing page, the app and a `/shared/<token>` page, and confirm the console shows no CSP errors (Google Fonts, the GSAP inline styles, Recharts, and the voice `blob:` media).

## Review notes for phases 2–6 (checked against the code on 2026-11-21)
These notes record where the first draft of this plan was wrong and how the phase text below was corrected.

| Phase | Plan said | Code shows | Change |
|---|---|---|---|
| F15 | Old sessions would 500, so map an unknown ID to 401 | `/api/auth/me` (`routes/auth.js:20`) already returns 401 `connection_not_found` and clears the cookie, and the client calls it on every load (`useAuth.checkSession`). The engine's `toEngineError` already maps `userDbPool`'s 404 to `connection_not_found` 404. | Drop that step. Just add a test that pins the existing behaviour. |
| F15 | Re-key 4 collections | Approval tokens (JWTs) embed `connectionId`, so in-flight ones fail the ownership check after migration (10-minute life) | Note it. Nothing to change. |
| F17 | Replace about 83 `console.*` calls | 16 of them are in `db/seed.js` (a CLI script). `index.js` has its own dev request logger. Tests spy on `console` only to keep it quiet, never asserting on it. | Keep `seed.js` and migration scripts on `console`. Replace the dev logger with `pino-http`. Leave the test spies alone. |
| F18 | Façade keeps `executeNaturalLanguageQuery` | The engine exports `class QueryExecutionEngine` (static methods), and `ambiguityGate` also exports `internals`, which tests import | The façades keep exactly `{ QueryExecutionEngine }` and `{ decide, reviewModelQuestions, recordGeneration, getAmbiguityMetrics, resetAmbiguityMetrics, DEFAULT_VAGUE_TERMS, internals }`. The engine already has numbered steps 1–11, which become the stage boundaries. |
| F16 | Stream a `result` event with the same envelope | `safety_blocked` uses HTTP **422**, and `conversation.js` (`blockedBodyFromError`) reads `err.response.status` and `err.response.data`. An SSE stream always replies 200. Errors raised before the stream starts (a `llmLimiter` 429, or a 401) arrive as plain JSON. | The `result` event carries `{ status, body }`. `streamQuery` resolves for 2xx and otherwise rejects with an axios-shaped `{ response: { status, data } }`, so the reducer's `failed` and `answered` paths stay unchanged. `pending` is a `Source` string, so progress goes in a new `pendingStage` field. |
| F19 | Opt-in per file | No file has `@ts-check` yet, and only `experiment.js` and `ambiguityGate.js` have typedefs. `mongodb`, `groq-sdk`, `helmet` and `express-rate-limit` ship their own types. | Leave `__tests__` and `db/seed.js` out of `tsconfig`. |

## Phase 2
### F15. Add `dbName` to the `connectionId` (M)
Today `/connect` computes `connectionId = hashString(connectionString)` (`routes/connections.js:74`, the only caller). Reconnecting to the same URI with a different `dbName` therefore overwrites the earlier session's `dbName`.
- **Helper:** in `utils/encryption.js`, add `connectionIdFor(uri, dbName)`, which returns `hashString(`${uri}\u0000${dbName}`)`, and use it in `/connect`. Leave `hashString` unchanged. Update the `UserConnection.js` JSDoc ("hash of the connection string and database name"). The `evictUserDb` call after the upsert stays.
- **Migration script:** `server/src/db/migrations/001-connection-id-with-db.js`, run with `npm run migrate:connection-ids -- [--dry-run]`.
  - Use `connectToDatabase` from `db/connection.js` and `decrypt` from `utils/encryption.js`.
  - For each `user_connections` doc, compute `connectionIdFor(decrypt(encryptedUri), dbName)`. Skip the doc if it already has that ID, which makes the script idempotent.
  - Re-key the tenant data with `updateMany({ connectionId: old }, { $set: { connectionId: new } })` on `query_history`, `dashboards`, `workspaces` and `few_shot_examples`. The filter matches only that exact ID, so global seeds (`null` or missing `connectionId`) are never touched. Then update the `user_connections` doc itself.
  - A new ID has no existing rows, so the unique index on `workspaces` `{connectionId, name}` can't collide.
  - In dry-run mode, print per-connection counts only, never URIs.
  - This is a one-off ops script, so it reads the collections directly. The stores stay the only runtime path.
- **Do not run the migration against the real central DB.** Give the user the dry-run command and the real command. Running it is their call.
- **Existing behaviour to keep and pin with tests:**
  - A session with a migrated (unknown) ID gets 401 `connection_not_found` from `/api/auth/me`, with the cookie cleared.
  - Queries get 404 `connection_not_found` (`toEngineError`).
  - An in-flight write-approval token stops working, which is acceptable.
- **Tests:**
  - `connectionIdFor` differs by `dbName` and is stable.
  - `/connect` with the same URI and two `dbName`s upserts two IDs (extend `connectionsDatabases.test.js`).
  - The migration test (export a `migrate(db, { dryRun })` function and mock the collections) checks that it re-keys all four collections, writes nothing in dry-run mode, and is a no-op on a second run.
  - `/api/auth/me` with an unknown ID returns 401 `connection_not_found` (add it to `connections.test.js` or `routesSmoke.test.js` if it isn't covered yet).
- **Docs:** in `docs/DEPLOYMENT.md`, add "after deploying F15, run the migration once (dry-run first)". In `fixes.md`, note that every user reconnects once if the migration is skipped.

## Phase 3

### F17. Structured logging with pino (L)
- **Logger module:** install `pino` and `pino-http`, plus `pino-pretty` as a dev dependency (check versions with context7). Add `server/src/utils/logger.js`, which exports one root logger:
  - The level comes from `LOG_LEVEL`, defaulting to `info`. It's `silent` when `JEST_WORKER_ID` is set.
  - `redact` covers `connectionString`, `encryptedUri`, `*.uri`, `req.headers.cookie`, `req.headers.authorization` and `res.headers["set-cookie"]`.
  - `LOG_LEVEL` is operational config, not a research toggle.
- **`index.js`:**
  - Mount `pino-http` before `helmet`, in place of the dev-only request logger (`index.js` around line 85).
  - `genReqId` reuses an incoming `x-request-id` that matches `/^[\w-]{1,64}$/`, and otherwise uses `crypto.randomUUID()`.
  - Set `X-Request-Id` on the response.
  - Skip auto-logging for `/api/health`, since the Docker `HEALTHCHECK` hits it.
  - The final error handler logs with `req.log.error({ err })`.
- **`middleware/auth.js`:** after `readSession`, set `req.log = req.log.child({ connectionId })` when `req.log` exists, so unit tests that mount routers without pino still work.
- **Replace `console.*`** in `routes/`, `services/`, `stores/`, `models/`, `db/connection.js`, `utils/dnsConfig.js` and `index.js`:
  - Use `req.log` in route handlers and `logger.child({ module: '<name>' })` elsewhere.
  - Map `console.error` → `error`, `warn` → `warn`, and `log` → `info` or `debug`.
  - Pass errors as `{ err }`.
  - Never log question text or URIs.
  - Keep `db/seed.js` and `db/migrations/*` on `console`, since they're CLI tools.
  - The tests' `jest.spyOn(console, ...)` calls only silence output and assert nothing, so leave them in place.
- **`package.json`:** change `"dev"` to `nodemon src/index.js | pino-pretty`; npm scripts run in cmd on Windows, where `|` works. `start` stays plain JSON.
- **Tests:**
  - In `routesSmoke.test.js` (which already does `require('../index')`): `/api/health` returns an `X-Request-Id`, and an incoming `x-request-id: abc-123` is echoed back.
  - In a new `logger.test.js`: build the logger with a destination stream and check that `{ connectionString: 'mongodb://u:p@h' }` is logged as `[Redacted]`.
- **Docs:** add `LOG_LEVEL` to `server/.env.example`, `docs/DEPLOYMENT.md` and `docs/TROUBLESHOOTING.md` (where it covers finding a request by `X-Request-Id`).

## Phase 4

### F19. `// @ts-check` and JSDoc on the server (L)
- **Setup:**
  - Dev dependencies: `typescript`, `@types/node`, `@types/express`, `@types/jsonwebtoken`, `@types/cookie-parser`, `@types/cors` and `@types/multer`. `mongodb`, `groq-sdk`, `helmet`, `express-rate-limit` and `pino` ship their own types.
  - Add `server/tsconfig.json` with `allowJs: true`, `checkJs: false`, `noEmit: true`, `module: "commonjs"`, `target: "es2022"`, `strict: false`, `skipLibCheck: true`, `include: ["src"]` and `exclude: ["src/__tests__", "src/db/seed.js"]`.
  - Add the script `"typecheck": "tsc -p ."`.
- **Groups**, one commit each, adding `// @ts-check` and fixing the errors:
  1. `utils/`, `auth/` and `middleware/`
  2. `stores/`, `models/` and `db/`
  3. `safetyGuard.js` and `queryExecutor.js`
  4. `engineErrors.js`, `experiment.js` and `queryExecutionEngine.js`
  5. the rest of `services/`, then `routes/` and `index.js`
- **Typedefs:** add `QueryOutcome` (`{ type: 'success'|'clarification_required'|'approval_required'|'safety_blocked', data }`) and `ExecutionVerdict` next to `classifyExecution`. Reuse the existing `ExperimentConfig` typedef in `experiment.js`.
- **Rule:** fix type errors only with JSDoc, casts (`/** @type {...} */`) or narrowing that doesn't change runtime behaviour. Every existing test must pass unchanged.
- **CI:** in `.github/workflows/ci.yml`, add `npm run typecheck` before `npm test` in the `build-and-test-server` job. Also note it in CLAUDE.md under Commands.
- **Done when** every non-test file under `server/src` except `db/seed.js` starts with `// @ts-check` and `npm run typecheck` exits 0.

## Phase 5

### F18. Split the large modules by stage (L, no behaviour change)
- **`ambiguityGate.js`** (1033 lines) becomes `services/ambiguity/`:
  - `vagueTerms.js`: `DEFAULT_VAGUE_TERMS`, `IDIOMATIC_COLLOCATIONS`, `toVagueTermSet`, write intent, `toLabel`, `extractNumericFields` and `getFieldMetadata`
  - `analysis.js`: the detectors, `queryAlreadyNamesSpecificField`, `analyzeAmbiguity` and `checkDeterministicAmbiguity`
  - `clarifications.js`: `validateModelClarification`, `validateClarifications` and `buildEnrichedQuery`
  - `metrics.js`: the metrics store, `recordAmbiguityMetric`, `getAmbiguityMetrics` and `resetAmbiguityMetrics`. It holds the module-level state, so there's exactly one instance.
  - `decide.js`: `decide`, `reviewModelQuestions` and `recordGeneration`

  `ambiguityGate.js` becomes a façade with the **same** `module.exports`, including `internals` with all 16 keys, because `ambiguity.test.js` and `ambiguityGate.test.js` import them.
- **`safetyGuard.js`** (966 lines) becomes `services/safety/`:
  - `operators.js`: `BLOCKED_STAGES`, `BLOCKED_OPERATORS`, the hard-deny list, `findHardDenyOperator` and `findBlockedOperator`
  - `names.js`: `isProtectedDatabaseName`, `isProtectedCollectionName`, `isValidCollectionName`, `validateCollectionName` and `describeCollectionBlock`
  - `references.js`: `extractAndValidateCollectionReferences`
  - `pipeline.js`: `validateStagesRecursively`, `validatePipelineCore`, `validatePipeline`, `describeBlock`, `locateReference` and `firstKey`
  - `verdict.js`: `describeWrite`, `parseWriteTarget`, `splitFinalWrite`, `checkReadPart`, `blockedVerdict` and `classifyExecution`

  The façade keeps exactly `{ classifyExecution, describeCollectionBlock, describeWrite, validatePipeline, validateCollectionName }`.
- **`queryExecutionEngine.js`** (751 lines): move the numbered steps of `runNaturalLanguageQuery` into `services/engine/`:
  - `input.js`: validation and the experiment seam
  - `scope.js`: steps 1–2
  - `context.js`: step 3
  - `ambiguity.js`: step 4
  - `generation.js`: steps 5–7.5
  - `verdict.js`: step 8
  - `execute.js`: steps 9–11
  - `approvedWrite.js`: `runApprovedWrite`

  The façade keeps `class QueryExecutionEngine`, `toEngineError` and `normalizeParams`, and exports exactly `{ QueryExecutionEngine }`. Stage modules require `../groqService`, `../userDbPool` and so on, which resolve to the same files, so the `jest.mock('../services/...')` calls in `queryExecutionEngine.test.js` still apply.
- **Rules:**
  - Each commit moves one module, with no edits beyond `require` paths.
  - Every existing test passes **unchanged**; run `git diff main -- src/__tests__` and expect it to be empty.
  - Don't duplicate `BLOCKED_*`, `SYSTEM_COLLECTIONS` or the vague-term lists.
  - Every new file has `// @ts-check` from F19, and `npm run typecheck` passes.
  - Run `wc -l` before and after; the total line count should grow only by `require`/`module.exports` boilerplate.
- **Docs:** update CLAUDE.md (the steps 3 and 5 paragraphs that name `ambiguityGate` and `safetyGuard`), `docs/ARCHITECTURE.md`, and `GLOSSARY.md` if it names files.

## Phase 6

### F16. Stream query progress over SSE (L)
- **Engine:**
  - `QueryExecutionEngine.executeNaturalLanguageQuery(params)` accepts an optional `params.onProgress(stage)`.
  - The F18 stage modules call it with `scope`, `schema`, `ambiguity`, `generating`, `safety` and `executing`. A throwing callback is caught and ignored, so it can never break a query.
  - With no callback, nothing changes.
  - Like `experiment`, it is never read from a request body. The route passes it.
- **Route:** add `POST /api/query/stream` in `routes/query.js`, which inherits the `requireAuth` and `llmLimiter` mount in `index.js`. It reads the same body fields as `POST /`.
  - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, then `res.flushHeaders()`.
  - Events: `event: progress` / `data: {"stage":"…"}`, then exactly one `event: result` / `data: {"status": <http status>, "body": <envelope>}`.
  - Build `status` and `body` with the same logic as `sendOutcome` and `sendError` in `routes/engineHttp.js`. Add pure helpers `outcomeStatus(outcome)` and `errorBody(error, …)` there so both paths share the code.
  - Stop writing after `req.on('close')`, and keep a 15-second `: ping` comment while the stream is open.
  - `POST /api/query` stays unchanged.
- **Client:**
  - **`api.js`:** add `streamQuery(payload, onProgress)`. It calls `fetch(baseURL + 'query/stream', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body, signal })`, using the same base URL as the axios instance.
    - If the response isn't `text/event-stream` (a 401, or a 429 from the limiter), reject with `{ response: { status, data: await res.json() } }`.
    - Otherwise read events with `res.body.getReader()` and a small parser in `lib/sse.js` with unit tests. Call `onProgress` for `progress` events.
    - On `result`, resolve with `body` when the status is 2xx, and otherwise reject with `{ response: { status, data: body } }`. This is the axios error shape `blockedBodyFromError` and `errorTurn` already read.
    - If `fetch` fails before the first event, fall back to `sendQuery`.
  - **`useChat`:** the text path calls `streamQuery` and dispatches `{ type: 'progressed', stage }`.
  - **`lib/conversation.js`:** add a `pendingStage` field (reset on `answered`, `failed` and `cleared`) and the `progressed` case. The `answered` and `failed` mapping stays unchanged.
  - **UI:** the pending indicator in `ChatThread` shows a label for each stage (for example "Generating pipeline…").
  - Voice keeps `sendVoice`, unchanged.
- **Fixtures and e2e:** add an SSE fixture builder to `src/lib/__fixtures__/`. In `chat.spec.ts`, route `**/api/query/stream` with `contentType: 'text/event-stream'` and an events body, and add one test that a stage label appears and then the answer renders.
- **Docs:** add `POST /api/query/stream` to `docs/API.md` with the event format and the `{ status, body }` contract.
- **Tests:**
  - Engine: `onProgress` gets the stages in order, and a callback that throws doesn't fail the query.
  - Route (supertest; parse `res.text`): progress events come before one `result`; a safety block gives `result.status` 422; an engine error gives the right `{ status, body.error.code }`.
  - Client: `sse.test.js` (parser: chunk boundaries, multi-line data, comments) and a `conversation.test.js` case for `progressed`.
- **Check:** run `npm run dev` in both packages, ask a question and watch the stages change. Run `curl -N -b "am_token=…" -H "Content-Type: application/json" -d '{"text":"…"}' http://localhost:3001/api/query/stream` and confirm the events arrive one by one. After deploying, confirm Render streams them too. Render's proxy supports streaming responses; if they arrive batched, that's a follow-up row in `fixes.md`.

---

## Verification (each phase)
1. `cd server && npm test` passes. For phases 1 and 6, also `cd client && npm run lint && npm test && npm run build && npm run test:e2e`.
2. From phase 4 on: `cd server && npm run typecheck` passes.
3. `curl -i http://localhost:3001/api/health` still returns 200 with helmet headers, and with `X-Request-Id` from phase 3 on. Use `PORT=3002` if 3001 is busy.
4. The status table above and `fixes.md` match: the IDs are `done` with commit hashes and moved to **Done**.

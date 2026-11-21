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

## How to run this plan (for the agent)
Work through the phases in order without stopping for confirmation. Ask the user only where a phase says to, or when a step fails in a way this file doesn't cover.

1. **Per phase:** create the branch from up-to-date `main` in a worktree: `git worktree add ../AtlasMind-p4 -b <branch> main`. Reuse the folder if it's already there. Run `npm ci` in `server/` (and in `client/` for phases 1 and 6), and copy `server/.env` from the root checkout. Never commit `.env`.
2. **Baseline:** `cd server && npm test` must pass, plus `cd client && npm run lint && npm test && npm run build` for phases that touch the client. If the baseline fails, stop and report.
3. **Implement:** one commit per fix (or per logical step for the L items). Run the tests before each commit. End each commit message with the repo's attribution line. Look up external libraries (pino, pino-http, TypeScript, mongodb-connection-string-url) with context7.
4. **Finish each phase:** review `git diff main...HEAD` against the CLAUDE.md conventions (tenant filtering through stores, the safety guard, the response envelope, keeping `api.js`, `conversation.js` and `docs/API.md` in sync). Update the status table here and the row in `fixes.md`, then commit. Merge with `git -C C:/Users/laxman/projects/AtlasMind merge --no-ff <branch>`, but skip the merge if the root checkout has uncommitted changes. Remove the worktree.
5. **Do not push.** The user pushes, which runs CI and releases the image.
6. **Report:** what was done, commit hashes, test results, and the defaults you used.

**Default decisions** (use these instead of asking):
- F21: pre-validate the URI with a parser before opening a client.
- F15: migrate with a one-off idempotent script that has a dry-run mode. Old sessions get a 401 and the user reconnects.
- F16: stream **stage progress** events plus the final result. Don't stream LLM tokens, because the model returns JSON (pipeline and explanation), which isn't useful half-finished.
- F18: pure moves behind façade files, so the import paths and existing tests stay the same.
- F19: opt in per file, so files only get checked once they have `// @ts-check`. There's no whole-project `checkJs`.

---

## Phase 1

### F21. URIs the driver can't parse return 400 (S)
In `server/src/routes/connections.js`, `isMongoUri` only checks the scheme, so `mongodb://host:notaport` gets through. The driver then throws `MongoRuntimeError`, which `connectionFailed` doesn't match, so the route returns 500 `connection_save_failed`.
- Add `mongodb-connection-string-url` as a direct dependency. It's already installed through `mongodb`; pin the same major. Replace `isMongoUri` with `parseMongoUri(s)`, which returns `true` only when `new ConnectionString(s)` doesn't throw. Use it in both `/connect` and `/databases`. Both 400 messages stay as they are.
- Keep `connectionFailed` as it is, so it still maps unreachable hosts to `connection_failed`.
- Tests: in `connections.test.js` and `connectionsDatabases.test.js`, `mongodb://host:notaport` returns 400 `validation_error` from both routes, and no client is opened (assert that `openTemporaryClient` and `discoverDatabases` aren't called).
- `docs/API.md`: note that `validation_error` also covers a URI that can't be parsed.

### F22. Narrow and enforce the CSP (S, **blocked on the user**)
- **Ask the user** for the production API origin (the `VITE_SERVER_URL` value on Netlify). If they don't have it yet, leave F22 `blocked`, finish F21, and move on.
- In `client/netlify.toml`, on the three CSP blocks (`/`, `/index.html` and `/shared/*`), change `connect-src 'self' https:` to `connect-src 'self' <api-origin>` and rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy`. Keep `frame-ancestors 'none'` on `/` and `/index.html` only. Update the comment block.
- Check: `npm run build && npx netlify-cli dev` if it's available, or `npx vite preview` with the same headers. Load the landing page, the app and a `/shared/<token>` page, and confirm the console shows no CSP errors (Google Fonts, the GSAP inline styles, Recharts, and the voice `blob:` media).

## Phase 2

### F15. Add `dbName` to the `connectionId` (M)
Today `connectionId = hashString(connectionString)` (`connections.js`). Connecting to the same URI with a different `dbName` overwrites the stored `dbName` for the earlier session.
- In `server/src/utils/encryption.js`, add `connectionIdFor(uri, dbName)`, which returns `hashString(`${uri}\u0000${dbName}`)`. Keep `hashString` unchanged. Use the new helper in `/connect`.
- Migration script `server/src/db/migrations/001-connection-id-with-db.js`, run with `npm run migrate:connection-ids` (add `--dry-run`):
  - For each `user_connections` doc: `decrypt` the URI and compute the new ID. Skip the doc if the ID is already new, which makes the script idempotent.
  - Re-key the tenant data with `updateMany({ connectionId: old }, { $set: { connectionId: new } })` on `query_history`, `dashboards`, `workspaces` and `few_shot_examples`. Leave `few_shot_examples` with `connectionId: null` (global) alone. Skip `approval_tokens`, which expire in 10 minutes.
  - Update the `user_connections` doc last. Log counts, never URIs.
  - This is a one-off ops script, so direct collection access is fine here. The stores stay the only runtime path.
- **Old sessions:** JWTs still carry the old ID, and `requireAuth` doesn't check that the ID exists. Make sure an unknown `connectionId` surfaces as 401 `session_expired` (clear the cookie) rather than a 500, so the client sends the user back to connect. Find where `userDbPool`/`getConnectionById` handles a missing doc and map it there.
- **Do not run the migration against the real central DB.** Tell the user the command and the `--dry-run` step. Running it is their call.
- Tests: `connectionIdFor` differs by `dbName`. The migration re-keys all four collections and is idempotent; mock the collections, following the existing tenant-store test style in `tenantStores.test.js`. A request with an unknown ID gets a 401.
- Docs: `docs/DEPLOYMENT.md` gets a "run the migration once after deploying" step. Update the `UserConnection.js` JSDoc for `connectionId`.

## Phase 3

### F17. Structured logging with pino (L)
There are about 83 `console.*` calls in `server/src`.
- Install `pino` and `pino-http`, plus `pino-pretty` as a dev dependency. Add `server/src/utils/logger.js`, which exports a single logger:
  - Level comes from `LOG_LEVEL`, defaulting to `info`, and to `silent` under Jest.
  - `redact` covers `connectionString`, `encryptedUri`, `req.headers.cookie`, `req.headers.authorization` and `*.uri`.
  - `LOG_LEVEL` is operational config, not a research toggle, so it doesn't conflict with the ExperimentConfig rule.
- In `index.js`, mount `pino-http` first. `genReqId` uses an incoming `x-request-id` if it matches `/^[\w-]{1,64}$/`, and otherwise `crypto.randomUUID()`. Echo it as the `X-Request-Id` response header. Add `connectionId` to the log context after `requireAuth`.
- Replace the `console.*` calls one module at a time, keeping their meaning: use `req.log` in routes and the module logger with a `{ module }` child in services. Don't log question text; keep the ambiguity-metric rule about not logging query text.
- Change `npm run dev` to pipe through `pino-pretty`.
- Tests: `X-Request-Id` is set and an incoming one is echoed (`routesSmoke.test.js`). The redaction test logs `{ connectionString }` to a stream and asserts it's redacted.
- Docs: add `LOG_LEVEL` to `server/.env.example`, `docs/DEPLOYMENT.md` and `docs/TROUBLESHOOTING.md`.

## Phase 4

### F19. `// @ts-check` and JSDoc on the server (L)
- Add dev dependencies `typescript`, `@types/node`, `@types/express`, `@types/jsonwebtoken`, `@types/cookie-parser`, `@types/cors` and `@types/multer`.
- Add `server/tsconfig.json` with `allowJs`, `checkJs: false`, `noEmit`, `module: commonjs`, `target: es2022`, `strict: false` and `include: ["src"]`. Add a `"typecheck": "tsc -p ."` script.
- Add `// @ts-check` and fix the errors, in this order, with one commit per group:
  1. `utils/`, `auth/` and `middleware/`
  2. `stores/` and `models/`
  3. `safetyGuard.js` and `queryExecutor.js`
  4. `engineErrors.js` and `queryExecutionEngine.js`
  5. the rest of `services/` and `routes/`
- Add typedefs where they help: `QueryOutcome` and `ExecutionVerdict`, plus the `ExperimentConfig` typedef, which may already exist in `experiment.js`. Fix type errors with JSDoc or small safe narrowing, never with behaviour changes.
- In `.github/workflows/ci.yml`, add `npm run typecheck` to the `build-and-test-server` job, before the tests.
- Done when every file under `server/src` (excluding `__tests__`) has `// @ts-check` and `npm run typecheck` passes.

## Phase 5

### F18. Split the large modules by stage (L, no behaviour change)
- `ambiguityGate.js` (1033 lines) becomes `services/ambiguity/`:
  - `vagueTerms.js`: vague terms, write intent and field metadata
  - `analysis.js`: `analyzeAmbiguity` and `checkDeterministicAmbiguity`
  - `clarifications.js`: `validateModelClarification`, `validateClarifications` and `buildEnrichedQuery`
  - `metrics.js`: `recordAmbiguityMetric`, `getAmbiguityMetrics` and `resetAmbiguityMetrics`
  - `decide.js`: `decide`, `reviewModelQuestions` and `recordGeneration`

  `ambiguityGate.js` stays as a façade that re-exports the same names.
- `safetyGuard.js` (966 lines) becomes `services/safety/`:
  - `operators.js`: blocked and hard-denied operator lookups
  - `names.js`: protected and valid collection or database names
  - `references.js`: `extractAndValidateCollectionReferences`
  - `pipeline.js`: `validateStagesRecursively`, `validatePipelineCore`, `validatePipeline` and `describeBlock`
  - `verdict.js`: write parsing, `splitFinalWrite` and `classifyExecution`

  `safetyGuard.js` stays as the façade.
- `queryExecutionEngine.js` (751 lines): pull the steps of `runNaturalLanguageQuery` into `services/engine/` stage modules that follow the CLAUDE.md pipeline order: scope, context (schema and few-shot), ambiguity, generation, safety and execution. Keep `executeNaturalLanguageQuery` and `executeApprovedWrite` in the façade. Keep the `QueryOutcome` and error contract unchanged.
- Rules:
  - Move code first, then make any tidy-ups in separate commits.
  - Leave every existing test unchanged; all of them must pass.
  - Don't duplicate `BLOCKED_STAGES`/`BLOCKED_OPERATORS` or `SYSTEM_COLLECTIONS`.
  - Keep `// @ts-check` from F19 on every new file.
- Docs: update the module paths in CLAUDE.md (the safetyGuard and engine paragraphs), `docs/ARCHITECTURE.md` and `GLOSSARY.md` if it names files.

## Phase 6

### F16. Stream query progress over SSE (L)
- Engine: `executeNaturalLanguageQuery(params)` accepts an optional `onProgress(stage)` callback. The stages are `scope`, `schema`, `ambiguity`, `generating`, `safety`, `executing` and `done`, and the callback is called from the F18 stage modules. If no callback is passed, nothing changes.
- New route `POST /api/query/stream` in `routes/query.js`, which sits behind the same `requireAuth` and `llmLimiter` mount:
  - Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no`, followed by `res.flushHeaders()`.
  - Events: `progress` with `{ stage }`, then exactly one `result` event carrying the same envelope `POST /` returns. Engine errors go through `routes/engineHttp.js` into an `error` event with `{ code, message }`.
  - Close the stream on `req.on('close')`.
  - `POST /api/query` stays unchanged.
- Client:
  - In `client/src/services/api.js`, add `streamQuery(body, onProgress)`. It uses `fetch` with `credentials: 'include'` and parses the stream with a `ReadableStream` reader, because `EventSource` can't send a POST. It falls back to the existing axios call if streaming fails before the first event.
  - In `useChat`, show the current stage in the pending turn.
  - `lib/conversation.js` maps the final `result` exactly as it does today; add a reducer action for progress.
  - Add a `__fixtures__` entry and a `chat.spec.ts` stub for the stream.
- Docs: add `POST /api/query/stream` and its event format to `docs/API.md`.
- Tests: an engine test checks the `onProgress` call order. A supertest route test parses the SSE body (progress events, then `result`, and an `error` event on an engine error). A `conversation.test.js` case covers the progress action, and the e2e test still passes.
- Check: `npm run dev` in both packages. Ask a question and watch the stages, and make sure `curl -N` against `/api/query/stream` with a session cookie streams the events as they happen rather than all at once at the end.

---

## Verification (each phase)
1. `cd server && npm test` passes. For phases 1 and 6, also `cd client && npm run lint && npm test && npm run build && npm run test:e2e`.
2. From phase 4 on: `cd server && npm run typecheck` passes.
3. `curl -i http://localhost:3001/api/health` still returns 200 with helmet headers, and with `X-Request-Id` from phase 3 on. Use `PORT=3002` if 3001 is busy.
4. The status table above and `fixes.md` match: the IDs are `done` with commit hashes and moved to **Done**.

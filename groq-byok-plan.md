# Groq personal keys and the AtlasMind allowance

**Resume in a new session.** Work on the implementation branch `feat/groq-byok-allowances` (created from `plan/groq-byok-allowances`). Follow `CLAUDE.md` and `AGENTS.md`. Read §0 first: every step in §10 is implemented. What remains is the operator's manual check (§11, `start.bat`) and the gaps listed in §0.

## 0. Status (updated 2026-11-22)

| Step | State | Commit |
| --- | --- | --- |
| 1. Session `sid`, credential store, logout revocation, settings routes, origin check, log redaction | Done | `2f4e71c` |
| 2. `resolveProvider`, injection through query/stream/voice, error classification, managed model allow-list | Done (also pulled the `errorResult` change forward from step 3) | `9acec3f` |
| 3. Allowance ledger, reserve/settle, meter wired into every Groq attempt (sessions 3A + 3B in one commit) | Done | `8744d68` |
| 4. Client, fixtures, docs (sessions 4A + 4B in one commit) | Done, except the manual `start.bat` check | see `git log` (`feat(client): Groq key panel, payer-aware requests and provider error turns`) |

At step 4 every §11 command passed on Node 24.17: server typecheck clean, `npm test` 567 of 567 tests in 39 suites, client lint clean, Vitest 73 of 73, build OK, Playwright 16 of 16. `npm --prefix server ci` failed with EPERM because a running dev server had `@parcel/watcher` loaded, so the server packages were restored with `npm install` (the lockfile did not change). The manual check with `start.bat` (real MongoDB, `GROQ_API_KEY` and a personal key) has **not** been run.

### What exists now (client, step 4)

- `services/api.js`: `getProviderSettings`, `saveProviderKey`, `setProviderMode` and `deleteProviderKey`. `sendVoice` appends `expectedPayer` to the FormData.
- `lib/providerSettings.js` (pure, unit tested): `expectedPayerOf`, `payerSummary` (sidebar text), `formatTokens` / `formatAudioSeconds` / `formatClock` / `formatShortDate`, `modelsFor(allowedModels)` (an unknown allowed ID is shown by its ID) and `pickModel`.
- `hooks/useProviderSettings.js`: TanStack Query key `['providerSettings', connectionId]`. The mutations write the returned settings into the cache. `useAuth` removes the key on logout and on `refetch` (reconnect).
- `useChat(selectedQueryId, onQuerySuccess, connectionId)`: sends `expectedPayer` once settings have loaded, limits the models to `allowedModels`, invalidates the settings in a `finally` after every query or voice request, and returns `models` and `provider`.
- `components/app/ProviderKeyPanel.jsx`: sits in the sidebar above the account footer and shows the payer line. Its key form uses a password field that is cleared after every submit and lists the data that goes to Groq, with a link to console.groq.com. It also has the confirm step before Remove, the switch between modes, and the reconnect note. `AppShell` owns `keyFormOpen`, so an error turn can open the form (and the sidebar or drawer).
- `lib/conversation.js` `providerErrorFields`: error turns for the §7 and §0 codes carry `errorCode`, `payer`, `title`, `actions` (`enterKey` | `updateKey` | `useManaged`), `resetAt`, `retryAt` and `retryLabel`. `ErrorTurn` draws them; Retry stays the way to resend.
- `useVoice({ onLimit })`: stops at `MAX_RECORDING_SECONDS` (60) and sends the recording. The composer shows `m:ss / 1:00`.
- Fixtures: `provider-settings-{managed,exhausted,personal,legacy}.json`, `allowance-exhausted-429.json`, `provider-key-invalid-422.json`, `provider-rate-limited-429.json` and `settings-changed-409.json`. Playwright `Groq payer` covers: allowance exhausted → save key → retry paid by the key; invalid key → switch to managed → retry; remove with confirm; managed model list plus the reconnect note.
- Docs: `docs/API.md` (Origin rule, `expectedPayer`, the voice 5 MB limit, provider error table, section 11 settings API), `docs/DEPLOYMENT.md` (allowance env vars, new collections, `CORS_ALLOWED_ORIGINS` gating non-GET requests), `server/.env.example` (the §1 vars, GCM comment) and `CLAUDE.md` (Auth and Central DB).

### What exists now (server)

- `auth/session.js`: `issueSession` adds `sid: crypto.randomUUID()`. `readSessionClaims(req)` returns `{ connectionId, sid | null, expiresAt }`. `readSession` still returns a string.
- `middleware/auth.js`: sets `req.connectionId`, `req.sessionId` (null for old cookies) and `req.sessionExpiresAt`. Typed in `types/express.d.ts`.
- `stores/providerCredentialStore.js`: `initializeIndexes`, `getState`, `getActiveKey` (the only function that decrypts), `saveKey` (returns `false` when it hits a tombstone), `setMode`, `deleteKey`, `revoke` (upserts a tombstone). Indexes are created in `index.js`. `provider_credentials` is listed in `db/systemCollections.js`.
- `services/providerSettings.js` + `routes/providerSettings.js`: mounted at `/api/provider-settings` behind `requireAuth`, with `Cache-Control: no-store`. `keyValidationLimiter` (10 per hour per session) is in `middleware/rateLimiter.js`. Logout (`routes/auth.js`) calls `revokeSession`, and a failed revoke is only logged.
- `middleware/originCheck.js`: mounted on `/api/` before CORS. Allowed origins are `CORS_ALLOWED_ORIGINS`, plus `http://localhost:5173` and `http://127.0.0.1:5173` outside production.
- `utils/logger.js`: redacts `apiKey`, `*.apiKey`, `authorization` and `*.authorization`.
- `services/providerConfig.js`: `SUPPORTED_MODELS` (mirrors `client/src/lib/models.js`, so keep the two lists in sync), `managedModels()`, `allowanceMode()` and `allowanceLimits()`. Each reads env at call time and uses the §1 defaults. Steps 1 and 2 only use `managedModels()`.
- `services/groqService.js`:
  - `createClient`, `validateApiKey`, `classifyProviderError` and `resolveProvider({ connectionId, sessionId, expectedPayer })`.
  - `resolveProvider` returns `{ payer, client, allowedModels, defaultModel, connectionId, meter: null }`. Personal clients are cached in an LRU of 100 by session id.
  - `setPersonalClientFactory` is the test seam for personal clients.
  - `generateMQL(..., { provider })` and `transcribeAudio(buf, name, provider)` classify errors only when a provider is passed. Without one, behavior is unchanged, which keeps experiments and the old tests working.
- `services/engineErrors.js`: `ProviderError(code, message, status, { payer, retryAfterSeconds, resetAt })`.
- `routes/engineHttp.js` `errorResult`: a `ProviderError` adds `payer`, `retryAfterSeconds` and `resetAt`. A non-engine error now gets the fallback message instead of `error.message`.
- Routes: `query.js` (`POST /` and `/stream`) and `voice.js` call `resolveProvider` once and pass `provider` to the engine. Voice also passes it to `transcribeAudio`. `expectedPayer` is read from the JSON body or the multipart field. In the stream, a resolve error arrives as the `result` event.
- Tests: `providerCredentialStore.test.js`, `providerSettings.test.js`, `originCheck.test.js`, `groqProvider.test.js`, plus additions to `session.test.js` and `routesSmoke.test.js`. The `queryStream`/`routesSmoke` mocks now include `resolveProvider`.
- `stores/allowanceStore.js`: `groq_allowance`, one document per UTC day (`_id: 'YYYY-MM-DD'`, `tokens`, `audioSeconds`, `conn.<id>.{tokens,audioSeconds}`, `expiresAt` = day end + 8 days with a TTL index). `reserve` refuses up front when the amount alone exceeds either limit, because the `$not: { $gt }` connection filter also matches a missing field (a fresh connection would otherwise pass any amount). Listed in `db/systemCollections.js`; indexes created in `index.js`.
- `services/allowance.js`: `createMeter(connectionId)` (null when `off`; the mode is read once per meter), `reserveText` / `reserveAudio` return a ticket `{ day, unit, estimate, model, recorded }`, `settle(ticket, { outcome: 'ok'|'rejected'|'unknown', actual })` never throws and logs `Managed Groq usage` with `{ payer, unit, estimate, actual, model }`. `outcomeOf(err)` maps an SDK 4xx to `rejected`, everything else to `unknown`. `getRemaining(connectionId)` returns null remainders on a store error or in `off` mode.
- `groqService`: managed `resolveProvider` sets `meter: allowance.createMeter(connectionId)`. `generateMQL` wraps every chat attempt in `metered(params)` and `transcribeAudio` wraps both Whisper attempts. A `ProviderError` thrown from a reservation is rethrown at once (no retry, no fallback, `llm.onFailure` still called).
- `routes/voice.js`: managed uploads over 5 MB → 400 `upload_error` ("Recordings over 5 MB need your own Groq key.") before any Groq call.
- `GET /api/provider-settings` now returns `managedAllowance: { tokensRemaining, audioSecondsRemaining, resetAt, mode }` (also in personal mode and on legacy cookies) and `allowedModels` (`managedModels()`, or `SUPPORTED_MODELS` in personal mode).
- `server/test-support/fakeMongo.js`: an in-memory collection that supports `$ne/$gt/$lte/$not/$type`, `$set/$setOnInsert/$inc`, upsert and unique indexes. Each operation yields once, then applies atomically. It lives outside `src/__tests__` so Jest doesn't run it as a suite, and it's excluded in `.dockerignore`. Use it for the allowance tests; `mongodb-memory-server` is not installed.

### Changes from the original plan (keep these)

- **Extra error codes:**
  - `reconnect_required` (409): a cookie without `sid` tried personal mode.
  - `session_revoked` (401): a PUT lost the race to a logout.
  - `provider_key_missing` (400): PATCH to personal without a stored key.
  - `provider_unavailable`: 502 for an SDK network error, a 5xx, or a key check that couldn't reach Groq; 503 when `GROQ_API_KEY` is unset for managed traffic.
  - `origin_not_allowed` (403).

  Add them to `docs/API.md` and `lib/conversation.js` in step 4.
- `provider_key_invalid` is also used when the **managed** key is rejected (`payer: 'managed'`, with an "operator" message). The client should offer "Update key" only when `payer === 'personal'`.
- Personal keys may pick **any** model ID; `allowedModels` for personal is `SUPPORTED_MODELS`. Managed traffic falls back to `defaultModel`, which is `openai/gpt-oss-120b` when it is allowed, otherwise the first entry in `MANAGED_MODELS`.
- A 429 is never followed by a model fallback, because the limit belongs to the key. A model-unavailable or 5xx error on a custom model still falls back once to `defaultModel`.
- Key format check: `^[A-Za-z0-9_-]{10,200}$`, so the synthetic `gsk_test_SECRET` passes. Groq has the final say.
- Production CORS already rejected foreign origins (with a 500 from the error handler). `originCheck` now answers a clean 403 first and also applies in development.

### Known gaps carried forward

- **Decided (3B): `toEngineError` keeps the raw message** for non-provider errors. Mongo errors (for example an invalid `$group`) are useful to the user, `approvedWrite` forwards raw messages the same way, and SDK errors no longer reach it because every route passes a provider. `queryExecutionEngine.test.js` relies on this. Revisit only together with `approvedWrite`.
- The audio reservation is a flat 60 s whatever the upload size. The client now stops recording at 60 s, but an older client or a direct API call can still upload up to 5 MB (several minutes) on the managed key. That upload is settled at its real `duration`, so one call can overshoot the remaining voice allowance once (the next reservation is then refused).
- **New (4):**
  - The manual `start.bat` check in §11 needs the operator's environment and has not been run.
  - Error-turn actions ("Use your own Groq key", "Switch to AtlasMind allowance") stay on the turn after the user has acted on them. Clicking one again is harmless.
  - A voice `settings_changed` has no Resend (there is no transcript yet), so the user records again.
  - A recording that hits 60 s is sent automatically, without a confirmation.
  - The client sends no `expectedPayer` until the settings have loaded, or when they fail to load. The server then uses the stored mode.
  - `AGENTS.md` is untracked in the working tree and was not committed.
- `settle` is awaited in the `finally`, so each managed attempt costs one extra ledger write after the Groq call. A store outage there is only logged and the estimate stays charged.
- `GET /api/provider-settings` reads the ledger on every call. The client should not poll it faster than once per query response (4A invalidates it after each query or voice response).
- `options.llm.onFailure` is called for every early provider exit, including an exhausted allowance and a ledger outage.

## Why

The managed Groq key (`GROQ_API_KEY`) gives roughly **200K tokens per day**. One question costs about 3–6K tokens (system prompt, schema, few-shot examples, up to 2048 output tokens), so the whole installation can fund only **about 40–60 managed questions a day**. Users need to be able to bring their own Groq key, and the managed budget has to be shared fairly between connections.

This release:

- Every connection starts on the **AtlasMind allowance** (managed key) with a daily limit per connection and an installation-wide limit.
- A user can switch to **their own Groq key** for the current sign-in.
- Out of scope: user accounts, persistent or cross-device keys, buying credits, per-person allowances. All of these need real user accounts.

## Code facts this plan relies on

- `server/src/auth/session.js`: the JWT carries only `{ connectionId }`, and `readSession` returns a string. Logout (`routes/auth.js`) only clears the cookie. A connection ID derives from URI + DB name, so two people can share one.
- `server/src/services/groqService.js`: process-wide `groqClient` from `GROQ_API_KEY` with `maxRetries: 0`, a 30 s timeout and `nativeFetchWithStreamBodies`. `generateMQL` retries 429/5xx twice (8 s cap per wait), then falls back to `DEFAULT_MODEL`. `transcribeAudio` falls back from `whisper-large-v3-turbo` to `whisper-large-v3`. `setGroqClient` is the test seam.
- There are exactly two Groq call sites: `services/engine/naturalLanguageQuery.js` (`generateMQL`) and `routes/voice.js` (`transcribeAudio`).
- `routes/engineHttp.js` `errorResult` forwards `error.message` verbatim, so SDK error text can reach the client. `RateLimitError` already exists in `services/engineErrors.js`.
- `utils/encryption.js` already uses AES-256-GCM (`encrypt` / `decrypt`). The `.env.example` comment still says CBC.
- `client/src/hooks/useVoice.js` has no maximum recording length, and multer accepts up to 25 MB.
- `client/src/lib/models.js` lists five models, and the server accepts any submitted model ID.

## 1. Decisions

### Managed budget

Limits are enforced from day one. Groq hard-stops at its own limit anyway; enforcing ours makes the split fair and gives users a clear message instead of a raw 429.

| Setting | Default | Reason |
| --- | --- | --- |
| `GROQ_ALLOWANCE_MODE` | `enforce` (also `observe`, `off`) | 200K/day is too small to run unmetered |
| `GROQ_GLOBAL_DAILY_TOKENS` | `160000` | 80% of Groq's ~200K/day, leaving headroom for retries, fallbacks and development use of the same key |
| `GROQ_CONNECTION_DAILY_TOKENS` | `25000` | About 5–6 questions per connection per day; about 6 heavy users use up the pool |
| `GROQ_GLOBAL_DAILY_AUDIO_SECONDS` | `3600` | 60 minutes of voice for the installation |
| `GROQ_CONNECTION_DAILY_AUDIO_SECONDS` | `600` | 10 minutes of voice per connection |
| `MANAGED_MODELS` | `openai/gpt-oss-120b,openai/gpt-oss-20b` | Managed traffic can't select an unbudgeted model |

The window is a UTC calendar day (resets at 05:30 IST). Groq also has per-minute token limits per model; check the Groq console for the chosen model. `llmLimiter` stays as the short-window guard in both modes, and a Groq 429 is shown as `provider_rate_limited`. Tune the numbers after a week of the usage log (§6).

### Personal-key lifetime

A personal key lasts as long as the sign-in (the 7-day session cookie). After a fresh database sign-in the user enters it again. That's the right call here: there are no accounts, and anyone with the same URI shares the connection ID, so there is no safe identity to attach a long-lived key to.

- The key is stored encrypted on the server only, never in browser storage, URLs or chat history. Logout revokes it.
- The sidebar shows "Your Groq key (…a1b2) active until Nov 29", so re-entry isn't a surprise.
- The key dialog links to console.groq.com/keys. A free Groq key gives each user their own ~200K tokens a day.

## 2. Session identity

- `issueSession` adds `sid: crypto.randomUUID()` to the JWT.
- Add `readSessionClaims(req)` returning `{ connectionId, sid | null, expiresAt }`. Keep `readSession` returning a string for existing callers.
- `requireAuth` sets `req.connectionId` and `req.sessionId`. Cookies issued before this change have no `sid`: they keep managed access, and settings return `requiresReconnectForPersonal: true`. Update `types/express.d.ts`.
- Logout: if the cookie verifies, revoke that session's credential (§3). A missing or expired cookie still returns 200.

## 3. Credential store: `server/src/stores/providerCredentialStore.js`

- Collection `provider_credentials` in the central DB (add it to `db/systemCollections.js`). Document: `{ connectionId, sessionId, mode: 'managed' | 'personal', encryptedKey | null, keyLast4, revoked, expiresAt, updatedAt }`.
- Unique index on `{ connectionId, sessionId }` and a TTL index on `expiresAt` (set to the JWT `exp`). Reads also check `expiresAt`, because TTL deletion is lazy. Throw without both IDs, like `stores/tenant.js`.
- Logout race: logout writes a tombstone `{ revoked: true, encryptedKey: null }` instead of deleting. Every write filters on `revoked: { $ne: true }`, so a key validation still in flight can't resurrect the credential (an upsert that hits the tombstone fails on the unique index and is treated as revoked). TTL removes the tombstone later.
- Initialize indexes in `index.js` next to `dashboardStore.initializeIndexes()`, before listening.

## 4. Settings API: `routes/providerSettings.js` + `services/providerSettings.js`

Mount at `/api/provider-settings` with `requireAuth`. Responses carry `Cache-Control: no-store`. Add a dedicated limiter in `middleware/rateLimiter.js` (10 key validations per hour per session).

| Request | Body | Result |
| --- | --- | --- |
| `GET /` | none | `{ mode, hasKey, keyLast4, keyExpiresAt, managedAllowance: { tokensRemaining, audioSecondsRemaining, resetAt, mode }, allowedModels, requiresReconnectForPersonal? }` |
| `PUT /key` | `{ apiKey }` | Validates with `client.models.list()`, which costs zero tokens and sends no user data, then stores the key and switches to `personal`. Invalid key: 422 `provider_key_invalid`, previous state unchanged. |
| `PATCH /` | `{ mode }` | `personal` requires a stored key. |
| `DELETE /key` | none | Removes the key and sets `mode: managed` in one update. The UI asks the user to confirm the switch to the AtlasMind allowance. |

The key is never returned, logged or included in an error. Add `apiKey` and `authorization` to the pino redact paths in `utils/logger.js`.

**Cross-tab safety.** Query, stream and voice requests send `expectedPayer` (`managed` | `personal`) in the JSON body or as a multipart field. If it doesn't match the stored mode, the server returns 409 `settings_changed` before calling Groq, and the client refetches settings. When the field is missing (old clients), the server uses the stored mode.

## 5. Provider calls: `services/groqService.js`

- Add `resolveProvider({ connectionId, sessionId })` returning `{ payer, client, allowedModels }`. Managed uses the cached singleton and reads the env key lazily, so personal traffic works without it. Personal builds a client through a shared `createClient(apiKey)` with the same `maxRetries: 0`, timeout and fetch adapter, cached in a small LRU by session.
- `generateMQL(..., options.provider)` and `transcribeAudio(buffer, name, provider)` use `provider.client` instead of `getGroqClient()`. Without a provider they behave as today, so experiment code and existing tests keep working.
- `routes/query.js` (both `POST /` and `POST /stream`) and `routes/voice.js` resolve the provider once per request and pass it through `QueryExecutionEngine.executeNaturalLanguageQuery` to `naturalLanguageQuery.js`. Voice uses the same provider for Whisper and the text stage. Clarifications, history, export and approved writes make no Groq call and cost nothing.
- Classify provider errors in `groqService` with a new `ProviderError extends QueryEngineError` in `engineErrors.js`:
  - 401/403 → `provider_key_invalid` (422). No retry, no model fallback, and never a fallback to the managed key.
  - 429 with `retry-after` above 8 s → `provider_rate_limited` (429) with `retryAfterSeconds`, returned immediately.
  - Model not found or not permitted → `provider_model_unavailable` (422).
- Managed requests for a model outside `MANAGED_MODELS` use the default model. Personal mode allows the full client list.

## 6. Managed allowance: `stores/allowanceStore.js` + `services/allowance.js`

**No transactions.** One document per UTC day holds both scopes, so a single conditional `updateOne` is atomic on any MongoDB deployment (standalone, replica set or Atlas):

```js
{
  _id: '2026-11-22',
  tokens: 41230, audioSeconds: 310,
  conn: { '<connectionId>': { tokens: 8200, audioSeconds: 40 } }
}
```

- **Reserve** before each SDK attempt, including retries and model fallbacks. First upsert the day document with `$setOnInsert`, then run
  `updateOne({ _id, tokens: { $lte: G - est }, ['conn.' + id + '.tokens']: { $not: { $gt: C - est } } }, { $inc: { tokens: est, ['conn.' + id + '.tokens']: est } })`.
  `modifiedCount === 0` → 429 `managed_allowance_exhausted` with `resetAt`.
  - Text estimate: `ceil(promptChars / 3) + max_tokens`.
  - Audio estimate: 60 s. The client stops recording at 60 s, and the server rejects managed uploads over 5 MB.
- **Settle** once, in a `finally`, by `$inc`-ing `(actual − estimate)` on the original day. Actual is `usage.total_tokens` for text and Whisper's `duration` for audio (minimum 10 s, Groq's billing floor).
  - The provider rejected the call before generating (401/400): release the whole reservation.
  - Timeout or unknown outcome: keep the estimate.
  - A crash between reserve and settle leaves the estimate charged. That's acceptable.
- Personal-key calls skip reserve and settle entirely.
- `observe` records usage but never rejects. `off` skips accounting.
- If the ledger is unavailable in `enforce` mode, managed calls get 503 `managed_accounting_unavailable`. Personal-key requests still work.
- Usage log: one pino line per settled call with `{ payer, unit, estimate, actual, model }`. No question text, no keys. Use it to tune the §1 numbers.
- Experiment hooks (`options.llm.beforeCall` / `afterCall`) are untouched and run alongside.

## 7. Errors and transport

- Extend `errorResult`. A `ProviderError` maps to `{ success: false, error: { code, message, payer, retryAfterSeconds?, resetAt? } }`. Any non-engine error gets the generic fallback message instead of `error.message`, so SDK text no longer leaks.
- The body is the same over JSON, the SSE `result` event (HTTP status 200 once the stream has started) and voice.

| Code | Status |
| --- | --- |
| `settings_changed` | 409 |
| `provider_key_invalid` | 422 |
| `provider_model_unavailable` | 422 |
| `managed_allowance_exhausted` | 429 |
| `provider_rate_limited` | 429 |
| `managed_accounting_unavailable` | 503 |

Existing `too_many_requests` and `rate_limited` stay as they are. A provider error never signs the user out.

## 8. Origin protection

Production cookies are `SameSite=None`, so a cross-site POST to `/api/query` can already spend the managed budget today. Add `middleware/originCheck.js`: a non-GET `/api/*` request that carries an `Origin` header must match `CORS_ALLOWED_ORIGINS` (in development, the Vite origin `http://localhost:5173`), otherwise 403. Requests without `Origin` (curl, server-to-server) pass, as today. One middleware covers settings, query, stream and multipart voice.

## 9. Client

- `services/api.js`: add `getProviderSettings`, `saveProviderKey`, `setProviderMode` and `deleteProviderKey`. Send `expectedPayer` with query, stream (`lib/queryStream.js`) and voice FormData.
- New `hooks/useProviderSettings.js` (TanStack Query, like `useSchema`), shared by `Sidebar` and `useChat`. Clear it on logout and reconnect in `useAuth`.
- New `components/app/ProviderKeyPanel.jsx` in the sidebar. It shows the active payer, for example "AtlasMind allowance: 18K tokens / 9 min voice left, resets 05:30" or "Your Groq key (…a1b2) active until Nov 29". The key input is a password field, cleared after submit. Before activation, explain that questions and schema context (and audio for voice) go to Groq on the user's own account.
- `lib/conversation.js`: map the new codes to turns with actions:
  - `managed_allowance_exhausted` → "Use your own Groq key", plus the reset time.
  - `provider_key_invalid` → "Update key" / "Switch to AtlasMind allowance".
  - `provider_rate_limited` → "Try again in N s".
  - `settings_changed` → refresh settings and offer to resend.
- `useVoice.js`: stop recording at 60 s. `lib/models.js`: show only models in `allowedModels`.

## 10. Implementation sequence

Each part below is sized for one session and ends in one focused commit with all checks green. All of them are done (§0): 3A and 3B landed together in `8744d68`, and 4A and 4B together in the step 4 commit.

1. ~~Session `sid`, credential store, logout revocation, settings routes, origin check, log redaction.~~ Done.
2. ~~`resolveProvider` and its injection through query, stream and voice; error classification; managed model allow-list.~~ Done.

### Session 3A: allowance ledger and service (server only)

Commit: `feat(groq): managed allowance ledger`.

1. Review the uncommitted draft `server/src/stores/allowanceStore.js` and finish it. It has `dayKey`, `dayEnd`, `ensureDay` (a `$setOnInsert` upsert that tolerates E11000), `reserve` (the §6 conditional `updateOne`; `limits: null` means observe), `adjust`, `usage` and a TTL `initializeIndexes`. It validates connectionIds against `^[A-Za-z0-9_-]+$` because they become field paths.
2. Add `groq_allowance` to `db/systemCollections.js` and call `allowanceStore.initializeIndexes()` in `index.js`, next to the credential store.
3. New `services/allowance.js`, using `providerConfig.allowanceMode()` and `allowanceLimits()`:
   - `createMeter(connectionId)` returns `null` when the mode is `off`. Otherwise it returns `{ reserveText({ promptChars, maxTokens, model }), reserveAudio(), settle(ticket, { outcome, actual }) }`.
   - Text estimate: `ceil(promptChars / 3) + maxTokens`. Audio estimate: 60 s.
   - In enforce mode, a failed reservation throws `ProviderError('managed_allowance_exhausted', …, 429, { payer: 'managed', resetAt })`, where `resetAt` is the next UTC midnight in ISO format. A store error throws `ProviderError('managed_accounting_unavailable', …, 503)`. In observe mode, record with `limits: null`, never reject, and only log store errors.
   - `settle` never throws. It adjusts by `actual − estimate` on the ticket's original day:
     - outcome `ok` with a known `actual`: apply the difference;
     - `rejected` (any 4xx from the SDK, including 429): release the whole estimate;
     - `unknown` (timeout, 5xx, network) or a missing `actual`: keep the estimate.
   - Audio `actual` is `max(10, ceil(duration))`.
   - `settle` logs one pino line: `{ payer: 'managed', unit, estimate, actual, model }`.
   - `getRemaining(connectionId)` returns `{ tokensRemaining, audioSecondsRemaining, resetAt, mode }`: for each unit, the minimum of the global and connection remainders. On a store error it returns `null` values.
4. New `src/__tests__/allowance.test.js` using `test-support/fakeMongo.js` with `unique: [['_id']]`:
   - 50 parallel reservations never exceed either cap;
   - UTC rollover (a different `_id`, and settle hits the original day);
   - settlement refunds the difference;
   - a timeout keeps the estimate;
   - a rejection releases it;
   - observe never rejects;
   - off creates no meter;
   - ledger failure gives 503 in enforce mode;
   - an unsafe connectionId throws.

### Session 3B: wire the meter in (server only)

Commit: `feat(groq): enforce the managed allowance on every Groq attempt`.

1. In `resolveProvider`, managed sets `meter: allowance.createMeter(connectionId)`. Personal keeps `meter: null`, so personal calls skip reserve and settle entirely.
2. In `groqService.generateMQL`, wrap every `client.chat.completions.create` call (each retry and the default-model fallback) in a `metered(params)` helper. It reserves before the call, settles in a `finally`, and reads `usage.total_tokens`.
   - In the provider branch of the catch block, rethrow any `ProviderError` at once, so an exhausted allowance doesn't trigger a retry or fallback.
   - Do the same around both Whisper attempts in `transcribeAudio`, using `duration`.
3. In `routes/voice.js`, when `provider.payer === 'managed'` and the upload is over 5 MB, return 400 `upload_error` ("Recordings over 5 MB need your own Groq key") before any Groq call.
4. In `providerSettings.getSettings`, add `allowedModels` (`managedModels()` for managed, `SUPPORTED_MODELS` for personal) and `managedAllowance` (`allowance.getRemaining`). In the legacy-cookie branch, add the managed values.
5. Decide on the `toEngineError` raw-message gap (§0).
6. Tests:
   - `groqProvider.test.js`: a reservation happens per attempt (retries plus fallback); an exhausted allowance makes zero SDK calls; voice is charged even when the following text call is refused; personal makes no ledger writes.
   - `queryStream.test.js` and `routesSmoke.test.js`: the same error body for a pre-stream JSON 429, an in-stream `result` event and voice, using `managed_allowance_exhausted` with `resetAt` and `provider_rate_limited` with `retryAfterSeconds`; and the 5 MB managed voice rejection.
   - `providerSettings.test.js`: the new GET fields.

### Session 4A: client wiring and UI

Commit: `feat(client): Groq key panel and payer-aware requests`.

1. `services/api.js`: `getProviderSettings`, `saveProviderKey`, `setProviderMode`, `deleteProviderKey`.
2. New `hooks/useProviderSettings.js` (TanStack Query, like `useSchema`), shared by `Sidebar` and `useChat`. Invalidate it after each query or voice response so the allowance counter updates. Clear it on logout and reconnect in `useAuth`.
3. Send `expectedPayer` (the current settings `mode`) with query, stream (`lib/queryStream.js`) and the voice FormData.
4. New `components/app/ProviderKeyPanel.jsx` in the sidebar, using the Verdigris primitives from `components/ui/vg/` and the `vg-*` tokens:
   - the payer line, for example "AtlasMind allowance: 18K tokens / 9 min voice left, resets 05:30" or "Your Groq key (…a1b2) active until Nov 29";
   - a password-field key input that is cleared after submit;
   - before activation, a note that questions and schema context (and audio for voice) go to Groq on the user's account;
   - a link to console.groq.com/keys;
   - a confirm step before deleting the key and switching to the AtlasMind allowance;
   - a "reconnect to use your own key" note when `requiresReconnectForPersonal` is set.
5. `useVoice.js`: stop recording at 60 s. Composer: show only `AVAILABLE_MODELS` that are in `allowedModels`.
6. Run `npm --prefix client run lint`, `npm --prefix client test` and `npm --prefix client run build`.

### Session 4B: conversation mapping, fixtures, docs, full verification

Commit: `feat(client): provider error turns; docs: Groq keys and allowance`.

1. `lib/conversation.js`: map the codes to turns with actions:
   - `managed_allowance_exhausted`: "Use your own Groq key", plus the reset time;
   - `provider_key_invalid`: "Update key" / "Switch to AtlasMind allowance" when `payer === 'personal'`, operator text when it is `managed`;
   - `provider_rate_limited`: "Try again in N s";
   - `settings_changed`: refetch the settings and offer to resend;
   - `provider_model_unavailable`, `provider_unavailable`, `managed_accounting_unavailable`, `reconnect_required` and `origin_not_allowed`: plain messages.
2. Update the fixtures in `src/lib/__fixtures__/`, plus `conversation.test.js` and `queryStream.test.js`. In Playwright `tests/e2e/chat.spec.ts`, cover two flows: allowance exhausted → save key → success, and invalid key → switch to managed.
3. Docs:
   - `docs/API.md`: the settings endpoints, `expectedPayer`, every new error code (§7 plus the §0 extras), the voice 5 MB managed limit and the Origin rule.
   - `docs/DEPLOYMENT.md`: the §1 env vars, `CORS_ALLOWED_ORIGINS` now also gating non-GET requests, and the new collections.
   - `server/.env.example`: the §1 vars, and fix the comment that still says CBC to AES-256-GCM.
   - `CLAUDE.md` (Auth / Central DB paragraphs): mention `sid`, `provider_credentials`, `groq_allowance` and `/api/provider-settings`.
4. Run every command in §11, then the manual check with `start.bat`.

## 11. Verification

Server tests in `server/src/__tests__`. Mock the SDK through `setGroqClient` or a fake client factory, and use the synthetic key `gsk_test_SECRET`.

- `session.test.js`: new cookies carry `sid`; old cookies get managed only; `readSession` still returns a string.
- New `providerCredentialStore.test.js` and `providerSettings.test.js`: two sessions on one connection are isolated; an invalid key keeps the old state; expiry; a logout tombstone beats an in-flight PUT; `gsk_test_SECRET` never appears in responses or captured logs.
- `groqService.test.js`: a personal request uses the personal client for both Whisper and text; a 401 makes zero retries, zero fallbacks and zero managed calls; a long `retry-after` is surfaced immediately.
- New `allowance.test.js` (mongodb-memory-server if available, otherwise the existing test DB pattern): 50 parallel reservations never exceed either cap; UTC rollover; settlement refunds the difference; a timeout keeps the estimate; voice is charged even when the following text call is refused.
- `queryStream.test.js` and `routesSmoke.test.js`: the same error body for a pre-stream JSON 429, an in-stream `result` event and voice; `settings_changed` makes no Groq call; a foreign `Origin` gets 403.

Client: update `src/lib/__fixtures__`, `src/lib/conversation.test.js` and `src/lib/queryStream.test.js`. In Playwright `tests/e2e/chat.spec.ts`, stub two flows: allowance exhausted → save key → success, and invalid key → switch to managed.

From the repository root on Node 24, run each line and fix failures before moving on:

```powershell
npm --prefix server ci
npm --prefix client ci
npm --prefix server run typecheck
npm --prefix server test
npm --prefix client run lint
npm --prefix client test
npm --prefix client run build
Push-Location client
npx playwright install chromium
npm run test:e2e
Pop-Location
```

Manual check with `start.bat`: ask a question in managed mode and watch the allowance drop; save a real personal Groq key and confirm the managed counter stops moving; log out and confirm the `provider_credentials` document is tombstoned.

## Starting prompt for the next session

Use one prompt per session, replacing `<part>` with 3A, 3B, 4A or 4B, in that order:

> Continue the Groq BYOK plan in groq-byok-plan.md on branch feat/groq-byok-allowances. Read §0 (status, changes from the plan, known gaps) first, then implement session `<part>` from §10 only, as one commit with the checks it lists green. Follow CLAUDE.md and AGENTS.md. When done, update §0 (status table, commit hash, new gaps) and report anything that needs the operator's environment.

Steps 1 and 2 were completed in the first session with this prompt:

> Implement the Groq BYOK and managed-allowance plan in groq-byok-plan.md. Create an implementation branch from the tip of plan/groq-byok-allowances. Follow CLAUDE.md, AGENTS.md and the implementation sequence in §10, one commit per step. Keep personal keys scoped to a sign-in and managed quotas scoped to a connection and the installation. Use the default limits in §1 with enforce mode. Complete code, fixtures, docs and the local checks in §11, and report anything that needs the operator's environment.

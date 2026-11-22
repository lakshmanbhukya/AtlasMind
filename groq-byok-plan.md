# Groq personal keys and the AtlasMind allowance

**Resume in a new session.** Work from local branch `plan/groq-byok-allowances` and create an implementation branch from its tip. Follow `CLAUDE.md` and `AGENTS.md`. Start at step 1 of the implementation sequence (§10).

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

Each step is one focused commit with all checks green.

1. Session `sid`, credential store, logout revocation, settings routes, origin check, log redaction.
2. `resolveProvider` and its injection through query, stream and voice; error classification; managed model allow-list.
3. Allowance store and service, reserve/settle around every SDK attempt, structured errors in all three transports.
4. Client panel, hook, conversation mapping, fixtures; `docs/API.md`, `docs/DEPLOYMENT.md` and `server/.env.example` (also fix the CBC comment).

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

> Implement the Groq BYOK and managed-allowance plan in groq-byok-plan.md. Create an implementation branch from the tip of plan/groq-byok-allowances. Follow CLAUDE.md, AGENTS.md and the implementation sequence in §10, one commit per step. Keep personal keys scoped to a sign-in and managed quotas scoped to a connection and the installation. Use the default limits in §1 with enforce mode. Complete code, fixtures, docs and the local checks in §11, and report anything that needs the operator's environment.

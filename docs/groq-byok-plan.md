# Groq personal keys and the AtlasMind allowance

**Resume in a new session.** Work from local branch `plan/groq-byok-allowances`. The checkout is a React/Vite client and a CommonJS Express server with separate package files. This document specifies proposed behavior. Implementation starts with step 1 under “Implementation sequence.” The file map and contracts below are the engineering handoff.

Proposed first release. Existing connections start in managed mode. Users can explicitly switch to a Groq key for their current sign-in. AtlasMind enforces a configurable daily managed allowance per database connection and an installation-wide budget. Persistent personal accounts, credit purchases and cross-device key recovery are outside this release.

## Ownership and storage

`server/src/auth/session.js` signs a connection ID. `middleware/auth.js` exposes it to routes. The ID derives from the database URI and database name, so two people can share it. A personal key stored on `UserConnection` would allow either person to spend the other's quota.

- Add a random session ID on sign-in and expose the verified ID alongside the connection ID. Older valid cookies retain managed access and require a fresh sign-in to enable personal keys. Keep database authorization and tenant stores scoped to the verified connection ID.
- Store one credential record per session, filtered by both verified IDs. Encrypt the key with the existing AES-256-GCM helper in `server/src/utils/encryption.js`. Record mode and expiry. Check expiry on reads, use a TTL index for cleanup, and remove credentials on sign-out or key deletion. Treat a new sign-in as a new key setup.
- Introduce authenticated settings endpoints for reading status, validating and replacing a key, selecting the payer, and deleting a key. Validate a candidate against Groq before replacing a working key. Return only mode, configured status and managed allowance/reset information. Review origin protection for cookie-authenticated mutations and redact secrets from request and SDK error logs.

## Provider calls

`server/src/services/groqService.js` caches a process-wide client from `GROQ_API_KEY`. Text enters through `routes/query.js` and reaches `services/engine/naturalLanguageQuery.js`. Voice enters through `routes/voice.js`, calls Whisper, then invokes the query engine.

- Resolve one credential selection for each incoming request. Pass the selected client through transcription, query generation, model fallbacks and retries. Retain the cached managed client only for managed traffic. Resolve the managed environment key lazily so a personal-key request can run without it.
- Classify provider errors before applying existing fallback logic. Invalid keys and exhausted quota should produce actionable responses. Honor retry timing and avoid another model attempt for a rejected credential. A change of payer requires an explicit user action.
- Keep experiment hooks in `services/experiment.js` working. Meter each actual provider attempt at the SDK call boundary, including fallback calls. Preserve the guarded executor, approved writes and existing model selection.

## Managed quota

- Configure connection and installation limits in `server/.env.example`. Start with UTC calendar-day windows. Track text tokens and audio seconds separately. Choose production budgets from the operator's actual Groq limits and desired headroom. The UI labels them as AtlasMind allowances. Provider minute limits and usage by other apps can still cause a Groq 429.
- Before a managed call, reserve a conservative input-plus-maximum-output bound, or an audio-duration bound derived from validated media. Update both budget scopes atomically in persistent storage across server instances. One implementation is a MongoDB transaction over daily counter records and a unique attempt record. Verify deployment transaction support before selecting this design.
- Reconcile against provider usage even when later parsing or query execution fails. Make settlement idempotent. Release confirmed unspent reservations and retain a conservative charge through the window for ambiguous timeouts or crashes. Reserve separately for retries. Voice may consume audio even if the subsequent text call is declined.
- Personal-key calls bypass managed counters. Keep the existing IP guard and `middleware/rateLimiter.js` per-connection throttle in both modes. Enforce the global cap even when someone creates multiple connections. A true per-person managed allowance requires a durable user identity.

## Client and API

- Add a provider-key control in the signed-in app sidebar and API methods in `client/src/services/api.js`. Show the active payer, sign-in lifetime of a personal key, and remaining managed allowance with units and reset time. Clear the key field after submission. Keep secrets out of browser storage, URLs and chat history.
- Map separate error codes for managed allowance exhaustion, invalid personal key, provider throttling and AtlasMind request throttling. Update `routes/engineHttp.js`, voice error handling and `client/src/hooks/useChat.js` together. Offer reset or key setup when managed usage runs out and explicit switching when a personal key fails. Carry retry timing when available. Show an unknown provider balance when Groq supplies no reliable daily balance.
- Document endpoints, defaults, limits and session lifecycle in `docs/API.md` and the deployment guide. Update client response mapping and stubbed fixtures in the same change.

## Delivery and acceptance

### Decisions from the repository review

- **Keep payer selection explicit across tabs.** Return a settings revision with the active payer. New clients send their expected revision with text, streaming and multipart voice requests. Reject a stale revision with 409 before contacting Groq and refresh the settings UI. Keep legacy requests compatible in managed-only sessions. Deleting an active personal key should require an explicit switch to managed or leave the session unable to submit paid work. Test a second tab deleting or replacing a key between composing and sending a question.
- **Define the logout race.** The current logout handler only clears a cookie. Store the personal credential in the central metadata database and bind its expiry to the verified seven-day cookie expiry. On logout, revoke the session's credential and prevent a pending key validation from recreating it. Use a conditional revision update after validation. Preserve idempotent logout for missing or expired cookies. An upstream call already dispatched may finish and consume quota. Disallow new attempts using a revoked credential, including the text stage after transcription.
- **Preserve the streaming contract.** In `routes/query.js`, a started SSE stream carries failures in the terminal `result` event even though HTTP status is 200. Include error code, payer, and optional retry delay in the JSON body for every transport. Test a pre-stream JSON 429, an in-stream provider 429, and a voice failure through `client/src/lib/queryStream.js` or the voice client as appropriate. Keep retry user-initiated after an ambiguous disconnect and tell the user that an earlier attempt may have consumed quota.
- **Bound retries and model choice.** The current text retry loop caps waits at eight seconds. If Groq asks for a longer wait, surface that delay immediately. Preserve the shared SDK timeout, disabled SDK retries and streaming-upload adapter when constructing personal clients. Configure allowed managed models on the server so a submitted model ID cannot select an unbudgeted model. Keep any existing supported choices visible only when available to the selected payer.
- **Validate keys without sending database data.** Use a bounded Groq model-access check and a settings-specific rate limit. Show success as credential verification. Check text and Whisper permissions separately when those features are used. Before activation, explain that query generation sends the question and schema context to Groq, voice sends audio, and personal requests consume the selected organization's quota. Keep settings responses uncached and send sanitized application errors to the UI and logs.
- **Protect cookie-authenticated spending.** Production cookies use `SameSite=None`. Require a verified browser origin or a session-bound CSRF token on credential mutations and browser requests that initiate spending, including multipart voice. Exercise the configured cross-site production frontend and local Vite proxy in tests. Preserve existing supported API clients through a documented token path when Origin is absent.
- **Roll out accounting independently.** Start by measuring managed usage without enforcing the proposed daily limits. Before enforcement, confirm the central metadata database supports the chosen atomic reservation strategy, prove both caps under parallel load, and compare settled totals to a dedicated managed Groq project's usage over the same interval. Exercise duration measurement with an actual WebM/Opus recording from `useVoice.js`. When duration or the ledger is unavailable, decline the affected managed call before dispatch. An accounting outage should still allow an authenticated personal-key request if credential resolution succeeds.

### Pilot decisions for the operator

1. How much managed usage can the installation fund each day, and how many active connections should that cover? Set text and audio caps from measured pilot demand and the organization's actual limits. Set the installation cap first, then allocate per-connection allowances. Keep the existing short-window throttle for both payers.
2. Is entering a personal key again after a fresh database sign-in acceptable? The recommended pilot uses this lifetime. If keys must follow a person across devices or connections, add account ownership before offering persistent keys.

### Implementation sequence

1. Land session identity, encrypted storage and settings routes. Test two sign-ins sharing a connection, older cookies, failed replacement, expiry, logout and secret redaction.
2. Inject provider selection into both entry points. Use mocked Groq clients to verify simultaneous tenants, model retries and both stages of voice use the intended key. Verify an invalid personal key makes zero managed calls.
3. Add managed accounting and structured errors. Exercise parallel calls at both caps, UTC rollover, restart, duplicate settlement, malformed model output, ambiguous timeouts and audio followed by a rejected text call.
4. Ship the settings UI and documentation. Cover explicit switching and exhausted allowances with stubbed Playwright flows. Run server typecheck and Jest, then client lint, Vitest, build and Playwright under Node 24.
5. Enable for a pilot after reviewing measured token and audio use. Observe aggregate usage and error counts by payer without credentials or question text. If personal-key service is suspended, return an explicit unavailable response to those sessions until the user chooses managed mode.

## File map for implementation

Paths are relative to the repository root. New filenames below are suggestions.

| Area | Existing entry points | Change |
| --- | --- | --- |
| Session | `server/src/auth/session.js`, `middleware/auth.js` and `types/express.d.ts` under `server/src`, `server/src/routes/{connections,auth}.js` | Extend issued session claims and request types. Preserve the string-returning contract of existing `readSession` callers. Distinguish session claims from write-approval claims during verification. Wire logout to credential revocation. |
| Storage and bootstrap | `server/src/db/connection.js`, `server/src/stores/tenant.js`, `server/src/index.js` | Use the native MongoDB driver and central `getDb()`. Add settings and allowance stores. Initialize indexes alongside `dashboardStore.initializeIndexes()` before listening. A transaction helper would need the central MongoClient, currently private to the connection module. |
| Settings | New `server/src/routes/providerSettings.js` and `server/src/services/providerSettings.js`, existing `utils/encryption.js`, `utils/logger.js` and `middleware/rateLimiter.js` under `server/src` | Register the settings router after cookie parsing with `requireAuth`. Use the verified tenant and session, revision-checked updates, encryption and a limit on key validation. |
| Generation | `server/src/routes/{query,voice}.js`, `server/src/services/queryExecutionEngine.js`, `server/src/services/engine/naturalLanguageQuery.js`, `server/src/services/groqService.js` | Pass server-created payer context through the engine facade to `generateMQL`. Pass it directly to `transcribeAudio` as well. Resolve and meter at dispatch so early clarification, history reads, export and approved writes incur zero provider usage when they make zero provider calls. |
| Errors | `server/src/services/engineErrors.js`, `server/src/routes/engineHttp.js`, `client/src/lib/{apiError,queryStream,conversation}.js` | Map a typed provider failure to public fields before the adapter logs or serializes it. Today `errorResult` can forward an arbitrary error message. Test sanitized JSON, SSE and voice responses. |
| UI | `client/src/components/app/{AppShell,Sidebar,ChatThread}.jsx`, `client/src/hooks/{useAuth,useChat,useVoice}.js`, `client/src/services/api.js`, `client/src/lib/models.js` | Share settings state between sidebar and chat, clear it on logout/reconnect and send revisions from both the fetch-based stream and Axios voice path. Intersect the displayed model list with server-supported models. |

## Proposed HTTP contract

Mount under `/api/provider-settings`. Return `Cache-Control: no-store`. The only request containing a raw key is the credential replacement request. Validate the candidate before the atomic write. A successful replacement selects personal mode with the user's explicit “Save and use” action.

| Request | Input | Success |
| --- | --- | --- |
| GET /api/provider-settings | Session cookie | 200 with `{success:true,data:{mode,revision,hasKey,sessionExpiresAt,managedAllowance,allowedModels}}`. Legacy sessions also get `requiresReconnectForPersonal:true`. |
| PUT /api/provider-settings/key | JSON `{apiKey,expectedRevision}` | 200 with updated public settings. Invalid candidates preserve the previous settings and revision. |
| PATCH /api/provider-settings | JSON `{mode,expectedRevision}` | 200 with new revision. Personal mode requires a usable stored credential. Managed mode is an explicit choice. |
| DELETE /api/provider-settings/key | JSON `{expectedRevision}` | 200 with new revision. Reject removal while personal is selected with 409 and present “Switch to managed and remove” as an explicit UI action. Switch first, then issue revision-checked deletion. |

Use an integer revision starting at zero. Return UTC timestamps in ISO 8601 format. `managedAllowance` contains the connection's remaining text tokens, audio seconds and reset time when enforcement is enabled. Declare accounting mode separately as `observe` or `enforce`. Keep the installation-wide balance private. Personal mode shows that Groq manages the balance.

Send `expectedRevision` in the JSON body of query and stream POSTs and as a decimal multipart field on voice POSTs. Parse and validate it once. The server chooses the actual payer from verified settings. Return `{success:false,error:{code,message,payer?,retryAfterSeconds?,resetAt?}}`. Suggested codes are `settings_changed` (409), `provider_key_invalid` (422), `provider_model_unavailable` (422), `managed_allowance_exhausted` (429), `provider_rate_limited` (429) and `managed_accounting_unavailable` (503). Preserve existing session and local limiter codes. A provider credential error must leave the AtlasMind session signed in.

## Persistence and rollout defaults

- Store settings with a unique compound index on connection ID and session ID, and a separate TTL index on expiry. Keep a revisioned record when the key is removed. Clear ciphertext and mark a credential revoked on logout through session expiry so an in-flight compare-and-swap cannot resurrect it.
- In the transaction-backed ledger, identify daily counters by UTC day, scope, scope ID and unit. Give each SDK dispatch its own attempt ID. Reserve both counters and insert the attempt in one transaction, call Groq outside it, then conditionally settle a still-pending attempt against its original UTC day. A transaction retry must never replay a provider call. Keep accounting records free of credentials, audio, schema and prompts.
- Suggested configuration names are `GROQ_ALLOWANCE_MODE` (initially `observe`) and `GROQ_{CONNECTION,GLOBAL}_DAILY_{TOKENS,AUDIO_SECONDS}` (four explicit integer limits). Validate configuration and topology before enabling enforcement. If production limits or topology are unknown, ship code and automated tests with observation as the default and leave production activation to the operator.

## Verification handoff

Use synthetic keys and mocked SDK calls. Extend server suites `session.test.js`, `authMe.test.js`, `groqService.test.js`, `queryExecutionEngine.test.js`, `queryStream.test.js` and `routesSmoke.test.js` in `server/src/__tests__`. Add focused tests for the new credential store and quota ledger. Run the concurrency and crash-recovery checks against a disposable transaction-capable MongoDB instance before enabling managed enforcement. Update `client/src/lib/__fixtures__`, `client/src/lib/queryStream.test.js`, `client/src/lib/conversation.test.js`, and `client/tests/e2e/chat.spec.ts`. Assert outbound call counts by payer, and inspect captured logs and responses for the synthetic secret on validation failure.

From the repository root on Windows, use Node 24. Install dependencies once per package. Run each line separately and resolve failures before advancing.

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

### Starting prompt for the next session

> Implement the Groq BYOK and managed-allowance plan in docs/groq-byok-plan.md. Start from plan/groq-byok-allowances and create an implementation branch from its tip. Follow AGENTS.md and the implementation sequence. Use the file map, contracts and acceptance cases in this document. Keep server credentials scoped to a sign-in and managed quotas scoped to a connection and the installation. Use observation mode for the pilot. Complete code, fixtures, docs and local checks. Report any deployment checks that still need the operator's environment.

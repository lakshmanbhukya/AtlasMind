# Groq personal keys and the AtlasMind allowance

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

1. Land session identity, encrypted storage and settings routes. Test two sign-ins sharing a connection, older cookies, failed replacement, expiry, logout and secret redaction.
2. Inject provider selection into both entry points. Use mocked Groq clients to verify simultaneous tenants, model retries and both stages of voice use the intended key. Verify an invalid personal key makes zero managed calls.
3. Add managed accounting and structured errors. Exercise parallel calls at both caps, UTC rollover, restart, duplicate settlement, malformed model output, ambiguous timeouts and audio followed by a rejected text call.
4. Ship the settings UI and documentation. Cover explicit switching and exhausted allowances with stubbed Playwright flows. Run server typecheck and Jest, then client lint, Vitest, build and Playwright under Node 24.
5. Enable for a pilot after reviewing measured token and audio use. Observe aggregate usage and error counts by payer without credentials or question text. If personal-key service is suspended, return an explicit unavailable response to those sessions until the user chooses managed mode.

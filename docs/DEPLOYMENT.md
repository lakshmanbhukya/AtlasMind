# Deployment Guide (Netlify + Render)

This guide deploys AtlasMind as:

- Backend on Render
- Frontend on Netlify

## Backend on Render

Create a Render Web Service with:

- Root directory: server
- Build command: npm install
- Start command: npm start

Set environment variables:

- NODE_ENV=production
- PORT=3001
- `CORS_ALLOWED_ORIGINS=https://your-netlify-site.netlify.app`
- MONGODB_URI=your_metadata_db_uri
- GROQ_API_KEY=your_groq_api_key
- JWT_SECRET=your_long_random_secret
- ENCRYPTION_KEY=64_hex_chars
- Optional: `LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`; default `info`)

### Groq allowance (managed key)

`GROQ_API_KEY` pays for every connection that has not stored its own Groq key (the "AtlasMind allowance"). A free Groq key gives about 200K tokens a day, and one question costs about 3–6K, so the allowance is metered per UTC day. The window resets at UTC midnight (05:30 IST). All of these settings are optional; the defaults are shown:

| Variable | Default | Meaning |
| --- | --- | --- |
| `GROQ_ALLOWANCE_MODE` | `enforce` | `enforce` refuses managed calls past a limit (429 `managed_allowance_exhausted`). `observe` records usage and never refuses. `off` skips accounting entirely. |
| `GROQ_GLOBAL_DAILY_TOKENS` | `160000` | Tokens per day for the whole installation (about 80% of Groq's daily limit, leaving room for retries and development use of the same key). |
| `GROQ_CONNECTION_DAILY_TOKENS` | `25000` | Tokens per day per connection (about 5–6 questions). |
| `GROQ_GLOBAL_DAILY_AUDIO_SECONDS` | `3600` | Voice seconds per day for the installation. |
| `GROQ_CONNECTION_DAILY_AUDIO_SECONDS` | `600` | Voice seconds per day per connection. |
| `MANAGED_MODELS` | `openai/gpt-oss-120b,openai/gpt-oss-20b` | Models managed traffic may use. Any other model falls back to `openai/gpt-oss-120b` when it is listed, otherwise to the first entry. Personal keys may use every client model. |

- Without `GROQ_API_KEY`, managed requests fail with 503 `provider_unavailable`; users with their own key still work.
- In `enforce` mode, if the ledger (`groq_allowance` in the central DB) cannot be read, managed requests get 503 `managed_accounting_unavailable`.
- Each settled managed call logs one `Managed Groq usage` line with `{ payer, unit, estimate, actual, model }` (no question text, no keys). Use a week of these lines to tune the limits.
- Groq also has per-minute limits per model; check the Groq console for the chosen models.

### Central collections added for Groq keys

Both are created on startup with their indexes; no migration is needed.

- `provider_credentials`: one document per sign-in (`connectionId` + session `sid`) holding the encrypted personal key (AES-256-GCM, `ENCRYPTION_KEY`). A TTL index removes it when the session cookie expires; logout leaves a tombstone that the TTL removes later.
  - Each server process caches one Groq client per sign-in for personal keys. Removing a key or logging out drops that cache entry only in the process that handled the request. With several instances this is harmless: every request reads and decrypts the stored key again, so a removed or revoked key is never used, and the stale entry is replaced or evicted later.
- `groq_allowance`: one document per UTC day with installation and per-connection usage, removed by a TTL index 8 days after the day ends.

Session cookies issued before this release have no `sid`. They keep working on the AtlasMind allowance; to store a personal key, the user disconnects and connects again.

The server logs one JSON object per line to stdout (pino), which Render's log view shows as is. Each request gets an `X-Request-Id` response header (an incoming `x-request-id` of up to 64 letters, digits, `_` or `-` is reused), and its "request completed" line carries the same ID as `req.id`, plus `connectionId` once the session is known. `/api/health` hits are not logged.

## One-off migrations

### connectionId includes the database name

A `connectionId` is the hash of the connection string **and** `dbName`, so one cluster connected with two databases gives two separate sessions. Connections stored before this change still have the old ID. Run the migration once after deploying this change, from `server/` with the production `MONGODB_URI` and `ENCRYPTION_KEY` set (in a Render shell, for example):

```bash
npm run migrate:connection-ids -- --dry-run   # report what would move; writes nothing
npm run migrate:connection-ids                # apply
```

- It re-keys `user_connections` and the tenant rows in `query_history`, `dashboards`, `workspaces` and `few_shot_examples`. Share links keep working, because they use `shareToken`.
- It is safe to re-run. A connection already on its new ID is skipped, and an interrupted run finishes on the next one.
- It logs counts and shortened IDs only, never connection strings. A connection it cannot decrypt (for example, after an `ENCRYPTION_KEY` change) is reported, left as it is, and the command exits with status 1.
- Every user reconnects once: their cookie holds the old ID, so `/api/auth/me` answers 401 and the app shows the connect screen. Write approvals that are pending at that moment (10-minute life) also need to be redone.
- If you skip the migration, users who reconnect get new, empty history, dashboards and workspaces. Their old rows remain under the old ID.

## Frontend on Netlify

Create a Netlify site with:

- Base directory: client
- Build command: npm run build
- Publish directory: client/dist

Set environment variable:

- `VITE_SERVER_URL=https://your-render-service.onrender.com`

The client already appends /api and trims trailing slash in runtime config.

## SPA Routing

Ensure client/netlify.toml contains a redirect to index.html:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

## Cookies and CORS Notes

Session behavior:

- Cookie name: am_token
- In production: Secure=true, SameSite=None, HttpOnly=true
- Client requests must include credentials

CORS behavior in current server implementation:

- Credentials enabled
- In production, requests are allowed only from origins listed in CORS_ALLOWED_ORIGINS
- `CORS_ALLOWED_ORIGINS` also gates every non-GET `/api/*` request that carries an `Origin` header: any other origin gets 403 `origin_not_allowed`, in development too (where `http://localhost:5173` and `http://127.0.0.1:5173` are always allowed). Requests without `Origin` (curl, health checks) are unaffected. Add every frontend origin, including Netlify preview URLs you use, or their questions will be refused.

If you need multiple allowed origins, separate them with commas:

- `CORS_ALLOWED_ORIGINS=https://your-netlify-site.netlify.app,https://preview--your-site.netlify.app`

For stricter production posture, restrict origin allow-list explicitly before go-live.

## Verification Checklist

1. Render service starts and /api/health returns success.
2. Netlify frontend loads and can call backend.
3. Connect flow sets cookie and /api/auth/me returns success.
4. Query, schema, voice, and dashboard routes work with authenticated session.
5. The sidebar shows the AtlasMind allowance, and it goes down after a question. Saving a personal Groq key switches the sidebar to "Your Groq key"; after disconnecting, that sign-in's `provider_credentials` document is a tombstone (`revoked: true`, no key).

---

[Back to README](../README.md)

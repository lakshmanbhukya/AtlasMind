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

## One-off migrations

### F15: connectionId includes the database name

Since F15, a `connectionId` is the hash of the connection string **and** `dbName`, so one cluster connected with two databases gives two separate sessions. Connections stored before F15 still have the old ID. Run the migration once after deploying F15, from `server/` with the production `MONGODB_URI` and `ENCRYPTION_KEY` set (in a Render shell, for example):

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

If you need multiple allowed origins, separate them with commas:

- `CORS_ALLOWED_ORIGINS=https://your-netlify-site.netlify.app,https://preview--your-site.netlify.app`

For stricter production posture, restrict origin allow-list explicitly before go-live.

## Verification Checklist

1. Render service starts and /api/health returns success.
2. Netlify frontend loads and can call backend.
3. Connect flow sets cookie and /api/auth/me returns success.
4. Query, schema, voice, and dashboard routes work with authenticated session.

---

[Back to README](../README.md)

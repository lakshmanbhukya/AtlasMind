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

# Troubleshooting and Support

Common issues and fixes for AtlasMind.

## Backend Startup Issues

### Missing MONGODB_URI

Symptom:

- Server exits on startup with environment variable error.

Fix:

- Set MONGODB_URI in server/.env.
- Confirm URI points to the metadata database AtlasMind can access.

### Missing JWT_SECRET

Symptom:

- Auth routes fail or sessions behave unpredictably.

Fix:

- Set JWT_SECRET in server/.env to a long random string.

### Invalid ENCRYPTION_KEY

Symptom:

- Connect flow may fail to decrypt stored URI later.

Fix:

- Use a stable 64-character hex key in ENCRYPTION_KEY.

## Connection and Session Problems

### Could not connect to MongoDB

Symptom:

- Connect request returns connection error.

Fix:

- Verify connection string format starts with mongodb.
- Check Atlas network access IP allow-list.
- Ensure DB user permissions are correct.

### empty_database response when connecting

Symptom:

- Connect endpoint returns empty_database and availableDatabases.

Fix:

- Choose a DB name that has non-system collections.
- Use one of the returned availableDatabases entries.

### unauthenticated or session_expired

Symptom:

- Protected routes (/query, /schema, /voice, /dashboard) return 401.

Fix:

- Reconnect via landing page to refresh session cookie.
- Ensure frontend requests send credentials.
- In production, confirm HTTPS is used so Secure cookies work.

## Query and Schema Issues

### safety_violation response

Symptom:

- Query returns 422 with blocked stage/operator message.

Fix:

- Rephrase request as read-only analytics.
- Avoid asking for update/delete/drop semantics.

### Query failed due to schema mismatch

Symptom:

- Pipeline executes with error or empty results unexpectedly.

Fix:

- Refresh schema via /api/schema/refresh.
- Verify collection and field names exist in target DB.

## Voice Endpoint Issues

### No audio file uploaded

Symptom:

- voice endpoint returns validation_error.

Fix:

- Send multipart/form-data with file field name audio.

### Audio file too large

Symptom:

- Upload error from multer.

Fix:

- Keep audio size under 25 MB.

### Unsupported audio format

Symptom:

- Upload rejected by fileFilter.

Fix:

- Use supported formats: mp3, wav, webm, ogg, flac, m4a, or mp4 audio.

## Groq API Problems

### 429 or timeout from LLM/transcription

Fix:

- Retry after cooldown.
- Reduce burst traffic.
- Validate GROQ_API_KEY and account quota.

## Support

For bugs and feature requests, open an issue:
https://github.com/lakshmanbhukya/AtlasMind/issues

---

[Back to README](../README.md)

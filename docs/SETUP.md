# Installation and Setup

Follow these steps to run AtlasMind locally.

## Prerequisites

- Node.js 18+
- npm
- MongoDB Atlas account
- Groq API key

## 1. Clone Repository

```bash
git clone https://github.com/lakshmanbhukya/AtlasMind.git
cd AtlasMind
```

## 2. Install Dependencies

```bash
cd server
npm install
cd ../client
npm install
```

## 3. Configure Backend Environment

Create server/.env:

```env
# AtlasMind metadata database connection
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<metadata_db>

# Groq
GROQ_API_KEY=your-groq-api-key

# Auth and encryption
JWT_SECRET=your-long-random-secret
ENCRYPTION_KEY=64_hex_chars_for_aes_256

# Server
PORT=3001
NODE_ENV=development
```

Important:

- MONGODB_URI is used by AtlasMind for internal collections (connections/history/dashboards).
- The user analytics database is provided at runtime via the Connect form and /api/connections/connect.

## 4. Start App

Option A (Windows):

```bash
start.bat
```

Option B (manual):

```bash
cd server
npm run dev
```

In another terminal:

```bash
cd client
npm run dev
```

Default URLs:

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- Health: http://localhost:3001/api/health

## 5. Connect a User Database

From the landing page, provide:

- MongoDB connection string
- Database name

AtlasMind validates the DB, stores encrypted connection metadata, and starts a cookie session.

## Optional: Seed Internal Demo Data

```bash
cd server
npm run seed
```

## Credentials Quick Notes

Groq:

1. Create key at https://console.groq.com
2. Paste into GROQ_API_KEY

MongoDB Atlas:

1. Create cluster
2. Add IP access
3. Create DB user
4. Use SRV connection string

## Next

For production deployment, see [DEPLOYMENT.md](./DEPLOYMENT.md).

---

[Back to README](../README.md)

# 🚀 Deployment Guide: AtlasMind (Netlify + Render)

This guide outlines the production deployment flow for AtlasMind without using Docker.

## 🏗️ Backend: Render (Web Service)

Render is the recommended host for the Node.js API.

### **Steps:**
1. **GitHub Connection**: Connect your repository to Render.
2. **Setup Settings**:
   - **Service Type**: `Web Service`
   - **Environment**: `Node`
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
3. **Environment Variables**:
   - `NODE_ENV`: `production` (Crucial for cross-site cookie security)
   - `PORT`: `3001`
   - `MONGODB_URI`: (Your Atlas Mind Mongo URI)
   - `GROQ_API_KEY`: (Your Groq API Key)
   - `ENCRYPTION_KEY`: (32-byte / 64-char Hex Key)
   - `JWT_SECRET`: (Long random string)

---

## 🎨 Frontend: Netlify

Netlify hosts the static Vite application.

### **Steps:**
1. **GitHub Connection**: Select your repository.
2. **Build Settings**:
   - **Base directory**: `client`
   - **Build command**: `npm run build`
   - **Publish directory**: `client/dist`
3. **Environment Variables**:
   - `VITE_SERVER_URL`: `https://your-server-name.onrender.com` (Your Render URL)

### **Routing (netlify.toml)**
A `netlify.toml` file is required in the `client/` folder to handle SPA routing:
```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## 🔗 CORS & Cookie Configuration

Your application is pre-configured for this split deployment:

### **CORS (server/src/index.js)**:
Allows credentials (cookies) and origin matching.

### **Cookies (server/src/routes/connections.js)**:
In production (`NODE_ENV=production`), cookies are set with:
- `Secure: true`: Required for cross-site cookies.
- `SameSite: 'None'`: Allows the cookie to be sent from the Netlify domain to the Render domain.
- `HttpOnly: true`: Prevents XSS.

---

## ✅ Deployment Checklist

1. [ ] Push repo to GitHub.
2. [ ] Wait for Render build to show `🚀 AtlasMind server running...`.
3. [ ] Wait for Netlify build to succeed.
4. [ ] Ensure `VITE_SERVER_URL` on Netlify has no trailing slash.
5. [ ] **Live URL**: [https://atlasmind19.netlify.app/](https://atlasmind19.netlify.app/)

---
[⬅️ Back to README](../README.md)

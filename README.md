<div align="center">
  <h1>AtlasMind</h1>
  <p><strong>Ask your MongoDB questions in plain English or by voice. Get a safe, read-only query and a chart back.</strong></p>

  <p>
    <a href="https://atlasmind19.netlify.app/"><strong>Live Demo</strong></a> ·
    <a href="./docs/SETUP.md"><strong>Docs</strong></a>
  </p>

  <p>
    <img alt="GitHub Stars" src="https://img.shields.io/github/stars/lakshmanbhukya/AtlasMind?style=for-the-badge&logo=github" />
    <img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" />
    <img alt="Node" src="https://img.shields.io/badge/Node-%3E%3D18-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  </p>

  <p>
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
    <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" />
    <img alt="TanStack Query" src="https://img.shields.io/badge/TanStack_Query-5-FF4154?style=for-the-badge&logo=reactquery&logoColor=white" />
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
    <img alt="Express" src="https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white" />
    <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-6_Driver-47A248?style=for-the-badge&logo=mongodb&logoColor=white" />
    <img alt="Groq" src="https://img.shields.io/badge/Groq-LLM-F55036?style=for-the-badge" />
    <img alt="Whisper" src="https://img.shields.io/badge/Whisper-Voice-0EA5E9?style=for-the-badge" />
    <img alt="Jest" src="https://img.shields.io/badge/Jest-30-C21325?style=for-the-badge&logo=jest&logoColor=white" />
    <img alt="Docker server image" src="https://img.shields.io/badge/Docker-Server_Image-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
    <img alt="GitHub Actions" src="https://img.shields.io/badge/GitHub_Actions-CI-2088FF?style=for-the-badge&logo=githubactions&logoColor=white" />
    <img alt="Netlify" src="https://img.shields.io/badge/Netlify-Frontend-00C7B7?style=for-the-badge&logo=netlify&logoColor=white" />
    <img alt="Render" src="https://img.shields.io/badge/Render-Backend-46E3B7?style=for-the-badge&logo=render&logoColor=black" />
  </p>
</div>

---

## How it works

![How AtlasMind works](./assets/how-it-works.png)

---

## Architecture

![How AtlasMind works](./assets/NL-to-MQL-App-Architecture.png)

- **Two kinds of database.** The central DB holds app state. Your own databases are reached only through a per-connection pool.
- **Thin routes, deep engine.** Routes are HTTP adapters; all orchestration lives in `services/queryExecutionEngine.js`.
- **Read-only by default.** Every pipeline passes the Safety Guard, and writes need a signed, single-use approval token.

<!-- ![AtlasMind Architecture](./assets/atlasmind-archify.png) -->

Full details and sequence diagrams: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

---

## Quick start

```bash
git clone https://github.com/lakshmanbhukya/AtlasMind.git
cd AtlasMind

# Backend
cd server
npm install
cp .env.example .env   # set MONGODB_URI, GROQ_API_KEY, ENCRYPTION_KEY, JWT_SECRET
npm run dev            # http://localhost:3001

# Frontend (new terminal)
cd client
npm install
npm run dev            # http://localhost:5173
```

More in [docs/SETUP.md](./docs/SETUP.md).

---

## Note

Chat UI design takes inspiration from the clean, minimalist chat interface of Claude Web.

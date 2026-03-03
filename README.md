<div align="center">
  <img src="https://user-images.githubusercontent.com/74038190/212284100-561aa473-3905-4a80-b561-0d28506553ee.gif" width="100%" alt="Banner" />
  <h1>🚀 AtlasMind</h1>
  <p><b>Talk to your data. AI-Powered Conversational BI for MongoDB.</b></p>
  
  <p>
    <a href="https://atlasmind19.netlify.app/"><b>🌐 Live Demo</b></a> • <br><br>
    <img alt="Stars" src="https://img.shields.io/github/stars/lakshmanbhukya/AtlasMind?style=for-the-badge&logo=github"/>
    <img alt="Status" src="https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge"/>
    <img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge"/>
  </p>
</div>

---

## 🔍 Overview

**AtlasMind** is a state-of-the-art conversational BI platform that transforms natural language into complex MongoDB queries (MQL). Built with **React**, **Node.js**, and **Groq's ultra-fast LPU inference**, it empowers anyone—from developers to business users—to explore datasets, generate visualizations, and build live dashboards through simple conversation.

---

## 🧭 Documentation Portal

To keep things organized, our documentation is split into several focused guides:

| Guide | Description |
|---|---|
| 🏗️ **[Architecture](./docs/ARCHITECTURE.md)** | System design, AI pipeline flowcharts (Mermaid), and tech stack. |
| ⚙️ **[Setup Guide](./docs/SETUP.md)** | Step-by-step installation, env variables, and quick start. |
| 🌟 **[Features & Usage](./docs/FEATURES.md)** | Key features, query patterns, and example asks. |
| 📡 **[API Reference](./docs/API.md)** | Endpoint definitions and request/response examples. |
| 📄 **[Development](./docs/DEVELOPMENT.md)** | Project structure, testing strategies, and roadmap. |
| 🚀 **[Deployment](./docs/DEPLOYMENT.md)** | Manual deployment to Netlify (Frontend) and Render (Backend). |
| 🔧 **[Troubleshooting](./docs/TROUBLESHOOTING.md)** | Common issues, 429 errors, and connection fixes. |

---

## 🏗️ High-Level Architecture

```mermaid
flowchart LR
    A[User Query] --> B[AI Intelligence]
    B --> C[Safety Guard]
    C --> D[MongoDB Atlas]
    D --> E[Interactive Visualization]
    E --> F[Dashboard Widget]
```

---

## 🚀 Key Highlights

- ⚡ **Groq LPU Acceleration**: Sub-200ms query generation using Llama 3.3.
- 🎙️ **Voice Recognition**: End-to-end speech-to-query-to-insights pipeline.
- 🛡️ **MQL Safety Guard**: Production-grade validation prevents destructive operations.
- 📱 **Mobile-First Design**: Fully responsive UI with side drawers and glassmorphism.
- 📊 **Multi-Panel Analytics**: Interactive Chat Panel + Persistent Pinned Dashboards.

---

- **Core**: Node.js, Express, React (Vite), MongoDB.
- **Styling**: Tailwind CSS, Framer Motion.
- **AI**: Groq (Llama 3.3), Schema Profiler, Few-Shot Retriever.
- **Data**: Recharts, TanStack Query.

---

## 🐳 Docker Deployment

AtlasMind is fully containerized. Images are automatically built and pushed to Docker Hub upon successful CI on the `main` branch.

### Manual Build
To build images manually:

```bash
# Server
docker build -t your-username/atlasmind-server ./server

# Client
docker build -t your-username/atlasmind-client ./client
```

### Environment Variables
Ensure you have a `.env` file in the `server/` directory based on `.env.example`.

### GitHub Actions
A CI workflow is included in `.github/workflows/ci.yml` that automatically builds and tests the application on every push to `main`.

---

### GitHub Secrets
To enable the CI/CD pipeline, add the following secrets to your GitHub repository settings:

| Secret | Description |
|---|---|
| `DISCORD_WEBHOOK` | Discord webhook URL for notifications. |
| `DOCKERHUB_USERNAME` | Your Docker Hub username. |
| `DOCKERHUB_TOKEN` | Docker Hub Access Token. |

---

## 👨‍💻 Author

**Lakshman Bhukya**
Full-Stack Developer | AI Enthusiast

[![GitHub](https://img.shields.io/badge/GitHub-lakshmanbhukya-181717?style=flat-square&logo=github)](https://github.com/lakshmanbhukya)

---
<div align="center">
  <img src="https://img.shields.io/badge/Built%20with-%E2%9D%A4-red?style=for-the-badge" />
</div>

<div align="center">
  <img src="https://user-images.githubusercontent.com/74038190/212284100-561aa473-3905-4a80-b561-0d28506553ee.gif" width="100%" alt="AtlasMind banner" />

  <h1>AtlasMind</h1>
  <p><strong>Talk to your data. Get production-ready insights in <200 ms.</strong></p>

  <p>
    <a href="https://atlasmind19.netlify.app/"><strong>Live Demo</strong></a>
  </p>

  <p>
    <img alt="GitHub Stars" src="https://img.shields.io/github/stars/lakshmanbhukya/AtlasMind?style=for-the-badge&logo=github" />
    <img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" />
    <img alt="Node" src="https://img.shields.io/badge/Node-%3E%3D18-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  </p>
</div>

---

## Why AtlasMind

AtlasMind is a conversational BI platform for MongoDB that combines:

- Natural language analytics
- Voice-to-insight pipelines
- Read-only safety enforcement
- Fast chart-first exploration

You ask a question in plain English. AtlasMind profiles schema context, generates aggregation logic, validates it for safety, executes the query, and returns a visual answer with explanation.

---

## Tech Stack (Shields)

### Frontend

![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![React Router](https://img.shields.io/badge/React_Router-7-CA4245?style=for-the-badge&logo=reactrouter&logoColor=white)
![TanStack Query](https://img.shields.io/badge/TanStack_Query-5-FF4154?style=for-the-badge&logo=reactquery&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Framer Motion](https://img.shields.io/badge/Framer_Motion-12-0055FF?style=for-the-badge&logo=framer&logoColor=white)
![Recharts](https://img.shields.io/badge/Recharts-3-22C55E?style=for-the-badge)
![Axios](https://img.shields.io/badge/Axios-1-5A29E4?style=for-the-badge&logo=axios&logoColor=white)

### Backend

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-6_Driver-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-Cookie_Session-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)
![Multer](https://img.shields.io/badge/Multer-File_Upload-FF6B6B?style=for-the-badge)
![Jest](https://img.shields.io/badge/Jest-30-C21325?style=for-the-badge&logo=jest&logoColor=white)

### AI and Speech

![Groq](https://img.shields.io/badge/Groq-LPU-F55036?style=for-the-badge)
![Llama 3.3 70B](https://img.shields.io/badge/Llama-3.3_70B_Versatile-1E293B?style=for-the-badge)
![Kimi K2](https://img.shields.io/badge/Kimi-K2_Instruct-6366F1?style=for-the-badge)
![Llama 3.1 Instant](https://img.shields.io/badge/Llama-3.1_8B_Instant-F59E0B?style=for-the-badge)
![Whisper](https://img.shields.io/badge/Whisper-large_v3_turbo-0EA5E9?style=for-the-badge)
![Safety Guard](https://img.shields.io/badge/Safety-Read_Only_Guard-16A34A?style=for-the-badge)

### DevOps and CI

![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Images-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Netlify](https://img.shields.io/badge/Netlify-Frontend-00C7B7?style=for-the-badge&logo=netlify&logoColor=white)
![Render](https://img.shields.io/badge/Render-Backend-46E3B7?style=for-the-badge&logo=render&logoColor=black)

---

## What Makes It Different

- Schema-aware prompting: generated pipelines are grounded in profiled collection/field metadata.
- Safety-first query execution: blocked stages/operators are rejected before execution.
- Session-based security: httpOnly JWT cookie for protected analytics routes.
- Voice-to-query support: upload audio and get chartable results in one flow.
- Persistent dashboard pins: save and refresh important query snapshots.

---

## Architecture Snapshot

```mermaid
flowchart TD
    subgraph CLIENT["🖥️  Client Layer"]
        direction TB
        U("👤 User")
        UI("⚡ React + Vite UI")
        VOICE("🎙️ Voice Upload")
        PIN("📌 Pin to Dashboard")
    end

    subgraph GATEWAY["🔐  API Gateway  ·  Express + JWT"]
        direction TB
        AUTH("🔑 Auth · httpOnly Cookie")
        ROUTE("🔀 Route · /query  /voice  /pin")
        SCHEMA("🗂️ Schema Profiler · Field & Collection Metadata")
        FEWSHOT("🧠 Few-Shot Retriever · Cosine Similarity")
    end

    subgraph AI["🤖  AI Pipeline  ·  Groq LPU"]
        direction TB
        LLM("⚡ LLM · llama-3.3-70b / kimi-k2 / compound")
        GUARD("🛡️ Safety Guard · Read-Only Enforcer")
        WHISPER("🎧 Whisper · whisper-large-v3-turbo")
    end

    subgraph DATA["🗄️  Data Layer  ·  MongoDB"]
        direction TB
        AGG("⚙️ Aggregation Executor")
        RESULT("📊 Charts + Explanation")
        DASH("🗃️ Dashboard Store")
    end

    U -- "Text Query" --> UI
    U -- "Audio File" --> VOICE
    UI --> AUTH
    VOICE --> AUTH
    AUTH --> ROUTE

    ROUTE --> SCHEMA
    SCHEMA --> FEWSHOT
    FEWSHOT --> LLM

    VOICE -- "Buffer" --> WHISPER
    WHISPER -- "Transcript" --> LLM

    LLM --> GUARD
    GUARD -- "✅ Safe MQL" --> AGG
    GUARD -- "🚫 Blocked" --> ROUTE

    AGG --> RESULT
    RESULT --> UI
    RESULT --> PIN
    PIN --> DASH

    classDef clientNode  fill:#1e293b,stroke:#6366f1,color:#e2e8f0,rx:8
    classDef gatewayNode fill:#1e293b,stroke:#0ea5e9,color:#e2e8f0,rx:8
    classDef aiNode      fill:#1e293b,stroke:#f59e0b,color:#e2e8f0,rx:8
    classDef dataNode    fill:#1e293b,stroke:#22c55e,color:#e2e8f0,rx:8

    class U,UI,VOICE,PIN clientNode
    class AUTH,ROUTE,SCHEMA,FEWSHOT gatewayNode
    class LLM,GUARD,WHISPER aiNode
    class AGG,RESULT,DASH dataNode
```


## Documentation Portal

| Guide                                        | Purpose                                      |
| -------------------------------------------- | -------------------------------------------- |
| [Architecture](./docs/ARCHITECTURE.md)       | System design, flows, and technical patterns |
| [Setup](./docs/SETUP.md)                     | Local installation and configuration         |
| [Features](./docs/FEATURES.md)               | Product capabilities and usage ideas         |
| [API](./docs/API.md)                         | Endpoint contracts and response shapes       |
| [Development](./docs/DEVELOPMENT.md)         | Workflow, tests, and conventions             |
| [Deployment](./docs/DEPLOYMENT.md)           | Netlify + Render deployment path             |
| [Troubleshooting](./docs/TROUBLESHOOTING.md) | Common failures and fixes                    |


## Model Roster

AtlasMind supports dynamic model switching from the chat UI. The active Groq model lineup is:

| Model | Provider | Role | Speed |
| ----- | -------- | ---- | ----- |
| `openai/gpt-oss-120b` | OpenAI Community | Default — flagship precision MQL generation & schema reasoning | Balanced |
| `openai/gpt-oss-20b` | OpenAI Community | Lightweight ultra-fast MQL prototyping | Fastest |
| `groq/compound` | Groq Labs | Multi-model agentic router with safety validation | Sub-150ms |
| `qwen/qwen3.8-27b` | Alibaba Cloud | Frontier coder architecture for complex nested Mongo queries | Fast |
| `qwen/qwen3.6-27b` | Alibaba Cloud | Structured data reasoning for relational joins and aggregations | Fast |
| `whisper-large-v3-turbo` | OpenAI | Voice transcription (audio → text) | Realtime |

---

## Author

Lakshman Bhukya  
Full-Stack Developer and AI Enthusiast

[![GitHub](https://img.shields.io/badge/GitHub-lakshmanbhukya-181717?style=flat-square&logo=github)](https://github.com/lakshmanbhukya)

---

<div align="center">
  <img alt="Built with focus" src="https://img.shields.io/badge/Built_with-Focus_and_Imagination-111827?style=for-the-badge" />
</div>

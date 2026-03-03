# 🏗️ Architecture & Design

AtlasMind is built with a decoupled architecture, separating the AI intelligence layer from the core data processing and visualization.

## 🧭 System Flow

```mermaid
flowchart TD
    subgraph Client
    A[User] --> B[Open AtlasMind]
    B --> C[Chat Interface]
    C --> D{Natural Language Query}
    end

    subgraph Backend_Services
    D --> E[Schema Profiler]
    E --> F[Few-Shot Retriever]
    F --> G[Groq LLM - Llama 3.3]
    G --> H[MQL Pipeline Generated]
    H --> I[Safety Guard Validation]
    end

    subgraph Database_Layer
    I -->|Safe| J[Query Executor]
    I -->|Unsafe| K[Approval Required]
    K --> J
    J --> L[MongoDB Atlas]
    end

    subgraph UI_Updates
    L --> M[Results + Visualization]
    M --> N{Pin to Dashboard?}
    N -->|Yes| O[Live Dashboard Widget]
    N -->|No| C
    end
```

## 🧠 AI Query Generation Lifecycle

The AI pipeline is designed for low latency and high accuracy by combining schema context with few-shot examples.

```mermaid
graph LR
    subgraph User_Input
    NL[Natural Language Query]
    end
    
    subgraph AI_Pipeline
    SP[Schema Profiler]
    FSR[Few-Shot Retriever]
    LLM[Groq Llama 3.3]
    SG[Safety Guard]
    end
    
    subgraph Database
    QE[Query Executor]
    MDB[(MongoDB Atlas)]
    end
    
    NL --> SP
    SP --> FSR
    FSR --> LLM
    LLM --> SG
    SG --> QE
    QE --> MDB
    MDB --> NL
```

## 🛠️ Tech Stack

### Frontend
- **React 18** + **Vite**: Ultra-fast development and optimized production builds.
- **Tailwind CSS**: Modern styling with glassmorphism effects.
- **TanStack Query (React Query)**: Efficient state management and caching.
- **Recharts**: Responsive and interactive data visualizations.
- **Lucide React**: Premium icon set.

### Backend & AI
- **Node.js** & **Express**: Lightweight and scalable server architecture.
- **Groq LPU Acceleration**: Powering sub-200ms LLM inference.
- **Llama 3.3 70B**: State-of-the-art language model for MQL generation.
- **MongoDB Atlas**: Cloud-native document database.

## 🎨 Key Design Patterns

- **Service Layer Pattern**: Business logic (AI, Executor, Profiler) is strictly separated from API routes.
- **Chain of Responsibility**: Query validation passes through multiple "guards" before execution.
- **Strategy Pattern**: visualization strategies are dynamically selected based on query result structure.
- **Singleton Pattern**: Database connection and LLM clients are managed as internal singletons.
- **Clean Architecture**: Clear separation between UI, Services, and Data layers.

---
[⬅️ Back to README](../README.md)

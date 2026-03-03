# 📄 Development & Contributing

Guidelines for developers looking to extend or maintain AtlasMind.

## 📁 Project Structure

```text
AtlasMind/
├── client/                 # React (Vite) Frontend
│   ├── src/components/     # Reusable UI (Shadcn/UI components)
│   ├── src/hooks/          # Logic hooks (useChat, useSchema)
│   └── src/services/       # API interface (Axios)
├── server/                 # Node.js (Express) Backend
│   ├── src/routes/         # API Endpoints
│   ├── src/services/       # AI Pipeline & Business Logic
│   └── src/db/             # MongoDB Connection & Seeds
└── docs/                   # Documentation files
```

## 🧪 Testing

AtlasMind maintains **95%+ test coverage** on the backend logic.

### Running Backend Tests
```bash
cd server
npm test               # Run all tests
npm run test:coverage  # Generate coverage report
```

### Key Service Tests
- `groqService.test.js`: Validates MQL generation with mock LLM responses.
- `safetyGuard.test.js`: Checks the blocklist of destructive MQL commands.
- `schemaProfiler.test.js`: Tests database introspection.

## 🛠️ Development Workflow

1. **Feature Branching**: Use `feature/your-feature` naming.
2. **Linting**: Run `npm run lint` in both `client` and `server`.
3. **Drafting MQL**: Always verify generated pipelines against the `seed` data.

## 🗺️ Roadmap

- [x] Multi-format Export (CSV/JSON/XLSX)
- [x] Responsive Mobile Drawer
- [x] Advanced Charts (Scatter/Composed)
- [ ] Multi-database support (Postgres Connector)
- [ ] User authentication with Auth0
- [ ] Collaborative shared dashboards

---
[⬅️ Back to README](../README.md)

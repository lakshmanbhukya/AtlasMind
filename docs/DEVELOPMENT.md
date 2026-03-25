# Development and Contributing

Guidelines for extending and maintaining AtlasMind.

## Project Structure

```text
AtlasMind/
├── client/
│   ├── src/components/
│   ├── src/hooks/
│   ├── src/pages/
│   └── src/services/
├── server/
│   ├── src/routes/
│   ├── src/services/
│   ├── src/middleware/
│   ├── src/db/
│   └── __tests__/
└── docs/
```

## Local Commands

Backend:

```bash
cd server
npm run dev
npm test
npm run test:coverage
npm run seed
```

Frontend:

```bash
cd client
npm run dev
npm run lint
npm run test:e2e
```

## Testing Notes

Backend tests cover core services and route integration paths, including:

- groqService
- safetyGuard
- schemaProfiler
- queryExecutor
- fewShotRetriever
- routes integration

Run test:coverage to inspect current coverage numbers for your branch.

## Code Workflow

1. Create a feature branch.
2. Keep API contracts aligned between server routes and client service wrappers.
3. For route changes, update docs/API.md in the same PR.
4. Validate protected route behavior with cookie session (auth/me and query flow).
5. Run backend tests and client lint before opening PR.

## Architecture Conventions

- Put orchestration/business logic in server/src/services.
- Keep route handlers thin and focused on validation/response mapping.
- Maintain success/error envelope consistency.
- Preserve safety-first behavior for generated pipelines.

## Roadmap Snapshot

- Ongoing hardening of query safety and schema-aware prompting.
- Better dashboard refresh/resilience and richer chart defaults.
- Expanded provider/runtime options for AI and speech.
- Collaboration and multi-tenant enhancements.

---

[Back to README](../README.md)

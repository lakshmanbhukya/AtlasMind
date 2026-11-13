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
npm test            # Vitest unit tests (src/**/*.test.js)
npm run test:e2e    # Playwright; chat.spec.ts stubs /api, no server needed
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

Frontend tests:

- Unit (Vitest, node environment): the Conversation module `src/lib/conversation.js` (server response to chat turn, reducer, selectors) and `src/lib/apiError.js`.
- End to end (Playwright): `tests/e2e/chat.spec.ts` walks one chat turn of each kind against a stubbed API, using the response fixtures in `src/lib/__fixtures__/`. Run `npx playwright install chromium` once before the first run.
- CI runs only the server tests, so run the frontend checks locally before opening a client PR. If a server response shape changes, update the fixtures in the same PR.

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

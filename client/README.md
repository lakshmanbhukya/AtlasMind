# AtlasMind client

React 19 + Vite + Tailwind. Talks to the server in `../server` through `/api` (proxied to `localhost:3001` in dev).

```bash
npm install
npm run dev       # http://localhost:5173
npm run build
npm run lint
npm run test:e2e  # Playwright smoke test (starts the dev server)
```

## Layout

- `src/components/landing` – marketing page and the connection form
- `src/components/app` – authenticated chat app (turn cards, composer, sidebar)
- `src/components/ui/vg` – shared Verdigris primitives
- `src/hooks`, `src/lib`, `src/services/api.js` – state hooks, formatters, and the single axios instance

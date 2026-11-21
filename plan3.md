# Plan 3: Client, delivery and the share-link follow-up (batch 2 of 2)

**Fixes:** F8 (`dashboard.js` part), F9, F10, F11, F13 (Netlify part), F20 from `fixes.md`
**Branch:** `fix/client-delivery`, created from `fix/quick-wins` (or from `main` once that branch is merged). F20 builds on F1's share token, which exists only on that branch.
**Runs in parallel with:** `plan2.md`. The two plans never edit the same file.

## How to run this plan (for the agent)
Work through these steps in order without stopping for confirmation. Ask the user only if a step fails in a way this file doesn't cover.

1. **Prerequisite.** From the repo root (`C:\Users\laxman\projects\AtlasMind`), run `git merge-base --is-ancestor e389ca3 main`. If it fails, stop and tell the user: "Merge fix/quick-wins into main first."
2. **Worktree.** Run `git worktree add ../AtlasMind-client -b fix/client-delivery main`. If the branch already exists, run `git worktree add ../AtlasMind-client fix/client-delivery`, or reuse the folder if it's already there. Do all remaining work inside `C:\Users\laxman\projects\AtlasMind-client`.
3. **Install.** Run `npm ci` in both `client/` and `server/`. Copy `C:\Users\laxman\projects\AtlasMind\server\.env` to `server/.env` in the worktree. `.env` is gitignored, so never commit it. Then run `npx playwright install chromium` in `client/`.
4. **Baseline.** Run `cd client && npm run lint && npm test && npm run build`, then `cd server && npm test`. All of these must pass before you change anything; if they don't, stop and report. Write down the current build size of the JS bundle.
5. **Implement** each fix below, in the suggested order. Make one commit per fix, run the checks listed under "Files this session owns" before each commit, and end each commit message with the repo's attribution line. Use these **default decisions** instead of asking the user:
   - F13b: ship the CSP as **Report-Only**, with `connect-src 'self' https:` (the production API origin isn't known yet; it can be narrowed later). Use `frame-ancestors 'none'` for `/*` and leave it out for `/shared/*`, so shared widgets can still be embedded.
   - F20: use a "Stop sharing" item next to Share.
   - F10: replace framer-motion with CSS transitions.
6. **Finish:**
   - Run the Verification steps.
   - Review your own diff with `git diff main...HEAD` and look for broken CLAUDE.md conventions (tenant filtering, keeping `api.js`, `conversation.js` and `docs/API.md` in sync, relative imports).
   - Update `fixes.md` and commit it.
   - Merge into main from the root checkout: `git -C C:/Users/laxman/projects/AtlasMind checkout main && git -C C:/Users/laxman/projects/AtlasMind merge --no-ff fix/client-delivery`. If `fixes.md` or `docs/API.md` conflicts with plan 2's merge, keep both sides' changes. If the root checkout has uncommitted changes, skip the merge and tell the user.
   - Do **not** push. Pushing triggers CI and the image release, and the user does that.
   - Finally, report to the user: what was done, commit hashes, test results, bundle size before and after, and the defaults you used. Tell them the new CI job (F11) runs on their next push.

## Context
The client ships as a single 1.18 MB bundle (371 KB gzipped) that includes two animation libraries, and CI never checks the client. Share links can't be revoked without deleting the pin. This batch covers the client, the delivery pipeline, and the dashboard routes.

## Files this session owns
`client/**`, `.github/workflows/ci.yml`, `server/src/routes/dashboard.js`, `server/src/stores/dashboardStore.js`, and their tests.

**Do not edit:** `server/src/index.js`, `connections.js`, `safetyGuard.js`, `rateLimiter.js` or `encryption.js`. Plan 2 owns those.

**Shared files:** in `fixes.md`, edit only the rows for this batch. In `docs/API.md`, edit only the dashboard sections.

Make one commit per fix. Before each commit, run `cd client && npm run lint && npm test && npm run build`; for server changes, also run `cd server && npm test`.

Suggested order: F8b → F20 (server, then client) → F10 → F9 → F13b → F11. Doing F11 last means the new CI job checks everything that came before it.

---

## F8b. Stop leaking `error.message` from the dashboard routes (S)
- In `server/src/routes/dashboard.js`, `sendDashboardError` returns `error.message` on a 500. Change it to the generic `'Dashboard operation failed'` and keep the `console.error`. The 422 `UnsafePipelineError` branch keeps its message, because that text is shown to users on purpose.

## F20. Revoke share links (S–M)
- Server: in `server/src/stores/dashboardStore.js`, add `unshare(connectionId, id)`. It calls `requireTenant` and `toObjectId`, runs `updateOne({ _id, connectionId }, { $unset: { shareToken: '' } })`, and returns `false` when nothing matched.
- In `server/src/routes/dashboard.js`, add `DELETE /:id/share`, reusing `invalidId`, `notFound` and `sendDashboardError`.
- `dashboardStore.list` must return `shareToken`, or a `shared: boolean` flag, so the UI knows a pin's state. Return the boolean so the token only goes to the client through `POST /share`.
- Client: in `client/src/services/api.js`, add `unshareDashboardPin(pinId)`. In `client/src/components/InsightDashboard.jsx`, once a pin is shared, show a "Stop sharing" item (or a toggle) next to Share, with a toast on success.
- Docs: add `DELETE /api/dashboard/:id/share` to `docs/API.md`.
- Tests in `tenantStores.test.js`: `unshare` filters by tenant, and after `unshare`, `getShared(oldToken)` returns null.

## F10. Drop framer-motion and keep GSAP (S)
framer-motion is used in only 2 files (`components/InsightDashboard.jsx` with `motion.div`, and `pages/DashboardPage.jsx` with `AnimatePresence` and `motion.div`). GSAP drives the whole landing page.
- Replace those uses with CSS transitions or Tailwind `animate-*` classes, or with a small CSS keyframe for the enter fade/slide. For removing items, a fade before removal is enough; there's no need to rebuild `AnimatePresence`.
- `npm uninstall framer-motion`, then `grep -rn framer client/src` should return nothing.
- Respect `prefers-reduced-motion`, as the landing page already does through `components/landing/motion.js`.

## F9. Split the bundle (M)
- `client/src/main.jsx`: load `SharedDashboardPage` with `React.lazy`.
- `client/src/App.jsx`: load `AppShell` and `LandingPage` with `React.lazy`, wrapped in `<Suspense>` with the existing `LogoMark` loading state.
- `client/src/components/app/AppShell.jsx`: load `DashboardPage` with `React.lazy`.
- Recharts is imported only by `ChartRenderer.jsx` and `InsightDashboard.jsx`, both of which are app-only, so it moves out of the landing chunk without further changes. Add `build.rollupOptions.output.manualChunks` in `vite.config.js` only if the build output shows it didn't.
- Target: the landing entry chunk under 250 KB gzipped, with no 500 KB warning. Record the before and after sizes in the commit message.
- Run `npm run test:e2e`; both specs must pass, because lazy loading changes when the first paint happens.

## F13b. Security headers on Netlify (S)
`client/netlify.toml`: add a `[[headers]]` block for `/*` with `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `Permissions-Policy: microphone=(self)` (voice needs the microphone).
- Ship the CSP as `Content-Security-Policy-Report-Only`, with `connect-src 'self' https:` until the production API origin is known. `style-src`/`font-src` must allow Google Fonts (see `client/index.html`). Add a `fixes.md` follow-up row: "Narrow CSP connect-src to the production API origin and switch from Report-Only to enforcing."
- Frame protection: use `frame-ancestors 'none'` for `/*`, and leave it out for `/shared/*` so shared widgets can be embedded.

## F11. Run the client in CI (S)
In `.github/workflows/ci.yml`:
- Add `client/**` to the `paths` filters.
- Add a `client` job: Node 24, `npm ci` with the cache keyed on `client/package-lock.json`, `npm run lint`, `npm test`, `npm run build`, `npx playwright install --with-deps chromium`, then `npm run test:e2e`. `chat.spec.ts` stubs `/api`, so it needs no server.
- Gate the server image `release` job only on the server job. The client job must not block server releases.
- Use `dorny/paths-filter` (or `if:` conditions) so each job runs only when its own folder changes.
- Update the CLAUDE.md line "CI does not run for the client".

---

## Verification
1. `cd client && npm run lint && npm test && npm run build && npm run test:e2e` all pass, and the build prints no chunk-size warning.
2. `cd server && npm test` passes.
3. Share and unshare are covered by the `tenantStores.test.js` cases (after `unshare`, `getShared(oldToken)` returns null). Check that `npm run build` puts Recharts in a separate chunk from the landing entry, by looking at the build output or `dist/assets`.
4. Validate the CI YAML: `npx --yes @action-validator/cli .github/workflows/ci.yml` if it's available; otherwise review the file carefully. Don't push.
5. Set F9, F10, F11 and F20 to `done` in `fixes.md`, and mark the F8 and F13 parts. Each of those is done only when plan 2's part is finished too.

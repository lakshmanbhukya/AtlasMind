# ADR 0003: Tenant data goes through stores that fail closed, and execution always runs the safety guard

## Status
Accepted

## Date
2026-11-06

## Context
An architecture review of the post-ADR-0001 code found tenant isolation enforced by hand at each call site, and drifting:

- `query_history` and `dashboards` were read and written with raw collection calls in routes and services. Each used the fail-open guard `connectionId ? { connectionId } : {}`, which widens to every tenant when `connectionId` is missing. `POST /pin` fell back to `connectionId: 'test-connection'`.
- Few-Shot Memory applied no tenant filter on its Atlas Search and `$sample` paths, so another tenant's saved questions and pipelines could reach the prompt.
- The schema cache key fell back to `'default'` without a `connectionId`, and `routes/schema.js` never passed one. Two tenants whose databases share a name shared a cached schema.
- `executePipeline` trusted its caller. Dashboard refresh re-ran stored pipelines with no safety check.
- Three copies of the internal-collection list had drifted apart.

## Decision
1. **Tenant stores** (`server/src/stores/`) are the only code that touches `query_history` and `dashboards`. Every tenant operation requires a `connectionId`, filters on it, and throws `TenantRequiredError` if it is missing. Writes without a tenant are dropped, not stored untenanted.
2. **Few-Shot Memory** applies one filter (the tenant's own examples plus global seeds) on every search path, and refuses to store untenanted examples.
3. **Tenant Schema** (`services/tenantSchema.js`) requires a `connectionId` and uses it as the cache key. `profileSchema` never caches without one.
4. **Safe execution:** `executePipeline` always runs `validateCollectionName` and `validatePipeline` with the Effective Scope. Write stages need `approvedWrite`, which only the Write Approval Token flow sets. Pinning validates before storing.
5. **One internal-collection list:** `server/src/db/systemCollections.js`.

## Consequences
- Isolation and safety are properties of modules, not of every call site. New routes get them by using the modules.
- Callers must have a `connectionId`. `requireAuth` guarantees this for protected routes, and the stores turn any gap into an error instead of a leak.
- Validation runs twice on the engine path (once to classify the outcome, once inside `executePipeline`). This is cheap, and a later refactor can collapse it.
- Do not re-suggest "let routes query central collections directly for speed". Isolation depends on the store seam.

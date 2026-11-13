# ADR 0004: Safe Execution returns one verdict, and an approvable write is safe except for its final write stage

## Status
Accepted

## Date
2026-11-13

## Context
After ADR 0003, the safety-guard sequence (`validateCollectionName`, then `validatePipeline` with the Effective Scope) was written three times: in the engine, in the approve path, and in `queryExecutor.guardPipeline`. Each used its own scope convention.

`validatePipeline` stops at the first write stage and returns `isWrite: true`. Every caller treated `isWrite` as "approvable", so a pipeline containing `$out` or `$merge` skipped the scope and protected-collection checks on the rest of the pipeline. It was offered for approval and ran unchanged once approved. For example, with scope `['orders']` this passed:

```js
[{ $lookup: { from: 'system_users' } }, { $merge: { into: 'orders' } }]
```

The guard also never knew the tenant's database name, so `$lookup.from: { db: 'otherdb', coll: 'x' }` and `$merge.into: { db: 'otherdb', ... }` were rejected only when the database name looked protected.

## Decision
1. **One classifier.** `classifyExecution({ collection, pipeline, scope, tenantDatabase })` in `safetyGuard.js`, exported through `queryExecutor` as part of the Safe Execution interface, returns one of:
   - `runnable`: a safe read, returned with the result `$limit` appended
   - `needs_approval`: safe in every respect except one final write stage; the pipeline is returned unchanged
   - `scope_insufficient`: reads a valid collection outside a restricted scope
   - `blocked`: anything else, with `reason`, `code` and `block`

   The engine, the approve path, `guardPipeline` and dashboard pins all map this verdict. No other production code calls `validatePipeline` or `validateCollectionName`.
2. **What "approvable" means.** An approvable write is exactly one `$out` or `$merge`, as the only key of the last top-level stage. The rest of the pipeline gets the full read checks. A write stage or mutating operator anywhere else (nested, not last, or `$delete`/`$drop`/`$update`/`$deleteMany`…) is blocked.
3. **Write targets.** The target name must pass `validateCollectionName`. An explicit `db` must be the tenant's database. With a restricted scope, the target must be in scope. A target outside a restricted scope is **blocked**, not offered for approval and not answered with a scope prompt. A `$merge.whenMatched` pipeline is blocked, so a second, unvalidated pipeline cannot ride inside the write stage; the string forms are allowed.
4. **Tenant database name.** Every caller passes it: `userDb.databaseName` in the engine and approve path, `db.databaseName` inside `executePipeline`, and `getUserDb(connectionId)` for dashboard pins. When it is unknown, any explicit `db` is blocked (fail closed). This applies to reads (`$lookup.from`) as well as write targets.
5. **One scope convention.** A non-empty array is restricted. `null`, `undefined` or `[]` is unrestricted. The Write Approval Token signs `scope: null` when the scope is unrestricted, so the approve path classifies the same way.
6. **The approve path** classifies with the token's scope before it spends the `jti`. Anything other than `needs_approval` or `runnable` is a `SafetyViolationError` (422). An `UnsafePipelineError` from `executePipeline` also maps to 422, not to a 500.

## Consequences
- Write pipelines that read out of scope, read protected collections, write to another database, or write outside a restricted scope are no longer approvable. A write that reads a collection outside the scope gets the scope prompt with no token.
- A read that names another database in `$lookup.from` is blocked.
- Pseudo-write stages and operators are blocked outright instead of being offered for approval. MongoDB would have rejected them anyway.
- Tokens issued before this change carry the full collection list as their scope. They stay valid for their 10 minutes, but a write to a new collection may now be refused.
- The engine path still classifies twice (once to choose the outcome, once inside `executePipeline`), but with the same function and the same scope convention.
- `validatePipeline` is kept with unchanged results for its existing tests and as the read-check building block.
- Known limitation, not addressed here: `POST /api/dashboard/pin` takes `scope` from the request body. Pins are read-only and stay in the tenant's database. Resolving the pin's scope on the server belongs with the scope-selection work.
- Do not re-suggest "treat any pipeline with a write stage as approvable". The approval card shows the write; the rest of the pipeline must be as safe as a read.

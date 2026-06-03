# Implementation Notes — MCP Custom Standard V1

Compact log of decisions/changes not in SPEC.md. AI-native, terse.

## Spec deltas (V1 scope, user-approved)
- §15.11: running storage path = InMemory/JSON adapter, NOT Sheets. "Swappable via StorageAdapter" satisfied; Sheets reference impl deferred (until Google creds).
- §15.12: no non-HR sample in V1. Reusability proven via `_template` + `scripts/create-module.ts`.
- HR scope = "Fiche poste" only (steps 1.1–1.3): tools `submit_job_request`, `generate_job_description`, `approve_job_description`. publish/candidates deferred.
- Google writes (GDoc, rec_jobDesc row) = simulated; connectors return trace ids. Real Google wired later.

## Decisions not in spec
- Creator tools (those that start an instance) are identified by `allowedStatusesBefore: []`. The runtime then creates the instance at `statusAfterSuccess` instead of loading+gating. Non-creator tools require `processInstanceId` in their input.
- Idempotent tools must carry `idempotencyKey` in their zod input; non-creators must carry `processInstanceId`. Runtime reads these via a typed cast.
- Per-company resources (e.g. `googleSheets.hrRecruitmentSheetId`) reach handlers via `ServiceDeps.resources`, populated by the runtime from `CompanyRegistry` (added `companies` to RuntimeDeps).
- Transport is stateless streamable HTTP: a fresh Server+transport per POST /mcp, identity read from headers (`x-api-key`, `x-company-id`, `x-actor-id`, `x-actor-role`). Works without an initialize handshake.
- Idempotent short-circuit emits NO new AuditEvent (it performs no new action).
- Build uses `tsconfig.build.json` (rootDir `src`) so output is `dist/server/...`; root `tsconfig.json` (rootDir `.`) is for `npm run typecheck` over src+scripts+tests.
- Module scaffolding templates use `.tmpl` extension so tsc ignores them; `create-module` strips it and substitutes `__DOMAIN__`/`__MODULE__`/`__MODULE_NAME__`.

## Tradeoffs
- SPEC §5 orders status-gate (step 4) BEFORE idempotency (step 5). Consequence: re-calling a transitioning tool after success hits INVALID_STATE, not the idempotent short-circuit. Idempotency therefore meaningfully applies to non-transitioning idempotent tools (e.g. `generate_job_description`, status unchanged). Implemented as specified.
- Connectors are simulated; `report-maintenance` reports `connectors: "warning"` (not error) in V1.

# Implementation Notes — MCP Custom Standard V1

Authoritative target: `SPEC.md` §15. (The hygiene plan `cr-e-le-plan-de-pure-puddle.md` is
complete/superseded; its deferred items — Sheets storage, connector skeletons — are done.)

Compact log of decisions/changes not in SPEC.md. AI-native, terse.

## Spec deltas (V1 scope, user-approved)
- §15.11: DONE (2026-06-03). `SheetsStorageAdapter` persists `ProcessState` to `proc_state` tab and `AuditEvent` to `proc_audit` tab via Sheets REST API. Shared auth in `connectors/google/auth.ts`. Selected via `STORAGE_BACKEND=sheets` in `storage/index.ts` factory — runtime untouched. Default remains InMemory.
- §15.12: no non-HR sample in V1. Reusability proven via `_template` + `scripts/create-module.ts`.
- HR scope = "Fiche poste" only (steps 1.1–1.3): tools `submit_job_request`, `generate_job_description`, `approve_job_description`. publish/candidates deferred.
- Google writes: GDoc/Drive = simulated (trace ids). Sheets `rec_jobDesc` row = LIVE-capable since 2026-06-03 (`GOOGLE_CONNECTORS=live`); simulated remains the default. See "Post-V1 — live Google Sheets".

## Decisions not in spec
- Creator tools (those that start an instance) are identified by `allowedStatusesBefore: []`. The runtime then creates the instance at `statusAfterSuccess` instead of loading+gating. Non-creator tools require `processInstanceId` in their input.
- Idempotent tools must carry `idempotencyKey` in their zod input; non-creators must carry `processInstanceId`. Runtime reads these via a typed cast.
- Per-company resources (e.g. `googleSheets.hrRecruitmentSheetId`) reach handlers via `ServiceDeps.resources`, populated by the runtime from `CompanyRegistry` (added `companies` to RuntimeDeps).
- Transport is stateless streamable HTTP: a fresh Server+transport per POST /mcp, identity read from headers (`x-api-key`, `x-company-id`, `x-actor-id`, `x-actor-role`). Works without an initialize handshake.
- Idempotent short-circuit emits NO new AuditEvent (it performs no new action).
- Build uses `tsconfig.build.json` (rootDir `src`) so output is `dist/server/...`; root `tsconfig.json` (rootDir `.`) is for `npm run typecheck` over src+scripts+tests.
- Module scaffolding templates use `.tmpl` extension so tsc ignores them; `create-module` strips it and substitutes `__DOMAIN__`/`__MODULE__`/`__MODULE_NAME__`.

## Post-V1 — live Google Sheets
- Added `google-auth-library` (JWT service-account). `GOOGLE_CONNECTORS=live` swaps ONLY the Sheets connector to live (`sheetsLive.ts`); docs/drive/http/webhook stay simulated.
- `appendRow` (live) POSTs to Sheets API `values:append` (RAW, INSERT_ROWS); row = `Object.values(values)` so the service must build the record in column order (id, titre, mgr, url, status).
- Target sheet must have a `rec_jobDesc` tab; share it with the SA `client_email`. Test sheet id wired in `config/company.example.yaml`.
- Connector failures now mapped to `CONNECTOR_ERROR` in `service.ts` (was INTERNAL).
- Sheets append is not natively idempotent; dedup relies on the runtime idempotency store.
- Credentials loading: the SA JSON is multi-line (private_key newlines), which `node --env-file`
  cannot parse inline (only reads the first line `{`). `loadAppConfigFromEnv` now resolves via
  `GOOGLE_SERVICE_ACCOUNT_JSON_FILE` (path, preferred) → falls back to inline
  `GOOGLE_SERVICE_ACCOUNT_JSON`. Key file `service-account.json` is git-ignored.
- VERIFIED live (2026-06-03): `approve_job_description` wrote real rows (`rec_jobDesc!A3:E3` via
  HTTP, `A4:E4` via `npm run smoke:live`), re-read and matched expected id|titre|mgr|url|status.
  The live connector returns the Sheets API `updatedRange` (A1 notation) as the rowId/traceId —
  distinguishable from the simulated connector's hash id.

## Tradeoffs
- SPEC §5 orders status-gate (step 4) BEFORE idempotency (step 5). Consequence: re-calling a transitioning tool after success hits INVALID_STATE, not the idempotent short-circuit. Idempotency therefore meaningfully applies to non-transitioning idempotent tools (e.g. `generate_job_description`, status unchanged). Implemented as specified.
- Connectors are simulated; `report-maintenance` reports `connectors: "warning"` (not error) in V1.

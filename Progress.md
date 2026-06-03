# Progress.md — MCP Custom Standard

Last updated: 2026-06-03

## Current Objective

V1 + live Google Sheets connector implemented. Awaiting a Google service-account
JSON to verify a real end-to-end write to the test sheet.

## Done

- Spec + harness: `SPEC.md`, `AGENTS.md`, `Architecture.md`, `CLAUDE.md`.
- V1 core: streamable HTTP MCP server (stateless), 3 core tools, identity/auth, closed error model.
- Engine: all SPEC §4 contracts, process runtime (§5 order), InMemory storage adapter, idempotency store, module/tool/process registries, module validation.
- Connectors: provider-neutral simulated skeletons (docs, sheets, drive, http, webhook).
- HR module `hr.recruitment` (Fiche poste): `submit_job_request` → `generate_job_description` → `approve_job_description`.
- Reusability: `_template` + `create-module` (scaffolds a runnable module, verified then removed).
- Tooling: `check-standard`, `report-maintenance`, contract tests, integration tests.
- Deploy: Dockerfile (Coolify), README.

## In Progress

- None.

## Blocked

- None.

## Next Action

Provide a Google service-account JSON (and share the test sheet with its client_email),
then run `GOOGLE_CONNECTORS=live` to verify `approve_job_description` writes a real
`rec_jobDesc` row. After that: optional Sheets `StorageAdapter` (process state in Sheets).

## Last Verification

- Date: 2026-06-03
- Method: `npm run build` (ok); `npm test` (8/8 pass); `check-standard` ok; `report-maintenance` ok; live server probed over HTTP.
- Result: pass — tools discovered over streamable HTTP; submit→pending; bad key→UNAUTHENTICATED; wrong role→FORBIDDEN; INVALID_STATE + idempotency covered by integration tests.

## Known Risks

- Google auth out of V1 scope; only simulated connectors + InMemory storage run today.
- SPEC §15.11 (Sheets impl) and §15.12 (non-HR sample) intentionally deferred for V1 — see `memory/implementation-notes.md`.

## Update Rule

Every agent updates this file before stopping meaningful project work.

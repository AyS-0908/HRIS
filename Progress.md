# Progress.md — MCP Custom Standard

Last updated: 2026-06-03


## Current Objective

Authoritative checklist: `SPEC.md` §15. (The hygiene plan
`C:\Users\aymar\.claude\plans\cr-e-le-plan-de-pure-puddle.md` is complete and superseded —
the Sheets storage and connector skeletons it deferred are now implemented.)

V1 + live Google Sheets connector implemented **and verified end-to-end** against the
real test sheet: `approve_job_description` appends a real `rec_jobDesc` row, confirmed by
read-back. The Sheets `StorageAdapter` (§4.2 / §15.11) is now implemented: process state +
audit persist to `proc_state` / `proc_audit` tabs, selected via `STORAGE_BACKEND=sheets`,
no core edits. Next optional step is a second non-HR module (§15.12).

## Done

- Spec + harness: `SPEC.md`, `AGENTS.md`, `Architecture.md`, `CLAUDE.md`.
- V1 core: streamable HTTP MCP server (stateless), 3 core tools, identity/auth, closed error model.
- Engine: all SPEC §4 contracts, process runtime (§5 order), InMemory storage adapter, idempotency store, module/tool/process registries, module validation.
- Connectors: provider-neutral simulated skeletons (docs, sheets, drive, gmail, forms, calendar, http, webhook) + live Sheets connector.
- Storage: in-memory adapter (default) + Google Sheets `StorageAdapter` reference impl (§15.11), shared service-account auth (`connectors/google/auth.ts`), selected by `STORAGE_BACKEND` via `storage/index.ts` factory — runtime untouched.
- HR module `hr.recruitment` (Fiche poste): `submit_job_request` → `generate_job_description` → `approve_job_description`.
- Reusability: `_template` + `create-module` (scaffolds a runnable module, verified then removed).
- Tooling: `check-standard`, `report-maintenance`, contract tests, integration tests, `smoke:live`.
- Deploy: Dockerfile (Coolify), README.
- **Live Google Sheets verified**: real `rec_jobDesc` rows written and re-read on the test sheet.
- Audit-of-audit pass (2026-06-03): fixed idempotency scope (now per-instance), removed redundant handler re-validation, corrected creator-failure audit status, aligned audit sentinel, typed Sheets adapter errors as `CONNECTOR_ERROR`, documented unbounded idempotency store. Drop-in wiring: module manifest `src/modules/index.ts` (no app.ts edit per module) + comma-separated `COMPANY_CONFIG_PATH`. Added gmail/forms/calendar skeleton connectors (§3/§8). Deferred: §11 `publish_job_opening` / `update_candidate_status` (2 of 5 sample tools still unimplemented).

## In Progress

- None.

## Blocked

- None.

## Next Action

Start in a **fresh session** (this one is long/compacted):
- A second non-HR module (§15.12) via `_template` + `create-module`, to further prove reusability.

## Last Verification

- Date: 2026-06-03
- Sheets StorageAdapter: `npm run typecheck` (ok); `npm test` (13 pass — original 8 green +
  5 new StorageAdapter conformance tests, simulated/in-memory default). Live Sheets storage
  not exercised in this pass (opt-in: `STORAGE_BACKEND=sheets` + `proc_state`/`proc_audit` tabs).
- Method: `npm run typecheck` (ok); `npm test` (8/8 pass, simulated default); live server
  started with `GOOGLE_CONNECTORS=live` + `GOOGLE_SERVICE_ACCOUNT_JSON_FILE`, full flow run
  over streamable HTTP (`submit` → `generate` → `approve`); row re-read from the sheet;
  `npm run smoke:live` → `{ok:true, rowMatches:true}`.
- Result: pass — `approve_job_description` wrote `rec_jobDesc!A3:E3` (HTTP run) and `A4:E4`
  (smoke script); both re-read and matched expected `id|titre|mgr|url|status`.

## Notes

- Service-account JSON is multi-line, which `node --env-file` cannot parse inline.
  `loadAppConfigFromEnv` now prefers `GOOGLE_SERVICE_ACCOUNT_JSON_FILE` (a path to the key
  file); inline `GOOGLE_SERVICE_ACCOUNT_JSON` remains a single-line fallback. Local key file
  `service-account.json` is git-ignored.
- `scripts/live-sheets-smoke-test.mjs` (`npm run smoke:live`) reads `.env` (with its own
  multi-line JSON parser), runs the full flow via `app.runtime`, then re-reads the appended
  range and checks the row values.

## Known Risks

- SPEC §15.11 (Sheets storage impl) now implemented; §15.12 (non-HR sample) still deferred — see `memory/implementation-notes.md`.
- Sheets StorageAdapter does a full-tab scan on read and a non-atomic read-modify-write on
  `updateStatus` (documented in `storage/sheetsStorageAdapter.ts`). Fine for the V1 reference
  impl; process-level dedup is still the runtime's idempotency store, not storage.

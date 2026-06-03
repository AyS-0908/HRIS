# Progress.md — MCP Custom Standard

Last updated: 2026-06-03

## Current Objective

V1 + live Google Sheets connector implemented **and verified end-to-end** against the
real test sheet: `approve_job_description` appends a real `rec_jobDesc` row, confirmed by
read-back. Next optional step is a Sheets `StorageAdapter` (process state in Sheets).

## Done

- Spec + harness: `SPEC.md`, `AGENTS.md`, `Architecture.md`, `CLAUDE.md`.
- V1 core: streamable HTTP MCP server (stateless), 3 core tools, identity/auth, closed error model.
- Engine: all SPEC §4 contracts, process runtime (§5 order), InMemory storage adapter, idempotency store, module/tool/process registries, module validation.
- Connectors: provider-neutral simulated skeletons (docs, sheets, drive, http, webhook) + live Sheets connector.
- HR module `hr.recruitment` (Fiche poste): `submit_job_request` → `generate_job_description` → `approve_job_description`.
- Reusability: `_template` + `create-module` (scaffolds a runnable module, verified then removed).
- Tooling: `check-standard`, `report-maintenance`, contract tests, integration tests, `smoke:live`.
- Deploy: Dockerfile (Coolify), README.
- **Live Google Sheets verified**: real `rec_jobDesc` rows written and re-read on the test sheet.

## In Progress

- None.

## Blocked

- None.

## Next Action

Start in a **fresh session** (this one is long/compacted). Pick one:
- Sheets `StorageAdapter` (§15.11): persist process state in Sheets via the existing adapter
  interface — no core edits.
- A second non-HR module (§15.12) via `_template` + `create-module`, to further prove reusability.

## Last Verification

- Date: 2026-06-03
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

- SPEC §15.11 (Sheets storage impl) and §15.12 (non-HR sample) intentionally deferred for V1 — see `memory/implementation-notes.md`.

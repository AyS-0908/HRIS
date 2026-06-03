# STANDARD_CHANGELOG

Core and modules are versioned independently (SPEC §13). Breaking core changes require a migration note here.

## [Unreleased]

### Core 0.1.0
- Initial V1 scaffold: streamable HTTP MCP server, core tools, identity/auth, process runtime, InMemory storage adapter, module/tool/process registries.
- Live Google Sheets connector (service-account auth), selectable via `GOOGLE_CONNECTORS=live`; simulated remains the default. Connector failures surface as `CONNECTOR_ERROR`. Credentials load from `GOOGLE_SERVICE_ACCOUNT_JSON_FILE` (preferred) or inline `GOOGLE_SERVICE_ACCOUNT_JSON`. Verified end-to-end against a real sheet (`npm run smoke:live`).
- Docs/hygiene pass: corrected `Architecture.md` drift (storage is InMemory in V1; removed non-existent gmail/forms/calendar connectors), pruned unused vars from `.env.example`, clarified service-account error messages, and typed `App.storage` as the `StorageAdapter` interface.
- Google Sheets `StorageAdapter` reference impl (§15.11): `SheetsStorageAdapter` persists `ProcessState` to `proc_state` tab and `AuditEvent` to `proc_audit` tab via Sheets REST API (:append, GET, PUT). Shared service-account auth extracted to `connectors/google/auth.ts`. `storage/index.ts` factory (`buildStorage`) selects backend via `STORAGE_BACKEND` env var. Runtime untouched. Default remains InMemory. New conformance suite in `tests/contract/storageAdapter.test.ts` (5 tests, parameterized).

### Modules
- `hr.recruitment` 0.1.0 — "Fiche poste" process: `submit_job_request`, `generate_job_description`, `approve_job_description`.

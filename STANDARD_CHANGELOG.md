# STANDARD_CHANGELOG

Core and modules are versioned independently (SPEC §13). Breaking core changes require a migration note here.

## [Unreleased]

### Core 0.1.0
- Initial V1 scaffold: streamable HTTP MCP server, core tools, identity/auth, process runtime, InMemory storage adapter, module/tool/process registries.
- Live Google Sheets connector (service-account auth), selectable via `GOOGLE_CONNECTORS=live`; simulated remains the default. Connector failures surface as `CONNECTOR_ERROR`. Credentials load from `GOOGLE_SERVICE_ACCOUNT_JSON_FILE` (preferred) or inline `GOOGLE_SERVICE_ACCOUNT_JSON`. Verified end-to-end against a real sheet (`npm run smoke:live`).

### Modules
- `hr.recruitment` 0.1.0 — "Fiche poste" process: `submit_job_request`, `generate_job_description`, `approve_job_description`.

# STANDARD_CHANGELOG

Core and modules are versioned independently (SPEC §13). Breaking core changes require a migration note here.

## [Unreleased]

### Project memory cleanup
- Removed the obsolete repo-local memory files (`memory/implementation-notes.md`,
  `memory/lessons.md`) in favor of the project rule that current memory lives in `Progress.md`
  and historical decisions live in this changelog. Preserved the still-useful facts here:
  creator tools are identified by `allowedStatusesBefore: []`; non-creator tools require
  `processInstanceId`; idempotent tools require `idempotencyKey`; process external ids flow
  through `ServiceDeps.resources` / `externalReferences`; stateless streamable HTTP uses a fresh
  server+transport per `POST /mcp`; idempotent short-circuits emit no new audit event; build uses
  `tsconfig.build.json` while root `tsconfig.json` typechecks `src` + `scripts` + `tests`; module
  templates keep `.tmpl` extensions so TypeScript ignores them; service-account JSON should be
  supplied through `GOOGLE_SERVICE_ACCOUNT_JSON_FILE` because multi-line private keys do not work
  reliably with `node --env-file`; public app/storage types should stay on `StorageAdapter` rather
  than concrete implementations so the compiler catches hidden coupling.

### Core 0.2.0 — per-company authentication (BREAKING)
- **Per-company API keys replace the single shared `API_KEY`.** Each company config carries
  `auth.apiKeyHash` (sha256 of its key). A key now **authenticates AND selects the tenant**:
  `resolveApiKeyIdentity` (renamed from `resolveApiKeyId`) maps key→`{companyId, apiKeyId}`, so a
  key can act only as its own company. The spoofable `x-company-id` header no longer chooses the
  tenant — if present it must match the key's company, else `FORBIDDEN`. `resolveContext` now takes
  the authenticated `companyId` as an explicit argument (no longer read from a header).
  **Migration:** remove `API_KEY` from env; run `npm run create-company` (mints + prints a key,
  stores only its hash) or add `auth.apiKeyHash` to each `company.<id>.yaml`. `AppConfig.apiKey`
  removed.
- **claude.ai web connector path (minimal bearer).** The transport accepts the key via
  `Authorization: Bearer <key>` in addition to `x-api-key`. New **per-actor keys**
  (`auth.actorKeys[]`: `keyHash → {actorId, role}`) let a token carry the identity for claude.ai
  web, which can't send custom `x-actor-*` headers — resolved entirely at `core/auth`, never on a
  handler. New `npm run add-actor-key` mints a per-actor token. Verified locally over both paths
  (curl); live web verification is blocked until TLS is enabled on the Coolify domain.
- **Docs consolidated:** new `docs/developer-guide.md` (AI-coder/developer) and
  `docs/end-user-guide.md` (DRH), incl. the Google-Sheet may/must-not contract.

### Core 0.1.0
- Initial V1 scaffold: streamable HTTP MCP server, core tools, identity/auth, process runtime, InMemory storage adapter, module/tool/process registries.
- Live Google Sheets connector (service-account auth), selectable via `GOOGLE_CONNECTORS=live`; simulated remains the default. Connector failures surface as `CONNECTOR_ERROR`. Credentials load from `GOOGLE_SERVICE_ACCOUNT_JSON_FILE` (preferred) or inline `GOOGLE_SERVICE_ACCOUNT_JSON`. Verified end-to-end against a real sheet (`npm run smoke:live`).
- Docs/hygiene pass: corrected `Architecture.md` drift (storage is InMemory in V1; removed non-existent gmail/forms/calendar connectors), pruned unused vars from `.env.example`, clarified service-account error messages, and typed `App.storage` as the `StorageAdapter` interface.
- Google Sheets `StorageAdapter` reference impl (§15.11): `SheetsStorageAdapter` persists `ProcessState` to `proc_state` tab and `AuditEvent` to `proc_audit` tab via Sheets REST API (:append, GET, PUT). Shared service-account auth extracted to `connectors/google/auth.ts`. `storage/index.ts` factory (`buildStorage`) selects backend via `STORAGE_BACKEND` env var. Runtime untouched. Default remains InMemory. New conformance suite in `tests/contract/storageAdapter.test.ts` (5 tests, parameterized).

### Connectors (live surface)
- Live Google **Docs** connector: copies a per-company template into a shared Drive folder (inherits sharing) and injects content via `replaceAllText`. Auth is dual-mode — service account (Shared Drive) **or** OAuth user-delegation (Doc owned by the user; works on personal Gmail).
- Live Google **Gmail** connector (`gmailLive.ts`): sends a real email via the Gmail API (`users.messages.send`, base64url RFC822). Requires OAuth user-delegation with the `gmail.send` scope. Selected only in live mode with OAuth creds present; simulated otherwise.
- Drive / Forms / Calendar / http / webhook remain simulated skeletons.

### Modules
- `hr.recruitment` 0.1.0 — "Fiche poste" process: `submit_job_request`, `generate_job_description`, `approve_job_description`.
- `hr.recruitment` 0.3.0 — structured job-description sections (deterministic assembly) + per-company policy (Config tab); live Docs (service-account/OAuth); **email to HR at approve (D1)**; **Sheet-based identity** via the RH-editable `Users` tab (D2); read-only `get_recruitment_policy` tool. `publish_job_opening` **removed** (publishing deferred to a future module, D4). Tools: `submit_job_request`, `generate_job_description`, `approve_job_description`, `get_recruitment_policy`.

# MCP Custom Standard

Reusable MCP server. Business logic plugs in as **modules** (per domain) and
**processes** (per workflow) via config + drop-in folders. Core code is never
edited to onboard a company or add a module.

- Contract: [SPEC.md](SPEC.md) · Project rules: [AGENTS.md](AGENTS.md) · Structure: [Architecture.md](Architecture.md) · State: [Progress.md](Progress.md)

This server is the **business brain of a larger HRIS-in-Google-Workspace product**
(vision + module roadmap: [docs/hris_macro_spec.md](docs/hris_macro_spec.md)). The current
HR recruitment module is module 1 of N. The companion **Apps Script layer** (workspace setup
+ downstream HR workflow, spec: [docs/hris_appscript_spec_final.txt](docs/hris_appscript_spec_final.txt))
operates on **one transversal spreadsheet per company** shared by all HR modules.

## Requirements

- Node.js ≥ 20

## Local run

```bash
npm install
cp .env.example .env        # set COMPANY_CONFIG_PATH (no server-wide API key any more)
npm run build
npm start                   # serves streamable HTTP on http://localhost:3000/mcp
```

Health probe: `GET /healthz`. MCP endpoint: `POST /mcp`. With the committed example config the
dev API key is `dev-acme-key`.

### Identity headers (every request)

| Header | Meaning |
|---|---|
| `x-api-key` (or `Authorization: Bearer <key>`) | the **per-company** API key — authenticates AND selects the tenant (`auth.apiKeyHash` in the company config). A key acts only as its own company. |
| `x-company-id` | optional/advisory: if present it must match the key's company, else `FORBIDDEN`. The tenant is always derived from the key. |
| `x-actor-id` | acting user id (their email — the `Users` tab key) |
| `x-actor-role` | a role declared by that company — advisory (Sheet `Users` tab is authoritative, D2) |

A **per-actor key** (for claude.ai web, which can't send custom headers) binds the actor into the
token itself — see [docs/pilot-access.md](docs/pilot-access.md) §5. Core tools (`health_check`,
`get_standard_version`) need only the key. Business tools resolve full identity at `core/auth`.

> New here? Two consolidated guides: [docs/developer-guide.md](docs/developer-guide.md)
> (AI-coder/developer) and [docs/end-user-guide.md](docs/end-user-guide.md) (non-technical DRH).

## Tests

```bash
npm test                    # all tests
npm run test:contract       # contract assertions only
```

## Create a module

```bash
npm run create-module -- --domain sales --module lead_management
```

Scaffolds `src/modules/sales/lead_management/` from `_template`. Then register it in
the `ALL_MODULES` manifest ([src/modules/index.ts](src/modules/index.ts)) and enable it
in a company config — core code stays untouched.

## Standard checks

```bash
npm run check-standard      # validate all module contracts offline
npm run report-maintenance  # emit the maintenance JSON report (SPEC §12)
```

## Live Google Sheets (optional)

By default all Google connectors are **simulated**. To write real rows to the
`rec_jobDesc` tab via `approve_job_description`:

1. Create a Google **service account** and download its JSON key (e.g. `service-account.json`, gitignored).
2. **Share** the target spreadsheet with the service account's `client_email` (Editor).
3. Ensure the sheet has a tab named **`rec_jobDesc`** with columns: `id | titre | mgr | url | status`.
4. Set the spreadsheet id in your company config (`resources.googleSheets.hrRecruitmentSheetId`).
5. In `.env` set `GOOGLE_CONNECTORS=live` and point to the key **file**:

```bash
GOOGLE_CONNECTORS=live
GOOGLE_SERVICE_ACCOUNT_JSON_FILE=service-account.json
```

Then `npm run build && node --env-file=.env dist/server/index.js`.

> The service-account JSON is multi-line (its `private_key` contains newlines), which
> `node --env-file` cannot parse inline — always use `GOOGLE_SERVICE_ACCOUNT_JSON_FILE`.
> `GOOGLE_SERVICE_ACCOUNT_JSON` (single-line inline) remains as a fallback.

In live mode the **Sheets**, **Docs**, and **Gmail** connectors go live (Docs needs a
per-company template + shared folder; Gmail needs OAuth `gmail.send` — see
[docs/onboarding-company.md](docs/onboarding-company.md)). Drive/Forms/Calendar/http/webhook
remain simulated skeletons.

## Sheets storage backend (optional)

By default process state + audit live in the in-memory `StorageAdapter`. To persist
them in Google Sheets instead (SPEC §4.2 / §15.11), reusing the same service account
and the company's recruitment spreadsheet:

1. Complete the live Sheets setup above (service account + shared spreadsheet).
2. Add two tabs to that spreadsheet, each with a header row (row 1):
   - **`proc_state`** — `processInstanceId | processId | companyId | currentStatus | currentStep | createdBy | createdAt | updatedAt | lastToolCalled | externalReferences | auditLogId`
   - **`proc_audit`** — `auditLogId | timestamp | companyId | processId | processInstanceId | toolName | actorRole | actorId | inputSummary | externalOutputs | statusBefore | statusAfter | result | errorCode`
3. In `.env` set `STORAGE_BACKEND=sheets` (requires the service account + a configured
   `resources.googleSheets.hrRecruitmentSheetId`).

```bash
STORAGE_BACKEND=sheets
GOOGLE_SERVICE_ACCOUNT_JSON_FILE=service-account.json
```

The backend is selected at the composition root only — the runtime depends solely on the
`StorageAdapter` interface, so no core code changes. `externalReferences`, `inputSummary`,
and `externalOutputs` are stored as JSON in a single cell.

## Docker / Coolify

```bash
docker build -t mcp-custom-standard .
docker run -p 3000:3000 \
  -e COMPANY_CONFIG_PATH=config/company.example.yaml \
  mcp-custom-standard
```

The API key is not an env var: it lives (hashed) in each company config. See
[docs/developer-guide.md](docs/developer-guide.md) for the Coolify deployment.

## V1 scope notes

- HR sample = "Fiche poste" (job description) process: `submit_job_request` → `generate_job_description` → `approve_job_description`, plus the read-only `get_recruitment_policy` (4 tools). At approve, HR is notified by email (D1). Publishing is deferred to a future module.
- Identity: the actor role is resolved from the RH-editable `Users` tab (`email | role`) of the company sheet (D2); the `x-actor-role` header is advisory; the company YAML stays the set of valid roles.
- Storage runs through a `StorageAdapter`: in-memory by default, or the Google Sheets reference impl via `STORAGE_BACKEND=sheets` (swappable without core edits).
- Google connectors are simulated by default; **Sheets, Docs and Gmail** support live operation via `GOOGLE_CONNECTORS=live` (+ OAuth for Docs-on-personal-Gmail and for Gmail). Drive/Forms/Calendar/http/webhook stay simulated.

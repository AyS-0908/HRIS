# MCP Custom Standard

Reusable MCP server. Business logic plugs in as **modules** (per domain) and
**processes** (per workflow) via config + drop-in folders. Core code is never
edited to onboard a company or add a module.

- Contract: [SPEC.md](SPEC.md) · Project rules: [AGENTS.md](AGENTS.md) · Structure: [Architecture.md](Architecture.md) · State: [Progress.md](Progress.md)

## Requirements

- Node.js ≥ 20

## Local run

```bash
npm install
cp .env.example .env        # set API_KEY, COMPANY_CONFIG_PATH
npm run build
npm start                   # serves streamable HTTP on http://localhost:3000/mcp
```

Health probe: `GET /healthz`. MCP endpoint: `POST /mcp`.

### Identity headers (every request)

| Header | Meaning |
|---|---|
| `x-api-key` | client API key (matches `API_KEY`) |
| `x-company-id` | a company id loaded from config |
| `x-actor-id` | acting user id |
| `x-actor-role` | a role declared by that company |

Core tools (`health_check`, `get_standard_version`) need only the API key.
Business tools and `list_available_business_tools` need the company headers.

## Tests

```bash
npm test                    # all tests
npm run test:contract       # contract assertions only
```

## Create a module

```bash
npm run create-module -- --domain sales --module lead_management
```

Scaffolds `src/modules/sales/lead_management/` from `_template`. Then add the module
to `ALL_MODULES` in [src/app.ts](src/app.ts) and enable it in a company config.

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

Only the Sheets connector goes live; Docs/Drive remain simulated until wired.

## Docker / Coolify

```bash
docker build -t mcp-custom-standard .
docker run -p 3000:3000 \
  -e API_KEY=dev-local-key \
  -e COMPANY_CONFIG_PATH=config/company.example.yaml \
  mcp-custom-standard
```

## V1 scope notes

- HR sample = "Fiche poste" (job description) process: `submit_job_request` → `generate_job_description` → `approve_job_description`.
- Storage runs through the in-memory `StorageAdapter` (swappable); the Google Sheets reference impl is deferred.
- Google connectors are simulated skeletons (no real Google calls in V1).
- See [memory/implementation-notes.md](memory/implementation-notes.md) for spec deltas.

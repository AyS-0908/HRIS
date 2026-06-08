# Developer / AI-coder guide

One entry point for building, deploying, extending and operating this MCP server. It
**consolidates** the scattered docs and links to them for depth — it does not restate the
contract ([SPEC.md](../SPEC.md)) or the locked rules ([AGENTS.md](../AGENTS.md)).

- Reusable MCP server: business logic plugs in as **modules** via config + drop-in folders.
  **Core code is never edited** to onboard a company or add a module (SPEC §0).
- Layering (top-down only): `client → transport → core → runtime → module → service → connector`.
  A handler **never** calls a connector. Status/idempotency/audit live only in
  `runtime/processRuntime.ts`.

## 1. Setup & local run

```bash
npm install
cp .env.example .env          # set COMPANY_CONFIG_PATH (there is NO server-wide API key)
npm run build
npm start                     # streamable HTTP on http://localhost:3000/mcp ; GET /healthz
```

With the committed `config/company.example.yaml`, the dev key is **`dev-acme-key`**
(`x-api-key: dev-acme-key` or `Authorization: Bearer dev-acme-key`).

Gate (a change is done only when all are green — SPEC §15):

```bash
npm test            # full suite        (currently 100% tests on 100% files passed)
npm run check-standard
npm run build
```

## 2. Identity & authentication (per-company keys)

The tenant is **derived from the API key**, not from a header. Each company config carries
`auth.apiKeyHash` (sha256 of its key); a key both authenticates the caller and binds the tenant,
so it can act only as its own company. Resolution happens once at `core/auth`
([apiKey.ts](../src/core/auth/apiKey.ts), [context.ts](../src/core/auth/context.ts)) — never in a
handler.

Two connection models (both per-company authenticated):

| Model | Key kind | Identity source |
|---|---|---|
| **Claude Desktop + `mcp-remote`** | company-wide key (`auth.apiKeyHash`) | per-person `x-actor-*` headers |
| **claude.ai web** custom connector | per-actor key — config `auth.actorKeys[]` **or** the `Users` tab `mcpKeyHash` (D2) | the **token itself** binds `{actorId, role}` (web can't send custom headers) |

`x-company-id` is advisory: if sent it must match the key's company, else `FORBIDDEN` (anti-spoof).
The effective role is resolved from the RH-editable `Users` tab (D2); the header/token role is the
fallback. Auth sources are tried in order: config `actorKeys` → `Users.mcpKeyHash` (active) →
config `apiKeyHash`. Full connection steps: [pilot-access.md](pilot-access.md).

**Beta testers (no Coolify, no restart).** A claude.ai-web token can live in the `Users` tab
instead of a config file, so an operator adds/revokes a tester with one command and the change
takes effect within the server's 60 s Users-tab cache:

```bash
# add: operator keeps the tester's row (email|role) in the Users tab, then mints their token
npm run add-actor-key -- --company config/company.acme.yaml --actor friend@acme.com --store users-sheet
# revoke (or just set Users.mcpKeyStatus = revoked by hand)
npm run add-actor-key -- --company config/company.acme.yaml --actor friend@acme.com --store users-sheet --revoke
```

The raw token is printed once; only its sha256 hash is stored in `Users.mcpKeyHash` (status
`active`/`revoked`, plus an ISO `mcpKeyCreatedAt`). The tester never runs Terminal or touches
Coolify — they paste the token as their connector's bearer token.

## 3. Add a company (zero core edits)

```bash
npm run create-company -- --id acme --name "Acme Corp" \
  --roles hr_admin,manager,employee \
  --sheet <SHEET_ID> --folder <FOLDER_ID> --template <TEMPLATE_ID>
```

This writes `config/company.acme.yaml` (validated by zod) and **mints + prints the company API key
once** (only its hash is stored). Then create the Sheet tabs and enable the company:

```bash
npm run setup-company-sheet -- --company config/company.acme.yaml   # +--storage sheets if used
# add the path to COMPANY_CONFIG_PATH (comma-separated for several), restart
```

Issue a claude.ai-web token per person with `npm run add-actor-key` (config file, or
`--store users-sheet` for the no-restart `Users`-tab path — see §2). Full detail (Google
Workspace prep, sharing, OAuth modes): [onboarding-company.md](onboarding-company.md).

## 4. How to add a module (the deterministic SOP)

Adding a module (e.g. *publish a job desc*, *prepare an interview*) is a **fixed, mechanical**
sequence that never touches `core/`, `runtime/` or `server/`:

If the operator starts from a business process rather than a technical tool list, first fill
[module-micro-spec-template.md](module-micro-spec-template.md). The AI-coder must translate the
business steps into coarse tools, statuses, permissions and schemas before scaffolding.

1. **Scaffold** from `_template`:
   ```bash
   npm run create-module -- --domain hr --module interview
   ```
   → `src/modules/hr/interview/` (tools.ts, service.ts, schemas.ts, permissions.ts, index.ts).
2. **Author the contract** in the scaffolded files only:
   - **schemas.ts** — zod input schemas (author zod *only*; the MCP `input_schema` is derived).
   - **tools.ts** — 1 tool = 1 coarse business action (no `write_row`/`send_http_request`-style
     names at the MCP surface). Set `permissionScope` and `auditLevel`.
   - **processDefinition** — `statuses`, and per tool `allowedStatusesBefore` +
     `statusAfterSuccess`. A human-validation checkpoint = an explicit status transition only the
     validating role may perform (AI tools recommend, never auto-transition).
   - **service.ts** — side effects; the handler calls the service, the service calls connectors.
3. **Register** it in the manifest — append to `ALL_MODULES`
   ([src/modules/index.ts](../src/modules/index.ts)). This is the *only* shared file you touch,
   and it is a drop-in list, not core logic.
4. **Enable** it per company: add the module name to `enabledModules` in a company YAML.
5. **Prove** it: `npm run check-standard` (offline contract validation) + `npm test` green; add a
   contract/integration test mirroring `tests/integration/recruitment.test.ts`.

The closed error set is `UNAUTHENTICATED | FORBIDDEN | VALIDATION_ERROR | INVALID_STATE |
CONNECTOR_ERROR | INTERNAL` — clients see codes only. Reference module: `hr.recruitment`
([src/modules/hr/recruitment/](../src/modules/hr/recruitment/)).

> A Q&A wizard that emits a runnable skeleton from a few answers is a planned enhancement
> (deferred); today the steps above are the deterministic playbook.

## 5. Live Google connectors (Sheets / Docs / Gmail)

Simulated is the **default** (anti-regression). Live activates only with `GOOGLE_CONNECTORS=live`:

```bash
GOOGLE_CONNECTORS=live
GOOGLE_SERVICE_ACCOUNT_JSON_FILE=service-account.json   # share Sheet/folder/template with its client_email
# Docs-on-personal-Gmail + Gmail send need OAuth user-delegation:
GOOGLE_OAUTH_CLIENT_ID=… GOOGLE_OAUTH_CLIENT_SECRET=… GOOGLE_OAUTH_REFRESH_TOKEN=…   # npm run oauth-token
STORAGE_BACKEND=sheets                                   # optional: persist proc_state/proc_audit
```

Live-mode guardrail: if a company is missing its Docs template/folder, `generate_job_description`
returns `VALIDATION_ERROR` — never a dead simulated link. Detail + OAuth setup + refresh-token
lifetime caveat: [onboarding-company.md](onboarding-company.md) §5, [README.md](../README.md).

Smoke: `npm run smoke:live`. Local manual smoke (no Google) over both auth paths: see
[pilot-access.md](pilot-access.md) §5.4.

## 6. Deploy (Coolify)

App **HRIS** (project Hosted Apps). Dockerfile builds and runs `dist/server/index.js`.

1. Set env on the app: `COMPANY_CONFIG_PATH`, `GOOGLE_CONNECTORS`, `STORAGE_BACKEND`, the
   `GOOGLE_*` creds. Ensure `config/company.<id>.yaml` + `service-account.json` are present.
2. **Enable TLS** (required for claude.ai web): set the app **domain** to
   `https://hris-mcp.sourcinno.com`, point DNS at the host, open ports 80+443; Coolify
   auto-provisions Let's Encrypt. Verify `https://hris-mcp.sourcinno.com/healthz` → `{"ok":true}`.
   *(As of this writing the domain serves plain HTTP — TLS must be turned on before the web
   connector works; steps in [pilot-access.md](pilot-access.md) §5.3.)*
3. After changing creds (e.g. a new OAuth refresh token), redeploy / sync env.

## 7. The Google Sheet: what RH may vs. must-NOT change

The Sheet is shared between the operator (code) and RH. The contract:

**RH MAY edit (no redeploy):**
- The **`Users`** tab — one row per person, `email | role` (D2). Re-assigning a role takes effect
  within ~60 s. At least one `hr_admin` row also receives the approve notification (D1).
- The **`Config`** tab **values** — only the known policy keys: `requireJustification`,
  `requireProofDoc`, `extraValidationStep`, `requireStructuredSections`, `hrNotifyEmail`.

**RH must NOT change (no effect / breaks reads):**
- **Tab names** and **header rows**: `rec_jobDesc`, `proc_state`, `proc_audit` (and the `Users` /
  `Config` headers). The code reads by tab name + header layout.
- Any **unknown `Config` key** — ignored by design. A `Config` key can **never** grant a role; the
  closed set of valid roles lives in the server config (`company.<id>.yaml`), and identity lives in
  the separate `Users` tab.

## 8. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `UNAUTHENTICATED` | Wrong/missing/revoked key. The key must match a company's `auth.apiKeyHash`, an `actorKeys[].keyHash`, or an **active** `Users.mcpKeyHash`. No server-wide key exists. A revoked/blank `Users` token never authenticates. |
| `FORBIDDEN` on every call | `x-company-id` doesn't match the key's company; or no valid role (Users tab token invalid *and* no valid header/bound role). |
| `VALIDATION_ERROR` at generate (live) | Company missing `googleDocs.jobDescriptionTemplateId` / `googleDrive.hrKnowledgeFolderId`. |
| `INVALID_STATE` | The tool isn't allowed in the current process status (status gate) — expected for e.g. re-approve. |
| Doc creation `invalid_grant` | OAuth consent screen in *Testing* expires the refresh token after 7 days; move to *In production* or re-run `npm run oauth-token`. The token starts `1//` — don't drop the leading `1`. |
| claude.ai web won't connect | Endpoint not HTTPS — enable TLS on Coolify (§6 / pilot-access §5.3). |
| Tests/build red after an edit | Run the gate (§1); contract failures point at the offending module. |

See also: [TESTING_GUIDE.md](TESTING_GUIDE.md) (manual + automated test procedures),
[Architecture.md](../Architecture.md) (system structure).

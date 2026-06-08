# Onboarding a company (no code edits)

A new company joins by preparing resources in **its own** Google Workspace and handing the
operator a few IDs — never by editing core code (SPEC §0). This isolates each company's data
in its own Drive (RGPD-friendly, multi-company).

## 1. What the company prepares (in its own Google Workspace)

1. **A Drive folder** — e.g. "Fiches de poste". **Share it with the company's HR and
   managers.** Every job-description doc is created *inside* this folder and **inherits its
   sharing**, so there is no per-document sharing to manage.
2. **A Google Doc template** — the model fiche de poste, containing the placeholders the MCP
   replaces when it drafts a doc:
   - `{{TITLE}}` — the job title
   - `{{SUMMARY}}` — a one-line summary
   - `{{BODY}}` — the full drafted body (all sections concatenated; legacy fallback)
   - `{{MISSION}}`, `{{RESPONSIBILITIES}}`, `{{PROFILE}}`, `{{CONTEXT}}` — the four structured
     sections, for precise placement (recommended for a deterministic, reproducible layout)
   A template without placeholders still works (you get a titled copy); placeholders just let
   the content be injected. Prefer the four structured placeholders over `{{BODY}}`.
3. **A Google Sheet** — recruitment tracking. The MCP needs a `rec_jobDesc` tab, a `Config`
   tab, and a `Users` tab (`email | role`, the RH-editable identity map — D2), all created for
   you by `setup-company-sheet` (below). If you run the Sheets storage backend, it also needs
   `proc_state` / `proc_audit` tabs.
4. **Share all three** (folder, Doc, Sheet) with the **service-account email** (the
   `client_email` of `GOOGLE_SERVICE_ACCOUNT_JSON`) with **edit** access. Without this the
   MCP cannot copy the template, write rows, or read the Config tab.

The company then provides:

| Item | Used for |
| --- | --- |
| `companyId`, company name | identity, config key |
| roles (e.g. `hr_admin, manager, employee`) | permission model (server-side) |
| Drive **folder** id | `resources.googleDrive.hrKnowledgeFolderId` |
| Doc **template** id | `resources.googleDocs.jobDescriptionTemplateId` |
| Sheet id | `resources.googleSheets.hrRecruitmentSheetId` |
| user list (`email` + role per person) | entered in the **`Users` tab** of the Sheet (RH-editable, D2) — see [pilot-access.md](pilot-access.md). At least one `hr_admin` row doubles as the email recipient for the approve notification (D1). |

The operator issues a **per-company API key** (see step 2 — `create-company` mints it).

> **Per-company key (how tenancy is enforced):** each company config carries
> `auth.apiKeyHash` — the sha256 of that company's key
> ([src/core/auth/apiKey.ts](../src/core/auth/apiKey.ts)). The key **both authenticates the
> caller and selects the tenant**: a key can act *only* as its own company, so the
> `x-company-id` header can no longer choose (or spoof) the tenant — if present it must match,
> else the request is rejected (`FORBIDDEN`). The raw key is shown **once** at creation and only
> its hash is stored; it cannot be recovered.

> A Drive/Doc/Sheet id is the long token in its URL, e.g.
> `https://drive.google.com/drive/folders/<FOLDER_ID>` ,
> `https://docs.google.com/document/d/<TEMPLATE_ID>/edit` ,
> `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`.

## 2. Generate and validate the company config

```bash
npm run create-company -- \
  --id acme --name "Acme Corp" \
  --roles hr_admin,manager,employee \
  --sheet <SHEET_ID> --folder <FOLDER_ID> --template <TEMPLATE_ID>
```

This writes `config/company.acme.yaml`, validated against `companyConfigSchema` (zod). A bad
input fails here, not at server boot. It also **mints the company's API key and prints it once**
(only the sha256 hash is stored in the config) — copy that key and hand it to the company; it
cannot be recovered later. To use a pre-agreed key instead, pass `--key <raw>`.

## 3. Create / validate the Sheet tabs

```bash
# auth: a service-account JSON the Sheet is shared with
export GOOGLE_SERVICE_ACCOUNT_JSON_FILE=./sa.json

npm run setup-company-sheet -- --company config/company.acme.yaml
# add --storage sheets if you run STORAGE_BACKEND=sheets (also creates proc_state/proc_audit)
```

The script is **idempotent and non-destructive**: it adds missing tabs and writes the header
rows (and the `Config` defaults) only to a fresh/empty tab; an existing tab with data is left
intact (a header mismatch is warned, never overwritten).

The `Config` tab is seeded with the default **process policy** (all off ⇒ current behavior):

| key | value | effect |
| --- | --- | --- |
| `requireJustification` | `false` | reinforce the justification ask (surfaced to the Skill) |
| `requireProofDoc` | `false` | require a `proofDocUrl` before approval (enforced by the MCP) |
| `extraValidationStep` | `false` | the Skill walks an extra human-validation confirmation |
| `requireStructuredSections` | `false` | require the 4 sections (mission/responsibilities/profile/context) at generate (enforced by the MCP) |
| `hrNotifyEmail` | *(empty)* | fallback HR recipient for the approve email (D1) when no `Users` row has role `hr_admin` |

The company edits these values to shape **its process**. Security guardrail: only these keys
are honored — any other key in the `Config` tab is **ignored**. Identity lives in the separate
`Users` tab (email → role), and the closed set of *valid* roles/permissions still comes from
the server config — a `Config` policy key can never grant a role.

The **`Users` tab** (`email | role | mcpKeyHash | mcpKeyStatus | mcpKeyCreatedAt`) is created with
the header row only; RH fills one row per person, e.g. `marie.dupont@acme.com | manager`,
`drh@acme.com | hr_admin` (just the first two columns). The server resolves each caller's role from
this tab (D2); editing it re-assigns roles with no redeploy. The trailing `mcpKey*` columns are
**managed by the helper** `npm run add-actor-key -- … --store users-sheet` (a claude.ai-web beta
token: sha256 hash + `active`/`revoked` + timestamp) — RH never edits them by hand except to set
`mcpKeyStatus = revoked`. See [pilot-access.md](pilot-access.md) §5.1.

## 4. Enable the company

Add the config path to `COMPANY_CONFIG_PATH` (comma-separated for several companies):

```bash
COMPANY_CONFIG_PATH=config/company.acme.yaml,config/company.other.yaml
```

Restart the server. Onboarding done — no core code was touched.

## 5. Go live (real Google Doc)

With `GOOGLE_CONNECTORS=live`, the Docs connector is live and **each company's own template +
folder are used per request** (true multi-tenant — no shared/first-company bias). So in live
mode a company **must** configure both `googleDocs.jobDescriptionTemplateId` and
`googleDrive.hrKnowledgeFolderId`.

**Fail loud (no dead links):** in live mode, if a company is missing either id,
`generate_job_description` returns a clear `VALIDATION_ERROR` ("recruitment Docs not configured
for live mode …") — it **never** returns a simulated `docs.example` URL. Without
`GOOGLE_CONNECTORS=live`, everything stays simulated (the default), which is correct for local
dev and tests.

> This is the fix for the "dead Doc link in the chatbot" bug: the deployed server now uses the
> same configured + authenticated path the smoke test uses, or it fails explicitly.

### Doc creation: who owns the file (two auth modes)

Creating a Doc creates a **new file that must have an owner with Drive quota**. A service
account has **no Drive quota**, so it can only own files inside a **Shared Drive**. Pick the
mode that matches the company's Google account:

| Account | Mode | Setup |
| --- | --- | --- |
| **Google Workspace** | Service account (default) | Put the template + destination folder in a **Shared Drive**; add the service-account email as **Content Manager**. No env change. |
| **Personal Gmail** (no Shared Drive) | **OAuth user-delegation** | The Doc is created/owned by the consenting user. Run `npm run oauth-token` once and set `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` in `.env` (see [.env.example](../.env.example)). |

Sheets is unaffected either way — editing an existing spreadsheet needs no quota, so it
always uses the service account. OAuth mode activates only when all three `GOOGLE_OAUTH_*`
vars are set; otherwise the service account is used.

**OAuth one-time setup (personal Gmail):**
1. GCP Console → enable **Google Drive API** + **Google Docs API** + **Gmail API**.
2. Credentials → **Create OAuth client ID → Desktop app** → note client id + secret.
3. OAuth consent screen → External → add your Google account as a **Test user**.
4. `GOOGLE_OAUTH_CLIENT_ID=… GOOGLE_OAUTH_CLIENT_SECRET=… npm run oauth-token` → open the
   printed URL, approve, copy the printed `GOOGLE_OAUTH_REFRESH_TOKEN` into `.env`. The consent
   now includes the **`gmail.send`** scope, so the same token also sends the HR notification.

### HR notification at approve (D1)

When a manager approves a fiche, the MCP writes the `rec_jobDesc` row (with the live doc URL)
**and emails HR** — best-effort, so a failed email never blocks the approval. Recipients are
the `Users` rows with role `hr_admin`; if there are none, the `Config` key `hrNotifyEmail` is
used. A **real** email requires the live Gmail connector: `GOOGLE_CONNECTORS=live` **and** the
`GOOGLE_OAUTH_*` vars (refresh token consented with `gmail.send`). Without OAuth creds the
Gmail connector stays simulated (returns a trace id; no mail leaves).

**Refresh-token lifetime (operational note).** A refresh token issued by an app whose OAuth
consent screen is in **Testing** mode **expires after 7 days** — live Doc creation then fails
with `invalid_grant`. For a durable pilot, move the consent screen to **In production** (the
token stops expiring), or re-run `npm run oauth-token` to mint a fresh one. Also: the token
string starts with `1//` — if Doc creation suddenly returns `invalid_grant`, check that
leading `1` was not dropped when copying it into `.env`.

See [pilot-access.md](pilot-access.md) for how a pilot DRH connects.

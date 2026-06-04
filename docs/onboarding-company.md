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
   - `{{SUMMARY}}` — a short summary
   - `{{BODY}}` — the drafted body
   A template without placeholders still works (you get a titled copy); placeholders just let
   the content be injected.
3. **A Google Sheet** — recruitment tracking. The MCP needs a `rec_jobDesc` tab and a
   `Config` tab (created for you by `setup-company-sheet`, below). If you run the Sheets
   storage backend, it also needs `proc_state` / `proc_audit` tabs.
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
| user list (`actorId` + role per person) | identity headers (see [pilot-access.md](pilot-access.md)) |

The operator issues an **API key** for the company.

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
input fails here, not at server boot.

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

The company edits these values to shape **its process**. Security guardrail: only these keys
are honored — any other key in the `Config` tab (including anything resembling
identity/roles/permissions) is **ignored**. Identity, roles and permissions live only in the
server config and are never editable from the Sheet.

## 4. Enable the company

Add the config path to `COMPANY_CONFIG_PATH` (comma-separated for several companies):

```bash
COMPANY_CONFIG_PATH=config/company.acme.yaml,config/company.other.yaml
```

Restart the server. Onboarding done — no core code was touched.

## 5. Go live (real Google Doc)

The Docs connector runs **live** (creates a real, shared Google Doc) only when:

- `GOOGLE_CONNECTORS=live`, **and**
- the company config has both `googleDocs.jobDescriptionTemplateId` and
  `googleDrive.hrKnowledgeFolderId`.

Set **both** ids or **neither**. With both absent, Docs stays simulated even in live mode
(you opted out). With exactly one set, `generate_job_description` fails with a clear
`VALIDATION_ERROR` ("recruitment Docs config incomplete …") rather than producing a dead
simulated URL. Without `GOOGLE_CONNECTORS=live`, everything stays simulated (the default).

See [pilot-access.md](pilot-access.md) for how a pilot DRH connects.

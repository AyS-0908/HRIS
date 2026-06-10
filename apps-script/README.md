# HRIS Apps Script — workspace setup (Stage 1)

Bound Google Apps Script that prepares a company's HRIS Google Workspace:
all Sheet tabs (governance + transversal + MCP-owned + downstream), the Drive folder,
the Job Description Doc template, the Application Form template, full protections, and
the MCP registration payload (display/copy only — no HTTP call in this stage).

Spec: `docs/hris_appscript_spec_final.txt` (authoritative). Boundary rules: this layer
never calls MCP tools, never sends emails, never publishes externally, never writes rows
to `rec_jobDesc` / `proc_state` / `proc_audit` (headers-if-empty only).

## Files

| File | Responsibility |
|---|---|
| `appsscript.json` | manifest (V8, explicit scopes — no `script.external_request`) |
| `Code.gs` | `initializeHrisWorkspace(input)`, `onOpen` menu, `runInitFromMenu()` |
| `Config.gs` | all constants: tab names, headers, seeds, forbidden fields. `PROC_STATE_HEADER`/`PROC_AUDIT_HEADER` mirror `SHEETS_STORAGE_HEADERS` in `src/storage/sheetsStorageAdapter.ts` — keep in sync |
| `Properties.gs` | DocumentProperties cache (idempotent resource reuse, P0) |
| `SheetSetup.gs` | idempotent tab ensure + dropdowns + Config/Users/library seeds |
| `Protection.gs` | full protections, editors = [operator, service account] |
| `DriveSetup.gs` | folder reuse-or-create, moves, service-account sharing |
| `DocTemplate.gs` | JD Doc template (7 placeholders) |
| `FormTemplate.gs` | application Form template (responses → `form_responses_raw`) |
| `Registration.gs` | MCP registration payload (display/copy only) |
| `Util.gs` | logging, warning collector, dialogs |

## Install (bound script — recommended)

1. Open the company spreadsheet (or a fresh one) → **Extensions → Apps Script**.
2. In the editor: **Project Settings → check "Show `appsscript.json` manifest file"**.
3. Create one file per `.gs` above (Code, Config, Util, Properties, SheetSetup,
   Protection, DriveSetup, DocTemplate, FormTemplate, Registration) and paste the
   contents; replace the manifest with `appsscript.json`.
4. Save. Reload the spreadsheet — an **HRIS Setup** menu appears.

Alternative: `clasp` from this folder (`npm i -g @google/clasp`, `clasp login`,
`clasp create --type sheets --parentId <spreadsheetId> --rootDir .` once, then
`clasp push`).

## Run the initialization

1. Menu **HRIS Setup → Initialize / upgrade workspace…**
2. Answer the prompts: company id (`^[a-z0-9-_]+$`), company name, admin email
   (default: you), **service-account email** (the MCP SA; can be left empty and added in
   a later re-run — protections then list the operator only and a warning reminds you).
3. First run asks for OAuth consent (Sheets, Drive *file-scoped*, Docs, Forms, email).
4. A dialog shows: tabs created/updated, **warnings**, the full output JSON and the
   **MCP registration payload** (also available later via *HRIS Setup → Show MCP
   registration payload*).

Re-running is safe: the script is idempotent and non-destructive (existing data, tabs,
columns and values are never deleted, renamed, reordered or overwritten; header drift
only produces warnings).

## Known platform limits (by design)

- **CV file-upload question:** Google's APIs cannot *create* file-upload items. After the
  first run, open the Form template and add a required **File upload** question titled
  exactly `CV (PDF)` (allow PDF, 1 file). Re-run init: the warning disappears once the
  question exists. (Spec §0: candidates must be signed in to Google to upload — the V1.1
  web-app form removes this.)
- **Drive scope is the full `https://www.googleapis.com/auth/drive`** (not `drive.file`).
  `DriveApp.createFolder` / `getFolderById` / `addEditor` (folder + template sharing, and
  reusing an externally-provided `folderId`) require the broad scope — verified live on
  2026-06-10 (`drive.file` raised "permissions are not sufficient to call
  DriveApp.createFolder"). Note: this corrects spec §7 `apps_script_manifest`, which still
  lists `drive.file`.
- Backend registration (`POST /api/register`) is **not** implemented in this stage; the
  payload is display/copy only (spec §6).

### Running init headlessly via `clasp` (dev convenience — verified 2026-06-10)

The bound-script menu is the operator path. To drive init from the CLI instead (how this
stage was live-verified):

1. GCP project for clasp's OAuth client: enable **Drive API** + **Apps Script API**; create
   a **Desktop OAuth client**; `clasp login --creds <client.json> --extra-scopes
   "https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/forms,https://www.googleapis.com/auth/drive"`
   (the run token must carry every scope the script uses).
2. Scaffold the bound sheet (clasp refuses to `create` when a manifest is already present, so
   do it in an empty temp dir, then copy the generated `.clasp.json` back here): `clasp
   create-script --type sheets --title "…"`.
3. In the script editor → Project Settings, set the **GCP project number** to your standard
   project (else `run` reports "deployed as API executable").
4. **Temporarily** add `"executionApi": { "access": "MYSELF" }` to `appsscript.json` (kept
   OUT of the committed manifest — it is only needed for `clasp run`), `clasp push -f`, then
   `clasp run-function initializeHrisWorkspace -p '[{"companyId":"…","companyName":"…","serviceAccountEmail":"…"}]'`.

## Manual operator test checklist (Stage 1 acceptance)

Apps Script cannot run in CI — run these by hand and report the result (recorded in
`Progress.md` → "Last verification"):

1. **Fresh sheet, first run.** New empty spreadsheet → install → run init with the real
   `serviceAccountEmail`. Expect: all 10 tabs (`Config`, `Users`, `employees`, `library`,
   `rec_jobDesc`, `proc_state`, `proc_audit`, `rec_publications`, `Applications`,
   `Activities`) with frozen header rows; Config seeded with the 5 default keys; Users
   seeded with your email as `hr_admin`; folder + JD template + Form template created in
   Drive and shared (Editor) with the SA; `form_responses_raw` tab present; `library` has
   2 template rows (`ai_usage=autofill`); dropdowns on `Users.role`,
   `Applications.status`, `employees.status`, `library.ai_usage`.
2. **Add the CV question** to the Form template by hand (see above).
3. **Second run (idempotency).** Re-run init (defaults: just press OK through prompts).
   Expect: `tabsCreated` **empty**, no duplicate tabs/questions/Config keys/library
   rows/protections, and the CV warning gone.
4. **Existing company sheet (upgrade).** Run on the EXISTING live company sheet. Expect:
   all existing data preserved untouched; missing tabs added; any missing trailing
   columns appended at the END only; warnings (not changes) for any header drift.
5. **Protections.** Data → Protected sheets & ranges: `rec_jobDesc`, `proc_state`,
   `proc_audit` (sheet protections) and Users `mcpKeyHash`/`mcpKeyStatus`/
   `mcpKeyCreatedAt` (range protections) each list **you + the service account** as
   editors.
6. **Post-init MCP smoke (P0).** From the MCP client run `submit_job_request →
   generate_job_description → approve_job_description` and verify a new `rec_jobDesc`
   row plus `proc_state`/`proc_audit` rows were written — proves the protections did
   not lock the service account out.

# Progress.md — MCP Custom Standard

Last updated: 2026-06-09 · Branch: `main`

> Status board for a fresh agent. Authoritative acceptance = `SPEC.md` §15. History lives in
> git + `STANDARD_CHANGELOG.md` — this file is **current state + next moves only**, kept short.

## State (one line)

V1 complete and live-verified; **architecture hardened (core 0.2.0): per-company API keys
(tenant derived from the key, not a spoofable header) + a claude.ai-web bearer/per-actor path**,
both proven locally over the full Fiche-de-Poste flow. **Storage concurrency hardened** for
multi-user: the runtime serializes same-instance contenders via an in-process `LockProvider`
(no Sheet schema change). All SPEC §15 acceptance items still pass.

## Done

- **`admin_user` beta role (full HR-recruitment access).** Added an operator/admin role with
  access to all 4 recruitment tools (`submit`/`generate`/`approve`/`policy`), so a beta tester who
  needs broad chatbot access gets one role — **no duplicate emails** in the `Users` tab (one email =
  one role). `permissionScope` is now the **single source** of role authorization: removed the
  per-tool `requiredRole: "manager"` from `submit_job_request` + `approve_job_description` (runtime
  still enforces permission; human-validation invariant intact — the AI `generate` tool never
  transitions). Added `admin_user` to `company.acme.yaml` + `company.example.yaml` + both Docs-guard
  fixtures (loader requires every module role to be declared). The approve notification (D1) now
  also goes to `admin_user` rows (`NOTIFY_ROLES` in service.ts), so a beta tester verifies the full
  flow including the email. Google Drive/Sheets access stays separate (Google sharing / group).
  +6 tests (admin_user end-to-end, receives approve email, role matrix: manager/hr_admin preserved,
  employee FORBIDDEN). Gate green: typecheck, 81 tests / 15 files, check-standard.
- **Per-company authentication (core 0.2.0 — A1).** Single shared `API_KEY` removed. Each company
  config carries `auth.apiKeyHash` (sha256). `resolveApiKeyIdentity` maps key→`{companyId,
  apiKeyId}`; the key authenticates *and* binds the tenant, so `x-company-id` can no longer
  choose/spoof it (mismatch ⇒ `FORBIDDEN`). `resolveContext` takes the authenticated companyId.
  `create-company` mints+prints the key (stores only the hash). +5 unit tests.
- **claude.ai web path (A2).** Transport accepts `Authorization: Bearer <key>`; **per-actor keys**
  (`auth.actorKeys[]`) bind identity into the token for claude.ai web (no custom headers) — all at
  `core/auth`. New `npm run add-actor-key`. Verified locally over both paths + full
  submit→generate→approve→re-approve(INVALID_STATE). Native web live-verify **blocked on TLS**.
- **Beta-tester tokens in the `Users` tab (D2, no-restart).** Operator adds/revokes a claude.ai-web
  tester from the `Users` tab — new columns `mcpKeyHash | mcpKeyStatus | mcpKeyCreatedAt` — with
  `npm run add-actor-key -- … --store users-sheet [--revoke]`. The server resolves bearer tokens in
  order **config `actorKeys` → active `Users.mcpKeyHash` → config `apiKeyHash`**
  (`resolveApiKeyIdentityAsync` + `resolveActorByToken`, 60 s cache), so an add/revoke takes effect
  within ~1 min with **no Coolify edit, no server restart, no Apps Script**. Raw token printed once;
  only its sha256 hash is stored; revoked/blank hashes never authenticate. +12 tests (5 token unit,
  2 async-resolver unit, 5 server integration over an in-process MCP transport). Parser is
  back-compatible with the old 2-column `email|role` schema.
- **Consolidated guides.** `docs/developer-guide.md` + `docs/end-user-guide.md` (with the Sheet
  may/must-not contract). README/.env.example/onboarding/pilot-access updated for per-company keys.
- **Core engine.** Streamable HTTP MCP (stateless), 3 core tools, identity/auth, closed error
  set, process runtime (SPEC §5 order), idempotency store (bounded LRU), module/tool/process
  registries + contract validation.
- **HR sample `hr.recruitment` v0.3.0 — 4 tools:** `submit_job_request → generate_job_description
  → approve_job_description` + read-only `get_recruitment_policy`. Structured JD sections
  (deterministic assembly) + per-company policy from the Sheet `Config` tab.
- **Live Google connectors** (`GOOGLE_CONNECTORS=live`): **Sheets** (service account), **Docs**
  (service-account Shared Drive *or* OAuth user-delegation), **Gmail** (OAuth `gmail.send`, HR
  email at approve — D1). Drive/Forms/Calendar/http/webhook stay simulated. Simulated is the
  default (anti-regression).
- **Identity (D2):** actor role resolved from the RH-editable `Users` tab (`email|role`), 60 s
  cache; `x-actor-role` header advisory; YAML = set of valid roles.
- **Storage:** `StorageAdapter` — in-memory default, or Google Sheets impl (`proc_state` /
  `proc_audit`) via `STORAGE_BACKEND=sheets`. Runtime untouched.
- **Concurrency hardening (multi-user).** New `runtime/lockProvider.ts` (`LockProvider` +
  in-process `InProcessLockProvider`, a keyed async-mutex). The runtime serializes the
  gate→handler→updateStatus window per `(companyId, processInstanceId)`, so two concurrent
  requests on the same instance can no longer both pass the status gate and run the side
  effect twice (e.g. double approval). Creators skip the lock (fresh id, no contender); the
  lock is a no-op unless two requests hit the same instance. No Sheet schema change. +8 tests
  (6 lock + 2 runtime concurrency). Scope = one server process; a distributed `LockProvider`
  is the documented multi-replica upgrade (swap at the composition root, no runtime change).
- **Reusability:** `_template` + `create-module`; `create-company` + `setup-company-sheet` +
  `get-oauth-token` onboarding scripts.
- **Deploy:** Dockerfile + Coolify (app **HRIS**, project Hosted Apps). Sheets storage active in prod.
- **Audit hardening (4 fixes).** (1) Sheets storage is now **fail-fast at startup** — every
  loaded company must set `hrRecruitmentSheetId` under `STORAGE_BACKEND=sheets` (was a use-time
  error). (2) Removed the operator's real Sheet id from the tracked `company.example.yaml` (now a
  clearly-fake placeholder). (3) Module `_template` no longer re-`parse`s input in the handler
  (runtime already validates `inputZod` — matches the HR module idiom). (4) `requiredRole` is now
  **optional** in `ToolProcessBinding` (contracts.ts + SPEC §4.4) instead of the `""` sentinel;
  `generate_job_description` omits it (permission-scope-governed).
- **Repo memory cleanup.** Useful facts from `memory/implementation-notes.md` and
  `memory/lessons.md` were migrated into `STANDARD_CHANGELOG.md`; README no longer links to the
  obsolete memory folder, and the two old files were removed so `Progress.md` is the single
  project memory again.
- **Module micro-spec template.** Added `docs/module-micro-spec-template.md`: a non-developer
  input template for new business modules where the operator describes `Who / step / business
  action / Sheet columns`, and the AI-coder translates that into coarse tools, statuses,
  permissions, schemas and verification. Linked it from `docs/developer-guide.md`.
- **Gate green:** `npm test` → **81 passed / 15 files**; `npm run typecheck` clean;
  `npm run check-standard` OK (4 tools); `npm run build` OK.

## Now

- **Apps Script Stage 1 BUILT + LIVE-VERIFIED via clasp (2026-06-10).**
  `initializeHrisWorkspace` implemented in `apps-script/` (12 files: manifest, Code,
  Config, Util, Properties, SheetSetup, Protection, DriveSetup, DocTemplate, FormTemplate,
  Registration, README) per `docs/hris_appscript_spec_final.txt` §0–§7 and
  `docs/implementation-plan-remaining.md` Stage 1. Creates ALL tabs (governance +
  transversal `employees`/`library` + MCP-owned headers mirrored from
  `SHEETS_STORAGE_HEADERS` + downstream), Drive folder, JD Doc template (7 placeholders),
  application Form template (responses → `form_responses_raw`), FULL protections with the
  service account in every editor list (P0), DocumentProperties id cache, and the §6
  registration payload (display/copy only — no HTTP). **Ran live** on a throwaway bound
  sheet via `clasp run` (see "Last verification"): all 10 tabs + frozen rows, exact
  headers, protections list the SA, seeds correct, idempotent 2nd run (`tabsCreated: []`),
  and the SA can WRITE through the protections on `rec_jobDesc`/`proc_state` (smoke proxy).
  **Spec correction found live:** manifest needs full `drive` scope, not §7's `drive.file`
  (`DriveApp.createFolder` fails under `drive.file`) — fixed in `apps-script/appsscript.json`
  + noted in the README; spec §7 still says `drive.file` (left as-is — outside Stage 1
  allowed paths). Two manual residuals: the "CV (PDF)" file-upload question can't be created
  by API (init warns; operator adds it by hand), and the orphaned first-attempt test sheet
  can be deleted from Drive. No `src/` changes; gate green (typecheck, 81 tests / 15 files,
  check-standard).
- **HRIS vision + Apps Script specs finalized, docs aligned (2026-06-09).** The repo is now
  framed as the business brain of a larger HRIS product; recruitment = module 1 of N. Two
  spec layers added: `docs/hris_macro_spec.md` (product macro spec v1.1, decisions locked)
  and `docs/hris_appscript_spec_final.txt` (Apps Script workspace setup v2, all open `❗`
  resolved). **Locked decisions:** one transversal spreadsheet per company (prefix convention
  `rec_*`/`trn_*`…, shared tabs unprefixed); full protections with the **service-account email
  in every protection editor list** (else MCP writes break); bound script first; CV collected
  via a Google Forms file-upload question (V1.1 fallback: HtmlService web-app form, no
  sign-in); `employees` + `library` transversal tabs created at init, module logic later.
  Docs updated: AGENTS.md (boundary + SA-protection gotcha), Architecture.md (Apps Script
  layer + sheet structure), README, developer-guide §7, onboarding-company §1.3. No code
  changes — MCP behavior untouched.

## Next — remaining backlog

(Stage sequencing lives in `docs/implementation-plan-remaining.md` — one stage per run.)

- **OPERATOR (Stage 1 follow-ups, non-blocking):** when installing on the REAL company sheet,
  add the "CV (PDF)" file-upload question to the Form template by hand (API can't create it),
  and run the full MCP `submit → generate → approve` against that sheet to confirm end-to-end
  (the protection-write property is already proven). Optionally delete the orphaned test sheet
  `1EA-ztezdWohqZDvJ1IupsushI9Tf7j0LAhosJZlkLgY` + the "Clasp Test" sheet from Drive.
- **Stage 2 (next to build):** Apps Script downstream recruitment
  (`docs/hris_appscript_spec_final.txt` §1 `apps_script_owns` + §4 downstream tabs) — read
  `rec_jobDesc` where `status="approved"`, per-job Form copies, normalize into
  `Applications`, `rec_publications` prep, `Activities` log. Propose the trigger model first.

- **D4:** future publish/diffusion module + candidate sub-process (`update_candidate_status`) as
  separate MCP modules — first real exercises of the module-creation playbook.
- **D3:** self-service onboarding (company YAML via an Apps Script).

**A#3:** Module-creation wizard

- A Q&A/declarative wizard that emits a runnable module skeleton from a business-process
  description, not from developer-level tool choices. The operator can provide rows such as
  `Who / step / business action / Sheet columns` (example: RH selects publication channels, AI
  drafts messages per selected channel). The AI-coder/wizard must infer coarse MCP tools,
  statuses, permissions and schemas, then ask for confirmation before generating files. Agreed
  format: declarative answers-file/flags **+ interactive prompt fallback**. The deterministic
  **manual SOP already exists** (developer-guide.md §4: `create-module` → author contract →
  register in `modules/index.ts` → enable in a company YAML → `check-standard`/tests green). The
  wizard is an ergonomics layer on top.
- First artifact exists: `docs/module-micro-spec-template.md`. Next implementation step is to make
  the wizard consume that micro-spec and generate the module skeleton.

## Operator action before prod live email works

- **Enable TLS on `hris-mcp.sourcinno.com`** (currently plain HTTP) → unblocks the live claude.ai
  **web** connector verification (steps in `docs/pilot-access.md` §5.3). The bearer/per-actor auth
  model itself is already locally verified.

- **Production (Coolify) still holds the old OAuth refresh token**. Sync the **new**
`GOOGLE_OAUTH_REFRESH_TOKEN` (consented with `documents+drive+gmail.send`, auto-written to local
`.env` by `npm run oauth-token`) into Coolify env, and ensure `config/company.acme.yaml` +
`service-account.json` are present on the server.

## Known risks

- ~~Single shared API key~~ — **resolved** (per-company keys, core 0.2.0).
- **Testing-mode OAuth refresh token expires after 7 days** (`invalid_grant`). Move the consent
  screen to *In production* for a durable pilot, or re-run `npm run oauth-token`. The token
  starts with `1//` — a dropped leading `1` also causes `invalid_grant`.
- ~~Sheets `StorageAdapter` non-atomic read-modify-write / same-instance race~~ — **resolved
  for a single server process** via the runtime `LockProvider` (serializes same-instance
  contenders). **Residual:** running multiple replicas reopens the cross-process race — the
  trigger to add a distributed `LockProvider`. The full-tab scan remains (kept simple on
  purpose; a row cache was rejected as drift-prone). Process-level dedup stays the idempotency store.
  - **In plain terms (non-technical):** the system is safe to run as **one running copy** of the
    server — which is how it runs today on Coolify. Two people acting on the *same* job request at
    the same moment can no longer both push it through (no double approval / double email). The
    one caveat: if we later run **several copies of the server at once** to handle more load, that
    protection would not span the copies until we add a shared lock. For the pilot (a few users,
    one copy), nothing to do now.

## Last verification

- **2026-06-10 — Apps Script Stage 1 LIVE via clasp (fresh-sheet acceptance + smoke proxy).**
  Pushed the 11 files to a bound throwaway sheet with `clasp` (GCP project `hris-499007`,
  Desktop OAuth client, login `--extra-scopes` spreadsheets/documents/forms/drive; manifest
  `executionApi.access=MYSELF` added only for the run, then reverted) and ran
  `initializeHrisWorkspace`. Results, read back via the service account:
  • **all 10 tabs created**, every one frozen row 1 (`Config, Users, employees, library,
  rec_jobDesc, proc_state, proc_audit, rec_publications, Applications, Activities`) +
  `form_responses_raw` from the Form destination.
  • **Headers exact** — `rec_jobDesc=[id,titre,mgr,url,status]`; `proc_state`/`proc_audit`
  byte-identical to `SHEETS_STORAGE_HEADERS`; Users 5-col; employees/library/downstream per §4.
  • **Seeds** — Config 5 keys (Sheets coerces `false`→`FALSE`; harmless, `parseBool` lowercases),
  Users admin row `hr_admin`, library 2 template rows `ai_usage=autofill`.
  • **Protections** — `rec_jobDesc`/`proc_state`/`proc_audit` (whole-sheet) + Users
  `mcpKeyHash`/`mcpKeyStatus`/`mcpKeyCreatedAt` (columns) each list **operator + service
  account** (SA present on every one).
  • **Idempotency** — 2nd run `tabsCreated: []`, `tabsUpdated: []`, reused template/folder ids.
  • **Smoke proxy (P0)** — the service account successfully APPENDED a row through the
  protection on both `rec_jobDesc` and `proc_state` (then cleaned up) ⇒ protections did not
  lock the SA out, the exact risk the post-init MCP smoke guards. (Full MCP-server
  submit→generate→approve against this disposable sheet not run — proven property is the
  protection write.)
  • **Bug fixed live** — `drive.file` → full `drive` in the manifest (`DriveApp.createFolder`
  needs it). Only warning across runs: the documented "CV (PDF)" file-upload (API can't create).
  Repo gate green before+after (typecheck, 81 tests / 15 files, check-standard).
- **2026-06-09 — Apps Script Stage 1 (`initializeHrisWorkspace`) built.** New `apps-script/`
  folder only (no `src/` changes). Static self-review walked every spec §7 acceptance item
  against the code (proc_state/proc_audit headers byte-identical to `SHEETS_STORAGE_HEADERS`
  with keep-in-sync comments; protections editors = operator + SA; reuse order input →
  DocumentProperties → create; headers-if-empty / append-at-end-only / warn-never-overwrite).
  Gate green before AND after: `npm run typecheck`, `npm test` (81 tests / 15 files),
  `npm run check-standard`. **Pending: operator manual checklist + post-init MCP smoke**
  (`apps-script/README.md`) before Stage 1 counts as done.
- **2026-06-08 — `admin_user` beta role.** Added the role to `company.acme.yaml`,
  `company.example.yaml`, and both `tests/fixtures/company.docs-*.yaml` (loader requires every
  module-referenced role to be declared). Updated `recruitmentPermissions` (submit/approve add
  `admin_user`; generate/policy add it alongside `hr_admin`) and removed `requiredRole: "manager"`
  from `submit_job_request` + `approve_job_description` so `permissionScope` is the single
  authorization source. The approve email (D1) also notifies `admin_user` rows (`NOTIFY_ROLES`).
  New `tests/integration/adminUserRole.test.ts` (admin_user end-to-end, receives approve email, role
  matrix). Docs: module README, SPEC §11, developer-guide §2/§7, end-user-guide, onboarding,
  pilot-access. Gate green: `npm run typecheck`, `npm test` (81 tests / 15 files), `npm run check-standard`.
- **2026-06-08 — beta-tester `Users`-tab tokens (D2, no restart).** Added the 5-column `Users`
  schema (`mcpKeyHash | mcpKeyStatus | mcpKeyCreatedAt`), the 3-source auth order (config
  `actorKeys` → active `Users.mcpKeyHash` → config `apiKeyHash`) via `resolveApiKeyIdentityAsync`
  + `resolveActorByToken` (60 s cache), and `add-actor-key --store users-sheet [--revoke]`. Raw
  token printed once; only its sha256 hash stored; revoked/blank never authenticates; back-compat
  with the 2-column `email|role` schema. +12 tests (5 token unit, 2 async-resolver unit, 5 server
  integration over an in-process MCP transport). Gate green: `npm run typecheck`, `npm test`
  (75 tests / 14 files), `npm run check-standard`.
- **2026-06-07 — storage concurrency hardening.** Added `runtime/lockProvider.ts` and runtime
  serialization of same-instance contenders (gate→handler→updateStatus per company+instance).
  New `tests/unit/lockProvider.test.ts` (FIFO/cross-key/error-isolation/drain) and
  `tests/integration/runtimeConcurrency.test.ts` (two concurrent approvals on one instance ⇒
  exactly one success + one `INVALID_STATE`; different instances run concurrently). Gate green:
  `npm run typecheck`, `npm test` (60 tests / 13 files), `npm run check-standard`, `npm run build`.
- **2026-06-07 — module micro-spec template.** Created `docs/module-micro-spec-template.md`
  for non-developer business-process input and linked it from `docs/developer-guide.md`.
  Verified the doc is present and `npm run check-standard` remains green.
- **2026-06-06 — codebase audit.** Architecture/readability/file-hygiene audit completed.
  Verification stayed green: `npm run typecheck`, `npm test` (52 tests / 11 files),
  `npm run check-standard`, `npm run report-maintenance`, and `npm run build`. Follow-up
  cleanup noted: update stale SPEC/testing-guide auth text, remove/migrate old `memory/`
  notes, and blank live resource ids from the tracked example config.
- **2026-06-06 — repo memory cleanup.** Useful facts from the old repo-local memory files were
  preserved in `STANDARD_CHANGELOG.md`; the README memory link was removed; `memory/` notes were
  deleted after migration. Verified with `npm run check-standard` and `npm run test:contract`
  (8 contract tests passed).
- **2026-06-06 — documentation debt re-check.** Re-checked README, SPEC, `.env.example`,
  config example and docs for stale single-`API_KEY` guidance: auth text is aligned with
  per-company/per-actor keys. Verified with `npm test` (52 tests / 11 files) and
  `npm run check-standard`.
- **2026-06-06 — per-company auth + claude.ai-web bearer path (local, curl).** Built + started the
  server with two companies. Proven: company-wide key + `x-actor-*` headers → company tools
  (Desktop path); **per-actor bearer token with NO headers → full `submit → generate → approve`**
  with identity derived from the token (claude.ai-web path); re-approve → `INVALID_STATE`; wrong
  key → `UNAUTHENTICATED`; mismatched `x-company-id` → `FORBIDDEN`. Gate: 52 tests/11 files green.
  *(Live claude.ai **web** connect still pending TLS on the Coolify domain.)*
- **2026-06-05 — full live e2e (A4 gap CLOSED).** Real Google Doc created (OAuth user-delegation,
  owned by the operator), real `rec_jobDesc` row appended, **real HR email sent**
  (`messageId 19e99e962ef277ee`) to an `hr_admin` from the `Users` tab. OAuth scopes confirmed:
  `documents drive gmail.send`. The hardened `oauth-token` script now verifies the refresh token
  redeems and writes it straight into `.env` (no copy-paste).
- **2026-06-04 — deployed app (Coolify), live Sheets connector + storage.** `health_check` → all
  connectors live; `submit → generate → approve` wrote a real `rec_jobDesc` row (`approved`),
  re-approve blocked by the state guard (`INVALID_STATE`, no duplicate); Sheets storage persisted
  1 `proc_state` + 3 `proc_audit` rows, confirmed by service-account read-back.

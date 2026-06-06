# Progress.md — MCP Custom Standard

Last updated: 2026-06-06 · Branch: `feat/mcp-standard-v1`

> Status board for a fresh agent. Authoritative acceptance = `SPEC.md` §15. History lives in
> git + `STANDARD_CHANGELOG.md` — this file is **current state + next moves only**, kept short.

## State (one line)

V1 complete and **live-verified end-to-end**: a manager's request becomes a real Google Doc, a
real `rec_jobDesc` Sheet row, and a real HR notification email. All SPEC §15 acceptance items pass.

## Done

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
- **Reusability:** `_template` + `create-module`; `create-company` + `setup-company-sheet` +
  `get-oauth-token` onboarding scripts.
- **Deploy:** Dockerfile + Coolify (app **HRIS**, project Hosted Apps). Sheets storage active in prod.
- **Gate green:** `npm test` → **45 passed / 10 files**; `npm run typecheck` clean;
  `npm run check-standard` OK (4 tools); `npm run build` OK.

## Now

- Nothing in flight. Repo is at a clean checkpoint on `feat/mcp-standard-v1` (uncommitted
  working-tree changes from the doc-hygiene pass — commit when ready).

## Next — two tracks for the upcoming session

The upcoming session has **one goal in two tracks**: finalize the **robust architecture once and
for all**, then prove it with the **Fiche de Poste** module. Order: A (architecture) before B
(module rests on it).

### Track A — Finalize the robust architecture (do once, lock it)

1. **Per-company API key (code).** Today the server authenticates one **shared** `API_KEY`
   ([src/core/auth/apiKey.ts](src/core/auth/apiKey.ts)); the tenant comes from the spoofable
   `x-company-id` header. Extend to a key→companyId map so a key can only act as its own tenant
   (config schema + `apiKey.ts` + `mcpServer.ts` + tests). Docs already flag this as pending
   (`docs/onboarding-company.md`, `docs/pilot-access.md`).
2. **claude.ai web deployment.** Write + verify the native `claude.ai` custom-connector path
   (OAuth/bearer — the unwritten "Phase 3" in `docs/pilot-access.md`, which today covers only
   Claude Desktop + `mcp-remote`). Requires HTTPS on Coolify.
3. **AI-coder module-creation playbook (deterministic).** A repeatable, scripted/Q&A flow an
   AI-coder follows to add a new module (e.g. *publish a job desc*, *prepare an interview*)
   **without editing core**: extend `scripts/create-module.ts` and/or a `docs/` SOP so the steps
   are fixed — collect domain/process/tools/statuses → scaffold from `_template` → register in
   `modules/index.ts` → enable in a company YAML → contract test green. Ideal: a Q&A wizard that
   asks the operator the few decisions and emits a runnable skeleton. This is what makes the
   standard reusable (SPEC §0).

### Track B — Fiche de Poste module (the architecture's test vehicle)

4. Harden + finalize `hr.recruitment` v0.3.0 as the reference module that exercises every
   architectural guarantee (identity, roles, status gates, idempotency, audit, live Docs/Sheets/
   Gmail). Treat any rough edge here as an architecture bug, not a module patch.

### Cross-cutting — the two guides (`/docs`, consolidate, don't duplicate)

5. **`docs/developer-guide.md` (AI-coder / developer)** — setup, env/OAuth, Coolify deploy, live
   switch, **how to add a module** (Track A#3), add a company, troubleshooting. Must state
   **what may vs. must-not be changed in the Google Sheets**:
   - *RH may edit:* the **`Users`** tab (email→role, re-assigns roles, no redeploy — D2) and the
     **`Config`** tab **values** (the known policy keys only: `requireJustification`,
     `requireProofDoc`, `extraValidationStep`, `requireStructuredSections`, `hrNotifyEmail`).
   - *Must NOT touch / has no effect:* tab **names** and **header rows** (`rec_jobDesc`,
     `proc_state`, `proc_audit`), and any **unknown `Config` key** (ignored by design — a Config
     key can never grant a role; the valid-roles set lives in server config).
6. **`docs/end-user-guide.md` (non-technical DRH)** — connect (Claude Desktop **and** claude.ai
   web), run the flow, and maintain the `Users`/`Config` tabs (same do/don't list as above, in
   plain language).

### Deferred (not this session)

- **D4:** future publish/diffusion module + candidate sub-process (`update_candidate_status`) as
  separate MCP modules — these are the first *real* exercises of the Track A#3 playbook.
- **D3:** self-service onboarding (company YAML via an Apps Script).

## Operator action before prod live email works

Production (Coolify) still holds the **old** OAuth refresh token. Sync the **new**
`GOOGLE_OAUTH_REFRESH_TOKEN` (consented with `documents+drive+gmail.send`, auto-written to local
`.env` by `npm run oauth-token`) into Coolify env, and ensure `config/company.acme.yaml` +
`service-account.json` are present on the server.

## Known risks

- **Single shared API key** (not per-company) — see Next #1.
- **Testing-mode OAuth refresh token expires after 7 days** (`invalid_grant`). Move the consent
  screen to *In production* for a durable pilot, or re-run `npm run oauth-token`. The token
  starts with `1//` — a dropped leading `1` also causes `invalid_grant`.
- Sheets `StorageAdapter` does a full-tab scan on read and a non-atomic read-modify-write on
  `updateStatus` (documented in `storage/sheetsStorageAdapter.ts`). Fine for the V1 reference
  impl; process-level dedup stays the runtime's idempotency store.

## Last verification

- **2026-06-05 — full live e2e (A4 gap CLOSED).** Real Google Doc created (OAuth user-delegation,
  owned by the operator), real `rec_jobDesc` row appended, **real HR email sent**
  (`messageId 19e99e962ef277ee`) to an `hr_admin` from the `Users` tab. OAuth scopes confirmed:
  `documents drive gmail.send`. The hardened `oauth-token` script now verifies the refresh token
  redeems and writes it straight into `.env` (no copy-paste).
- **2026-06-04 — deployed app (Coolify), live Sheets connector + storage.** `health_check` → all
  connectors live; `submit → generate → approve` wrote a real `rec_jobDesc` row (`approved`),
  re-approve blocked by the state guard (`INVALID_STATE`, no duplicate); Sheets storage persisted
  1 `proc_state` + 3 `proc_audit` rows, confirmed by service-account read-back.

# Progress.md — MCP Custom Standard

Last updated: 2026-06-08 · Branch: `main`

> Status board for a fresh agent. Authoritative acceptance = `SPEC.md` §15. History lives in
> git + `STANDARD_CHANGELOG.md` — this file is **current state + next moves only**, kept short.

## State (one line)

V1 complete and live-verified; **architecture hardened (core 0.2.0): per-company API keys
(tenant derived from the key, not a spoofable header) + a claude.ai-web bearer/per-actor path**,
both proven locally over the full Fiche-de-Poste flow. **Storage concurrency hardened** for
multi-user: the runtime serializes same-instance contenders via an in-process `LockProvider`
(no Sheet schema change). All SPEC §15 acceptance items still pass.

## Done

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
- **Gate green:** `npm test` → **75 passed / 14 files**; `npm run typecheck` clean;
  `npm run check-standard` OK (4 tools); `npm run build` OK.

## Now

- Beta-tester `Users`-tab tokens just landed (3-source auth order, 60 s cache, `--store
  users-sheet [--revoke]`, +12 tests). Gate green. Clean checkpoint on `main`.
- Otherwise nothing in flight. Tracks A#1, A#2, the two guides, and the beta-token path are done.

## Next — remaining backlog

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

# MACRO SPEC — HRIS in Google Workspace (product/system level)

```yaml
spec_id: hris.product.macro.v1.1
consumer: AI Coder
status: decisions locked 2026-06-09 — sits ABOVE the per-module micro-specs
relation:
  - this file decomposes the product vision into buildable units
  - each unit is then authored with docs/module-micro-spec-template.md
  - the Apps Script workspace layer is specified in docs/hris_appscript_spec_final.txt
  - it never restates SPEC.md (contracts) or AGENTS.md (invariants)
source_vision: "HRIS in Google Sheets" product note
reminder: the current Recruitment build is ONE module of this larger vision
```

## 0. How to use this spec (AI-coder)

This is the **macro** layer. It tells you *what to build and in which order*, not the
exact types. For any single module:

1. Read `AGENTS.md` (locked invariants) + `SPEC.md` (contracts) + the reference module
   `src/modules/hr/recruitment/`.
2. Take the module's row from §5, run it through `docs/module-micro-spec-template.md`.
3. Build behind the existing runtime — **never edit `core/`, `runtime/`, `server/`** to add a module.

If something here conflicts with `AGENTS.md` or `SPEC.md`, those win (they are locked).

## 1. Locked architectural decisions

```yaml
brain_location: MCP backend is the source of truth and the orchestration layer.
roles:
  mcp_backend:      business brain — tools, status, permissions, audit, idempotency
  apps_script:      workspace setup + downstream HR ops after an approved handoff (bound script)
  chatbot:          driver UI (Claude / ChatGPT) via MCP; probabilistic
  embedded_gemini:  OPTIONAL in-sheet assistant only — never the orchestration layer
rationale:
  - moat vs Google = governed workflow (status gates, roles, audit, HITL, multi-chatbot),
    not a chat box. Gemini-in-Sheets gives the chat box; it does not give the governance.
gemini_replaces_mcp: false

spreadsheet_structure:           # LOCKED 2026-06-09
  decision: ONE spreadsheet per company, transversal across ALL HR modules
  tab_naming:
    shared_unprefixed: [Config, Users, employees, library, proc_state, proc_audit]
    module_prefixed: ["rec_*", "trn_*", "perf_*", "eng_*"]
    legacy_exception: Applications, Activities (spec-locked V1 names)
  split_trigger_v2: a module's high-volume data tab may move to its own spreadsheet
                    (same Drive folder, keyed by job_process_id) if volume or
                    Google-level sharing demands it; governance + MCP tabs never move.

protection_model:                # LOCKED
  full sheet/column protection on technical tabs; every protection's editors include
  the service-account email (MCP writes as the SA — omitting it breaks MCP).

cv_collection:                   # LOCKED — CV is imperative in recruitment
  v1: Google Forms file-upload question (candidate must sign in to a Google account)
  v1_1: Apps Script web-app form (HtmlService) — no sign-in, configurable HTML;
        replaces the Form if sign-in friction proves blocking
```

## 2. Scope boundary

```yaml
in_scope:
  - recruitment (built), publishing, candidate pipeline
  - employees master data (shared)
  - library: governed templates/policies/regulations (shared)
  - training, performance, engagement (later modules)
  - self-service setup / onboarding
  - collect payroll VARIABLES (inputs only)
out_of_scope:
  - payroll execution / payslips / tax filing
  - corporate / mid-cap HRIS use cases
  - moving business logic into Apps Script or into Gemini
non_functional:
  - non-technical HR operator: Setup -> Run -> Maintain
  - one spreadsheet per company; preserve existing data; idempotent setup
```

## 3. Deterministic vs probabilistic contract (concrete)

```yaml
deterministic:    # must be reproducible, gated, audited
  owner: Apps Script + MCP runtime + connectors
  examples:
    - status transitions and gates
    - role/permission checks
    - audit emission (proc_audit)
    - row writes, template copy, form creation, email send
    - idempotency / anti-duplicate
probabilistic:    # advisory only, never finalizes a step
  owner: chatbot + MCP "AI" tools + optional Gemini
  examples:
    - draft job description / messages
    - candidate pre-analysis / summarization
    - Q&A, reformatting dictated answers
hard_rule:
  - every probabilistic output sits BEHIND a human status transition (HITL invariant).
  - an AI tool may recommend a status; it never sets one.
```

## 4. Shared foundation layer

The spreadsheet is transversal, so the shared **tabs** are created at workspace init
(`initializeHrisWorkspace`, see the Apps Script spec §4–§5); the **module logic** over
them ships later. Exact headers live in `docs/hris_appscript_spec_final.txt` §4 —
single source, not duplicated here.

```yaml
identity_roles:
  status: built
  source: Users tab (email|role|mcpKeyHash|mcpKeyStatus|mcpKeyCreatedAt) + company YAML
  rule: roles never come from a data column; only from Users/company config.

employees:
  tab: created at init (transversal) ; module tools later
  purpose: HR-editable master data (data-minimized; forbidden sensitive columns banned)
  open_point: confirm country/regulatory scope (GDPR retention etc.) — operator decision.

library:
  tab: created at init (transversal) ; module tools later
  purpose: governed templates/policies/regulations the AI may fill or must respect
  moat_note:
    - ai_usage column (autofill | reference_only | forbidden) governs AI behavior per item
    - this governed, country-scoped knowledge base is hard for generic Gemini to replicate
  seed: init registers the created Doc/Form templates as library rows (ai_usage=autofill).

setup_onboarding:                # D3
  status: backend scripts exist (create-company, setup-company-sheet);
          bound Apps Script initializeHrisWorkspace is the operator-facing path (specified,
          next to build); self-service wizard later.
```

## 5. Module catalog (versioning + build status)

Each module = a few **coarse** tools on the existing pattern. `built` = in repo today.

```yaml
V1_ambitious:
  hr.recruitment:        { status: built,    tools: [submit_job_request, generate_job_description, approve_job_description, get_recruitment_policy] }
  hris.workspace_setup:  { status: specified, ref: docs/hris_appscript_spec_final.txt, next_to_build: initializeHrisWorkspace }
  hr.publishing:         { status: backlog_D4, example_tools: [configure_publication_channels, draft_channel_messages, approve_publication_messages, prepare_publication_package] }
  hr.candidates:         { status: backlog_D4, example_tools: [normalize_application, pre_analyze_application, update_candidate_status, draft_candidate_message] }
  hr.employees:          { status: tab_at_init + module later, example_tools: [register_employee, update_employee, offboard_employee] }
  hr.library:            { status: tab_at_init + module later, example_tools: [register_library_item, retire_library_item] }

V2_breadth:
  hr.training:     { example_tools: [submit_training_request, plan_training, approve_training, record_completion] }
  hr.performance:  { example_tools: [open_review_cycle, set_objectives, submit_self_review, record_manager_review] }
  hr.engagement:   { example_tools: [build_survey, distribute_survey, aggregate_results, generate_report] }  # needs Forms connector live

V3_expansion:
  hr.roadmap:        { note: HR planning / roadmap definition }
  hr.reporting:      { note: cross-module analytics + report generation }
  hr.payroll_inputs: { note: COLLECT variables only; no payroll execution }
  cross.personas:    { note: auto-generate function personas (agents.md / skills) from module config }
reuse_beyond_hr:
  - same module/process pattern serves sales., marketing. domains (vision goal).
  - "common" = core/runtime/connectors/shared tabs ; "specific" = the module folder.
```

## 6. Connector readiness (gates module choice)

```yaml
live:      [sheets, docs, gmail]
simulated: [drive, forms, calendar, http, webhook]
implication:
  - modules needing only sheets/docs/gmail can ship live now
    (recruitment, employees, library, publishing-as-preparation).
  - engagement surveys need the FORMS connector promoted to live first.
  - the Apps Script layer uses Google services natively (SpreadsheetApp, FormApp…) —
    it does not go through MCP connectors.
  - any external publish (job boards, social) stays preparation/simulation until a
    reliable connector exists (per recruitment gotcha in AGENTS.md).
```

## 7. Commercial lifecycle (Buy -> Setup -> Run -> Maintain)

```yaml
ai_coder_scope_v1:
  - license/entitlement gate = a key in company config (reuse per-company auth). No billing engine.
  - bound Apps Script setup (initializeHrisWorkspace) emitting the MCP registration payload.
  - module enable/disable via company YAML (already supported).
deferred_non_coder_scope:
  - trial logic, payment capture, "service stops if unpaid" enforcement
  - Google Marketplace listing, OAuth app verification/review
packaging:
  now:  bound Apps Script + Google Sheet template (current pilot form factor)
  next: connected Workspace Add-on (in-sheet UI + setup) wrapping the SAME MCP brain
  rule: the Add-on is UI + setup only; business logic stays in MCP.
selection_criteria_applied:   # from vision note
  robustness:        MCP brain + audited runtime > logic-in-Sheets
  moat_vs_google:    governed workflow + library knowledge base
  ease_of_setup:     template + bound init now; Add-on install later
  scalability:       module pattern; distributed LockProvider is the known multi-replica upgrade
```

## 8. Recommended build sequence

```yaml
1: implement initializeHrisWorkspace        # Apps Script step 1 — creates ALL tabs incl. employees/library
2: Apps Script downstream recruitment       # publication prep, form copy per job, normalization
3: hr.publishing + hr.candidates MCP side   # completes recruitment end-to-end (D4)
4: hr.employees + hr.library module logic   # tools over the already-created transversal tabs
5: setup wizard polish (D3)                 # self-service onboarding emitting registration payload
6: promote FORMS connector to live ; V1.1 web-app candidate form if sign-in friction blocks
7: V2 modules (training -> performance -> engagement) via micro-spec template
8: packaging: connected Workspace Add-on ; then Marketplace billing
```

## 9. Acceptance criteria (macro / "ambitious V1 done")

```yaml
acceptance:
  - initializeHrisWorkspace passes the Apps Script spec §7 acceptance (incl. SA-in-protections
    and the post-init MCP smoke).
  - employees + library tabs exist per the Apps Script spec headers; forbidden fields absent.
  - library.ai_usage is honored: an AI tool refuses to autofill a reference_only/forbidden item.
  - recruitment is end-to-end: approved JD -> publishing prep -> candidate pipeline (with CV),
    all behind human status transitions, all audited.
  - adding any new module touches only modules/ + a company YAML (no core/runtime/server edits).
  - every probabilistic step is gated by a human status transition (HITL invariant holds).
  - setup is idempotent and preserves existing company data.
  - gate green for every increment: npm run check-standard + npm test + npm run typecheck.
```

## 10. Open decisions for the operator (do not let the AI-coder guess these)

```yaml
- employee data: confirm country/regulatory scope (GDPR retention? works-council rules?).
- library: who curates and approves ai_usage = autofill (legal sign-off?).
- billing model for go-live (Marketplace billing vs external license) — deferred but decide before V1 sale.
- packaging timing: when to invest in the Marketplace Add-on review cycle.
- whether embedded Gemini is offered at all in V1, or only the external-chatbot path.

# Resolved 2026-06-09 (moved to §1): spreadsheet structure, protection model,
# bound-vs-standalone, CV collection, employees/library timing.
```

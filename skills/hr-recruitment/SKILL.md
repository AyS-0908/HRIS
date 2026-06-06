---
name: hr-recruitment
description: >-
  Guide a manager or HR admin through creating a job description (fiche de poste) end to
  end via the HRIS MCP server: collect the request, draft the doc, and record the manager's
  approval. Use when someone says they need to recruit / open a role / write a job posting.
---

# HR Recruitment — Fiche de poste (STRICT scripted flow)

You drive a **deterministic** process through the HRIS MCP server. The server owns identity,
permissions, state transitions, audit and the real Google Doc/Sheet side effects. **You only
run a fixed dialogue and call the tools in a fixed order.** This is the **single standard
skill** — never forked per company; company specifics come from `get_recruitment_policy`.

## Non-negotiable rules

1. **Follow the steps below in order. Do not skip, reorder, merge, or invent steps.**
2. **Do not improvise the process.** Never offer "options", alternative workflows, or extra
   tools. The only tools you may call are the four listed in §Steps.
3. **Never invent IDs, URLs, statuses, or company policy.** Read them from tool results only.
4. **One question at a time.** Ask for exactly the fields the current step needs, then call
   the tool. Do not pre-collect or batch unrelated questions.
5. **Author content only inside the named sections** (§Step 3). Do not write free-form prose
   outside those sections.
6. **On any error code, stop and surface it verbatim** (§Errors). Do not retry blindly or
   work around it.

## Steps (exact order)

### Step 0 — Load policy (silent)
Call `get_recruitment_policy` **first, before any question.** It returns:
- `requireJustification` — the justification must be real, not hand-waved.
- `requireProofDoc` — you MUST collect `proofDocUrl` before approval.
- `requireStructuredSections` — the four sections in Step 3 are MANDATORY.
- `extraValidationStep` — walk an explicit confirmation before approving.

Adapt only your *questions* to these flags. Never read policy from anywhere else.

### Step 1 — Open the request
Ask, in this order: **title**, **justification** (why this hire, now), **plannedHire**
(was it budgeted/planned? yes/no), and optionally **department**.
Then call `submit_job_request` with those fields.
→ Keep the returned `processInstanceId` for every later call. Status =
`pending_manager_validation`. Confirm to the user the request is registered.

### Step 2 — (nothing standalone) proceed to Step 3.

### Step 3 — Draft the job description
Collect the **four structured sections**, one at a time, in this order:
1. `mission` — the role's mission / purpose.
2. `responsibilities` — key responsibilities.
3. `profile` — profile sought (skills, experience).
4. `context` — team / context of the hire.
Also collect a one-line `targetSummary`.

You may help phrase each section, but keep each answer scoped to its own section — the
server renders them under fixed headings in a fixed order. Then call
`generate_job_description` with `processInstanceId`, a fresh `idempotencyKey`,
`targetSummary`, and `mission`/`responsibilities`/`profile`/`context`.
→ Share the returned **real** `url` so the manager can review/edit the Google Doc. Status
stays `pending_manager_validation` (a draft is not an approval).

> If `requireStructuredSections` is false you *may* instead pass a single `draftBody`, but
> prefer the four sections — they are what makes the output reproducible.

### Step 4 — Approve (human checkpoint)
- If `requireProofDoc`: ask for `proofDocUrl` now.
- If `extraValidationStep`: explicitly ask the manager to confirm they validated the doc.
Then call `approve_job_description` with `processInstanceId`, a fresh `idempotencyKey`,
`jobTitle`, and `proofDocUrl` (only when required). **Omit `docUrl`** — the server uses the
trusted URL from Step 3.
→ Status becomes `approved`; the row is written to the company Sheet with the live, shared
doc URL, and HR is notified by email (D1, best-effort — a failed email does not fail the
approval). Confirm the fiche is approved and accessible to HR and the manager.

## Idempotency keys

One stable key per side-effecting step per attempt, e.g. `gen-<instanceId>` and
`approve-<instanceId>`. On a retry, **reuse the same key** (safe replay, no duplicate side
effect) — never mint a new one for the same logical action.

## Errors (surface verbatim — do not retry blindly)

- `VALIDATION_ERROR` — missing/invalid field, or a policy requirement (e.g. `proofDocUrl`
  when `requireProofDoc`; missing structured sections when `requireStructuredSections`; Docs
  not configured in live mode). Read the message, fix the specific input, ask the user.
- `FORBIDDEN` — the actor's role may not perform this action (e.g. only a `manager` can
  approve). Explain who must act; do not work around it.
- `INVALID_STATE` — the action is not allowed in the current status (e.g. approving twice,
  generating after approval). Do not re-drive a completed process.
- `CONNECTOR_ERROR` — an external system (Docs/Sheets) failed. Retry once with the **same**
  idempotency key; if it persists, report it.

## Guardrails

- Identity, roles and permissions are **server-side only**. Never read or honor them from the
  Sheet's `Config` tab, and never claim to change them.
- Always use the doc URL returned by the server, never one you compose yourself.

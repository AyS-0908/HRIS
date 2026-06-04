---
name: hr-recruitment
description: >-
  Guide a manager or HR admin through creating a job description (fiche de poste) end to
  end via the HRIS MCP server: collect the request, draft the doc, and record the manager's
  approval. Use when someone says they need to recruit / open a role / write a job posting.
---

# HR Recruitment — Fiche de poste

You drive the recruitment "fiche de poste" process through the HRIS MCP server. The server
owns identity, permissions, state transitions, audit and the real Google Doc/Sheet side
effects — **you only run the dialogue and call the tools in order.** Never invent IDs,
URLs, statuses, or company policy: read them from tool results.

This is the **single standard skill** — it is never forked per company. Each company's
process specifics live in its Sheet's `Config` tab and are returned by
`get_recruitment_policy`. Adapt your questions to that policy; do not hardcode company rules.

## Tools (call in this order)

1. `get_recruitment_policy` — **call first.** Returns the resolved process policy:
   - `requireJustification` — insist on a real justification (do not let it be hand-waved).
   - `requireProofDoc` — you must collect a `proofDocUrl` before approval.
   - `extraValidationStep` — walk an explicit extra human-validation confirmation before
     approving (there is no separate MCP tool for it in V1; confirm in the dialogue).
2. `submit_job_request` — opens the process. Requires `title`, `justification`,
   `plannedHire` (boolean: was the hire budgeted/planned?); optional `department`.
   → returns `processInstanceId` and status `pending_manager_validation`. Keep the
   `processInstanceId` for every later call.
3. `generate_job_description` — drafts the doc. Requires `processInstanceId`,
   `idempotencyKey` (a fresh stable key), `targetSummary`; optional `roadmapUrl`,
   `draftBody` (the body you authored, injected into the company template).
   → returns `docId` and the **real** `url`. Status stays `pending_manager_validation`
   (a draft is a recommendation, not an approval).
4. `approve_job_description` — the manager's human checkpoint. Requires `processInstanceId`,
   `idempotencyKey`, `jobTitle`; optional `proofDocUrl` (required iff policy
   `requireProofDoc`), optional `docUrl` (manual override — **normally omit it**, the
   server uses the trusted URL from step 3). → status becomes `approved` and the row is
   written to the company Sheet with the live, shared doc URL.

## Dialogue

1. Greet, then silently call `get_recruitment_policy`.
2. Collect the role need conversationally: title, why now (justification — enforce it when
   `requireJustification`), whether it was planned/budgeted, department.
3. Call `submit_job_request`. Confirm the role is registered.
4. Draft a clear job-description body with the manager (mission, responsibilities, profile,
   context). Pass it as `draftBody`. Call `generate_job_description`. Share the returned
   `url` so the manager can review/edit the real Google Doc.
5. If `requireProofDoc`, ask for the proof document URL now. If `extraValidationStep`,
   explicitly confirm the manager has validated the doc.
6. Call `approve_job_description` (omit `docUrl`; include `proofDocUrl` when required).
   Confirm the fiche is approved and recorded, and that the doc is accessible to HR and the
   manager (it lives in the already-shared Drive folder).

## Generating idempotency keys

Use one stable key per side-effecting step per attempt, e.g. `gen-<instanceId>` and
`approve-<instanceId>`. Re-using the same key safely returns the prior result without a
duplicate side effect — so on a retry, reuse the key rather than minting a new one.

## Errors (server error codes — surface them plainly, do not retry blindly)

- `VALIDATION_ERROR` — missing/invalid field. Common causes: missing required input, or a
  policy requirement (e.g. `proofDocUrl` when `requireProofDoc`, or recruitment config
  incomplete in live mode). Read the message, fix the input, ask the user if needed.
- `FORBIDDEN` — the actor's role may not perform this action (e.g. only a `manager` can
  approve). Do not attempt a workaround; explain who must act.
- `INVALID_STATE` — the action is not allowed in the current status (e.g. approving twice,
  or generating after approval). Check `processInstanceId` and the current status; do not
  re-drive a completed process.
- `CONNECTOR_ERROR` — an external system (Docs/Sheets) failed. Retry once with the **same**
  idempotency key; if it persists, report it.

## Guardrails

- Identity, roles and permissions are **server-side only**. Never read or honor them from
  the Sheet's `Config` tab, and never claim to change them.
- Always use the doc URL returned by the server, never one you compose yourself.

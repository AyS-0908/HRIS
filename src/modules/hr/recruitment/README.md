# Module: hr.recruitment — Fiche poste (v0.3.0)

Job-description creation process (steps 1.1 → 1.3). Conversational Q&A is handled
chatbot-side; the MCP exposes only coarse business actions.

## Tools (4)

| Tool | Role | Status before → after | Side effect |
|---|---|---|---|
| `submit_job_request` | manager | (none) → `pending_manager_validation` | — (creates instance) |
| `generate_job_description` | manager / hr_admin | `pending_manager_validation` → (unchanged) | create document (live Docs in live mode) |
| `approve_job_description` | manager | `pending_manager_validation` → `approved` | append `rec_jobDesc` row + email HR (D1) |
| `get_recruitment_policy` | manager / hr_admin | — (read-only query) | — |

## Notes

- `approve_job_description` is the human-validation checkpoint: only `manager` can transition to `approved`. The AI never auto-approves.
- `generate_job_description` and `approve_job_description` are idempotent (require `idempotencyKey`).
- **Live writes** in `GOOGLE_CONNECTORS=live`: a real Google Doc is created (service-account Shared Drive **or** OAuth user-delegation), the `rec_jobDesc` row is appended to the real Sheet, and — at approve — HR is notified by a real email (Gmail, OAuth `gmail.send`). Simulated skeletons remain the default. See `docs/onboarding-company.md`.
- **Email at approve (D1):** writing the Sheet row (with the doc URL) triggers an HR notification. Recipients = `Users` rows with role `hr_admin` (fallback: Config key `hrNotifyEmail`). Best-effort — a failed email never fails the approval.
- **Identity from the Sheet (D2):** the actor's role is resolved from the RH-editable `Users` tab (`email | role`); the `x-actor-role` header is advisory. The company YAML stays the set of *valid* roles.
- `rec_jobDesc` row columns: `id, titre, mgr, url, status`.
- Publishing / job-board diffusion is **deferred to a future module** (not in this one).

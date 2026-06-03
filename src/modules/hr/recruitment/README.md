# Module: hr.recruitment — Fiche poste (V1)

Job-description creation process (steps 1.1 → 1.3). Conversational Q&A is handled
chatbot-side; the MCP exposes only coarse business actions.

## Tools

| Tool | Role | Status before → after | Side effect |
|---|---|---|---|
| `submit_job_request` | manager | (none) → `pending_manager_validation` | — (creates instance) |
| `generate_job_description` | manager / hr_admin | `pending_manager_validation` → (unchanged) | create document (simulated) |
| `approve_job_description` | manager | `pending_manager_validation` → `approved` | append `rec_jobDesc` row (simulated) |

## Notes

- `approve_job_description` is the human-validation checkpoint: only `manager` can transition to `approved`. The AI never auto-approves.
- `generate_job_description` and `approve_job_description` are idempotent (require `idempotencyKey`).
- Google writes are simulated skeletons in V1 (SPEC §8); real Google wired later.
- `rec_jobDesc` row columns: `id, titre, mgr, url, status`.

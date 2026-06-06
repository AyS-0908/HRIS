# AGENTS.md — MCP Custom Standard (project layer)

> Project map + locked operating rules for this repo. Readable by any AI agent (Claude, Codex, Cursor…). Global behavior lives in the canonical globals (see precedence). Full contracts live in `SPEC.md`. This file carries only what is **locked** for this repo and must not drift between chats. It does not restate the spec or the globals.

---

## Operating map

| Order | Source | Role | Read / use when | Conflict priority |
|---:|---|---|---|---:|
| 1 | `Progress.md` | Current state, next action, project memory | Start of every task and before stopping | 4 |
| 2 | This file (`AGENTS.md`) | Locked repo architecture, conventions, operating rules | Start of every task | 2 |
| 3 | `Architecture.md` | System structure and design context | Only when system understanding is needed | 5 |
| 4 | `SPEC.md` | AI-coder contract: types, schemas, acceptance criteria | Before implementing any type/schema; for verification | 1 |
| 5 | `C:\Users\aymar\.ai-agents\AGENTS-canonical.md` | Global coding, workflow, memory, communication rules | Always applies unless overridden by project/spec rules | 3 |

When sources conflict, lower `Conflict priority` number wins.

Anything not specified anywhere = simplest correct option, noted in a code comment.

## Agent ritual

1. Read the required sources from the operating map.
2. Work on one objective.
3. Verify against `SPEC.md` §15 + contract tests.
4. Update `Progress.md` before stopping.


## Commands

- Install: `npm install`
- Build: `npm run build` (typecheck only: `npm run typecheck`)
- Start: `npm start` (or `node --env-file=.env dist/server/index.js`)
- Test: `npm test` (contract only: `npm run test:contract`)
- Live Sheets smoke: `npm run smoke:live` (requires `GOOGLE_CONNECTORS=live` + service account)
- Verify: SPEC.md §15 acceptance list + contract tests


---

## Locked architecture (do not let these drift)

| Invariant | Rule |
|---|---|
| Layering | `client → transport → core → runtime → module → service → connector`. Top-down dependency only. |
| Handler boundary | A tool handler **never** calls a connector. Handler → service → connector. No exceptions. |
| Transport | streamable HTTP. |
| Identity | `RequestContext{ companyId, actorId, actorRole, apiKeyId }`, resolved once at `core/auth`. It is the **only** source of `actorId`/`companyId` — never inferred downstream. |
| Module path | `modules/{domain}/{process}/` — single hierarchy. No two-level variant. |
| Storage | Reached only through `StorageAdapter`. Never hardcode a backend; runtime depends on the interface, not the Sheets impl. |
| Human validation | = an explicit `status` value transition. AI tools may recommend; they **never** auto-transition a validation status. |
| Schema authoring | Author zod only. MCP `input_schema` is **derived** from zod. Never hand-write both. |

---

## Conventions (this repo)

- **Versioning:** core and modules versioned independently (semver).
- **Error codes (closed set):** `UNAUTHENTICATED | FORBIDDEN | VALIDATION_ERROR | INVALID_STATE | CONNECTOR_ERROR | INTERNAL`. Client receives codes only — never internal messages or stack traces.
- **Tool granularity:** 1 tool = 1 coarse business action. Technical names (`write_row`, `send_http_request`, `create_file`, `call_google_api`, etc.) are **prohibited at the MCP surface**; such steps live inside services.
- **Audit:** every process action emits an `AuditEvent`. Effective level = `max(tool.auditLevel, process floor)`. `none` is forbidden when the process sets `auditRequired = true`.

---

## Runtime ordering (never reimplement in a handler)

- Status logic lives only in `processRuntime`. 
- Handlers do not re-check auth, permissions, status gates, or idempotency — the runtime does, in the order fixed by the spec (§5). 
- If a handler is duplicating any of those steps, that is a bug.

---

## Where things go

| Concern | Location |
|---|---|
| Contracts (ToolDefinition, ModuleContract, StorageAdapter, ProcessDefinition, AuditEvent) | `SPEC.md` — read, implement exactly, do not copy here |
| Status gating / transitions / audit emission | `runtime/processRuntime.ts` only |
| Side effects | services (called by handlers), then connectors |
| Per-company wiring | `config/company.<id>.yaml`, validated by zod, fail-fast |
| New module scaffold | `scripts/create-module.ts` from `_template` |

---

## Project "done" delta

- Beyond the global definition-of-done (proof, not assumption): a change is done for this repo only when it also satisfies the relevant spec **acceptance items (§15)** and **contract tests pass** (`tests/contract/`). 
- Treat the §15 list as the authoritative checkpoints — do not invent your own success criteria for spec work.

---

## Project gotchas (recorded so they don't repeat)

- The HR recruitment sample uses **coarse** tools (`submit_job_request`, `approve_job_description`…), not raw technical steps. Match that granularity when adding tools.
- Connectors are provider-neutral surfaces. Live paths now exist for **Sheets** (service account), **Docs** (service-account Shared Drive *or* OAuth user-delegation) and **Gmail** (OAuth `gmail.send`, used for the HR notification at approve — D1). Drive/forms/calendar/http/webhook remain simulated skeletons. Live Gmail is code-complete + unit-tested but its end-to-end send is only verifiable after the operator runs an OAuth re-consent including `gmail.send` (see Progress.md).
- `[Assumed]` in the spec (e.g. header-based identity) marks an unresolved decision — keep the resolved fields stable; only the extraction may change.

---

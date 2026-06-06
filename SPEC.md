# SPEC — MCP Custom Standard (V1)

> AI-CODER CONTRACT. This document is the source of truth. Where a TypeScript signature or YAML schema is given, implement it exactly; do not redesign the interface. Implementation bodies are yours. Anything not specified is a free implementation choice — choose the simplest correct option and note it in code comments.

---

## 0. GOAL

Reusable MCP server. Business logic plugs in as **modules** (per domain) and **processes** (per workflow) via config + drop-in folders. Core code is never edited to onboard a company or add a module.

Layering (strict, one-directional dependency, top → bottom only):

```
MCP client → transport → core → process runtime → module → service → connector → external system
```

A tool handler MUST NOT call a connector directly. It calls a module service; the service calls a connector.

---

## 1. STACK & TRANSPORT

```yaml
language: TypeScript (strict)
runtime: Node.js LTS
transport: streamable HTTP   # remote MCP; required by Coolify VPS + MCP_SERVER_PUBLIC_URL
validation: zod              # internal source of truth; JSON Schema for tool discovery is DERIVED from zod
logging: structured JSON (one event per line)
deploy: Dockerfile, Coolify-compatible
```

Tool `input_schema` exposed over MCP = JSON Schema generated from the zod schema. Never author both by hand.

---

## 2. IDENTITY & TENANCY (resolve before anything else)

Every request carries an API key. The API key authenticates the caller and selects the tenant.
Actor identity is then resolved once in `core/auth`.

```ts
interface RequestContext {
  companyId: string;        // resolved from the authenticated API key
  actorId: string;          // from per-actor key, or header `x-actor-id`
  actorRole: string;        // resolved from Users tab, per-actor key, or advisory header fallback
  apiKeyId: string;         // stable non-secret id derived from the API key hash
}
```

Rules:
- Reject if API key invalid → `UNAUTHENTICATED`.
- The API key is bound to exactly one company. If `x-company-id` is present, it must match the key's company, else `FORBIDDEN`.
- Reject if the effective `actorRole` is not in that company's configured roles → `FORBIDDEN`.
- `RequestContext` is threaded into every tool handler, service, and audit event. It is the only source of `actorId/companyId`; never infer them elsewhere.

[Resolved 2026-06-05 — D2] Identity from the Sheet. The effective `actorRole` is resolved server-side from the company's RH-editable `Users` tab (`email | role`), keyed by `actorId` (`core/auth/resolveActorRole.ts`). The `x-actor-role` header is advisory and used only as a fallback when the Users tab is absent/empty, the actor is unlisted, or a per-actor key does not bind a role. The company YAML remains the closed set of valid roles.

---

## 3. REPOSITORY LAYOUT (authoritative — single hierarchy)

```
mcp-custom-standard/
├─ src/
│  ├─ server/            index.ts | mcpServer.ts | transport.ts
│  ├─ core/
│  │  ├─ auth/           apiKey.ts | context.ts | resolveActorRole.ts  # Sheet-based role (D2)
│  │  ├─ config/         loadCompany.ts | loadModules.ts | schema.ts
│  │  ├─ logging/  errors/  permissions/  validation/
│  ├─ runtime/           processRuntime.ts   # status gate + status update + audit emission
│  ├─ registry/          moduleRegistry.ts | toolRegistry.ts | processRegistry.ts | validateModule.ts
│  ├─ connectors/        index.ts | google/{drive,docs,docsLive,sheets,sheetsLive,gmail,gmailLive,forms,calendar,auth}.ts | generic/{http,webhook}.ts
│  ├─ storage/           inMemoryAdapter.ts | sheetsStorageAdapter.ts | index.ts  # InMemory (default) + Sheets reference impl (STORAGE_BACKEND=sheets); interface in shared/types/contracts.ts
│  ├─ modules/
│  │  ├─ _template/{process}/...
│  │  ├─ hr/recruitment/  # tools.ts | service.ts | schemas.ts | permissions.ts | policy.ts | index.ts
│  │  └─ index.ts         # module manifest (drop-in registration)
│  └─ shared/            types/ | utils/
├─ config/               company.example.yaml | company.<id>.yaml (gitignored)
├─ tests/                unit/ | integration/ | contract/
├─ scripts/              create-module.ts | create-company.ts | setup-company-sheet.ts | get-oauth-token.mjs | check-standard.ts | report-maintenance.ts
├─ Dockerfile | package.json | .env.example | README.md | STANDARD_CHANGELOG.md
```

Module path is ALWAYS `modules/{domain}/{process}/`. No two-level variant exists.

---

## 4. CORE CONTRACTS (implement these types exactly)

### 4.1 Connector base
```ts
interface HealthResult { ok: boolean; detail?: string }
interface Connector { name: string; healthCheck(): Promise<HealthResult> }
```
Each connector exposes only stable, provider-neutral methods. No provider types leak past the connector boundary.

### 4.2 Storage abstraction (storage backend is pluggable, never hardcoded)
```ts
interface ProcessState {
  processInstanceId: string;
  processId: string;
  companyId: string;
  currentStatus: string;
  currentStep: string;
  createdBy: string;
  createdAt: string;   // ISO-8601
  updatedAt: string;
  lastToolCalled: string;
  externalReferences: Record<string, string>;
  auditLogId: string;
}

interface StorageAdapter {
  createInstance(s: Omit<ProcessState,'updatedAt'|'auditLogId'>): Promise<ProcessState>;
  getInstance(companyId: string, processInstanceId: string): Promise<ProcessState | null>;
  updateStatus(companyId: string, processInstanceId: string, patch:
    Pick<ProcessState,'currentStatus'|'currentStep'|'lastToolCalled'>): Promise<ProcessState>;
  appendAudit(e: AuditEvent): Promise<void>;
}
```
V1 reference implementation: Google Sheets adapter. The runtime depends only on `StorageAdapter`.

### 4.3 Audit event
```ts
interface AuditEvent {
  auditLogId: string;
  timestamp: string;          // ISO-8601
  companyId: string;
  processId: string;
  processInstanceId: string;
  toolName: string;
  actorRole: string;
  actorId: string;
  inputSummary: Record<string, unknown>;   // redacted; no secrets
  externalOutputs: Record<string, string>; // e.g. { docId, sheetRow, messageId }
  statusBefore: string;
  statusAfter: string;
  result: 'success' | 'error';
  errorCode: string | null;
}
```

### 4.4 Tool definition (one tool = one coarse business action)
```ts
interface ToolDefinition<I = unknown> {
  name: string;                       // stable, business-action verb
  description: string;
  inputZod: ZodSchema<I>;             // JSON Schema for MCP derived from this
  permissionScope: string;            // required business permission
  process?: {                         // present iff the tool participates in a process
    processId: string;
    allowedStatusesBefore: string[];  // gate
    statusAfterSuccess: string;
    requiredRole?: string;            // omit when governed by permissionScope alone
    sideEffects: SideEffect[];
    auditLevel: 'none' | 'standard' | 'strict';
    idempotent: boolean;              // true ⇒ handler must dedup via idempotencyKey
  };
  handler(ctx: RequestContext, input: I, deps: ServiceDeps): Promise<ToolResult>;
}

type SideEffect = 'create_document'|'update_sheet'|'send_email'|'create_calendar_event'|'create_form_event';
interface ToolResult { status:'success'|'error'; data: Record<string,unknown>; traceIds: string[] }
```

### 4.5 Module contract (single contract; process fields are the optional extension)
```ts
interface ModuleContract {
  moduleName: string;
  moduleVersion: string;        // semver
  tools: ToolDefinition[];
  permissionRules: PermissionRule[];
  serviceBindings: ServiceBindings;
  healthCheck(): Promise<HealthResult>;
  // present only for process modules:
  processDefinition?: ProcessDefinition;
  statusModel?: StatusModel;
  storageBindings?: StorageBindings;
}
```

### 4.6 Process definition
```ts
interface ProcessDefinition {
  processId: string;
  domain: 'hr'|'sales'|'finance'|'operations'|'other';
  name: string;
  version: string;              // semver
  steps: string[];              // ordered
  statuses: string[];           // allowed values
  roles: string[];
  auditRequired: boolean;       // floor: if true, no tool in this process may use auditLevel 'none'
}
```

---

## 5. PROCESS RUNTIME (the only place status logic lives)

Execution order for any process tool — `processRuntime` enforces this; handlers never reimplement it:

```
1. authenticate + resolve RequestContext        → else UNAUTHENTICATED
2. check permissionScope against actorRole       → else FORBIDDEN
3. validate input via inputZod                   → else VALIDATION_ERROR
4. load ProcessState; assert currentStatus ∈ allowedStatusesBefore → else INVALID_STATE
5. if idempotent: short-circuit on seen idempotencyKey → return prior ToolResult
6. run handler (side effects happen here, via services)
7. on success: storage.updateStatus(statusAfterSuccess)
8. emit AuditEvent (always; even on error) per resolved audit level
```

Audit-level resolution: effective = max(tool.auditLevel, process.auditRequired ? 'standard' : 'none'). `none` is forbidden when `auditRequired = true`.

Human validation = an explicit `status` value (e.g. `pending_manager_validation` → `manager_validated`). AI tools may produce recommendations but MUST NOT transition a validation status; only a tool requiring the validating role + carrying the actor's identity may. Validation actor, role, and timestamp land in the audit event.

---

## 6. CONFIGURATION (per company, no core edits)

`config/company.<id>.yaml`:
```yaml
company:
  id: acme
  name: Acme Corp
  enabledModules: [hr.recruitment, sales.lead_management]
  roles: [hr_admin, manager, employee, sales_admin]
resources:
  googleDrive:   { hrKnowledgeFolderId: "", salesTemplatesFolderId: "" }
  googleSheets:  { hrRecruitmentSheetId: "", salesPipelineSheetId: "" }
  googleDocs:    { jobDescriptionTemplateId: "", proposalTemplateId: "" }
```
Loader validates against zod, fails fast on unknown module references or undefined roles.

---

## 7. CORE TOOLS (only these exposed by default)

```
health_check
list_available_business_tools
get_standard_version
```
Maintenance, logs, secrets, diagnostics are NOT MCP tools unless an explicit `admin` flag enables them.

---

## 8. CONNECTORS (V1 = skeletons, provider-neutral surface)

```
google: drive, docs, sheets, gmail, forms, calendar
generic: http, webhook
```
Each implements `Connector`. Side-effect methods accept an `idempotencyKey` and return a traceable external id. Live paths implemented: **Sheets** (service account), **Docs** (service-account Shared Drive *or* OAuth user-delegation; `docsLive.ts`), **Gmail** (OAuth `gmail.send`; `gmailLive.ts`, used for the HR notification at approve). Drive/forms/calendar/http/webhook remain simulated skeletons (provider-neutral surfaces, ready to wire).

---

## 9. SECURITY (enforced invariants, not advice)

```
- No unauthenticated request proceeds past core/auth.
- Permission check precedes every tool body.
- Inputs validated before any side effect.
- Secrets only from env; never logged; redacted from inputSummary.
- Errors returned to client are safe codes (see §10); stack traces stay server-side.
```

---

## 10. ERROR MODEL

Normalized codes returned to client: `UNAUTHENTICATED | FORBIDDEN | VALIDATION_ERROR | INVALID_STATE | CONNECTOR_ERROR | INTERNAL`. Client never receives internal messages or stack traces.

---

## 11. SAMPLES (required, must run end-to-end)

HR recruitment process (tools are coarse business actions — note the corrected granularity vs. raw technical steps):
```
processId: hr.recruitment   # v0.3.0 — 4 tools
tools:
  submit_job_request        # creates instance → status: pending_manager_validation
  generate_job_description  # AI draft + create doc (live Docs in live mode); status unchanged
  approve_job_description    # role=manager; pending_manager_validation → approved (human checkpoint);
                             #   appends the rec_jobDesc row AND notifies HR by email (D1, best-effort)
  get_recruitment_policy     # read-only query (no process binding): the resolved per-company policy
```

> [Resolved 2026-06-05 — D1] HR is notified by **email at APPROVE** (when the Sheet row is written with the doc URL), not at publish. Recipients = `Users` rows with role `hr_admin` (fallback: Config key `hrNotifyEmail`). Best-effort: a failed email never fails the approval.
>
> **Future modules (deferred — D4):** `publish_job_opening` (job-board diffusion / HR publishing front) and `update_candidate_status` (candidate sub-process) are NOT in this module; they belong to a separate future MCP module and were removed from the V1 sample.

> Tool names like `write_row`, `send_http_request`, `create_file`, `call_google_api` are PROHIBITED at the MCP surface. Such steps live inside services.

---

## 12. DEVELOPER TOOLING

- `scripts/create-module.ts` → `create-module --domain hr --module recruitment` scaffolds the `modules/{domain}/{process}/` tree from `_template` with stub tool, schema, service, permissions, test, README.
- Contract tests assert: every registered tool has a valid zod schema, a unique name, a permission scope, and (if `process`) a `statusAfterSuccess` ∈ `process.statuses`.
- `report-maintenance.ts` emits:
```json
{ "standardVersion":"x.y.z", "mcpCompatibility":"ok|warning|error",
  "connectors":"ok|warning|error", "modules":"ok|warning|error",
  "blockingIssues":[], "recommendedActions":[] }
```

---

## 13. VERSIONING

Core and modules versioned independently (semver). Breaking core change requires a `STANDARD_CHANGELOG.md` migration note. Deprecated exports survive one minor version.

---

## 14. DEPLOYMENT

```env
NODE_ENV= PORT= MCP_SERVER_PUBLIC_URL= COMPANY_CONFIG_PATH= LOG_LEVEL=
# API keys are per-company: config/company.<id>.yaml stores auth.apiKeyHash / auth.actorKeys[].keyHash.
# connector / storage mode
GOOGLE_CONNECTORS=simulated|live   STORAGE_BACKEND=memory|sheets
# live Google (service account — Sheets always, Docs via Shared Drive). Prefer the *_FILE path:
GOOGLE_SERVICE_ACCOUNT_JSON_FILE=   GOOGLE_SERVICE_ACCOUNT_JSON=   # (inline fallback, single-line)
# OAuth user-delegation — Docs-on-personal-Gmail + Gmail send (gmail.send scope, D1):
GOOGLE_OAUTH_CLIENT_ID=  GOOGLE_OAUTH_CLIENT_SECRET=  GOOGLE_OAUTH_REFRESH_TOKEN=
```

---

## 15. ACCEPTANCE (single authoritative list — V1 done when all pass)

```
1.  Server starts locally and in Docker.
2.  MCP client discovers tools over streamable HTTP.
3.  Core tools (§7) work.
4.  create-module scaffolds a runnable module.
5.  A company config loads; only its enabledModules' tools are exposed.
6.  Unauthenticated → UNAUTHENTICATED; wrong role → FORBIDDEN; bad input → VALIDATION_ERROR.
7.  Process tool rejected when currentStatus ∉ allowedStatusesBefore (INVALID_STATE).
8.  Successful process tool updates status and writes an AuditEvent.
9.  A human-validation checkpoint blocks AI auto-approval; only the validating role transitions it.
10. Idempotent side-effect tool re-call returns the prior result, no duplicate side effect.
11. Storage runs through StorageAdapter (Sheets reference impl), swappable without core edits.
12. HR recruitment sample runs end-to-end.
13. Contract tests pass; maintenance report runs.
14. README covers local run, Docker run, module creation, deployment.
```

---

## OUT OF SCOPE (V1)
Admin UI · workflow editor · billing · full OAuth · multi-tenant database · marketplace · production-grade Google connectors · the HR self-service/operations exposure split (future, non-binding).

---

# Appendix

## Skill + MCP Product Model

A Skill could be added to be the AI-agent guide: tell Claude/Codex how to use the HR workflow, what inputs to collect, and which MCP tools to call. 
Embedded Skill scripts may help with setup, tests, sheet preparation, or module scaffolding.
But the Skill should not replace the MCP: the MCP remains the secure runtime for identity, permissions, status changes, audit, and Google Sheets/Docs writes.

**Recommended flow:**
Manager → Chatbot + HR Skill → MCP tool → Google Sheets / Docs → HR review


## Commercial options:

**Free MCP + paid Sheets/Add-on**
Easier to market through Google Workspace, but risky: you pay hosting/support for free MCP users, and the core value may be used without paying.

**Free Sheets + paid hosted MCP** (PREFERRED)
Better SaaS model. The sheet is the visible workspace; the paid MCP is the automation, security, audit, and AI integration layer. Costs scale with paying customers.

**Recommended model**
Offer a free demo/self-hosted MCP, sell the hosted MCP subscription, and include the Google Sheet/Add-on + Skill as onboarding assets. This keeps developer costs controlled while making installation easy for SMBs.
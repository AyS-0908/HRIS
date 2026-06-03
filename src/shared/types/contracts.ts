// All core contracts. SPEC §4 types are implemented exactly — do not redesign.
import type { ZodSchema } from "zod";

// ── Identity (SPEC §2) ──────────────────────────────────────────────────────
export interface RequestContext {
  companyId: string; // from header `x-company-id`, validated against loaded companies
  actorId: string; // from header `x-actor-id`
  actorRole: string; // from header `x-actor-role`, validated against company roles
  apiKeyId: string; // resolved from API_KEY
}

// ── Error model (SPEC §10) ──────────────────────────────────────────────────
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "INVALID_STATE"
  | "CONNECTOR_ERROR"
  | "INTERNAL";

// ── Logging ─────────────────────────────────────────────────────────────────
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

// ── Connectors (SPEC §4.1, §8) — provider-neutral surface ───────────────────
export interface HealthResult {
  ok: boolean;
  detail?: string;
}
export interface Connector {
  name: string;
  healthCheck(): Promise<HealthResult>;
}

export interface DocsConnector extends Connector {
  // Creates a document (optionally from a template). Returns a traceable id.
  createDocument(
    input: { templateId?: string; title: string; content: string },
    idempotencyKey: string,
  ): Promise<{ docId: string; url: string }>;
}
export interface SheetsConnector extends Connector {
  appendRow(
    input: { sheetId: string; tab: string; values: Record<string, string> },
    idempotencyKey: string,
  ): Promise<{ rowId: string }>;
}
export interface DriveConnector extends Connector {
  // Reads text from a Drive file by id or URL (used by chatbot-side flows).
  getFileText(input: { fileIdOrUrl: string }): Promise<{ text: string }>;
}
export interface HttpConnector extends Connector {
  request(
    input: { method: string; url: string; body?: unknown },
    idempotencyKey: string,
  ): Promise<{ requestId: string; status: number }>;
}
export interface WebhookConnector extends Connector {
  send(
    input: { url: string; payload: unknown },
    idempotencyKey: string,
  ): Promise<{ deliveryId: string }>;
}
// V1 skeletons (SPEC §8): provider-neutral surfaces, simulated. Methods accept an
// idempotencyKey and return a traceable external id, matching the §4.4 SideEffect set.
export interface GmailConnector extends Connector {
  sendEmail(
    input: { to: string; subject: string; body: string },
    idempotencyKey: string,
  ): Promise<{ messageId: string }>;
}
export interface FormsConnector extends Connector {
  createForm(
    input: { title: string; description?: string },
    idempotencyKey: string,
  ): Promise<{ formId: string; url: string }>;
}
export interface CalendarConnector extends Connector {
  createEvent(
    input: { title: string; startsAt: string; endsAt: string; attendees?: string[] },
    idempotencyKey: string,
  ): Promise<{ eventId: string; url: string }>;
}

export interface Connectors {
  docs: DocsConnector;
  sheets: SheetsConnector;
  drive: DriveConnector;
  gmail: GmailConnector;
  forms: FormsConnector;
  calendar: CalendarConnector;
  http: HttpConnector;
  webhook: WebhookConnector;
}

// ── Storage (SPEC §4.2) — backend is pluggable, never hardcoded ─────────────
export interface ProcessState {
  processInstanceId: string;
  processId: string;
  companyId: string;
  currentStatus: string;
  currentStep: string;
  createdBy: string;
  createdAt: string; // ISO-8601
  updatedAt: string;
  lastToolCalled: string;
  externalReferences: Record<string, string>;
  auditLogId: string;
}

export interface StorageAdapter {
  createInstance(
    s: Omit<ProcessState, "updatedAt" | "auditLogId">,
  ): Promise<ProcessState>;
  getInstance(
    companyId: string,
    processInstanceId: string,
  ): Promise<ProcessState | null>;
  updateStatus(
    companyId: string,
    processInstanceId: string,
    patch: Pick<
      ProcessState,
      "currentStatus" | "currentStep" | "lastToolCalled"
    >,
  ): Promise<ProcessState>;
  appendAudit(e: AuditEvent): Promise<void>;
}

// ── Audit (SPEC §4.3) ───────────────────────────────────────────────────────
export interface AuditEvent {
  auditLogId: string;
  timestamp: string; // ISO-8601
  companyId: string;
  processId: string;
  processInstanceId: string;
  toolName: string;
  actorRole: string;
  actorId: string;
  inputSummary: Record<string, unknown>; // redacted; no secrets
  externalOutputs: Record<string, string>; // e.g. { docId, sheetRow, messageId }
  statusBefore: string;
  statusAfter: string;
  result: "success" | "error";
  errorCode: string | null;
}

// ── Tool definition (SPEC §4.4) — one tool = one coarse business action ─────
export type SideEffect =
  | "create_document"
  | "update_sheet"
  | "send_email"
  | "create_calendar_event"
  | "create_form_event";

export type AuditLevel = "none" | "standard" | "strict";

export interface ToolResult {
  status: "success" | "error";
  data: Record<string, unknown>;
  traceIds: string[];
}

export interface ServiceDeps {
  storage: StorageAdapter;
  connectors: Connectors;
  services: Record<string, unknown>;
  logger: Logger;
  // Records an external output id; feeds AuditEvent.externalOutputs and ToolResult.traceIds.
  recordExternal(key: string, id: string): void;
  idempotencyKey: string;
  ctx: RequestContext;
  process: ProcessState; // the loaded/created instance for this call
  // Per-company resource ids (e.g. googleSheets.hrRecruitmentSheetId), from config.
  resources: Record<string, Record<string, string> | undefined>;
}

export interface ToolProcessBinding {
  processId: string;
  allowedStatusesBefore: string[]; // gate
  statusAfterSuccess: string;
  requiredRole: string;
  sideEffects: SideEffect[];
  auditLevel: AuditLevel;
  idempotent: boolean; // true ⇒ handler must dedup via idempotencyKey
}

export interface ToolDefinition<I = unknown> {
  name: string; // stable, business-action verb
  description: string;
  inputZod: ZodSchema<I>; // JSON Schema for MCP derived from this
  permissionScope: string; // required business permission
  process?: ToolProcessBinding; // present iff the tool participates in a process
  handler(ctx: RequestContext, input: I, deps: ServiceDeps): Promise<ToolResult>;
}

// ── Process definition (SPEC §4.6) ──────────────────────────────────────────
export type ProcessDomain =
  | "hr"
  | "sales"
  | "finance"
  | "operations"
  | "other";

export interface ProcessDefinition {
  processId: string;
  domain: ProcessDomain;
  name: string;
  version: string; // semver
  steps: string[]; // ordered
  statuses: string[]; // allowed values
  roles: string[];
  auditRequired: boolean; // floor: if true, no tool may use auditLevel 'none'
}

// ── Module contract (SPEC §4.5) ─────────────────────────────────────────────
export interface PermissionRule {
  scope: string; // matches ToolDefinition.permissionScope
  roles: string[]; // roles allowed to use that scope
}

export interface StatusModel {
  initial: string;
  statuses: string[];
}

export type ServiceBindings = Record<string, unknown>;
export type StorageBindings = Record<string, string>;

export interface ModuleContract {
  moduleName: string;
  moduleVersion: string; // semver
  tools: ToolDefinition[];
  permissionRules: PermissionRule[];
  serviceBindings: ServiceBindings;
  healthCheck(): Promise<HealthResult>;
  // present only for process modules:
  processDefinition?: ProcessDefinition;
  statusModel?: StatusModel;
  storageBindings?: StorageBindings;
}

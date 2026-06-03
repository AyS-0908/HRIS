// Google Sheets StorageAdapter — the SPEC §4.2 / §15.11 reference impl. Persists
// ProcessState (proc_state tab) and AuditEvent (proc_audit tab) in a spreadsheet,
// reusing the live connector's service-account auth (createSheetsJwt).
//
// The runtime depends only on StorageAdapter; selecting this backend is a composition
// -root concern (see src/storage/index.ts, src/app.ts) — no core edits.
//
// Tabs are manual setup (documented columns), like the rec_jobDesc tab. This adapter
// assumes proc_state / proc_audit exist with a header row in row 1.
//
// Known V1 limitations (acceptable for a reference impl): getInstance/updateStatus do a
// full-tab scan, and updateStatus is a non-atomic read-modify-write. Process-level dedup
// is handled by the runtime's idempotency store, not here.
import { randomUUID } from "node:crypto";
import type { JWT } from "google-auth-library";
import type { AuditEvent, Logger, ProcessState, StorageAdapter } from "../shared/types/contracts.js";
import { connectorError, invalidState } from "../core/errors/appError.js";
import { createSheetsJwt } from "../connectors/google/auth.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

// proc_state columns A..K (header row 1, data from row 2).
const STATE_HEADERS = [
  "processInstanceId",
  "processId",
  "companyId",
  "currentStatus",
  "currentStep",
  "createdBy",
  "createdAt",
  "updatedAt",
  "lastToolCalled",
  "externalReferences",
  "auditLogId",
] as const;

// proc_audit columns A..N.
const AUDIT_HEADERS = [
  "auditLogId",
  "timestamp",
  "companyId",
  "processId",
  "processInstanceId",
  "toolName",
  "actorRole",
  "actorId",
  "inputSummary",
  "externalOutputs",
  "statusBefore",
  "statusAfter",
  "result",
  "errorCode",
] as const;

const STATE_LAST_COL = "K"; // 11 columns
const cell = (row: (string | undefined)[], i: number): string => row[i] ?? "";

export interface SheetsStorageOptions {
  stateTab?: string;
  auditTab?: string;
}

export class SheetsStorageAdapter implements StorageAdapter {
  private readonly client: JWT;
  private readonly stateTab: string;
  private readonly auditTab: string;

  constructor(
    private readonly logger: Logger,
    serviceAccountJson: string,
    private readonly sheetId: string,
    opts: SheetsStorageOptions = {},
  ) {
    this.client = createSheetsJwt(serviceAccountJson).client;
    this.stateTab = opts.stateTab ?? "proc_state";
    this.auditTab = opts.auditTab ?? "proc_audit";
  }

  async createInstance(s: Omit<ProcessState, "updatedAt" | "auditLogId">): Promise<ProcessState> {
    const state: ProcessState = { ...s, updatedAt: new Date().toISOString(), auditLogId: randomUUID() };
    await this.append(this.stateTab, this.stateToRow(state));
    this.logger.info("storage.sheets.createInstance", {
      processInstanceId: state.processInstanceId,
      companyId: state.companyId,
    });
    return state;
  }

  async getInstance(companyId: string, processInstanceId: string): Promise<ProcessState | null> {
    const found = await this.findStateRow(companyId, processInstanceId);
    return found ? found.state : null;
  }

  async updateStatus(
    companyId: string,
    processInstanceId: string,
    patch: Pick<ProcessState, "currentStatus" | "currentStep" | "lastToolCalled">,
  ): Promise<ProcessState> {
    const found = await this.findStateRow(companyId, processInstanceId);
    if (!found) throw invalidState(`instance not found: ${processInstanceId}`);
    const next: ProcessState = { ...found.state, ...patch, updatedAt: new Date().toISOString() };
    const range = `${this.stateTab}!A${found.rowNumber}:${STATE_LAST_COL}${found.rowNumber}`;
    await this.updateRow(range, this.stateToRow(next));
    this.logger.info("storage.sheets.updateStatus", { processInstanceId, currentStatus: next.currentStatus });
    return next;
  }

  async appendAudit(e: AuditEvent): Promise<void> {
    await this.append(this.auditTab, this.auditToRow(e));
    this.logger.info("storage.sheets.appendAudit", { auditLogId: e.auditLogId, result: e.result });
  }

  // --- row (de)serialization -------------------------------------------------

  private stateToRow(s: ProcessState): string[] {
    return [
      s.processInstanceId,
      s.processId,
      s.companyId,
      s.currentStatus,
      s.currentStep,
      s.createdBy,
      s.createdAt,
      s.updatedAt,
      s.lastToolCalled,
      JSON.stringify(s.externalReferences ?? {}),
      s.auditLogId,
    ];
  }

  private rowToState(row: (string | undefined)[]): ProcessState {
    let externalReferences: Record<string, string> = {};
    try {
      const raw = cell(row, 9);
      if (raw) externalReferences = JSON.parse(raw) as Record<string, string>;
    } catch {
      // Tolerate a malformed cell rather than crash the read path.
    }
    return {
      processInstanceId: cell(row, 0),
      processId: cell(row, 1),
      companyId: cell(row, 2),
      currentStatus: cell(row, 3),
      currentStep: cell(row, 4),
      createdBy: cell(row, 5),
      createdAt: cell(row, 6),
      updatedAt: cell(row, 7),
      lastToolCalled: cell(row, 8),
      externalReferences,
      auditLogId: cell(row, 10),
    };
  }

  private auditToRow(e: AuditEvent): string[] {
    return [
      e.auditLogId,
      e.timestamp,
      e.companyId,
      e.processId,
      e.processInstanceId,
      e.toolName,
      e.actorRole,
      e.actorId,
      JSON.stringify(e.inputSummary ?? {}),
      JSON.stringify(e.externalOutputs ?? {}),
      e.statusBefore,
      e.statusAfter,
      e.result,
      e.errorCode ?? "",
    ];
  }

  // --- low-level Sheets REST (mirrors connectors/google/sheetsLive.ts) -------

  // Scans proc_state for a row matching companyId + processInstanceId. Returns the
  // parsed state and its 1-based sheet row number (header is row 1, data from row 2).
  private async findStateRow(
    companyId: string,
    processInstanceId: string,
  ): Promise<{ state: ProcessState; rowNumber: number } | null> {
    const rows = await this.getRows(`${this.stateTab}!A2:${STATE_LAST_COL}`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (cell(row, 0) === processInstanceId && cell(row, 2) === companyId) {
        return { state: this.rowToState(row), rowNumber: i + 2 };
      }
    }
    return null;
  }

  private async append(tab: string, values: string[]): Promise<void> {
    const url =
      `${SHEETS_API}/${encodeURIComponent(this.sheetId)}` +
      `/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    await this.request({ url, method: "POST", data: { values: [values] } });
  }

  private async getRows(range: string): Promise<(string | undefined)[][]> {
    const url = `${SHEETS_API}/${encodeURIComponent(this.sheetId)}/values/${encodeURIComponent(range)}`;
    const res = await this.request<{ values?: (string | undefined)[][] }>({ url, method: "GET" });
    return res.data?.values ?? [];
  }

  private async updateRow(range: string, values: string[]): Promise<void> {
    const url =
      `${SHEETS_API}/${encodeURIComponent(this.sheetId)}` +
      `/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    await this.request({ url, method: "PUT", data: { values: [values] } });
  }

  // Single egress point to the Sheets API. Raw provider errors are re-typed as
  // CONNECTOR_ERROR so the boundary stays semantically precise (SPEC §10) and the
  // failure is distinguishable from a generic INTERNAL in logs. No provider type leaks.
  private async request<T = unknown>(
    config: Parameters<JWT["request"]>[0],
  ): Promise<{ data: T }> {
    try {
      return await this.client.request<T>(config);
    } catch (err) {
      this.logger.error("storage.sheets.request_failed", {
        method: config.method,
        err: String(err),
      });
      throw connectorError("Google Sheets storage request failed");
    }
  }
}

// Exported for tests/docs: the canonical header rows for manual tab setup.
export const SHEETS_STORAGE_HEADERS = { proc_state: STATE_HEADERS, proc_audit: AUDIT_HEADERS };

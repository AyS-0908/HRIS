// Storage factory (mirrors connectors/index.ts). Selects the StorageAdapter backend
// at the composition root; the runtime only ever sees the StorageAdapter interface.
// SPEC §4.2 / §15.11 — swappable without core edits.
import type {
  AuditEvent,
  Logger,
  ProcessState,
  StorageAdapter,
} from "../shared/types/contracts.js";
import { InMemoryStorageAdapter } from "./inMemoryAdapter.js";
import { SheetsStorageAdapter } from "./sheetsStorageAdapter.js";

export interface StorageOptions {
  backend: "memory" | "sheets";
  serviceAccountJson?: string;
  // Per-company recruitment spreadsheets (sheets backend). Each tenant's process state +
  // audit persist to ITS OWN sheet (true multi-tenant — P2.3). A company without a sheet id
  // is rejected fail-fast at startup with a clear error.
  companies?: { companyId: string; sheetId?: string }[];
}

export function buildStorage(logger: Logger, options: StorageOptions): StorageAdapter {
  if (options.backend === "sheets") {
    if (!options.serviceAccountJson) {
      throw new Error(
        "STORAGE_BACKEND=sheets requires a service account (set GOOGLE_SERVICE_ACCOUNT_JSON_FILE or GOOGLE_SERVICE_ACCOUNT_JSON)",
      );
    }
    // Fail-fast at startup: under the sheets backend EVERY loaded company must declare its own
    // recruitment spreadsheet, otherwise that tenant would only fail on its first request.
    const companies = options.companies ?? [];
    if (companies.length === 0) {
      throw new Error(
        "STORAGE_BACKEND=sheets requires a spreadsheet id (set resources.googleSheets.hrRecruitmentSheetId in the company config)",
      );
    }
    const missing = companies.filter((c) => !c.sheetId).map((c) => c.companyId);
    if (missing.length > 0) {
      throw new Error(
        `STORAGE_BACKEND=sheets requires resources.googleSheets.hrRecruitmentSheetId for every loaded company; missing for: ${missing.join(", ")}`,
      );
    }
    return new SheetsStorageRouter(logger, options.serviceAccountJson, companies);
  }
  // In-memory backend: a single companyId-keyed store serves every tenant.
  return new InMemoryStorageAdapter();
}

// Routes each StorageAdapter call to the calling company's own Sheets adapter (P2.3). The
// companyId is taken from the call (state.companyId / the companyId arg / event.companyId),
// so no tenant ever reads or writes another tenant's spreadsheet.
class SheetsStorageRouter implements StorageAdapter {
  private readonly byCompany = new Map<string, SheetsStorageAdapter>();

  constructor(
    logger: Logger,
    serviceAccountJson: string,
    companies: { companyId: string; sheetId?: string }[],
  ) {
    for (const c of companies) {
      if (c.sheetId) {
        this.byCompany.set(c.companyId, new SheetsStorageAdapter(logger, serviceAccountJson, c.sheetId));
      }
    }
  }

  private pick(companyId: string): SheetsStorageAdapter {
    const adapter = this.byCompany.get(companyId);
    if (!adapter) {
      throw new Error(
        `no recruitment spreadsheet configured for company ${companyId} (set resources.googleSheets.hrRecruitmentSheetId)`,
      );
    }
    return adapter;
  }

  createInstance(s: Omit<ProcessState, "updatedAt" | "auditLogId">): Promise<ProcessState> {
    return this.pick(s.companyId).createInstance(s);
  }
  getInstance(companyId: string, processInstanceId: string): Promise<ProcessState | null> {
    return this.pick(companyId).getInstance(companyId, processInstanceId);
  }
  updateStatus(
    companyId: string,
    processInstanceId: string,
    patch: Parameters<StorageAdapter["updateStatus"]>[2],
  ): Promise<ProcessState> {
    return this.pick(companyId).updateStatus(companyId, processInstanceId, patch);
  }
  appendAudit(e: AuditEvent): Promise<void> {
    return this.pick(e.companyId).appendAudit(e);
  }
}

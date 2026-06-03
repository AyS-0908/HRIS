// Storage factory (mirrors connectors/index.ts). Selects the StorageAdapter backend
// at the composition root; the runtime only ever sees the StorageAdapter interface.
// SPEC §4.2 / §15.11 — swappable without core edits.
import type { Logger, StorageAdapter } from "../shared/types/contracts.js";
import { InMemoryStorageAdapter } from "./inMemoryAdapter.js";
import { SheetsStorageAdapter } from "./sheetsStorageAdapter.js";

export interface StorageOptions {
  backend: "memory" | "sheets";
  serviceAccountJson?: string;
  // For the sheets backend: reuses the company's recruitment spreadsheet (its
  // proc_state / proc_audit tabs). See SPEC §6 resources.googleSheets.
  sheetId?: string;
}

export function buildStorage(logger: Logger, options: StorageOptions): StorageAdapter {
  if (options.backend === "sheets") {
    if (!options.serviceAccountJson) {
      throw new Error(
        "STORAGE_BACKEND=sheets requires a service account (set GOOGLE_SERVICE_ACCOUNT_JSON_FILE or GOOGLE_SERVICE_ACCOUNT_JSON)",
      );
    }
    if (!options.sheetId) {
      throw new Error(
        "STORAGE_BACKEND=sheets requires a spreadsheet id (set resources.googleSheets.hrRecruitmentSheetId in the company config)",
      );
    }
    return new SheetsStorageAdapter(logger, options.serviceAccountJson, options.sheetId);
  }
  return new InMemoryStorageAdapter();
}

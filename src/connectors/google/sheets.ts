// Provider-neutral Sheets connector. V1 = simulated skeleton (SPEC §8). The real
// Sheets adapter (also the deferred storage reference impl) is wired when creds exist.
import { createHash } from "node:crypto";
import type { HealthResult, Logger, SheetsConnector } from "../../shared/types/contracts.js";

export function createSheetsConnector(logger: Logger): SheetsConnector {
  return {
    name: "google.sheets",
    async healthCheck(): Promise<HealthResult> {
      return { ok: true, detail: "simulated (V1 skeleton)" };
    },
    async appendRow(input, idempotencyKey) {
      const rowId =
        "row_" + createHash("sha256").update(`${input.sheetId}:${input.tab}:${idempotencyKey}`).digest("hex").slice(0, 16);
      logger.info("connector.sheets.appendRow (simulated)", {
        rowId,
        sheetId: input.sheetId,
        tab: input.tab,
      });
      return { rowId };
    },
    async getValues(input) {
      // Simulated: no Config tab exists ⇒ empty ⇒ callers fall back to default policy.
      logger.info("connector.sheets.getValues (simulated)", { sheetId: input.sheetId, range: input.range });
      return { values: [] };
    },
  };
}

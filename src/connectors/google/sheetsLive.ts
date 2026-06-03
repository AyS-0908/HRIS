// Live Sheets connector (service-account auth). Activated when GOOGLE_CONNECTORS=live.
// Writes real rows via the Sheets API. The service account must have edit access to
// the target spreadsheet (share the sheet with the SA's client_email).
import type { HealthResult, Logger, SheetsConnector } from "../../shared/types/contracts.js";
import { createSheetsJwt } from "./auth.js";

export function createSheetsConnectorLive(logger: Logger, serviceAccountJson: string): SheetsConnector {
  const { client, clientEmail } = createSheetsJwt(serviceAccountJson);

  return {
    name: "google.sheets",
    async healthCheck(): Promise<HealthResult> {
      try {
        await client.authorize();
        return { ok: true, detail: `live as ${clientEmail}` };
      } catch (e) {
        return { ok: false, detail: `auth failed: ${String(e)}` };
      }
    },
    async appendRow(input, idempotencyKey) {
      // Note: a Sheets append is not natively idempotent; process-level dedup is
      // enforced by the runtime's idempotency store (idempotencyKey threaded here
      // for parity/logging with the simulated connector).
      const range = `${input.tab}!A1`;
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.sheetId)}` +
        `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const res = await client.request<{ updates?: { updatedRange?: string } }>({
        url,
        method: "POST",
        data: { values: [Object.values(input.values)] },
      });
      const rowId = res.data?.updates?.updatedRange ?? `${input.tab}!appended`;
      logger.info("connector.sheets.appendRow (live)", { rowId, sheetId: input.sheetId, tab: input.tab, idempotencyKey });
      return { rowId };
    },
  };
}

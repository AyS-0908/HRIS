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
      // Column order = the insertion order of input.values' keys. Callers (services) build
      // that object in the tab's documented header order (e.g. rec_jobDesc: id,titre,mgr,url,
      // status), and JS preserves string-key insertion order — so the row aligns with the
      // headers. Keep the service-side object literal in header order.
      const res = await client.request<{ updates?: { updatedRange?: string } }>({
        url,
        method: "POST",
        data: { values: [Object.values(input.values)] },
      });
      const rowId = res.data?.updates?.updatedRange ?? `${input.tab}!appended`;
      logger.info("connector.sheets.appendRow (live)", { rowId, sheetId: input.sheetId, tab: input.tab, idempotencyKey });
      return { rowId };
    },
    async getValues(input) {
      // A missing tab/range returns a 400 from the API; treat any read failure as "no
      // values" so the policy loader falls back to defaults (anti-regression).
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.sheetId)}` +
        `/values/${encodeURIComponent(input.range)}`;
      try {
        const res = await client.request<{ values?: string[][] }>({ url, method: "GET" });
        return { values: res.data?.values ?? [] };
      } catch (e) {
        logger.warn("connector.sheets.getValues (live) read failed; defaulting to empty", {
          sheetId: input.sheetId,
          range: input.range,
          err: String(e),
        });
        return { values: [] };
      }
    },
  };
}

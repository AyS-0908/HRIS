// Live Sheets connector (service-account auth). Activated when GOOGLE_CONNECTORS=live.
// Writes real rows via the Sheets API. The service account must have edit access to
// the target spreadsheet (share the sheet with the SA's client_email).
import { JWT } from "google-auth-library";
import type { HealthResult, Logger, SheetsConnector } from "../../shared/types/contracts.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export function createSheetsConnectorLive(logger: Logger, serviceAccountJson: string): SheetsConnector {
  let creds: ServiceAccount;
  try {
    creds = JSON.parse(serviceAccountJson) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing client_email/private_key");
  }
  const client = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });

  return {
    name: "google.sheets",
    async healthCheck(): Promise<HealthResult> {
      try {
        await client.authorize();
        return { ok: true, detail: `live as ${creds.client_email}` };
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

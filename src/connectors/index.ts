// Builds the connector registry (SPEC §8). Sheets can run live (service account)
// or simulated; the rest are simulated skeletons in V1.
import type { Connectors, Logger } from "../shared/types/contracts.js";
import { createDocsConnector } from "./google/docs.js";
import { createSheetsConnector } from "./google/sheets.js";
import { createSheetsConnectorLive } from "./google/sheetsLive.js";
import { createDriveConnector } from "./google/drive.js";
import { createHttpConnector } from "./generic/http.js";
import { createWebhookConnector } from "./generic/webhook.js";

export interface ConnectorOptions {
  googleMode: "simulated" | "live";
  serviceAccountJson?: string;
}

export function buildConnectors(logger: Logger, options: ConnectorOptions): Connectors {
  const liveSheets = options.googleMode === "live";
  if (liveSheets && !options.serviceAccountJson) {
    throw new Error("GOOGLE_CONNECTORS=live requires GOOGLE_SERVICE_ACCOUNT_JSON");
  }
  return {
    docs: createDocsConnector(logger), // simulated in V1
    sheets: liveSheets
      ? createSheetsConnectorLive(logger, options.serviceAccountJson!)
      : createSheetsConnector(logger),
    drive: createDriveConnector(logger), // simulated in V1
    http: createHttpConnector(logger),
    webhook: createWebhookConnector(logger),
  };
}

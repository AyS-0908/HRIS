// Builds the provider-neutral connector registry (SPEC §8).
import type { Connectors, Logger } from "../shared/types/contracts.js";
import { createDocsConnector } from "./google/docs.js";
import { createSheetsConnector } from "./google/sheets.js";
import { createDriveConnector } from "./google/drive.js";
import { createHttpConnector } from "./generic/http.js";
import { createWebhookConnector } from "./generic/webhook.js";

export function buildConnectors(logger: Logger): Connectors {
  return {
    docs: createDocsConnector(logger),
    sheets: createSheetsConnector(logger),
    drive: createDriveConnector(logger),
    http: createHttpConnector(logger),
    webhook: createWebhookConnector(logger),
  };
}

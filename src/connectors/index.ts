// Builds the connector registry (SPEC §8). Sheets can run live (service account)
// or simulated; the rest are simulated skeletons in V1.
import type { Connectors, Logger } from "../shared/types/contracts.js";
import { createDocsConnector } from "./google/docs.js";
import { createDocsConnectorLive } from "./google/docsLive.js";
import { createDocsDriveJwt, createDocsDriveOAuthClient } from "./google/auth.js";
import { createSheetsConnector } from "./google/sheets.js";
import { createSheetsConnectorLive } from "./google/sheetsLive.js";
import { createDriveConnector } from "./google/drive.js";
import { createGmailConnector } from "./google/gmail.js";
import { createFormsConnector } from "./google/forms.js";
import { createCalendarConnector } from "./google/calendar.js";
import { createHttpConnector } from "./generic/http.js";
import { createWebhookConnector } from "./generic/webhook.js";

export interface ConnectorOptions {
  googleMode: "simulated" | "live";
  serviceAccountJson?: string;
  // Per-company Docs template + shared Drive folder. When both are present in live mode,
  // the Docs connector runs live (real Google Doc); otherwise it stays simulated.
  docsTemplateId?: string;
  docsFolderId?: string;
  // Optional OAuth user-delegation for Docs/Drive (all three required to activate). When
  // set, the live Docs connector acts as the consenting user (real Doc owned by them) —
  // needed on personal Gmail. Absent ⇒ Docs uses the service account (Shared Drive path).
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRefreshToken?: string;
}

export function buildConnectors(logger: Logger, options: ConnectorOptions): Connectors {
  const liveSheets = options.googleMode === "live";
  if (liveSheets && !options.serviceAccountJson) {
    throw new Error(
      "GOOGLE_CONNECTORS=live requires a service account (set GOOGLE_SERVICE_ACCOUNT_JSON_FILE or GOOGLE_SERVICE_ACCOUNT_JSON)",
    );
  }
  // Docs goes live only when a template + folder are configured. Absent ⇒ simulated,
  // so a live deployment without Docs config keeps the current (simulated) behavior.
  const liveDocs = liveSheets && !!options.docsTemplateId && !!options.docsFolderId;
  const docsAuth = liveDocs ? resolveDocsAuth(options) : null;
  return {
    docs: liveDocs
      ? createDocsConnectorLive(
          logger,
          docsAuth!.client,
          { templateId: options.docsTemplateId!, folderId: options.docsFolderId! },
          docsAuth!.detail,
        )
      : createDocsConnector(logger), // simulated default
    sheets: liveSheets
      ? createSheetsConnectorLive(logger, options.serviceAccountJson!)
      : createSheetsConnector(logger),
    drive: createDriveConnector(logger), // simulated in V1
    gmail: createGmailConnector(logger), // simulated in V1
    forms: createFormsConnector(logger), // simulated in V1
    calendar: createCalendarConnector(logger), // simulated in V1
    http: createHttpConnector(logger),
    webhook: createWebhookConnector(logger),
  };
}

// Picks the Docs/Drive auth mode: OAuth user-delegation when all three OAuth values are
// present (real Doc owned by the user — works on personal Gmail), else the service account
// (Shared Drive path, the default). Both yield an OAuth2Client the connector can use.
function resolveDocsAuth(options: ConnectorOptions) {
  if (options.oauthClientId && options.oauthClientSecret && options.oauthRefreshToken) {
    return createDocsDriveOAuthClient({
      clientId: options.oauthClientId,
      clientSecret: options.oauthClientSecret,
      refreshToken: options.oauthRefreshToken,
    });
  }
  return createDocsDriveJwt(options.serviceAccountJson!);
}

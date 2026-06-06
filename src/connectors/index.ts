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
import { createGmailConnectorLive } from "./google/gmailLive.js";
import { createFormsConnector } from "./google/forms.js";
import { createCalendarConnector } from "./google/calendar.js";
import { createHttpConnector } from "./generic/http.js";
import { createWebhookConnector } from "./generic/webhook.js";

export interface ConnectorOptions {
  googleMode: "simulated" | "live";
  serviceAccountJson?: string;
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
  // In live mode the Docs connector is always live; the per-company template + folder are
  // supplied per call (P2.3 multi-tenant). A company that has not configured Docs fails loud
  // in the service guard (plan P0.3) — never a silent simulated URL.
  const liveDocs = liveSheets;
  // Build the OAuth user-delegation client ONCE — Docs and Gmail both act AS THE SAME
  // consenting user, so a single client means one token cache (fewer refresh round-trips)
  // and one wiring site to keep in sync. Live Gmail requires this client (a service account
  // cannot send without domain-wide delegation); Docs uses it when present, else the service
  // account (Shared Drive path). The refresh token must carry the gmail.send scope
  // (GMAIL_SEND_SCOPE) for the Gmail path — see scripts/get-oauth-token.mjs.
  const hasOAuth = !!(options.oauthClientId && options.oauthClientSecret && options.oauthRefreshToken);
  const oauthAuth = hasOAuth
    ? createDocsDriveOAuthClient({
        clientId: options.oauthClientId!,
        clientSecret: options.oauthClientSecret!,
        refreshToken: options.oauthRefreshToken!,
      })
    : null;
  const docsAuth = liveDocs ? (oauthAuth ?? createDocsDriveJwt(options.serviceAccountJson!)) : null;
  const liveGmail = liveSheets && hasOAuth;
  return {
    docs: liveDocs
      ? createDocsConnectorLive(logger, docsAuth!.client, docsAuth!.detail)
      : createDocsConnector(logger), // simulated default
    sheets: liveSheets
      ? createSheetsConnectorLive(logger, options.serviceAccountJson!)
      : createSheetsConnector(logger),
    drive: createDriveConnector(logger), // simulated in V1
    gmail: liveGmail
      ? createGmailConnectorLive(logger, oauthAuth!.client)
      : createGmailConnector(logger), // simulated default (no OAuth creds)
    forms: createFormsConnector(logger), // simulated in V1
    calendar: createCalendarConnector(logger), // simulated in V1
    http: createHttpConnector(logger),
    webhook: createWebhookConnector(logger),
  };
}

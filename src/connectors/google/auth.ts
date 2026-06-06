// Shared service-account auth for Google Sheets. Used by both the live Sheets
// connector (module side effects) and the Sheets StorageAdapter (process state).
// Single source of truth for credential parsing + JWT construction.
import { readFileSync } from "node:fs";
import { JWT, OAuth2Client } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
// Docs connector (live): create/copy a doc in a shared Drive folder and inject content.
// `documents` for batchUpdate, `drive` for files.copy into the target folder.
const DOCS_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
];
// Gmail connector (live): send mail AS the consenting user. This scope must be part of the
// OAuth refresh token's original consent (see scripts/get-oauth-token.mjs). A service account
// cannot send Gmail without domain-wide delegation, so live Gmail = OAuth user-delegation only.
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

// Single source of truth for reading the service-account JSON from the environment: prefer a
// file path (GOOGLE_SERVICE_ACCOUNT_JSON_FILE) because the multi-line private_key cannot be
// parsed inline by `node --env-file`; fall back to inline GOOGLE_SERVICE_ACCOUNT_JSON. Returns
// undefined when neither is set (callers decide whether that is fatal). Used by app.ts and the
// setup-company-sheet script.
export function resolveServiceAccountJsonFromEnv(): string | undefined {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_FILE;
  if (file && file.trim()) return readFileSync(file.trim(), "utf8");
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return inline && inline.trim() ? inline : undefined;
}

function parseServiceAccount(serviceAccountJson: string): ServiceAccount {
  let creds: ServiceAccount;
  try {
    creds = JSON.parse(serviceAccountJson) as ServiceAccount;
  } catch {
    throw new Error("service account JSON is not valid JSON");
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error("service account JSON missing client_email/private_key");
  }
  return creds;
}

// Parses/validates a service-account JSON string and returns an authorized JWT
// client (scoped to spreadsheets) plus the client_email for health reporting.
export function createSheetsJwt(serviceAccountJson: string): { client: JWT; clientEmail: string } {
  const creds = parseServiceAccount(serviceAccountJson);
  const client = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
  return { client, clientEmail: creds.client_email };
}

// Authorized client for the live Docs connector + a label for health reporting. Both auth
// modes resolve to an OAuth2Client (JWT extends OAuth2Client), so the connector is
// auth-mode agnostic — it only uses client.request()/getAccessToken().
export interface DocsDriveAuth {
  client: OAuth2Client;
  detail: string;
}

// Mode 1 (default): service account, scoped to Docs + Drive (additive — does not touch
// createSheetsJwt). The created/copied file is OWNED BY THE SERVICE ACCOUNT, which has no
// Drive quota on a regular folder — so this mode requires a Shared Drive (Google Workspace).
export function createDocsDriveJwt(serviceAccountJson: string): DocsDriveAuth {
  const creds = parseServiceAccount(serviceAccountJson);
  const client = new JWT({ email: creds.client_email, key: creds.private_key, scopes: DOCS_DRIVE_SCOPES });
  return { client, detail: `service account ${creds.client_email}` };
}

// Mode 2 (opt-in): OAuth user-delegation. The connector acts AS THE CONSENTING USER, so the
// copied doc is owned by that user (their personal Drive quota) — this is what makes real
// Doc creation work on a personal Gmail account, where service accounts cannot own files.
// Scopes come from the refresh token's original consent (see scripts/get-oauth-token.mjs).
export function createDocsDriveOAuthClient(creds: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): DocsDriveAuth {
  const client = new OAuth2Client({ clientId: creds.clientId, clientSecret: creds.clientSecret });
  client.setCredentials({ refresh_token: creds.refreshToken });
  return { client, detail: "oauth user-delegation" };
}

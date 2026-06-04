// Shared service-account auth for Google Sheets. Used by both the live Sheets
// connector (module side effects) and the Sheets StorageAdapter (process state).
// Single source of truth for credential parsing + JWT construction.
import { JWT } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
// Docs connector (live): create/copy a doc in a shared Drive folder and inject content.
// `documents` for batchUpdate, `drive` for files.copy into the target folder.
const DOCS_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
];

interface ServiceAccount {
  client_email: string;
  private_key: string;
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

// Same credentials, scoped to Docs + Drive (additive — does not touch createSheetsJwt).
// Used by the live Docs connector to copy a template into a shared folder and inject text.
export function createDocsDriveJwt(serviceAccountJson: string): { client: JWT; clientEmail: string } {
  const creds = parseServiceAccount(serviceAccountJson);
  const client = new JWT({ email: creds.client_email, key: creds.private_key, scopes: DOCS_DRIVE_SCOPES });
  return { client, clientEmail: creds.client_email };
}

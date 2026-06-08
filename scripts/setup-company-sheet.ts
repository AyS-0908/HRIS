// Creates/validates the tabs a company's tracking Sheet needs, with the documented header
// rows, using the service-account auth (plan 1bis §2). Idempotent and non-destructive:
// missing tabs are added; an existing tab with data is left intact (headers only written to
// an empty/just-created tab; a mismatch is warned, never overwritten).
//
// Tabs:
//   - rec_jobDesc : id | titre | mgr | url | status                                  (always)
//   - Config      : key | value  (+ default policy rows)                              (always)
//   - Users       : email | role | mcpKeyHash | mcpKeyStatus | mcpKeyCreatedAt        (always)
//   - proc_state / proc_audit                                                         (only with --storage sheets)
//
// Usage:
//   GOOGLE_SERVICE_ACCOUNT_JSON_FILE=./sa.json \
//   npm run setup-company-sheet -- --sheet <spreadsheetId> [--storage sheets]
//   npm run setup-company-sheet -- --company config/company.acme.yaml [--storage sheets]
import type { JWT } from "google-auth-library";
import { createSheetsJwt, resolveServiceAccountJsonFromEnv } from "../src/connectors/google/auth.js";
import { SHEETS_STORAGE_HEADERS } from "../src/storage/sheetsStorageAdapter.js";
import { loadCompanyConfig } from "../src/core/config/loadCompany.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function resolveServiceAccountJson(): string {
  const json = resolveServiceAccountJsonFromEnv();
  if (!json) throw new Error("set GOOGLE_SERVICE_ACCOUNT_JSON_FILE or GOOGLE_SERVICE_ACCOUNT_JSON");
  return json;
}

function resolveSheetId(): string {
  const direct = arg("sheet");
  if (direct) return direct;
  const companyPath = arg("company");
  if (companyPath) {
    const id = loadCompanyConfig(companyPath).resources.googleSheets?.hrRecruitmentSheetId;
    if (id) return id;
    throw new Error(`no resources.googleSheets.hrRecruitmentSheetId in ${companyPath}`);
  }
  throw new Error("provide --sheet <spreadsheetId> or --company <config.yaml>");
}

// tab title → header row + optional seed rows (written only to a fresh/empty tab).
function requiredTabs(withStorage: boolean): Record<string, { headers: string[]; seed?: string[][] }> {
  const tabs: Record<string, { headers: string[]; seed?: string[][] }> = {
    rec_jobDesc: { headers: ["id", "titre", "mgr", "url", "status"] },
    Config: {
      headers: ["key", "value"],
      seed: [
        ["requireJustification", "false"],
        ["requireProofDoc", "false"],
        ["extraValidationStep", "false"],
        ["requireStructuredSections", "false"],
        ["hrNotifyEmail", ""],
      ],
    },
    // RH-editable identity (D2): maps a person (email/id = x-actor-id) to a company role.
    // The server reads this to make the Sheet role authoritative over the advisory header.
    // role hr_admin rows also serve as HR notification recipients at approve (D1, fallback
    // to the Config key hrNotifyEmail when empty). The mcpKey* columns hold a per-actor beta
    // token (sha256 hash | active|revoked | ISO timestamp) managed by `npm run add-actor-key
    // -- --store users-sheet` — adding/revoking a tester needs no restart or Coolify edit.
    Users: { headers: ["email", "role", "mcpKeyHash", "mcpKeyStatus", "mcpKeyCreatedAt"] },
  };
  if (withStorage) {
    tabs.proc_state = { headers: [...SHEETS_STORAGE_HEADERS.proc_state] };
    tabs.proc_audit = { headers: [...SHEETS_STORAGE_HEADERS.proc_audit] };
  }
  return tabs;
}

async function getExistingTabTitles(client: JWT, sheetId: string): Promise<Set<string>> {
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}?fields=sheets.properties.title`;
  const res = await client.request<{ sheets?: { properties?: { title?: string } }[] }>({ url, method: "GET" });
  const titles = new Set<string>();
  for (const s of res.data.sheets ?? []) {
    if (s.properties?.title) titles.add(s.properties.title);
  }
  return titles;
}

async function addTab(client: JWT, sheetId: string, title: string): Promise<void> {
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}:batchUpdate`;
  await client.request({
    url,
    method: "POST",
    data: { requests: [{ addSheet: { properties: { title } } }] },
  });
}

async function getRow1(client: JWT, sheetId: string, tab: string): Promise<string[]> {
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${tab}!1:1`)}`;
  const res = await client.request<{ values?: string[][] }>({ url, method: "GET" });
  return res.data.values?.[0] ?? [];
}

async function writeRows(client: JWT, sheetId: string, tab: string, rows: string[][]): Promise<void> {
  const range = `${tab}!A1`;
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  await client.request({ url, method: "PUT", data: { values: rows } });
}

async function main(): Promise<void> {
  const withStorage = arg("storage") === "sheets";
  const sheetId = resolveSheetId();
  const { client, clientEmail } = createSheetsJwt(resolveServiceAccountJson());
  console.log(`setup-company-sheet: sheet ${sheetId} as ${clientEmail} (storage=${withStorage ? "sheets" : "memory"})`);

  const existing = await getExistingTabTitles(client, sheetId);
  const tabs = requiredTabs(withStorage);

  for (const [title, spec] of Object.entries(tabs)) {
    const isNew = !existing.has(title);
    if (isNew) {
      await addTab(client, sheetId, title);
      console.log(`  + created tab "${title}"`);
    }
    const current = isNew ? [] : await getRow1(client, sheetId, title);
    if (current.length === 0) {
      const rows = spec.seed ? [spec.headers, ...spec.seed] : [spec.headers];
      await writeRows(client, sheetId, title, rows);
      console.log(`  ✓ wrote headers${spec.seed ? " + defaults" : ""} to "${title}"`);
    } else {
      const matches =
        current.length >= spec.headers.length && spec.headers.every((h, i) => current[i] === h);
      console.log(matches ? `  = "${title}" headers OK` : `  ! "${title}" headers differ — left intact: ${JSON.stringify(current)}`);
    }
  }
  console.log("done.");
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});

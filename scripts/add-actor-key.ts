// Mints / revokes a per-actor MCP token for the claude.ai WEB connector path. Two storage modes:
//
//   --store config       (default) appends the token hash to the company YAML's auth.actorKeys.
//                        Requires a server restart to load. Kept for back-compat.
//   --store users-sheet  writes the token hash/status/timestamp to the company's `Users` tab
//                        (mcpKeyHash | mcpKeyStatus | mcpKeyCreatedAt). NO Coolify edit, NO YAML
//                        edit, NO restart: the server reads the Users tab live (cached 60 s), so
//                        an added/revoked tester takes effect within ~1 minute.
//
// claude.ai web cannot send custom per-person headers, so the token itself carries the identity:
// it resolves to { companyId, actorId, role }. The raw token is shown ONCE; only its sha256 hash
// is stored (never in config, Sheet, logs, or Coolify). The actor's role comes from Users.role.
//
// Usage:
//   # config (YAML) mode — existing behavior
//   npm run add-actor-key -- --company config/company.acme.yaml --actor marie@acme.com [--role manager] [--key <raw>]
//
//   # Users-tab mode — operator adds/keeps the tester's row (email|role) first, then:
//   npm run add-actor-key -- --company config/company.acme.yaml --actor friend@example.com --store users-sheet
//   npm run add-actor-key -- --company config/company.acme.yaml --actor friend@example.com --store users-sheet --revoke
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { JWT } from "google-auth-library";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { companyConfigSchema, type CompanyConfig } from "../src/core/config/schema.js";
import { loadCompanyConfig } from "../src/core/config/loadCompany.js";
import { hashApiKey } from "../src/core/auth/apiKey.js";
import { createSheetsJwt, resolveServiceAccountJsonFromEnv } from "../src/connectors/google/auth.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const USERS_RANGE = "Users!A1:E"; // email | role | mcpKeyHash | mcpKeyStatus | mcpKeyCreatedAt

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// Generates a raw per-actor token. Only its sha256 hash is ever stored.
function mintRawKey(companyId: string, actorId: string): string {
  return `hris_${companyId}_${actorId.split("@")[0]}_${randomBytes(18).toString("base64url")}`;
}

function printToken(rawKey: string): void {
  console.log("\n=== claude.ai WEB token (shown once — give it to this person) ===");
  console.log(`  ${rawKey}`);
  console.log("Paste it as the connector's bearer token (Authorization: Bearer <token>).");
  console.log("Only its sha256 hash is stored; the raw token cannot be recovered.\n");
}

// ── Mode 1: config (YAML) — appends to auth.actorKeys (existing behavior) ────────────────────
function runConfigMode(companyPath: string, actorId: string): void {
  if (flag("revoke")) {
    fail("--revoke is only supported with --store users-sheet (config mode: remove the actorKeys entry by hand).");
  }
  const raw = parseYaml(readFileSync(companyPath, "utf8")) as Record<string, unknown>;
  const parsed = companyConfigSchema.safeParse(raw);
  if (!parsed.success) {
    fail(`invalid company config at ${companyPath}: ${JSON.stringify(parsed.error.flatten(), null, 2)}`);
  }
  const cfg = parsed.data;

  // Role is optional (else resolved from the Users tab, D2); if given it must be a valid role.
  const role = arg("role");
  if (role && !cfg.company.roles.includes(role)) {
    fail(`role "${role}" is not one of the company roles: ${cfg.company.roles.join(", ")}`);
  }

  const rawKey = arg("key") ?? mintRawKey(cfg.company.id, actorId);
  const entry = { keyHash: hashApiKey(rawKey), actorId, ...(role ? { role } : {}) };

  const auth = (cfg.auth ?? {}) as NonNullable<typeof cfg.auth>;
  const actorKeys = [...(auth.actorKeys ?? [])];
  const existing = actorKeys.findIndex((k) => k.actorId === actorId);
  if (existing >= 0) actorKeys[existing] = entry; // re-issue: replace this actor's key
  else actorKeys.push(entry);
  const next = { ...cfg, auth: { ...auth, actorKeys } };

  // Re-validate the whole config before writing — a bad edit fails here, not at server boot.
  const revalidated = companyConfigSchema.safeParse(next);
  if (!revalidated.success) {
    fail(`internal: produced an invalid config: ${JSON.stringify(revalidated.error.flatten(), null, 2)}`);
  }

  writeFileSync(companyPath, toYaml(revalidated.data));
  console.log(`updated ${companyPath}: actorKeys for ${actorId}${role ? ` (role ${role})` : ""}`);
  if (!arg("key")) printToken(rawKey);
  console.log("next: restart the server so the new key loads.");
}

// ── Mode 2: users-sheet — writes mcpKeyHash/Status/CreatedAt to the Users tab ────────────────
function resolveSheetId(cfg: CompanyConfig, companyPath: string): string {
  const id = cfg.resources.googleSheets?.hrRecruitmentSheetId;
  if (!id) fail(`no resources.googleSheets.hrRecruitmentSheetId in ${companyPath}`);
  return id;
}

async function readUsers(client: JWT, sheetId: string): Promise<string[][]> {
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(USERS_RANGE)}`;
  const res = await client.request<{ values?: string[][] }>({ url, method: "GET" });
  return res.data.values ?? [];
}

// Locates the 1-based sheet row for an actor (case-insensitive email match), skipping the header.
function findActorRow(values: string[][], actorId: string): number {
  const target = actorId.trim().toLowerCase();
  for (let i = 0; i < values.length; i++) {
    const email = (values[i]?.[0] ?? "").trim().toLowerCase();
    if (i === 0 && email === "email") continue; // header row
    if (email === target) return i + 1; // sheet rows are 1-based
  }
  return -1;
}

async function writeUsersCells(client: JWT, sheetId: string, range: string, row: string[]): Promise<void> {
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  await client.request({ url, method: "PUT", data: { values: [row] } });
}

async function runUsersSheetMode(companyPath: string, actorId: string): Promise<void> {
  const cfg = loadCompanyConfig(companyPath);
  const sheetId = resolveSheetId(cfg, companyPath);
  const saJson = resolveServiceAccountJsonFromEnv();
  if (!saJson) fail("set GOOGLE_SERVICE_ACCOUNT_JSON_FILE or GOOGLE_SERVICE_ACCOUNT_JSON to reach the Users tab.");
  const { client, clientEmail } = createSheetsJwt(saJson);

  const values = await readUsers(client, sheetId);
  const sheetRow = findActorRow(values, actorId);
  if (sheetRow < 0) {
    fail(
      `actor "${actorId}" has no row in the Users tab of ${sheetId}.\n` +
        `Add a row (email | role) for this tester first, then re-run.`,
    );
  }

  if (flag("revoke")) {
    // Revoke: flip mcpKeyStatus (col D) to "revoked"; leave the hash/timestamp as an audit trail.
    await writeUsersCells(client, sheetId, `Users!D${sheetRow}`, ["revoked"]);
    console.log(`revoked Users-tab token for ${actorId} (sheet ${sheetId}, row ${sheetRow}, as ${clientEmail}).`);
    console.log("takes effect within the server's 60 s Users-tab cache — no restart, no Coolify edit.");
    return;
  }

  // Issue/re-issue: write mcpKeyHash | mcpKeyStatus=active | mcpKeyCreatedAt (cols C:E).
  const rawKey = arg("key") ?? mintRawKey(cfg.company.id, actorId);
  await writeUsersCells(client, sheetId, `Users!C${sheetRow}:E${sheetRow}`, [
    hashApiKey(rawKey),
    "active",
    new Date().toISOString(),
  ]);
  console.log(`activated Users-tab token for ${actorId} (sheet ${sheetId}, row ${sheetRow}, as ${clientEmail}).`);
  if (!arg("key")) printToken(rawKey);
  console.log("takes effect within the server's 60 s Users-tab cache — no restart, no Coolify edit.");
}

async function main(): Promise<void> {
  const companyPath = arg("company");
  const actorId = arg("actor");
  if (!companyPath || !actorId) {
    fail(
      "usage: add-actor-key --company <path.yaml> --actor <email> " +
        "[--role <role>] [--key <raw>] [--store config|users-sheet] [--revoke]",
    );
  }

  const store = arg("store") ?? "config";
  if (store === "users-sheet") {
    await runUsersSheetMode(companyPath, actorId);
  } else if (store === "config") {
    runConfigMode(companyPath, actorId);
  } else {
    fail(`unknown --store "${store}" (expected: config | users-sheet).`);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});

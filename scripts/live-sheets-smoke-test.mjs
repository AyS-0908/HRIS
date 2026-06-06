import fs from "node:fs";
import { JWT } from "google-auth-library";
import { buildApp } from "../dist/app.js";

function loadEnv(path) {
  const env = {};
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (key === "GOOGLE_SERVICE_ACCOUNT_JSON" && value.startsWith("{")) {
      let candidate = value;
      for (let j = i; j < lines.length; j++) {
        try {
          JSON.parse(candidate);
          value = candidate;
          i = j;
          break;
        } catch {
          if (j + 1 >= lines.length) break;
          candidate += `\n${lines[j + 1]}`;
        }
      }
    }

    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
    process.env[key] = value;
  }
  return env;
}

const env = loadEnv(".env");
if (env.GOOGLE_CONNECTORS !== "live") throw new Error("GOOGLE_CONNECTORS is not live");
// Accept either inline JSON or a file path (mirrors resolveServiceAccountJson in app.ts).
let resolvedServiceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!resolvedServiceAccountJson && env.GOOGLE_SERVICE_ACCOUNT_JSON_FILE) {
  resolvedServiceAccountJson = fs.readFileSync(env.GOOGLE_SERVICE_ACCOUNT_JSON_FILE.trim(), "utf8");
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = resolvedServiceAccountJson;
}
if (!resolvedServiceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_FILE is empty");

const serviceAccount = JSON.parse(resolvedServiceAccountJson);
const app = buildApp({
  companyConfigPath: env.COMPANY_CONFIG_PATH ?? "config/company.example.yaml",
  logLevel: "error",
  googleConnectors: "live",
  storageBackend: env.STORAGE_BACKEND === "sheets" ? "sheets" : "memory",
  serviceAccountJson: resolvedServiceAccountJson,
  // OAuth user-delegation for Docs/Drive (personal Gmail: the Doc is owned by the user).
  // Without these the Docs connector falls back to the service account and fails on quota.
  oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID || undefined,
  oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET || undefined,
  oauthRefreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN || undefined,
});

const resolve = (name) => {
  const resolved = app.tools.resolve(name);
  if (!resolved) throw new Error(`tool not found: ${name}`);
  return resolved;
};

const ctx = {
  companyId: "acme",
  actorId: "u-live-smoke",
  actorRole: "manager",
  apiKeyId: "live-smoke",
};

const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const title = `Live Smoke ${suffix}`;

const submit = await app.runtime.execute(resolve("submit_job_request"), ctx, {
  title,
  justification: "Live Google Sheets verification",
  plannedHire: true,
});
if (submit.status !== "success") throw new Error(`submit failed: ${JSON.stringify(submit.data)}`);

const processInstanceId = submit.data.processInstanceId;
const generate = await app.runtime.execute(resolve("generate_job_description"), ctx, {
  processInstanceId,
  idempotencyKey: `live-gen-${suffix}`,
  targetSummary: "Verify live Google Sheets connector",
});
if (generate.status !== "success") throw new Error(`generate failed: ${JSON.stringify(generate.data)}`);

// Omit docUrl — the trusted URL written by generate_job_description flows from process state.
const approve = await app.runtime.execute(resolve("approve_job_description"), ctx, {
  processInstanceId,
  idempotencyKey: `live-approve-${suffix}`,
  jobTitle: title,
});
if (approve.status !== "success") throw new Error(`approve failed: ${JSON.stringify(approve.data)}`);

const sheetId = app.companies.get("acme").resources.googleSheets.hrRecruitmentSheetId;
const rowRange = approve.data.rowId;
const auth = new JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const read = await auth.request({
  url:
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
    `/values/${encodeURIComponent(rowRange)}`,
  method: "GET",
});
const row = read.data.values?.[0] ?? [];
const expected = [processInstanceId, title, ctx.actorId, generate.data.url, "approved"];
const rowMatches = expected.every((value, index) => row[index] === value);
if (!rowMatches) {
  throw new Error(`row mismatch at ${rowRange}`);
}

// Confirm get_recruitment_policy returns the Config-tab policy.
const policyResult = await app.runtime.execute(resolve("get_recruitment_policy"), ctx, {});
if (policyResult.status !== "success") throw new Error(`get_recruitment_policy failed: ${JSON.stringify(policyResult.data)}`);

console.log(JSON.stringify({
  ok: true,
  processInstanceId,
  docId: generate.data.docId,
  docUrl: generate.data.url,
  rowRange,
  rowMatches,
  policy: policyResult.data.policy,
}));

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
if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is empty");

const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
const app = buildApp({
  apiKey: env.API_KEY ?? "dev-local-key",
  companyConfigPath: env.COMPANY_CONFIG_PATH ?? "config/company.example.yaml",
  logLevel: "error",
  googleConnectors: "live",
  serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
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

const approve = await app.runtime.execute(resolve("approve_job_description"), ctx, {
  processInstanceId,
  idempotencyKey: `live-approve-${suffix}`,
  jobTitle: title,
  docUrl: generate.data.url,
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

console.log(JSON.stringify({
  ok: true,
  processInstanceId,
  rowRange,
  rowMatches,
}));

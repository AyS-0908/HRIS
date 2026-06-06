// Mints a per-actor API key for the claude.ai WEB connector path and appends it to a company
// config's auth.actorKeys (SPEC §2). claude.ai web cannot send custom per-person headers, so the
// token itself carries the identity: the key resolves to { companyId, actorId, role }. The raw
// key is shown ONCE; only its sha256 hash is stored. Core code is never edited (SPEC §0).
//
// Usage:
//   npm run add-actor-key -- --company config/company.acme.yaml --actor marie.dupont@acme.com \
//     [--role manager] [--key <raw>]
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { companyConfigSchema } from "../src/core/config/schema.js";
import { hashApiKey } from "../src/core/auth/apiKey.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const companyPath = arg("company");
const actorId = arg("actor");
if (!companyPath || !actorId) {
  console.error('usage: add-actor-key --company <path.yaml> --actor <email> [--role <role>] [--key <raw>]');
  process.exit(1);
}

const raw = parseYaml(readFileSync(companyPath, "utf8")) as Record<string, unknown>;
const parsed = companyConfigSchema.safeParse(raw);
if (!parsed.success) {
  console.error(`invalid company config at ${companyPath}:`, JSON.stringify(parsed.error.flatten(), null, 2));
  process.exit(1);
}
const cfg = parsed.data;

// Role is optional (else resolved from the Users tab, D2); if given it must be a valid role.
const role = arg("role");
if (role && !cfg.company.roles.includes(role)) {
  console.error(`role "${role}" is not one of the company roles: ${cfg.company.roles.join(", ")}`);
  process.exit(1);
}

const rawKey = arg("key") ?? `hris_${cfg.company.id}_${actorId.split("@")[0]}_${randomBytes(18).toString("base64url")}`;
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
  console.error("internal: produced an invalid config:", JSON.stringify(revalidated.error.flatten(), null, 2));
  process.exit(1);
}

writeFileSync(companyPath, toYaml(revalidated.data));
console.log(`updated ${companyPath}: actorKeys for ${actorId}${role ? ` (role ${role})` : ""}`);
if (!arg("key")) {
  console.log("\n=== claude.ai WEB token (shown once — give it to this person) ===");
  console.log(`  ${rawKey}`);
  console.log("Paste it as the connector's bearer token (Authorization: Bearer <token>).");
  console.log("Only its sha256 hash is stored; the raw token cannot be recovered.\n");
}
console.log("next: restart the server so the new key loads.");

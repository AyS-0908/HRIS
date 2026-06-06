// Per-company recruitment process policy (plan 1e). The company edits a "Config" tab in
// ITS OWN tracking Sheet (key/value rows); the MCP reads, validates, caches and ENFORCES
// it. The Skill only adapts its dialogue — enforcement lives here, in the module.
//
// Security guardrail: the `Config` tab governs the PROCESS only (which questions/proof docs
// are required, plus the HR notify address). Only the keys below are honored; any other key
// is ignored. Identity lives in a SEPARATE tab: the RH-editable `Users` tab (email | role)
// maps a person to a role (D2, see core/auth/resolveActorRole.ts). The closed set of VALID
// roles/permissions still comes from the server YAML and is never editable from the Sheet —
// the Sheet only maps a known person to one of those roles. Policy and identity stay in their
// own tabs.
//
// Anti-regression: a missing/empty/malformed Config tab ⇒ DEFAULT_POLICY (all off) ⇒ the
// current behavior is unchanged. Simulated Sheets returns [] ⇒ default.
import { z } from "zod";
import type { ServiceDeps } from "../../../shared/types/contracts.js";

export const recruitmentPolicySchema = z.object({
  // If true, the manager must supply a (non-empty) justification — submit already collects
  // one, so this is surfaced to the Skill to reinforce the ask rather than skip it.
  requireJustification: z.boolean().default(false),
  // If true, approve_job_description requires a proofDocUrl (enforced in the handler).
  requireProofDoc: z.boolean().default(false),
  // If true, the Skill should walk an extra human validation step (no extra MCP tool in
  // V1; informational for the dialogue — see Phase 2).
  extraValidationStep: z.boolean().default(false),
  // If true, generate_job_description requires the structured sections (mission,
  // responsibilities, profile, context) — enforced in the handler (plan P1.2). Off ⇒ the
  // legacy free-form draftBody is accepted (current behaviour).
  requireStructuredSections: z.boolean().default(false),
  // Fallback HR notification recipient used at approve (D1) when no `Users` row has role
  // hr_admin. Optional string (an email). Absent/blank ⇒ no fallback (Users tab is primary).
  hrNotifyEmail: z.string().email().optional(),
});

export type RecruitmentPolicy = z.infer<typeof recruitmentPolicySchema>;

export const DEFAULT_POLICY: RecruitmentPolicy = {
  requireJustification: false,
  requireProofDoc: false,
  extraValidationStep: false,
  requireStructuredSections: false,
};

// Only these keys are read from the Config tab. Everything else is ignored (guardrail).
const KNOWN_KEYS = new Set(Object.keys(recruitmentPolicySchema.shape));

const CONFIG_RANGE = "Config!A1:B";
const CACHE_TTL_MS = 60_000; // short cache: avoid an API read on every tool call.

interface CacheEntry {
  policy: RecruitmentPolicy;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

function parseBool(raw: string): boolean | undefined {
  const s = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off", ""].includes(s)) return false;
  return undefined;
}

// Maps Config rows ([key, value]) to a validated policy. Unknown keys are skipped.
function policyFromRows(values: string[][], logger: ServiceDeps["logger"]): RecruitmentPolicy {
  const raw: Record<string, unknown> = {};
  for (const row of values) {
    const key = (row[0] ?? "").trim();
    if (!KNOWN_KEYS.has(key)) continue; // guardrail: ignore unknown/security keys
    const rawVal = row[1] ?? "";
    if (key === "hrNotifyEmail") {
      const v = rawVal.trim();
      if (v) raw[key] = v; // blank ⇒ leave unset (stays optional/absent)
      continue;
    }
    const b = parseBool(rawVal);
    if (b !== undefined) raw[key] = b;
  }
  const parsed = recruitmentPolicySchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("recruitment policy malformed; using default", { issues: parsed.error.flatten() });
    return DEFAULT_POLICY;
  }
  return parsed.data;
}

// Resolves (and caches) the company's recruitment policy. Never throws: any read/parse
// failure falls back to DEFAULT_POLICY so the flow keeps working.
export async function resolveRecruitmentPolicy(deps: ServiceDeps): Promise<RecruitmentPolicy> {
  const companyId = deps.ctx.companyId;
  const hit = cache.get(companyId);
  if (hit && hit.expiresAt > Date.now()) return hit.policy;

  let policy = DEFAULT_POLICY;
  const sheetId = deps.resources.googleSheets?.hrRecruitmentSheetId;
  if (sheetId) {
    try {
      const { values } = await deps.connectors.sheets.getValues({ sheetId, range: CONFIG_RANGE });
      policy = policyFromRows(values, deps.logger);
    } catch (e) {
      deps.logger.warn("recruitment policy load failed; using default", { err: String(e) });
    }
  }
  cache.set(companyId, { policy, expiresAt: Date.now() + CACHE_TTL_MS });
  return policy;
}

// Test-only: drops the in-memory cache so a test can vary policy between cases.
export function __clearRecruitmentPolicyCache(): void {
  cache.clear();
}

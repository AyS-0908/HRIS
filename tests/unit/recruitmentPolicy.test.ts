// Unit tests for the per-company recruitment policy loader (plan 1e). Exercises the
// Config-tab parsing, the security guardrail (unknown keys ignored), malformed → default,
// and the short TTL cache — without needing a live Sheet.
import { describe, it, expect, beforeEach } from "vitest";
import type { ServiceDeps } from "../../src/shared/types/contracts.js";
import {
  resolveRecruitmentPolicy,
  __clearRecruitmentPolicyCache,
  DEFAULT_POLICY,
} from "../../src/modules/hr/recruitment/policy.js";

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

// Minimal ServiceDeps stub: resolveRecruitmentPolicy only reads ctx.companyId,
// resources.googleSheets.hrRecruitmentSheetId, connectors.sheets.getValues and logger.
function deps(companyId: string, values: string[][] | (() => Promise<{ values: string[][] }>)): ServiceDeps {
  const getValues =
    typeof values === "function"
      ? values
      : async () => ({ values });
  return {
    connectors: { sheets: { getValues } },
    logger: noopLogger,
    ctx: { companyId, actorId: "u1", actorRole: "manager", apiKeyId: "k" },
    resources: { googleSheets: { hrRecruitmentSheetId: "sheet-1" } },
  } as unknown as ServiceDeps;
}

beforeEach(() => __clearRecruitmentPolicyCache());

describe("resolveRecruitmentPolicy", () => {
  it("parses boolean values and honors known keys", async () => {
    const policy = await resolveRecruitmentPolicy(
      deps("acme", [
        ["key", "value"], // header row: 'key' is unknown → ignored
        ["requireProofDoc", "true"],
        ["requireJustification", "yes"],
        ["extraValidationStep", "0"],
      ]),
    );
    expect(policy).toEqual({
      requireJustification: true,
      requireProofDoc: true,
      extraValidationStep: false,
      requireStructuredSections: false,
    });
  });

  it("ignores unknown/security keys (guardrail)", async () => {
    const policy = await resolveRecruitmentPolicy(
      deps("acme2", [
        ["roles", "admin"], // would be a privilege escalation if honored
        ["allowedActors", "u9"],
        ["requireProofDoc", "true"],
      ]),
    );
    expect(policy.requireProofDoc).toBe(true);
    // No surface for the injected security keys exists on the policy object.
    expect(Object.keys(policy).sort()).toEqual([
      "extraValidationStep",
      "requireJustification",
      "requireProofDoc",
      "requireStructuredSections",
    ]);
  });

  it("returns the default policy for an empty Config tab", async () => {
    expect(await resolveRecruitmentPolicy(deps("acme3", []))).toEqual(DEFAULT_POLICY);
  });

  it("falls back to default when the read throws", async () => {
    const policy = await resolveRecruitmentPolicy(
      deps("acme4", async () => {
        throw new Error("boom");
      }),
    );
    expect(policy).toEqual(DEFAULT_POLICY);
  });

  it("caches per company (a second call does not re-read)", async () => {
    let reads = 0;
    const d = deps("acme5", async () => {
      reads++;
      return { values: [["requireProofDoc", "true"]] };
    });
    await resolveRecruitmentPolicy(d);
    await resolveRecruitmentPolicy(d);
    expect(reads).toBe(1);
  });
});

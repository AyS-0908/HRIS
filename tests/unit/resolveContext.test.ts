// Unit tests for resolveContext role resolution (D2). The Sheet role (roleOverride) is
// authoritative ONLY when it is a valid company role; a typo/stale token must fall back to
// the advisory x-actor-role header rather than lock the user out (anti-regression).
import { describe, it, expect } from "vitest";
import { resolveContext } from "../../src/core/auth/context.js";
import { CompanyRegistry } from "../../src/core/config/loadCompany.js";
import { AppError } from "../../src/core/errors/appError.js";

function registry(): CompanyRegistry {
  const reg = new CompanyRegistry();
  reg.add({
    company: { id: "acme", name: "Acme", enabledModules: ["hr.recruitment"], roles: ["hr_admin", "manager", "employee"] },
    resources: {},
  });
  return reg;
}

// companyId is now the authenticated tenant (from the API key), passed as the first arg; the
// headers carry only actorId/actorRole.
const headers = { actorId: "marie@acme.test", actorRole: "manager" };

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "<no-throw>";
  } catch (e) {
    return e instanceof AppError ? e.code : "<non-app-error>";
  }
}

describe("resolveContext role override", () => {
  it("uses a valid Sheet role over the header role", () => {
    const ctx = resolveContext("acme", headers, "key", registry(), "hr_admin");
    expect(ctx.actorRole).toBe("hr_admin");
    expect(ctx.companyId).toBe("acme");
  });

  it("falls back to the valid header role when the Sheet role is an invalid token", () => {
    // RH typo in the Users tab: 'rh' is not a company role; the valid header must still pass.
    const ctx = resolveContext("acme", headers, "key", registry(), "rh");
    expect(ctx.actorRole).toBe("manager");
  });

  it("uses the header role when no Sheet override is present (null)", () => {
    const ctx = resolveContext("acme", headers, "key", registry(), null);
    expect(ctx.actorRole).toBe("manager");
  });

  it("rejects only when neither the Sheet nor the header yields a valid role", () => {
    expect(codeOf(() => resolveContext("acme", { ...headers, actorRole: "bogus" }, "key", registry(), "rh"))).toBe("FORBIDDEN");
  });
});

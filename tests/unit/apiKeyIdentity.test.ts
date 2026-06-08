// Unit tests for per-company API key resolution (SPEC §2): a key authenticates AND binds the
// tenant, so it can act only as its own company; a wrong/missing key is UNAUTHENTICATED.
import { describe, it, expect } from "vitest";
import {
  resolveApiKeyIdentity,
  resolveApiKeyIdentityAsync,
  hashApiKey,
  type UsersTokenResolver,
} from "../../src/core/auth/apiKey.js";
import { CompanyRegistry } from "../../src/core/config/loadCompany.js";
import { AppError } from "../../src/core/errors/appError.js";

function registry(): CompanyRegistry {
  const reg = new CompanyRegistry();
  reg.add({
    company: { id: "acme", name: "Acme", enabledModules: ["hr.recruitment"], roles: ["manager"] },
    auth: { apiKeyHash: hashApiKey("acme-secret") },
    resources: {},
  });
  reg.add({
    company: { id: "globex", name: "Globex", enabledModules: ["hr.recruitment"], roles: ["manager"] },
    auth: {
      apiKeyHash: hashApiKey("globex-secret"),
      // Per-actor key (claude.ai web): the token binds the actor + role.
      actorKeys: [{ keyHash: hashApiKey("marie-token"), actorId: "marie@globex.test", role: "manager" }],
    },
    resources: {},
  });
  // A company with no key configured can never be authenticated into.
  reg.add({
    company: { id: "nokey", name: "NoKey", enabledModules: [], roles: ["manager"] },
    resources: {},
  });
  return reg;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "<no-throw>";
  } catch (e) {
    return e instanceof AppError ? e.code : "<non-app-error>";
  }
}

describe("resolveApiKeyIdentity", () => {
  it("binds each key to its own company", () => {
    expect(resolveApiKeyIdentity("acme-secret", registry()).companyId).toBe("acme");
    expect(resolveApiKeyIdentity("globex-secret", registry()).companyId).toBe("globex");
  });

  it("returns a stable, non-secret apiKeyId (never the raw key)", () => {
    const id = resolveApiKeyIdentity("acme-secret", registry()).apiKeyId;
    expect(id.startsWith("key_")).toBe(true);
    expect(id).not.toContain("acme-secret");
  });

  it("rejects an unknown key with UNAUTHENTICATED", () => {
    expect(codeOf(() => resolveApiKeyIdentity("wrong", registry()))).toBe("UNAUTHENTICATED");
  });

  it("rejects a missing key with UNAUTHENTICATED", () => {
    expect(codeOf(() => resolveApiKeyIdentity(undefined, registry()))).toBe("UNAUTHENTICATED");
  });

  it("never authenticates into a company that has no apiKeyHash", () => {
    // The empty/whatever key must not match the keyless company.
    expect(codeOf(() => resolveApiKeyIdentity("", registry()))).toBe("UNAUTHENTICATED");
  });

  it("a per-actor key binds the company AND the actor identity (claude.ai web)", () => {
    const id = resolveApiKeyIdentity("marie-token", registry());
    expect(id.companyId).toBe("globex");
    expect(id.actorId).toBe("marie@globex.test");
    expect(id.actorRole).toBe("manager");
  });

  it("a company-wide key carries no bound actor (identity comes from headers)", () => {
    const id = resolveApiKeyIdentity("globex-secret", registry());
    expect(id.companyId).toBe("globex");
    expect(id.actorId).toBeUndefined();
  });
});

describe("resolveApiKeyIdentityAsync (Users-tab beta tokens, SPEC auth_resolution_order)", () => {
  // Stubs the Sheet source: only "sheet-token" is an active Users-tab token (in globex).
  const usersToken: UsersTokenResolver = async (companyId, tokenHash) =>
    companyId === "globex" && tokenHash === hashApiKey("sheet-token")
      ? { actorId: "tester@globex.test", role: "manager" }
      : null;

  async function codeOfAsync(p: Promise<unknown>): Promise<string> {
    try {
      await p;
      return "<no-throw>";
    } catch (e) {
      return e instanceof AppError ? e.code : "<non-app-error>";
    }
  }

  it("resolves an ACTIVE Users-tab token to { companyId, actorId, role }", async () => {
    const id = await resolveApiKeyIdentityAsync("sheet-token", registry(), usersToken);
    expect(id.companyId).toBe("globex");
    expect(id.actorId).toBe("tester@globex.test");
    expect(id.actorRole).toBe("manager");
  });

  it("a config actor key still wins WITHOUT consulting the Sheet (no I/O on the common path)", async () => {
    let consulted = false;
    const spy: UsersTokenResolver = async (...a) => {
      consulted = true;
      return usersToken(...a);
    };
    const id = await resolveApiKeyIdentityAsync("marie-token", registry(), spy);
    expect(id.actorId).toBe("marie@globex.test");
    expect(consulted).toBe(false);
  });

  it("a company-wide config key still authenticates (no bound actor)", async () => {
    const id = await resolveApiKeyIdentityAsync("acme-secret", registry(), usersToken);
    expect(id.companyId).toBe("acme");
    expect(id.actorId).toBeUndefined();
  });

  it("a token with no active Users row is UNAUTHENTICATED (revoked/blank/unknown)", async () => {
    expect(await codeOfAsync(resolveApiKeyIdentityAsync("sheet-token", registry(), async () => null))).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("a missing token is UNAUTHENTICATED", async () => {
    expect(await codeOfAsync(resolveApiKeyIdentityAsync(undefined, registry(), usersToken))).toBe(
      "UNAUTHENTICATED",
    );
  });
});

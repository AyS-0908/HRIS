// Unit tests for the Sheet-based identity resolver (T3 / D2). Exercises the Users-tab hit,
// the header row skip, miss → null, absent/empty tab → null (fallback path), read failure →
// null (never throws), and the 60 s per-company cache — without a live Sheet.
import { describe, it, expect, beforeEach } from "vitest";
import type { SheetsConnector } from "../../src/shared/types/contracts.js";
import {
  resolveActorRole,
  resolveActorByToken,
  __clearActorRoleCache,
} from "../../src/core/auth/resolveActorRole.js";
import { hashApiKey } from "../../src/core/auth/apiKey.js";

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

function sheets(
  values: string[][] | (() => Promise<{ values: string[][] }>),
): Pick<SheetsConnector, "getValues"> {
  return {
    getValues: typeof values === "function" ? values : async () => ({ values }),
  };
}

beforeEach(() => __clearActorRoleCache());

describe("resolveActorRole", () => {
  it("returns the Sheet role for a listed actor (header row + case-insensitive match)", async () => {
    const role = await resolveActorRole(
      "acme",
      "Boss@Acme.test",
      "sheet-1",
      sheets([
        ["email", "role"], // header row → skipped
        ["boss@acme.test", "hr_admin"],
        ["mgr@acme.test", "manager"],
      ]),
      noopLogger,
    );
    expect(role).toBe("hr_admin");
  });

  it("returns null when the actor is not listed (caller falls back to header role)", async () => {
    const role = await resolveActorRole(
      "acme2",
      "ghost@acme.test",
      "sheet-1",
      sheets([["boss@acme.test", "hr_admin"]]),
      noopLogger,
    );
    expect(role).toBeNull();
  });

  it("returns null for an absent/empty Users tab (fallback path)", async () => {
    expect(await resolveActorRole("acme3", "x@acme.test", "sheet-1", sheets([]), noopLogger)).toBeNull();
  });

  it("returns null (never throws) when the read fails", async () => {
    const role = await resolveActorRole(
      "acme4",
      "x@acme.test",
      "sheet-1",
      sheets(async () => {
        throw new Error("boom");
      }),
      noopLogger,
    );
    expect(role).toBeNull();
  });

  it("caches per company (a second lookup does not re-read)", async () => {
    let reads = 0;
    const s = sheets(async () => {
      reads++;
      return { values: [["boss@acme.test", "hr_admin"]] };
    });
    await resolveActorRole("acme5", "boss@acme.test", "sheet-1", s, noopLogger);
    await resolveActorRole("acme5", "boss@acme.test", "sheet-1", s, noopLogger);
    expect(reads).toBe(1);
  });

  it("still resolves a role from an old two-column Users row (back-compat)", async () => {
    const role = await resolveActorRole(
      "old",
      "boss@acme.test",
      "sheet-1",
      sheets([["email", "role"], ["boss@acme.test", "manager"]]),
      noopLogger,
    );
    expect(role).toBe("manager");
  });
});

describe("resolveActorByToken (Users-tab beta tokens)", () => {
  const RAW = "beta-token-xyz";

  function usersWith(status: string): string[][] {
    return [
      ["email", "role", "mcpKeyHash", "mcpKeyStatus", "mcpKeyCreatedAt"],
      ["friend@acme.test", "manager", hashApiKey(RAW), status, "2026-06-08T00:00:00Z"],
    ];
  }

  it("resolves an ACTIVE token to its actorId + role", async () => {
    const id = await resolveActorByToken(
      "tok1",
      hashApiKey(RAW),
      "sheet-1",
      sheets(usersWith("active")),
      noopLogger,
    );
    expect(id).toEqual({ actorId: "friend@acme.test", role: "manager" });
  });

  it("rejects a REVOKED token (returns null)", async () => {
    const id = await resolveActorByToken(
      "tok2",
      hashApiKey(RAW),
      "sheet-1",
      sheets(usersWith("revoked")),
      noopLogger,
    );
    expect(id).toBeNull();
  });

  it("ignores a blank token hash (a role-only row never authenticates)", async () => {
    const id = await resolveActorByToken(
      "tok3",
      hashApiKey(""), // sha256("") — must never match a blank Sheet cell
      "sheet-1",
      sheets([
        ["email", "role", "mcpKeyHash", "mcpKeyStatus", "mcpKeyCreatedAt"],
        ["friend@acme.test", "manager", "", "active", ""],
      ]),
      noopLogger,
    );
    expect(id).toBeNull();
  });

  it("returns null (never throws) when the read fails — token falls through", async () => {
    const id = await resolveActorByToken(
      "tok4",
      hashApiKey(RAW),
      "sheet-1",
      sheets(async () => {
        throw new Error("boom");
      }),
      noopLogger,
    );
    expect(id).toBeNull();
  });
});

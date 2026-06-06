// Unit tests for the Sheet-based identity resolver (T3 / D2). Exercises the Users-tab hit,
// the header row skip, miss → null, absent/empty tab → null (fallback path), read failure →
// null (never throws), and the 60 s per-company cache — without a live Sheet.
import { describe, it, expect, beforeEach } from "vitest";
import type { SheetsConnector } from "../../src/shared/types/contracts.js";
import { resolveActorRole, __clearActorRoleCache } from "../../src/core/auth/resolveActorRole.js";

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
});

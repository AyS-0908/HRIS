// Resolves an actor's ROLE from the company's tracking Sheet (D2). The RH team maintains a
// dedicated `Users` tab (columns: email | role) in the SAME sheet that already holds the
// `Config` policy tab — so identity is RH-editable without a server/YAML change, while policy
// keys stay in their own tab (separation preserved).
//
// Generic by design (no recruitment-specific code): it takes a sheetId + any SheetsConnector
// (its getValues). The server uses it to make the Sheet role authoritative over the advisory
// `x-actor-role` header.
//
// Anti-regression + safety: a missing/empty/unreadable `Users` tab, or an actor not listed,
// resolves to `null` — the caller then falls back to the header role validated against the
// company's YAML roles (today's behavior). A read failure never throws (never breaks the
// flow). Cached 60 s per company, mirroring policy.ts.
import type { Logger, SheetsConnector } from "../../shared/types/contracts.js";

const USERS_RANGE = "Users!A1:B";
const CACHE_TTL_MS = 60_000; // short cache: avoid a Sheet read on every tool call.

interface CacheEntry {
  byActor: Map<string, string>; // actorId (lowercased email/id) → role
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

// Maps `Users` rows ([email, role]) to a lookup. Skips blanks and the header row.
function usersFromRows(values: string[][]): Map<string, string> {
  const byActor = new Map<string, string>();
  for (const row of values) {
    const email = (row[0] ?? "").trim().toLowerCase();
    // Role tokens are a closed lowercase set (company YAML). Normalize case so a "Manager"
    // typo in the Users tab still maps to the valid `manager` token (context.ts validates it).
    const role = (row[1] ?? "").trim().toLowerCase();
    if (!email || !role) continue;
    if (email === "email" && role.toLowerCase() === "role") continue; // header row
    byActor.set(email, role);
  }
  return byActor;
}

async function loadUsers(
  companyId: string,
  sheetId: string,
  sheets: Pick<SheetsConnector, "getValues">,
  logger: Logger,
): Promise<Map<string, string>> {
  const hit = cache.get(companyId);
  if (hit && hit.expiresAt > Date.now()) return hit.byActor;

  let byActor = new Map<string, string>();
  try {
    const { values } = await sheets.getValues({ sheetId, range: USERS_RANGE });
    byActor = usersFromRows(values);
  } catch (e) {
    // Never throw: fall back to the header role (anti-regression).
    logger.warn("resolveActorRole: Users read failed; falling back to header role", {
      companyId,
      err: String(e),
    });
  }
  cache.set(companyId, { byActor, expiresAt: Date.now() + CACHE_TTL_MS });
  return byActor;
}

// Returns the actor's Sheet-defined role, or null when no `Users` mapping applies (absent
// tab, unreadable, or actor not listed) — the caller then uses the advisory header role.
export async function resolveActorRole(
  companyId: string,
  actorId: string,
  sheetId: string,
  sheets: Pick<SheetsConnector, "getValues">,
  logger: Logger,
): Promise<string | null> {
  const byActor = await loadUsers(companyId, sheetId, sheets, logger);
  return byActor.get(actorId.trim().toLowerCase()) ?? null;
}

// Test-only: drops the in-memory cache so a test can vary the Users tab between cases.
export function __clearActorRoleCache(): void {
  cache.clear();
}

// Reads the company tracking Sheet's `Users` tab (D2) — the single RH-editable identity source.
// One tab, two jobs, one cached read:
//   1. role lookup  — email → role (Sheet role is authoritative over the advisory header).
//   2. token lookup — sha256(mcpKeyHash) → { actorId, role } for ACTIVE beta-tester tokens,
//      so an operator can add/revoke a tester from the Sheet without a Coolify edit or restart.
//
// Schema (back-compatible): old rows are `email | role`; new rows add
// `mcpKeyHash | mcpKeyStatus | mcpKeyCreatedAt`. A 2-column row still resolves a role; the extra
// columns are simply blank and ignored.
//
// Generic by design (no recruitment-specific code): it takes a sheetId + any SheetsConnector
// (its getValues). The server uses it to make the Sheet role authoritative over the advisory
// `x-actor-role` header, and to authenticate a Users-tab beta token.
//
// Anti-regression + safety: a missing/empty/unreadable `Users` tab, or an actor/token not listed,
// resolves to `null` — role lookups fall back to the header role; token lookups fall through to
// the next auth source (today's behavior). A read failure never throws (never breaks the flow).
// Cached 60 s per company, mirroring policy.ts.
import type { Logger, SheetsConnector } from "../../shared/types/contracts.js";

const USERS_RANGE = "Users!A1:E"; // email | role | mcpKeyHash | mcpKeyStatus | mcpKeyCreatedAt
const CACHE_TTL_MS = 60_000; // short cache: avoid a Sheet read on every tool call.

// Identity carried by an active Users-tab token: who it acts as, and their Sheet role.
export interface UsersTokenIdentity {
  actorId: string; // Users.email (the stable actor id)
  role?: string; // Users.role (else resolved/validated downstream)
}

interface UsersTab {
  byActor: Map<string, string>; // actorId (lowercased email) → role
  byKeyHash: Map<string, UsersTokenIdentity>; // active mcpKeyHash → identity
}

interface CacheEntry {
  users: UsersTab;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

// Maps `Users` rows to the two lookups. Skips the header row; supports old 2-col and new 5-col
// schemas. A token row only authenticates when its status is exactly `active` and its hash is
// non-blank — `revoked` or blank hashes are ignored (security rule).
function parseUsers(values: string[][]): UsersTab {
  const byActor = new Map<string, string>();
  const byKeyHash = new Map<string, UsersTokenIdentity>();
  for (const row of values) {
    const email = (row[0] ?? "").trim();
    const emailKey = email.toLowerCase();
    // Role tokens are a closed lowercase set (company YAML). Normalize case so a "Manager"
    // typo in the Users tab still maps to the valid `manager` token (context.ts validates it).
    const role = (row[1] ?? "").trim().toLowerCase();
    const keyHash = (row[2] ?? "").trim().toLowerCase();
    const status = (row[3] ?? "").trim().toLowerCase();
    if (!emailKey) continue;
    if (emailKey === "email" && role === "role") continue; // header row
    if (role) byActor.set(emailKey, role);
    // Only active, non-blank token hashes authenticate (revoked/blank are ignored).
    if (keyHash && status === "active") {
      byKeyHash.set(keyHash, { actorId: email, role: role || undefined });
    }
  }
  return { byActor, byKeyHash };
}

async function loadUsers(
  companyId: string,
  sheetId: string,
  sheets: Pick<SheetsConnector, "getValues">,
  logger: Logger,
): Promise<UsersTab> {
  const hit = cache.get(companyId);
  if (hit && hit.expiresAt > Date.now()) return hit.users;

  let users: UsersTab = { byActor: new Map(), byKeyHash: new Map() };
  try {
    const { values } = await sheets.getValues({ sheetId, range: USERS_RANGE });
    users = parseUsers(values);
  } catch (e) {
    // Never throw: fall back to the header role / next auth source (anti-regression).
    logger.warn("resolveActorRole: Users read failed; falling back", {
      companyId,
      err: String(e),
    });
  }
  cache.set(companyId, { users, expiresAt: Date.now() + CACHE_TTL_MS });
  return users;
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
  const { byActor } = await loadUsers(companyId, sheetId, sheets, logger);
  return byActor.get(actorId.trim().toLowerCase()) ?? null;
}

// Resolves a bearer-token hash to its bound Users-tab identity, or null when no ACTIVE row
// carries that hash (absent/unreadable tab, revoked/blank, or unknown hash) — the caller then
// falls through to the next auth source. `tokenHash` is the sha256 hex of the raw token.
export async function resolveActorByToken(
  companyId: string,
  tokenHash: string,
  sheetId: string,
  sheets: Pick<SheetsConnector, "getValues">,
  logger: Logger,
): Promise<UsersTokenIdentity | null> {
  const { byKeyHash } = await loadUsers(companyId, sheetId, sheets, logger);
  return byKeyHash.get(tokenHash.trim().toLowerCase()) ?? null;
}

// Test-only: drops the in-memory cache so a test can vary the Users tab between cases.
export function __clearActorRoleCache(): void {
  cache.clear();
}

// Per-company API key authentication (SPEC §2, §9). Secrets come only from the company
// config (as a hash) and the request header; the raw key is never stored or logged.
import { createHash, timingSafeEqual } from "node:crypto";
import type { CompanyRegistry } from "../config/loadCompany.js";
import { unauthenticated } from "../errors/appError.js";

// The authenticated identity carried by a valid key: which tenant it acts as, plus a stable,
// non-secret id for audit/correlation. A per-actor key (claude.ai web) also carries the bound
// actor — for those keys the identity comes from the key, not from x-actor-* headers.
export interface ApiKeyIdentity {
  apiKeyId: string;
  companyId: string;
  actorId?: string; // bound by a per-actor key (claude.ai web has no per-person headers)
  actorRole?: string; // optional bound role; else resolved from the Users tab (D2)
}

// sha256 hex digest of a raw key — the only form ever persisted (config) or compared.
export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

// Resolves a Users-tab bearer-token hash to its bound identity for a given company, or null when
// no ACTIVE row carries that hash. Implemented over the company tracking Sheet (D2); injected so
// core/auth stays free of connector wiring (the server passes a closure bound to its Sheets read).
export type UsersTokenResolver = (
  companyId: string,
  tokenHash: string,
) => Promise<{ actorId: string; role?: string } | null>;

// In-memory (config) match of a key hash to its company. Per-actor keys first (claude.ai web):
// the key binds the company AND the actor. Then the company-wide key (Claude Desktop): identity
// comes from the x-actor-* headers. Returns null on no match so callers can try the next source.
function matchConfigIdentity(
  providedHash: string,
  apiKeyId: string,
  companies: CompanyRegistry,
): ApiKeyIdentity | null {
  for (const c of companies.list()) {
    for (const ak of c.auth?.actorKeys ?? []) {
      if (timingSafeEqualHex(providedHash, ak.keyHash)) {
        return { companyId: c.company.id, apiKeyId, actorId: ak.actorId, actorRole: ak.role };
      }
    }
    const expected = c.auth?.apiKeyHash;
    if (expected && timingSafeEqualHex(providedHash, expected)) {
      return { companyId: c.company.id, apiKeyId };
    }
  }
  return null;
}

// Resolves a raw API key to the company it is bound to, from CONFIG ONLY (sync). Each company
// config carries `auth.apiKeyHash` (sha256 hex of its key) and optional per-actor `actorKeys`; a
// key both authenticates the caller AND selects the tenant, so it can act ONLY as its own company
// — the spoofable `x-company-id` header can no longer choose the tenant. No shared/server key
// exists by design. Sheet-backed beta tokens are resolved by resolveApiKeyIdentityAsync.
export function resolveApiKeyIdentity(
  provided: string | undefined,
  companies: CompanyRegistry,
): ApiKeyIdentity {
  if (!provided) {
    throw unauthenticated("missing API key");
  }
  const providedHash = hashApiKey(provided);
  const apiKeyId = "key_" + providedHash.slice(0, 12); // short, non-reversible — never the key
  const identity = matchConfigIdentity(providedHash, apiKeyId, companies);
  if (identity) return identity;
  throw unauthenticated("invalid API key");
}

// Resolves a raw API key across ALL three auth sources (SPEC auth_resolution_order):
//   1. config per-actor keys (auth.actorKeys)
//   2. Users-tab active token hash (mcpKeyHash where mcpKeyStatus == active)
//   3. config company-wide key (auth.apiKeyHash)
// Config (1 + 3) is checked in-memory first — distinct random tokens cannot collide across
// sources, so the only observable effect of checking config before the Sheet is avoiding a Sheet
// read on the common Desktop/config path. The Users-tab read is per-company and cached (60 s), so
// an added/revoked tester takes effect within the cache TTL with no restart.
export async function resolveApiKeyIdentityAsync(
  provided: string | undefined,
  companies: CompanyRegistry,
  resolveUsersToken: UsersTokenResolver,
): Promise<ApiKeyIdentity> {
  if (!provided) {
    throw unauthenticated("missing API key");
  }
  const providedHash = hashApiKey(provided);
  const apiKeyId = "key_" + providedHash.slice(0, 12);
  const fromConfig = matchConfigIdentity(providedHash, apiKeyId, companies);
  if (fromConfig) return fromConfig;
  // Sheet-backed beta token: find the company whose Users tab has this active hash.
  for (const c of companies.list()) {
    const hit = await resolveUsersToken(c.company.id, providedHash);
    if (hit) {
      return { companyId: c.company.id, apiKeyId, actorId: hit.actorId, actorRole: hit.role };
    }
  }
  throw unauthenticated("invalid API key");
}

// Constant-time comparison of two equal-length hex digests (avoids leaking a match via timing).
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

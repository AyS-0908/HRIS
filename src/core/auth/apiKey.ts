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

// Resolves a raw API key to the company it is bound to. Each company config carries
// `auth.apiKeyHash` (sha256 hex of its key); a key both authenticates the caller AND selects
// the tenant, so it can act ONLY as its own company — the spoofable `x-company-id` header can
// no longer choose the tenant. No shared/server key exists by design.
export function resolveApiKeyIdentity(
  provided: string | undefined,
  companies: CompanyRegistry,
): ApiKeyIdentity {
  if (!provided) {
    throw unauthenticated("missing API key");
  }
  const providedHash = hashApiKey(provided);
  const apiKeyId = "key_" + providedHash.slice(0, 12); // short, non-reversible — never the key
  for (const c of companies.list()) {
    // Per-actor keys first (claude.ai web): the key binds the company AND the actor.
    for (const ak of c.auth?.actorKeys ?? []) {
      if (timingSafeEqualHex(providedHash, ak.keyHash)) {
        return { companyId: c.company.id, apiKeyId, actorId: ak.actorId, actorRole: ak.role };
      }
    }
    // Company-wide key (Claude Desktop): identity comes from the x-actor-* headers.
    const expected = c.auth?.apiKeyHash;
    if (expected && timingSafeEqualHex(providedHash, expected)) {
      return { companyId: c.company.id, apiKeyId };
    }
  }
  throw unauthenticated("invalid API key");
}

// Constant-time comparison of two equal-length hex digests (avoids leaking a match via timing).
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

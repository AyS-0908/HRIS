// Resolves RequestContext once (SPEC §2). This is the ONLY source of
// actorId/companyId — never inferred downstream.
import type { RequestContext } from "../../shared/types/contracts.js";
import type { CompanyRegistry } from "../config/loadCompany.js";
import { forbidden } from "../errors/appError.js";

export interface IdentityHeaders {
  // companyId is advisory only: the tenant is the company bound to the API key. The header,
  // if present, is checked for consistency at the server boundary (anti-spoof) but never
  // selects the tenant. Kept here so the transport can pass it through for that check.
  companyId?: string;
  actorId?: string;
  actorRole?: string;
}

// Builds the company-scoped RequestContext. `companyId` is AUTHORITATIVE — it is the tenant the
// API key is bound to (resolved by resolveApiKeyIdentity), never taken from a header. Used by
// business tools and company-scoped core tools. `apiKeyId` must already be resolved
// (authentication precedes this).
//
// Identity from the Sheet (D2): `roleOverride` is the role resolved from the company's `Users`
// tab. When present it is AUTHORITATIVE and the `x-actor-role` header is advisory; when
// null/absent the header role is used. Either way the effective role must still be one of the
// company's YAML roles — the YAML stays the set of VALID roles, the Sheet only maps a person to
// one of them. Kept pure/sync: the async Sheet read happens at the server boundary, before this.
export function resolveContext(
  companyId: string,
  headers: IdentityHeaders,
  apiKeyId: string,
  companies: CompanyRegistry,
  roleOverride?: string | null,
): RequestContext {
  const actorId = headers.actorId?.trim();
  const headerRole = headers.actorRole?.trim();

  const company = companies.get(companyId);
  if (!company) {
    // Should never happen: companyId came from a validated, key-bound company.
    throw forbidden(`unknown company: ${companyId}`);
  }
  if (!actorId) {
    throw forbidden("missing actor id");
  }
  const roles = company.company.roles;
  // The Sheet role is authoritative ONLY when it is a valid company role. A typo or stale
  // token in the RH-edited Users tab (e.g. "Manager", "rh", "hr-admin") must NOT lock out a
  // user who sent a valid x-actor-role header — fall back to the advisory header, mirroring
  // the null/unreadable path. The YAML stays the closed set of VALID roles either way.
  const sheetRole = roleOverride && roles.includes(roleOverride) ? roleOverride : undefined;
  const effectiveRole = sheetRole ?? headerRole;
  if (!effectiveRole || !roles.includes(effectiveRole)) {
    throw forbidden(`role not allowed for company: ${effectiveRole ?? "<missing>"}`);
  }
  return { companyId, actorId, actorRole: effectiveRole, apiKeyId };
}

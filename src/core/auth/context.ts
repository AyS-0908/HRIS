// Resolves RequestContext once (SPEC §2). This is the ONLY source of
// actorId/companyId — never inferred downstream.
import type { RequestContext } from "../../shared/types/contracts.js";
import type { CompanyRegistry } from "../config/loadCompany.js";
import { forbidden } from "../errors/appError.js";

export interface IdentityHeaders {
  companyId?: string;
  actorId?: string;
  actorRole?: string;
}

// Requires a company-scoped identity. Used by business tools and company-scoped
// core tools. apiKeyId must already be resolved (authentication precedes this).
export function resolveContext(
  headers: IdentityHeaders,
  apiKeyId: string,
  companies: CompanyRegistry,
): RequestContext {
  const companyId = headers.companyId?.trim();
  const actorId = headers.actorId?.trim();
  const actorRole = headers.actorRole?.trim();

  if (!companyId || !companies.has(companyId)) {
    throw forbidden(`unknown company: ${companyId ?? "<missing>"}`);
  }
  const company = companies.get(companyId)!;
  if (!actorId) {
    throw forbidden("missing actor id");
  }
  if (!actorRole || !company.company.roles.includes(actorRole)) {
    throw forbidden(`role not allowed for company: ${actorRole ?? "<missing>"}`);
  }
  return { companyId, actorId, actorRole, apiKeyId };
}

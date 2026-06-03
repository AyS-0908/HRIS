// Resolves a company's enabledModules against the registry, failing fast on
// unknown module references or roles not declared by the company (SPEC §6).
import type { ModuleContract } from "../../shared/types/contracts.js";
import type { ModuleRegistry } from "../../registry/moduleRegistry.js";
import type { CompanyConfig } from "./schema.js";
import { validationError } from "../errors/appError.js";

export function resolveEnabledModules(
  company: CompanyConfig,
  registry: ModuleRegistry,
): ModuleContract[] {
  const companyRoles = new Set(company.company.roles);
  const enabled: ModuleContract[] = [];

  for (const ref of company.company.enabledModules) {
    const module = registry.get(ref);
    if (!module) {
      throw validationError(`company ${company.company.id} enables unknown module: ${ref}`);
    }
    // Every role the module relies on must be declared by the company.
    const referencedRoles = new Set<string>();
    for (const def of module.processDefinition ? [module.processDefinition] : []) {
      def.roles.forEach((r) => referencedRoles.add(r));
    }
    for (const rule of module.permissionRules) rule.roles.forEach((r) => referencedRoles.add(r));
    for (const tool of module.tools) {
      if (tool.process?.requiredRole) referencedRoles.add(tool.process.requiredRole);
    }
    const missing = [...referencedRoles].filter((r) => !companyRoles.has(r));
    if (missing.length > 0) {
      throw validationError(
        `module ${ref} references roles not in company ${company.company.id}: ${missing.join(", ")}`,
      );
    }
    enabled.push(module);
  }
  return enabled;
}

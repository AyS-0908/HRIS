// Module contract validation (SPEC §12 contract assertions + §5 audit floor).
// Fails fast at registration; the contract tests assert the same invariants.
import type { ModuleContract } from "../shared/types/contracts.js";

export function validateModule(m: ModuleContract): void {
  const errors = collectModuleErrors(m);
  if (errors.length > 0) {
    throw new Error(`invalid module ${m.moduleName}:\n - ${errors.join("\n - ")}`);
  }
}

// Returns a list of human-readable problems (empty = valid). Used by tests too.
export function collectModuleErrors(m: ModuleContract): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const statuses = new Set(m.processDefinition?.statuses ?? []);
  const auditRequired = m.processDefinition?.auditRequired ?? false;

  for (const tool of m.tools) {
    if (!tool.name) errors.push("a tool has an empty name");
    if (seen.has(tool.name)) errors.push(`duplicate tool name: ${tool.name}`);
    seen.add(tool.name);

    if (!tool.inputZod || typeof tool.inputZod.safeParse !== "function") {
      errors.push(`${tool.name}: missing/invalid zod input schema`);
    }
    if (!tool.permissionScope) errors.push(`${tool.name}: missing permission scope`);
    if (!m.permissionRules.some((r) => r.scope === tool.permissionScope)) {
      errors.push(`${tool.name}: no permission rule for scope ${tool.permissionScope}`);
    }

    const pb = tool.process;
    if (pb) {
      if (!statuses.has(pb.statusAfterSuccess)) {
        errors.push(
          `${tool.name}: statusAfterSuccess '${pb.statusAfterSuccess}' not in process.statuses`,
        );
      }
      for (const s of pb.allowedStatusesBefore) {
        if (!statuses.has(s)) {
          errors.push(`${tool.name}: allowedStatusesBefore '${s}' not in process.statuses`);
        }
      }
      if (auditRequired && pb.auditLevel === "none") {
        errors.push(`${tool.name}: auditLevel 'none' forbidden when process.auditRequired`);
      }
    }
  }
  return errors;
}

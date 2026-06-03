// Permission check (SPEC §5 step 2). Precedes every tool body.
import type { PermissionRule } from "../../shared/types/contracts.js";
import { forbidden } from "../errors/appError.js";

// Asserts the actor's role is allowed for the tool's permission scope.
export function assertPermission(
  scope: string,
  actorRole: string,
  rules: PermissionRule[],
): void {
  const rule = rules.find((r) => r.scope === scope);
  if (!rule) {
    throw forbidden(`no permission rule for scope: ${scope}`);
  }
  if (!rule.roles.includes(actorRole)) {
    throw forbidden(`role ${actorRole} not allowed for scope ${scope}`);
  }
}

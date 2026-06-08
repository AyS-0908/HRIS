// Maps each tool's permission scope to the roles allowed to use it (SPEC §5 step 2).
import type { PermissionRule } from "../../../shared/types/contracts.js";

// `admin_user` is an operator/admin beta role with full HR-recruitment access. permissionScope
// is the single source of role authorization (no per-tool requiredRole) so adding it here is enough.
export const recruitmentPermissions: PermissionRule[] = [
  { scope: "hr.recruitment.submit", roles: ["manager", "admin_user"] },
  { scope: "hr.recruitment.generate", roles: ["manager", "hr_admin", "admin_user"] },
  { scope: "hr.recruitment.approve", roles: ["manager", "admin_user"] },
  { scope: "hr.recruitment.policy.read", roles: ["manager", "hr_admin", "admin_user"] },
];

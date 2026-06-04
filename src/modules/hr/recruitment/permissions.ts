// Maps each tool's permission scope to the roles allowed to use it (SPEC §5 step 2).
import type { PermissionRule } from "../../../shared/types/contracts.js";

export const recruitmentPermissions: PermissionRule[] = [
  { scope: "hr.recruitment.submit", roles: ["manager"] },
  { scope: "hr.recruitment.generate", roles: ["manager", "hr_admin"] },
  { scope: "hr.recruitment.approve", roles: ["manager"] },
  { scope: "hr.recruitment.policy.read", roles: ["manager", "hr_admin"] },
];

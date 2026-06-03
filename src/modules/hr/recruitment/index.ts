// Assembles the hr.recruitment module contract (SPEC §4.5).
import type {
  HealthResult,
  ModuleContract,
  ProcessDefinition,
  StatusModel,
} from "../../../shared/types/contracts.js";
import { recruitmentPermissions } from "./permissions.js";
import { PROCESS_ID, STATUS, recruitmentTools } from "./tools.js";
import { REC_JOBDESC_TAB } from "./service.js";

const processDefinition: ProcessDefinition = {
  processId: PROCESS_ID,
  domain: "hr",
  name: "Recruitment — Job description (Fiche poste)",
  version: "0.1.0",
  steps: ["submit_job_request", "generate_job_description", "approve_job_description"],
  statuses: [STATUS.pendingValidation, STATUS.approved],
  roles: ["manager", "hr_admin"],
  auditRequired: true,
};

const statusModel: StatusModel = {
  initial: STATUS.pendingValidation,
  statuses: [STATUS.pendingValidation, STATUS.approved],
};

export const recruitmentModule: ModuleContract = {
  moduleName: "hr.recruitment",
  moduleVersion: "0.1.0",
  tools: recruitmentTools,
  permissionRules: recruitmentPermissions,
  serviceBindings: {},
  async healthCheck(): Promise<HealthResult> {
    return { ok: true };
  },
  processDefinition,
  statusModel,
  storageBindings: { recruitmentSheetTab: REC_JOBDESC_TAB },
};

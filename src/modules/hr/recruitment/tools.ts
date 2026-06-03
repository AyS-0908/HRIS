// HR recruitment "Fiche poste" tools (SPEC §11). Coarse business actions only —
// no technical step names at the MCP surface.
import type { ToolDefinition } from "../../../shared/types/contracts.js";
import {
  approveJobDescriptionInput,
  generateJobDescriptionInput,
  submitJobRequestInput,
  type ApproveJobDescriptionInput,
  type GenerateJobDescriptionInput,
  type SubmitJobRequestInput,
} from "./schemas.js";
import { appendRecJobDescRow, draftJobDescriptionDoc } from "./service.js";

export const PROCESS_ID = "hr.recruitment";
export const STATUS = {
  pendingValidation: "pending_manager_validation",
  approved: "approved",
} as const;

// 1.1 — creates the instance → pending_manager_validation
const submitJobRequest: ToolDefinition = {
  name: "submit_job_request",
  description: "Manager submits a recruitment request, starting the job-description process.",
  inputZod: submitJobRequestInput,
  permissionScope: "hr.recruitment.submit",
  process: {
    processId: PROCESS_ID,
    allowedStatusesBefore: [], // creator: no prior instance
    statusAfterSuccess: STATUS.pendingValidation,
    requiredRole: "manager",
    sideEffects: [],
    auditLevel: "standard",
    idempotent: false,
  },
  async handler(_ctx, input) {
    // Runtime (§5 step 3) already validated against inputZod; trust the typed input.
    const i = input as SubmitJobRequestInput;
    return {
      status: "success",
      data: { title: i.title, plannedHire: i.plannedHire },
      traceIds: [],
    };
  },
};

// 1.3 — AI drafts the job description doc (recommendation; status unchanged)
const generateJobDescription: ToolDefinition = {
  name: "generate_job_description",
  description: "AI drafts the job description into a document for manager review. Recommendation only.",
  inputZod: generateJobDescriptionInput,
  permissionScope: "hr.recruitment.generate",
  process: {
    processId: PROCESS_ID,
    allowedStatusesBefore: [STATUS.pendingValidation],
    statusAfterSuccess: STATUS.pendingValidation, // unchanged: AI does not transition
    requiredRole: "", // manager or hr_admin (governed by permission scope)
    sideEffects: ["create_document"],
    auditLevel: "standard",
    idempotent: true,
  },
  async handler(_ctx, input, deps) {
    const i = input as GenerateJobDescriptionInput;
    const { docId, url } = await draftJobDescriptionDoc(deps, i, i.targetSummary);
    return { status: "success", data: { docId, url }, traceIds: [docId] };
  },
};

// 1.3 (end) — manager approves → approved + writes rec_jobDesc row (human checkpoint)
const approveJobDescription: ToolDefinition = {
  name: "approve_job_description",
  description: "Manager approves the job description, recording it and advancing the process.",
  inputZod: approveJobDescriptionInput,
  permissionScope: "hr.recruitment.approve",
  process: {
    processId: PROCESS_ID,
    allowedStatusesBefore: [STATUS.pendingValidation],
    statusAfterSuccess: STATUS.approved,
    requiredRole: "manager", // human validation: only the manager transitions it
    sideEffects: ["update_sheet"],
    auditLevel: "strict",
    idempotent: true,
  },
  async handler(_ctx, input, deps) {
    const i = input as ApproveJobDescriptionInput;
    const { rowId } = await appendRecJobDescRow(deps, i);
    return { status: "success", data: { rowId }, traceIds: [rowId] };
  },
};

export const recruitmentTools: ToolDefinition[] = [
  submitJobRequest,
  generateJobDescription,
  approveJobDescription,
];

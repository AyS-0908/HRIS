// zod schemas = single source of truth; MCP input_schema is derived (SPEC §1).
import { z } from "zod";

// 1.1 — Manager submits a recruitment request (creates the process instance).
export const submitJobRequestInput = z.object({
  title: z.string().min(1).describe("Target job title"),
  department: z.string().min(1).optional().describe("Department / team"),
  justification: z.string().min(1).describe("Why this hire is needed"),
  plannedHire: z.boolean().describe("true if the hire was budgeted/planned"),
});
export type SubmitJobRequestInput = z.infer<typeof submitJobRequestInput>;

// 1.3 — AI drafts the job description into a doc (recommendation; no status change).
export const generateJobDescriptionInput = z.object({
  processInstanceId: z.string().min(1),
  idempotencyKey: z.string().min(1).describe("Dedup key for the doc creation side effect"),
  roadmapUrl: z.string().optional().describe("Manager roadmap doc/URL (context)"),
  targetSummary: z.string().min(1).describe("Summary of the target role to draft"),
  // Optional chatbot-authored body injected into the {{BODY}} placeholder of the
  // company's template. Additive/back-compatible: absent ⇒ a body is composed locally.
  draftBody: z.string().optional().describe("Drafted job-description body (chatbot-authored)"),
});
export type GenerateJobDescriptionInput = z.infer<typeof generateJobDescriptionInput>;

// 1.3 (end) — Manager approves the job description (human validation checkpoint).
export const approveJobDescriptionInput = z.object({
  processInstanceId: z.string().min(1),
  idempotencyKey: z.string().min(1).describe("Dedup key for the sheet-row side effect"),
  jobTitle: z.string().min(1),
  // Optional manual override. The trusted URL normally flows from the generate step via the
  // process state (externalReferences.docUrl); supplying it here overrides that (plan 1d).
  docUrl: z.string().min(1).optional().describe("Override URL of the validated job description doc"),
  // Optional proof-of-need document, required only when the company policy sets
  // requireProofDoc (plan 1e). Absent policy ⇒ not required (current behavior).
  proofDocUrl: z.string().min(1).optional().describe("URL of a supporting/proof document"),
});
export type ApproveJobDescriptionInput = z.infer<typeof approveJobDescriptionInput>;

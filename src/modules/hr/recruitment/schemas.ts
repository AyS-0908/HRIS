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
//
// Determinism (plan P1.2 "hybride borné"): the preferred path is the four STRUCTURED
// sections below. Each is LLM-authored but maps to a fixed, named section the MCP assembles
// in a fixed order into the template — reproducible structure, no free-form prose dump.
// They are optional at the schema level (additive/back-compatible); a company can REQUIRE
// them via the Config tab key `requireStructuredSections` (enforced in the handler).
// `draftBody` remains a legacy fallback for clients that have not migrated yet.
export const generateJobDescriptionInput = z.object({
  processInstanceId: z.string().min(1),
  idempotencyKey: z.string().min(1).describe("Dedup key for the doc creation side effect"),
  roadmapUrl: z.string().optional().describe("Manager roadmap doc/URL (context)"),
  targetSummary: z.string().min(1).describe("One-line summary of the target role (the {{SUMMARY}} placeholder)"),
  // Structured sections (preferred, deterministic). Injected into {{MISSION}},
  // {{RESPONSIBILITIES}}, {{PROFILE}}, {{CONTEXT}} placeholders, in this order.
  mission: z.string().min(1).optional().describe("Mission / purpose of the role"),
  responsibilities: z.string().min(1).optional().describe("Key responsibilities"),
  profile: z.string().min(1).optional().describe("Profile sought (skills, experience)"),
  context: z.string().min(1).optional().describe("Team / context of the hire"),
  // Legacy free-form body (fallback). Injected into {{BODY}}. Prefer the structured
  // sections above; absent both ⇒ a minimal body is composed locally.
  draftBody: z.string().optional().describe("Legacy free-form job-description body (chatbot-authored)"),
});
export type GenerateJobDescriptionInput = z.infer<typeof generateJobDescriptionInput>;

// The four structured section keys, in their fixed rendering order. Single source of truth
// shared by the body composer (service) and the required-sections policy check (handler).
export const STRUCTURED_SECTION_KEYS = ["mission", "responsibilities", "profile", "context"] as const;

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

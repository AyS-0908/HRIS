// Services own the side effects: handlers call these, these call connectors
// (SPEC §0, §11). A handler never calls a connector directly.
import type { ServiceDeps } from "../../../shared/types/contracts.js";
import { connectorError, validationError } from "../../../core/errors/appError.js";
import type {
  ApproveJobDescriptionInput,
  GenerateJobDescriptionInput,
} from "./schemas.js";

export const REC_JOBDESC_TAB = "rec_jobDesc";

// Composes a draft body when the chatbot did not author one. The conversational AI
// authoring happens chatbot-side (input.draftBody); this is the local fallback that
// keeps the simulated path self-contained.
function buildDraftBody(input: GenerateJobDescriptionInput): string {
  if (input.draftBody && input.draftBody.trim()) return input.draftBody;
  return [
    `# Job description`,
    ``,
    `Summary: ${input.targetSummary}`,
    input.roadmapUrl ? `Roadmap reference: ${input.roadmapUrl}` : ``,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function draftJobDescriptionDoc(
  deps: ServiceDeps,
  input: GenerateJobDescriptionInput,
  title: string,
): Promise<{ docId: string; url: string }> {
  // Per-company Docs template + shared Drive folder (plan 1b/1c). Live Docs needs BOTH:
  //  - both present  ⇒ the connector runs live (real shared doc).
  //  - both absent   ⇒ Docs stays simulated even in live mode (anti-regression: opting out).
  //  - exactly one   ⇒ a genuine misconfiguration → fail with a clear, actionable message
  //    rather than silently producing a dead simulated URL.
  const templateId = deps.resources.googleDocs?.jobDescriptionTemplateId || undefined;
  const folderId = deps.resources.googleDrive?.hrKnowledgeFolderId || undefined;
  if (deps.googleMode === "live" && !!templateId !== !!folderId) {
    throw validationError(
      "recruitment Docs config incomplete: set BOTH resources.googleDocs.jobDescriptionTemplateId " +
        "and resources.googleDrive.hrKnowledgeFolderId (or neither) to create a real shared job-description doc",
    );
  }

  let res: { docId: string; url: string };
  try {
    res = await deps.connectors.docs.createDocument(
      { templateId, title: `Job description — ${title}`, content: buildDraftBody(input) },
      deps.idempotencyKey,
    );
  } catch (e) {
    deps.logger.error("docs.createDocument failed", { err: String(e) });
    throw connectorError("failed to create job description document");
  }
  deps.recordExternal("docId", res.docId);
  // Persist the REAL url through the process state so approve_job_description can read it
  // (plan 1d) instead of trusting a client-supplied docUrl.
  deps.recordExternal("docUrl", res.url);
  return res;
}

// Writes the rec_jobDesc row: (id, titre, mgr, url, status). SheetId comes from
// the company's resources; in V1 the Sheets connector is simulated.
export async function appendRecJobDescRow(
  deps: ServiceDeps,
  input: ApproveJobDescriptionInput,
): Promise<{ rowId: string }> {
  const sheetId = deps.resources.googleSheets?.hrRecruitmentSheetId ?? "simulated-sheet";
  // In the normal flow the chatbot omits docUrl, so the trusted URL produced by the
  // generate step (persisted in the process state) is used. An explicit input.docUrl is a
  // manual override escape hatch. Falls back to empty if neither is present (plan 1d).
  const docUrl = input.docUrl ?? deps.process.externalReferences?.docUrl ?? "";
  let res: { rowId: string };
  try {
    res = await deps.connectors.sheets.appendRow(
      {
        sheetId,
        tab: REC_JOBDESC_TAB,
        values: {
          id: deps.process.processInstanceId,
          titre: input.jobTitle,
          mgr: deps.ctx.actorId,
          url: docUrl,
          status: "approved",
        },
      },
      deps.idempotencyKey,
    );
  } catch (e) {
    deps.logger.error("sheets.appendRow failed", { err: String(e) });
    throw connectorError("failed to append rec_jobDesc row");
  }
  deps.recordExternal("rec_jobDesc_row", res.rowId);
  return res;
}

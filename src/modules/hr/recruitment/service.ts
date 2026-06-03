// Services own the side effects: handlers call these, these call connectors
// (SPEC §0, §11). A handler never calls a connector directly.
import type { ServiceDeps } from "../../../shared/types/contracts.js";
import type {
  ApproveJobDescriptionInput,
  GenerateJobDescriptionInput,
} from "./schemas.js";

export const REC_JOBDESC_TAB = "rec_jobDesc";

// Composes a draft body. The conversational AI authoring happens chatbot-side;
// here we assemble the document the manager will review/correct in GDocs.
function buildDraftBody(input: GenerateJobDescriptionInput): string {
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
  const res = await deps.connectors.docs.createDocument(
    { title: `Job description — ${title}`, content: buildDraftBody(input) },
    deps.idempotencyKey,
  );
  deps.recordExternal("docId", res.docId);
  return res;
}

// Writes the rec_jobDesc row: (id, titre, mgr, url, status). SheetId comes from
// the company's resources; in V1 the Sheets connector is simulated.
export async function appendRecJobDescRow(
  deps: ServiceDeps,
  input: ApproveJobDescriptionInput,
): Promise<{ rowId: string }> {
  const sheetId = deps.resources.googleSheets?.hrRecruitmentSheetId ?? "simulated-sheet";
  const res = await deps.connectors.sheets.appendRow(
    {
      sheetId,
      tab: REC_JOBDESC_TAB,
      values: {
        id: deps.process.processInstanceId,
        titre: input.jobTitle,
        mgr: deps.ctx.actorId,
        url: input.docUrl,
        status: "approved",
      },
    },
    deps.idempotencyKey,
  );
  deps.recordExternal("rec_jobDesc_row", res.rowId);
  return res;
}

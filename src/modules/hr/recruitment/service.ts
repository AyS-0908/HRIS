// Services own the side effects: handlers call these, these call connectors
// (SPEC §0, §11). A handler never calls a connector directly.
import type { ServiceDeps } from "../../../shared/types/contracts.js";
import { connectorError, validationError } from "../../../core/errors/appError.js";
import {
  STRUCTURED_SECTION_KEYS,
  type ApproveJobDescriptionInput,
  type GenerateJobDescriptionInput,
} from "./schemas.js";
import { resolveRecruitmentPolicy } from "./policy.js";

export const REC_JOBDESC_TAB = "rec_jobDesc";
// RH-editable identity tab (D2). Rows with role hr_admin are the HR notification recipients
// at approve (D1). Same range the server uses for role resolution.
const USERS_RANGE = "Users!A1:B";

type SectionKey = (typeof STRUCTURED_SECTION_KEYS)[number];

// Maps a structured-section input key to its template placeholder name (plan P1.2).
const SECTION_PLACEHOLDER: Record<SectionKey, string> = {
  mission: "MISSION",
  responsibilities: "RESPONSIBILITIES",
  profile: "PROFILE",
  context: "CONTEXT",
};

// Composes the document content deterministically (plan P1.2 "hybride borné").
// Preferred: the structured sections, rendered in fixed order under fixed headings —
// reproducible output regardless of the LLM's phrasing. They also feed named placeholders
// (sections) so a template can place each one precisely. `draftBody` is a legacy fallback;
// absent both ⇒ a minimal body is composed from the summary.
function composeContent(input: GenerateJobDescriptionInput): {
  body: string;
  sections: Record<string, string>;
} {
  const HEADINGS: Record<SectionKey, string> = {
    mission: "Mission",
    responsibilities: "Responsabilités",
    profile: "Profil recherché",
    context: "Contexte",
  };
  const sections: Record<string, string> = {};
  const parts: string[] = [];
  for (const key of STRUCTURED_SECTION_KEYS) {
    const value = input[key];
    if (value && value.trim()) {
      sections[SECTION_PLACEHOLDER[key]] = value.trim();
      parts.push(`## ${HEADINGS[key]}\n${value.trim()}`);
    }
  }
  if (parts.length > 0) return { body: parts.join("\n\n"), sections };

  // Legacy / fallback path (no structured sections supplied).
  const body =
    input.draftBody && input.draftBody.trim()
      ? input.draftBody.trim()
      : [
          `Summary: ${input.targetSummary}`,
          input.roadmapUrl ? `Roadmap reference: ${input.roadmapUrl}` : ``,
        ]
          .filter(Boolean)
          .join("\n");
  return { body, sections: {} };
}

export async function draftJobDescriptionDoc(
  deps: ServiceDeps,
  input: GenerateJobDescriptionInput,
  title: string,
): Promise<{ docId: string; url: string }> {
  // Per-company Docs template + shared Drive folder (plan 1b/1c, resolved per-company at
  // call time — P2.3). In LIVE mode a real shared doc is the whole point of this tool, so
  // BOTH must be configured; otherwise we FAIL LOUD (plan P0.3) instead of silently
  // returning a dead simulated URL. In simulated mode behaviour is unchanged.
  const templateId = deps.resources.googleDocs?.jobDescriptionTemplateId || undefined;
  const folderId = deps.resources.googleDrive?.hrKnowledgeFolderId || undefined;
  if (deps.googleMode === "live" && (!templateId || !folderId)) {
    throw validationError(
      "recruitment Docs not configured for live mode: set BOTH " +
        "resources.googleDocs.jobDescriptionTemplateId and resources.googleDrive.hrKnowledgeFolderId " +
        "so a real shared job-description doc is created (no simulated URL is returned in live mode)",
    );
  }

  const { body, sections } = composeContent(input);
  let res: { docId: string; url: string };
  try {
    res = await deps.connectors.docs.createDocument(
      {
        templateId,
        folderId,
        title: `Job description — ${title}`,
        summary: input.targetSummary,
        content: body,
        sections,
      },
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

// Writes the rec_jobDesc row: (id, titre, mgr, url, status), then notifies HR by email (D1).
// SheetId comes from the company's resources.
export async function appendRecJobDescRow(
  deps: ServiceDeps,
  input: ApproveJobDescriptionInput,
): Promise<{ rowId: string; messageId?: string }> {
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

  // D1: the Sheet row (with the doc URL) is the trigger to notify HR. Best-effort — the
  // approval already transitioned in the runtime, so a failed email must NOT fail approve.
  const messageId = await notifyHrOnApproval(deps, input.jobTitle, docUrl);
  return { rowId: res.rowId, messageId };
}

// Resolves the HR recipients (A3): primary = `Users` rows with role hr_admin; fallback = the
// Config key hrNotifyEmail. Returns [] when neither yields an address (⇒ no email is sent).
async function resolveHrRecipients(deps: ServiceDeps): Promise<string[]> {
  const sheetId = deps.resources.googleSheets?.hrRecruitmentSheetId;
  if (sheetId) {
    try {
      const { values } = await deps.connectors.sheets.getValues({ sheetId, range: USERS_RANGE });
      const emails = values
        .filter((r) => (r[1] ?? "").trim().toLowerCase() === "hr_admin")
        .map((r) => (r[0] ?? "").trim())
        .filter((e) => e.includes("@"));
      if (emails.length > 0) return emails;
    } catch (e) {
      deps.logger.warn("resolveHrRecipients: Users read failed", { err: String(e) });
    }
  }
  const policy = await resolveRecruitmentPolicy(deps);
  return policy.hrNotifyEmail ? [policy.hrNotifyEmail] : [];
}

// Sends the HR notification at approve (D1). Best-effort: any failure (no recipient, connector
// error) is logged and swallowed — it never fails the approval. Returns the messageId on send.
async function notifyHrOnApproval(
  deps: ServiceDeps,
  jobTitle: string,
  docUrl: string,
): Promise<string | undefined> {
  try {
    const recipients = await resolveHrRecipients(deps);
    if (recipients.length === 0) {
      deps.logger.info("approve: no HR recipient resolved; skipping notification");
      return undefined;
    }
    const body =
      `Bonjour,\n\n` +
      `La fiche de poste « ${jobTitle} » vient d'être validée et est prête à être publiée.\n` +
      (docUrl ? `\nFiche de poste : ${docUrl}\n` : ``) +
      `\nElle a également été enregistrée dans le tableau de suivi du recrutement.\n\n` +
      `— Notification automatique du module Recrutement`;
    const sent = await deps.connectors.gmail.sendEmail(
      {
        to: recipients.join(", "),
        subject: `Fiche de poste à publier : ${jobTitle}`,
        body,
      },
      `approve-notify-${deps.idempotencyKey}`,
    );
    deps.recordExternal("approve_notify_messageId", sent.messageId);
    return sent.messageId;
  } catch (e) {
    deps.logger.error("approve HR notification failed (best-effort)", { err: String(e) });
    return undefined;
  }
}

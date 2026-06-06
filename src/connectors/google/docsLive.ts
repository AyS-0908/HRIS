// Live Docs connector (service-account auth). Activated when GOOGLE_CONNECTORS=live
// AND a per-company template + folder are configured (see connectors/index.ts).
//
// Strategy (plan 1b): the company hosts ITS OWN template Doc in ITS OWN Drive, inside a
// folder already shared with its HR + managers. We:
//   1. Drive files.copy the template into that folder → the copy INHERITS the folder's
//      sharing (no per-doc ACL code, RGPD-friendly multi-company isolation).
//   2. Docs batchUpdate / replaceAllText to inject the drafted content into placeholders
//      ({{TITLE}}, {{SUMMARY}}, {{BODY}}).
//   3. Return the REAL { docId, url } so the live URL flows through the process state.
//
// Raw provider errors are re-typed CONNECTOR_ERROR (same boundary discipline as
// sheetsLive.ts / sheetsStorageAdapter.ts) — no provider type leaks to clients.
import type { OAuth2Client } from "google-auth-library";
import type { DocsConnector, HealthResult, Logger } from "../../shared/types/contracts.js";
import { connectorError } from "../../core/errors/appError.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DOCS_API = "https://docs.googleapis.com/v1/documents";

// `client` is either a service-account JWT or an OAuth user-delegation client (both are
// OAuth2Client); the connector is agnostic. `authLabel` is for health reporting only. The
// template + folder always arrive per call (input.templateId / input.folderId) from each
// company's resources (P2.3 multi-tenant) — there is no connector-level fallback.
export function createDocsConnectorLive(
  logger: Logger,
  client: OAuth2Client,
  authLabel: string,
): DocsConnector {
  return {
    name: "google.docs",
    async healthCheck(): Promise<HealthResult> {
      try {
        await client.getAccessToken();
        return { ok: true, detail: `live (${authLabel})` };
      } catch (e) {
        return { ok: false, detail: `auth failed: ${String(e)}` };
      }
    },

    async createDocument(input, idempotencyKey) {
      // Per-call (P2.3 multi-tenant): each company passes its OWN template + folder via
      // resources, so one live connector serves every tenant.
      const templateId = input.templateId;
      const folderId = input.folderId;
      // Defensive: the service guard (plan P0.3) already requires both per company in live
      // mode, so reaching here without them is a wiring bug — fail clearly, never silently.
      if (!templateId || !folderId) {
        logger.error("connector.docs.createDocument missing template/folder (live)", {
          hasTemplate: !!templateId,
          hasFolder: !!folderId,
        });
        throw connectorError("Docs template/folder not provided for live document creation");
      }
      try {
        // 1. Copy the template into the shared folder → inherits its sharing.
        const docId = await copyTemplate(client, templateId, folderId, input.title);

        // 2. Inject content into placeholders. Best-effort: a template without placeholders
        //    still yields a valid (titled) doc, so a missing token is not fatal. Structured
        //    section placeholders ({{MISSION}}…) are filled when supplied (plan P1.2).
        await replacePlaceholders(client, docId, {
          "{{TITLE}}": input.title,
          "{{SUMMARY}}": input.summary ?? input.title,
          "{{BODY}}": input.content,
          ...Object.fromEntries(
            Object.entries(input.sections ?? {}).map(([name, text]) => [`{{${name}}}`, text]),
          ),
        });

        const url = `https://docs.google.com/document/d/${docId}/edit`;
        logger.info("connector.docs.createDocument (live)", {
          docId,
          templateId,
          folderId,
          idempotencyKey,
        });
        return { docId, url };
      } catch (e) {
        const msg = String(e);
        logger.error("connector.docs.createDocument failed (live)", { err: msg });
        // P0.2: the most common live-Docs failure is a service account copying into a
        // regular (non-shared) Drive folder — service accounts have no Drive storage quota.
        // Surface an actionable hint server-side (clients still get the safe CONNECTOR_ERROR).
        if (/storage quota|quotaExceeded/i.test(msg)) {
          logger.error(
            "Docs live hint: the service account has no Drive quota for this folder. " +
              "Use a Shared Drive (Workspace) or enable OAuth user-delegation (GOOGLE_OAUTH_*).",
          );
        }
        throw connectorError("Google Docs request failed");
      }
    },
  };
}

async function copyTemplate(client: OAuth2Client, templateId: string, folderId: string, name: string): Promise<string> {
  const url = `${DRIVE_API}/${encodeURIComponent(templateId)}/copy?supportsAllDrives=true`;
  const res = await request<{ id?: string }>(client, {
    url,
    method: "POST",
    data: { name, parents: [folderId] },
  });
  const docId = res.data?.id;
  if (!docId) throw connectorError("Drive files.copy returned no id");
  return docId;
}

async function replacePlaceholders(
  client: OAuth2Client,
  docId: string,
  replacements: Record<string, string>,
): Promise<void> {
  const requests = Object.entries(replacements).map(([token, text]) => ({
    replaceAllText: {
      containsText: { text: token, matchCase: true },
      replaceText: text,
    },
  }));
  const url = `${DOCS_API}/${encodeURIComponent(docId)}:batchUpdate`;
  await request(client, { url, method: "POST", data: { requests } });
}

// Single egress point to the Google APIs. Errors propagate to createDocument's catch,
// which logs once and re-wraps as CONNECTOR_ERROR (no provider type leaks to clients).
async function request<T = unknown>(
  client: OAuth2Client,
  config: Parameters<OAuth2Client["request"]>[0],
): Promise<{ data: T }> {
  return await client.request<T>(config);
}

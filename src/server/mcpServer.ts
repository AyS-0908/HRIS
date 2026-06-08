// Builds a per-request MCP server (stateless streamable HTTP). Identity is resolved
// from request headers; only the calling company's enabled tools are exposed.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { App } from "../app.js";
import { resolveApiKeyIdentityAsync } from "../core/auth/apiKey.js";
import { resolveContext, type IdentityHeaders } from "../core/auth/context.js";
import { forbidden } from "../core/errors/appError.js";
import { resolveActorRole, resolveActorByToken } from "../core/auth/resolveActorRole.js";
import { toInputSchema } from "../core/validation/inputSchema.js";
import { AppError, toClientError } from "../core/errors/appError.js";
import { STANDARD_VERSION } from "../version.js";

const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false } as const;

const CORE_TOOLS = [
  { name: "health_check", description: "Liveness + connector/module health." },
  { name: "list_available_business_tools", description: "Business tools enabled for the calling company." },
  { name: "get_standard_version", description: "The MCP standard (core) version." },
] as const;

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
    isError: false,
  };
}
function errResult(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ status: "error", errorCode: code, message }) }],
    isError: true,
  };
}

export function buildServer(app: App, headers: IdentityHeaders & { apiKey?: string }): Server {
  const server = new Server(
    { name: "mcp-custom-standard", version: STANDARD_VERSION },
    { capabilities: { tools: {} } },
  );

  // Resolves the actor's role from the company `Users` tab (D2). Authoritative when present;
  // null ⇒ resolveContext falls back to the advisory header role. Generic + best-effort: a
  // missing tab/sheet or a read failure returns null (never throws). Reads ITS OWN tracking
  // sheet, scoped by the authenticated companyId.
  const resolveRoleFromSheet = async (companyId: string, actorIdRaw: string | undefined): Promise<string | null> => {
    const actorId = actorIdRaw?.trim();
    if (!actorId || !app.companies.has(companyId)) return null;
    const sheetId = app.companies.get(companyId)!.resources.googleSheets?.hrRecruitmentSheetId;
    if (!sheetId) return null;
    return resolveActorRole(companyId, actorId, sheetId, app.connectors.sheets, app.logger);
  };

  // Authenticates a Sheet-backed beta token (D2): given a company + token hash, resolves the
  // active Users-tab row that carries it. Injected into resolveApiKeyIdentityAsync as the second
  // auth source (after config keys). Scoped per company to its own tracking sheet; best-effort
  // (a missing sheet/tab or read failure returns null → the token simply doesn't authenticate).
  const resolveUsersToken = async (companyId: string, tokenHash: string) => {
    if (!app.companies.has(companyId)) return null;
    const sheetId = app.companies.get(companyId)!.resources.googleSheets?.hrRecruitmentSheetId;
    if (!sheetId) return null;
    return resolveActorByToken(companyId, tokenHash, sheetId, app.connectors.sheets, app.logger);
  };

  // Anti-spoof: the tenant is the company the API key is bound to. If the caller also sends an
  // x-company-id, it must match — a mismatch is an attempt to act as another tenant (FORBIDDEN).
  const assertCompanyHeaderMatches = (companyId: string): void => {
    const claimed = headers.companyId?.trim();
    if (claimed && claimed !== companyId) {
      throw forbidden("x-company-id does not match the API key's company");
    }
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // API key both authenticates and selects the tenant; listing reflects that company's modules.
    const { companyId } = await resolveApiKeyIdentityAsync(headers.apiKey, app.companies, resolveUsersToken);
    const core = CORE_TOOLS.map((t) => ({ ...t, inputSchema: EMPTY_INPUT }));
    let business: { name: string; description: string; inputSchema: Record<string, unknown> }[] = [];
    try {
      assertCompanyHeaderMatches(companyId);
      // Tool visibility depends only on the company's enabled modules, NOT on the actor role,
      // so we skip the Users-tab read (resolveRoleFromSheet) here — it would add a Sheets
      // round-trip per handshake without changing the returned list.
      business = app.enabledToolsFor(companyId).map((rt) => ({
        name: rt.tool.name,
        description: rt.tool.description,
        inputSchema: toInputSchema(rt.tool.inputZod),
      }));
    } catch {
      // Company mismatch / lookup issue → core tools only.
    }
    return { tools: [...core, ...business] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    try {
      // Authentication precedes everything (SPEC §5 step 1). The key also binds the tenant
      // (and, for a per-actor claude.ai-web key, the actor identity).
      const { apiKeyId, companyId, actorId, actorRole } = await resolveApiKeyIdentityAsync(
        headers.apiKey,
        app.companies,
        resolveUsersToken,
      );

      if (name === "health_check") return ok(await healthCheck(app));
      if (name === "get_standard_version") return ok({ standardVersion: STANDARD_VERSION });

      assertCompanyHeaderMatches(companyId);
      // A per-actor key carries identity in the token (claude.ai web sends no x-actor-* headers);
      // a company-wide key relies on the headers (Claude Desktop). Either way identity is
      // resolved here at core/auth — never inferred in a handler.
      const effHeaders: IdentityHeaders = actorId
        ? { ...headers, actorId, actorRole: actorRole ?? headers.actorRole }
        : headers;
      const roleOverride = await resolveRoleFromSheet(companyId, effHeaders.actorId);
      const ctx = resolveContext(companyId, effHeaders, apiKeyId, app.companies, roleOverride);

      if (name === "list_available_business_tools") {
        return ok({
          tools: app.enabledToolsFor(ctx.companyId).map((rt) => ({
            name: rt.tool.name,
            description: rt.tool.description,
            permissionScope: rt.tool.permissionScope,
          })),
        });
      }

      // Business tool: must exist AND be enabled for the company.
      const resolved = app.tools.resolve(name);
      const enabled = app.enabledToolsFor(ctx.companyId).some((rt) => rt.tool.name === name);
      if (!resolved || !enabled) {
        return errResult("FORBIDDEN", `tool not available: ${name}`);
      }
      const result = await app.runtime.execute(resolved, ctx, args);
      return result.status === "success" ? ok(result) : errResult(
        (result.data.errorCode as string) ?? "INTERNAL",
        "tool returned an error",
      );
    } catch (e) {
      if (!(e instanceof AppError)) app.logger.error("unhandled tool error", { name, err: String(e) });
      const { code, message } = toClientError(e);
      return errResult(code, message);
    }
  });

  return server;
}

async function healthCheck(app: App) {
  const connectors: Record<string, boolean> = {};
  for (const c of Object.values(app.connectors)) {
    connectors[c.name] = (await c.healthCheck()).ok;
  }
  const modules: Record<string, boolean> = {};
  for (const m of app.modules.all()) {
    modules[m.moduleName] = (await m.healthCheck()).ok;
  }
  return { ok: true, standardVersion: STANDARD_VERSION, connectors, modules };
}

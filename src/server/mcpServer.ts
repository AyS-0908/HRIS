// Builds a per-request MCP server (stateless streamable HTTP). Identity is resolved
// from request headers; only the calling company's enabled tools are exposed.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { App } from "../app.js";
import { resolveApiKeyId } from "../core/auth/apiKey.js";
import { resolveContext, type IdentityHeaders } from "../core/auth/context.js";
import { resolveActorRole } from "../core/auth/resolveActorRole.js";
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
  // sheet, scoped by the validated companyId.
  const resolveRoleFromSheet = async (): Promise<string | null> => {
    const companyId = headers.companyId?.trim();
    const actorId = headers.actorId?.trim();
    if (!companyId || !actorId || !app.companies.has(companyId)) return null;
    const sheetId = app.companies.get(companyId)!.resources.googleSheets?.hrRecruitmentSheetId;
    if (!sheetId) return null;
    return resolveActorRole(companyId, actorId, sheetId, app.connectors.sheets, app.logger);
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // API key is always required; company identity only to list business tools.
    resolveApiKeyId(headers.apiKey, app.config.apiKey);
    const core = CORE_TOOLS.map((t) => ({ ...t, inputSchema: EMPTY_INPUT }));
    let business: { name: string; description: string; inputSchema: Record<string, unknown> }[] = [];
    try {
      // Tool visibility depends only on the company's enabled modules, NOT on the actor role,
      // so we skip the Users-tab read (resolveRoleFromSheet) here — it would add a Sheets
      // round-trip per handshake without changing the returned list.
      const ctx = resolveContext(headers, "listing", app.companies);
      business = app.enabledToolsFor(ctx.companyId).map((rt) => ({
        name: rt.tool.name,
        description: rt.tool.description,
        inputSchema: toInputSchema(rt.tool.inputZod),
      }));
    } catch {
      // No/invalid company header → core tools only.
    }
    return { tools: [...core, ...business] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    try {
      // Authentication precedes everything (SPEC §5 step 1).
      const apiKeyId = resolveApiKeyId(headers.apiKey, app.config.apiKey);

      if (name === "health_check") return ok(await healthCheck(app));
      if (name === "get_standard_version") return ok({ standardVersion: STANDARD_VERSION });

      const roleOverride = await resolveRoleFromSheet();
      const ctx = resolveContext(headers, apiKeyId, app.companies, roleOverride);

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

// Streamable HTTP transport (SPEC §1). Stateless: each POST /mcp gets a fresh
// server+transport so request identity (headers) is isolated per call.
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { App } from "../app.js";
import { buildServer } from "./mcpServer.js";

function headersFrom(req: Request) {
  const h = (name: string) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    apiKey: h("x-api-key"),
    companyId: h("x-company-id"),
    actorId: h("x-actor-id"),
    actorRole: h("x-actor-role"),
  };
}

export function createHttpApp(app: App) {
  const http = express();
  http.use(express.json());

  // Liveness probe for Coolify / load balancers.
  http.get("/healthz", (_req, res) => res.json({ ok: true }));

  http.post("/mcp", async (req: Request, res: Response) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildServer(app, headersFrom(req));
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      app.logger.error("mcp request failed", { err: String(e) });
      if (!res.headersSent) res.status(500).json({ error: "internal" });
    }
  });

  return http;
}

// Server-level integration for Users-tab beta tokens (D2). Drives the real MCP server built by
// buildServer over an in-process transport, exercising the full auth path: token → identity →
// RequestContext → runtime. Covers the SPEC auth_resolution_order and the no-regression cases
// (existing config actor key, existing company-wide key + headers).
import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildApp, type App } from "../../src/app.js";
import { buildServer } from "../../src/server/mcpServer.js";
import { hashApiKey } from "../../src/core/auth/apiKey.js";
import { __clearActorRoleCache } from "../../src/core/auth/resolveActorRole.js";
import type { IdentityHeaders } from "../../src/core/auth/context.js";

const SHEET = "example-recruitment-sheet-id"; // matches config/company.example.yaml
const TOKEN = "beta-token-abc";

// A Users tab whose single tester row carries `status` for the beta token. Header + one row.
function usersTab(status: string): string[][] {
  return [
    ["email", "role", "mcpKeyHash", "mcpKeyStatus", "mcpKeyCreatedAt"],
    ["tester@acme.test", "manager", hashApiKey(TOKEN), status, "2026-06-08T00:00:00Z"],
  ];
}

// Connects an MCP Client to a server built for these request headers (api key + identity).
async function connect(app: App, headers: IdentityHeaders & { apiKey?: string }): Promise<Client> {
  const server = buildServer(app, headers);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

// content[0].text holds the JSON payload (errResult on error; structuredContent mirrors it on ok).
function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

// Business tool results wrap the full ToolResult: `.data` holds the business fields.
function toolData(result: unknown): Record<string, unknown> {
  return payload(result).data as Record<string, unknown>;
}

let app: App;
beforeEach(() => {
  __clearActorRoleCache();
  app = buildApp({
    companyConfigPath: "config/company.example.yaml",
    logLevel: "error",
    googleConnectors: "simulated",
    storageBackend: "memory",
  });
});

describe("Users-tab beta token (server auth path)", () => {
  it("an active token lists the company's business tools (no headers, claude.ai-web style)", async () => {
    app.connectors.sheets.getValues = async () => ({ values: usersTab("active") });
    const client = await connect(app, { apiKey: TOKEN });

    const listed = await client.callTool({ name: "list_available_business_tools", arguments: {} });
    const tools = (payload(listed).tools as { name: string }[]).map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining([
        "submit_job_request",
        "generate_job_description",
        "approve_job_description",
        "get_recruitment_policy",
      ]),
    );
  });

  it("an active token runs submit → generate → approve", async () => {
    app.connectors.sheets.getValues = async () => ({ values: usersTab("active") });
    const client = await connect(app, { apiKey: TOKEN });

    const submit = toolData(
      await client.callTool({
        name: "submit_job_request",
        arguments: { title: "QA Engineer", justification: "growth", plannedHire: true },
      }),
    );
    const id = submit.processInstanceId as string;
    expect(submit.status).toBe("pending_manager_validation");

    const gen = toolData(
      await client.callTool({
        name: "generate_job_description",
        arguments: { processInstanceId: id, idempotencyKey: "g1", targetSummary: "owns QA" },
      }),
    );
    expect(gen.docId).toBeTruthy();

    const approve = toolData(
      await client.callTool({
        name: "approve_job_description",
        arguments: { processInstanceId: id, idempotencyKey: "a1", jobTitle: "QA Engineer" },
      }),
    );
    expect(approve.status).toBe("approved");
  });

  it("a revoked token is UNAUTHENTICATED", async () => {
    app.connectors.sheets.getValues = async () => ({ values: usersTab("revoked") });
    const client = await connect(app, { apiKey: TOKEN });

    const res = await client.callTool({ name: "submit_job_request", arguments: { title: "x", justification: "y", plannedHire: true } });
    expect(res.isError).toBe(true);
    expect(payload(res).errorCode).toBe("UNAUTHENTICATED");
  });

  it("existing config actor key still works (no Sheet token needed)", async () => {
    // Inject a per-actor config key into the loaded registry (the YAML path, SPEC §2).
    const acme = app.companies.get("acme")!;
    acme.auth = { ...acme.auth, actorKeys: [{ keyHash: hashApiKey("cfg-token"), actorId: "cfg@acme.test", role: "manager" }] };
    const client = await connect(app, { apiKey: "cfg-token" });

    const submit = toolData(
      await client.callTool({
        name: "submit_job_request",
        arguments: { title: "Role", justification: "j", plannedHire: false },
      }),
    );
    expect(submit.status).toBe("pending_manager_validation");
  });

  it("existing company-wide key + actor headers still works (Claude Desktop path)", async () => {
    // dev-acme-key is the example config's company-wide key; identity comes from headers.
    const client = await connect(app, { apiKey: "dev-acme-key", actorId: "drh@acme.test", actorRole: "manager" });

    const submit = toolData(
      await client.callTool({
        name: "submit_job_request",
        arguments: { title: "Role", justification: "j", plannedHire: false },
      }),
    );
    expect(submit.status).toBe("pending_manager_validation");
  });
});

// Config guard for live Docs (plan P0.3 — fail loud, never a fake URL). In live mode the
// whole point of generate_job_description is a REAL shared doc, so:
//  - both template + folder absent  ⇒ VALIDATION_ERROR (not a silent simulated URL).
//  - exactly one present (XOR)       ⇒ VALIDATION_ERROR (misconfiguration).
// Uses a fake service account: the guard throws before any live API call.
import { describe, it, expect } from "vitest";
import { buildApp, type App } from "../../src/app.js";
import type { RequestContext } from "../../src/shared/types/contracts.js";
import { AppError } from "../../src/core/errors/appError.js";

const FAKE_SA = JSON.stringify({ client_email: "svc@example.iam.gserviceaccount.com", private_key: "fake" });
const ctx: RequestContext = { companyId: "acme", actorId: "u1", actorRole: "manager", apiKeyId: "test" };

const resolve = (app: App, name: string) => {
  const r = app.tools.resolve(name);
  if (!r) throw new Error(`tool not found: ${name}`);
  return r;
};

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "<no-throw>";
  } catch (e) {
    return e instanceof AppError ? e.code : "<non-app-error>";
  }
}

function liveApp(companyConfigPath: string): App {
  return buildApp({
    apiKey: "test",
    companyConfigPath,
    logLevel: "error",
    googleConnectors: "live",
    storageBackend: "memory",
    serviceAccountJson: FAKE_SA,
  });
}

async function startInstance(app: App): Promise<string> {
  const submit = await app.runtime.execute(resolve(app, "submit_job_request"), ctx, {
    title: "Role",
    justification: "j",
    plannedHire: true,
  });
  return submit.data.processInstanceId as string;
}

describe("live Docs config guard", () => {
  it("both template+folder absent ⇒ VALIDATION_ERROR in live mode (no fake URL)", async () => {
    const app = liveApp("tests/fixtures/company.docs-none.yaml"); // both Docs ids ""
    const id = await startInstance(app);
    const code = await codeOf(
      app.runtime.execute(resolve(app, "generate_job_description"), ctx, {
        processInstanceId: id,
        idempotencyKey: "g1",
        targetSummary: "x",
      }),
    );
    expect(code).toBe("VALIDATION_ERROR");
  });

  it("only template set (XOR) ⇒ VALIDATION_ERROR with a clear message", async () => {
    const app = liveApp("tests/fixtures/company.docs-partial.yaml");
    const id = await startInstance(app);
    const code = await codeOf(
      app.runtime.execute(resolve(app, "generate_job_description"), ctx, {
        processInstanceId: id,
        idempotencyKey: "g2",
        targetSummary: "x",
      }),
    );
    expect(code).toBe("VALIDATION_ERROR");
  });
});

// End-to-end runtime test for hr.recruitment "Fiche poste" (SPEC §15 items 6–10, 12).
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp, type App } from "../../src/app.js";
import type { RequestContext } from "../../src/shared/types/contracts.js";
import { InMemoryStorageAdapter } from "../../src/storage/inMemoryAdapter.js";
import { AppError } from "../../src/core/errors/appError.js";

// `auditFor` is an inspection helper on the in-memory impl, not on the StorageAdapter
// interface. V1 always wires the in-memory adapter, so narrowing here is safe.
const auditFor = (app: App, instanceId: string) =>
  (app.storage as InMemoryStorageAdapter).auditFor(instanceId);

const ctx = (role: string, actorId = "u1"): RequestContext => ({
  companyId: "acme",
  actorId,
  actorRole: role,
  apiKeyId: "test",
});

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

let app: App;
beforeEach(() => {
  app = buildApp({
    apiKey: "test",
    companyConfigPath: "config/company.example.yaml",
    logLevel: "error",
    googleConnectors: "simulated",
  });
});

describe("hr.recruitment Fiche poste", () => {
  it("runs submit → generate → approve and advances status with audit", async () => {
    const submit = await app.runtime.execute(resolve(app, "submit_job_request"), ctx("manager"), {
      title: "Backend Engineer",
      justification: "Team growth",
      plannedHire: true,
    });
    expect(submit.status).toBe("success");
    const instanceId = submit.data.processInstanceId as string;
    expect(submit.data.status).toBe("pending_manager_validation");

    const gen = await app.runtime.execute(resolve(app, "generate_job_description"), ctx("manager"), {
      processInstanceId: instanceId,
      idempotencyKey: "gen-1",
      targetSummary: "Owns the API layer",
    });
    expect(gen.status).toBe("success");
    expect(gen.data.status).toBe("pending_manager_validation"); // recommendation: unchanged
    expect(gen.data.docId).toBeTruthy();

    const approve = await app.runtime.execute(resolve(app, "approve_job_description"), ctx("manager"), {
      processInstanceId: instanceId,
      idempotencyKey: "appr-1",
      jobTitle: "Backend Engineer",
      docUrl: gen.data.url as string,
    });
    expect(approve.status).toBe("success");
    expect(approve.data.status).toBe("approved");
    expect(approve.data.rowId).toBeTruthy();

    const audit = auditFor(app, instanceId);
    expect(audit.length).toBe(3);
    expect(audit.at(-1)?.statusAfter).toBe("approved");
  });

  it("rejects bad input with VALIDATION_ERROR", async () => {
    expect(await codeOf(app.runtime.execute(resolve(app, "submit_job_request"), ctx("manager"), {}))).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("blocks non-manager approval (human validation checkpoint → FORBIDDEN)", async () => {
    const submit = await app.runtime.execute(resolve(app, "submit_job_request"), ctx("manager"), {
      title: "Role",
      justification: "j",
      plannedHire: false,
    });
    const id = submit.data.processInstanceId as string;
    const code = await codeOf(
      app.runtime.execute(resolve(app, "approve_job_description"), ctx("employee"), {
        processInstanceId: id,
        idempotencyKey: "x",
        jobTitle: "Role",
        docUrl: "u",
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("rejects a tool when status is not allowed (INVALID_STATE)", async () => {
    const submit = await app.runtime.execute(resolve(app, "submit_job_request"), ctx("manager"), {
      title: "Role",
      justification: "j",
      plannedHire: false,
    });
    const id = submit.data.processInstanceId as string;
    await app.runtime.execute(resolve(app, "approve_job_description"), ctx("manager"), {
      processInstanceId: id,
      idempotencyKey: "a1",
      jobTitle: "Role",
      docUrl: "u",
    });
    // status now 'approved' → generate (needs 'pending_manager_validation') is invalid
    const code = await codeOf(
      app.runtime.execute(resolve(app, "generate_job_description"), ctx("manager"), {
        processInstanceId: id,
        idempotencyKey: "g2",
        targetSummary: "x",
      }),
    );
    expect(code).toBe("INVALID_STATE");
  });

  it("idempotent re-call returns the prior result without a duplicate side effect", async () => {
    const submit = await app.runtime.execute(resolve(app, "submit_job_request"), ctx("manager"), {
      title: "Role",
      justification: "j",
      plannedHire: false,
    });
    const id = submit.data.processInstanceId as string;
    const first = await app.runtime.execute(resolve(app, "generate_job_description"), ctx("manager"), {
      processInstanceId: id,
      idempotencyKey: "same",
      targetSummary: "x",
    });
    const second = await app.runtime.execute(resolve(app, "generate_job_description"), ctx("manager"), {
      processInstanceId: id,
      idempotencyKey: "same",
      targetSummary: "x",
    });
    expect(second.data.docId).toBe(first.data.docId);
    // submit + first generate audited; the idempotent short-circuit emits no new audit
    expect(auditFor(app, id).length).toBe(2);
  });
});

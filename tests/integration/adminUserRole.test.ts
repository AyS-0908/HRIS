// Role authorization for hr.recruitment, focused on the `admin_user` beta role.
// permissionScope is the single source of role authorization (no per-tool requiredRole), so
// these prove admin_user has full tool access while manager/hr_admin behavior is preserved and
// unknown/insufficient roles stay FORBIDDEN. Google Drive/Sheets access is separate (Google
// sharing) and not exercised here.
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp, type App } from "../../src/app.js";
import type { RequestContext } from "../../src/shared/types/contracts.js";
import { AppError } from "../../src/core/errors/appError.js";

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
    companyConfigPath: "config/company.example.yaml",
    logLevel: "error",
    googleConnectors: "simulated",
    storageBackend: "memory",
  });
});

describe("admin_user role — full HR recruitment access", () => {
  it("admin_user runs submit → generate → approve and reads policy", async () => {
    const submit = await app.runtime.execute(resolve(app, "submit_job_request"), ctx("admin_user"), {
      title: "Backend Engineer",
      justification: "Team growth",
      plannedHire: true,
    });
    expect(submit.status).toBe("success");
    const id = submit.data.processInstanceId as string;
    expect(submit.data.status).toBe("pending_manager_validation");

    const gen = await app.runtime.execute(resolve(app, "generate_job_description"), ctx("admin_user"), {
      processInstanceId: id,
      idempotencyKey: "gen-admin",
      targetSummary: "Owns the API layer",
    });
    expect(gen.status).toBe("success");
    expect(gen.data.docId).toBeTruthy();

    const approve = await app.runtime.execute(resolve(app, "approve_job_description"), ctx("admin_user"), {
      processInstanceId: id,
      idempotencyKey: "appr-admin",
      jobTitle: "Backend Engineer",
      docUrl: gen.data.url as string,
    });
    expect(approve.status).toBe("success");
    expect(approve.data.status).toBe("approved");
    expect(approve.data.rowId).toBeTruthy();

    const policy = await app.runtime.execute(resolve(app, "get_recruitment_policy"), ctx("admin_user"), {});
    expect(policy.status).toBe("success");
    expect(policy.data.policy).toBeTruthy();
  });

  it("an admin_user row in the Users tab receives the approve notification (full-flow test)", async () => {
    // admin_user is a test role: it must get the approve email so the operator can verify the
    // whole flow, including the notification — same as hr_admin.
    app.connectors.sheets.getValues = async () => ({
      values: [["email", "role"], ["tester@acme.test", "admin_user"]],
    });
    const submit = await app.runtime.execute(resolve(app, "submit_job_request"), ctx("admin_user"), {
      title: "Role",
      justification: "j",
      plannedHire: true,
    });
    const id = submit.data.processInstanceId as string;
    await app.runtime.execute(resolve(app, "generate_job_description"), ctx("admin_user"), {
      processInstanceId: id,
      idempotencyKey: "gen-notify",
      targetSummary: "x",
    });
    const approve = await app.runtime.execute(resolve(app, "approve_job_description"), ctx("admin_user"), {
      processInstanceId: id,
      idempotencyKey: "appr-notify",
      jobTitle: "Role",
    });
    expect(approve.status).toBe("success");
    expect(approve.data.messageId).toBeTruthy(); // a recipient resolved ⇒ an email was sent
  });
});

describe("hr.recruitment role authorization matrix (preserved behavior)", () => {
  // Each scope's allowed roles must still hold after introducing admin_user.
  it("manager keeps full submit/generate/approve/policy access", async () => {
    const submit = await app.runtime.execute(resolve(app, "submit_job_request"), ctx("manager"), {
      title: "Role",
      justification: "j",
      plannedHire: true,
    });
    expect(submit.status).toBe("success");
    const id = submit.data.processInstanceId as string;
    const gen = await app.runtime.execute(resolve(app, "generate_job_description"), ctx("manager"), {
      processInstanceId: id,
      idempotencyKey: "g",
      targetSummary: "x",
    });
    expect(gen.status).toBe("success");
    const approve = await app.runtime.execute(resolve(app, "approve_job_description"), ctx("manager"), {
      processInstanceId: id,
      idempotencyKey: "a",
      jobTitle: "Role",
    });
    expect(approve.status).toBe("success");
  });

  it("hr_admin may generate and read policy", async () => {
    // Set up an instance with a manager, then hr_admin generates against it.
    const submit = await app.runtime.execute(resolve(app, "submit_job_request"), ctx("manager"), {
      title: "Role",
      justification: "j",
      plannedHire: true,
    });
    const id = submit.data.processInstanceId as string;
    const gen = await app.runtime.execute(resolve(app, "generate_job_description"), ctx("hr_admin"), {
      processInstanceId: id,
      idempotencyKey: "g-hr",
      targetSummary: "x",
    });
    expect(gen.status).toBe("success");
    const policy = await app.runtime.execute(resolve(app, "get_recruitment_policy"), ctx("hr_admin"), {});
    expect(policy.status).toBe("success");
  });

  it("hr_admin may NOT submit or approve (FORBIDDEN)", async () => {
    // Permission (step 2) is checked before the status gate (step 4), so no instance is needed.
    expect(
      await codeOf(
        app.runtime.execute(resolve(app, "submit_job_request"), ctx("hr_admin"), {
          title: "Role",
          justification: "j",
          plannedHire: true,
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await codeOf(
        app.runtime.execute(resolve(app, "approve_job_description"), ctx("hr_admin"), {
          processInstanceId: "any",
          idempotencyKey: "x",
          jobTitle: "Role",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("unknown/insufficient role (employee) is FORBIDDEN on every tool", async () => {
    for (const tool of [
      "submit_job_request",
      "generate_job_description",
      "approve_job_description",
      "get_recruitment_policy",
    ]) {
      expect(await codeOf(app.runtime.execute(resolve(app, tool), ctx("employee"), {}))).toBe("FORBIDDEN");
    }
  });
});

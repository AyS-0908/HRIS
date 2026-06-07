// Concurrency hardening (multi-user): the runtime serializes same-instance contenders via
// a per-(company,instance) LockProvider, so two requests racing on the same process cannot
// both pass the status gate and run the side effect twice. Different instances must NOT
// serialize (no latency regression). Runs against the in-memory adapter, whose async
// methods yield at awaits — enough for two executions to interleave without the lock.
//
// The decisive observable is the approve side effect (a single rec_jobDesc row append): the
// bug being closed is a DUPLICATE side effect, so the tests count appendRow calls and prove
// (via a barrier) that distinct instances actually overlap inside that side effect.
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp, type App } from "../../src/app.js";
import type { RequestContext } from "../../src/shared/types/contracts.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

const submit = async (app: App): Promise<string> => {
  const r = await app.runtime.execute(resolve(app, "submit_job_request"), ctx("manager"), {
    title: "Backend Engineer",
    justification: "Team growth",
    plannedHire: true,
  });
  return r.data.processInstanceId as string;
};

const approve = (app: App, instanceId: string, idemKey: string) =>
  app.runtime.execute(resolve(app, "approve_job_description"), ctx("manager"), {
    processInstanceId: instanceId,
    idempotencyKey: idemKey,
    jobTitle: "Backend Engineer",
    docUrl: "https://docs.example/doc",
  });

let app: App;
beforeEach(() => {
  app = buildApp({
    companyConfigPath: "config/company.example.yaml",
    logLevel: "error",
    googleConnectors: "simulated",
    storageBackend: "memory",
  });
});

describe("runtime same-instance concurrency", () => {
  it("serializes two concurrent approvals on the same instance: one wins, ONE side effect", async () => {
    const id = await submit(app);

    // Count the approve side effect (rec_jobDesc row append). The loser must fail the status
    // gate BEFORE its handler runs, so the row is appended exactly once.
    let appendCount = 0;
    const origAppend = app.connectors.sheets.appendRow.bind(app.connectors.sheets);
    app.connectors.sheets.appendRow = async (input, idem) => {
      appendCount += 1;
      return origAppend(input, idem);
    };

    // Distinct idempotency keys, so the idempotency store cannot mask the race — only the
    // lock + status gate can. With the lock, the loser sees status=approved → INVALID_STATE.
    const [r1, r2] = await Promise.allSettled([
      approve(app, id, "appr-a"),
      approve(app, id, "appr-b"),
    ]);

    const statuses = [r1, r2].map((r) => r.status);
    expect(statuses.filter((s) => s === "fulfilled")).toHaveLength(1);
    expect(statuses.filter((s) => s === "rejected")).toHaveLength(1);

    const loser = (r1.status === "rejected" ? r1 : r2.status === "rejected" ? r2 : null)!;
    expect((loser.reason as { code?: string }).code).toBe("INVALID_STATE");

    // The decisive assertion: no duplicate side effect, and storage holds a single approval.
    expect(appendCount).toBe(1);
    const final = await app.storage.getInstance("acme", id);
    expect(final?.currentStatus).toBe("approved");
  });

  it("runs approvals on DIFFERENT instances concurrently (proves no global lock)", async () => {
    const [idA, idB] = await Promise.all([submit(app), submit(app)]);

    // Barrier inside the side effect: each handler enters appendRow and waits until BOTH are
    // inside at once. Per-instance locks let that happen (maxActive reaches 2). A regression
    // to one global runtime lock would admit only one handler at a time → maxActive stays 1,
    // and the bounded fallback below makes the test fail on the assertion instead of hanging.
    let active = 0;
    let maxActive = 0;
    let releaseBoth!: () => void;
    const bothInside = new Promise<void>((r) => (releaseBoth = r));
    const origAppend = app.connectors.sheets.appendRow.bind(app.connectors.sheets);
    app.connectors.sheets.appendRow = async (input, idem) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active >= 2) releaseBoth();
      await Promise.race([bothInside, delay(500)]);
      active -= 1;
      return origAppend(input, idem);
    };

    const [a, b] = await Promise.all([approve(app, idA, "a"), approve(app, idB, "b")]);
    expect(a.status).toBe("success");
    expect(b.status).toBe("success");
    expect(a.data.status).toBe("approved");
    expect(b.data.status).toBe("approved");
    expect(maxActive).toBe(2); // both handlers were inside the side effect simultaneously
  });
});

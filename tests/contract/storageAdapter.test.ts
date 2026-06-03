// StorageAdapter conformance (SPEC §4.2 / §15.11): any backend must satisfy the same
// create → get → update → audit contract. Runs against the in-memory adapter by default
// (simulated). The factory is parameterized so a live Sheets adapter could be added later
// behind an env opt-in, exercising the exact same assertions.
import { describe, it, expect, beforeEach } from "vitest";
import type { AuditEvent, ProcessState, StorageAdapter } from "../../src/shared/types/contracts.js";
import { InMemoryStorageAdapter } from "../../src/storage/inMemoryAdapter.js";
import { AppError } from "../../src/core/errors/appError.js";

const seed = (id: string): Omit<ProcessState, "updatedAt" | "auditLogId"> => ({
  processInstanceId: id,
  processId: "hr.recruitment",
  companyId: "acme",
  currentStatus: "pending_manager_validation",
  currentStep: "submitted",
  createdBy: "u1",
  createdAt: "2026-06-03T00:00:00.000Z",
  lastToolCalled: "submit_job_request",
  externalReferences: { doc: "doc-1" },
});

const auditFor = (id: string): AuditEvent => ({
  auditLogId: "a1",
  timestamp: "2026-06-03T00:00:01.000Z",
  companyId: "acme",
  processId: "hr.recruitment",
  processInstanceId: id,
  toolName: "submit_job_request",
  actorRole: "manager",
  actorId: "u1",
  inputSummary: { title: "Backend Engineer" },
  externalOutputs: { docId: "doc-1" },
  statusBefore: "", // runtime emits "" (no prior status) for a creator tool — match it
  statusAfter: "pending_manager_validation",
  result: "success",
  errorCode: null,
});

function runStorageConformance(name: string, makeAdapter: () => StorageAdapter): void {
  describe(`StorageAdapter conformance: ${name}`, () => {
    let storage: StorageAdapter;
    beforeEach(() => {
      storage = makeAdapter();
    });

    it("createInstance fills updatedAt/auditLogId and round-trips via getInstance", async () => {
      const created = await storage.createInstance(seed("p1"));
      expect(created.updatedAt).toBeTruthy();
      expect(created.auditLogId).toBeTruthy();
      const loaded = await storage.getInstance("acme", "p1");
      expect(loaded).not.toBeNull();
      expect(loaded?.currentStatus).toBe("pending_manager_validation");
      expect(loaded?.externalReferences).toEqual({ doc: "doc-1" });
    });

    it("getInstance returns null for an unknown instance", async () => {
      expect(await storage.getInstance("acme", "missing")).toBeNull();
    });

    it("updateStatus advances status and bumps updatedAt", async () => {
      const created = await storage.createInstance(seed("p2"));
      const updated = await storage.updateStatus("acme", "p2", {
        currentStatus: "approved",
        currentStep: "approved",
        lastToolCalled: "approve_job_description",
      });
      expect(updated.currentStatus).toBe("approved");
      expect(updated.lastToolCalled).toBe("approve_job_description");
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updatedAt).getTime(),
      );
      const loaded = await storage.getInstance("acme", "p2");
      expect(loaded?.currentStatus).toBe("approved");
    });

    it("updateStatus on a missing instance throws INVALID_STATE", async () => {
      let code = "<no-throw>";
      try {
        await storage.updateStatus("acme", "missing", {
          currentStatus: "approved",
          currentStep: "approved",
          lastToolCalled: "approve_job_description",
        });
      } catch (e) {
        code = e instanceof AppError ? e.code : "<non-app-error>";
      }
      expect(code).toBe("INVALID_STATE");
    });

    it("appendAudit accepts an event", async () => {
      await expect(storage.appendAudit(auditFor("p3"))).resolves.toBeUndefined();
    });
  });
}

runStorageConformance("InMemoryStorageAdapter", () => new InMemoryStorageAdapter());

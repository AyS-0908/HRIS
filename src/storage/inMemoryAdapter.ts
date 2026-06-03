// V1 reference storage path: in-memory (optionally JSON-file backed).
// The runtime depends only on StorageAdapter; this is swappable without core edits.
// SPEC §4.2, §15.11. The Google Sheets adapter is the deferred reference impl.
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import type {
  AuditEvent,
  ProcessState,
  StorageAdapter,
} from "../shared/types/contracts.js";
import { invalidState } from "../core/errors/appError.js";

const key = (companyId: string, instanceId: string) => `${companyId}:${instanceId}`;

export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly instances = new Map<string, ProcessState>();
  private readonly audit: AuditEvent[] = [];

  // Optional JSON persistence path. When set, state survives restarts.
  constructor(private readonly persistPath?: string) {
    if (persistPath && existsSync(persistPath)) {
      try {
        const data = JSON.parse(readFileSync(persistPath, "utf8")) as {
          instances?: ProcessState[];
          audit?: AuditEvent[];
        };
        for (const s of data.instances ?? []) this.instances.set(key(s.companyId, s.processInstanceId), s);
        if (data.audit) this.audit.push(...data.audit);
      } catch {
        // Corrupt/absent file: start empty rather than crash.
      }
    }
  }

  async createInstance(
    s: Omit<ProcessState, "updatedAt" | "auditLogId">,
  ): Promise<ProcessState> {
    const now = new Date().toISOString();
    const state: ProcessState = { ...s, updatedAt: now, auditLogId: randomUUID() };
    this.instances.set(key(state.companyId, state.processInstanceId), state);
    this.flush();
    return state;
  }

  async getInstance(
    companyId: string,
    processInstanceId: string,
  ): Promise<ProcessState | null> {
    return this.instances.get(key(companyId, processInstanceId)) ?? null;
  }

  async updateStatus(
    companyId: string,
    processInstanceId: string,
    patch: Pick<ProcessState, "currentStatus" | "currentStep" | "lastToolCalled">,
  ): Promise<ProcessState> {
    const k = key(companyId, processInstanceId);
    const prev = this.instances.get(k);
    if (!prev) throw invalidState(`instance not found: ${processInstanceId}`);
    const next: ProcessState = { ...prev, ...patch, updatedAt: new Date().toISOString() };
    this.instances.set(k, next);
    this.flush();
    return next;
  }

  async appendAudit(e: AuditEvent): Promise<void> {
    this.audit.push(e);
    this.flush();
  }

  // Test/inspection helper (not part of StorageAdapter).
  auditFor(processInstanceId: string): AuditEvent[] {
    return this.audit.filter((e) => e.processInstanceId === processInstanceId);
  }

  private flush(): void {
    if (!this.persistPath) return;
    writeFileSync(
      this.persistPath,
      JSON.stringify({ instances: [...this.instances.values()], audit: this.audit }, null, 2),
    );
  }
}

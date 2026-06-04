// THE ONLY place process/status logic lives (SPEC §5). Handlers never re-check
// auth, permissions, status gates, or idempotency — this runtime does, in order.
import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  AuditLevel,
  Connectors,
  Logger,
  ProcessState,
  RequestContext,
  ServiceDeps,
  StorageAdapter,
  ToolResult,
} from "../shared/types/contracts.js";
import type { ResolvedTool } from "../registry/toolRegistry.js";
import type { CompanyRegistry } from "../core/config/loadCompany.js";
import type { IdempotencyStore } from "./idempotencyStore.js";
import { assertPermission } from "../core/permissions/check.js";
import { redactForAudit } from "../core/validation/redact.js";
import {
  AppError,
  forbidden,
  internalError,
  invalidState,
  toClientError,
  validationError,
} from "../core/errors/appError.js";

export interface RuntimeDeps {
  storage: StorageAdapter;
  connectors: Connectors;
  logger: Logger;
  idempotency: IdempotencyStore;
  companies: CompanyRegistry;
  // Connector mode, threaded to services via ServiceDeps. Defaults to "simulated".
  googleMode?: "simulated" | "live";
}

const LEVEL_ORDER: Record<AuditLevel, number> = { none: 0, standard: 1, strict: 2 };
function maxLevel(a: AuditLevel, b: AuditLevel): AuditLevel {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

export class ProcessRuntime {
  constructor(private readonly deps: RuntimeDeps) {}

  // Executes a process tool through the fixed §5 order. Throws AppError on a gate
  // failure; returns the handler's ToolResult otherwise. Audit is emitted always.
  async execute(
    resolved: ResolvedTool,
    ctx: RequestContext,
    rawInput: unknown,
  ): Promise<ToolResult> {
    const { tool, module } = resolved;
    const pb = tool.process;
    if (!pb) {
      // Non-process query tool (read-only, e.g. get_recruitment_policy): no instance, no
      // status gate, no idempotency, no audit. Authentication already happened at the
      // server boundary; we still enforce permission + input validation, then run the
      // handler. The process tools never reach this path (they all carry a binding).
      return await this.executeQueryTool(resolved, ctx, rawInput);
    }
    const auditRequired = module.processDefinition?.auditRequired ?? false;
    const effectiveLevel = maxLevel(pb.auditLevel, auditRequired ? "standard" : "none");

    const isCreator = pb.allowedStatusesBefore.length === 0;
    const externalOutputs: Record<string, string> = {};
    const recordExternal = (k: string, id: string) => {
      externalOutputs[k] = id;
    };

    let instance: ProcessState | null = null;
    let statusBefore = "";
    let statusAfter = "";
    let result: ToolResult = { status: "error", data: {}, traceIds: [] };
    let errorCode: string | null = null;
    let inputSummary: Record<string, unknown> = {};
    let thrown: unknown = null;
    let shortCircuited = false;

    try {
      // 2. permission
      assertPermission(tool.permissionScope, ctx.actorRole, module.permissionRules);
      if (pb.requiredRole && ctx.actorRole !== pb.requiredRole) {
        throw forbidden(`tool ${tool.name} requires role ${pb.requiredRole}`);
      }

      // 3. validate input
      const parsed = tool.inputZod.safeParse(rawInput);
      if (!parsed.success) {
        throw validationError(`invalid input for ${tool.name}`, parsed.error.flatten());
      }
      const input = parsed.data;
      inputSummary = redactForAudit(input);
      const meta = input as { processInstanceId?: string; idempotencyKey?: string };
      const idemKey = meta.idempotencyKey ?? "";
      // Scope dedup to the instance: idempotent tools are all non-creators, so
      // processInstanceId is present once the status gate (step 4) has run. Without it,
      // two instances reusing the same key would collide (B gets A's prior result).
      const idemScope = `${ctx.companyId}:${tool.name}:${meta.processInstanceId ?? ""}:${idemKey}`;

      // 4. load/create instance + status gate
      if (isCreator) {
        instance = await this.deps.storage.createInstance({
          processInstanceId: randomUUID(),
          processId: pb.processId,
          companyId: ctx.companyId,
          currentStatus: pb.statusAfterSuccess,
          currentStep: tool.name,
          createdBy: ctx.actorId,
          createdAt: new Date().toISOString(),
          lastToolCalled: tool.name,
          externalReferences: {},
        });
        statusAfter = instance.currentStatus;
      } else {
        if (!meta.processInstanceId) {
          throw validationError(`processInstanceId required for ${tool.name}`);
        }
        instance = await this.deps.storage.getInstance(ctx.companyId, meta.processInstanceId);
        if (!instance) {
          throw invalidState(`process instance not found: ${meta.processInstanceId}`);
        }
        statusBefore = instance.currentStatus;
        if (!pb.allowedStatusesBefore.includes(instance.currentStatus)) {
          throw invalidState(
            `status ${instance.currentStatus} not in [${pb.allowedStatusesBefore.join(", ")}]`,
          );
        }
        statusAfter = statusBefore;
      }

      // 5. idempotency short-circuit
      if (pb.idempotent) {
        if (!idemKey) {
          throw validationError(`idempotencyKey required for idempotent tool ${tool.name}`);
        }
        const prior = this.deps.idempotency.get(idemScope);
        if (prior) {
          this.deps.logger.info("idempotent short-circuit", { tool: tool.name });
          shortCircuited = true;
          result = prior;
          errorCode = null;
          return prior;
        }
      }

      // 6. run handler (side effects happen here, via services → connectors)
      const sdeps: ServiceDeps = {
        storage: this.deps.storage,
        connectors: this.deps.connectors,
        services: module.serviceBindings,
        logger: this.deps.logger,
        recordExternal,
        idempotencyKey: idemKey,
        ctx,
        process: instance,
        resources: this.deps.companies.get(ctx.companyId)?.resources ?? {},
        googleMode: this.deps.googleMode ?? "simulated",
      };
      const handlerResult = await tool.handler(ctx, input, sdeps);

      // 7. on success, update status (creator already created at target status). Merge any
      // external ids recorded by the handler into the persisted externalReferences so later
      // steps in the same process can read them (e.g. the real docUrl at approve time).
      if (handlerResult.status === "success" && !isCreator) {
        const hasOutputs = Object.keys(externalOutputs).length > 0;
        instance = await this.deps.storage.updateStatus(ctx.companyId, instance.processInstanceId, {
          currentStatus: pb.statusAfterSuccess,
          currentStep: tool.name,
          lastToolCalled: tool.name,
          ...(hasOutputs
            ? { externalReferences: { ...instance.externalReferences, ...externalOutputs } }
            : {}),
        });
        statusAfter = instance.currentStatus;
      }
      if (handlerResult.status === "error") {
        errorCode = (handlerResult.data.errorCode as string | undefined) ?? "INTERNAL";
        statusAfter = statusBefore || statusAfter;
      }

      const traceIds = handlerResult.traceIds.length
        ? handlerResult.traceIds
        : Object.values(externalOutputs);
      result = {
        status: handlerResult.status,
        data: {
          ...handlerResult.data,
          processInstanceId: instance.processInstanceId,
          status: statusAfter,
        },
        traceIds,
      };

      if (pb.idempotent && idemKey && result.status === "success") {
        this.deps.idempotency.set(idemScope, result);
      }
      return result;
    } catch (err) {
      thrown = err;
      errorCode = toClientError(err).code;
      // Reflect the instance's actual persisted status. For a non-creator this equals
      // statusBefore (updateStatus only runs on success). For a creator the instance was
      // already created at statusAfterSuccess before the handler ran, so the audit must
      // show that — not "" — to stay consistent with storage.
      statusAfter = instance?.currentStatus ?? statusBefore;
      result = { status: "error", data: { errorCode }, traceIds: [] };
      throw err instanceof AppError ? err : internalError(String(err));
    } finally {
      // 8. emit AuditEvent (always; even on error) per resolved level.
      // A pure idempotent short-circuit performs no new action → no new audit.
      if (effectiveLevel !== "none" && !shortCircuited) {
        const event: AuditEvent = {
          auditLogId: instance?.auditLogId ?? randomUUID(),
          timestamp: new Date().toISOString(),
          companyId: ctx.companyId,
          processId: pb.processId,
          processInstanceId: instance?.processInstanceId ?? "",
          toolName: tool.name,
          actorRole: ctx.actorRole,
          actorId: ctx.actorId,
          inputSummary,
          externalOutputs,
          statusBefore,
          statusAfter,
          result: thrown || result.status === "error" ? "error" : "success",
          errorCode: thrown || result.status === "error" ? errorCode : null,
        };
        try {
          await this.deps.storage.appendAudit(event);
        } catch (e) {
          this.deps.logger.error("audit append failed", { err: String(e) });
        }
      }
    }
  }

  // Read-only query tools (no process binding). Permission + input validation only; the
  // handler gets a ServiceDeps with a placeholder process (it never reads instance state).
  private async executeQueryTool(
    resolved: ResolvedTool,
    ctx: RequestContext,
    rawInput: unknown,
  ): Promise<ToolResult> {
    const { tool, module } = resolved;
    assertPermission(tool.permissionScope, ctx.actorRole, module.permissionRules);
    const parsed = tool.inputZod.safeParse(rawInput);
    if (!parsed.success) {
      throw validationError(`invalid input for ${tool.name}`, parsed.error.flatten());
    }
    const placeholder: ProcessState = {
      processInstanceId: "",
      processId: "",
      companyId: ctx.companyId,
      currentStatus: "",
      currentStep: "",
      createdBy: ctx.actorId,
      createdAt: "",
      updatedAt: "",
      lastToolCalled: tool.name,
      externalReferences: {},
      auditLogId: "",
    };
    const sdeps: ServiceDeps = {
      storage: this.deps.storage,
      connectors: this.deps.connectors,
      services: module.serviceBindings,
      logger: this.deps.logger,
      recordExternal: () => {},
      idempotencyKey: "",
      ctx,
      process: placeholder,
      resources: this.deps.companies.get(ctx.companyId)?.resources ?? {},
      googleMode: this.deps.googleMode ?? "simulated",
    };
    return await tool.handler(ctx, parsed.data, sdeps);
  }
}

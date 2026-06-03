// Indexes process definitions by processId (SPEC §3, §4.6).
import type { ModuleContract, ProcessDefinition } from "../shared/types/contracts.js";
import type { ModuleRegistry } from "./moduleRegistry.js";

export interface ResolvedProcess {
  processDefinition: ProcessDefinition;
  module: ModuleContract;
}

export class ProcessRegistry {
  private readonly byId = new Map<string, ResolvedProcess>();

  constructor(modules: ModuleRegistry) {
    for (const module of modules.all()) {
      const def = module.processDefinition;
      if (!def) continue;
      if (this.byId.has(def.processId)) {
        throw new Error(`duplicate processId: ${def.processId}`);
      }
      this.byId.set(def.processId, { processDefinition: def, module });
    }
  }

  get(processId: string): ResolvedProcess | undefined {
    return this.byId.get(processId);
  }
  all(): ResolvedProcess[] {
    return [...this.byId.values()];
  }
}

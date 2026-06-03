// Indexes all tools across modules, enforcing unique names (SPEC §3, §12).
import type { ModuleContract, ToolDefinition } from "../shared/types/contracts.js";
import type { ModuleRegistry } from "./moduleRegistry.js";

export interface ResolvedTool {
  tool: ToolDefinition;
  module: ModuleContract;
}

export class ToolRegistry {
  private readonly byName = new Map<string, ResolvedTool>();

  constructor(modules: ModuleRegistry) {
    for (const module of modules.all()) {
      for (const tool of module.tools) {
        if (this.byName.has(tool.name)) {
          throw new Error(`duplicate tool name: ${tool.name}`);
        }
        this.byName.set(tool.name, { tool, module });
      }
    }
  }

  resolve(name: string): ResolvedTool | undefined {
    return this.byName.get(name);
  }
  all(): ResolvedTool[] {
    return [...this.byName.values()];
  }
}

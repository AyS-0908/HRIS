// Contract tests (SPEC §12, §15.13): every registered tool has a valid zod schema,
// a unique name, a permission scope, and (if process) statusAfterSuccess ∈ statuses.
import { describe, it, expect } from "vitest";
import { ALL_MODULES } from "../../src/app.js";
import { collectModuleErrors } from "../../src/registry/validateModule.js";
import { ModuleRegistry } from "../../src/registry/moduleRegistry.js";
import { ToolRegistry } from "../../src/registry/toolRegistry.js";

describe("standard contract", () => {
  it("every module contract is valid", () => {
    for (const m of ALL_MODULES) {
      expect(collectModuleErrors(m), `module ${m.moduleName}`).toEqual([]);
    }
  });

  it("tool names are unique across all modules", () => {
    const modules = new ModuleRegistry();
    for (const m of ALL_MODULES) modules.register(m);
    expect(() => new ToolRegistry(modules)).not.toThrow();
  });

  it("every tool has a zod schema, a scope, and (if process) a valid target status", () => {
    for (const m of ALL_MODULES) {
      const statuses = new Set(m.processDefinition?.statuses ?? []);
      for (const t of m.tools) {
        expect(typeof t.inputZod.safeParse).toBe("function");
        expect(t.permissionScope.length).toBeGreaterThan(0);
        if (t.process) expect(statuses.has(t.process.statusAfterSuccess)).toBe(true);
      }
    }
  });
});

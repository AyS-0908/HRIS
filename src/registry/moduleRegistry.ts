// Holds registered modules (SPEC §3 registry).
import type { ModuleContract } from "../shared/types/contracts.js";

export class ModuleRegistry {
  private readonly byName = new Map<string, ModuleContract>();

  register(m: ModuleContract): void {
    if (this.byName.has(m.moduleName)) {
      throw new Error(`duplicate module: ${m.moduleName}`);
    }
    this.byName.set(m.moduleName, m);
  }
  get(name: string): ModuleContract | undefined {
    return this.byName.get(name);
  }
  all(): ModuleContract[] {
    return [...this.byName.values()];
  }
}

// Idempotency cache (SPEC §5 step 5). Re-calling an idempotent tool with a seen
// key returns the prior ToolResult without re-running side effects.
import type { ToolResult } from "../shared/types/contracts.js";

export interface IdempotencyStore {
  get(scopeKey: string): ToolResult | undefined;
  set(scopeKey: string, result: ToolResult): void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Map<string, ToolResult>();
  get(scopeKey: string): ToolResult | undefined {
    return this.seen.get(scopeKey);
  }
  set(scopeKey: string, result: ToolResult): void {
    this.seen.set(scopeKey, result);
  }
}

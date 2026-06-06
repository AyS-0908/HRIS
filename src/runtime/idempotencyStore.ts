// Idempotency cache (SPEC §5 step 5). Re-calling an idempotent tool with a seen
// key returns the prior ToolResult without re-running side effects.
import type { ToolResult } from "../shared/types/contracts.js";

export interface IdempotencyStore {
  get(scopeKey: string): ToolResult | undefined;
  set(scopeKey: string, result: ToolResult): void;
}

// Bounded in-memory store (plan P2.5): a simple insertion-order LRU caps growth so a
// long-lived process cannot leak memory from accumulated idempotency keys. A production
// backend would add TTL + shared persistence; this keeps the reference impl safe by default.
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Map<string, ToolResult>();
  // Default cap; overridable for tests. Maps preserve insertion order, so evicting the
  // first key is a cheap approximation of LRU for a dedup cache.
  constructor(private readonly maxEntries = 10_000) {}

  get(scopeKey: string): ToolResult | undefined {
    return this.seen.get(scopeKey);
  }
  set(scopeKey: string, result: ToolResult): void {
    // Refresh recency: re-inserting moves the key to the end (most-recent).
    if (this.seen.has(scopeKey)) this.seen.delete(scopeKey);
    this.seen.set(scopeKey, result);
    if (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }
}

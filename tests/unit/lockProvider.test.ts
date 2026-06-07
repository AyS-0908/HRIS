// InProcessLockProvider: per-key serialization used by the runtime to close the
// same-instance double-side-effect race. Asserts FIFO serialization per key, no blocking
// across keys, error isolation between holders, and that idle keys drain (bounded memory).
import { describe, it, expect } from "vitest";
import { InProcessLockProvider } from "../../src/runtime/lockProvider.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("InProcessLockProvider", () => {
  it("serializes callers on the same key (FIFO, no overlap)", async () => {
    const lock = new InProcessLockProvider();
    const events: string[] = [];
    const a = lock.withLock("k", async () => {
      events.push("A:start");
      await delay(20);
      events.push("A:end");
    });
    const b = lock.withLock("k", async () => {
      events.push("B:start");
      events.push("B:end");
    });
    await Promise.all([a, b]);
    expect(events).toEqual(["A:start", "A:end", "B:start", "B:end"]);
  });

  it("does not block across different keys", async () => {
    const lock = new InProcessLockProvider();
    const events: string[] = [];
    await Promise.all([
      lock.withLock("k1", async () => {
        events.push("1:start");
        await delay(20);
        events.push("1:end");
      }),
      lock.withLock("k2", async () => {
        events.push("2:start");
        await delay(5);
        events.push("2:end");
      }),
    ]);
    // k2 holds a different key, so it runs concurrently and finishes first.
    expect(events).toEqual(["1:start", "2:start", "2:end", "1:end"]);
  });

  it("isolates a holder's error: a later caller on the same key still runs", async () => {
    const lock = new InProcessLockProvider();
    await expect(
      lock.withLock("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const result = await lock.withLock("k", async () => "ok");
    expect(result).toBe("ok");
  });

  it("returns the fn result and propagates its rejection", async () => {
    const lock = new InProcessLockProvider();
    expect(await lock.withLock("k", async () => 42)).toBe(42);
    await expect(lock.withLock("k", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
  });

  it("drains idle keys so the map does not grow unbounded", async () => {
    const lock = new InProcessLockProvider();
    await lock.withLock("k", async () => undefined);
    await lock.withLock("other", async () => undefined);
    // Both chains have drained; no key should linger.
    const tails = (lock as unknown as { tails: Map<string, unknown> }).tails;
    expect(tails.size).toBe(0);
  });

  it("keeps a key alive while a contender is queued, then drains", async () => {
    const lock = new InProcessLockProvider();
    const tails = (lock as unknown as { tails: Map<string, unknown> }).tails;
    const a = lock.withLock("k", async () => {
      await delay(10);
    });
    const b = lock.withLock("k", async () => {
      await delay(10);
    });
    // While A holds and B waits, the key is present.
    expect(tails.has("k")).toBe(true);
    await Promise.all([a, b]);
    expect(tails.size).toBe(0);
  });
});

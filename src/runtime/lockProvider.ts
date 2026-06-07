// Per-key serialization for the process runtime. The runtime acquires a lock keyed by
// (companyId, processInstanceId) around the gate → handler → updateStatus window so two
// concurrent requests on the SAME instance cannot both pass the status gate and run the
// side effect twice (SPEC §5 ordering stays intact; this only serializes contenders).
//
// SCOPE: InProcessLockProvider serializes within ONE Node process only. That is sufficient
// for a single-instance deployment (the pilot). Running multiple replicas reopens the
// cross-process race — the fix then is a distributed LockProvider (e.g. Redis SETNX or an
// Apps Script lock) swapped in at the composition root, with no runtime change.
export interface LockProvider {
  // Runs fn while holding the lock for key; concurrent callers on the same key run strictly
  // serially (FIFO). Different keys never block each other. The lock is always released,
  // even if fn throws.
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

// In-process keyed async-mutex. Each key maps to the tail of a promise chain: a new caller
// awaits the current tail, then installs its own as the new tail. The key is deleted once
// its chain fully drains, so idle keys do not accumulate.
export class InProcessLockProvider implements LockProvider {
  private readonly tails = new Map<string, Promise<void>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Our turn ends when `held` resolves (in the finally below). The chain never rejects —
    // a prior holder's error is theirs, so later waiters must not inherit it.
    const tail = prev.then(() => held);
    this.tails.set(key, tail);

    await prev.catch(() => {}); // wait for the previous holder to settle
    try {
      return await fn();
    } finally {
      release();
      // If nobody queued behind us, the stored tail is still ours — drop the key to bound
      // memory. If a later caller chained on, the stored tail is theirs and we leave it.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

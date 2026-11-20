import { setTimeout as delay } from "node:timers/promises";

// The one place tests wait on an external process that emits no event they
// can await (a native search host coming up, a file another process writes).
// Every caller states what it waits for and a deadline; there are no fixed
// sleeps standing in for an operation. Await the operation itself whenever
// one exists, and control time with t.mock.timers inside the process.

/**
 * Calls `check` until it returns something other than `undefined`, then
 * returns that value. Errors for which `isTransient` returns true keep
 * polling (the last one is rethrown at the deadline); others end it at once.
 */
export async function pollUntil(check, { timeoutMs = 5000, intervalMs = 10, signal, what = "condition", isTransient = () => true } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    if (signal?.aborted) throw signal.reason ?? new Error(`Stopped waiting for ${what}`);
    try {
      const value = await check();
      if (value !== undefined) return value;
      lastError = undefined;
    } catch (error) {
      if (!isTransient(error)) throw error;
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw lastError ?? new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
    await delay(Math.min(intervalMs, remaining), undefined, signal ? { signal } : undefined);
  }
}

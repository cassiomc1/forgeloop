import assert from "node:assert/strict";
import { clearInterval, setInterval } from "node:timers";

export const DEFAULT_SEED_HEARTBEAT_TASKS = 100;
export const DEFAULT_SEED_STALL_GRACE_MS = 300000;
export const SEED_STALLED_ERROR_CODE = "E_BENCHMARK_SEED_STALLED";

/**
 * Wraps the Charted MCP driver's seeding work in two diagnosability layers:
 *
 * 1. A parent progress-journal heartbeat every `heartbeatTasks` seeded tasks
 *    (run 38313544390 died after 5h59m in seeding with a 2-line journal —
 *    between `SEEDING` and `SEEDED` there was nothing timed to diagnose).
 * 2. A stall watchdog: when no seeding progress lands within
 *    `stallGraceMs`, the seed is aborted with a named
 *    `E_BENCHMARK_SEED_STALLED` error before the CI job wall can claim it.
 *
 * The seeded data and fixtures are produced entirely by `seed(onTaskSeeded)`;
 * this wrapper only observes and aborts. `now` and `clockIntervalMs` are
 * injectable so focused tests can prove Heartbeats and stalls at tiny scale
 * in wall-clock time.
 */
export async function seedWithProgress(progressJournal, {
  seed,
  size,
  heartbeatTasks = DEFAULT_SEED_HEARTBEAT_TASKS,
  stallGraceMs = DEFAULT_SEED_STALL_GRACE_MS,
  now = () => Date.now(),
  clockIntervalMs = null,
} = {}) {
  assert.ok(progressJournal === null || typeof progressJournal?.record === "function", "progress journal is missing");
  assert.equal(typeof seed, "function");
  assert.ok(Number.isInteger(size) && size >= 0);
  assert.ok(Number.isInteger(heartbeatTasks) && heartbeatTasks >= 1);
  assert.ok(Number.isFinite(stallGraceMs) && stallGraceMs > 0);
  const record = context => progressJournal?.record(context);
  const seededOnTime = Math.round(clockIntervalMs ?? Math.max(10, Math.min(1000, stallGraceMs / 5)));

  let tasksSeeded = 0;
  const startedAtMs = now();
  let lastProgressAtMs = startedAtMs;
  record({ stage: "SEEDING", tasks: size });

  let onTaskSeeded = () => {};
  let rejectStall;
  const stalled = new Promise((_, reject) => {
    rejectStall = reject;
  });
  const ticker = setInterval(() => {
    if (now() - lastProgressAtMs > stallGraceMs) {
      const elapsedMs = now() - startedAtMs;
      record({ stage: "SEEDING_STALLED", tasks: size, tasksSeeded, elapsedMs, stallGraceMs });
      const error = new Error(`Seed stalled after ${tasksSeeded}/${size} tasks: no seed progress for ${now() - lastProgressAtMs}ms (grace window ${stallGraceMs}ms).`);
      error.code = SEED_STALLED_ERROR_CODE;
      error.artifacts = { stage: "SEEDING_STALLED", tasks: size, tasksSeeded, elapsedMs, stallGraceMs };
      rejectStall(error);
    }
  }, seededOnTime);

  const progress = () => {
    tasksSeeded += 1;
    lastProgressAtMs = now();
    const elapsedMs = now() - startedAtMs;
    if (tasksSeeded % heartbeatTasks === 0) {
      record({ stage: "SEEDING_HEARTBEAT", tasks: size, tasksSeeded, elapsedMs });
    }
  };
  onTaskSeeded = () => progress();
  try {
    return await Promise.race([seed(onTaskSeeded), stalled]);
  } catch (error) {
    if (error?.code !== SEED_STALLED_ERROR_CODE) {
      record({ stage: "SEEDING_FAILED", tasks: size, tasksSeeded, error: { code: error?.code ?? error?.name ?? null, message: error?.message ?? String(error) } });
    }
    throw error;
  } finally {
    clearInterval(ticker);
  }
}

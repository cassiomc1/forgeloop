/**
 * Child process for the multi-process contention and interruption tests.
 *
 * This file is a test fixture, not a product entry point. It is never shipped
 * and is not reachable from the CLI. It exists so the parent test process can
 * observe and control execution boundaries inside a genuinely separate OS
 * process with its own SQLite connection.
 *
 * Coordination uses a blocking file-based control channel plus `Atomics.wait`
 * for sleeping. That is deliberate: a synchronous transaction callback cannot
 * await an ordinary JavaScript IPC callback while it holds the writer, so the
 * barrier must be blocking. Production transaction callbacks stay synchronous;
 * only this test worker introduces a barrier.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const config = JSON.parse(process.argv[2]);
const sleepArray = new Int32Array(new SharedArrayBuffer(4));

/** Block until a marker file exists. Deterministic: waits for a real signal. */
function waitForFile(markerPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(markerPath)) {
    if (Date.now() > deadline) {
      throw new Error(`barrier timeout waiting for ${path.basename(markerPath)}`);
    }
    Atomics.wait(sleepArray, 0, 0, 2);
  }
}

function signal(markerPath) {
  writeFileSync(markerPath, String(process.pid));
}

async function main() {
  const { openStorageDatabase } = await import("../../src/storage/connection.js");
  const { runInTransaction } = await import("../../src/storage/transaction.js");
  const { listEvents } = await import("../../src/storage/repository.js");

  const { mode, databasePath, taskId, hypothesis, barrierDir, boundary, busyTimeoutMs } = config;
  const db = openStorageDatabase(databasePath, busyTimeoutMs ? { busyTimeoutMs } : {});
  if (mode === "bootstrap") {
    const { withOperationalStore } = await import("../../src/storage/unit-of-work.js");
    const { executeForgeLoopCommand } = await import("../../src/core/command-runtime.js");
    try {
      const envelope = await withOperationalStore({ db, target: config.target }, async scope => {
        const commit = scope.commit.bind(scope);
        scope.commit = () => {
          signal(path.join(barrierDir, `ready-${config.workerId}`));
          waitForFile(path.join(barrierDir, "proceed"), config.barrierTimeoutMs ?? 30_000);
          return commit();
        };
        return executeForgeLoopCommand({ command: "task-create", projectPath: config.target, input: { taskId, claims: config.claims } });
      });
      return { role: "writer", ok: envelope.ok, taskId, code: envelope.error?.code ?? null, message: envelope.error?.message ?? null };
    } finally { db.close(); }
  }
  const request = {
    taskId,
    hypothesis,
    failureClass: "VERIFICATION_FAILURE",
    evidenceRefs: ["check-auth-boundary"],
    settledBy: "pending-evidence",
    nextSafeAction: "act",
  };

  if (mode === "hold-writer") {
    // Acquire the writer, announce that it is held, then wait for release while
    // the transaction is genuinely open.
    runInTransaction(db, () => {
      db.prepare("UPDATE storage_meta SET updated_at = updated_at WHERE id = 1").run();
      signal(path.join(barrierDir, "writer-held"));
      waitForFile(path.join(barrierDir, "release-writer"), config.barrierTimeoutMs ?? 20_000);
    });
    db.close();
    return { role: "holder", ok: true };
  }

  // A test-only fault-injection seam.
  //
  // The transition commits inside its own transaction, so a genuine
  // "mutation applied but not committed" boundary cannot be produced from
  // outside. This proxy wraps the connection and pauses at exact execution
  // points without changing product code: `before-commit` blocks immediately
  // before COMMIT is issued, and `before-event` blocks before the ledger insert
  // runs. Reads and writes still go to the real connection, so the transaction
  // is genuinely open and holds the writer while paused.
  const wrapWithBoundary = (handle) => new Proxy(handle, {
    get(target, property) {
      if (property === "exec") {
        return (sql) => {
          if (boundary === "before-commit" && /^COMMIT/i.test(String(sql).trim())) {
            signal(path.join(barrierDir, "pre-commit"));
            waitForFile(path.join(barrierDir, "release-pre-commit"), config.barrierTimeoutMs ?? 30_000);
          }
          return target.exec(sql);
        };
      }
      if (property === "prepare") {
        return (sql) => {
          const statement = target.prepare(sql);
          if (boundary === "before-event" && /INSERT\s+INTO\s+events/i.test(String(sql))) {
            return new Proxy(statement, {
              get(inner, innerProperty, innerReceiver) {
                if (innerProperty === "run") {
                  return (...args) => {
                    // The conditional state update has already executed inside
                    // this open transaction; block before the ledger insert.
                    signal(path.join(barrierDir, "state-updated"));
                    waitForFile(path.join(barrierDir, "release-before-event"), config.barrierTimeoutMs ?? 30_000);
                    return inner.run(...args);
                  };
                }
                const value = Reflect.get(inner, innerProperty, innerReceiver);
                return typeof value === "function" ? value.bind(inner) : value;
              },
            });
          }
          return statement;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const store = wrapWithBoundary(db);

  // Announce readiness so the parent can release both writers from a known state.
  signal(path.join(barrierDir, `ready-${config.workerId}`));
  waitForFile(path.join(barrierDir, "proceed"), config.barrierTimeoutMs ?? 30_000);

  const started = Date.now();
  try {
    let result;
    if (mode === "advance") {
      const { executeForgeLoopCommand } = await import("../../src/core/command-runtime.js");
      const envelope = await executeForgeLoopCommand({ command: "advance", projectPath: config.target, input: { taskId, to: "CORRECTING" } });
      if (!envelope.ok) {
        const error = new Error(envelope.error?.message ?? "Advance failed");
        error.code = envelope.error?.code;
        throw error;
      }
      result = envelope.result;
    } else {
      if (path.basename(path.dirname(databasePath)) === ".forgeloop") {
        const target = path.dirname(path.dirname(databasePath));
        const { withOperationalStore } = await import("../../src/storage/unit-of-work.js");
        const { executeForgeLoopCommand } = await import("../../src/core/command-runtime.js");
        const envelope = await withOperationalStore({ db: store, target }, scope => {
          if (config.prepareBarrier) {
            const commit = scope.commit.bind(scope);
            scope.commit = () => {
              signal(path.join(barrierDir, `prepared-${config.workerId}`));
              waitForFile(path.join(barrierDir, "release-prepared"), config.barrierTimeoutMs ?? 30_000);
              return commit();
            };
          }
          return executeForgeLoopCommand({ command: "record-diagnosis", projectPath: target, input: request });
        });
        if (!envelope.ok) throw Object.assign(new Error(envelope.error.message), { code: envelope.error.code });
        result = envelope.result;
      } else {
        throw Object.assign(new Error("Diagnosis process fixtures require canonical migrated storage"), { code: "E_STORAGE_MIGRATION_REQUIRED" });
      }
    }

    if (boundary === "after-commit") {
      // A confirmed commit: acknowledge it, then block before delivering the
      // normal response so the parent can terminate after the commit is durable.
      signal(path.join(barrierDir, "commit-ack"));
      waitForFile(path.join(barrierDir, "release-after-commit"), config.barrierTimeoutMs ?? 30_000);
    }

    const events = listEvents(db, taskId);
    const resultEvent = result.event ?? events.at(-1);
    return {
      role: "writer",
      ok: true,
      revision: result.state?.revision ?? result.revision,
      seq: resultEvent.seq,
      hash: resultEvent.hash,
      eventCount: events.length,
      idempotent: result.idempotent,
    };
  } catch (error) {
    return {
      role: "writer",
      ok: false,
      code: error.code ?? null,
      message: error.message,
      elapsedMs: Date.now() - started,
    };
  } finally {
    db.close();
  }
}

main().then(
  (result) => {
    process.stdout.write(`${JSON.stringify({ type: "result", result })}\n`);
    process.exit(0);
  },
  (error) => {
    // Always emit a `result` envelope so the parent can assert on `result.ok`
    // uniformly, whether the failure happened inside the operation or while
    // opening the connection.
    process.stdout.write(`${JSON.stringify({
      type: "result",
      result: { role: "writer", ok: false, code: error?.code ?? null, message: error?.message ?? String(error) },
    })}\n`);
    process.exit(1);
  },
);

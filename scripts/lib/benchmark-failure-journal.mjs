import { writeFileSync } from "node:fs";

/** Record a failure before shutdown, without handling or suppressing it. */
export function installBenchmarkFailureJournal(filename, context) {
  const record = error => {
    try {
      writeFileSync(filename, `${JSON.stringify({
        status: "FAILED", workerPid: process.pid, ...context(),
        error: { name: error.name, code: error.code, message: error.message, stack: error.stack, data: error.data },
      }, null, 2)}\n`, { flag: "wx" });
    } catch (journalError) {
      // Keep the first cause if cleanup or another uncaught failure follows.
      if (journalError.code !== "EEXIST") process.stderr.write(`Failure journal unavailable: ${journalError.code ?? journalError.message}\n`);
    }
  };
  process.on("uncaughtExceptionMonitor", record);
  return { record, dispose: () => process.off("uncaughtExceptionMonitor", record) };
}

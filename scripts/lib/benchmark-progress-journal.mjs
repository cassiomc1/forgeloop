import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";

/** Durable phase/sample observations, emitted outside measured operations. */
export function createBenchmarkProgressJournal(filename) {
  const fd = openSync(filename, "wx");
  let sequence = 0;
  return {
    record(context) {
      const line = `${JSON.stringify({ ...context, pid: process.pid, sequence: ++sequence, at: new Date().toISOString() })}\n`;
      const bytes = Buffer.from(line);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      fsyncSync(fd);
    },
    close() { closeSync(fd); },
  };
}

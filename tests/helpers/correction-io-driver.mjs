import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { buildCanonicalDiagnosisProject } from "./canonical-diagnosis-fixture.js";
import { openStorageDatabase, findTaskById, listEvents, listClaims, findArtifact } from "../../src/storage/index.js";
import { executeForgeLoopCommand } from "../../src/core/command-runtime.js";

const [outPath, mode] = process.argv.slice(2);
const fixture = await buildCanonicalDiagnosisProject();
let db;
const attempts = globalThis.__FORGELOOP_FS_ATTEMPTS__;
if (!Array.isArray(attempts)) throw new Error("Filesystem observer must be preloaded");
const root = path.join(fixture.target, ".forgeloop/task-state");
try {
  // Prove that caught reads and transient writes are observable before testing.
  await mkdir(root, { recursive: true });
  const controlStart = attempts.length;
  try { await readFile(path.join(root, "missing-control.json")); } catch { /* deliberately caught */ }
  await writeFile(path.join(root, "transient-control.json"), "{}\n");
  await rm(path.join(root, "transient-control.json"));
  const control = attempts.slice(controlStart);
  await rm(root, { recursive: true });
  db = openStorageDatabase(path.join(fixture.target, ".forgeloop/state.sqlite"), { readOnly: true });
  const snapshot = () => ({ state: findTaskById(db, fixture.taskId).state, events: listEvents(db, fixture.taskId), claims: listClaims(db, fixture.taskId), receipt: findArtifact(db, fixture.taskId, "receipt") });
  const before = snapshot();
  if (mode === "contradictory") {
    await mkdir(path.join(root, findTaskById(db, fixture.taskId).taskKey), { recursive: true });
    for (const name of ["work-state.json", "contract.json", "routing-result.json", "preflight.json", "events.ndjson"]) {
      await writeFile(path.join(root, findTaskById(db, fixture.taskId).taskKey, name), "corrupt\n");
    }
  }
  const begin = attempts.length;
  const diagnosis = await executeForgeLoopCommand({ command: "record-diagnosis", projectPath: fixture.target, input: { taskId: fixture.taskId, hypothesis: "Deterministic check fails by design", failureClass: "VERIFICATION_FAILURE", evidenceRefs: ["check-auth-boundary"], settledBy: "A passing check", nextSafeAction: "Correct the fixture check" } });
  const advance = await executeForgeLoopCommand({ command: "advance", projectPath: fixture.target, input: { taskId: fixture.taskId, to: "CORRECTING" } });
  const state = findTaskById(db, fixture.taskId).state;
  const events = listEvents(db, fixture.taskId);
  const observed = attempts.slice(begin);
  await writeFile(outPath, JSON.stringify({ mode, target: fixture.target, control, diagnosis, advance, state, eventCount: events.length, before, after: snapshot(), attempts: observed }));
} finally {
  db?.close();
  await rm(fixture.target, { recursive: true, force: true });
}

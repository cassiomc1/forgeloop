import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPOSITORY = "cassiomc1/forgeloop";
const EVENTS = new Set(["push", "workflow_dispatch", "schedule", "release", "pull_request"]);
const reject = message => Object.assign(new Error(message), { code: "E_RUNNER_EVENT_UNTRUSTED" });

/** Run from an operator-owned copy before checkout, never from the job checkout. */
export function assertRunnerEventAdmission(environment, event) {
  if (environment.GITHUB_REPOSITORY !== REPOSITORY || event?.repository?.full_name !== REPOSITORY) {
    throw reject("Runner is restricted to the configured repository");
  }
  if (!EVENTS.has(environment.GITHUB_EVENT_NAME)) throw reject("Event is not admitted on this runner");
  if (environment.GITHUB_EVENT_NAME === "pull_request") {
    if (event.pull_request?.base?.repo?.full_name !== REPOSITORY
      || event.pull_request?.head?.repo?.full_name !== REPOSITORY) {
      throw reject("Fork pull requests cannot execute on this runner");
    }
  }
  return { repository: REPOSITORY, event: environment.GITHUB_EVENT_NAME };
}

export async function admitRunnerJob(environment = process.env) {
  const filename = environment.GITHUB_EVENT_PATH;
  if (!filename || !path.isAbsolute(filename)) throw reject("Runner event path is unavailable");
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw reject("Runner event file is invalid");
  const bytes = await readFile(filename);
  if (bytes.length > 1048576 || !Buffer.from(bytes.toString("utf8")).equals(bytes)) throw reject("Runner event encoding or size is invalid");
  return assertRunnerEventAdmission(environment, JSON.parse(bytes.toString("utf8")));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const admitted = await admitRunnerJob();
    console.log(`Runner admitted ${admitted.event} for ${admitted.repository}`);
  } catch (error) {
    // Avoid printing the payload, paths, tokens, or arbitrary parser diagnostics.
    console.error(error.code === "E_RUNNER_EVENT_UNTRUSTED" ? error.message : "Runner event admission failed");
    process.exitCode = 1;
  }
}

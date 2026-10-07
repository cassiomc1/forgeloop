/**
 * Filesystem attempt observer (CommonJS preload).
 *
 * Installed with `--require` before any project module is imported, so it
 * observes access attempts rather than completed operations. That distinction
 * matters: a legacy read whose error is caught still appears here, which a
 * before/after manifest can never show.
 *
 * Positive control: `tests/storage-evidence-checks.test.js` deliberately
 * performs a caught prohibited read and a transient prohibited write from an ESM
 * module, and asserts both are recorded. If that control ever fails, the
 * isolation results in this file must not be trusted.
 *
 * The patch is applied to the CommonJS `node:fs` and `node:fs/promises` module
 * objects. On the tested runtime (Node v26) ESM named imports of those builtins
 * resolve through the same live binding, which the positive control proves
 * rather than assumes.
 *
 * Reach and limits are documented in `docs/SQLITE_STORAGE.md`.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");

const attempts = [];
globalThis.__FORGELOOP_FS_ATTEMPTS__ = attempts;

function record(api, arg) {
  try {
    attempts.push({ api, path: typeof arg === "string" ? arg : String(arg) });
  } catch {
    // An observation must never break the observed program.
  }
}

function patch(moduleObject, names, tag) {
  for (const name of names) {
    const original = moduleObject[name];
    if (typeof original !== "function") continue;
    moduleObject[name] = function observed(first, ...rest) {
      // Only the first path-like argument is classified; callers pass paths first.
      record(`${tag}:${name}`, first);
      return original.call(this, first, ...rest);
    };
  }
}

patch(fs, [
  "readFile", "readFileSync", "statSync", "lstatSync", "existsSync", "accessSync",
  "openSync", "closeSync", "writeFileSync", "appendFileSync", "readdirSync",
  "unlinkSync", "mkdirSync", "rmSync", "renameSync", "copyFileSync", "opendirSync",
  "createReadStream", "createWriteStream", "open", "readdir", "realpathSync",
], "fs");

patch(fsp, [
  "readFile", "stat", "lstat", "access", "open", "writeFile", "appendFile",
  "readdir", "opendir", "unlink", "mkdir", "rm", "rename", "copyFile",
  "realpath", "createReadStream", "createWriteStream", "truncate", "chmod",
], "fsp");

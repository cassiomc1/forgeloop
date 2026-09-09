import assert from "node:assert/strict";
import { test } from "node:test";

import { getTierCommands } from "../scripts/run-validation.mjs";

function ids(tier) {
  return getTierCommands(tier).map((command) => command.id);
}

test("fast tier is short and deterministic", () => {
  const fast = ids("fast");
  assert.deepEqual(fast, ["test:quick", "lint", "dependency:policy", "docs:generated:check"]);
  assert.equal(fast.includes("coverage"), false);
  assert.equal(fast.some((id) => id.startsWith("python-")), false);
});

test("local tier owns deterministic source and documentation checks", () => {
  const local = ids("local");
  for (const expected of [
    "test",
    "lint",
    "dependency:policy",
    "complexity:check",
    "docs:generated:check",
    "docs:conformance",
    "docs:examples:check",
    "completions:check",
    "summary:check",
    "changelog:check",
    "repository-index:manifest",
    "python-unittest",
    "markdown-validator",
    "loop-validator",
    "secret-scan",
  ]) assert.ok(local.includes(expected), expected);
});

test("pre-push and release tiers execute coverage once without a duplicate npm test", () => {
  for (const tier of ["prepush", "release"]) {
    const commands = getTierCommands(tier);
    assert.equal(commands.filter((command) => command.id === "coverage").length, 1);
    assert.equal(commands.some((command) => command.id === "test"), false);
    assert.ok(commands.some((command) => command.id === "mcp:test"));
    assert.ok(commands.some((command) => command.id === "pack:check"));
  }
});

test("release identity is explicit and never guessed before publication", () => {
  const command = getTierCommands("release").find((candidate) => candidate.id === "release:identity");
  assert.equal(command.notVerified, true);
  assert.match(command.reason, /FORGELOOP_RELEASE_VERSION/);
});

test("Windows uses the portable npm and Python launchers", () => {
  assert.equal(getTierCommands("fast", "win32")[0].command, "npm.cmd");
  assert.equal(getTierCommands("local", "win32").find((command) => command.id === "python-unittest").command, "py");
  assert.deepEqual(getTierCommands("local", "win32").find((command) => command.id === "python-unittest").args.slice(0, 2), ["-3", "-m"]);
});

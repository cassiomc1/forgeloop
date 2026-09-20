import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_BROWSER_COMMANDS, attributeCommand, clickCommand, fillCommand, openCommand,
  pressCommand, snapshotCommand, urlCommand, versionCommand,
} from "../src/adapters/agent-browser/commands.js";

const common = { sessionId: "session-1", allowedOrigins: ["https://example.test:8443"] };

test("Agent Browser command builders produce shell-free, safety-bounded argv", () => {
  assert.deepEqual(versionCommand(), ["--version"]);
  const open = openCommand({ ...common, url: "https://example.test:8443/start" });
  assert.deepEqual(open.slice(-2), ["https://example.test:8443/start", "--json"]);
  assert.ok(open.includes("--allowed-domains"));
  assert.ok(open.includes("example.test"));
  assert.ok(open.includes("--no-webmcp"));
  assert.deepEqual(clickCommand({ ...common, selector: "#submit" }).slice(-2), ["#submit", "--json"]);
  assert.deepEqual(fillCommand({ ...common, selector: "#email", text: "safe" }).slice(-3), ["#email", "safe", "--json"]);
  assert.deepEqual(pressCommand({ ...common, key: "Enter" }).slice(-2), ["Enter", "--json"]);
  assert.deepEqual(attributeCommand({ ...common, selector: "#x", attribute: "aria-label" }).slice(-3), ["#x", "aria-label", "--json"]);
  assert.deepEqual(urlCommand(common).slice(-2), ["url", "--json"]);
  assert.equal(typeof snapshotCommand, "function");
  assert.equal(typeof AGENT_BROWSER_COMMANDS.close, "function");
});

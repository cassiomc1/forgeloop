import assert from "node:assert/strict";
import { test } from "node:test";

import { getCanonicalRepositoryIndexArgs, getCanonicalRepositorySearchArgs } from "../src/repository-index/args.js";

test("index and server share the explicit traversal boundary and resource policy", () => {
  const index = getCanonicalRepositoryIndexArgs({ mode: "index", indexPath: "/repo/.forgeloop/repository-index/tgrep" });
  const serve = getCanonicalRepositoryIndexArgs({ mode: "serve", indexPath: "/repo/.forgeloop/repository-index/tgrep" });
  assert.ok(index.includes("--max-filesize"));
  assert.ok(index.includes("--exclude"));
  assert.ok(index.includes(".forgeloop/repository-index"));
  assert.ok(index.includes("--index-strategy"));
  assert.ok(serve.includes("--max-cpu"));
  assert.ok(serve.includes("--watcher-queue-cap"));
  assert.ok(serve.includes("--auto-save-mutations"));
});

test("normal search never exposes the native no-index bypass", () => {
  const args = getCanonicalRepositorySearchArgs({ indexPath: "/index", pattern: "needle", options: {} });
  assert.equal(args.includes("--no-index"), false);
  assert.ok(args.includes("--index-path"));
  assert.ok(args.includes("--max-filesize"));
});

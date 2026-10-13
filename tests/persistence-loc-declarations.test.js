import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { exactDeclarationSpan, loadTypeScript } from "../scripts/measure-persistence-loc.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const ts = loadTypeScript(root, "7.0.2");
const parser = ts.createParser(root);

function fixture() {
  // Parse a real existing source file, then bind its exact enum declaration.
  const filename = `${root}src/core/task-discovery.js`;
  const parsed = parser.openFiles([filename]).get(filename).sourceFile;
  const statement = parsed.statements.find(item => item.getText(parsed).startsWith("const DISCOVERY_PROJECTIONS ="));
  assert.ok(statement);
  const text = parsed.text;
  const hash = createHash("sha256").update(text).digest("hex");
  return { file: { path: "src/core/task-discovery.js", sourceFile: parsed, sha256: hash }, entry: { id: "projection-enum", name: "DISCOVERY_PROJECTIONS", sourceSha256: hash, sourceEvidence: statement.getText(parsed) } };
}

test("exact declaration includes a persistence enum without SQL or path tokens", () => {
  const { file, entry } = fixture();
  assert.doesNotMatch(entry.sourceEvidence, /SELECT|INSERT|state\.sqlite|\.forgeloop/);
  const span = exactDeclarationSpan(ts, file, entry);
  assert.equal(span.name, entry.name);
  assert.equal(span.kind, "VariableStatement");
  assert.equal(span.lineEnd - span.lineStart + 1, 5);
});

test("exact declaration rejects stale content, file hash and missing identity", () => {
  const { file, entry } = fixture();
  for (const change of [{ sourceEvidence: entry.sourceEvidence + " stale" }, { sourceSha256: "0".repeat(64) }, { name: "MISSING_ENUM" }]) {
    assert.throws(() => exactDeclarationSpan(ts, file, { ...entry, ...change }));
  }
});

test.after(() => parser.close());

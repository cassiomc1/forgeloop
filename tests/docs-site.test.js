import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDocsSite,
  convertMarkdownToMdx,
  GITHUB_BLOB_BASE,
  GITHUB_TREE_BASE,
  rewriteLinkTarget,
  stripHtmlComments,
  toLatin1,
} from "../scripts/build-docs-site.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = new Set(["docs/MCP.md", "docs/CLI_REFERENCE.md", "docs/history/README.md", "LOOP_ENGINEERING.md", "docs/assets/a.svg"]);
const dirs = new Set(["schemas", "docs"]);
const kindOf = (repoPath) => (files.has(repoPath) ? "file" : dirs.has(repoPath) ? "dir" : null);

test("rewriteLinkTarget maps docs pages to site paths and the rest to GitHub", () => {
  const from = "docs/GETTING_STARTED.md";
  assert.equal(rewriteLinkTarget("./CLI_REFERENCE.md#next", from, kindOf), "/CLI_REFERENCE#next");
  assert.equal(rewriteLinkTarget("history/README.md", from, kindOf), "/history/README");
  assert.equal(rewriteLinkTarget("../LOOP_ENGINEERING.md#x", from, kindOf), `${GITHUB_BLOB_BASE}LOOP_ENGINEERING.md#x`);
  assert.equal(rewriteLinkTarget("./assets/a.svg", from, kindOf), `${GITHUB_BLOB_BASE}docs/assets/a.svg`);
  assert.equal(rewriteLinkTarget("../schemas/", from, kindOf), `${GITHUB_TREE_BASE}schemas`);
  assert.equal(rewriteLinkTarget("https://example.com/a.md", from, kindOf), "https://example.com/a.md");
  assert.equal(rewriteLinkTarget("#local", from, kindOf), "#local");
  assert.equal(rewriteLinkTarget("./MCP.md#modes", from, kindOf), "/FORGELOOP_MCP#modes");
});

test("convertMarkdownToMdx escapes MDX syntax outside code and keeps code verbatim", () => {
  const source = [
    "# Title — with dash",
    "",
    "First paragraph with `<id>` code.",
    "",
    "Second paragraph links [CLI](./CLI_REFERENCE.md).",
    "",
    "<!-- BEGIN FORGELOOP GENERATED: x -->",
    "Run with <task-id> and {braces}, see <https://example.com>. <a id=\"A-1\"></a>",
    "<!-- END FORGELOOP GENERATED: x -->",
    "",
    "```bash",
    "export X=<value> {kept}",
    "```",
    "export notCode",
  ].join("\n");
  const mdx = convertMarkdownToMdx(source, { sourcePath: "docs/GUIDE.md", kindOf });
  assert.match(mdx, /^---\ntitle: "Title - with dash"\ndescription: "First paragraph with <id> code\."\n---\n/);
  assert.doesNotMatch(mdx, /^# Title/m);
  assert.doesNotMatch(mdx, /^First paragraph/m);
  assert.match(mdx, /Second paragraph links \[CLI\]\(\/CLI_REFERENCE\)\./);
  assert.doesNotMatch(mdx, /<!--/);
  assert.match(mdx, /Run with &lt;task-id> and \\\{braces\\\}, see \[https:\/\/example\.com\]\(https:\/\/example\.com\)\. <a id="A-1"><\/a>/);
  assert.match(mdx, /```bash\nexport X=<value> \{kept\}\n```/);
  assert.match(mdx, /^&#x200B;export notCode$/m);
});

test("convertMarkdownToMdx keeps an opening paragraph with links in the body", () => {
  const mdx = convertMarkdownToMdx("# T\n\nSee [CLI](./CLI_REFERENCE.md).\n", { sourcePath: "docs/G.md", kindOf });
  assert.match(mdx, /^---\ntitle: "T"\n---\n/);
  assert.match(mdx, /See \[CLI\]\(\/CLI_REFERENCE\)\./);
});

test("stripHtmlComments removes nested comment openers left by a single pass", () => {
  assert.equal(stripHtmlComments("a<!<!---->-- b -->c"), "ac");
  assert.equal(stripHtmlComments("x <!-- one --> y <!-- two --> z"), "x  y  z");
  const mdx = convertMarkdownToMdx("# T\n\nIntro.\n\nbefore <!<!---->-- hidden --> after\n", {
    sourcePath: "docs/G.md",
    kindOf,
  });
  assert.doesNotMatch(mdx, /<!--|hidden/);
  assert.match(mdx, /^before {2}after$/m);
});

test("toLatin1 folds typographic characters for docs.page metadata", () => {
  assert.equal(toLatin1("A — B → C “q” … ≥"), 'A - B -> C "q" ... >=');
});

test("buildDocsSite publishes every docs page and the site config", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-docs-site-"));
  try {
    const { pages } = await buildDocsSite({ rootDir: repositoryRoot, outDir });
    const config = JSON.parse(await readFile(path.join(outDir, "docs.json"), "utf8"));
    assert.equal(config.name, "ForgeLoop");
    const top = (await readdir(path.join(outDir, "docs"))).filter((name) => name.endsWith(".mdx"));
    assert.ok(top.includes("index.mdx"));
    assert.ok(top.includes("CLI_REFERENCE.mdx"));
    assert.ok(top.includes("FORGELOOP_MCP.mdx"));
    assert.ok(!top.includes("MCP.mdx"));
    assert.ok(pages >= top.length - 1);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

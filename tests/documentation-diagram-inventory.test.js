import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { scanDocumentationDiagrams } from "../scripts/documentation-diagram-inventory.mjs";

test("inventory classifies active diagram sources, references, and text while ignoring shell arrows", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diagram-inventory-"));
  try {
    await mkdir(path.join(rootDir, "docs", "assets"), { recursive: true });
    await writeFile(path.join(rootDir, "docs", "legacy.mmd"), "flowchart LR\n  A --> B\n", "utf8");
    await writeFile(path.join(rootDir, "docs", "architecture.md"), [
      "# Architecture",
      "",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "",
      "![Static flow](./assets/flow.svg)",
      "[Interactive flow](./assets/flow.html)",
      "",
      "├─ request → route",
      "└─ route → evidence",
      "",
      "```bash",
      "echo 'request -> route'",
      "```",
      "",
    ].join("\n"), "utf8");
    await writeFile(path.join(rootDir, "docs", "assets", "flow.svg"), "<svg />\n", "utf8");
    await writeFile(path.join(rootDir, "docs", "assets", "flow.html"), "<!doctype html>\n", "utf8");

    const inventory = await scanDocumentationDiagrams({ rootDir });

    assert.equal(inventory.activeMermaid, true);
    assert.deepEqual(inventory.mermaidSources.map((entry) => entry.path), ["docs/legacy.mmd"]);
    assert.deepEqual(inventory.mermaidFences.map((entry) => ({ path: entry.path, line: entry.line })), [
      { path: "docs/architecture.md", line: 3 },
    ]);
    assert.deepEqual(inventory.imageReferences.map((entry) => entry.target), ["docs/assets/flow.svg"]);
    assert.deepEqual(inventory.htmlDiagramReferences.map((entry) => entry.target), ["docs/assets/flow.html"]);
    assert.deepEqual(inventory.diagramLikeText.map((entry) => entry.line), [11, 12]);
    assert.deepEqual(inventory.unreferencedVisualAssets, []);
  } finally {
    await removeTempTree(rootDir);
  }
});

test("inventory detects orphaned and missing manifest-owned diagram artifacts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forgeloop-diagram-inventory-"));
  try {
    await mkdir(path.join(rootDir, "docs", "diagrams", "reviews"), { recursive: true });
    await mkdir(path.join(rootDir, "docs", "assets", "diagrams"), { recursive: true });
    const manifest = {
      version: 2,
      renderer: {
        name: "archify",
        version: "2.15.0",
        commit: "e1ac748f19cf805e44bf74fb93c796662152e273",
        source: "https://github.com/tt-a1i/archify/tree/v2.15.0",
        license: "MIT",
      },
      policy: {
        supportedTypes: ["workflow", "architecture", "sequence", "dataflow", "lifecycle"],
        requireVisualReview: true,
      },
      diagrams: [{
        id: "flow",
        type: "workflow",
        defaultTheme: "dark",
        canonicalFor: ["flow-purpose"],
        source: "docs/diagrams/flow.workflow.json",
        html: "docs/assets/diagrams/flow.html",
        svg: "docs/assets/diagrams/flow.svg",
        receipt: "docs/assets/diagrams/flow.receipt.json",
        review: "docs/diagrams/reviews/flow.review.json",
        fallback: "README.md#architecture-flow",
        referencedBy: ["docs/diagrams/README.md"],
      }],
    };
    await writeFile(path.join(rootDir, "docs", "diagrams", "manifest.json"), JSON.stringify(manifest), "utf8");
    await writeFile(path.join(rootDir, "docs", "diagrams", "README.md"), "flow.workflow.json and flow.svg\n", "utf8");
    await writeFile(path.join(rootDir, "docs", "diagrams", "flow.workflow.json"), "{}\n", "utf8");
    await writeFile(path.join(rootDir, "docs", "assets", "diagrams", "flow.html"), "<!doctype html>\n", "utf8");
    await writeFile(path.join(rootDir, "docs", "assets", "diagrams", "flow.svg"), "<svg />\n", "utf8");
    await writeFile(path.join(rootDir, "docs", "assets", "diagrams", "flow.receipt.json"), "{}\n", "utf8");
    await writeFile(path.join(rootDir, "docs", "diagrams", "reviews", "flow.review.json"), "{}\n", "utf8");
    await writeFile(path.join(rootDir, "docs", "diagrams", "orphan.workflow.json"), "{}\n", "utf8");
    await writeFile(path.join(rootDir, "docs", "assets", "diagrams", "orphan.svg"), "<svg />\n", "utf8");
    await writeFile(path.join(rootDir, "docs", "diagrams", "reviews", "orphan.review.json"), "{}\n", "utf8");

    const inventory = await scanDocumentationDiagrams({ rootDir });
    assert.deepEqual(inventory.orphanedDiagramArtifacts, [
      "docs/assets/diagrams/orphan.svg",
      "docs/diagrams/orphan.workflow.json",
      "docs/diagrams/reviews/orphan.review.json",
    ]);

    await rm(path.join(rootDir, "docs", "assets", "diagrams", "flow.html"));
    const missing = await scanDocumentationDiagrams({ rootDir });
    assert.ok(missing.orphanedDiagramArtifacts.includes("missing:docs/assets/diagrams/flow.html"));
  } finally {
    await removeTempTree(rootDir);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findAllOccurrences,
  requireGeneratedRegion,
  findGeneratedRegions,
  validateGeneratedRegions,
  replaceGeneratedRegion,
  compareGeneratedRegion,
} from "../scripts/lib/generated-regions.mjs";

test("generated regions unit tests: findAllOccurrences finds all offset positions", () => {
  const content = "abc foo def foo ghi";
  assert.deepEqual(findAllOccurrences(content, "foo"), [4, 12]);
  assert.deepEqual(findAllOccurrences(content, "xyz"), []);
});

test("generated regions unit tests: findGeneratedRegions extracts all region IDs", () => {
  const content = "<!-- BEGIN FORGELOOP GENERATED: r1 -->\n<!-- BEGIN FORGELOOP GENERATED: r2 -->";
  const regions = findGeneratedRegions(content);
  assert.deepEqual(regions.map((r) => r.region), ["r1", "r2"]);
});

test("generated regions unit tests: requireGeneratedRegion handles valid and invalid markers", () => {
  const valid = "<!-- BEGIN FORGELOOP GENERATED: test-region -->\nbody\n<!-- END FORGELOOP GENERATED: test-region -->";
  const validRes = requireGeneratedRegion({ content: valid, relPath: "test.md", region: "test-region" });
  assert.equal(validRes.valid, true);
  assert.equal(validRes.beginIndex, 0);

  // Missing BEGIN
  const noBegin = "body\n<!-- END FORGELOOP GENERATED: test-region -->";
  const noBeginRes = requireGeneratedRegion({ content: noBegin, relPath: "test.md", region: "test-region" });
  assert.equal(noBeginRes.valid, false);
  assert.equal(noBeginRes.code, "DOC_GENERATED_REGION_MISSING");

  // Missing END
  const noEnd = "<!-- BEGIN FORGELOOP GENERATED: test-region -->\nbody";
  const noEndRes = requireGeneratedRegion({ content: noEnd, relPath: "test.md", region: "test-region" });
  assert.equal(noEndRes.valid, false);
  assert.equal(noEndRes.code, "DOC_GENERATED_REGION_INVALID");

  // Duplicate BEGIN
  const dupBegin = "<!-- BEGIN FORGELOOP GENERATED: test-region -->\n<!-- BEGIN FORGELOOP GENERATED: test-region -->\nbody\n<!-- END FORGELOOP GENERATED: test-region -->";
  const dupBeginRes = requireGeneratedRegion({ content: dupBegin, relPath: "test.md", region: "test-region" });
  assert.equal(dupBeginRes.valid, false);
  assert.equal(dupBeginRes.code, "DOC_GENERATED_REGION_DUPLICATE");

  // Duplicate END
  const dupEnd = "<!-- BEGIN FORGELOOP GENERATED: test-region -->\nbody\n<!-- END FORGELOOP GENERATED: test-region -->\n<!-- END FORGELOOP GENERATED: test-region -->";
  const dupEndRes = requireGeneratedRegion({ content: dupEnd, relPath: "test.md", region: "test-region" });
  assert.equal(dupEndRes.valid, false);
  assert.equal(dupEndRes.code, "DOC_GENERATED_REGION_INVALID");

  // END before BEGIN
  const endFirst = "<!-- END FORGELOOP GENERATED: test-region -->\n<!-- BEGIN FORGELOOP GENERATED: test-region -->";
  const endFirstRes = requireGeneratedRegion({ content: endFirst, relPath: "test.md", region: "test-region" });
  assert.equal(endFirstRes.valid, false);
  assert.equal(endFirstRes.code, "DOC_GENERATED_REGION_INVALID");
});

test("generated regions unit tests: validateGeneratedRegions validates expected, unknown, and nested topology", () => {
  const content = [
    "<!-- BEGIN FORGELOOP GENERATED: region-a -->",
    "content a",
    "<!-- END FORGELOOP GENERATED: region-a -->",
    "",
    "<!-- BEGIN FORGELOOP GENERATED: region-b -->",
    "content b",
    "<!-- END FORGELOOP GENERATED: region-b -->",
  ].join("\n");

  // Valid siblings
  const validRes = validateGeneratedRegions({
    content,
    relPath: "test.md",
    expectedRegions: ["region-a", "region-b"],
  });
  assert.equal(validRes.valid, true);

  // Missing expected region
  const missingRes = validateGeneratedRegions({
    content,
    relPath: "test.md",
    expectedRegions: ["region-a", "region-b", "region-c"],
  });
  assert.equal(missingRes.valid, false);
  assert.ok(missingRes.errors.some((e) => e.includes("DOC_GENERATED_REGION_MISSING") && e.includes("region-c")));

  // Unknown region present
  const unknownRes = validateGeneratedRegions({
    content,
    relPath: "test.md",
    expectedRegions: ["region-a"],
  });
  assert.equal(unknownRes.valid, false);
  assert.ok(unknownRes.errors.some((e) => e.includes("DOC_GENERATED_REGION_UNKNOWN") && e.includes("region-b")));

  // Nested regions
  const nested = [
    "<!-- BEGIN FORGELOOP GENERATED: region-a -->",
    "<!-- BEGIN FORGELOOP GENERATED: region-b -->",
    "inner",
    "<!-- END FORGELOOP GENERATED: region-b -->",
    "<!-- END FORGELOOP GENERATED: region-a -->",
  ].join("\n");

  const nestedRes = validateGeneratedRegions({
    content: nested,
    relPath: "test.md",
    expectedRegions: ["region-a", "region-b"],
  });
  assert.equal(nestedRes.valid, false);
  assert.ok(nestedRes.errors.some((e) => e.includes("DOC_GENERATED_REGION_NESTED")));
});

test("generated regions unit tests: replaceGeneratedRegion and compareGeneratedRegion", () => {
  const content = "<!-- BEGIN FORGELOOP GENERATED: test-region -->\nold body\n<!-- END FORGELOOP GENERATED: test-region -->";
  
  const cmpStale = compareGeneratedRegion({ content, region: "test-region", expectedBody: "new body" });
  assert.equal(cmpStale.match, false);
  assert.equal(cmpStale.existing, "old body");

  const replaced = replaceGeneratedRegion({ content, region: "test-region", newBody: "new body" });
  const cmpFresh = compareGeneratedRegion({ content: replaced, region: "test-region", expectedBody: "new body" });
  assert.equal(cmpFresh.match, true);
});

test("generated regions unit tests: validateGeneratedRegionBody rejects undefined output", async () => {
  const { validateGeneratedRegionBody } = await import("../scripts/generate_documentation_reference.mjs");
  const errors = validateGeneratedRegionBody({
    body: "- `field`: undefined",
    relPath: "docs/ARTIFACT_REFERENCE.md",
    region: "schema:execution",
  });
  assert.ok(errors.some((error) => error.includes("DOC_GENERATED_OUTPUT_INVALID") && error.includes("DOC_GENERATED_OUTPUT_UNDEFINED")));
});

test("generated regions unit tests: validateGeneratedRegionBody rejects object stringification", async () => {
  const { validateGeneratedRegionBody } = await import("../scripts/generate_documentation_reference.mjs");
  const errors = validateGeneratedRegionBody({
    body: "- `field`: [object Object]",
    relPath: "docs/ARTIFACT_REFERENCE.md",
    region: "schema:execution",
  });
  assert.ok(errors.some((error) => error.includes("DOC_GENERATED_OUTPUT_INVALID") && error.includes("DOC_GENERATED_OUTPUT_OBJECT_STRING")));
});

test("documentation table cells escape backslashes and pipes and flatten newlines", async () => {
  const { escapeMarkdownTableCell } = await import("../scripts/generate_documentation_reference.mjs");
  assert.equal(escapeMarkdownTableCell("path\\segment|value\nnext"), "path\\\\segment\\|value next");
});

test("generated regions unit tests: validateGeneratedRegionBody rejects NaN and malformed patterns", async () => {
  const { validateGeneratedRegionBody } = await import("../scripts/generate_documentation_reference.mjs");
  const nanErrors = validateGeneratedRegionBody({
    body: "- `field`: NaN",
    relPath: "docs/ARTIFACT_REFERENCE.md",
    region: "schema:execution",
  });
  assert.ok(nanErrors.some((error) => error.includes("DOC_GENERATED_OUTPUT_NAN")));

  const dupErrors = validateGeneratedRegionBody({
    body: "- `--flag`: value (repeatable) (repeatable)",
    relPath: "docs/CLI_REFERENCE.md",
    region: "cli:route:options",
  });
  assert.ok(dupErrors.some((error) => error.includes("DOC_GENERATED_OUTPUT_DUPLICATE_REPEATABLE")));

  const markerErrors = validateGeneratedRegionBody({
    body: "- `-- <argv...>`: description <<argv...>>",
    relPath: "docs/CLI_REFERENCE.md",
    region: "cli:run-check:options",
  });
  assert.ok(markerErrors.some((error) => error.includes("DOC_GENERATED_OUTPUT_DOUBLE_VALUE_MARKER")));
});

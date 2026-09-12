import assert from "node:assert/strict";
import { test } from "node:test";

import { detectProjectEvidence } from "../src/core/project-detection.js";
import { parseSwiftCMake, parseSwiftMeson, parseSwiftPackage, parseXcodeProject } from "../src/core/swift-project.js";
import { evaluateRoute } from "../src/core/router.js";
import { temporaryProject, writeFiles } from "./helpers/multi-language-project.js";

test("Swift package and Xcode recognizers require static Swift markers", () => {
  assert.equal(parseSwiftPackage("// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: \"app\")\n").valid, true);
  assert.equal(parseSwiftPackage("import PackageDescription\nlet package = Package(name: \"app\")\n").valid, false);
  assert.equal(parseXcodeProject("SWIFT_VERSION = 6.0; file.swift in Sources;").swift, true);
  assert.equal(parseXcodeProject("SWIFT_VERSION = 6.0;").valid, false);
  assert.equal(parseSwiftMeson("project('app', 'swift')").swift, true);
  assert.equal(parseSwiftMeson("project('app', 'c')").swift, false);
  assert.equal(parseSwiftCMake("# project(fake LANGUAGES Swift)\n").valid, false);
  assert.equal(parseSwiftMeson("# project('fake', 'swift')\n").valid, false);
});

test("Package.swift activates Swift and a C-only package composes only native evidence", async () => {
  await temporaryProject("forgeloop-swift-detection-", async (target) => {
    await writeFiles(target, {
      "Package.swift": "// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: \"app\")\n",
      "Sources/App/main.swift": "import Foundation\nstruct App {}\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["swift"]);
    assert.deepEqual(evaluateRoute({ workType: "code", projectEvidence: evidence }).guides.slice(0, 3), ["swift", "clean", "test"]);
  });

  await temporaryProject("forgeloop-swift-c-only-", async (target) => {
    await writeFiles(target, {
      "Package.swift": "// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: \"c-app\")\n",
      "Sources/App/main.c": "int main(void) { return 0; }\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["c"]);
    assert.equal(evidence.frameworks.includes("swift"), false);
  });
});

test("Package.resolved alone does not activate Swift", async () => {
  await temporaryProject("forgeloop-swift-resolved-negative-", async (target) => {
    await writeFiles(target, { "Package.resolved": "{\"pins\": []}\n" });
    assert.equal(await detectProjectEvidence(target), null);
  });
});

test("Package.swift without a Swift target is only SwiftPM topology", async () => {
  await temporaryProject("forgeloop-swift-package-topology-only-", async (target) => {
    await writeFiles(target, {
      "Package.swift": "// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: \"metadata-only\")\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
  });
});

test("Meson Swift build declarations compose with native source evidence", async () => {
  await temporaryProject("forgeloop-swift-meson-", async (target) => {
    await writeFiles(target, {
      "meson.build": "project('app', 'swift')\n",
      "main.swift": "import Foundation\nlet value = 1\n",
    });
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["swift"]);
  });
});

test("a direct Package.swift claim selects Swift for a native-only package", async () => {
  await temporaryProject("forgeloop-swift-package-claim-", async (target) => {
    await writeFiles(target, {
      "Package.swift": "// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: \"c-app\")\n",
      "Sources/App/main.c": "int main(void) { return 0; }\n",
    });
    const evidence = await detectProjectEvidence(target, { claims: ["Package.swift"] });
    assert.deepEqual(evidence.frameworks, ["c", "swift"]);
  });
});

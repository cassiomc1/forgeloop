import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runRoute } from "../src/commands/route.js";
import {
  detectProjectEvidence,
  parsePubspec,
} from "../src/core/project-detection.js";
import { evaluateRoute } from "../src/core/router.js";
import { getPackageRoot } from "../src/core/templates.js";

const packageRoot = getPackageRoot();

async function temporaryProject(prefix, callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

const flutterPubspec = `name: sample_app
description: A test application
environment:
  sdk: ">=3.0.0 <4.0.0"
dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.0
dev_dependencies:
  flutter_test:
    sdk: flutter
flutter:
  uses-material-design: true
  assets:
    - assets/
`;

test("structural Flutter SDK dependency selects flutter with the baseline guides", async () => {
  await temporaryProject("forgeloop-flutter-detection-positive-", async (target) => {
    await writeFile(path.join(target, "pubspec.yaml"), flutterPubspec);
    await mkdir(path.join(target, "lib"), { recursive: true });
    await mkdir(path.join(target, "android"), { recursive: true });
    await writeFile(
      path.join(target, "lib", "main.dart"),
      "import 'package:flutter/material.dart';\nvoid main() {}\n",
    );

    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["flutter"]);
    assert.equal(evidence.scope, "UNSCOPED");
    assert.deepEqual(evidence.projectRoots, ["."]);
    assert.deepEqual(evidence.primarySignals, ["pubspec.yaml:dependencies.flutter.sdk"]);
    assert.ok(evidence.supportingSignals.includes("pubspec.yaml:dev_dependencies.flutter_test.sdk"));
    assert.ok(evidence.supportingSignals.includes("android:directory"));
    assert.ok(evidence.supportingSignals.includes("source:package:flutter"));

    const route = evaluateRoute({ workType: "code", projectEvidence: evidence });
    assert.deepEqual(route.guides, ["flutter", "clean", "test"]);
    assert.equal(route.primary, "flutter");
    assert.deepEqual(route.reasons.flutter, ["PROJECT_FLUTTER_SDK_DEPENDENCY"]);
    assert.deepEqual(route.reasons.clean, ["PROJECT_FLUTTER_BASELINE", "WORK_CODE"]);
    assert.deepEqual(route.reasons.test, ["PROJECT_FLUTTER_BASELINE", "WORK_CODE"]);
  });
});

test("route command feeds repository evidence into the deterministic evaluator", async () => {
  await temporaryProject("forgeloop-flutter-route-command-", async (target) => {
    await writeFile(path.join(target, "pubspec.yaml"), flutterPubspec);
    const route = await runRoute({
      target,
      packageRoot,
      workType: "code",
      surfaces: [],
      risks: [],
      platforms: [],
    });
    assert.deepEqual(route.guides, ["flutter", "clean", "test"]);
    assert.equal(route.input.projectEvidence.scope, "UNSCOPED");
  });
});

test("flutter_test and supporting files never replace the primary SDK signal", async () => {
  await temporaryProject("forgeloop-flutter-detection-supporting-", async (target) => {
    await writeFile(path.join(target, "pubspec.yaml"), `name: dart_package
dependencies:
  http: ^1.0.0
dev_dependencies:
  flutter_test:
    sdk: flutter
`);
    await writeFile(path.join(target, "README.md"), "This package discusses Flutter integration.\n");
    await writeFile(path.join(target, "pubspec.lock"), "flutter_something:\n  dependency: transitive\n");
    await mkdir(path.join(target, "flutter_something"), { recursive: true });

    const parsed = parsePubspec(await readFile(path.join(target, "pubspec.yaml"), "utf8"));
    assert.equal(parsed.valid, true);
    assert.equal(parsed.primary, false);
    assert.equal(parsed.flutterTest, true);

    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
    assert.ok(evidence.supportingSignals.includes("pubspec.yaml:dev_dependencies.flutter_test.sdk"));
    const route = evaluateRoute({ workType: "code", projectEvidence: evidence });
    assert.equal(route.guides.includes("flutter"), false);
    assert.deepEqual(route.excluded.flutter, ["NO_FLUTTER_PRIMARY_EVIDENCE"]);
  });
});

test("pubspec parsing accepts supported forms, ignores unrelated flow lists, and fails closed for dependency sequences", () => {
  const inline = parsePubspec(`name: inline
dependencies: {flutter: {sdk: flutter}}
`);
  assert.equal(inline.valid, true);
  assert.equal(inline.primary, true);

  const unrelatedList = parsePubspec(`name: list
some_field: [one, two]
dependencies:
  flutter:
    sdk: flutter
`);
  assert.equal(unrelatedList.valid, true);
  assert.equal(unrelatedList.primary, true);

  const malformed = parsePubspec(`name: malformed
dependencies:
  flutter:
    - sdk: flutter
`);
  assert.equal(malformed.valid, false);
  assert.equal(malformed.primary, false);
});

test("prose, lockfiles, hosted flutter packages, and arbitrary names do not trigger detection", async () => {
  await temporaryProject("forgeloop-flutter-detection-negative-", async (target) => {
    await writeFile(path.join(target, "README.md"), "Flutter is mentioned here, but this is not a Flutter project.\n");
    await writeFile(path.join(target, "pubspec.lock"), "flutter:\n  dependency: transitive\n");
    await mkdir(path.join(target, "flutter_project_name"), { recursive: true });
    assert.equal(await detectProjectEvidence(target), null);

    await writeFile(path.join(target, "pubspec.yaml"), `name: hosted_package
dependencies:
  flutter: ^3.0.0
  flutter_widgets: ^1.0.0
`);
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.primarySignals, []);
    assert.equal(evaluateRoute({ workType: "code", projectEvidence: evidence }).guides.includes("flutter"), false);
  });
});

test("nested projects honor task claim scope and avoid unrelated Flutter activation", async () => {
  await temporaryProject("forgeloop-flutter-detection-scope-", async (target) => {
    await mkdir(path.join(target, "apps", "mobile", "lib"), { recursive: true });
    await mkdir(path.join(target, "apps", "server"), { recursive: true });
    await writeFile(path.join(target, "apps", "mobile", "pubspec.yaml"), flutterPubspec);
    await writeFile(path.join(target, "apps", "mobile", "pubspec.lock"), "packages: {}\n");
    await writeFile(path.join(target, "apps", "mobile", "l10n.yaml"), "arb-dir: lib/l10n\n");
    await writeFile(path.join(target, "apps", "server", "pubspec.yaml"), `name: server
dependencies:
  shelf: ^1.0.0
`);

    for (const claim of ["apps/mobile/lib", "apps/mobile/pubspec.lock", "apps/mobile/l10n.yaml"]) {
      const mobile = await detectProjectEvidence(target, { claims: [claim] });
      assert.equal(mobile.scope, "MATCH");
      assert.deepEqual(mobile.projectRoots, ["apps/mobile"]);
      assert.deepEqual(mobile.frameworks, ["flutter"]);
    }

    const server = await detectProjectEvidence(target, { claims: ["apps/server"] });
    assert.equal(server.scope, "MATCH");
    assert.deepEqual(server.projectRoots, ["apps/server"]);
    assert.deepEqual(server.frameworks, []);

    const unrelated = await detectProjectEvidence(target, { claims: ["README.md"] });
    assert.equal(unrelated.scope, "NO_MATCH");
    assert.deepEqual(unrelated.frameworks, []);
    const route = evaluateRoute({ workType: "code", projectEvidence: unrelated });
    assert.equal(route.guides.includes("flutter"), false);
    assert.deepEqual(route.excluded.flutter, ["NO_FLUTTER_SCOPE_MATCH"]);
  });
});

test("Dart discovery skips symlinks without skipping sorted siblings", async () => {
  await temporaryProject("forgeloop-flutter-detection-symlink-", async (target) => {
    await mkdir(path.join(target, "lib"), { recursive: true });
    await writeFile(path.join(target, "outside.dart"), "void outside() {}\n");
    await symlink(path.join(target, "outside.dart"), path.join(target, "lib", "a_symlink.dart"));
    await writeFile(
      path.join(target, "lib", "main.dart"),
      "import 'package:flutter/material.dart';\nvoid main() {}\n",
    );
    await writeFile(path.join(target, "pubspec.yaml"), flutterPubspec);

    const evidence = await detectProjectEvidence(target);
    assert.ok(evidence.supportingSignals.includes("source:package:flutter"));
  });

  await temporaryProject("forgeloop-flutter-detection-no-follow-", async (target) => {
    await mkdir(path.join(target, "lib"), { recursive: true });
    await writeFile(
      path.join(target, "outside.dart"),
      "import 'package:flutter/material.dart';\nvoid outside() {}\n",
    );
    await symlink(path.join(target, "outside.dart"), path.join(target, "lib", "a_symlink.dart"));
    await writeFile(path.join(target, "lib", "main.dart"), "void main() {}\n");
    await writeFile(path.join(target, "pubspec.yaml"), flutterPubspec);

    const evidence = await detectProjectEvidence(target);
    assert.equal(evidence.supportingSignals.includes("source:package:flutter"), false);
  });
});

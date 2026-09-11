import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runRoute } from "../src/commands/route.js";
import {
  detectProjectEvidence,
  parseDotNetProject,
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

const dotnetLibraryProject = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>
</Project>
`;

test("SDK-style .NET projects provide primary evidence and parse structural metadata", async () => {
  const parsed = parseDotNetProject(dotnetLibraryProject);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.sdkStyle, true);
  assert.equal(parsed.dotnet, true);
  assert.equal(parsed.aspnetcore, false);
  assert.deepEqual(parsed.projectSdks, ["Microsoft.NET.Sdk"]);
  assert.deepEqual(parsed.targetFrameworks, ["net10.0"]);

  await temporaryProject("forgeloop-dotnet-detection-positive-", async (target) => {
    await writeFile(path.join(target, "Library.csproj"), dotnetLibraryProject);
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["dotnet"]);
    assert.equal(evidence.scope, "UNSCOPED");
    assert.deepEqual(evidence.projectRoots, ["."]);
    assert.deepEqual(evidence.primarySignals, ["Library.csproj:project.sdk=Microsoft.NET.Sdk"]);
    assert.ok(evidence.supportingSignals.includes("Library.csproj:targetFramework=net10.0"));
  });
});

test("Web SDK, framework references, and ABP packages classify overlays without changing the guide ID", () => {
  const web = parseDotNetProject(`<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFrameworks>net8.0; net10.0</TargetFrameworks></PropertyGroup>
  <ItemGroup><FrameworkReference Include="Microsoft.AspNetCore.App" /></ItemGroup>
</Project>`);
  assert.equal(web.valid, true);
  assert.equal(web.dotnet, true);
  assert.equal(web.aspnetcore, true);
  assert.deepEqual(web.targetFrameworks, ["net10.0", "net8.0"]);
  assert.deepEqual(web.frameworkReferences, ["Microsoft.AspNetCore.App"]);

  const abp = parseDotNetProject(`<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <PackageReference Include="Volo.Abp.AspNetCore.Mvc"><Version>8.2.0</Version></PackageReference>
    <PackageReference Include="Volo.Abp.EntityFrameworkCore" Version="8.2.0" />
  </ItemGroup>
</Project>`);
  assert.equal(abp.aspnetcore, true);
  assert.equal(abp.abp, true);
  assert.deepEqual(abp.packageReferences, ["Volo.Abp.AspNetCore.Mvc", "Volo.Abp.EntityFrameworkCore"]);
});

test("alternate SDK syntax, worker projects, and project references are structural evidence", () => {
  const alternate = parseDotNetProject(`<Project>
  <Sdk Name="Microsoft.NET.Sdk.Web" />
  <ItemGroup><ProjectReference Include="../Domain/Domain.csproj" /></ItemGroup>
</Project>`);
  assert.equal(alternate.valid, true);
  assert.equal(alternate.dotnet, true);
  assert.equal(alternate.aspnetcore, true);
  assert.deepEqual(alternate.projectReferences, ["../Domain/Domain.csproj"]);

  const worker = parseDotNetProject(`<Project Sdk="Microsoft.NET.Sdk.Worker"></Project>`);
  assert.equal(worker.dotnet, true);
  assert.equal(worker.aspnetcore, false);
});

test("malformed, oversized, and weak .NET signals fail closed", async () => {
  const malformedText = `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>`;
  const malformed = parseDotNetProject(malformedText);
  assert.equal(malformed.valid, false);
  assert.equal(malformed.dotnet, false);

  const oversized = parseDotNetProject(`<Project Sdk="Microsoft.NET.Sdk">${"x".repeat(1024 * 1024)}</Project>`);
  assert.equal(oversized.valid, false);
  assert.equal(oversized.dotnet, false);
  const trailingText = parseDotNetProject(`${dotnetLibraryProject}unexpected`);
  assert.equal(trailingText.valid, false);
  assert.equal(trailingText.dotnet, false);

  await temporaryProject("forgeloop-dotnet-detection-negative-", async (target) => {
    await writeFile(path.join(target, "Program.cs"), "class Program {}\n");
    await writeFile(path.join(target, "README.md"), "This will use ASP.NET Core and ABP.\n");
    await writeFile(path.join(target, "Dockerfile"), "FROM mcr.microsoft.com/dotnet/aspnet:10.0\n");
    await writeFile(path.join(target, "packages.lock.json"), "{}\n");
    assert.equal(await detectProjectEvidence(target), null);

    await writeFile(path.join(target, "Broken.csproj"), malformedText);
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.primarySignals, []);
  });
});

test("shared .NET configuration and exact solution membership constrain scope", async () => {
  await temporaryProject("forgeloop-dotnet-detection-scope-", async (target) => {
    await mkdir(path.join(target, "src", "A"), { recursive: true });
    await mkdir(path.join(target, "src", "B"), { recursive: true });
    await mkdir(path.join(target, "tools", "Unrelated"), { recursive: true });
    await writeFile(path.join(target, "src", "A", "A.csproj"), dotnetLibraryProject);
    await writeFile(path.join(target, "src", "B", "B.csproj"), `<Project Sdk="Microsoft.NET.Sdk.Web" />`);
    await writeFile(path.join(target, "tools", "Unrelated", "Tool.csproj"), dotnetLibraryProject);
    await writeFile(path.join(target, "Directory.Build.props"), "<Project />\n");
    await writeFile(path.join(target, "Directory.Packages.props"), "<Project />\n");
    await writeFile(path.join(target, "global.json"), "{\"sdk\":{\"version\":\"10.0.100\"}}\n");
    await writeFile(path.join(target, "Product.sln"), `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{A}") = "A", "src\\A\\A.csproj", "{A}"
EndProject
Project("{B}") = "B", "src\\B\\B.csproj", "{B}"
EndProject
`);

    const shared = await detectProjectEvidence(target, { claims: ["Directory.Build.props"] });
    assert.equal(shared.scope, "MATCH");
    assert.deepEqual(shared.projectRoots, ["src/A", "src/B", "tools/Unrelated"]);
    assert.deepEqual(shared.frameworks, ["aspnetcore", "dotnet"]);

    const solution = await detectProjectEvidence(target, { claims: ["Product.sln"] });
    assert.deepEqual(solution.projectRoots, ["src/A", "src/B"]);
    assert.deepEqual(solution.frameworks, ["aspnetcore", "dotnet"]);

    const sibling = await detectProjectEvidence(target, { claims: ["src/A/A.csproj"] });
    assert.deepEqual(sibling.projectRoots, ["src/A"]);
    assert.deepEqual(sibling.frameworks, ["dotnet"]);

    const unrelated = await detectProjectEvidence(target, { claims: ["README.md"] });
    assert.equal(unrelated.scope, "NO_MATCH");
    assert.deepEqual(unrelated.frameworks, []);
  });
});

test("Flutter and .NET projects remain isolated in a mixed monorepo", async () => {
  await temporaryProject("forgeloop-mixed-project-detection-", async (target) => {
    await mkdir(path.join(target, "apps", "mobile", "lib"), { recursive: true });
    await mkdir(path.join(target, "services", "api"), { recursive: true });
    await writeFile(path.join(target, "apps", "mobile", "pubspec.yaml"), flutterPubspec);
    await writeFile(path.join(target, "services", "api", "Api.csproj"), dotnetLibraryProject);

    const mobile = await detectProjectEvidence(target, { claims: ["apps/mobile/lib/main.dart"] });
    assert.deepEqual(mobile.frameworks, ["flutter"]);
    const api = await detectProjectEvidence(target, { claims: ["services/api/Api.csproj"] });
    assert.deepEqual(api.frameworks, ["dotnet"]);
    const both = await detectProjectEvidence(target, { claims: ["apps/mobile", "services/api"] });
    assert.deepEqual(both.frameworks, ["dotnet", "flutter"]);
  });
});

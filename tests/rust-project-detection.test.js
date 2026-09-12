import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  detectProjectEvidence,
  PROJECT_DETECTION_LIMITS,
  readBounded,
} from "../src/core/project-detection.js";
import { parseCargoManifest } from "../src/core/rust-project.js";
import { evaluateRoute } from "../src/core/router.js";

async function temporaryProject(prefix, callback) {
  const target = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

async function writeText(target, relativePath, text) {
  const filePath = path.join(target, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

const packageManifest = [
  "[package]",
  "name = \"api\"",
  "edition = \"2024\"",
  "rust-version = \"1.85\"",
  "",
  "[dependencies]",
  "tokio = { version = \"1\", features = [\"rt-multi-thread\"] }",
  "serde = \"1\"",
  "",
  "[dev-dependencies]",
  "assert_cmd = \"2\"",
  "",
  "[build-dependencies]",
  "cc = \"1\"",
  "",
  "[target.'cfg(unix)'.dependencies]",
  "libc = \"0.2\"",
  "",
  "[features]",
  "default = []",
  "http = [\"tokio\"]",
  "",
].join("\n");

test("parseCargoManifest uses structural TOML and separates Cargo metadata", () => {
  const parsed = parseCargoManifest(packageManifest);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.rust, true);
  assert.deepEqual(parsed.package, { present: true, name: "api", edition: "2024", rustVersion: "1.85" });
  assert.deepEqual(parsed.workspace, {
    present: false,
    members: [],
    exclude: [],
    defaultMembers: [],
    resolver: null,
  });
  assert.deepEqual(parsed.dependencies, ["serde", "tokio"]);
  assert.deepEqual(parsed.devDependencies, ["assert_cmd"]);
  assert.deepEqual(parsed.buildDependencies, ["cc"]);
  assert.deepEqual(parsed.targetDependencies, ["libc"]);
  assert.deepEqual(parsed.features, ["default", "http"]);
  assert.deepEqual(parsed.backendContexts, ["tokio"]);
});

test("Cargo package metadata accepts type-safe workspace inheritance and path dependencies", () => {
  const parsed = parseCargoManifest([
    "[package]",
    "name = \"member\"",
    "edition.workspace = true",
    "rust-version = \"1.85\"",
    "workspace = \"../..\"",
    "",
    "[dependencies]",
    "shared = { path = \"../shared\" }",
    "",
    "[workspace]",
    "dependencies = { shared = { path = \"crates/shared\" } }",
    "",
  ].join("\n"));

  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.package, {
    present: true,
    name: "member",
    edition: null,
    rustVersion: "1.85",
    editionInherited: true,
    workspace: "../..",
  });
  assert.deepEqual(parsed.pathDependencies, [
    { name: "shared", path: "../shared" },
    { name: "shared", path: "crates/shared" },
  ]);

  const inheritedMsrv = parseCargoManifest("[package]\nname = \"member\"\nedition = \"2024\"\nrust-version.workspace = true\n");
  assert.equal(inheritedMsrv.valid, true);
  assert.equal(inheritedMsrv.package.edition, "2024");
  assert.equal(inheritedMsrv.package.rustVersionInherited, true);

  const inheritedEdition = parseCargoManifest("[package]\nname = \"member\"\nedition.workspace = true\nrust-version = \"1.85\"\n");
  assert.equal(inheritedEdition.valid, true);
  assert.equal(inheritedEdition.package.editionInherited, true);
  assert.equal(inheritedEdition.package.rustVersion, "1.85");
});

test("workspace.package metadata is retained as supporting Cargo context", () => {
  const parsed = parseCargoManifest([
    "[workspace]",
    "members = [\"crates/*\"]",
    "",
    "[workspace.package]",
    "edition = \"2024\"",
    "rust-version = \"1.85\"",
    "license = \"MIT\"",
    "",
  ].join("\n"));

  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.workspace.package, {
    present: true,
    edition: "2024",
    rustVersion: "1.85",
  });
});

test("workspace-inherited package fields remain confirmed in a known workspace", async () => {
  await temporaryProject("forgeloop-rust-workspace-inheritance-", async (target) => {
    await writeText(target, "Cargo.toml", [
      "[workspace]",
      "members = [\"crates/api\"]",
      "",
      "[workspace.package]",
      "edition = \"2024\"",
      "rust-version = \"1.85\"",
      "",
    ].join("\n"));
    await writeText(target, "crates/api/Cargo.toml", [
      "[package]",
      "name = \"api\"",
      "edition.workspace = true",
      "rust-version.workspace = true",
      "",
    ].join("\n"));

    const evidence = await detectProjectEvidence(target, { claims: ["Cargo.toml"] });
    assert.deepEqual(evidence.frameworks, ["rust"]);
    assert.deepEqual(evidence.projectRoots, ["crates/api"]);
    assert.ok(evidence.supportingSignals.includes("crates/api/Cargo.toml:edition=workspace"));
    assert.ok(evidence.supportingSignals.includes("crates/api/Cargo.toml:rust-version=workspace"));
    assert.ok(evidence.supportingSignals.includes("Cargo.toml:workspace.package.edition=2024"));
    assert.ok(evidence.supportingSignals.includes("Cargo.toml:workspace.package.rust-version=1.85"));
  });
});

test("a Cargo package is primary Rust evidence and selects the Rust baseline", async () => {
  await temporaryProject("forgeloop-rust-package-", async (target) => {
    await writeText(target, "Cargo.toml", packageManifest);
    await writeText(target, "src/main.rs", "fn main() {}\n");
    await writeText(target, "Cargo.lock", "version = 4\n");
    await writeText(target, "rust-toolchain.toml", "channel = \"stable\"\n");

    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["rust"]);
    assert.equal(evidence.scope, "UNSCOPED");
    assert.deepEqual(evidence.projectRoots, ["."]);
    assert.deepEqual(evidence.primarySignals, ["Cargo.toml:package"]);
    assert.ok(evidence.supportingSignals.includes("Cargo.toml:edition=2024"));
    assert.ok(evidence.supportingSignals.includes("Cargo.toml:rust-version=1.85"));
    assert.ok(evidence.supportingSignals.includes("Cargo.toml:dependency=tokio"));
    assert.ok(evidence.supportingSignals.includes("Cargo.lock:workspace-shared"));
    assert.ok(evidence.supportingSignals.includes("rust-toolchain.toml:rust-scope"));

    const route = evaluateRoute({ workType: "backend", projectEvidence: evidence });
    assert.deepEqual(route.guides, ["rust", "clean", "test"]);
    assert.deepEqual(route.reasons.rust, [
      "PROJECT_RUST_CONFIRMED",
      "PROJECT_RUST_CARGO_PACKAGE",
    ]);
    assert.deepEqual(route.reasons.clean, ["PROJECT_RUST_BASELINE", "WORK_BACKEND"]);
    assert.deepEqual(route.reasons.test, ["PROJECT_RUST_BASELINE", "WORK_BACKEND"]);
  });
});

test("virtual workspaces select confirmed package members without exposing the virtual root", async () => {
  await temporaryProject("forgeloop-rust-virtual-workspace-", async (target) => {
    await writeText(target, "Cargo.toml", [
      "[workspace]",
      "members = [\"crates/*\", \"services/api\"]",
      "exclude = [\"crates/legacy\"]",
      "resolver = \"3\"",
      "",
    ].join("\n"));
    for (const member of ["crates/a", "crates/b", "crates/legacy", "services/api"]) {
      await writeText(target, `${member}/Cargo.toml`, `[package]\nname = \"${path.posix.basename(member)}\"\n`);
    }
    await writeText(target, "target/generated/Cargo.toml", "[package]\nname = \"generated\"\n");
    await writeText(target, "vendor/dependency/Cargo.toml", "[package]\nname = \"vendor\"\n");

    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["rust"]);
    assert.deepEqual(evidence.projectRoots, ["crates/a", "crates/b", "crates/legacy", "services/api"]);
    assert.deepEqual(evidence.primarySignals, [
      "Cargo.toml:workspace",
      "crates/a/Cargo.toml:package",
      "crates/b/Cargo.toml:package",
      "crates/legacy/Cargo.toml:package",
      "services/api/Cargo.toml:package",
    ]);
    assert.ok(evidence.supportingSignals.includes("Cargo.toml:resolver=3"));
    assert.equal(evidence.projectRoots.includes("target/generated"), false);
    assert.equal(evidence.projectRoots.includes("vendor/dependency"), false);

    const workspace = await detectProjectEvidence(target, { claims: ["Cargo.toml"] });
    assert.equal(workspace.scope, "MATCH");
    assert.deepEqual(workspace.frameworks, ["rust"]);
    assert.deepEqual(workspace.projectRoots, ["crates/a", "crates/b", "services/api"]);
    assert.ok(workspace.primarySignals.includes("Cargo.toml:workspace"));
    assert.equal(workspace.projectRoots.includes("crates/legacy"), false);

    const member = await detectProjectEvidence(target, { claims: ["crates/a/src/main.rs"] });
    assert.deepEqual(member.projectRoots, ["crates/a"]);
    assert.deepEqual(member.frameworks, ["rust"]);
  });
});

test("a package plus workspace root records both roles without duplicate public roots", async () => {
  await temporaryProject("forgeloop-rust-package-workspace-", async (target) => {
    await writeText(target, "Cargo.toml", [
      "[package]",
      "name = \"root\"",
      "",
      "[workspace]",
      "members = [\"crates/api\"]",
      "",
    ].join("\n"));
    await writeText(target, "crates/api/Cargo.toml", "[package]\nname = \"api\"\n");

    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.projectRoots, [".", "crates/api"]);
    assert.deepEqual(evidence.primarySignals, ["Cargo.toml:package", "Cargo.toml:workspace", "crates/api/Cargo.toml:package"]);

    const rootClaim = await detectProjectEvidence(target, { claims: ["Cargo.toml"] });
    assert.deepEqual(rootClaim.projectRoots, [".", "crates/api"]);
    assert.deepEqual(rootClaim.frameworks, ["rust"]);
  });
});

test("empty or unresolved virtual workspaces fail closed while package workspaces remain valid", async () => {
  const cases = [
    ["empty", "[workspace]\n", false],
    ["missing-member", "[workspace]\nmembers = [\"crates/missing\"]\n", false],
    ["package-root", "[package]\nname = \"root\"\n\n[workspace]\n", true],
  ];
  for (const [name, manifest, confirmed] of cases) {
    await temporaryProject(`forgeloop-rust-workspace-${name}-`, async (target) => {
      await writeText(target, "Cargo.toml", manifest);
      const evidence = await detectProjectEvidence(target);
      assert.equal(evidence.frameworks.includes("rust"), confirmed, name);
      assert.equal(evidence.primarySignals.includes("Cargo.toml:package"), confirmed, name);
      if (!confirmed) assert.deepEqual(evidence.primarySignals, [], name);
    });
  }

  await temporaryProject("forgeloop-rust-workspace-resolved-member-", async (target) => {
    await writeText(target, "Cargo.toml", "[workspace]\nmembers = [\"crates/api\"]\n");
    await writeText(target, "crates/api/Cargo.toml", "[package]\nname = \"api\"\n");
    const evidence = await detectProjectEvidence(target, { claims: ["Cargo.toml"] });
    assert.deepEqual(evidence.frameworks, ["rust"]);
    assert.deepEqual(evidence.projectRoots, ["crates/api"]);
  });
});

test("implicit Cargo path members participate in workspace and shared lockfile claims", async () => {
  await temporaryProject("forgeloop-rust-path-members-", async (target) => {
    await writeText(target, "Cargo.toml", [
      "[workspace]",
      "members = [\"crates/api\"]",
      "exclude = [\"crates/excluded\"]",
      "",
    ].join("\n"));
    await writeText(target, "crates/api/Cargo.toml", [
      "[package]",
      "name = \"api\"",
      "",
      "[dependencies]",
      "shared = { path = \"../shared\" }",
      "excluded = { path = \"../excluded\" }",
      "",
    ].join("\n"));
    await writeText(target, "crates/shared/Cargo.toml", "[package]\nname = \"shared\"\n");
    await writeText(target, "crates/excluded/Cargo.toml", "[package]\nname = \"excluded\"\n");
    await writeText(target, "Cargo.lock", "version = 4\n");
    await writeText(target, ".cargo/config.toml", "[build]\ntarget-dir = \"target\"\n");

    const workspace = await detectProjectEvidence(target, { claims: ["Cargo.toml"] });
    assert.deepEqual(workspace.projectRoots, ["crates/api", "crates/shared"]);
    assert.equal(workspace.projectRoots.includes("crates/excluded"), false);

    const lockfile = await detectProjectEvidence(target, { claims: ["Cargo.lock"] });
    assert.deepEqual(lockfile.projectRoots, ["crates/api", "crates/shared"]);
    assert.equal(lockfile.projectRoots.includes("crates/excluded"), false);

    const config = await detectProjectEvidence(target, { claims: [".cargo/config.toml"] });
    assert.ok(config.projectRoots.includes("crates/shared"));
    assert.equal(config.projectRoots.includes("crates/excluded"), false);
  });
});

test("Cargo package.workspace associates a known package with its in-repository workspace", async () => {
  await temporaryProject("forgeloop-rust-package-workspace-association-", async (target) => {
    await writeText(target, "Cargo.toml", "[workspace]\n\n");
    await writeText(target, "crates/member/Cargo.toml", [
      "[package]",
      "name = \"member\"",
      "workspace = \"../..\"",
      "",
    ].join("\n"));

    const evidence = await detectProjectEvidence(target, { claims: ["Cargo.toml"] });
    assert.deepEqual(evidence.frameworks, ["rust"]);
    assert.deepEqual(evidence.projectRoots, ["crates/member"]);
    assert.ok(evidence.primarySignals.includes("Cargo.toml:workspace"));
  });
});

test("Cargo workspace globs stay bounded and preserve segment semantics", async () => {
  await temporaryProject("forgeloop-rust-workspace-globs-", async (target) => {
    await writeText(target, "Cargo.toml", [
      "[workspace]",
      "members = [\"crates/*\", \"crates/**\", \"services/?pi\"]",
      "exclude = [\"crates/skip\"]",
      "",
    ].join("\n"));
    for (const member of ["crates/one", "crates/nested/two", "crates/skip", "services/api", "services/other"]) {
      await writeText(target, `${member}/Cargo.toml`, `[package]\nname = \"${path.posix.basename(member)}\"\n`);
    }

    const evidence = await detectProjectEvidence(target, { claims: ["Cargo.toml"] });
    assert.deepEqual(evidence.projectRoots, ["crates/nested/two", "crates/one", "services/api"]);
    assert.equal(evidence.projectRoots.includes("crates/skip"), false);
    assert.equal(evidence.projectRoots.includes("services/other"), false);
  });

  await temporaryProject("forgeloop-rust-workspace-escaped-glob-", async (target) => {
    await writeText(target, "Cargo.toml", "[workspace]\nmembers = [\"../outside\"]\n");
    await writeText(target, "inside/Cargo.toml", "[package]\nname = \"inside\"\n");
    const evidence = await detectProjectEvidence(target, { claims: ["Cargo.toml"] });
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.primarySignals, []);
  });
});

test("Cargo metadata, source-only Rust files, and arbitrary TOML fail closed without primary evidence", async () => {
  const cases = [
    ["rust-source-only", { "src/main.rs": "fn main() {}\n" }],
    ["lockfile-only", { "Cargo.lock": "version = 4\n" }],
    ["toolchain-only", { "rust-toolchain.toml": "channel = \"stable\"\n" }],
    ["rustfmt-only", { "rustfmt.toml": "max_width = 100\n" }],
    ["arbitrary-cargo", { "Cargo.toml": "[metadata]\nname = \"not-a-package\"\n" }],
  ];
  for (const [name, files] of cases) {
    await temporaryProject(`forgeloop-rust-negative-${name}-`, async (target) => {
      for (const [relativePath, text] of Object.entries(files)) await writeText(target, relativePath, text);
      const evidence = await detectProjectEvidence(target);
      assert.ok(evidence === null || evidence.frameworks.length === 0, name);
      if (evidence) assert.deepEqual(evidence.primarySignals, [], name);
    });
  }
});

test("old and omitted Cargo editions, MSRV, and dependencies do not change Rust identity", async () => {
  await temporaryProject("forgeloop-rust-version-metadata-", async (target) => {
    await writeText(target, "old/Cargo.toml", "[package]\nname = \"old\"\nedition = \"2018\"\n");
    await writeText(target, "legacy/Cargo.toml", "[package]\nname = \"legacy\"\n");
    await writeText(target, "msrv/Cargo.toml", "[package]\nname = \"msrv\"\nrust-version = \"1.70\"\n");
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, ["rust"]);
    assert.deepEqual(evidence.projectRoots, ["legacy", "msrv", "old"]);
    assert.ok(evidence.supportingSignals.includes("old/Cargo.toml:edition=2018"));
    assert.ok(evidence.supportingSignals.includes("msrv/Cargo.toml:rust-version=1.70"));
    assert.equal(evidence.supportingSignals.some((signal) => signal.includes("edition=2015")), false);
  });
});

test("malformed and oversized Cargo manifests are rejected by the bounded parser", async () => {
  assert.equal(parseCargoManifest("[package\nname = \"broken\"\n").valid, false);
  assert.equal(parseCargoManifest("[package]\nversion = \"1.0.0\"\n").valid, false);
  assert.equal(parseCargoManifest("x".repeat(PROJECT_DETECTION_LIMITS.maxManifestBytes + 1)).valid, false);

  await temporaryProject("forgeloop-rust-malformed-", async (target) => {
    await writeText(target, "Cargo.toml", "[package\nname = \"broken\"\n");
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.primarySignals, []);
  });

  await temporaryProject("forgeloop-rust-oversized-", async (target) => {
    const manifestPath = path.join(target, "Cargo.toml");
    await writeFile(manifestPath, "", "utf8");
    await truncate(manifestPath, PROJECT_DETECTION_LIMITS.maxManifestBytes + 1);
    assert.equal(await readBounded(manifestPath, PROJECT_DETECTION_LIMITS.maxManifestBytes), null);
    const evidence = await detectProjectEvidence(target);
    assert.deepEqual(evidence.frameworks, []);
    assert.deepEqual(evidence.primarySignals, []);
  });
});

test("Rust shared files select the owning workspace members and preserve nested ownership", async () => {
  await temporaryProject("forgeloop-rust-shared-scope-", async (target) => {
    await writeText(target, "Cargo.toml", "[workspace]\nmembers = [\"crates/*\"]\n");
    await writeText(target, "crates/a/Cargo.toml", "[package]\nname = \"a\"\n");
    await writeText(target, "crates/b/Cargo.toml", "[package]\nname = \"b\"\n");
    await writeText(target, "Cargo.lock", "version = 4\n");
    await writeText(target, ".cargo/config.toml", "[build]\ntarget-dir = \"target\"\n");
    await writeText(target, "rust-toolchain.toml", "channel = \"stable\"\n");
    await writeText(target, "crates/a/rust-toolchain.toml", "channel = \"1.85\"\n");
    await writeText(target, "crates/a/Cargo.lock", "version = 4\n");

    const rootLock = await detectProjectEvidence(target, { claims: ["Cargo.lock"] });
    assert.deepEqual(rootLock.projectRoots, ["crates/a", "crates/b"]);
    assert.deepEqual(rootLock.frameworks, ["rust"]);

    const config = await detectProjectEvidence(target, { claims: [".cargo/config.toml"] });
    assert.deepEqual(config.projectRoots, ["crates/a", "crates/b"]);

    const rootToolchain = await detectProjectEvidence(target, { claims: ["rust-toolchain.toml"] });
    assert.deepEqual(rootToolchain.projectRoots, ["crates/b"]);

    const memberToolchain = await detectProjectEvidence(target, { claims: ["crates/a/rust-toolchain.toml"] });
    assert.deepEqual(memberToolchain.projectRoots, ["crates/a"]);

    const memberLock = await detectProjectEvidence(target, { claims: ["crates/a/Cargo.lock"] });
    assert.deepEqual(memberLock.projectRoots, ["crates/a"]);
  });
});

test("nested Rust workspaces are boundaries for workspace claims and shared files", async () => {
  await temporaryProject("forgeloop-rust-nested-workspace-", async (target) => {
    await writeText(target, "Cargo.toml", "[workspace]\nmembers = [\"crates/*\"]\n");
    await writeText(target, "crates/direct/Cargo.toml", "[package]\nname = \"direct\"\n");
    await writeText(target, "crates/nested/Cargo.toml", "[workspace]\nmembers = [\"member\"]\n");
    await writeText(target, "crates/nested/member/Cargo.toml", "[package]\nname = \"member\"\n");
    await writeText(target, "Cargo.lock", "version = 4\n");

    const rootClaim = await detectProjectEvidence(target, { claims: ["Cargo.toml"] });
    assert.deepEqual(rootClaim.projectRoots, ["crates/direct"]);
    assert.deepEqual(rootClaim.frameworks, ["rust"]);
    assert.equal(rootClaim.primarySignals.includes("crates/nested/Cargo.toml:workspace"), false);

    const nestedClaim = await detectProjectEvidence(target, { claims: ["crates/nested/Cargo.toml"] });
    assert.deepEqual(nestedClaim.projectRoots, ["crates/nested/member"]);

    const rootLock = await detectProjectEvidence(target, { claims: ["Cargo.lock"] });
    assert.deepEqual(rootLock.projectRoots, ["crates/direct"]);
  });
});

test("Rust, Flutter, .NET, and Node projects remain cross-stack ownership boundaries", async () => {
  await temporaryProject("forgeloop-rust-cross-stack-", async (target) => {
    await writeText(target, "apps/mobile/pubspec.yaml", "name: mobile\n\ndependencies:\n  flutter:\n    sdk: flutter\n\nflutter:\n  uses-material-design: true\n");
    await writeText(target, "services/dotnet/Api.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\" />\n");
    await writeText(target, "services/node/package.json", JSON.stringify({
      name: "node-service",
      scripts: { start: "node src/server.js" },
    }));
    await writeText(target, "services/node/src/server.js", "require(\"node:http\");\n");
    await writeText(target, "services/rust/Cargo.toml", "[package]\nname = \"rust-service\"\n");
    await writeText(target, "services/rust/src/main.rs", "fn main() {}\n");

    const rust = await detectProjectEvidence(target, { claims: ["services/rust/src/main.rs"] });
    assert.deepEqual(rust.frameworks, ["rust"]);
    assert.deepEqual(rust.projectRoots, ["services/rust"]);

    const node = await detectProjectEvidence(target, { claims: ["services/node/src/server.js"] });
    assert.deepEqual(node.frameworks, ["nodejs"]);
    assert.deepEqual(node.projectRoots, ["services/node"]);

    const mobile = await detectProjectEvidence(target, { claims: ["apps/mobile/pubspec.yaml"] });
    assert.deepEqual(mobile.frameworks, ["flutter"]);
    assert.deepEqual(mobile.projectRoots, ["apps/mobile"]);

    const dotnet = await detectProjectEvidence(target, { claims: ["services/dotnet/Api.csproj"] });
    assert.deepEqual(dotnet.frameworks, ["dotnet"]);
    assert.deepEqual(dotnet.projectRoots, ["services/dotnet"]);
  });
});

test("a Rust child remains isolated when nested under Node, .NET, or Flutter", async () => {
  await temporaryProject("forgeloop-rust-inverse-boundaries-", async (target) => {
    await writeText(target, "package.json", JSON.stringify({
      name: "node-parent",
      scripts: { start: "node src/server.js" },
    }));
    await writeText(target, "src/server.js", "require(\"node:http\");\n");
    await writeText(target, "dotnet/Api.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\" />\n");
    await writeText(target, "flutter/pubspec.yaml", "name: flutter_child\n\ndependencies:\n  flutter:\n    sdk: flutter\n\nflutter:\n  uses-material-design: true\n");
    await writeText(target, "rust/Cargo.toml", "[package]\nname = \"rust-child\"\n");

    const parent = await detectProjectEvidence(target, { claims: ["src/server.js", "dotnet/Api.csproj", "flutter/pubspec.yaml"] });
    assert.deepEqual(parent.frameworks, ["dotnet", "flutter", "nodejs"]);
    assert.deepEqual(parent.projectRoots, [".", "dotnet", "flutter"]);
    assert.equal(parent.projectRoots.includes("rust"), false);

    const child = await detectProjectEvidence(target, { claims: ["rust/Cargo.toml"] });
    assert.deepEqual(child.frameworks, ["rust"]);
    assert.deepEqual(child.projectRoots, ["rust"]);
  });
});

test("Rust traversal is bounded and does not follow symlinked directories", async () => {
  await temporaryProject("forgeloop-rust-symlink-budget-", async (target) => {
    await writeText(target, "Cargo.toml", "[package]\nname = \"root\"\n");
    await writeText(target, "src/main.rs", "fn main() {}\n");
    const outside = await mkdtemp(path.join(os.tmpdir(), "forgeloop-rust-outside-"));
    try {
      await writeText(outside, "Cargo.toml", "[package]\nname = \"outside\"\n");
      await symlink(outside, path.join(target, "linked"), "dir");
      const evidence = await detectProjectEvidence(target);
      assert.deepEqual(evidence.projectRoots, ["."]);
      assert.equal(evidence.primarySignals.includes("linked/Cargo.toml:package"), false);

      const limited = await detectProjectEvidence(target, {
        limits: { maxVisitedDirectories: 1, maxVisitedEntries: 2 },
      });
      assert.equal(limited, null);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("the router trusts public Rust framework evidence and keeps schema v1", () => {
  const result = evaluateRoute({
    workType: "backend",
    projectEvidence: {
      schemaVersion: 1,
      scope: "MATCH",
      frameworks: ["rust"],
      projectRoots: ["services/api"],
      primarySignals: [],
      supportingSignals: [],
    },
  });
  assert.deepEqual(result.guides, ["rust", "clean", "test"]);
  assert.equal(result.primary, "rust");
  assert.deepEqual(result.reasons.rust, ["PROJECT_RUST_CONFIRMED"]);
  assert.deepEqual(result.reasons.clean, ["PROJECT_RUST_BASELINE", "WORK_BACKEND"]);
  assert.deepEqual(result.reasons.test, ["PROJECT_RUST_BASELINE", "WORK_BACKEND"]);

  const documentation = evaluateRoute({
    workType: "documentation",
    projectEvidence: { schemaVersion: 1, scope: "MATCH", frameworks: ["rust"] },
  });
  assert.deepEqual(documentation.guides, ["documentation"]);
  assert.deepEqual(documentation.excluded.rust, ["NO_RUST_EXECUTABLE_WORK"]);

  const noMatch = evaluateRoute({
    workType: "code",
    projectEvidence: { schemaVersion: 1, scope: "NO_MATCH", frameworks: [] },
  });
  assert.deepEqual(noMatch.excluded.rust, ["NO_RUST_SCOPE_MATCH"]);

  assert.throws(
    () => evaluateRoute({ workType: "code", projectEvidence: { frameworks: ["rust-unknown"] } }),
    /unknown framework/i,
  );
});

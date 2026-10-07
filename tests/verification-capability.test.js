import { removeTempTree } from "./helpers/rm-safe.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  classifyVerificationCapability,
  classifyCommandResolution,
  resolveExecutionResolution,
  getNpmScriptName,
  getNpmLifecycleCandidates,
  parseNpmInvocation,
  npmWorkspaceSelection,
  validateVerificationAuthority,
  E_VERIFICATION_TOOL_UNAVAILABLE,
  E_INSTALLATION_AUTHORITY_REQUIRED,
  E_AUTHORITY_UNTRUSTED_SOURCE,
} from "../src/core/verification-capability.js";
import { evaluateRequiredEvidence } from "../src/core/evidence-readiness.js";
import { assertCheck } from "../src/core/checks.js";

test("getNpmLifecycleCandidates computes correct lifecycle chains", () => {
  // Generic script
  assert.deepEqual(getNpmLifecycleCandidates({ scriptName: "test" }), [
    "pretest",
    "test",
    "posttest",
  ]);

  // restart with explicit restart script
  assert.deepEqual(getNpmLifecycleCandidates({
    scriptName: "restart",
    scripts: { restart: "node restart.js" },
  }), [
    "prerestart",
    "restart",
    "postrestart",
  ]);

  // restart without explicit restart script falls back to stop and start
  assert.deepEqual(getNpmLifecycleCandidates({
    scriptName: "restart",
    scripts: { start: "node server.js" },
  }), [
    "prerestart",
    "prestop",
    "stop",
    "poststop",
    "prestart",
    "start",
    "poststart",
    "postrestart",
  ]);
});

test("getNpmScriptName recognizes run aliases including rum and urn", () => {
  assert.equal(getNpmScriptName(["npm", "run", "visual"]), "visual");
  assert.equal(getNpmScriptName(["npm", "run-script", "visual"]), "visual");
  assert.equal(getNpmScriptName(["npm", "rum", "visual"]), "visual");
  assert.equal(getNpmScriptName(["npm", "urn", "visual"]), "visual");
  assert.equal(getNpmScriptName(["npm.cmd", "rum", "visual"]), "visual");
  assert.equal(getNpmScriptName(["npm.cmd", "urn", "visual"]), "visual");
});

test("resolveExecutionResolution handles recursive npm scripts, restart semantics, and aliases", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-npm-script-"));
  try {
    // 1. Safe script
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "node tests/run.js",
      },
    }), "utf8");

    const safeResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(safeResult.mayInstall, false);

    // 2. Nested npx inside test
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "npx @liustack/modlens image.png",
      },
    }), "utf8");

    const nestedNpxResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(nestedNpxResult.mayInstall, true);
    assert.equal(nestedNpxResult.resolutionMode, "INSTALL_CAPABLE_RESOLUTION");
    assert.equal(nestedNpxResult.tool, "@liustack/modlens");
    assert.deepEqual(nestedNpxResult.dispatch, {
      kind: "npm-script",
      scriptName: "test",
    });

    // 3. Two-level recursive npm run: test -> npm run visual -> npx @liustack/modlens
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "npm run visual",
        visual: "npx @liustack/modlens image.png",
      },
    }), "utf8");

    const twoLevelResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(twoLevelResult.mayInstall, true);
    assert.equal(twoLevelResult.tool, "@liustack/modlens");
    assert.deepEqual(twoLevelResult.dispatch, {
      kind: "npm-script",
      scriptName: "visual",
    });

    // 4. Three-level recursive npm run: test -> npm run verify -> npm run visual -> npm exec -- @liustack/modlens
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "npm run verify",
        verify: "npm run visual",
        visual: "npm exec -- @liustack/modlens image.png",
      },
    }), "utf8");

    const threeLevelResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(threeLevelResult.mayInstall, true);
    assert.equal(threeLevelResult.tool, "@liustack/modlens");

    // 5. Recursive safe chain: test -> verify -> unit -> node
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "npm run verify",
        verify: "npm run unit",
        unit: "node tests/unit.js",
      },
    }), "utf8");

    const recursiveSafeResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(recursiveSafeResult.mayInstall, false);

    // 6. Script cycle detection fails closed
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        a: "npm run b",
        b: "npm run a",
      },
    }), "utf8");

    const cycleResult = await resolveExecutionResolution({
      argv: ["npm", "run", "a"],
      cwd: target,
    });
    assert.equal(cycleResult.mayInstall, true);
    assert.equal(cycleResult.reason, "SCRIPT_CYCLE");

    // 7. npm restart fallback to start when restart is absent
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        start: "npx package-x",
      },
    }), "utf8");

    const restartFallbackStart = await resolveExecutionResolution({
      argv: ["npm", "restart"],
      cwd: target,
    });
    assert.equal(restartFallbackStart.mayInstall, true);
    assert.equal(restartFallbackStart.tool, "package-x");

    // 8. npm restart fallback to stop when restart is absent
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        stop: "npm exec -- package-y",
      },
    }), "utf8");

    const restartFallbackStop = await resolveExecutionResolution({
      argv: ["npm", "restart"],
      cwd: target,
    });
    assert.equal(restartFallbackStop.mayInstall, true);
    assert.equal(restartFallbackStop.tool, "package-y");

    // 9. npm restart explicit restart overrides start/stop fallback
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        restart: "node restart.js",
        start: "npx package-x",
      },
    }), "utf8");

    const restartExplicit = await resolveExecutionResolution({
      argv: ["npm", "restart"],
      cwd: target,
    });
    assert.equal(restartExplicit.mayInstall, false);

    // 10. npm restart prerestart / postrestart install-capable
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        restart: "node restart.js",
        prerestart: "npm x package-x",
      },
    }), "utf8");

    const prerestartResult = await resolveExecutionResolution({
      argv: ["npm", "restart"],
      cwd: target,
    });
    assert.equal(prerestartResult.mayInstall, true);
    assert.equal(prerestartResult.tool, "package-x");

    // 11. npm rum and npm urn aliases
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        visual: "npx @liustack/modlens",
      },
    }), "utf8");

    const rumResult = await resolveExecutionResolution({
      argv: ["npm", "rum", "visual"],
      cwd: target,
    });
    assert.equal(rumResult.mayInstall, true);
    assert.equal(rumResult.tool, "@liustack/modlens");

    const urnResult = await resolveExecutionResolution({
      argv: ["npm", "urn", "visual"],
      cwd: target,
    });
    assert.equal(urnResult.mayInstall, true);
    assert.equal(urnResult.tool, "@liustack/modlens");

    // 12. Recursive alias: test -> npm rum visual -> npx package-x
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "npm rum visual",
        visual: "npx package-x",
      },
    }), "utf8");

    const recursiveRumResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(recursiveRumResult.mayInstall, true);
    assert.equal(recursiveRumResult.tool, "package-x");

    // 13. pretest / posttest direct hooks
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        pretest: "npx package-x",
        test: "node tests.js",
      },
    }), "utf8");

    const pretestResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(pretestResult.mayInstall, true);
    assert.equal(pretestResult.tool, "package-x");

    // 14. Leading npm option before run: npm --silent run visual
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        visual: "npx @liustack/modlens",
      },
    }), "utf8");

    const leadingOptionRunResult = await resolveExecutionResolution({
      argv: ["npm", "--silent", "run", "visual"],
      cwd: target,
    });
    assert.equal(leadingOptionRunResult.mayInstall, true);
    assert.equal(leadingOptionRunResult.tool, "@liustack/modlens");

    // 15. Recursive leading option: test -> npm --silent run visual
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "npm --silent run visual",
        visual: "npx @liustack/modlens",
      },
    }), "utf8");

    const recursiveLeadingOptionResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(recursiveLeadingOptionResult.mayInstall, true);
    assert.equal(recursiveLeadingOptionResult.tool, "@liustack/modlens");

    // 16. Workspace dispatch fails closed (various flag formats)
    const wsBeforeResult = await resolveExecutionResolution({
      argv: ["npm", "--workspace=a", "test"],
      cwd: target,
    });
    assert.equal(wsBeforeResult.resolutionMode, "UNKNOWN");
    assert.equal(wsBeforeResult.mayInstall, true);
    assert.equal(wsBeforeResult.reason, "NPM_WORKSPACE_SCRIPT_UNRESOLVED");

    const wsAfterResult = await resolveExecutionResolution({
      argv: ["npm", "test", "--workspace=a"],
      cwd: target,
    });
    assert.equal(wsAfterResult.resolutionMode, "UNKNOWN");
    assert.equal(wsAfterResult.mayInstall, true);
    assert.equal(wsAfterResult.reason, "NPM_WORKSPACE_SCRIPT_UNRESOLVED");

    const wsShortResult = await resolveExecutionResolution({
      argv: ["npm", "test", "-w", "a"],
      cwd: target,
    });
    assert.equal(wsShortResult.resolutionMode, "UNKNOWN");
    assert.equal(wsShortResult.mayInstall, true);
    assert.equal(wsShortResult.reason, "NPM_WORKSPACE_SCRIPT_UNRESOLVED");

    const wsRunResult = await resolveExecutionResolution({
      argv: ["npm", "run", "visual", "--workspace=a"],
      cwd: target,
    });
    assert.equal(wsRunResult.resolutionMode, "UNKNOWN");
    assert.equal(wsRunResult.mayInstall, true);
    assert.equal(wsRunResult.reason, "NPM_WORKSPACE_SCRIPT_UNRESOLVED");

    const wsShortRunResult = await resolveExecutionResolution({
      argv: ["npm", "run", "visual", "-w", "a"],
      cwd: target,
    });
    assert.equal(wsShortRunResult.resolutionMode, "UNKNOWN");
    assert.equal(wsShortRunResult.mayInstall, true);
    assert.equal(wsShortRunResult.reason, "NPM_WORKSPACE_SCRIPT_UNRESOLVED");

    const wsAllWorkspacesResult = await resolveExecutionResolution({
      argv: ["npm", "run", "visual", "--workspaces"],
      cwd: target,
    });
    assert.equal(wsAllWorkspacesResult.resolutionMode, "UNKNOWN");
    assert.equal(wsAllWorkspacesResult.mayInstall, true);
    assert.equal(wsAllWorkspacesResult.reason, "NPM_WORKSPACE_SCRIPT_UNRESOLVED");

    const wsWsAliasResult = await resolveExecutionResolution({
      argv: ["npm", "run", "visual", "--ws"],
      cwd: target,
    });
    assert.equal(wsWsAliasResult.resolutionMode, "UNKNOWN");
    assert.equal(wsWsAliasResult.mayInstall, true);
    assert.equal(wsWsAliasResult.reason, "NPM_WORKSPACE_SCRIPT_UNRESOLVED");

    // 17. Windows workspace variants fail closed
    const wsWindowsResult = await resolveExecutionResolution({
      argv: ["npm.cmd", "--workspace=a", "test"],
      cwd: target,
    });
    assert.equal(wsWindowsResult.resolutionMode, "UNKNOWN");
    assert.equal(wsWindowsResult.mayInstall, true);
    assert.equal(wsWindowsResult.reason, "NPM_WORKSPACE_SCRIPT_UNRESOLVED");

    const wsWindowsShortResult = await resolveExecutionResolution({
      argv: ["npm.cmd", "test", "-w", "a"],
      cwd: target,
    });
    assert.equal(wsWindowsShortResult.resolutionMode, "UNKNOWN");
    assert.equal(wsWindowsShortResult.mayInstall, true);
    assert.equal(wsWindowsShortResult.reason, "NPM_WORKSPACE_SCRIPT_UNRESOLVED");

    // 18. Missing package.json or missing script does not crash
    const missingPkgResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: path.join(target, "nonexistent"),
    });
    assert.equal(missingPkgResult.mayInstall, false);

    const missingScriptResult = await resolveExecutionResolution({
      argv: ["npm", "run", "missing-script"],
      cwd: target,
    });
    assert.equal(missingScriptResult.mayInstall, false);
  } finally {
    await removeTempTree(target);
  }
});

test("parseNpmInvocation correctly extracts subcommands, options, and workspace flags", () => {
  const parsed1 = parseNpmInvocation(["npm", "--silent", "exec", "--", "@liustack/modlens"]);
  assert.equal(parsed1.subcommand, "exec");
  assert.deepEqual(parsed1.leadingOptions, ["--silent"]);
  assert.deepEqual(parsed1.args, ["--", "@liustack/modlens"]);
  assert.equal(parsed1.workspace, null);
  assert.equal(parsed1.workspaces, false);

  const parsed2 = parseNpmInvocation(["npm", "--workspace=pkg-a", "test"]);
  assert.equal(parsed2.subcommand, "test");
  assert.equal(parsed2.workspace, "pkg-a");

  const parsed3 = parseNpmInvocation(["npm", "run", "build", "--workspaces"]);
  assert.equal(parsed3.subcommand, "run");
  assert.equal(parsed3.workspaces, true);

  const parsed4 = parseNpmInvocation(["npm", "--silent"]);
  assert.equal(parsed4.ambiguous, true);
  assert.equal(parsed4.subcommand, null);

  assert.deepEqual(npmWorkspaceSelection(parsed2), {
    scoped: true,
    workspace: "pkg-a",
    allWorkspaces: false,
  });
  assert.deepEqual(npmWorkspaceSelection(parsed3), {
    scoped: true,
    workspace: null,
    allWorkspaces: true,
  });
});

test("classifyCommandResolution recognizes npm options before the subcommand", () => {
  assert.deepEqual(
    classifyCommandResolution(["npm", "--silent", "exec", "--", "@liustack/modlens"]),
    {
      resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
      mayInstall: true,
      installer: "npm exec",
      tool: "@liustack/modlens",
    },
  );

  assert.deepEqual(
    classifyCommandResolution(["npm", "--silent", "x", "@liustack/modlens"]),
    {
      resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
      mayInstall: true,
      installer: "npm x",
      tool: "@liustack/modlens",
    },
  );

  assert.deepEqual(
    classifyCommandResolution(["npm", "--loglevel", "error", "exec", "--", "@liustack/modlens"]),
    {
      resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
      mayInstall: true,
      installer: "npm exec",
      tool: "@liustack/modlens",
    },
  );

  assert.deepEqual(
    classifyCommandResolution(["npm", "--loglevel=error", "exec", "--", "@liustack/modlens"]),
    {
      resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
      mayInstall: true,
      installer: "npm exec",
      tool: "@liustack/modlens",
    },
  );

  assert.deepEqual(
    classifyCommandResolution(["npm.cmd", "--silent", "exec", "--", "package-win"]),
    {
      resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
      mayInstall: true,
      installer: "npm exec",
      tool: "package-win",
    },
  );

  assert.deepEqual(
    classifyCommandResolution(["sh", "-lc", "npm --silent exec -- package-sh"]),
    {
      resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
      mayInstall: true,
      installer: "npm exec",
      tool: "package-sh",
    },
  );

  // Ambiguous invocation without subcommand fails closed
  assert.deepEqual(
    classifyCommandResolution(["npm", "--silent"]),
    {
      resolutionMode: "UNKNOWN",
      mayInstall: true,
      installer: "npm",
      tool: null,
      reason: "NPM_SUBCOMMAND_AMBIGUOUS",
    },
  );
});

test("classifyVerificationCapability prefers locally available verifiers", () => {
  const result = classifyVerificationCapability({ available: true });
  assert.equal(result.action, "USE_AVAILABLE");
  assert.equal(result.reasonCode, null);
});

test("classifyVerificationCapability uses local equivalent when primary is absent", () => {
  const result = classifyVerificationCapability({
    available: false,
    equivalentAvailable: true,
  });
  assert.equal(result.action, "USE_EQUIVALENT");
  assert.equal(result.reasonCode, null);
});

test("classifyVerificationCapability allows installation only when explicitly authorized", () => {
  const result = classifyVerificationCapability({
    available: false,
    equivalentAvailable: false,
    installationAuthorized: true,
  });
  assert.equal(result.action, "INSTALL_AUTHORIZED");
  assert.equal(result.reasonCode, null);
});

test("classifyVerificationCapability requests authority when verifier is mandatory but unauthorized", () => {
  const result = classifyVerificationCapability({
    available: false,
    equivalentAvailable: false,
    installationAuthorized: false,
    installationRequired: true,
  });
  assert.equal(result.action, "REQUEST_AUTHORITY");
  assert.equal(result.reasonCode, E_INSTALLATION_AUTHORITY_REQUIRED);
});

test("exact blind-run regression: missing modlens without authority records NOT_VERIFIED", () => {
  const modlensScenario = {
    tool: "@liustack/modlens",
    purpose: "visual-verification",
    available: false,
    equivalentAvailable: false,
    installationAuthorized: false,
    installationRequired: false,
  };
  const result = classifyVerificationCapability(modlensScenario);
  assert.equal(result.action, "RECORD_NOT_VERIFIED");
  assert.equal(result.reasonCode, E_VERIFICATION_TOOL_UNAVAILABLE);
});

test("classifyCommandResolution classifies resolution modes deterministically", () => {
  // Install-capable commands
  assert.deepEqual(classifyCommandResolution("npx @liustack/modlens --spec=foo"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npx",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("npx -y @liustack/modlens"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npx",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("pnpm dlx @liustack/modlens"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "pnpm dlx",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("yarn dlx jest"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "yarn dlx",
    tool: "jest",
  });
  assert.deepEqual(classifyCommandResolution("bunx vitest"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "bunx",
    tool: "vitest",
  });
  assert.deepEqual(classifyCommandResolution("bun x vitest"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "bun x",
    tool: "vitest",
  });
  assert.deepEqual(classifyCommandResolution("uvx ruff check ."), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "uvx",
    tool: "ruff",
  });
  assert.deepEqual(classifyCommandResolution("uv tool run ruff"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "uv tool run",
    tool: "ruff",
  });
  assert.deepEqual(classifyCommandResolution("pipx run flake8"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "pipx run",
    tool: "flake8",
  });

  // npm exec and npm x variants (P0)
  assert.deepEqual(classifyCommandResolution(["npm", "exec", "--", "@liustack/modlens", "image.png"]), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("npm exec package"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "package",
  });
  assert.deepEqual(classifyCommandResolution("npm exec -- package"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "package",
  });
  assert.deepEqual(classifyCommandResolution("npm exec --package=@liustack/modlens -- modlens"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("npm exec --package @liustack/modlens -- modlens"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("npm exec -p @liustack/modlens -- modlens"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("npm x @liustack/modlens"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm x",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("npm exec --yes @liustack/modlens"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("npm exec --no @liustack/modlens"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution(["npm.cmd", "exec", "@liustack/modlens"]), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution(["npm.cmd", "x", "@liustack/modlens"]), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm x",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution(["npx.cmd", "@liustack/modlens"]), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npx",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("npm exec"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: null,
  });

  // Non-installing resolution
  assert.deepEqual(classifyCommandResolution("npx --no-install @liustack/modlens"), {
    resolutionMode: "NON_INSTALLING_RESOLUTION",
    mayInstall: false,
    installer: "npx",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("npx --no @liustack/modlens"), {
    resolutionMode: "NON_INSTALLING_RESOLUTION",
    mayInstall: false,
    installer: "npx",
    tool: "@liustack/modlens",
  });

  // Explicit installation
  assert.deepEqual(classifyCommandResolution("npm install @liustack/modlens"), {
    resolutionMode: "EXPLICIT_INSTALLATION",
    mayInstall: true,
    installer: "npm",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution("pnpm add -D jest"), {
    resolutionMode: "EXPLICIT_INSTALLATION",
    mayInstall: true,
    installer: "pnpm",
    tool: "jest",
  });
  assert.deepEqual(classifyCommandResolution("pip install pytest"), {
    resolutionMode: "EXPLICIT_INSTALLATION",
    mayInstall: true,
    installer: "pip",
    tool: "pytest",
  });

  // Local package binary / local executable
  assert.deepEqual(classifyCommandResolution("./node_modules/.bin/modlens --spec=foo"), {
    resolutionMode: "LOCAL_PACKAGE_BINARY",
    mayInstall: false,
    installer: null,
    tool: "modlens",
  });
  assert.deepEqual(classifyCommandResolution("npm test"), {
    resolutionMode: "LOCAL_PACKAGE_BINARY",
    mayInstall: false,
    installer: null,
    tool: null,
    dispatch: { kind: "npm-script-command" },
  });
  assert.deepEqual(classifyCommandResolution("npm run check"), {
    resolutionMode: "LOCAL_PACKAGE_BINARY",
    mayInstall: false,
    installer: null,
    tool: null,
    dispatch: { kind: "npm-script-command" },
  });
  assert.deepEqual(classifyCommandResolution("node scripts/verify.js"), {
    resolutionMode: "LOCAL_EXECUTABLE",
    mayInstall: false,
    installer: null,
    tool: null,
  });
  assert.deepEqual(classifyCommandResolution("command -v modlens"), {
    resolutionMode: "LOCAL_EXECUTABLE",
    mayInstall: false,
    installer: null,
    tool: null,
  });
});

test("classifyCommandResolution preserves string behavior while accepting argv", () => {
  assert.deepEqual(
    classifyCommandResolution(["node", "scripts/verify.js"]),
    classifyCommandResolution("node scripts/verify.js"),
  );
});

test("classifyCommandResolution inspects explicit Windows cmd wrappers and shell strings", () => {
  assert.deepEqual(classifyCommandResolution([
    "cmd.exe",
    "/d",
    "/c",
    'call "C:\\tmp\\npx.cmd" @liustack/modlens --spec=foo',
  ]), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npx",
    tool: "@liustack/modlens",
  });
  assert.deepEqual(classifyCommandResolution(["sh", "-lc", "npx package"]), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npx",
    tool: "package",
  });
  assert.deepEqual(classifyCommandResolution(["bash", "-c", "npm exec -- package"]), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "package",
  });
  assert.deepEqual(classifyCommandResolution(["cmd", "/c", "npm x package"]), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm x",
    tool: "package",
  });
});

test("resolveExecutionResolution handles npm script lifecycle and nested dispatchers", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-npm-script-"));
  try {
    // 1. Safe script
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "node tests/run.js",
      },
    }), "utf8");

    const safeResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(safeResult.mayInstall, false);

    // 2. Nested npx inside test
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "npx @liustack/modlens image.png",
      },
    }), "utf8");

    const nestedNpxResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(nestedNpxResult.mayInstall, true);
    assert.equal(nestedNpxResult.resolutionMode, "INSTALL_CAPABLE_RESOLUTION");
    assert.equal(nestedNpxResult.tool, "@liustack/modlens");
    assert.deepEqual(nestedNpxResult.dispatch, {
      kind: "npm-script",
      scriptName: "test",
    });

    // 3. pretest install-capable elevates top-level
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        pretest: "npx package-x",
        test: "node tests.js",
      },
    }), "utf8");

    const pretestResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(pretestResult.mayInstall, true);
    assert.equal(pretestResult.tool, "package-x");
    assert.deepEqual(pretestResult.dispatch, {
      kind: "npm-script",
      scriptName: "pretest",
    });

    // 4. posttest install-capable elevates top-level
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        test: "node tests.js",
        posttest: "npm exec -- package-y",
      },
    }), "utf8");

    const posttestResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: target,
    });
    assert.equal(posttestResult.mayInstall, true);
    assert.equal(posttestResult.tool, "package-y");
    assert.deepEqual(posttestResult.dispatch, {
      kind: "npm-script",
      scriptName: "posttest",
    });

    // 5. npm run / npm run-script
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      scripts: {
        verify: "pnpm dlx package-z",
      },
    }), "utf8");

    const runVerifyResult = await resolveExecutionResolution({
      argv: ["npm", "run", "verify"],
      cwd: target,
    });
    assert.equal(runVerifyResult.mayInstall, true);
    assert.equal(runVerifyResult.tool, "package-z");
    assert.deepEqual(runVerifyResult.dispatch, {
      kind: "npm-script",
      scriptName: "verify",
    });

    const runScriptVerifyResult = await resolveExecutionResolution({
      argv: ["npm", "run-script", "verify"],
      cwd: target,
    });
    assert.equal(runScriptVerifyResult.mayInstall, true);
    assert.equal(runScriptVerifyResult.tool, "package-z");

    // 6. Missing package.json or missing script does not crash
    const missingPkgResult = await resolveExecutionResolution({
      argv: ["npm", "test"],
      cwd: path.join(target, "nonexistent"),
    });
    assert.equal(missingPkgResult.mayInstall, false);

    const missingScriptResult = await resolveExecutionResolution({
      argv: ["npm", "run", "missing-script"],
      cwd: target,
    });
    assert.equal(missingScriptResult.mayInstall, false);
  } finally {
    await removeTempTree(target);
  }
});

test("observed command checks require ForgeLoop execution provenance", () => {
  assert.throws(
    () => assertCheck({
      schemaVersion: 1,
      protocolVersion: 1,
      id: "tests",
      kind: "command",
      requirement: "tests",
      status: "passed",
      evidenceKind: "OBSERVED",
      source: "npm test",
      provenance: "ACTOR_REPORTED",
    }, "check", { requireCommandProvenance: true }),
    (error) => error.code === "E_COMMAND_PROVENANCE_UNATTESTED",
  );
});

test("validateVerificationAuthority rejects self-asserted booleans and requires canonical authority grants", () => {
  // Self-asserted boolean without authorityRef
  const selfAssertedCheck = {
    id: "visual-check",
    kind: "command",
    requirement: "visual-verification",
    status: "passed",
    source: "npx @liustack/modlens --spec=visual.json",
    details: {
      command: "npx @liustack/modlens --spec=visual.json",
      installationAuthorized: true,
    },
  };
  const val1 = validateVerificationAuthority(selfAssertedCheck);
  assert.equal(val1.valid, false);
  assert.equal(val1.error.code, E_INSTALLATION_AUTHORITY_REQUIRED);

  // Nested self-asserted authority without authorityRef
  const nestedSelfAsserted = {
    id: "visual-check",
    kind: "command",
    requirement: "visual-verification",
    status: "passed",
    source: "npx @liustack/modlens",
    details: {
      command: "npx @liustack/modlens",
      authority: { softwareInstallation: "AUTHORIZED" },
    },
  };
  const val2 = validateVerificationAuthority(nestedSelfAsserted);
  assert.equal(val2.valid, false);
  assert.equal(val2.error.code, E_INSTALLATION_AUTHORITY_REQUIRED);

  // Execution self-asserted boolean
  const execSelfAsserted = {
    id: "visual-check",
    kind: "command",
    requirement: "visual-verification",
    status: "passed",
    source: "npx @liustack/modlens",
    details: {
      command: "npx @liustack/modlens",
      execution: { installationAuthorized: true },
    },
  };
  const val3 = validateVerificationAuthority(execSelfAsserted);
  assert.equal(val3.valid, false);
  assert.equal(val3.error.code, E_INSTALLATION_AUTHORITY_REQUIRED);

  // Unresolvable authorityRef
  const unresolvableCheck = {
    id: "visual-check",
    kind: "command",
    requirement: "visual-verification",
    status: "passed",
    source: "npx @liustack/modlens",
    details: {
      command: "npx @liustack/modlens",
      installationAuthorityRef: "auth-missing",
    },
  };
  const val4 = validateVerificationAuthority(unresolvableCheck);
  assert.equal(val4.valid, false);
  assert.equal(val4.error.code, E_INSTALLATION_AUTHORITY_REQUIRED);

  // Valid authority grant
  const validAuthority = {
    schemaVersion: 1,
    protocolVersion: 1,
    authorityId: "auth-modlens",
    taskId: "task-1",
    type: "SOFTWARE_INSTALLATION",
    status: "AUTHORIZED",
    scope: { tool: "@liustack/modlens" },
    source: "operator",
  };
  const checkWithValidAuth = {
    id: "visual-check",
    kind: "command",
    requirement: "visual-verification",
    status: "passed",
    source: "npx @liustack/modlens --spec=visual.json",
    details: {
      command: "npx @liustack/modlens --spec=visual.json",
      installationAuthorityRef: "auth-modlens",
    },
  };
  const val5 = validateVerificationAuthority(checkWithValidAuth, {
    taskId: "task-1",
    authorityContext: {
      trustMode: "HOST_ATTESTED",
      authorities: { "auth-modlens": validAuthority },
    },
  });
  assert.equal(val5.valid, true);
  assert.equal(val5.error, null);

  // A loose trustMode or a source outside authorityContext cannot self-attest.
  const directSelfAttested = validateVerificationAuthority(checkWithValidAuth, {
    taskId: "task-1",
    trustMode: "HOST_ATTESTED",
    authorities: { "auth-modlens": validAuthority },
  });
  assert.equal(directSelfAttested.valid, false);
  assert.equal(directSelfAttested.error.code, E_AUTHORITY_UNTRUSTED_SOURCE);
  const splitContext = validateVerificationAuthority(checkWithValidAuth, {
    taskId: "task-1",
    authorityContext: { trustMode: "HOST_ATTESTED" },
    authorities: { "auth-modlens": validAuthority },
  });
  assert.equal(splitContext.valid, false);
  assert.equal(splitContext.error.code, E_INSTALLATION_AUTHORITY_REQUIRED);

  // Wrong task authority grant
  const valWrongTask = validateVerificationAuthority(checkWithValidAuth, {
    taskId: "task-2",
    authorityContext: {
      trustMode: "HOST_ATTESTED",
      authorities: { "auth-modlens": validAuthority },
    },
  });
  assert.equal(valWrongTask.valid, false);
  assert.equal(valWrongTask.error.code, "E_AUTHORITY_INVALID");

  // Wrong tool scope authority grant
  const wrongScopeAuth = {
    ...validAuthority,
    scope: { tool: "playwright" },
  };
  const valWrongScope = validateVerificationAuthority(checkWithValidAuth, {
    taskId: "task-1",
    authorityContext: {
      trustMode: "HOST_ATTESTED",
      authorities: { "auth-modlens": wrongScopeAuth },
    },
  });
  assert.equal(valWrongScope.valid, false);
  assert.equal(valWrongScope.error.code, "E_AUTHORITY_SCOPE_MISMATCH");

  // Revoked authority grant
  const revokedAuth = {
    ...validAuthority,
    status: "REVOKED",
  };
  const valRevoked = validateVerificationAuthority(checkWithValidAuth, {
    taskId: "task-1",
    authorityContext: {
      trustMode: "HOST_ATTESTED",
      authorities: { "auth-modlens": revokedAuth },
    },
  });
  assert.equal(valRevoked.valid, false);
  assert.equal(valRevoked.error.code, "E_AUTHORITY_INVALID");

  // Self-issued agent-self authority grant
  const agentSelfAuth = {
    ...validAuthority,
    source: "agent-self",
  };
  const valAgentSelf = validateVerificationAuthority(checkWithValidAuth, {
    taskId: "task-1",
    authorityContext: {
      trustMode: "HOST_ATTESTED",
      authorities: { "auth-modlens": agentSelfAuth },
    },
  });
  assert.equal(valAgentSelf.valid, false);
  assert.equal(valAgentSelf.error.code, "E_AUTHORITY_INVALID");

  // Non-installing command needs no authority
  const nonInstallingCheck = {
    id: "visual-check",
    kind: "command",
    requirement: "visual-verification",
    status: "passed",
    source: "npx --no-install @liustack/modlens",
    details: {
      command: "npx --no-install @liustack/modlens",
    },
  };
  const valNonInstall = validateVerificationAuthority(nonInstallingCheck);
  assert.equal(valNonInstall.valid, true);
  assert.equal(valNonInstall.error, null);
});

test("evaluateRequiredEvidence rejects unauthorized install-capable verification from passing readiness", () => {
  const requirements = ["visual-verification"];
  const unauthorizedCheck = {
    schemaVersion: 1,
    protocolVersion: 1,
    id: "check-1",
    kind: "command",
    requirement: "visual-verification",
    status: "passed",
    evidenceKind: "OBSERVED",
    source: "npx @liustack/modlens",
    executionRef: "exec-test",
    provenance: "FORGELOOP_EXECUTED",
    details: {
      command: "npx @liustack/modlens",
      installationAuthorized: true, // self-asserted boolean must NOT pass
    },
  };

  const readiness = evaluateRequiredEvidence({
    requirements,
    checks: [unauthorizedCheck],
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.covered.length, 0);
  assert.equal(readiness.invalid.length, 1);
  assert.equal(readiness.invalid[0].reasonCode, E_INSTALLATION_AUTHORITY_REQUIRED);
});

function authorityCheck() {
  return {
    id: "visual-check",
    kind: "command",
    requirement: "visual-verification",
    status: "passed",
    source: "npx @liustack/modlens",
    details: {
      command: "npx @liustack/modlens",
      installationAuthorityRef: "auth-modlens",
    },
    executionRef: "exec-test",
    provenance: "FORGELOOP_EXECUTED",
  };
}

function authorityGrant(taskId = "task-1") {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    authorityId: "auth-modlens",
    taskId,
    type: "SOFTWARE_INSTALLATION",
    status: "AUTHORIZED",
    scope: { tool: "@liustack/modlens" },
    source: "operator",
  };
}

test("project-local authority claims are rejected as an untrusted source", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-local-authority-"));
  try {
    const localAuthorityPath = path.join(target, ".forgeloop", "authorities", "auth-modlens.json");
    await mkdir(path.dirname(localAuthorityPath), { recursive: true });
    await writeFile(localAuthorityPath, JSON.stringify(authorityGrant()), "utf8");

    const result = validateVerificationAuthority(authorityCheck(), {
      target,
      taskId: "task-1",
    });

    assert.equal(result.valid, false);
    assert.equal(result.error.code, E_AUTHORITY_UNTRUSTED_SOURCE);

    const readiness = evaluateRequiredEvidence({
      requirements: ["visual-verification"],
      checks: [{
        ...authorityCheck(),
        schemaVersion: 1,
        protocolVersion: 1,
        evidenceKind: "OBSERVED",
      }],
      target,
      taskId: "task-1",
    });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.covered.length, 0);
    assert.equal(readiness.invalid[0].reasonCode, E_AUTHORITY_UNTRUSTED_SOURCE);
  } finally {
    await removeTempTree(target);
  }
});

test("host-supplied external authority file and directory are trusted", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-external-target-"));
  const authorityRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-host-authority-"));
  try {
    const authorityFile = path.join(authorityRoot, "authorities.json");
    await writeFile(authorityFile, JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 1,
      authorities: [authorityGrant()],
    }), "utf8");

    const fromFile = validateVerificationAuthority(authorityCheck(), {
      target,
      taskId: "task-1",
      authorityContext: {
        trustMode: "HOST_ATTESTED",
        trustedAuthorityFile: authorityFile,
      },
    });
    assert.equal(fromFile.valid, true);

    const authorityDir = path.join(authorityRoot, "authorities");
    await mkdir(authorityDir);
    await writeFile(path.join(authorityDir, "auth-modlens.json"), JSON.stringify(authorityGrant()), "utf8");
    const fromDirectory = validateVerificationAuthority(authorityCheck(), {
      target,
      taskId: "task-1",
      authorityContext: {
        trustMode: "HOST_ATTESTED",
        trustedAuthorityDir: authorityDir,
      },
    });
    assert.equal(fromDirectory.valid, true);
  } finally {
    await removeTempTree(target);
    await removeTempTree(authorityRoot);
  }
});

test("standalone environment-selected authority remains untrusted", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-env-authority-target-"));
  const authorityRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-env-authority-root-"));
  const authorityFile = path.join(authorityRoot, "actor-selected.json");
  const previousFile = process.env.FORGELOOP_AUTHORITY_FILE;
  const previousDir = process.env.FORGELOOP_AUTHORITY_DIR;
  try {
    await writeFile(authorityFile, JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 1,
      authorities: [authorityGrant()],
    }), "utf8");
    process.env.FORGELOOP_AUTHORITY_FILE = authorityFile;
    delete process.env.FORGELOOP_AUTHORITY_DIR;

    const result = validateVerificationAuthority(authorityCheck(), {
      target,
      taskId: "task-1",
    });

    assert.equal(result.valid, false);
    assert.equal(result.error.code, E_AUTHORITY_UNTRUSTED_SOURCE);
  } finally {
    if (previousFile === undefined) delete process.env.FORGELOOP_AUTHORITY_FILE;
    else process.env.FORGELOOP_AUTHORITY_FILE = previousFile;
    if (previousDir === undefined) delete process.env.FORGELOOP_AUTHORITY_DIR;
    else process.env.FORGELOOP_AUTHORITY_DIR = previousDir;
    await removeTempTree(target);
    await removeTempTree(authorityRoot);
  }
});

test("standalone environment-selected authority directory remains untrusted", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-env-authority-dir-target-"));
  const authorityRoot = await mkdtemp(path.join(os.tmpdir(), "forgeloop-env-authority-dir-"));
  const previousFile = process.env.FORGELOOP_AUTHORITY_FILE;
  const previousDir = process.env.FORGELOOP_AUTHORITY_DIR;
  try {
    await writeFile(path.join(authorityRoot, "auth-modlens.json"), JSON.stringify(authorityGrant()), "utf8");
    delete process.env.FORGELOOP_AUTHORITY_FILE;
    process.env.FORGELOOP_AUTHORITY_DIR = authorityRoot;

    const result = validateVerificationAuthority(authorityCheck(), {
      target,
      taskId: "task-1",
    });

    assert.equal(result.valid, false);
    assert.equal(result.error.code, E_AUTHORITY_UNTRUSTED_SOURCE);
  } finally {
    if (previousFile === undefined) delete process.env.FORGELOOP_AUTHORITY_FILE;
    else process.env.FORGELOOP_AUTHORITY_FILE = previousFile;
    if (previousDir === undefined) delete process.env.FORGELOOP_AUTHORITY_DIR;
    else process.env.FORGELOOP_AUTHORITY_DIR = previousDir;
    await removeTempTree(target);
    await removeTempTree(authorityRoot);
  }
});

test("a configured authority file inside the target is rejected", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "forgeloop-contained-authority-"));
  try {
    const authorityFile = path.join(target, ".forgeloop", "authorities.json");
    await mkdir(path.dirname(authorityFile), { recursive: true });
    await writeFile(authorityFile, JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 1,
      authorities: [authorityGrant()],
    }), "utf8");

    const result = validateVerificationAuthority(authorityCheck(), {
      target,
      taskId: "task-1",
      trustedAuthorityFile: authorityFile,
    });

    assert.equal(result.valid, false);
    assert.equal(result.error.code, E_AUTHORITY_UNTRUSTED_SOURCE);
  } finally {
    await removeTempTree(target);
  }
});

test("canonical loop engineering documentation defines missing verification tool policy", async () => {
  const text = await readFile("LOOP_ENGINEERING.md", "utf8");
  assert.match(text, /### Missing verification tool policy/);
  assert.match(text, /A missing verification tool does not grant authority to install it/);
  assert.match(text, /npx --no-install TOOL → missing/);
  assert.match(text, /npx TOOL\s+→ implicit install/);
  assert.match(text, /E_VERIFICATION_TOOL_UNAVAILABLE/);
});

test("protocol integration guide defines missing tool capability policy", async () => {
  const text = await readFile("PROTOCOL_INTEGRATION.md", "utf8");
  assert.match(text, /## Missing tool capability/);
  assert.match(text, /A missing tool is a capability gap, not installation authority/);
  assert.match(text, /Never convert `PROTOCOL_LIMITED` into environmental mutation/);
});

test("semantic npm classifier regression - install aliases", () => {
  const aliases = ["install", "add", "i", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal", "isntall"];
  for (const alias of aliases) {
    assert.deepEqual(classifyCommandResolution(`npm ${alias} pkg`), {
      resolutionMode: "EXPLICIT_INSTALLATION",
      mayInstall: true,
      installer: "npm",
      tool: "pkg",
    });
  }
});

test("semantic npm classifier regression - ci families", () => {
  const aliases = ["ci", "clean-install", "ic", "install-clean", "isntall-clean"];
  for (const alias of aliases) {
    assert.deepEqual(classifyCommandResolution(`npm ${alias}`), {
      resolutionMode: "EXPLICIT_INSTALLATION",
      mayInstall: true,
      installer: `npm ${alias}`,
      tool: null,
    });
  }
});

test("semantic npm classifier regression - install-test families", () => {
  const aliases = ["install-test", "it", "install-ci-test", "cit", "clean-install-test", "sit"];
  for (const alias of aliases) {
    assert.deepEqual(classifyCommandResolution(`npm ${alias}`), {
      resolutionMode: "EXPLICIT_INSTALLATION",
      mayInstall: true,
      installer: `npm ${alias}`,
      tool: null,
    });
  }
});

test("semantic npm classifier regression - init", () => {
  assert.deepEqual(classifyCommandResolution("npm init"), {
    resolutionMode: "LOCAL_PACKAGE_BINARY",
    mayInstall: false,
    installer: null,
    tool: null,
  });
  assert.deepEqual(classifyCommandResolution("npm init -y"), {
    resolutionMode: "LOCAL_PACKAGE_BINARY",
    mayInstall: false,
    installer: null,
    tool: null,
  });
  assert.deepEqual(classifyCommandResolution("npm init foo"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm init",
    tool: "foo",
  });
  assert.deepEqual(classifyCommandResolution("npm create foo"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm create",
    tool: "foo",
  });
  assert.deepEqual(classifyCommandResolution("npm innit foo"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm innit",
    tool: "foo",
  });
  assert.deepEqual(classifyCommandResolution("npm --silent init foo"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm init",
    tool: "foo",
  });
});

test("semantic npm classifier regression - update", () => {
  assert.deepEqual(classifyCommandResolution("npm update"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm update",
    tool: null,
  });
  assert.deepEqual(classifyCommandResolution("npm update package-x"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm update",
    tool: "package-x",
  });
});

test("semantic npm classifier regression - audit", () => {
  assert.deepEqual(classifyCommandResolution("npm audit"), {
    resolutionMode: "LOCAL_PACKAGE_BINARY",
    mayInstall: false,
    installer: null,
    tool: null,
  });
  assert.deepEqual(classifyCommandResolution("npm audit fix"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm audit fix",
    tool: null,
  });
  assert.deepEqual(classifyCommandResolution("npm audit fix --force"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm audit fix",
    tool: null,
  });
});

test("semantic npm classifier fails closed for npm version", () => {
  assert.deepEqual(classifyCommandResolution(["npm", "version", "patch"]), {
    resolutionMode: "UNKNOWN",
    mayInstall: true,
    installer: "npm",
    tool: null,
    reason: "NPM_COMMAND_UNCLASSIFIED",
  });
});

test("npm v remains the view alias and is non-installing", () => {
  assert.deepEqual(classifyCommandResolution(["npm", "v", "react", "version"]), {
    resolutionMode: "LOCAL_PACKAGE_BINARY",
    mayInstall: false,
    installer: null,
    tool: null,
  });
});

test("semantic npm classifier regression - unknown", () => {
  assert.deepEqual(classifyCommandResolution("npm frobnicate"), {
    resolutionMode: "UNKNOWN",
    mayInstall: true,
    installer: "npm",
    tool: null,
    reason: "NPM_COMMAND_UNCLASSIFIED",
  });
});

test("semantic npm classifier regression - option ambiguity", () => {
  assert.deepEqual(classifyCommandResolution("npm --scope @mycorp exec -- package"), {
    resolutionMode: "UNKNOWN",
    mayInstall: true,
    installer: "npm",
    tool: null,
    reason: "NPM_OPTION_VALUE_AMBIGUOUS",
  });
  assert.deepEqual(classifyCommandResolution("npm --scope=@mycorp exec -- package"), {
    resolutionMode: "INSTALL_CAPABLE_RESOLUTION",
    mayInstall: true,
    installer: "npm exec",
    tool: "package",
  });
});

#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";

const npmCommand = (platform = process.platform) => platform === "win32" ? "npm.cmd" : "npm";
const pythonCommand = (platform = process.platform) => platform === "win32" ? "py" : "python3";

function npmRun(script, args = [], platform = process.platform) {
  return {
    id: script,
    command: npmCommand(platform),
    args: ["run", script, ...args],
  };
}

function npmRaw(id, args, platform = process.platform) {
  return {
    id,
    command: npmCommand(platform),
    args,
  };
}

function pythonRun(id, args, platform = process.platform) {
  return {
    id,
    command: pythonCommand(platform),
    args: platform === "win32" ? ["-3", ...args] : args,
  };
}

function pythonValidators(platform = process.platform) {
  return [
    pythonRun("python-unittest", ["-m", "unittest", "discover", "-s", "tests", "-v"], platform),
    pythonRun("markdown-self-test", ["scripts/validate_markdown.py", "--self-test"], platform),
    pythonRun("markdown-validator", ["scripts/validate_markdown.py"], platform),
    pythonRun("loop-self-test", ["scripts/validate_loop_system.py", "--self-test"], platform),
    pythonRun("loop-validator", ["scripts/validate_loop_system.py"], platform),
    pythonRun("secret-scan", ["scripts/scan_secrets.py"], platform),
  ];
}

const FAST_COMMANDS = [
  ["test:quick"],
  ["lint"],
  ["dependency:policy"],
  ["docs:generated:check"],
];

const LOCAL_COMMANDS = [
  ["test"],
  ["lint"],
  ["dependency:policy"],
  ["complexity:check"],
  ["docs:generated:check"],
  ["docs:conformance"],
  ["docs:examples:check"],
  ["completions:check"],
  ["summary:check"],
  ["changelog:check"],
  ["repository-index:manifest"],
];

const PREPUSH_COMMANDS = [
  ["coverage"],
  ["critical-coverage:check"],
  ["lint"],
  ["dependency:policy"],
  ["complexity:check"],
  ["docs:check"],
  ["completions:check"],
  ["summary:check"],
  ["changelog:check"],
  ["repository-index:manifest"],
  ["poc:evidence:verify"],
  ["poc:evidence:test"],
  ["mcp:test"],
  ["mcp:pack:check"],
  ["pack:check"],
];

const RELEASE_COMMANDS = [
  ...PREPUSH_COMMANDS,
  ["pack:smoke"],
  ["benchmark:profiles:check"],
  ["benchmark:profiles:regression", ["--json"]],
  ["benchmark:profiles:outliers"],
  ["benchmark:profiles:tail-analysis"],
  ["performance:check"],
];

export const VALIDATION_TIERS = Object.freeze({
  fast: Object.freeze(FAST_COMMANDS),
  local: Object.freeze(LOCAL_COMMANDS),
  prepush: Object.freeze(PREPUSH_COMMANDS),
  release: Object.freeze(RELEASE_COMMANDS),
});

export function getTierCommands(tier, platform = process.platform) {
  if (!Object.hasOwn(VALIDATION_TIERS, tier)) {
    throw new Error(`Unknown validation tier: ${tier}. Expected one of ${Object.keys(VALIDATION_TIERS).join(", ")}`);
  }
  const commands = VALIDATION_TIERS[tier].map(([script, args = []]) => npmRun(script, args, platform));
  if (tier === "release") {
    const version = process.env.FORGELOOP_RELEASE_VERSION;
    const commit = process.env.FORGELOOP_RELEASE_COMMIT;
    commands.push(version && commit
      ? npmRun("release:identity", ["--", "--version", version, "--release-commit", commit], platform)
      : {
        id: "release:identity",
        notVerified: true,
        reason: "set FORGELOOP_RELEASE_VERSION and FORGELOOP_RELEASE_COMMIT after the release tag and registry publication exist",
      });
  }
  if (tier === "release") commands.push(npmRaw("npm-pack-dry-run", ["pack", "--dry-run", "--json"], platform));
  if (tier === "local" || tier === "prepush" || tier === "release") {
    commands.push(...pythonValidators(platform));
  }
  return commands;
}

function printEnvironment(tier) {
  let revision = "unknown";
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // The validation command remains useful in a source archive.
  }
  console.log(JSON.stringify({
    tier,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    revision,
    cwd: process.cwd(),
  }));
}

function parseArguments(argv) {
  const options = { tier: null, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--tier") {
      options.tier = argv[++index];
      if (!options.tier) throw new Error("--tier requires a value");
    } else if (argument === "--list") {
      options.list = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

function run(command, tier) {
  if (command.notVerified) {
    console.error(`NOT_VERIFIED ${command.id}: ${command.reason}`);
    return Promise.resolve(2);
  }
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(),
      env: { ...process.env, FORGELOOP_VALIDATION_TIER: tier },
      shell: false,
      stdio: "inherit",
    });
    const started = Date.now();
    child.once("error", (error) => {
      console.error(`NOT_VERIFIED ${command.id}: ${error.message}`);
      resolve(1);
    });
    child.once("exit", (code, signal) => {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`PASS ${command.id} (${elapsed}s)`);
        resolve(0);
      } else {
        console.error(`FAIL ${command.id}: exit=${code ?? "null"} signal=${signal ?? "none"}`);
        resolve(code ?? 1);
      }
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const commands = getTierCommands(options.tier, process.platform);
  if (options.list) {
    console.log(JSON.stringify({
      tier: options.tier,
      commands: commands.map(({ id, command, args }) => ({ id, command, args })),
    }, null, 2));
    return 0;
  }
  printEnvironment(options.tier);
  for (const command of commands) {
    const status = await run(command, options.tier);
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1]?.endsWith("/run-validation.mjs")) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`Validation command failed: ${error.message}`);
    process.exitCode = 1;
  }
}

import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMANDS, parseArgs, parseCliSyntax } from "../src/cli.js";
import { CLI_COMMAND_DEFINITIONS, CLI_COMMON_OPTIONS, buildOptionLookup } from "../src/core/cli-command-definitions.js";
import { generateCliOptionsForCommand } from "../scripts/generate_documentation_reference.mjs";

test("CLI definitions satisfy strict registry invariants", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    assert.ok(definition.name, `${command} missing name`);
    assert.ok(definition.category, `${command} missing category`);
    assert.ok(definition.mutation, `${command} missing mutation`);
    assert.ok(definition.options, `${command} missing options`);
    assert.ok(definition.description, `${command} missing description`);

    for (const [optionName, optionDef] of Object.entries(definition.options)) {
      assert.ok(optionDef.targetKey, `${command} ${optionName} missing targetKey`);
      assert.ok(optionDef.parseType, `${command} ${optionName} missing parseType`);
      assert.equal(typeof optionDef.takesValue, "boolean", `${command} ${optionName} takesValue must be boolean`);

      if (optionDef.takesValue && optionDef.parseType !== "argv" && !optionDef.isPositional) {
        assert.ok(optionDef.valueName, `${command} ${optionName} missing valueName`);
      }

      if (optionDef.parseType === "boolean") {
        assert.equal(optionDef.takesValue, false, `${command} ${optionName} boolean option must not take a value`);
      }

      if (optionDef.repeatable) {
        assert.equal(optionDef.takesValue, true, `${command} ${optionName} repeatable option must take a value`);
        assert.notEqual(optionDef.parseType, "boolean", `${command} ${optionName} repeatable option cannot be boolean`);
      }

      if (optionDef.isPositional) {
        assert.equal(optionName.startsWith("-"), false, `${command} positional ${optionName} must not start with -`);
        assert.equal(optionDef.aliases, undefined, `${command} positional ${optionName} cannot have aliases`);
      }

      if (optionDef.parseType === "argv") {
        assert.equal(optionName, "--", `${command} argv parseType must have canonical name --`);
      }

      if (optionDef.allowEmpty) {
        assert.equal(optionDef.parseType, "string", `${command} ${optionName} allowEmpty is valid only for string options`);
        assert.equal(optionDef.takesValue, true, `${command} ${optionName} allowEmpty requires a value-taking option`);
      }

      if (optionDef.allowLeadingHyphen) {
        assert.equal(optionDef.parseType, "string", `${command} ${optionName} allowLeadingHyphen is valid only for string options`);
        assert.equal(optionDef.takesValue, true, `${command} ${optionName} allowLeadingHyphen requires a value-taking option`);
      }
    }
  }
});

test("every command contains all CLI_COMMON_OPTIONS", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    for (const commonOption of Object.keys(CLI_COMMON_OPTIONS)) {
      assert.ok(definition.options[commonOption], `${command} missing common option ${commonOption}`);
    }
  }
});

test("CLI aliases do not collide within a command", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    const seen = new Set();
    for (const [canonical, optionDef] of Object.entries(definition.options)) {
      if (optionDef.isPositional) continue;
      assert.equal(seen.has(canonical), false, `${command} duplicate option ${canonical}`);
      seen.add(canonical);
      for (const alias of optionDef.aliases ?? []) {
        assert.equal(seen.has(alias), false, `${command} alias collision: ${alias}`);
        seen.add(alias);
      }
    }
  }
});

test("CLI target keys do not collide unexpectedly within a command", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    const targetOwners = new Map();
    for (const [name, optionDef] of Object.entries(definition.options)) {
      const existing = targetOwners.get(optionDef.targetKey);
      if (existing) {
        throw new Error(`${command}: ${name} and ${existing} share targetKey ${optionDef.targetKey}`);
      }
      targetOwners.set(optionDef.targetKey, name);
    }
  }
});

test("bootstrap options are accepted before the command", () => {
  const p1 = parseCliSyntax(["--path", "./repo", "status"]);
  assert.equal(p1.command, "status");
  assert.equal(p1.options.path, "./repo");

  const p2 = parseCliSyntax(["--path=./repo", "status"]);
  assert.equal(p2.command, "status");
  assert.equal(p2.options.path, "./repo");

  const p3 = parseCliSyntax(["-h"]);
  assert.equal(p3.command, null);
  assert.equal(p3.options.help, true);

  const p4 = parseCliSyntax(["-v"]);
  assert.equal(p4.command, null);
  assert.equal(p4.options.version, true);
});

test("command-specific options are rejected before command discovery", () => {
  assert.throws(() => parseCliSyntax(["--json", "status"]), /not valid before a command/);
  assert.throws(() => parseCliSyntax(["--task", "abc", "bundle"]), /not valid before a command/);
  assert.throws(() => parseCliSyntax(["--strict", "doctor"]), /not valid before a command/);
  assert.throws(() => parseCliSyntax(["--", "node", "--version", "run-check"]), /not valid before a command/);
});

test("non-bootstrap options cannot appear before command", () => {
  const bootstrapFlags = new Set(Object.keys(CLI_COMMON_OPTIONS));

  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    for (const [optionName, optionDef] of Object.entries(definition.options)) {
      if (optionDef.isPositional || optionName === "--" || bootstrapFlags.has(optionName)) {
        continue;
      }

      let argv;
      if (optionDef.takesValue) {
        let sample = "sample";
        if (optionDef.parseType === "json-object") sample = "{}";
        if (optionDef.parseType === "non-negative-integer") sample = "0";
        argv = [optionName, sample, command];
      } else {
        argv = [optionName, command];
      }

      assert.throws(
        () => parseCliSyntax(argv),
        /not valid before a command/,
        `${command} ${optionName} unexpectedly allowed before command`,
      );
    }
  }
});

test("positional definitions are not exposed as option lookup entries", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    const lookup = buildOptionLookup(command);
    for (const [name, optionDef] of Object.entries(definition.options)) {
      if (optionDef.isPositional) {
        assert.equal(lookup.has(name), false, `${command} lookup unexpectedly contains positional ${name}`);
      }
    }
  }
});

test("CLI parser parity: every declared option is recognized for each command", () => {
  for (const [cmdName, def] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    for (const [optName, optDef] of Object.entries(def.options)) {
      if (optName.startsWith("<")) continue; // Positional argument

      let testArgv;
      if (optName === "--") {
        // Most argv commands use the verification-style --id sample; durable
        // actions intentionally use --action because they are not checks.
        const identityOption = def.options["--id"] ? "--id" : def.options["--action"] ? "--action" : "--id";
        testArgv = [cmdName, identityOption, "sample-id", "--requirement", "req-1", "--", "node", "--version"];
      } else if (optDef.takesValue) {
        let val = "sample-value";
        if (optDef.parseType === "json-object") val = "{}";
        if (optDef.parseType === "non-negative-integer") val = "0";
        testArgv = [cmdName, optName, val];
      } else {
        testArgv = [cmdName, optName];
      }

      // Syntax parsing must recognize the option without throwing "not valid for <command>"
      const parsed = parseCliSyntax(testArgv);
      assert.equal(parsed.command, cmdName);
      if (optDef.targetKey) {
        if (optDef.parseType === "boolean") {
          assert.equal(parsed.options[optDef.targetKey], true);
        } else if (optDef.repeatable) {
          assert.ok(Array.isArray(parsed.options[optDef.targetKey]));
          assert.ok(parsed.options[optDef.targetKey].length > 0);
        } else if (optDef.parseType === "non-negative-integer") {
          assert.equal(parsed.options[optDef.targetKey], 0);
        } else if (optDef.parseType === "json-object") {
          assert.deepEqual(parsed.options[optDef.targetKey], {});
        } else if (optDef.parseType === "argv") {
          assert.deepEqual(parsed.options[optDef.targetKey], ["node", "--version"]);
        } else {
          assert.equal(parsed.options[optDef.targetKey], "sample-value");
        }
      }
    }
  }
});

test("CLI parser parity: foreign options are rejected for each command", () => {
  const allKnownFlags = new Set(
    Object.values(CLI_COMMAND_DEFINITIONS).flatMap((def) =>
      Object.keys(def.options).filter((k) => k.startsWith("-") && k !== "--path" && k !== "--help" && k !== "--version"),
    ),
  );

  for (const [cmdName, def] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    const supportedFlags = new Set(Object.keys(def.options));

    for (const foreignFlag of allKnownFlags) {
      if (supportedFlags.has(foreignFlag)) continue;

      const foreignDef = Object.values(CLI_COMMAND_DEFINITIONS)
        .flatMap((d) => Object.entries(d.options))
        .find(([k]) => k === foreignFlag)?.[1];

      let sampleVal = "sample-val";
      if (foreignFlag === "--details") sampleVal = "{}";
      if (foreignFlag === "--exit-code") sampleVal = "0";

      const testArgv = foreignDef?.takesValue
        ? [cmdName, foreignFlag, sampleVal]
        : [cmdName, foreignFlag];

      assert.throws(
        () => parseArgs(testArgv),
        (err) => {
          return err.message.includes(`Option ${foreignFlag} is not valid for ${cmdName}`) ||
            err.message.includes(`${foreignFlag} is not valid for ${cmdName}`) ||
            err.message.includes(`Unknown option: ${foreignFlag}`);
        },
        `Command "${cmdName}" must reject foreign option "${foreignFlag}"`,
      );
    }
  }
});

test("CLI parser does not reinterpret option values as commands", () => {
  const bundle = parseArgs(["bundle", "--task", "status"]);
  assert.equal(bundle.command, "bundle");
  assert.equal(bundle.options.taskId, "status");

  const status = parseArgs(["status", "--path", "update"]);
  assert.equal(status.command, "status");
  assert.equal(status.options.path, "update");

  const policy = parseArgs(["policy", "report"]);
  assert.equal(policy.command, "policy");
  assert.equal(policy.options.policy, "report");
});

test("bootstrap command discovery skips bootstrap option values", () => {
  const p1 = parseCliSyntax(["--path", "status", "doctor"]);
  assert.equal(p1.command, "doctor");
  assert.equal(p1.options.path, "status");

  const p2 = parseCliSyntax(["--path", "update", "status"]);
  assert.equal(p2.command, "status");
  assert.equal(p2.options.path, "update");

  const p3 = parseCliSyntax(["--path", "bundle", "report"]);
  assert.equal(p3.command, "report");
  assert.equal(p3.options.path, "bundle");
});

test("command names are valid values where syntax allows arbitrary strings", () => {
  for (const commandName of COMMANDS) {
    const bundle = parseArgs(["bundle", "--task", commandName]);
    assert.equal(bundle.command, "bundle");
    assert.equal(bundle.options.taskId, commandName);

    const status = parseArgs(["status", "--path", commandName]);
    assert.equal(status.command, "status");
    assert.equal(status.options.path, commandName);

    const policy = parseArgs(["policy", commandName]);
    assert.equal(policy.command, "policy");
    assert.equal(policy.options.policy, commandName);
  }
});

test("all value-taking long options support equals syntax", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    for (const [optionName, optionDef] of Object.entries(definition.options)) {
      if (optionName === "--" || optionDef.isPositional || !optionDef.takesValue) {
        continue;
      }

      let sample = "sample";
      if (optionDef.parseType === "json-object") sample = "{}";
      if (optionDef.parseType === "non-negative-integer") sample = "0";

      assert.doesNotThrow(
        () => parseCliSyntax([command, `${optionName}=${sample}`]),
        `${command} ${optionName}=${sample} threw unexpectedly`,
      );
    }
  }
});

test("string CLI options reject empty equals values and explicit empty argv values", () => {
  assert.throws(() => parseCliSyntax(["status", "--path="]), /--path requires a directory/);
  assert.throws(() => parseCliSyntax(["bundle", "--task="]), /--task requires an ID/);
  assert.throws(() => parseCliSyntax(["record-check", "--id="]), /--id requires a check ID/);
  assert.throws(() => parseCliSyntax(["bundle", "--task", ""]), /--task requires an ID/);
  assert.throws(() => parseCliSyntax(["status", "--path", ""]), /--path requires a directory/);
});

test("all non-empty string CLI options reject empty inline values and empty argv values", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    for (const [optionName, optionDef] of Object.entries(definition.options)) {
      if (optionDef.parseType !== "string" || optionDef.isPositional || optionDef.allowEmpty) {
        continue;
      }

      assert.throws(
        () => parseCliSyntax([command, `${optionName}=`]),
        undefined,
        `${command} ${optionName}= must reject empty values`,
      );

      assert.throws(
        () => parseCliSyntax([command, optionName, ""]),
        undefined,
        `${command} ${optionName} "" must reject empty values`,
      );
    }
  }
});

test("all boolean CLI options reject equals syntax", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    for (const [optionName, optionDef] of Object.entries(definition.options)) {
      if (optionDef.parseType !== "boolean") continue;

      assert.throws(
        () => parseCliSyntax([command, `${optionName}=false`]),
        /does not accept a value/,
        `${command} ${optionName}=false must fail`,
      );
      assert.throws(
        () => parseCliSyntax([command, `${optionName}=true`]),
        /does not accept a value/,
        `${command} ${optionName}=true must fail`,
      );
    }
  }
});

test("all declared aliases are recognized", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    for (const [canonical, optionDef] of Object.entries(definition.options)) {
      for (const alias of optionDef.aliases ?? []) {
        const parsed = parseCliSyntax([command, alias]);
        assert.equal(
          parsed.options[optionDef.targetKey],
          true,
          `${command} alias ${alias} for ${canonical} failed`,
        );
      }
    }
  }
});

test("all repeatable CLI options accumulate values", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    for (const [optionName, optionDef] of Object.entries(definition.options)) {
      if (!optionDef.repeatable) continue;

      const parsed = parseCliSyntax([
        command,
        optionName,
        "one",
        optionName,
        "two",
      ]);

      assert.deepEqual(
        parsed.options[optionDef.targetKey],
        ["one", "two"],
        `${command} ${optionName} failed to accumulate values`,
      );
    }
  }
});

test("CLI parser parity: JSON and integer options validate correctly", () => {
  // Valid JSON object
  const validJson = parseCliSyntax(["record-check", "--id", "chk-1", "--requirement", "req-1", "--details", '{"k":"v"}']);
  assert.deepEqual(validJson.options.checkDetails, { k: "v" });

  // Invalid JSON (syntax)
  assert.throws(() => parseCliSyntax(["record-check", "--id", "chk-1", "--requirement", "req-1", "--details", 'invalid-json']), /must be valid JSON/);

  // Invalid JSON (array instead of object)
  assert.throws(() => parseCliSyntax(["record-check", "--id", "chk-1", "--requirement", "req-1", "--details", '[1,2,3]']), /must be a JSON object/);

  // Valid integer
  const validInt = parseCliSyntax(["record-check", "--id", "chk-1", "--requirement", "req-1", "--exit-code", "0"]);
  assert.equal(validInt.options.checkExitCode, 0);

  // Invalid integer
  assert.throws(() => parseCliSyntax(["record-check", "--id", "chk-1", "--requirement", "req-1", "--exit-code", "-1"]), /requires a non-negative integer/);
  assert.throws(() => parseCliSyntax(["record-check", "--id", "chk-1", "--requirement", "req-1", "--exit-code", "abc"]), /requires a non-negative integer/);
});

test("CLI parser parity: argv passthrough preserves exact remaining tokens", () => {
  const parsed = parseCliSyntax(["run-check", "--id", "chk-1", "--requirement", "req-1", "--", "npm", "test", "--", "--json", "status"]);
  assert.deepEqual(parsed.options.commandArgv, ["npm", "test", "--", "--json", "status"]);
});

test("CLI parser parity: semantic validation remains enforced", () => {
  assert.throws(() => parseArgs(["bundle"]), /bundle requires --task/);
  assert.throws(() => parseArgs(["policy"]), /policy requires a name/);
  assert.throws(() => parseArgs(["record-check"]), /record-check requires --id/);
  assert.throws(() => parseArgs(["run-check", "--id", "chk-1", "--requirement", "req-1"]), /run-check requires -- followed by an exact command argv/);
});

test("task-resume accepts an explicit task and repeatable claim reacquisition", () => {
  assert.ok(CLI_COMMAND_DEFINITIONS["task-resume"]);
  const parsed = parseArgs([
    "task-resume",
    "--task",
    "recovered-task",
    "--claim",
    "src",
    "--claim",
    "tests",
    "--json",
  ]);
  assert.equal(parsed.command, "task-resume");
  assert.equal(parsed.options.taskId, "recovered-task");
  assert.deepEqual(parsed.options.claims, ["src", "tests"]);
  assert.equal(parsed.options.json, true);
});

test("task-recover distinguishes caller acknowledgement from its deprecated alias", () => {
  const definition = CLI_COMMAND_DEFINITIONS["task-recover"];
  assert.ok(definition.options["--acknowledge-recovery"]);
  assert.ok(definition.options["--operator-authorized"]);

  const acknowledged = parseArgs(["task-recover", "--task", "stale-task", "--acknowledge-recovery"]);
  assert.equal(acknowledged.options.acknowledgeRecovery, true);
  assert.equal(acknowledged.options.operatorAuthorized, undefined);

  const deprecated = parseArgs(["task-recover", "--task", "stale-task", "--operator-authorized"]);
  assert.equal(deprecated.options.operatorAuthorized, true);
  assert.equal(deprecated.options.acknowledgeRecovery, undefined);
});

test("storage migration resume requires a separate explicit unbound-handoff reconciliation acknowledgement", () => {
  const parsed = parseArgs([
    "storage-migration-resume",
    "--destination", "retained",
    "--expected-owner", "00000000-0000-0000-0000-000000000001",
    "--writers-quiesced",
    "--reconcile-unbound-handoff",
  ]);
  assert.equal(parsed.options.acknowledgeUnboundHandoff, true);
  assert.equal(parseArgs([
    "storage-migration-resume",
    "--destination", "retained",
    "--expected-owner", "00000000-0000-0000-0000-000000000001",
    "--writers-quiesced",
  ]).options.acknowledgeUnboundHandoff, undefined);
});

test("generated CLI options never duplicate repeatable marker", () => {
  for (const command of COMMANDS) {
    const generated = generateCliOptionsForCommand(command);
    assert.doesNotMatch(
      generated,
      /\(repeatable\)\s+\(repeatable\)/,
      `${command} contains duplicated repeatable marker`,
    );
  }
});

test("repeatable CLI options keep repeatability out of descriptions", () => {
  for (const [command, definition] of Object.entries(CLI_COMMAND_DEFINITIONS)) {
    for (const [option, optionDef] of Object.entries(definition.options)) {
      if (!optionDef.repeatable) continue;
      assert.doesNotMatch(
        optionDef.description,
        /\brepeatable\b/i,
        `${command} ${option} duplicates repeatability in description`,
      );
    }
  }
});

test("CLI option formatting: all command options render at single list level without nested indentation", () => {
  for (const cmdName of COMMANDS) {
    const generated = generateCliOptionsForCommand(cmdName);
    for (const line of generated.split("\n")) {
      if (!line.trim()) continue;
      assert.match(
        line,
        /^- `/,
        `Command "${cmdName}" option line must start with "- \`": "${line}"`,
      );
      assert.doesNotMatch(
        line,
        /^\s{2,}- `/,
        `Command "${cmdName}" option line must not have nested indentation: "${line}"`,
      );
    }
  }
});

test("CLI run-check formatting: renders -- <argv...> with single angle brackets", () => {
  const generated = generateCliOptionsForCommand("run-check");
  assert.match(generated, /- `-- <argv\.\.\.>`:/);
  assert.doesNotMatch(generated, /<<argv\.\.\.>>/);
});

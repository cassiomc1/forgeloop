import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { parseDotNetProject } from "../src/core/parsers/dotnet-project.js";
import { PROJECT_DETECTION_LIMITS } from "../src/core/parsers/limits.js";
import { MAX_INLINE_MAP_DEPTH, parsePubspec } from "../src/core/parsers/pubspec.js";
import * as projectDetection from "../src/core/project-detection.js";

// Deterministic PRNG so failures are reproducible from the printed seed.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const YAML_ALPHABET = [..."abc:{}[],'\"#-|>&*! \t\n\r\\0"];
const XML_ALPHABET = [..."<>/=\"'!?-[]&;abcProjectSdk \t\n"];

const VALID_PUBSPEC = `name: app
dependencies:
  flutter:
    sdk: flutter
dev_dependencies:
  flutter_test:
    sdk: flutter
`;
const VALID_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup>
  <ItemGroup><PackageReference Include="Volo.Abp.Core" Version="9.0.0" /></ItemGroup>
</Project>
`;

function randomText(random, alphabet, maxLength) {
  const length = Math.floor(random() * maxLength);
  let text = "";
  for (let index = 0; index < length; index += 1) text += alphabet[Math.floor(random() * alphabet.length)];
  return text;
}

function mutate(random, source, alphabet) {
  const characters = [...source];
  const edits = 1 + Math.floor(random() * 8);
  for (let edit = 0; edit < edits; edit += 1) {
    const position = Math.floor(random() * (characters.length + 1));
    const operation = random();
    if (operation < 0.34) characters.splice(position, 1);
    else if (operation < 0.67) characters.splice(position, 0, alphabet[Math.floor(random() * alphabet.length)]);
    else characters[position] = alphabet[Math.floor(random() * alphabet.length)];
  }
  return characters.join("");
}

function assertShape(result, keys, input, seed) {
  assert.equal(typeof result, "object", `seed ${seed}: non-object for ${JSON.stringify(input)}`);
  assert.equal(typeof result.valid, "boolean", `seed ${seed}: missing valid flag`);
  for (const key of keys) assert.ok(Object.hasOwn(result, key), `seed ${seed}: missing ${key}`);
}

test("project-detection re-exports the extracted manifest parsers unchanged", () => {
  assert.equal(projectDetection.parsePubspec, parsePubspec);
  assert.equal(projectDetection.parseDotNetProject, parseDotNetProject);
  assert.equal(projectDetection.PROJECT_DETECTION_LIMITS, PROJECT_DETECTION_LIMITS);
});

test("valid seed manifests are recognized", () => {
  assert.deepEqual(parsePubspec(VALID_PUBSPEC), { valid: true, primary: true, flutterTest: true, override: false });
  const project = parseDotNetProject(VALID_CSPROJ);
  assert.equal(project.valid, true);
  assert.equal(project.aspnetcore, true);
  assert.equal(project.abp, true);
  assert.deepEqual(project.targetFrameworks, ["net9.0"]);
});

test("pubspec parser never throws on random or mutated input", () => {
  const seed = 0x5eed01;
  const random = mulberry32(seed);
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const input = iteration % 2 === 0
      ? randomText(random, YAML_ALPHABET, 200)
      : mutate(random, VALID_PUBSPEC, YAML_ALPHABET);
    assertShape(parsePubspec(input), ["primary", "flutterTest", "override"], input, seed);
  }
});

test(".NET project parser never throws on random or mutated input", () => {
  const seed = 0x5eed02;
  const random = mulberry32(seed);
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const input = iteration % 2 === 0
      ? randomText(random, XML_ALPHABET, 200)
      : mutate(random, VALID_CSPROJ, XML_ALPHABET);
    assertShape(parseDotNetProject(input), ["dotnet", "aspnetcore", "abp", "targetFrameworks"], input, seed);
  }
});

test("parsers reject non-string and oversized manifests and stay linear on deep nesting", () => {
  for (const value of [undefined, null, 42, {}, []]) {
    assert.equal(parsePubspec(value).valid, false);
    assert.equal(parseDotNetProject(value).valid, false);
  }
  const oversized = "a".repeat(PROJECT_DETECTION_LIMITS.maxManifestBytes + 1);
  assert.equal(parsePubspec(oversized).valid, false);
  assert.equal(parseDotNetProject(oversized).valid, false);

  const depth = 20000;
  const started = performance.now();
  assert.equal(parsePubspec(`dependencies:\n  flutter: ${"{a: ".repeat(depth)}b${"}".repeat(depth)}\n`).valid, false);
  parseDotNetProject(`<Project>${"<a>".repeat(depth)}${"</a>".repeat(depth)}</Project>`);
  assert.ok(performance.now() - started < 2000, "deeply nested manifests must not trigger super-linear parsing");
});

test("inline flow maps are accepted up to the documented depth bound", () => {
  const nested = (levels) => `dependencies:\n  flutter: ${"{a: ".repeat(levels)}b${"}".repeat(levels)}\n`;
  assert.equal(parsePubspec(nested(MAX_INLINE_MAP_DEPTH)).valid, true);
  assert.equal(parsePubspec(nested(MAX_INLINE_MAP_DEPTH + 2)).valid, false);
});

import crypto from "node:crypto";
import fs from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  E_BROWSER_VERIFICATION_ORIGIN_DENIED,
  E_BROWSER_VERIFICATION_PROVIDER_INVALID,
  E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE,
  E_BROWSER_VERIFICATION_RESULT_INVALID,
  E_BROWSER_VERIFICATION_TIMEOUT,
} from "../../core/error-codes.js";
import { assertAbsoluteRegularFile, parseAgentBrowserJson, runAgentBrowserCommand, AGENT_BROWSER_PROCESS_LIMITS } from "./process.js";
import {
  attributeCommand, clickCommand, closeCommand, fillCommand, focusCommand, openCommand,
  pressCommand, screenshotCommand, snapshotCommand, textCommand, titleCommand, urlCommand, valueCommand,
  versionCommand, visibleCommand,
} from "./commands.js";
import { resolveSnapshotLocator } from "./locator.js";
import { actualValue, assertionResult, matchesAssertion } from "./assertions.js";

function providerError(code, message) {
  const error = new Error(message);
  error.name = "AgentBrowserProviderError";
  error.code = code;
  return error;
}

function expectedVersion(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(value)) {
    throw providerError(E_BROWSER_VERIFICATION_PROVIDER_INVALID, "Agent Browser expectedVersion is invalid");
  }
  return value;
}

function parseVersion(stdout) {
  const match = /^\s*agent-browser\s+([^\s]+)(?:\s|$)/iu.exec(stdout);
  if (!match) throw providerError(E_BROWSER_VERIFICATION_RESULT_INVALID, "Agent Browser version output was not qualified");
  return match[1];
}

function remaining(deadline) {
  const value = deadline - Date.now();
  if (value < 1) throw providerError(E_BROWSER_VERIFICATION_TIMEOUT, "Agent Browser verification deadline expired");
  return value;
}

function originOf(value) {
  const parsed = new URL(value);
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}`;
}

function verifyOrigin(value, allowedOrigins) {
  let origin;
  try { origin = originOf(value); } catch { throw providerError(E_BROWSER_VERIFICATION_ORIGIN_DENIED, "Agent Browser reported an invalid URL"); }
  if (!allowedOrigins.includes(origin)) throw providerError(E_BROWSER_VERIFICATION_ORIGIN_DENIED, "Agent Browser left the allowed origins");
  return value;
}

function dataValue(data) { return actualValue(data); }

function resultWithAssertions(assertions, finalUrl, navigations, diagnostics = [], snapshots = [], artifacts = []) {
  return { assertions, finalUrl, navigations, diagnostics, snapshots, artifacts };
}

function blockedAssertions(request, message) {
  return request.assertions.map((assertion) => assertionResult(assertion, "BLOCKED", undefined, message));
}

async function createCwd(tempRoot, fsImpl) {
  const root = tempRoot ?? os.tmpdir();
  if (typeof root !== "string" || !path.isAbsolute(root)) throw providerError(E_BROWSER_VERIFICATION_PROVIDER_INVALID, "Agent Browser tempRoot must be absolute");
  const make = fsImpl?.mkdtemp ?? mkdtemp;
  return make(path.join(root, "forgeloop-agent-browser-"));
}

function screenshotRef(verificationId, digest) { return `agent-browser/${verificationId}/${digest}.png`; }

async function executeWait(step, { invoke, resolve, readUrl, deadline, clock }) {
  const waitDeadline = Math.min(deadline, clock.now() + Math.max(100, Math.min(remaining(deadline), 5000)));
  let satisfied = false;
  while (!satisfied) {
    if (clock.now() >= waitDeadline) throw providerError(E_BROWSER_VERIFICATION_TIMEOUT, "Agent Browser wait condition timed out");
    if (step.condition === "VISIBLE" || step.condition === "HIDDEN") {
      const visible = dataValue(await invoke(visibleCommand, { selector: await resolve(step.locator) })) === "true";
      satisfied = step.condition === "VISIBLE" ? visible : !visible;
    } else if (step.condition === "TEXT_CONTAINS") {
      const text = dataValue(await invoke(textCommand, { selector: await resolve(step.locator) }));
      satisfied = text.includes(step.expected ?? "");
    } else {
      const url = await readUrl();
      satisfied = step.condition === "URL_IS" ? url === step.expected : url.startsWith(step.expected);
    }
    if (!satisfied) await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(50, Math.max(1, waitDeadline - clock.now()))));
  }
}

async function executeStep(step, helpers, navigations) {
  const { invoke, resolve, readUrl } = helpers;
  if (step.kind === "NAVIGATE") {
    await invoke(openCommand, { url: step.url });
    const observed = await readUrl();
    navigations.push({ url: step.url, kind: "NAVIGATE" });
    if (observed !== step.url) navigations.push({ url: observed, kind: "REDIRECT" });
  } else if (step.kind === "CLICK") {
    await invoke(clickCommand, { selector: await resolve(step.locator) });
    await readUrl();
  } else if (step.kind === "FILL") {
    await invoke(fillCommand, { selector: await resolve(step.locator), text: step.text });
    await readUrl();
  } else if (step.kind === "PRESS") {
    await invoke(focusCommand, { selector: await resolve(step.locator) });
    await invoke(pressCommand, { key: step.key });
    await readUrl();
  } else if (step.kind === "WAIT_FOR") {
    await executeWait(step, helpers);
  }
}

async function executeSteps(request, helpers, navigations) {
  for (const step of request.steps) await executeStep(step, helpers, navigations);
}

async function readAssertionValue(assertion, { invoke, resolve, readUrl }) {
  if (assertion.kind === "VISIBLE" || assertion.kind === "HIDDEN") {
    return dataValue(await invoke(visibleCommand, { selector: await resolve(assertion.locator) }));
  }
  if (assertion.kind === "TEXT_CONTAINS" || assertion.kind === "TEXT_EQUALS") {
    return dataValue(await invoke(textCommand, { selector: await resolve(assertion.locator) }));
  }
  if (assertion.kind === "VALUE_EQUALS") return dataValue(await invoke(valueCommand, { selector: await resolve(assertion.locator) }));
  if (assertion.kind === "ATTRIBUTE_EQUALS") {
    return dataValue(await invoke(attributeCommand, { selector: await resolve(assertion.locator), attribute: assertion.attribute }));
  }
  if (assertion.kind === "URL_IS" || assertion.kind === "URL_PREFIX") return readUrl();
  return dataValue(await invoke(titleCommand));
}

async function executeAssertions(request, helpers) {
  const results = [];
  for (const assertion of request.assertions) {
    try {
      const actual = await readAssertionValue(assertion, helpers);
      results.push(assertionResult(assertion, matchesAssertion(assertion.kind, actual, assertion.expected) ? "PASS" : "FAIL", actual));
    } catch (error) {
      if (error.code === E_BROWSER_VERIFICATION_TIMEOUT) throw error;
      results.push(assertionResult(assertion, "BLOCKED", undefined, "Browser observation was unavailable"));
    }
  }
  return results;
}

async function captureScreenshot(request, { cwd, run, globals, fileSystem }, results, artifacts) {
  const capture = request.capture?.screenshot ?? "NEVER";
  const shouldCapture = capture === "ALWAYS" || (capture === "ON_FAILURE" && results.some((item) => item.status !== "PASS"));
  if (!shouldCapture) return;
  const outputPath = path.join(cwd, "verification.png");
  await run(screenshotCommand({ ...globals, outputPath }));
  const content = await fileSystem.readFile(outputPath);
  const digest = crypto.createHash("sha256").update(content).digest("hex");
  artifacts.push({ kind: "SCREENSHOT", mimeType: "image/png", byteLength: content.byteLength, sha256: digest, ref: screenshotRef(request.verificationId, digest) });
}

export function createAgentBrowserVerificationProvider({
  executablePath,
  expectedVersion: expected,
  browserExecutablePath,
  spawnImpl,
  env,
  fsImpl = null,
  tempRoot,
  clock = Date,
} = {}) {
  const fileSystem = fsImpl ?? {
    lstatSync: fs.lstatSync.bind(fs),
    statSync: fs.statSync.bind(fs),
    mkdtemp,
    readFile,
    rm,
  };
  const executable = assertAbsoluteRegularFile(executablePath, "Agent Browser executable", fileSystem);
  const expectedVersionValue = expectedVersion(expected);
  if (browserExecutablePath !== undefined) assertAbsoluteRegularFile(browserExecutablePath, "Browser executable", fileSystem);

  return Object.freeze({
    id: "agent-browser",
    async verify(request) {
      const deadline = clock.now() + request.timeoutMs;
      const sessionId = `forgeloop-${crypto.randomUUID()}`;
      let cwd;
      let closed = false;
      const run = async (args, limit = AGENT_BROWSER_PROCESS_LIMITS.maxStdoutBytes) => {
        const output = await runAgentBrowserCommand(executable, args, {
          cwd,
          timeoutMs: remaining(deadline),
          signal: request.signal,
          spawnImpl,
          env: {
            ...env,
            ...(browserExecutablePath ? { AGENT_BROWSER_EXECUTABLE_PATH: browserExecutablePath } : {}),
            AGENT_BROWSER_CONTENT_BOUNDARIES: "1",
            AGENT_BROWSER_MAX_OUTPUT: String(AGENT_BROWSER_PROCESS_LIMITS.maxOutputChars),
          },
          maxStdoutBytes: limit,
          fsImpl: fileSystem,
          trustedEnvKeys: browserExecutablePath ? ["AGENT_BROWSER_EXECUTABLE_PATH"] : [],
        });
        return parseAgentBrowserJson(output.stdout);
      };
      const globals = { sessionId, allowedOrigins: request.allowedOrigins, maxOutputChars: AGENT_BROWSER_PROCESS_LIMITS.maxOutputChars };
      const invoke = (builder, input = {}) => run(builder({ ...globals, ...input }));
      const snapshots = [];
      const navigations = [];
      const diagnostics = [];
      const artifacts = [];
      let currentUrl = request.startUrl;
      try {
        cwd = await createCwd(tempRoot, fileSystem);
        const versionOutput = await runAgentBrowserCommand(executable, versionCommand(), {
          cwd, timeoutMs: remaining(deadline), signal: request.signal, spawnImpl, env,
          maxStdoutBytes: AGENT_BROWSER_PROCESS_LIMITS.maxVersionBytes,
          fsImpl: fileSystem,
        });
        const version = parseVersion(versionOutput.stdout);
        if (expectedVersionValue !== undefined && version !== expectedVersionValue) {
          throw providerError(E_BROWSER_VERIFICATION_PROVIDER_INVALID, "Agent Browser version does not match expectedVersion");
        }

        const readUrl = async () => {
          const value = dataValue(await invoke(urlCommand));
          currentUrl = verifyOrigin(value, request.allowedOrigins);
          return currentUrl;
        };
        const readSnapshot = async () => {
          const value = await invoke(snapshotCommand);
          snapshots.push({ kind: "ACCESSIBILITY", text: typeof value === "string" ? value : JSON.stringify(value) });
          return value;
        };
        const resolve = async (locator) => resolveSnapshotLocator(locator, await readSnapshot());
        const helpers = { invoke, resolve, readUrl, deadline, clock };
        await invoke(openCommand, { url: request.startUrl });
        const initialUrl = await readUrl();
        navigations.push({ url: request.startUrl, kind: "NAVIGATE" });
        if (initialUrl !== request.startUrl) navigations.push({ url: initialUrl, kind: "REDIRECT" });
        await executeSteps(request, helpers, navigations);
        const results = await executeAssertions(request, helpers);
        await captureScreenshot(request, { cwd, run, globals, fileSystem }, results, artifacts);
        currentUrl = await readUrl();
        return resultWithAssertions(results, currentUrl, navigations, diagnostics, snapshots, artifacts);
      } catch (error) {
        if ([E_BROWSER_VERIFICATION_TIMEOUT, E_BROWSER_VERIFICATION_ORIGIN_DENIED, E_BROWSER_VERIFICATION_PROVIDER_INVALID].includes(error.code)) throw error;
        if (error.code === E_BROWSER_VERIFICATION_PROVIDER_UNAVAILABLE) throw error;
        return { assertions: blockedAssertions(request, "Browser verification could not complete"), finalUrl: currentUrl, navigations, diagnostics, snapshots, artifacts };
      } finally {
        if (cwd && !closed) {
          closed = true;
          try {
            await runAgentBrowserCommand(executable, closeCommand({ ...globals }), {
              cwd,
              timeoutMs: Math.max(1, Math.min(Math.max(1, deadline - Date.now()), 1000)),
              signal: undefined,
              spawnImpl,
              env,
              fsImpl: fileSystem,
            });
          } catch { /* cleanup is best effort and never leaks process data */ }
          try { await fileSystem.rm(cwd, { recursive: true, force: true }); } catch { /* temp cleanup is bounded and non-authoritative */ }
        }
      }
    },
  });
}

# Agent Browser Adapter

ForgeLoop ships an optional, host-injected adapter for Vercel Labs
`agent-browser`. It implements the existing provider-neutral Browser
Verification contract; it is not canonical browser infrastructure and it does
not create lifecycle evidence.

## Installation ownership

The host must provide an already-installed `agent-browser` executable and pass
its absolute path to `createAgentBrowserVerificationProvider`. ForgeLoop never
discovers a binary through `PATH`, installs or upgrades Agent Browser, installs
Chrome, or runs `doctor --fix`.

```js
import {
  createAgentBrowserVerificationProvider,
  createForgeLoopContext,
  runBrowserVerification,
} from "@cassiomc1/forgeloop/integration";

const provider = createAgentBrowserVerificationProvider({
  executablePath: "/opt/agent-browser/bin/agent-browser",
  expectedVersion: "0.38.1",
});
const runtimeContext = createForgeLoopContext({
  browserVerificationProviders: { "agent-browser": provider },
});
```

## Supported mapping

The adapter maps `NAVIGATE`, `CLICK`, `FILL`, `PRESS`, and bounded polling for
`WAIT_FOR` to Agent Browser commands. CSS locators are passed directly;
TEXT, LABEL, and ROLE locators are resolved from one accessibility snapshot and
ambiguity is `BLOCKED`. Assertions cover visibility, hidden state, text,
value, attribute, URL, URL prefix, and title. Requested assertion order is
preserved.

## Security and lifecycle

Each invocation probes the explicitly supplied executable version lazily, uses
a fresh random session, runs in an adapter-owned temporary cwd, and closes the
session in `finally`. Profiles, restore/state replay, CDP, auto-connect,
plugins, init scripts, and ambient cloud/authentication variables are filtered.
The target repository is never used as the Agent Browser cwd.

ForgeLoop validates exact `http`/`https` origins. Agent Browser receives the
corresponding hostname allowlist as defense in depth, while ForgeLoop remains
authoritative for scheme, host, and port. Redirects outside the allowlist are
rejected. Subprocess argv uses `shell: false`; stdout, stderr, time, and
diagnostics are bounded, and abort/timeout sends bounded termination signals.

## Screenshots and trust model

`NEVER`, `ON_FAILURE`, and `ALWAYS` screenshot policies are supported. Screenshot
bytes remain temporary; results expose only bounded PNG metadata, a SHA-256
digest, and a portable `agent-browser/<verification>/<digest>.png` reference.

The result is observation-only: `persisted: false`, `evidenceAuthority: NONE`,
and no lifecycle, claim, completion, evidence, or next-action fields. Calling
`runBrowserVerification` does not mutate ForgeLoop artifacts and a PASS is never
auto-promoted to a check or completion.

Command responses must use the complete `{success: true, data}` envelope and
scalar observations are type-checked before assertions run. Missing or extra
envelope fields, malformed observations, non-zero exits, unsupported versions,
cancellation, timeout, and output overflow fail closed; process success alone
never produces a PASS. Any internal test-only temporary-root override must stay
outside the verification target; the public TypeScript API exposes only the
host-selected executables.

## Troubleshooting and limitations

Use an absolute regular executable path and, when desired, set
`expectedVersion` to the host-qualified version. A missing executable, version
mismatch, timeout, malformed response, output overflow, locator ambiguity, or
origin escape fails closed. The default test suite does not require Agent
Browser, Chrome, network access, or a Node 24 runtime. An optional localhost
smoke test is available only when explicitly enabled with
`FORGELOOP_AGENT_BROWSER_E2E=1` and `FORGELOOP_AGENT_BROWSER_EXECUTABLE`.

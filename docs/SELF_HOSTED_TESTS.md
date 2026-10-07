# Self-hosted Node validation

Node validation uses the following repository-specific runners. Platform and
Node-version matrix rows remain explicit; moving a job does not remove a check.

| Platform | Runner label | Execution location |
| --- | --- | --- |
| macOS arm64 | `forgeloop-macos-local` | Local macOS LaunchAgent |
| Windows x64 | `forgeloop-windows-remote` | Windows service on the requested remote host |
| Linux x64 | `forgeloop-linux-remote` | Docker Linux container on that Windows host |

Publishing jobs retain their existing hosted execution and manual confirmation.
Their Node tests run in a preceding remote `verify` job. Classification and the
final PR result aggregation remain hosted; they do not run the product test
suite. CodeQL, dependency review and release-note publication retain their
existing execution locations.

`PR Core` also supports manual dispatch on a pushed candidate branch. Dispatch
selects every validation category, so validation does not require a PR event
or revision-range payload. PR invocations keep their existing path routing.
The native Repository Index matrix waits for the preceding Linux checks to
finish and runs one platform row at a time. Expanded Node compatibility waits
for its minimum-runtime check and also runs one row at a time. Native rows still
run after an earlier test failure to retain diagnostic coverage; final required
validation reports preceding failures.

Dispatch Windows full suite, expanded Node compatibility, and PR Core
sequentially when validating the shared Windows/Linux host. The Windows job
checks that the requested host IP is present and logs only the Docker runner's
container ID, image ID, running state and hostname. Core Linux jobs record their
platform, architecture, hostname and checked-out revision. Match the Linux
hostname to the Windows Docker inspection before claiming the requested
execution location. These identity checks remain unverified until the candidate
workflows actually execute.

PR repository-hygiene validation runs in the guarded remote Linux `lint` job,
including documentation-only changes. Its checkout and Node prerequisites run
for every admitted PR; JavaScript lint and dependency installation retain their
path conditions. Hosted classification computes routing outputs only.

Required ruleset check names remain unchanged. The historical
`tarball smoke (ubuntu-latest)` context now executes in the remote Linux
container; the check name is retained for ruleset compatibility.

## Admission

This is a public repository. An operator-owned copy of
`scripts/ci-runner-admission.mjs` runs through
`ACTIONS_RUNNER_HOOK_JOB_STARTED` before checkout. The shell wrappers and admission
module live outside the job checkout and runner application directory. Keep
those deployed copies synchronized when changing the policy.

Admission requires matching repository metadata and allows only `push`,
`workflow_dispatch`, `schedule`, `release`, and pull requests whose base and head
both belong to this repository. Fork pull requests, `pull_request_target`,
unknown events, missing metadata and invalid event files fail before job steps.
Workflow job conditions independently exclude fork pull requests. Fork test
validation requires a separate isolated execution environment; these machines
do not run fork contributions.

The hook does not sandbox admitted code. Repository write access is therefore a
trust boundary. The Linux runner container has no Windows filesystem mounts or
Docker socket mount. Its workspace and GitHub-managed runner credentials stay
inside the dedicated container. Native macOS and Windows jobs run with their
configured local accounts.

## Installed locations and status

Local macOS:

```sh
cd /Users/cassio/.local/share/forgeloop-ci/macos
./svc.sh status
```

Windows PowerShell:

```powershell
Get-Service actions.runner.cassiomc1-forgeloop.forgeloop-windows-remote
docker inspect forgeloop-linux-remote --format '{{json .State}}'
docker logs --tail 40 forgeloop-linux-remote
```

The Windows runner is installed at `C:\forgeloop-ci\windows`. Its deployed hook
is `C:\forgeloop-ci\hooks\windows-admission.ps1`. Isolated runtimes live below
`C:\forgeloop-ci\runtime`; the runner environment includes portable Node, Git,
Bash and unzip. Runner service credentials are managed by Windows; no account
password belongs in repository files, job logs or shell scripts.

The Linux image is built from `.github/runner/Dockerfile` using the repository
root as its build context:

```sh
docker build -f .github/runner/Dockerfile -t forgeloop-actions-linux:2.337.0 .
```

The Node base image is pinned by digest. The GitHub runner archive is checked
against its published SHA-256 before extraction. System dependency packages are
resolved by the official runner dependency installer at build time; rebuilding
is not a claim of byte-identical package resolution. The deployed image and
runner version must be recorded with validation evidence.

Docker Desktop credential helpers can fail in a noninteractive WinRM session.
The dedicated `C:\forgeloop-ci\docker-config` uses an empty public Docker Hub auth
entry and the already-installed Docker Desktop CLI plugin directory. Commands
using that configuration target the existing Linux engine explicitly. They do
not modify the user's Docker credential store.

Registration tokens expire and must be obtained through an authorized GitHub
operator. Pass them transiently through `ACTIONS_RUNNER_INPUT_TOKEN`; do not
store registration tokens in Docker image layers, repository scripts or a
container's persistent environment. A stopped or offline runner is not evidence
that its checks passed.

## Verification boundary

Runner registration, admission probes, a native SQLite smoke, quick suites,
full core suites, MCP/package checks and GitHub workflow execution are separate
evidence dimensions. Record the source fingerprint and exact command for each
run. A workflow routing edit becomes externally verified only after GitHub
executes the affected jobs on these runners.

# Excluding old write clients during SQLite cutover

The original migration plan requires two distinct protections: version-aware clients must obey maintenance/storage markers, and older clients that cannot read those markers must be operationally stopped and excluded. A SQLite lock alone cannot stop a filesystem writer.

The disposable [old-client drill](../scripts/drill-storage-old-client-exclusion.mjs) runs actual code from pinned filesystem commit `ee9ce11123d4e728d3dbc92f5d62d4bf41bb79c5`. It clones the supplied Git checkout into a new temporary directory and creates a new temporary project. It never converts an existing project or modifies the supplied checkout.

```sh
node scripts/drill-storage-old-client-exclusion.mjs --legacy-root=/absolute/path/to/pinned-checkout
```

Use Node24.19 or newer with the repository's locked dependencies and Git available on PATH. A successful run emits one JSON result and then removes only its own disposable fixtures. The supplied checkout must clone to the pinned commit; an arbitrary current version is insufficient evidence of old-client behavior.

## Verified sequence

1. The pinned old CLI creates a task using the filesystem layout.
2. A separate process imports the pinned old lock implementation and acquires its actual project claims lock. The controller observes its IPC readiness and live PID.
3. Migration without an explicit quiescence assertion is refused. A separate native migration process with the assertion still refuses the real old lock and retains maintenance exclusion.
4. The controller requests graceful shutdown, observes exit0, verifies the old PID is absent, and verifies the failed native maintenance owner is also absent.
5. The operational permission boundary is installed before any capture/cutover. An attempted old CLI launch/write is refused by the OS.
6. The exact retained dead maintenance owner is adopted through the supported recovery API. Source capture, import, validation, archival and activation run under that owner; terminal verification returns `PUBLISHED` and `currentStateVerified:true`.
7. The old active task-state layout is absent. Another old-client launch/write is refused after cutover. The retained source inventory still matches every original file size and digest.
8. The current native API creates a new task. SQLite contains that task and no attempted old post-cutover task. Published-migration validation accepts the resulting three-task project, and the retained source inventory remains unchanged.

## Operational boundaries

| Environment | Disposable drill boundary | Production equivalent |
| --- | --- | --- |
| Docker Linux with root controller | Legacy Node processes run as UID65534; after shutdown the project belongs to the native UID0, with directories0755/files0644. The legacy identity cannot create its filesystem claims lock. | Separate service identities; revoke the old identity's project write access and stop/disable every old launch source. Root is a test controller, not a recommendation to run production as root. |
| Mac, or Linux without a root controller | Stop the old process, unlink the shared dependency symlink, then disable traversal of the cloned old installation with mode000. The old installation cannot be relaunched. | Retire every inventoried old installation and disable services, jobs, SDK hosts and restart sources before migrating. Keep the current installation separate. |
| Windows | Stop the old process, unlink the shared dependency junction, then deny read/execute on the cloned old installation to the old client's Windows SID, including explicit child entries. The old CLI subprocess removes backup/restore privileges from its own token before starting Node. | Retire every inventoried old installation and disable its services, scheduled tasks, runners and in-process SDK hosts. Use separate service identities/project ACLs where an old installation must remain available for other projects. |

The Windows drill uses documented [`icacls` save, recursive deny and restore operations](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls). It saves the original fixture ACLs and restores only its own temporary installation during cleanup. A Node source-read probe must actually return EACCES/EPERM; a missing dependency is not accepted as exclusion evidence. Removing the dependency junction before ACL propagation prevents the drill from modifying a shared dependency checkout.

These controls prove the named identity/installation boundary in the disposable fixture. They do not discover every old installation on a production host, stop a process that was not inventoried, or prevent a privileged operator from changing permissions. A cloned installation may still exist elsewhere. An already-running SDK host can retain loaded code even after its package is disabled; it must be stopped too. Do not equate a maintenance marker with any of these operational controls.

## Cutover procedure and retention

Inventory all CLI/package paths, global/npm/npx caches, SDK hosts, editors, background workers, self-hosted runners, services, scheduled jobs and remote entry points that can write this project. Record their versions, execution identities and restart sources. Stop all old processes and disable their restart sources. Verify process termination and permission/installation exclusion before asserting `--writers-quiesced`; an assertion does not perform those actions.

Run doctor/audit and supported legacy transaction reconciliation, then use the explicit storage migration command. Retain the captured source, source manifest, publication journal and archived old layout outside the active operational roots. Keep this retained source indefinitely until the project owner explicitly authorizes disposal after migration acceptance and any supported rollback/export validation; migration success never authorizes automatic deletion.

Allow only the current native installation/identity to resume writes. Verify a new native task and its ledger, then check the retained source inventory again. Re-enabling an old installation against this active project requires a new compatibility decision; it is not a normal restart.

Before the first native write, rollback may use the preserved source through the supported procedure. After native writes, restoring the old source would discard accepted work. Use a verified compatible reverse export or forward repair. This exclusion drill does not certify every downgrade target or the full interruption matrix.

### Windows privileged-reader control493

On the requested Administrator WinRM host, an actual file with an explicit deny-read ACE was readable through Node while PowerShell .NET reads were refused. The token reported backup/restore privileges enabled. This is consistent with libuv opening files with [backup semantics](https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c); an ACL alone does not establish exclusion for this privileged Node context.

The [Windows old-client subprocess wrapper](../scripts/lib/windows-old-client-token.ps1) uses [AdjustTokenPrivileges](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-adjusttokenprivileges) on its own disposable process token to remove SeBackupPrivilege and SeRestorePrivilege before starting the old Node process. It verifies that each privilege cannot be re-enabled in that token. No host account, policy, existing process or native controller token is changed. Production must likewise keep old write clients out of privileged bypass contexts; stopping and retiring privileged installations remains necessary. Windows497 now passes the full drill. Each attempted old launch has a fresh restricted-reader EPERM result and a byte-identical pinned source still readable by the privileged controller. Node masks denied entrypoint lookup as MODULE_NOT_FOUND; the harness accepts that only for the exact main entrypoint with an empty requireStack and those independent proofs. Missing dependency errors remain rejected. Final portable Docker Linux497 also passes with2496 source hashes unchanged before/after; Mac497 passes the same current script. Full raw results and admitted source hashes are published in [old-client-exclusion-497.json](../benchmarks/storage-sqlite/old-client-exclusion-497.json).

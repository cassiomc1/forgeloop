# Cloud Sync

Cloud sync moves a project's ForgeLoop state between machines. A task that
starts on a laptop can continue on another machine or in CI, without
re-creating it.

```bash
# Machine A, after its work is saved
forgeloop sync-push

# Machine B, in a fresh checkout of the same repository
forgeloop sync-pull --writers-quiesced
forgeloop task-list
```

## What it is, and what it is not

Cloud sync is a **single-writer snapshot handoff**, not live multi-machine
sync.

- `sync-push` creates an attachment-inclusive `storage-backup` of the whole
  project state, encrypts it on the machine, and uploads it as one snapshot
  per repository.
- `sync-pull` downloads the snapshot, decrypts and verifies it, and activates
  it only through the verified `storage-restore` path.
- Ledgers are never merged. When two machines change the same project, the
  later push is refused with `E_SYNC_CONFLICT` instead of overwriting the other
  machine's work.

## Configuration

| Variable | Purpose |
| --- | --- |
| `FORGELOOP_SYNC_TOKEN` | Bearer token for the sync remote. The remote stores only its SHA-256 hash and the repositories it may use. |
| `FORGELOOP_SYNC_KEY` | Encryption passphrase, at least 16 characters. It never leaves the machine; every machine that pulls needs the same value. |

Options shared by both commands:

- `--remote <url>`: the sync endpoint. The default is
  `https://forgeloop.monster/api/sync`. It must use `https`; `http` is allowed
  only for `localhost`.
- `--repo <owner/name>`: the repository the snapshot belongs to. The default
  comes from the GitHub `origin` remote.

Store both variables in a secret manager or CI secrets. ForgeLoop never writes
either of them to disk.

## Conflict rule

Each machine remembers the remote version (ETag) it last pushed or pulled. It
keeps this in `<config dir>/forgeloop/sync/`, outside the repository; the
config dir is `$XDG_CONFIG_HOME` or `~/.config`.

- The first push for a repository is create-only.
- Every later push must match the remembered version.
- After machine B pulls and pushes, machine A's next push is refused. A then
  adopts B's state with `forgeloop sync-pull --writers-quiesced --replace-active`.

`--replace-active` retains and archives the outgoing local state before
activation, as `storage-restore --replace-active` does.

## Security model

- **Encryption:** the snapshot is gzipped and encrypted with AES-256-GCM. The
  key is derived with scrypt (N=32768, r=8, p=1) from `FORGELOOP_SYNC_KEY` and a
  random salt. The repository name is authenticated data, so a snapshot cannot
  be replayed under another repository. The remote only stores ciphertext.
- **Untrusted pulls:** a pull is refused before anything is restored when:
  - the key is wrong or the data was tampered with;
  - the snapshot belongs to another repository;
  - a file path is unsafe or a file digest differs.

  The restore itself repeats the backup verification of `storage-restore`.
- **Writers:** `sync-pull` requires `--writers-quiesced`. Stop every ForgeLoop
  writer for the project first.
- **Size:** an encrypted snapshot is limited to 4 MiB.

The snapshot contains everything `storage-backup` contains, including ledger
events, command argv and output, and absolute paths from the pushing machine.
Anyone with both the token and the passphrase can read it. Treat the
passphrase like a credential.

## Hosted remote

The default remote is the forgeloop-site `/api/sync` Vercel function. It stores
one snapshot per repository in a private Vercel Blob store and writes it only
with an ETag precondition. Tokens are configured by the site owner as SHA-256
hashes, each scoped to a list of repositories.

## Errors

| Code | Meaning |
| --- | --- |
| `E_SYNC_CONFIG` | A token or passphrase is missing, or `--remote` or `--repo` is invalid. |
| `E_SYNC_UNAUTHORIZED` | The remote rejected the token for this repository. |
| `E_SYNC_CONFLICT` | The remote changed since this machine's last push or pull. |
| `E_SYNC_REMOTE` | The remote is unreachable, has no snapshot, or refused the request. |
| `E_SYNC_SNAPSHOT_INVALID` | The snapshot cannot be decrypted or failed integrity checks. |
| `E_SYNC_TOO_LARGE` | The encrypted snapshot exceeds 4 MiB. |

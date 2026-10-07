/**
 * ForgeLoop SQLite storage schema.
 *
 * This module owns DDL and schema versioning only. It performs no I/O against a
 * project and holds no connection state, so schema definitions can be imported
 * from tooling that must stay independent of the live store.
 *
 * Design constraints (see the SQLite migration plan):
 *   - Indexed relational fields carry identity, ordering, and lookup paths.
 *   - Nested protocol structures stay as schema-validated canonical JSON
 *     payloads instead of being normalized table by table.
 *   - Extracted columns and payloads are written in one storage operation and
 *     are never updated independently.
 *   - Foreign keys cover only relationships that are mandatory in the actual
 *     protocol. Audit history never cascades away from an explicit request.
 */

/** Shared verbatim so the partial index and reservation query have one predicate.
 * This index only identifies histories requiring conservative retention proof;
 * mutation authority still requires the complete canonical ledger validation.
 */
export const EVENT_RESERVATION_PROOF_PREDICATE = `CASE WHEN json_valid(event_json) = 0 THEN 1
        ELSE json_type(event_json) <> 'object'
          OR json_extract(event_json, '$.taskId') IS NOT task_id
          OR json_extract(event_json, '$.seq') IS NOT seq
          OR json_extract(event_json, '$.hash') IS NOT hash
          OR json_extract(event_json, '$.previousHash') IS NOT previous_hash
          OR json_extract(event_json, '$.at') IS NOT at
          OR json_extract(event_json, '$.event') IS NOT event_type
          OR json_extract(event_json, '$.event') IN
            ('CONTRACT_BOOTSTRAP_REPAIR_RECORDED', 'CONTRACT_BOOTSTRAP_REPAIR_MIGRATION_RECORDED')
        END`;

/** Bumped whenever required DDL changes incompatibly. */
export const STORAGE_SCHEMA_VERSION = 5;

/** Storage format marker recorded in `storage_meta` for cutover detection. */
export const STORAGE_FORMAT = "sqlite";
export const STORAGE_FORMAT_VERSION = 1;
export const STORAGE_RELATIVE_PATH = ".forgeloop/state.sqlite";

/**
 * Declarative migration list. Each entry is applied exactly once, in order, and
 * recorded in `storage_meta` so an existing database upgrades in place.
 */
export const SCHEMA_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: "initial-operational-store",
    statements: Object.freeze([
      // Singleton row describing this store. `id` is pinned to 1 so a second
      // writer cannot silently create a competing metadata row.
      `CREATE TABLE storage_meta (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         storage_version INTEGER NOT NULL,
         schema_version INTEGER NOT NULL,
         protocol_version INTEGER,
         project_identity TEXT,
         storage_format TEXT NOT NULL DEFAULT '${STORAGE_FORMAT}',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         import_provenance TEXT
       )`,

      // Task identity plus the two canonical snapshots that discovery reads.
      // `descriptor_json` and `state_json` are retained verbatim so the store
      // never becomes a lossy re-encoding of protocol state.
      `CREATE TABLE tasks (
         task_id TEXT PRIMARY KEY,
         task_key TEXT NOT NULL UNIQUE,
         phase TEXT,
         revision INTEGER,
         created_at TEXT,
         updated_at TEXT,
         descriptor_json TEXT NOT NULL,
         state_json TEXT
       )`,
      `CREATE INDEX tasks_phase_updated_idx ON tasks (phase, updated_at)`,

      // Normalized write claims. Directory, wildcard, and ancestor/descendant
      // overlap cannot be expressed as exact-path uniqueness, so callers must
      // still evaluate `claimsOverlap()` over the candidate rows returned here.
      `CREATE TABLE claims (
         task_id TEXT NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
         claim_norm TEXT NOT NULL,
         reservation_state TEXT NOT NULL DEFAULT 'ACTIVE',
         created_at TEXT,
         PRIMARY KEY (task_id, claim_norm)
       )`,
      `CREATE INDEX claims_norm_idx ON claims (claim_norm)`,

      // Canonical ledger. `event_json` stores the original event object exactly
      // as imported: historical events are never rehashed or rewritten.
      `CREATE TABLE events (
         task_id TEXT NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
         seq INTEGER NOT NULL,
         event_type TEXT NOT NULL,
         at TEXT,
         previous_hash TEXT,
         hash TEXT NOT NULL,
         event_json TEXT NOT NULL,
         PRIMARY KEY (task_id, seq)
       )`,
      `CREATE INDEX events_type_idx ON events (task_id, event_type, seq)`,

      // Task-local idempotency is enforced by the database rather than by a
      // directory scan, so a duplicate key cannot create two accepted actions.
      `CREATE TABLE actions (
         task_id TEXT NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
         action_id TEXT NOT NULL,
         idempotency_key TEXT,
         status TEXT,
         revision INTEGER,
         payload_json TEXT NOT NULL,
         PRIMARY KEY (task_id, action_id)
       )`,
      `CREATE UNIQUE INDEX actions_idempotency_idx ON actions (task_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
      `CREATE INDEX actions_status_idx ON actions (task_id, status)`,

      `CREATE TABLE approvals (
         task_id TEXT NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
         approval_id TEXT NOT NULL,
         action_id TEXT,
         decision TEXT,
         payload_json TEXT NOT NULL,
         PRIMARY KEY (task_id, approval_id)
       )`,
      `CREATE INDEX approvals_action_idx ON approvals (task_id, action_id)`,

      `CREATE TABLE executions (
         task_id TEXT NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
         execution_id TEXT NOT NULL,
         check_id TEXT,
         verification_cycle INTEGER,
         payload_json TEXT NOT NULL,
         PRIMARY KEY (task_id, execution_id)
       )`,
      `CREATE INDEX executions_check_idx ON executions (task_id, check_id, verification_cycle)`,

      // Generic typed artifact store. Replaceable current snapshots use a
      // fixed artifact_id; immutable history uses distinct IDs. Optional
      // artifacts stay absent until created rather than being pre-seeded.
      `CREATE TABLE task_artifacts (
         task_id TEXT NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
         kind TEXT NOT NULL,
         artifact_id TEXT NOT NULL,
         payload_json TEXT NOT NULL,
         fingerprint TEXT NOT NULL,
         PRIMARY KEY (task_id, kind, artifact_id)
       )`,
      `CREATE INDEX task_artifacts_kind_idx ON task_artifacts (kind)`,

      // Session activation markers. Kept optional so a project can adopt the
      // store before every session reader is migrated.
      `CREATE TABLE sessions (
         session_id TEXT PRIMARY KEY,
         task_id TEXT REFERENCES tasks (task_id) ON DELETE SET NULL,
         activation_json TEXT NOT NULL
       )`,
      `CREATE INDEX sessions_task_idx ON sessions (task_id)`,
    ]),
  }),
  Object.freeze({
    version: 2,
    name: "artifact-byte-evidence",
    statements: Object.freeze([
      "ALTER TABLE task_artifacts ADD COLUMN source_json TEXT",
      "ALTER TABLE task_artifacts ADD COLUMN byte_digest TEXT",
    ]),
  }),
  Object.freeze({
    version: 3,
    name: "canonical-activation-selection",
    statements: Object.freeze([
      "ALTER TABLE storage_meta ADD COLUMN active_session_id TEXT REFERENCES sessions(session_id)",
    ]),
  }),
  Object.freeze({
    version: 4,
    name: "execution-reference-lookup",
    statements: Object.freeze([
      "CREATE INDEX executions_reference_idx ON executions (execution_id, task_id)",
    ]),
  }),
  Object.freeze({
    version: 5,
    name: "immutable-attachment-references",
    statements: Object.freeze([
      `CREATE TABLE attachment_references (
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        reference_id TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL CHECK(size >= 0),
        sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
        PRIMARY KEY(task_id, reference_id)
      )`,
      "CREATE INDEX attachment_references_path_idx ON attachment_references(path)",
    ]),
  }),

]);

/** All DDL required to build a current store from empty, in order. */
export const SCHEMA_STATEMENTS = Object.freeze(
  SCHEMA_MIGRATIONS.flatMap((migration) => [...migration.statements]),
);

/** Additive performance indexes: their absence cannot change domain outcomes.
 * Writable admission installs them without changing the marker-bound format.
 */
export const OPTIONAL_STORAGE_INDEXES = Object.freeze([Object.freeze({
  name: "events_reservation_proof_idx",
  statement: `CREATE INDEX IF NOT EXISTS events_reservation_proof_idx ON events(task_id) WHERE ${EVENT_RESERVATION_PROOF_PREDICATE}`,
})]);

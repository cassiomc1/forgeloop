---
name: sql-development-eng
language: en
description: "Specialist overlay guidance for SQL schemas, queries, migrations, and database-boundary changes."
version: "2026.09"
last-reviewed: "2026-09-12"
guide-id: sql
requires-gates:
  - threat-boundary
completion-evidence:
  - sql-validation
---

# SQL Development Engineering Guide

## Mission and activation

Use this guide as an overlay for a directly affected meaningful SQL artifact,
or a bounded SQL statement in an owned `db`, `database`, `migration`,
`migrations`, `schema`, or `sql` directory. SQL has no universal package
manifest and normally composes with the host specialist: Java + SQL, Go + SQL,
PHP + SQL, Node.js + SQL, and Rust + SQL are valid same-root outcomes.

Comments, quoted literals, prose, connection strings, driver dependencies,
database images, empty files, generated output, and vendored SQL do not
activate this guide. Detection masks lexical noise, reads bounded text, and
never connects to a database, executes a query, applies a migration, reads
credentials, or introspects a schema.

## Authority and precedence

The repository's database engine, version, migration policy, transaction model,
compatibility window, and deployment process win over generic SQL advice. Use
the matching engine's official reference first, then ISO/IEC 9075:2023 for
portable semantics. The research snapshot covers PostgreSQL 18.6, MySQL 9.7
Innovation and 8.4 LTS, SQL Server 17 T-SQL, Oracle AI Database 26, and
SQLite; these are reference points, not automatic upgrade targets.

Never infer a dialect, isolation guarantee, identifier rule, timestamp
behavior, JSON extension, or migration capability from a file extension.

## Schema and query architecture

Keep schema ownership, migrations, queries, repositories, domain rules, and
transport boundaries explicit. Parameterize values and allowlist identifiers,
sort directions, and dynamic clauses. Review joins, NULL semantics, collation,
encoding, numeric precision, time zones, recursive queries, constraints,
indexes, views, triggers, stored procedures, and query result cardinality.

Treat query output as untrusted input to application code. Preserve a clear
mapping between database types and application types and record compatibility
when a rolling deployment observes old and new schemas simultaneously.

## Transactions, errors, and operations

Define transaction ownership, isolation, locking, deadlock/retry behavior,
timeouts, savepoints, idempotency, and commit boundaries. Do not retry a
non-idempotent mutation without a durable operation key. Preserve database
error causes while redacting credentials, connection details, user data, and
queries from logs and responses.

Migrations must be reviewed for locking, backfill cost, indexes, constraints,
data loss, rollback or roll-forward strategy, concurrent deploys, long-lived
readers, and observability. A migration that parses successfully is not proof
that it is safe to run in production.

## Security and performance

Prevent injection through parameters and strict identifier composition. Apply
authorization at the domain boundary, least-privilege database roles, secret
rotation, TLS policy, audit controls, and data-retention rules. Bound query
time, rows, result bytes, connections, concurrency, retries, and transaction
duration. Measure query plans and representative workloads before adding
indexes, hints, denormalization, caching, or batching.
Treat `EXPLAIN ANALYZE` as potentially executing the statement; use a safe
transaction or a representative read-only environment when the engine allows.

## Portability and dependencies

Keep dialect-specific syntax explicitly marked and test the actual production
engine/version. Do not replace a repository's migration tool, driver, schema
policy, or transaction abstraction incidentally. Database drivers, ORM names,
package managers, containers, and CI setup are supporting context, not public
SQL framework IDs.

## Verification and Definition of Done

Run SQL lint/parser checks, unit and integration tests against the declared
engine/version, migration dry runs, compatibility checks, rollback or
roll-forward tests, query-plan review, and security checks as applicable.
Record exact dialect, version, schema state, fixtures, and command results.
Production migration execution and database readiness require separate
operator evidence. ForgeLoop performs bounded structural SQL-overlay analysis,
not dialect parsing, query planning, schema introspection, or migration
execution.

## Official sources

- [SQLite SQL language](https://www.sqlite.org/lang.html)
- [PostgreSQL documentation](https://www.postgresql.org/docs/)
- [MySQL reference manuals](https://docs.oracle.com/cd/E17952_01/mysql-8.0-en/)
- [Microsoft T-SQL reference](https://learn.microsoft.com/sql/t-sql/)
- [Oracle Database SQL Language Reference](https://docs.oracle.com/en/database/oracle/oracle-database/)

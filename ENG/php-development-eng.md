---
name: php-development-eng
language: en
description: "Specialist guidance for production PHP applications, Composer packages, web services, and command-line workers."
version: "2026.09"
last-reviewed: "2026-09-12"
guide-id: php
requires-gates:
  - threat-boundary
completion-evidence:
  - php-validation
---

# PHP Development Engineering Guide

## Mission and activation

Use this guide for PHP applications, web services, packages, workers, and
command-line tools. A valid bounded `composer.json` with package, requirement,
or autoload identity is primary evidence. A directly claimed executable PHP
file may provide bounded fallback evidence. `composer.lock`, `vendor/`, a PHP
version string, an extension package, Docker/CI setup, static HTML, a README,
and dependency names alone do not establish a PHP project.

ForgeLoop parses Composer JSON and checks a claimed source file conservatively;
it never runs PHP, Composer scripts/plugins, autoload generation, package
resolution, or project code, and it does not access the network.

## Authority and precedence

Repository PHP/Composer constraints, runtime platform, extensions, deployment
model, and compatibility policy win over generic advice. Then use the matching
official PHP manual/migration guide, Composer documentation, and
version-matched framework documentation. The 2026-09 plan snapshot records PHP
8.5.10 as a current reference and supported branches 8.2–8.5; neither changes
the repository runtime constraint automatically.

Keep PHP language version, engine/runtime, extensions, Composer platform
requirements, production SAPI, CLI runtime, framework minimum, and deployment
image separate. A Composer package is not necessarily a web application.

## Composer and project discovery

Review `name`, `type`, `require`, `autoload`, `autoload-dev`, and package
identity structurally. Composer scripts, plugins, installers, generated
autoload files, `vendor/`, registry packages, VCS repositories, and platform
resolution remain execution/dependency context. Preserve lockfile policy and
do not edit generated/vendor content as if it were application source.

PHP extensions deserve special care: an extension or C-extension package may
compose with the C specialist, but does not imply PHP implementation. Keep
Composer-less source fallback limited to owned files with an executable
`<?php` opening tag and do not promote generated/vendor trees.

## Architecture and language semantics

Keep HTTP/CLI transport, domain, persistence, templates, jobs, and external
service adapters separate where the repository does. Review namespaces,
autoloading, visibility, traits, interfaces, inheritance, attributes,
generators, closures, strict comparisons, coercion, nullability, union/intersection
types, exceptions, serialization, and backward compatibility.

`declare(strict_types=1)` is a per-file call-site rule, not a repository-wide
runtime validation guarantee. Validate decoded JSON, requests, environment,
database rows, files, and queue messages at runtime before use.

## Errors, I/O, and security

Preserve exception causes and distinguish retryable, validation, authorization,
operational, and terminal failures. Bound uploads, request bodies, output,
queues, database connections, queries, transactions, subprocesses, and worker
concurrency. Treat templates, SQL, filesystem paths, commands, serialized
objects, sessions, cookies, credentials, and user input as hostile. Keep
authentication, authorization, CSRF, secret handling, SSRF, deserialization,
and log redaction explicit and tested.

## Performance, portability, and dependencies

Measure request latency, memory, opcode/cache behavior, queueing, database
plans, and worker throughput before optimizing. Keep timezone, locale, charset,
filesystem, SAPI, process model, extension ABI, and container assumptions
explicit. Review Composer licenses, lockfile reproducibility, update scripts,
and production-install behavior without executing hooks during routing.

## Verification and Definition of Done

Run focused PHPUnit or repository tests, static analysis, coding standards,
security checks, migration/database compatibility checks, and clean production
installation for the exact PHP, extensions, Composer lockfile, and SAPI.
Record commands and unavailable tools as `NOT_VERIFIED`. Completion requires
tested trust boundaries, failure paths, resource limits, compatibility, and
observability. ForgeLoop performs bounded structural Composer/PHP analysis; it
does not implement PHP execution, Composer resolution, autoload generation, or
plugin behavior.

## Official sources

- [PHP manual](https://www.php.net/manual/en/)
- [PHP supported versions](https://www.php.net/supported-versions.php)
- [PHP migration guides](https://www.php.net/migration85)
- [Composer documentation](https://getcomposer.org/doc/)
- [Composer schema](https://getcomposer.org/doc/04-schema.md)
- [OWASP PHP security guidance](https://owasp.org/www-project-top-ten/)

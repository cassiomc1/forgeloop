---
name: python-development-eng
language: en
description: "Specialist guidance for production Python applications, libraries, command-line tools, data pipelines, and native extensions."
version: "2026.09"
last-reviewed: "2026-10-13"
guide-id: python
requires-gates:
  - threat-boundary
completion-evidence:
  - python-validation
---

# Python Development Engineering Guide

## Mission and activation

Use this guide for Python applications, libraries, command-line tools, build
and automation scripts, data pipelines, and CPython extensions. Confirm the
actual project from owned `.py` files and its packaging/build metadata, such as
`pyproject.toml`, `setup.cfg`, `setup.py`, or a declared requirements file.
Do not infer Python project identity from documentation, editor settings,
Jupyter output, a Python executable used only by CI, or a transitive package.

This guide is based on the official Python 3.15.0 documentation. Python 3.15.0
was released as a stable release on 2026-10-09. Its release highlights include
the `sentinel` and `frozendict` built-ins, UTF-8 as the default encoding,
unpacking in comprehensions, and explicit lazy imports. Treat each feature as
version-gated: verify its exact semantics and availability in the project's
target version before using it. The project interpreter and support policy
always take precedence over the newest release.

## Authority and version boundaries

Resolve conflicts in this order:

1. Platform and safety requirements.
2. The user's explicit request.
3. Repository instructions, supported interpreter range, dependency lock,
   packaging metadata, tests, and deployment configuration.
4. This guide.
5. The version-matched official Python documentation and PEPs.
6. Framework, packaging-tool, and community examples.

Keep separate the CPython or alternative implementation version, Python
language compatibility, minimum supported version, build interpreter,
runtime interpreter, ABI (including free-threaded builds), platform, and
dependency resolver. `requires-python`, classifiers, tox/nox matrices, CI,
containers, and deployment manifests may express different constraints;
reconcile them rather than choosing one by recency. Python 3.15.0 is a
reference point, not an automatic upgrade target.

## Project discovery and packaging

Inspect the narrowest complete project boundary:

- `pyproject.toml`, including `[build-system]`, `[project]`, tool-specific
  tables, and workspace configuration;
- `requires-python`, build backend, package discovery, entry points, optional
  dependencies, extras, and dynamic metadata;
- lockfiles and the exact tool that owns each one (`uv.lock`, Poetry, PDM,
  Pipenv, or another declared workflow);
- `src/`, package modules, `__init__.py`, namespace-package layout, scripts,
  tests, fixtures, generated code, and vendored files;
- `tox.ini`, `noxfile.py`, `pytest.ini`, `setup.cfg`, `setup.py`, and
  requirements files when present;
- CI interpreter matrices, container images, deployment commands, native
  libraries, and platform-specific build steps.

Do not execute package build hooks, project imports, setup scripts, arbitrary
`pyproject.toml` backends, or test collection during static discovery. Do not
install tools or dependencies merely to answer a routing or documentation
question. Preserve the repository's package manager and lockfile strategy.
Avoid adding a second environment manager or migrating packaging metadata as
incidental cleanup.

## Python semantics and API design

Prefer explicit, unsurprising behavior over clever metaprogramming. Keep
mutable defaults out of function signatures; use immutable values or create
fresh state inside the function. Distinguish identity from equality, shallow
from deep copying, and iteration from materialization. Make generators,
context managers, descriptors, decorators, metaclasses, and dynamic imports
serve a concrete need and document non-obvious lifetime or execution behavior.

Use annotations to communicate contracts, not as runtime validation. Preserve
the project's typing style and supported-version constraints when choosing
built-in generics, unions, protocols, overloads, `TypedDict`, generics,
`TypeVar`, `ParamSpec`, or `Self`. Treat `Any`, casts, ignores, and
`# type: ignore` as explicit escapes; narrow untrusted values with runtime
checks at boundaries. Keep public annotations and stubs compatible with the
declared interpreter range and type checker.

Prefer cohesive modules and explicit imports. Avoid import-time network,
filesystem, process, or service side effects. Keep module initialization
predictable and make circular dependencies visible rather than masking them
with local imports without a clear reason.

## Errors, resources, and concurrency

Raise specific exceptions with useful context and preserve causal chains with
`raise ... from ...` when translating failures. Do not swallow broad
exceptions, return ambiguous sentinels, or expose secrets and internal paths
in public errors. Use `finally`, context managers, or structured cleanup for
files, sockets, locks, temporary directories, subprocesses, and transactions.

Use `asyncio` only when the workload and dependencies benefit from concurrent
I/O. Keep blocking work off the event loop, propagate cancellation, bound
queues and fan-out, set timeouts, and close tasks and clients during shutdown.
Choose threads, processes, native extensions, or free-threaded Python from
measured workload and dependency compatibility. Do not assume that the GIL
provides application-level synchronization or that releasing it makes shared
state safe.

## Security and trust boundaries

Treat request data, files, environment variables, serialized objects, SQL,
templates, archive members, subprocess arguments, plugin metadata, and network
responses as untrusted. Validate type, size, encoding, and allowed values
before use. Prefer parameterized SQL and argument arrays; avoid shell
interpolation, unsafe YAML loaders, `eval`, `exec`, and untrusted `pickle`
deserialization. Apply archive path containment and decompression limits.

Keep secrets out of source, exceptions, tracebacks exposed to users, test
fixtures, and logs. Bound file and request sizes, recursion, concurrency,
memory, CPU-heavy parsing, retries, and subprocess lifetimes. Use maintained
dependencies with a recorded source and lock; review build backends and
installation plugins as executable supply-chain code.

## Testing and verification

Select checks from risk and the project's declared tools:

- unit tests for pure behavior and boundary cases;
- integration tests for filesystem, database, network, subprocess, and
  framework behavior;
- contract tests for public APIs, serialization, CLI behavior, and supported
  Python versions;
- concurrency and cancellation tests for async tasks, workers, and shared
  resources;
- static typing and linting with the repository's configured tools;
- packaging and installation checks in a clean environment when packaging
  changes.

Test malformed, empty, oversized, duplicated, reordered, and unexpected
inputs; failure cleanup; cancellation; retries; and resource closure where
applicable. Do not test only private implementation details. Keep tests
deterministic, isolate external services, and do not claim skipped or
unavailable platform checks passed. Record the exact interpreter, command,
environment, and result.

## Performance and operations

Profile representative workloads before optimizing. Measure the relevant
latency, throughput, memory, startup, allocation, and queue behavior with the
same interpreter build, dependency set, input, and environment before and
after a change. Avoid speculative micro-optimization and unbounded caches.

Expose useful structured logs and metrics without logging secrets or
high-cardinality user data. Make readiness, graceful shutdown, worker
ownership, retry policy, and idempotency explicit for services and jobs.
Document interpreter and OS support, native dependencies, environment
variables, migration steps, and rollback behavior for deployable applications.

## Python 3.15 compatibility review

When adopting Python 3.15 features, verify the corresponding section of the
versioned documentation and test the minimum supported interpreter. In
particular:

- explicit lazy imports change when import work and import errors occur;
- UTF-8 default encoding can expose code that relied on locale-dependent
  defaults;
- comprehension unpacking and new built-in types may not parse or exist on
  older supported interpreters;
- experimental JIT or interpreter configuration is not a production
  performance guarantee; benchmark the actual deployment build;
- C API, ABI, build, deprecation, and removal changes require a separate
  extension and dependency compatibility review.

Do not copy preview-only behavior or assume that a 3.15 feature is available
in every implementation or distribution build.

## Definition of done

- The project boundary, interpreter range, packaging tool, and target
  platforms are confirmed from repository evidence.
- The change preserves supported Python versions and public package/API
  behavior, or documents an intentional migration.
- Trust boundaries, exceptions, cancellation, and resource cleanup are
  handled for the changed path.
- Focused tests, configured static checks, and relevant package/build checks
  pass; unavailable checks are `NOT_VERIFIED`.
- Documentation describes the tested behavior and exact Python compatibility
  range.

## Official sources

- [Python 3.15.0 documentation](https://docs.python.org/release/3.15.0/)
- [What's New in Python 3.15](https://docs.python.org/3.15/whatsnew/3.15.html)
- [Python version status](https://devguide.python.org/versions/)
- [Python Enhancement Proposals](https://peps.python.org/)
- [Python Packaging User Guide](https://packaging.python.org/)
- [Python typing documentation](https://docs.python.org/3/library/typing.html)
- [Python asyncio documentation](https://docs.python.org/3/library/asyncio.html)

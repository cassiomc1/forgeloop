# Ripwire fixture provenance

These fixtures are synthetic and are used to exercise the adapter boundary
without installing Ripwire. They model the flat `sigs` JSON shape observed in
the pinned upstream source revision
`93c8edaafdb5499e89939cc2cebd0429e278e86f`; no fixture claims to be output
captured from a real binary.

`fake-ripwire.mjs` accepts `--version` and a single `--for=<query>` argument.
Queries containing the documented test markers produce deterministic valid,
malformed, overflow, timeout, unsafe-path, duplicate, and secret-like cases.
Tests invoke it through `process.execPath` using a private spawn seam. The
real-binary smoke test is separate and runs only when the host supplies both
`FORGELOOP_TEST_RIPWIRE_PATH` and `FORGELOOP_TEST_RIPWIRE_VERSION`.

The checked upstream command reference describes `--for --json`,
`--signatures-only`, `--no-cache`, and the `--exclude` option. Actual binary
availability, checksum, platform, and interoperability remain unverified
until that opt-in test is run.

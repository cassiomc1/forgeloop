# Test intelligence

ForgeLoop discovers test units deterministically and assigns stable IDs from
framework, path, suite, and normalized name. Utility analysis is non-evidence
data. The task-bound utility command sends bounded batches of actual test
metadata (including source summary, target file, framework, signals, and
available runtime/branch fields) to canonical Jev `TEST_UTILITY` decisions.
Each test receives its own bounded semantic judgment. Protected or
contract-linked tests are never prune-authorized, and missing or low-confidence
utility remains blocked.

An unprotected semantic duplicate with sufficient confidence is classified as a
`REDUNDANT_CANDIDATE` and may reach the isolated `PROBE_REMOVAL` stage. The
probe is non-destructive and does not authorize deletion; protected tests,
low-confidence candidates, unknown utility, and candidates requiring a second
review remain blocked or retained.

`test-utility` writes only `test-utility.json` under the task namespace. It
does not delete tests, alter completion evidence, or authorize external work.

`npm run benchmark:test-intelligence` exercises the real utility classifier on
a deterministic labeled fixture for redundancy, obsolescence, protected-test
false positives, and deletion safety. It reports precision and recall from the
classifier's observed output against the labeled fixture and never grants
deletion authority.

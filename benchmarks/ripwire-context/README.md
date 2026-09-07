# Ripwire context benchmark

This benchmark compares six fixed task-shaped retrieval cases against a small
lexical baseline. The case file is the source of truth for the natural query,
baseline terms, expected files, and pinned ForgeLoop commit. Expected files
were selected from source inspection before running Ripwire; they are not
derived from Ripwire output.

## Preconditions

- Use a clean checkout whose `HEAD` exactly matches the `commit` in
  `cases.json`.
- Supply an already installed Ripwire executable with an exact host-qualified
  version.
- Do not reset, modify, or install anything in the checkout to make the
  benchmark run.
- Keep the adapter in `--no-cache` mode for every run.

## Commands

From the ForgeLoop repository root:

```bash
node scripts/benchmark-ripwire-context.mjs \
  --project /absolute/path/to/forgeloop \
  --ripwire-path /absolute/path/to/ripwire \
  --version 0.3.8 \
  --cases benchmarks/ripwire-context/cases.json \
  --runs 5 \
  --json
```

Use `--output /absolute/path/report.json` when a durable report is wanted.
The script uses native argv arrays for both `git` and `rg`; it does not invoke a
shell and it never writes ForgeLoop lifecycle state.

## Measurements

The baseline runs each predefined `rg` term from the fixture root, excludes
`.git` and `.forgeloop`, keeps a stable sorted file set, and reads at most the
first 32 KiB of each matched file. The adapter runs one public
`recallAdvisoryContext` per repetition and counts only normalized source
references. Transport stdout/stderr bytes are recorded separately through an
internal observation hook. The report gives minimum, median, and maximum
latency, plus expected files found/missed and irrelevant references for every
case and every repetition.

Case-level `expectedFound` contains files found on every repetition. The
`observedAcrossRuns` field is informational and does not turn alternating
results into a complete retrieval claim.

Five runs provide a median and range, not a tail-latency claim. A case where
the baseline finds a file that Ripwire misses is retained as a loss. Bytes are
reported as bytes; they are not converted into ForgeLoop usage tokens or cost.

## Result states

- `OBSERVED`: all preconditions passed and the paired measurements completed.
- `NOT_VERIFIED`: a path/version was missing, the checkout was dirty, the
  commit differed, the executable failed, or the cases could not be loaded.

`NOT_VERIFIED` is an honest availability result, not evidence of a speedup or
of successful real-binary interoperability.

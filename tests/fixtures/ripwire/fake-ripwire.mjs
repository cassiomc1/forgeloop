#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("ripwire 0.3.8 (fixture)\n");
  process.exitCode = 0;
} else {
  const forArgument = args.find((argument) => argument.startsWith("--for="));
  const query = forArgument ? forArgument.slice("--for=".length) : "";

  if (query.includes("__hang__")) {
    setInterval(() => {}, 1000);
  } else if (query.includes("__flood_stdout__")) {
    process.stdout.write("x".repeat(1024 * 1024 + 4096));
  } else if (query.includes("__flood_stderr__")) {
    process.stderr.write("x".repeat(64 * 1024 + 4096));
    process.stdout.write(JSON.stringify({ sigs: [] }));
  } else if (query.includes("__invalid_json__")) {
    process.stdout.write("{");
  } else if (query.includes("__exit_failure__")) {
    process.stderr.write("fixture failure detail must never be copied into an adapter error\n");
    process.exitCode = 7;
  } else if (query.includes("__wrong_shape__")) {
    process.stdout.write(JSON.stringify({ task: query, unexpected: true }));
  } else {
    const row = {
      l: 10,
      n: "rejectStaleHandoff",
      p: "src/handoff.js",
      r: 1,
      k: 0.91,
      sig: query.includes("__argv__")
        ? `function readQuery() { return ${JSON.stringify(`query=${query}`)}; }`
        : "function rejectStaleHandoff(snapshot, current) { return snapshot !== current; }",
    };
    const secondRow = {
      l: 22,
      n: "acceptHandoff",
      p: "src/handoff.js",
      r: 2,
      k: 0.63,
      sig: "function acceptHandoff(handoff) { return handoff.id; }",
      ambiguous: query.includes("__ambiguous__"),
    };
    let sigs = [row, secondRow];
    const metadata = {
      at: "fixture+dirty",
      task: query,
      route: "fixture-ranked",
      confidence: "medium",
      margin_pct: 12,
      kept: sigs.length,
      scored: sigs.length,
      corpus: 42,
      bundle: "sigs",
      lens: "compose,lego,routes,docs",
      sigs_total: sigs.length,
      sigs_shown: sigs.length,
      sigs_capped: false,
      unindexed: query.includes("__unindexed__") ? "docs/unknown.md" : undefined,
      ambiguous: query.includes("__ambiguous__") ? 1 : undefined,
      unresolved: query.includes("__unresolved__") ? 1 : undefined,
    };

    if (query.includes("__empty__")) {
      sigs = [];
      metadata.sigs_total = 0;
      metadata.sigs_shown = 0;
    }
    if (query.includes("__truncated__")) {
      metadata.sigs_total = 12;
      metadata.sigs_shown = 2;
      metadata.sigs_capped = true;
      metadata.capped = true;
    }
    if (query.includes("__duplicate__")) sigs = [row, row, secondRow];
    if (query.includes("__secret__")) row.sig = "authorization: Bearer fixture-secret-token";
    if (query.includes("__unsafe__")) {
      sigs = [
        { l: 1, n: "outside", p: "../outside.js", sig: "function outside() {}" },
        { l: 2, n: "absolute", p: "/tmp/outside.js", sig: "function absolute() {}" },
      ];
    }
    if (query.includes("__wrong_version__")) metadata.route = "fixture-version-query";
    if (query.includes("__budget__")) {
      sigs = Array.from({ length: 20 }, (_, index) => ({
        l: index + 1,
        n: `candidate${index}`,
        p: `src/candidate-${index}.js`,
        r: index + 1,
        sig: "function candidate() { return 'bounded'; }",
      }));
      metadata.sigs_total = sigs.length;
      metadata.sigs_shown = sigs.length;
    }

    process.stdout.write(JSON.stringify({ ...metadata, sigs }));
  }
}

#!/usr/bin/env node
import { runJevBenchmark, runJevBenchmarkLive } from "../src/core/decision/benchmarks.js";

const result = process.argv.includes("--live") ? await runJevBenchmarkLive() : runJevBenchmark();
console.log(JSON.stringify(result, null, 2));

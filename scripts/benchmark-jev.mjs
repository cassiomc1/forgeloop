#!/usr/bin/env node
import { runJevBenchmark } from "../src/core/decision/benchmarks.js";

console.log(JSON.stringify(runJevBenchmark(), null, 2));


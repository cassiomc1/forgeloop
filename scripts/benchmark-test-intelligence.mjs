#!/usr/bin/env node
import { runTestIntelligenceBenchmark } from "../src/core/test-intelligence/benchmarks.js";

console.log(JSON.stringify(runTestIntelligenceBenchmark(), null, 2));

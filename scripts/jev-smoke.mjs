#!/usr/bin/env node
import { DECISION_DEFAULT_POLICY } from "../src/core/decision/constants.js";
import { createTypesafeEngine } from "../src/adapters/typesafe/engine.js";

const engine = createTypesafeEngine({ policy: DECISION_DEFAULT_POLICY });
const result = await engine.health();
console.log(JSON.stringify({
  status: result.status === "missing" ? "NOT_RUN" : result.status,
  engine: result.engine,
  model: result.model,
  ...(result.errorCode ? { errorCode: result.errorCode } : {}),
}, null, 2));
if (result.status !== "healthy" && result.status !== "missing") process.exitCode = 1;

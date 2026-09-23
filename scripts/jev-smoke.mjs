#!/usr/bin/env node
import { DECISION_DEFAULT_POLICY } from "../src/core/decision/constants.js";
import { createTypesafeEngine } from "../src/adapters/typesafe/engine.js";

const engine = createTypesafeEngine({ policy: DECISION_DEFAULT_POLICY });
const result = await engine.health();
const status = result.status === "missing" ? "NOT_RUN" : result.status;
console.log(JSON.stringify({
  status,
  provider: result.engine,
  model: result.model,
  ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
  ...(result.usage ? { usage: result.usage } : {}),
  ...(result.errorCode ? { errorCode: result.errorCode } : {}),
  ...(result.providerErrorType ? { providerErrorType: result.providerErrorType } : {}),
  ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}),
  ...(result.requestId ? { requestId: result.requestId } : {}),
}, null, 2));
if (status !== "healthy" && status !== "NOT_RUN") process.exitCode = 1;

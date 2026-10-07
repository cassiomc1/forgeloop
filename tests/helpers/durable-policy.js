import { ensureFixtureTask } from "./native-storage-fixture.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  computePersistedPolicyLockData,
  loadEffectiveRules,
  readBaseline,
  writePolicyLock,
} from "../../src/core/policy-engine.js";
import { readCapabilityPolicyIdentity } from "../../src/core/capability-policy.js";
import { writeTaskPolicySnapshot } from "../../src/core/policy-engine.js";

/**
 * Seed a complete, internally consistent capability-policy epoch:
 * capabilities.json + a persisted lock that binds it + a task policy
 * snapshot carrying the same identity. Durable-action authorization
 * requires all three to agree before any side effect.
 */
export async function seedPolicyEpoch(target, packageRoot, taskId, capabilityPolicy) {
  await ensureFixtureTask(target, taskId, packageRoot);
  await mkdir(path.join(target, ".forgeloop", "policy"), { recursive: true });
  await writeFile(
    path.join(target, ".forgeloop", "policy", "capabilities.json"),
    JSON.stringify(capabilityPolicy),
    "utf8",
  );
  const rules = await loadEffectiveRules(target, packageRoot);
  const baseline = (await readBaseline(target, packageRoot)) ?? { schemaVersion: 1, entries: [] };
  const lock = await computePersistedPolicyLockData(target, packageRoot, rules, baseline);
  await writePolicyLock(target, lock, packageRoot);
  const identity = await readCapabilityPolicyIdentity(target, packageRoot);
  await writeTaskPolicySnapshot(target, taskId, {
    schemaVersion: 1,
    policyDigest: lock.digest,
    rules,
    baseline,
    baselineDigest: lock.baselineDigest,
    ...(identity.digest
      ? {
        capabilityPolicyDigest: identity.digest,
        capabilityPolicyFingerprint: identity.fingerprint,
      }
      : {}),
    capturedAt: new Date().toISOString(),
  }, packageRoot);
  return { lock };
}

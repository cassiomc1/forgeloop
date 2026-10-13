import assert from "node:assert/strict";

function assertFiniteNumber(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.equal(Number.isFinite(value), true, `${label} must be finite`);
}

function assertNonNegativeFiniteNumber(value, label) {
  assertFiniteNumber(value, label);
  assert.equal(value >= 0, true, `${label} must be non-negative`);
}

function assertNonNegativeInteger(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.equal(Number.isSafeInteger(value), true, `${label} must be a safe integer`);
  assert.equal(value >= 0, true, `${label} must be non-negative`);
}

function assertObject(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

export function assertTimingSamples(samples, label) {
  assert.ok(Array.isArray(samples), `${label} must be an array`);
  samples.forEach((value, index) => assertNonNegativeFiniteNumber(value, `${label}[${index}]`));
}

function assertLinuxOperationRss(value, label) {
  assertObject(value, label);
  assert.equal(value.method, "procfs VmHWM reset via clear_refs=5 before each operation", `${label}.method is unsupported`);
  assertNonNegativeFiniteNumber(value.rssAtResetBytes, `${label}.rssAtResetBytes`);
  assertNonNegativeFiniteNumber(value.rssAfterBytes, `${label}.rssAfterBytes`);
  assertNonNegativeFiniteNumber(value.operationWindowPeakRssBytes, `${label}.operationWindowPeakRssBytes`);
  assert.equal(typeof value.accounting, "string", `${label}.accounting must be a string`);
}

function assertFileEndpoint(value, label) {
  assertObject(value, label);
  assertNonNegativeFiniteNumber(value.databaseBytes, `${label}.databaseBytes`);
  assertNonNegativeFiniteNumber(value.walBytes, `${label}.walBytes`);
}

export function assertStorageResourceSample(sample, label) {
  assertObject(sample, label);
  for (const key of [
    "cpuUserMicros",
    "cpuSystemMicros",
    "filesystemReadBlocks",
    "filesystemWriteBlocks",
    "rssBeforeBytes",
    "rssAfterBytes",
  ]) {
    assertNonNegativeFiniteNumber(sample[key], `${label}.${key}`);
  }

  assertObject(sample.nodeAsyncFilesystemRequests, `${label}.nodeAsyncFilesystemRequests`);
  for (const [key, value] of Object.entries(sample.nodeAsyncFilesystemRequests)) {
    assertNonNegativeInteger(value, `${label}.nodeAsyncFilesystemRequests.${key}`);
  }

  assertObject(sample.eventLoopUtilization, `${label}.eventLoopUtilization`);
  for (const key of ["idle", "active", "utilization"]) {
    assertFiniteNumber(sample.eventLoopUtilization[key], `${label}.eventLoopUtilization.${key}`);
  }

  assertNonNegativeInteger(sample.eventLoopDelaySamples, `${label}.eventLoopDelaySamples`);
  if (sample.eventLoopDelaySamples === 0) {
    assert.equal(sample.eventLoopDelayMaxMs, null, `${label}.eventLoopDelayMaxMs must be null when there are no delay samples`);
    assert.equal(sample.eventLoopDelayP95Ms, null, `${label}.eventLoopDelayP95Ms must be null when there are no delay samples`);
  } else {
    assertNonNegativeFiniteNumber(sample.eventLoopDelayMaxMs, `${label}.eventLoopDelayMaxMs`);
    assertNonNegativeFiniteNumber(sample.eventLoopDelayP95Ms, `${label}.eventLoopDelayP95Ms`);
  }

  assertObject(sample.scheduledTimerProbe, `${label}.scheduledTimerProbe`);
  assertNonNegativeFiniteNumber(sample.scheduledTimerProbe.intervalMs, `${label}.scheduledTimerProbe.intervalMs`);
  assertNonNegativeInteger(sample.scheduledTimerProbe.samples, `${label}.scheduledTimerProbe.samples`);
  assertNonNegativeFiniteNumber(sample.scheduledTimerProbe.maximumLatenessMs, `${label}.scheduledTimerProbe.maximumLatenessMs`);

  assertFileEndpoint(sample.filesBefore, `${label}.filesBefore`);
  assertFileEndpoint(sample.filesAfter, `${label}.filesAfter`);

  const linuxMode = sample.processLifetimePeakRssKiB === null;
  if (linuxMode) {
    assertLinuxOperationRss(sample.linuxOperationRss, `${label}.linuxOperationRss`);
  } else {
    assertNonNegativeFiniteNumber(sample.processLifetimePeakRssKiB, `${label}.processLifetimePeakRssKiB`);
    assert.equal(sample.linuxOperationRss, undefined, `${label}.linuxOperationRss is only valid when processLifetimePeakRssKiB is null`);
  }
}

export function assertStorageResourceSamples(samples, label) {
  assert.ok(Array.isArray(samples), `${label} must be an array`);
  samples.forEach((sample, index) => assertStorageResourceSample(sample, `${label}[${index}]`));
}

import { createHook } from "node:async_hooks";
import { stat } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { setInterval, clearInterval } from "node:timers";

let linuxPeakWindowActive = false;

function linuxResidentMemory() {
  const status = readFileSync("/proc/self/status", "utf8");
  const field = name => {
    const match = status.match(new RegExp(`^${name}:\\s+(\\d+) kB$`, "m"));
    const value = match ? Number(match[1]) * 1024 : NaN;
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Unavailable Linux ${name} accounting`);
    return value;
  };
  return { rssBytes: field("VmRSS"), peakRssBytes: field("VmHWM") };
}

function beginLinuxPeakWindow() {
  if (process.platform !== "linux") throw new Error("Linux operation RSS measurement requires Linux procfs");
  if (linuxPeakWindowActive) throw new Error("Overlapping Linux RSS windows are not supported");
  // Kernel-documented value 5 resets only this process's RSS high-water mark.
  // https://cdn.kernel.org/doc/html/latest/filesystems/proc.html
  linuxResidentMemory();
  writeFileSync("/proc/self/clear_refs", "5");
  const before = linuxResidentMemory();
  linuxPeakWindowActive = true;
  return before;
}

async function bytes(filename) {
  try { return (await stat(filename)).size; }
  catch (error) { if (error.code === "ENOENT") return 0; throw error; }
}

async function databaseBytes(target) {
  const filename = path.join(target, ".forgeloop/state.sqlite");
  return { databaseBytes: await bytes(filename), walBytes: await bytes(`${filename}-wal`) };
}

/** Supplemental instrumented run; never substitute it for uninstrumented latency. */
export async function measureStorageResources(target, operation, { linuxPeakRss = false } = {}) {
  const filesBefore = await databaseBytes(target);
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  const filesystemRequests = {};
  const hook = createHook({ init(_id, type) {
    if (type === "FSREQPROMISE" || type === "FSREQCALLBACK") {
      filesystemRequests[type] = (filesystemRequests[type] ?? 0) + 1;
    }
  } });
  histogram.enable();
  await delay(5);
  histogram.reset();
  const memoryBefore = process.memoryUsage();
  const usageBefore = process.resourceUsage();
  const utilizationBefore = performance.eventLoopUtilization();
  let timerSamples = 0; let maximumTimerLatenessMs = 0;
  let nextTimerAt = performance.now() + 1;
  const timer = setInterval(() => {
    const now = performance.now();
    maximumTimerLatenessMs = Math.max(maximumTimerLatenessMs, now - nextTimerAt, 0);
    timerSamples += 1;
    nextTimerAt = now + 1;
  }, 1);
  hook.enable();
  let linuxBefore;
  try { linuxBefore = linuxPeakRss ? beginLinuxPeakWindow() : null; }
  catch (error) {
    clearInterval(timer); hook.disable(); histogram.disable();
    throw error;
  }
  const started = performance.now();
  let value; let elapsedMs; let usageAfter; let memoryAfter; let utilization; let linuxAfter;
  try {
    value = await operation();
    elapsedMs = performance.now() - started;
    hook.disable();
    usageAfter = process.resourceUsage();
    memoryAfter = process.memoryUsage();
    utilization = performance.eventLoopUtilization(utilizationBefore);
    linuxAfter = linuxBefore ? linuxResidentMemory() : null;
    // Let delayed timer callbacks observe synchronous blocking before teardown.
    // This drain is outside command latency and filesystem-request counting.
    await delay(5);
  } finally {
    clearInterval(timer);
    hook.disable();
    histogram.disable();
    if (linuxBefore) linuxPeakWindowActive = false;
  }
  return { value, elapsedMs, resources: {
    cpuUserMicros: usageAfter.userCPUTime - usageBefore.userCPUTime,
    cpuSystemMicros: usageAfter.systemCPUTime - usageBefore.systemCPUTime,
    filesystemReadBlocks: usageAfter.fsRead - usageBefore.fsRead,
    filesystemWriteBlocks: usageAfter.fsWrite - usageBefore.fsWrite,
    nodeAsyncFilesystemRequests: filesystemRequests,
    rssBeforeBytes: memoryBefore.rss, rssAfterBytes: memoryAfter.rss,
    // Resetting VmHWM also changes Linux getrusage high-water accounting.
    // Do not label that value as a lifetime peak in the opt-in mode.
    processLifetimePeakRssKiB: linuxBefore ? null : usageAfter.maxRSS,
    ...(linuxBefore ? { linuxOperationRss: {
      method: "procfs VmHWM reset via clear_refs=5 before each operation",
      rssAtResetBytes: linuxBefore.rssBytes,
      rssAfterBytes: linuxAfter.rssBytes,
      operationWindowPeakRssBytes: linuxAfter.peakRssBytes,
      accounting: "Kernel RSS estimate; includes retained fixtures and window instrumentation, excludes previous high-water marks and post-command timer drain",
    } } : {}),
    eventLoopUtilization: utilization,
    eventLoopDelaySamples: histogram.count,
    eventLoopDelayMaxMs: histogram.count ? histogram.max / 1e6 : null,
    eventLoopDelayP95Ms: histogram.count ? histogram.percentile(95) / 1e6 : null,
    scheduledTimerProbe: { intervalMs: 1, samples: timerSamples, maximumLatenessMs: maximumTimerLatenessMs },
    filesBefore, filesAfter: await databaseBytes(target),
  } };
}

export const resourceMeasurementLimits = [
  "Instrumented command latency includes async_hooks overhead; resource snapshots are outside its timer; compare separately from uninstrumented results",
  "Node async filesystem request counts exclude synchronous calls, SQLite internal I/O and external processes; they are not total filesystem operations",
  "Filesystem block counters are OS process resource counters, not logical operation counts; zero may reflect caching or unsupported accounting",
  "RSS endpoints are not operation peak RSS; processLifetimePeakRssKiB includes imports, fixture setup and previous samples",
  "Event-loop histogram includes the short post-command timer drain, excludes fixture/session setup and validation, and is not MCP/HTTP transport evidence",
  "A one-millisecond scheduled timer probe includes the post-command drain and scheduler noise; it complements the histogram, which can miss initial synchronous blocking",
  "Database/WAL byte sizes are endpoints while the connection remains open, not peak live WAL or filesystem-cold measurements",
  "The filesystem baseline has zero database/WAL bytes by design; these fields are not its total persisted data size",
  "Direct lock-wait duration and external-process resource use are not measured",
  "Opt-in Linux operation RSS uses resettable kernel VmHWM accounting, which is an estimate rather than a sampled smaps measurement; reset/read instrumentation and retained fixtures remain in scope",
];

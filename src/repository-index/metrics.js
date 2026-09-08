/**
 * Repository-index measurements are operational telemetry only. They never
 * become protocol evidence, completion proof, or claims about token/cost
 * savings.
 */
export function buildRepositorySearchMetrics({ durationMs, nativeDurationMs, result, engine, engineVersion, serverUsed }) {
  return {
    queryDurationMs: durationMs,
    nativeDurationMs,
    matchCount: result.matches.length,
    matchedFileCount: result.files.length,
    engine,
    engineVersion,
    serverUsed,
    exitCode: result.exitCode,
    ignoredNativeEvents: result.ignoredEvents,
    ...(result.stats.bytesSearched !== undefined ? { bytesSearched: result.stats.bytesSearched } : {}),
    ...(result.stats.matchedLines !== undefined ? { matchedLines: result.stats.matchedLines } : {}),
  };
}
export function buildRepositoryIndexMetrics(status) {
  return {
    engine: status.engine,
    engineVersion: status.engineVersion,
    indexedFiles: status.index.files,
    indexedTrigrams: status.index.trigrams,
    health: status.health,
    serverUsed: status.server.running,
  };
}

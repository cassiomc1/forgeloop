export const RESOURCE_LIMITS = {
  JSON_MAX_SIZE_BYTES: 1024 * 1024,
  JSON_MAX_DEPTH: 100,
  NDJSON_MAX_LINE_BYTES: 64 * 1024,
  CLI_MAX_STDOUT_BYTES: 1024 * 1024,
  CLI_TIMEOUT_MS: 30000,
  EVENTS_BATCH_SIZE: 1000,
  WATCHER_DEBOUNCE_MS: 100,
  WATCHER_RETRY_MS: 500,
  WATCHER_MAX_RETRIES: 3,
} as const;

export function validateJsonSize(content: string, maxBytes = RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES): void {
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > maxBytes) {
    throw new Error(`JSON payload exceeds maximum size of ${maxBytes} bytes`);
  }
}

export function validateJsonDepth(obj: unknown, maxDepth = RESOURCE_LIMITS.JSON_MAX_DEPTH, currentDepth = 0): void {
  if (currentDepth > maxDepth) {
    throw new Error(`JSON nesting depth exceeds maximum of ${maxDepth}`);
  }

  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        validateJsonDepth(item, maxDepth, currentDepth + 1);
      }
    } else {
      for (const value of Object.values(obj)) {
        validateJsonDepth(value, maxDepth, currentDepth + 1);
      }
    }
  }
}

export function validateNdjsonLine(line: string, maxBytes = RESOURCE_LIMITS.NDJSON_MAX_LINE_BYTES): void {
  const byteLength = Buffer.byteLength(line, 'utf8');
  if (byteLength > maxBytes) {
    throw new Error(`NDJSON line exceeds maximum size of ${maxBytes} bytes`);
  }
}

export function parseJsonSafely<T>(content: string, maxBytes = RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES): T {
  validateJsonSize(content, maxBytes);
  const parsed = JSON.parse(content);
  validateJsonDepth(parsed);
  return parsed as T;
}

export function parseNdjsonSafely<T>(content: string, maxLines?: number): T[] {
  const limit = maxLines ?? RESOURCE_LIMITS.EVENTS_BATCH_SIZE;
  const lines = content.trim().split('\n');
  if (lines.length > limit) {
    throw new Error(`NDJSON exceeds maximum line count of ${limit}`);
  }

  return lines
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      validateNdjsonLine(line);
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`Failed to parse NDJSON line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}
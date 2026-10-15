import { describe, it, expect } from 'vitest';
import { parseJsonSafely, parseNdjsonSafely, RESOURCE_LIMITS } from '@main/security/resource-limits';

describe('security/resource-limits', () => {
  describe('RESOURCE_LIMITS', () => {
    it('should have valid limits', () => {
      expect(RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES).toBeGreaterThan(0);
      expect(RESOURCE_LIMITS.JSON_MAX_DEPTH).toBeGreaterThan(0);
      expect(RESOURCE_LIMITS.NDJSON_MAX_LINE_BYTES).toBeGreaterThan(0);
      expect(RESOURCE_LIMITS.CLI_MAX_STDOUT_BYTES).toBeGreaterThan(0);
      expect(RESOURCE_LIMITS.CLI_TIMEOUT_MS).toBeGreaterThan(0);
      expect(RESOURCE_LIMITS.EVENTS_BATCH_SIZE).toBeGreaterThan(0);
      expect(RESOURCE_LIMITS.WATCHER_DEBOUNCE_MS).toBeGreaterThan(0);
    });
  });

  describe('parseJsonSafely', () => {
    it('should parse valid JSON', () => {
      const result = parseJsonSafely<{ name: string }>('{"name":"test"}');
      expect(result).toEqual({ name: 'test' });
    });

    it('should parse JSON arrays', () => {
      const result = parseJsonSafely<number[]>('[1,2,3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseJsonSafely('{invalid')).toThrow();
    });

    it('should throw on oversized JSON', () => {
      const huge = 'x'.repeat(RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES + 100);
      expect(() => parseJsonSafely(`"${huge}"`)).toThrow();
    });

    it('accepts JSON at the exact maximum and rejects one byte beyond it', () => {
      const exact = `${' '.repeat(RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES - 2)}{}`;
      const over = `${' '.repeat(RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES - 1)}{}`;
      expect(Buffer.byteLength(exact, 'utf8')).toBe(RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES);
      expect(parseJsonSafely(exact)).toEqual({});
      expect(() => parseJsonSafely(over)).toThrow(/maximum size/);
    });
  });

  describe('parseNdjsonSafely', () => {
    it('should parse valid NDJSON', () => {
      const content = '{"a":1}\n{"b":2}\n{"c":3}';
      const result = parseNdjsonSafely(content);
      expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    });

    it('should handle empty content', () => {
      const result = parseNdjsonSafely('');
      expect(result).toEqual([]);
    });

    it('should filter empty lines', () => {
      const content = '{"a":1}\n\n{"b":2}\n';
      const result = parseNdjsonSafely(content);
      expect(result).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('should respect custom limit', () => {
      const content = '{"a":1}\n{"b":2}';
      const result = parseNdjsonSafely(content, 3);
      expect(result).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('should throw when lines exceed custom limit', () => {
      const content = '{"a":1}\n{"b":2}\n{"c":3}';
      expect(() => parseNdjsonSafely(content, 2)).toThrow();
    });

    it('should throw on lines exceeding byte limit', () => {
      const hugeLine = 'x'.repeat(RESOURCE_LIMITS.NDJSON_MAX_LINE_BYTES + 100);
      expect(() => parseNdjsonSafely(`"${hugeLine}"`)).toThrow();
    });

    it('should throw on invalid JSON lines', () => {
      expect(() => parseNdjsonSafely('not json')).toThrow();
    });
  });
});

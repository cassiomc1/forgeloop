import { describe, it, expect } from 'vitest';
import { isAllowedCommand, ALLOWED_CLI_COMMANDS } from '@main/core/cli/allowed-commands';

describe('allowed-commands', () => {
  it('should include all required commands', () => {
    expect(ALLOWED_CLI_COMMANDS).toContain('protocol-info');
    expect(ALLOWED_CLI_COMMANDS).toContain('task-list');
    expect(ALLOWED_CLI_COMMANDS).toContain('task-show');
    expect(ALLOWED_CLI_COMMANDS).toContain('status');
    expect(ALLOWED_CLI_COMMANDS).toContain('progress');
    expect(ALLOWED_CLI_COMMANDS).toContain('continuity');
    expect(ALLOWED_CLI_COMMANDS).toContain('next');
    expect(ALLOWED_CLI_COMMANDS).toContain('audit');
    expect(ALLOWED_CLI_COMMANDS).toContain('report');
    expect(ALLOWED_CLI_COMMANDS).toContain('policy-status');
  });

  it('should have exactly 10 commands', () => {
    expect(ALLOWED_CLI_COMMANDS).toHaveLength(10);
  });

  describe('isAllowedCommand', () => {
    it('should return true for allowed commands', () => {
      expect(isAllowedCommand('protocol-info')).toBe(true);
      expect(isAllowedCommand('task-list')).toBe(true);
      expect(isAllowedCommand('task-show')).toBe(true);
      expect(isAllowedCommand('status')).toBe(true);
      expect(isAllowedCommand('progress')).toBe(true);
      expect(isAllowedCommand('continuity')).toBe(true);
      expect(isAllowedCommand('next')).toBe(true);
      expect(isAllowedCommand('audit')).toBe(true);
      expect(isAllowedCommand('report')).toBe(true);
      expect(isAllowedCommand('policy-status')).toBe(true);
    });

    it('should return false for disallowed commands', () => {
      expect(isAllowedCommand('advance')).toBe(false);
      expect(isAllowedCommand('route')).toBe(false);
      expect(isAllowedCommand('complete')).toBe(false);
      expect(isAllowedCommand('start')).toBe(false);
      expect(isAllowedCommand('delete')).toBe(false);
      expect(isAllowedCommand('')).toBe(false);
      expect(isAllowedCommand('protocol-info --json')).toBe(false);
    });
  });
});

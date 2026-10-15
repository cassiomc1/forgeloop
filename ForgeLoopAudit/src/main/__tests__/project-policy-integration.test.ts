import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PathBoundary } from '@main/security/path-boundary';
import { ProjectSnapshotBuilder } from '@main/core/project/project-snapshot';

function integrationFor(policyData: Record<string, unknown> | null) {
  return {
    getPackageVersion: () => '1.5.0',
    getCapabilities: () => ({}) as never,
    readProtocolInfo: async () => ({ compatibility: { protocolVersion: 1, schemaVersion: 1 } }),
    listTasks: async () => ({ count: 0, tasks: [] }),
    readTaskStatus: async () => ({}),
    readTaskOwnership: async (_root: string, taskId: string) => ({
      taskId,
      phase: null,
      claimState: 'ACTIVE',
      mutationAllowed: true,
      ownershipValid: true,
      recoveryStatus: null,
      historicalWriteClaims: [],
      effectiveWriteClaims: [],
      reasonCodes: [],
    }),
    readTaskContract: async () => ({}),
    readTaskContinuity: async () => ({}),
    executeReadOnly: async <T>(_root: string, command: string) => {
      expect(command).toBe('policy-status');
      return {
        ok: true,
        command,
        exitCode: 0,
        result: policyData as T | null,
        error: null,
        metadata: null,
      };
    },
  } as never;
}

describe('project policy through the canonical runtime', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'forgeloop-policy-'));
    mkdirSync(join(root, '.forgeloop'), { recursive: true });
    writeFileSync(
      join(root, '.forgeloop', 'config.json'),
      JSON.stringify({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' }),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeBuilder(cli: Record<string, unknown>) {
    return new ProjectSnapshotBuilder(
      new PathBoundary(root),
      {
        readConfig: () => ({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' }),
        tryReadConfig: () => ({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' }),
        listTaskKeys: () => [],
        listSessions: () => [],
        readGlobalPolicy: () => ({}),
      } as any,
      cli as never,
      { source: 'PROTOCOL_INFO', protocolVersion: 1, schemaVersion: 1, compatibilityMode: 'INTEGRATION_V1' } as any,
      true,
      integrationFor({
        status: 'VALID',
        lockStatus: 'valid',
        drift: null,
        rules: [{ id: 'fixture-rule' }],
      }) as never,
    );
  }

  it('uses the Integration API and never spawns the external CLI in INTEGRATION_V1', async () => {
    const cli = {
      next: vi.fn(),
      status: vi.fn(),
      policyStatus: vi.fn(() => {
        throw new Error('external CLI must not be called in INTEGRATION_V1');
      }),
    };
    const snapshot = await makeBuilder(cli).build();
    expect(snapshot.policy?.integritySource).toBe('POLICY_STATUS');
    expect(snapshot.policy?.overallStatus).toBe('valid');
    expect(cli.policyStatus).not.toHaveBeenCalled();
    expect(cli.next).not.toHaveBeenCalled();
    expect(cli.status).not.toHaveBeenCalled();
  });

  it('falls back to artifact-derived policy when the canonical read fails', async () => {
    const builder = new ProjectSnapshotBuilder(
      new PathBoundary(root),
      {
        readConfig: () => ({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' }),
        tryReadConfig: () => ({ schemaVersion: 1, protocolVersion: 1, complianceMode: 'standard' }),
        listTaskKeys: () => [],
        listSessions: () => [],
        readGlobalPolicy: () => ({ 'rules.json': { schemaVersion: 1, rules: [] } }),
      } as any,
      {} as never,
      { source: 'PROTOCOL_INFO', protocolVersion: 1, schemaVersion: 1, compatibilityMode: 'INTEGRATION_V1' } as any,
      true,
      {
        getPackageVersion: () => '1.5.0',
        getCapabilities: () => ({}) as never,
        readProtocolInfo: async () => ({ compatibility: { protocolVersion: 1, schemaVersion: 1 } }),
        listTasks: async () => ({ count: 0, tasks: [] }),
        readTaskStatus: async () => ({}),
        readTaskOwnership: async () => ({}),
        readTaskContract: async () => ({}),
        readTaskContinuity: async () => ({}),
        executeReadOnly: async <T>(_root: string, command: string) => ({
          ok: false,
          command,
          exitCode: 1,
          result: null as T | null,
          error: { code: 'E_POLICY_UNAVAILABLE', message: 'no policy' },
          metadata: null,
        }),
      } as never,
    );

    const snapshot = await builder.build();
    expect(snapshot.policy?.integritySource).not.toBe('POLICY_STATUS');
  });
});

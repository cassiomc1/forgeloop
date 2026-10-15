import type { CanonicalTaskList } from './types';

export interface CanonicalTaskDiscoveryAdapter {
  listTasks(projectRoot: string): Promise<CanonicalTaskList>;
}

export interface CanonicalTaskDiscoveryResult {
  tasks: CanonicalTaskList['tasks'];
  source: 'FORGELOOP_INTEGRATION' | 'UNAVAILABLE';
  diagnostics: string[];
}

/**
 * Resolve the canonical ForgeLoop task discovery for a project.
 *
 * The canonical `project/tasks` resource is the semantic source of truth in
 * INTEGRATION_V1 mode. Filesystem namespaces remain available for raw
 * artifact lookup and watcher reconciliation; divergence between the two is
 * surfaced as an observation, never resolved by inventing tasks or by
 * defaulting corrupt entries to a synthetic phase such as RECEIVED.
 */
export async function discoverCanonicalTasks(
  adapter: CanonicalTaskDiscoveryAdapter,
  projectRoot: string,
  filesystemTaskKeys: string[] | null,
): Promise<CanonicalTaskDiscoveryResult> {
  try {
    const canonical = await adapter.listTasks(projectRoot);
    const diagnostics: string[] = [];
    if (filesystemTaskKeys !== null && canonical.count !== filesystemTaskKeys.length) {
      diagnostics.push(
        `task-list parity divergence: ${canonical.count} canonical tasks vs ${filesystemTaskKeys.length} filesystem namespaces`,
      );
    }
    return { tasks: canonical.tasks, source: 'FORGELOOP_INTEGRATION', diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      tasks: [],
      source: 'UNAVAILABLE',
      diagnostics: [`canonical task discovery unavailable: ${message}`],
    };
  }
}

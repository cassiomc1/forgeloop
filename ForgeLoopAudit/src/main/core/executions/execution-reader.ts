import { existsSync, lstatSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PathBoundary } from '@main/security/path-boundary';
import { ForgeLoopAuditError } from '@shared/errors';
import { SchemaValidator } from '@main/core/protocol/validator';
import { parseJsonSafely, RESOURCE_LIMITS } from '@main/security/resource-limits';
import type { ExecutionPage, ExecutionRecord } from '@shared/domain';

export type { ExecutionPage, ExecutionRecord };

export interface ExecutionReaderOptions {
  limit?: number;
}

const EXECUTIONS_DIR = 'executions';
const EXECUTION_FILE_PATTERN = /^exec-.*\.json$/;
const DEFAULT_LIMIT = 100;

/**
 * Bounded read-only reader for current ForgeLoop protocol-v1 execution provenance artifacts
 * (`.forgeloop/task-state/<task-key>/executions/exec-*.json`).
 *
 * Every entry is validated against the trusted `execution.schema.json`.
 * Symbolic links, path escapes, oversized files and excessive counts are
 * rejected or bounded; results are ordered deterministically. Executions are
 * loaded lazily per task, never as part of the global snapshot.
 */
export class ExecutionReader {
  constructor(
    private readonly pathBoundary: PathBoundary,
    private readonly validator: SchemaValidator,
  ) {}

  readExecutions(taskKey: string, options: ExecutionReaderOptions = {}): ExecutionPage {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), DEFAULT_LIMIT);
    const executionsDir = this.pathBoundary.resolveForgeLoopPathLexically(
      join('task-state', taskKey, EXECUTIONS_DIR),
    );

    if (!existsSync(executionsDir)) {
      return { executions: [], invalidCount: 0, hasMore: false };
    }

    // The executions directory itself must be a real directory inside the
    // project boundary — never a symlink and never a regular file.
    const dirStat = lstatSync(executionsDir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
      throw ForgeLoopAuditError.pathBoundaryViolation(executionsDir, this.pathBoundary.getProjectRoot());
    }
    const validatedExecutionsDir = this.pathBoundary.validatePath(executionsDir);

    const names = readdirSync(validatedExecutionsDir)
      .filter((name) => EXECUTION_FILE_PATTERN.test(name))
      .sort();

    const executions: ExecutionRecord[] = [];
    let invalidCount = 0;
    let hasMore = false;

    for (const name of names) {
      if (executions.length >= limit) {
        hasMore = true;
        break;
      }
      const candidate = join(validatedExecutionsDir, name);
      try {
        const stat = lstatSync(candidate);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > RESOURCE_LIMITS.JSON_MAX_SIZE_BYTES) {
          invalidCount += 1;
          continue;
        }
        const validatedFile = this.pathBoundary.validatePath(candidate);
        const parsed = parseJsonSafely<Record<string, unknown>>(readFileSync(validatedFile, 'utf8'));
        const validation = this.validator.validate('execution.schema.json', parsed);
        if (!validation.valid) {
          invalidCount += 1;
          continue;
        }
        executions.push(parsed as unknown as ExecutionRecord);
      } catch {
        invalidCount += 1;
      }
    }

    return { executions, invalidCount, hasMore };
  }
}

export function createExecutionReader(pathBoundary: PathBoundary, validator: SchemaValidator): ExecutionReader {
  return new ExecutionReader(pathBoundary, validator);
}

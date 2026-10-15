import { resolve, normalize, relative, isAbsolute, sep } from 'path';
import { realpathSync, existsSync } from 'fs';
import { ForgeLoopAuditError } from '@shared/errors';

export class PathBoundary {
  private readonly projectRoot: string;
  private readonly realProjectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = normalize(resolve(projectRoot));
    if (!existsSync(this.projectRoot)) {
      throw ForgeLoopAuditError.projectNotForgeLoop(projectRoot);
    }
    this.realProjectRoot = realpathSync(this.projectRoot);
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getRealProjectRoot(): string {
    return this.realProjectRoot;
  }

  validatePath(requestedPath: string): string {
    const absoluteRequested = isAbsolute(requestedPath)
      ? requestedPath
      : resolve(this.projectRoot, requestedPath);

    const normalizedRequested = normalize(absoluteRequested);

    if (!existsSync(normalizedRequested)) {
      throw ForgeLoopAuditError.unknown(`Path does not exist: ${normalizedRequested}`);
    }

    const realRequested = realpathSync(normalizedRequested);
    const relativePath = relative(this.realProjectRoot, realRequested);

    if (relativePath.startsWith('..') || relativePath.includes(`${sep}..${sep}`) || relativePath === '..') {
      throw ForgeLoopAuditError.pathBoundaryViolation(requestedPath, this.projectRoot);
    }

    if (realRequested === this.realProjectRoot) {
      return realRequested;
    }

    const allowedPrefixes = [
      '.forgeloop/',
      '.forgeloop' + sep,
      '.git/HEAD',
      '.git/refs/',
      '.git/packed-refs',
    ];

    const isAllowed = relativePath === '.forgeloop' || allowedPrefixes.some((prefix) => relativePath.startsWith(prefix));

    if (!isAllowed) {
      throw ForgeLoopAuditError.pathBoundaryViolation(requestedPath, this.projectRoot);
    }

    return realRequested;
  }

  validateLexicalPath(requestedPath: string): string {
    const normalizedRequested = normalize(isAbsolute(requestedPath) ? requestedPath : resolve(this.projectRoot, requestedPath));
    const relativePath = relative(this.projectRoot, normalizedRequested);
    if (relativePath.startsWith('..') || relativePath === '..' || relativePath.includes(`${sep}..${sep}`)) {
      throw ForgeLoopAuditError.pathBoundaryViolation(requestedPath, this.projectRoot);
    }
    if (!relativePath.startsWith(`.forgeloop${sep}`) && relativePath !== '.forgeloop') {
      throw ForgeLoopAuditError.pathBoundaryViolation(requestedPath, this.projectRoot);
    }
    return normalizedRequested;
  }

  resolveForgeLoopPathLexically(relativePath: string): string {
    return this.validateLexicalPath(resolve(this.projectRoot, FORGELOOP_DIR_NAME, relativePath));
  }

  validateForgeLoopPath(relativePath: string): string {
    const fullPath = resolve(this.projectRoot, FORGELOOP_DIR_NAME, relativePath);
    return this.validatePath(fullPath);
  }

  isWithinProject(path: string): boolean {
    try {
      this.validatePath(path);
      return true;
    } catch {
      return false;
    }
  }
}

export const FORGELOOP_DIR_NAME = '.forgeloop';

export function createPathBoundary(projectRoot: string): PathBoundary {
  return new PathBoundary(projectRoot);
}

export function normalizePath(path: string): string {
  return normalize(resolve(path));
}

export function isPathWithinBoundary(path: string, boundary: string): boolean {
  try {
    if (!existsSync(path) || !existsSync(boundary)) {
      return false;
    }
    const realPath = realpathSync(normalize(resolve(path)));
    const realBoundary = realpathSync(normalize(resolve(boundary)));
    const relativePath = relative(realBoundary, realPath);
    return !relativePath.startsWith('..') && !relativePath.includes(`${sep}..${sep}`);
  } catch {
    return false;
  }
}

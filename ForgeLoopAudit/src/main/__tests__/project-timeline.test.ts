import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '@shared/domain';
import { deriveProjectTimeline } from '@main/core/timeline/project-timeline';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeSnapshot(root: string): ProjectSnapshot {
  return {
    project: { name: 'Fixture', rootPath: root },
    protocol: { protocolVersion: 1, schemaVersion: 1, packageVersion: '1.14.0', compatible: true },
    health: { status: 'UNKNOWN', source: 'UNKNOWN' },
    observations: {
      taskCount: 0,
      evidence: { covered: 0, partial: 0, notVerified: 0, blocked: 0 },
      continuity: { present: 0, missing: 0 },
      artifactValidationErrors: 0,
      ownership: { activeCount: 0, recoveredResumeRequiredCount: 0, inconsistentCount: 0, unavailableCount: 0 },
    },
    tasks: [],
    sessions: [],
    updatedAt: new Date().toISOString(),
  };
}

function git(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

describe('project timeline derivation', () => {
  it('falls back to current project signals without inventing Git dates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-timeline-no-git-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }));
    writeFileSync(join(root, 'src', 'main.tsx'), 'export const app = true;');

    const timeline = await deriveProjectTimeline({ projectRoot: root, snapshot: makeSnapshot(root), audit: null, forgeLoopVersion: '1.14.0' });

    expect(timeline.git.available).toBe(false);
    expect(timeline.events.some((event) => event.title === 'TypeScript detected' && !event.timestamp)).toBe(true);
    expect(timeline.events.at(-1)?.title).toBe('Current Architecture');
    expect(timeline.warnings.some((warning) => warning.includes('not a Git work tree'))).toBe(true);
  });

  it('orders real Git milestones, tags nested projects, and deduplicates current events', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-timeline-git-'));
    temporaryRoots.push(root);
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'timeline@example.test']);
    git(root, ['config', 'user.name', 'Timeline Test']);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { express: '^5.0.0' } }));
    writeFileSync(join(root, 'index.js'), 'module.exports = {};');
    git(root, ['add', 'package.json', 'index.js']);
    git(root, ['commit', '-q', '--allow-empty-message', '-m', '']);
    git(root, ['tag', 'v1.0.0']);
    mkdirSync(join(root, 'packages', 'worker'), { recursive: true });
    writeFileSync(join(root, 'packages', 'worker', 'package.json'), JSON.stringify({ name: 'worker' }));
    writeFileSync(join(root, 'packages', 'worker', 'worker.py'), 'print("worker")');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'add worker project']);

    const timeline = await deriveProjectTimeline({ projectRoot: root, snapshot: makeSnapshot(root), audit: { generatedAt: '2026-09-13T12:00:00.000Z' } as never, forgeLoopVersion: '1.14.0' });

    expect(timeline.git.available).toBe(true);
    expect(timeline.git.commitCount).toBe(2);
    expect(timeline.analysis.projectCount).toBe(2);
    expect(timeline.analysis.languages).toEqual(expect.arrayContaining(['JavaScript', 'Python']));
    expect(timeline.events.filter((event) => event.title === 'Current Architecture')).toHaveLength(1);
    expect(timeline.events.some((event) => event.title === 'Release v1.0.0')).toBe(true);
    expect(timeline.events.at(-1)?.current).toBe(true);
    expect(timeline.events.find((event) => event.title === 'Project created')?.confidence).toBe('high');
  });

  it('ignores malformed manifests while keeping source-language evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-timeline-malformed-'));
    temporaryRoots.push(root);
    writeFileSync(join(root, 'package.json'), '{not-json');
    writeFileSync(join(root, 'main.go'), 'package main');

    const timeline = await deriveProjectTimeline({ projectRoot: root, snapshot: makeSnapshot(root), audit: null, forgeLoopVersion: null });

    expect(timeline.analysis.languages).toContain('Go');
    expect(timeline.analysis.frameworks).not.toContain('React');
  });

  it('recognizes supported language and project markers within the bounded scan', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-timeline-markers-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    for (const directory of ['src', 'app', 'lib', 'server', 'client', 'packages', 'apps']) mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dependencies: {
        react: '^19.0.0', 'react-dom': '^19.0.0', next: '^15.0.0', vite: '^7.0.0', express: '^5.0.0',
        fastify: '^5.0.0', '@nestjs/core': '^11.0.0', vue: '^3.0.0', '@angular/core': '^20.0.0',
        svelte: '^5.0.0', electron: '^40.0.0', tailwindcss: '^4.0.0', prisma: '^6.0.0', '@prisma/client': '^6.0.0',
        typescript: '^5.0.0', unknown: '^1.0.0',
      },
      devDependencies: { playwright: '^1.0.0' },
      peerDependencies: { peer: '^1.0.0' },
      optionalDependencies: { optional: '^1.0.0' },
    }));
    writeFileSync(join(root, 'pubspec.yaml'), 'name: fixture\ndependencies:\n  flutter:\n    sdk: flutter\n');
    writeFileSync(join(root, 'pyproject.toml'), '[project]\nname = "fixture"\n');
    writeFileSync(join(root, 'requirements.txt'), 'pytest\n');
    writeFileSync(join(root, 'go.mod'), 'module example.test/fixture\n');
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname = "fixture"\n');
    writeFileSync(join(root, 'composer.json'), '{}');
    writeFileSync(join(root, 'Package.swift'), '// swift-tools-version: 5.9\n');
    writeFileSync(join(root, 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web" />');
    writeFileSync(join(root, 'pom.xml'), '<project />');
    writeFileSync(join(root, 'build.gradle.kts'), 'plugins {}');
    writeFileSync(join(root, 'CMakeLists.txt'), 'project(fixture)');
    writeFileSync(join(root, 'Dockerfile'), 'FROM node:22');
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: CI');
    writeFileSync(join(root, 'schema.prisma'), 'datasource db { provider = "sqlite" }');
    writeFileSync(join(root, 'db.sql'), 'select 1;');
    const files = ['main.ts', 'component.tsx', 'index.js', 'view.jsx', 'module.mjs', 'legacy.cjs', 'worker.py', 'main.dart', 'Api.cs', 'Main.java', 'Main.kt', 'service.go', 'lib.rs', 'index.php', 'App.swift', 'main.c', 'lib.cc', 'app.cpp', 'header.h', 'header.hpp'];
    files.forEach((file, index) => writeFileSync(join(root, ['src', 'app', 'lib', 'server', 'client', 'packages', 'apps'][index % 7], file), 'source'));
    mkdirSync(join(root, 'nested'), { recursive: true });
    writeFileSync(join(root, 'nested', 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }));

    const timeline = await deriveProjectTimeline({ projectRoot: root, snapshot: { ...makeSnapshot(root), tasks: [{ id: 'task-1' }] } as never, audit: null, forgeLoopVersion: null });

    expect(timeline.analysis.projectCount).toBe(2);
    expect(timeline.analysis.languages).toEqual(expect.arrayContaining(['Node.js', 'TypeScript', 'JavaScript', 'Python', 'Dart', 'C#', 'Java', 'Go', 'Rust', 'PHP', 'Swift', 'C/C++']));
    expect(timeline.analysis.frameworks).toEqual(expect.arrayContaining(['React', 'Next.js', 'Vite', 'Express', 'Fastify', 'NestJS', 'Vue', 'Angular', 'Svelte', 'Electron', 'Tailwind CSS', 'Prisma', 'Flutter', 'ASP.NET Core', 'Docker', 'GitHub Actions', 'Database']));
    expect(timeline.events.find((event) => event.title === 'Application structure emerged')?.description).toContain('and more');
    expect(timeline.events.find((event) => event.title === 'Dependencies recorded')?.metadata).toMatchObject({ dependencyCount: 19 });
    expect(timeline.analysis.architecture).toBe('Multi-project repository');
  });

  it('reports a source repository when no marker or framework identifies a project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgeloop-timeline-source-'));
    temporaryRoots.push(root);
    writeFileSync(join(root, 'README.md'), '# Fixture');
    writeFileSync(join(root, 'main.ts'), 'export const main = true;');

    const timeline = await deriveProjectTimeline({ projectRoot: root, snapshot: makeSnapshot(root), audit: null, forgeLoopVersion: null });

    expect(timeline.analysis.architecture).toBe('Source repository');
    expect(timeline.events.at(-1)?.description).toContain('no ForgeLoop tasks');
  });
});

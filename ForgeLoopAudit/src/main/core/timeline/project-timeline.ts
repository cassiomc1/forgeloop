import { execFile as execFileCallback } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { ProjectAuditSnapshot } from '@shared/audit';
import type {
  ProjectSnapshot,
  ProjectTimeline,
  ProjectTimelineEvent,
  ProjectTimelineEventType,
} from '@shared/domain';

const execFile = promisify(execFileCallback);
const TIMELINE_SCHEMA_VERSION = 1;
const MAX_SCAN_DEPTH = 5;
const MAX_SCANNED_FILES = 5000;
const MAX_TAGS = 12;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.forgeloop',
  '.worktrees',
  'worktrees',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  'target',
]);

const LANGUAGE_PATTERNS: ReadonlyArray<{ label: string; extensions: string[]; paths: string[] }> = [
  { label: 'TypeScript', extensions: ['.ts', '.tsx'], paths: ['*.ts', '*.tsx', '**/*.ts', '**/*.tsx'] },
  { label: 'JavaScript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], paths: ['*.js', '*.jsx', '*.mjs', '*.cjs', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'] },
  { label: 'Python', extensions: ['.py'], paths: ['*.py', '**/*.py'] },
  { label: 'Dart', extensions: ['.dart'], paths: ['*.dart', '**/*.dart'] },
  { label: 'C#', extensions: ['.cs'], paths: ['*.cs', '**/*.cs'] },
  { label: 'Java', extensions: ['.java', '.kt', '.kts'], paths: ['*.java', '*.kt', '*.kts', '**/*.java', '**/*.kt', '**/*.kts'] },
  { label: 'Go', extensions: ['.go'], paths: ['*.go', '**/*.go'] },
  { label: 'Rust', extensions: ['.rs'], paths: ['*.rs', '**/*.rs'] },
  { label: 'PHP', extensions: ['.php'], paths: ['*.php', '**/*.php'] },
  { label: 'Swift', extensions: ['.swift'], paths: ['*.swift', '**/*.swift'] },
  { label: 'C/C++', extensions: ['.c', '.cc', '.cpp', '.h', '.hpp'], paths: ['*.c', '*.cc', '*.cpp', '*.h', '*.hpp', '**/*.c', '**/*.cc', '**/*.cpp', '**/*.h', '**/*.hpp'] },
];

const DEPENDENCY_FRAMEWORKS: Readonly<Record<string, string>> = {
  react: 'React',
  'react-dom': 'React',
  next: 'Next.js',
  vite: 'Vite',
  express: 'Express',
  fastify: 'Fastify',
  '@nestjs/core': 'NestJS',
  vue: 'Vue',
  '@angular/core': 'Angular',
  svelte: 'Svelte',
  electron: 'Electron',
  tailwindcss: 'Tailwind CSS',
  prisma: 'Prisma',
  '@prisma/client': 'Prisma',
};

interface GitRecord {
  hash: string;
  timestamp: string;
  subject: string;
}

interface ProjectScan {
  fileCount: number;
  languages: Map<string, number>;
  frameworks: Set<string>;
  dependencies: Set<string>;
  projectRoots: Set<string>;
  modules: Set<string>;
  evidenceFiles: Set<string>;
  truncated: boolean;
}

interface GitHistory {
  available: boolean;
  head: string | null;
  shallow: boolean;
  commitCount: number | null;
  firstCommit: GitRecord | null;
  tags: Array<{ name: string; timestamp?: string }>;
  introductions: Map<string, GitRecord>;
}

export interface ProjectTimelineContext {
  projectRoot: string;
  snapshot: ProjectSnapshot;
  audit: ProjectAuditSnapshot | null;
  forgeLoopVersion: string | null;
}

export async function deriveProjectTimeline(context: ProjectTimelineContext): Promise<ProjectTimeline> {
  const root = resolve(context.projectRoot);
  const scan = await scanProject(root);
  const git = await readGitHistory(root, scan);
  const warnings: string[] = [];
  if (!git.available) warnings.push('Project history is unavailable because this project is not a Git work tree.');
  if (git.shallow) warnings.push('This is a shallow Git clone; historical milestones may be incomplete.');
  if (scan.truncated) warnings.push('The current-project scan reached its safety budget; some optional signals may be omitted.');
  if (context.audit === null) warnings.push('The latest ForgeLoop audit snapshot was unavailable when this timeline was built.');
  warnings.push('Code-graph relationships are not exposed by ForgeLoop’s public Integration API; this timeline does not infer them from filenames.');

  const events: ProjectTimelineEvent[] = [];
  const seen = new Set<string>();
  const addEvent = (event: Omit<ProjectTimelineEvent, 'id' | 'order'>): void => {
    const key = `${event.type}:${event.title.toLocaleLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push({ ...event, id: timelineId(event.type, event.title), order: 0 });
  };

  if (git.firstCommit) {
    addEvent({
      type: 'project',
      timestamp: git.firstCommit.timestamp,
      title: 'Project created',
      description: git.firstCommit.subject || 'The first repository commit established the project history.',
      source: 'Git history',
      confidence: 'high',
      evidence: [{ type: 'git', source: 'First repository commit', commit: git.firstCommit.hash }],
    });
  }

  for (const language of [...scan.languages.keys()].sort()) {
    const signal = LANGUAGE_PATTERNS.find((candidate) => candidate.label === language);
    const introduction = git.introductions.get(`language:${language}`);
    const count = scan.languages.get(language) ?? 0;
    addEvent({
      type: 'language',
      ...(introduction ? { timestamp: introduction.timestamp } : {}),
      title: `${language} detected`,
      description: `${count} source file${count === 1 ? '' : 's'} currently contribute to this project.`,
      source: signal ? `Current files matching ${signal.extensions.join(', ')}` : 'Current project files',
      confidence: introduction ? 'high' : 'medium',
      evidence: [
        ...(signal ? [{ type: 'file' as const, source: signal.extensions.join(', ') }] : []),
        ...(introduction ? [{ type: 'git' as const, source: 'First added source file', commit: introduction.hash }] : []),
      ],
      metadata: { fileCount: count },
    });
  }

  const frameworkIntroduction = git.introductions.get('framework:package-manifest');
  for (const framework of [...scan.frameworks].sort()) {
    addEvent({
      type: 'framework',
      title: `${framework} detected`,
      description: 'The current project manifests identify this framework or platform; its exact introduction date is not claimed.',
      source: 'Project manifest and configuration files',
      confidence: 'medium',
      evidence: [
        { type: 'package', source: [...scan.evidenceFiles].find((path) => path.endsWith('package.json')) ?? 'Project manifest' },
        ...(frameworkIntroduction ? [{ type: 'git' as const, source: 'First added project manifest', commit: frameworkIntroduction.hash }] : []),
      ],
    });
  }

  if (scan.dependencies.size > 0) {
    addEvent({
      type: 'dependency',
      title: 'Dependencies recorded',
      description: `${scan.dependencies.size} runtime or development dependencies are present in the current project manifests; individual introduction dates are not claimed.`,
      source: 'Project manifests',
      confidence: 'medium',
      evidence: [{ type: 'package', source: [...scan.evidenceFiles].find((path) => path.endsWith('package.json')) ?? 'Project manifest' }],
      metadata: { dependencyCount: scan.dependencies.size },
    });
  }

  if (scan.modules.size > 0) {
    const modules = [...scan.modules].sort();
    const moduleIntroduction = git.introductions.get('architecture:modules');
    addEvent({
      type: 'module',
      ...(moduleIntroduction ? { timestamp: moduleIntroduction.timestamp } : {}),
      title: 'Application structure emerged',
      description: `Major top-level areas include ${modules.slice(0, 6).join(', ')}${modules.length > 6 ? ', and more' : ''}.`,
      source: 'Current repository layout',
      confidence: moduleIntroduction ? 'high' : 'medium',
      evidence: [
        { type: 'file', source: 'Top-level project directories' },
        ...(moduleIntroduction ? [{ type: 'git' as const, source: 'First added application structure', commit: moduleIntroduction.hash }] : []),
      ],
      metadata: { modules },
    });
  }

  if (scan.projectRoots.size > 1) {
    const nestedIntroduction = git.introductions.get('architecture:nested-projects');
    addEvent({
      type: 'architecture',
      ...(nestedIntroduction ? { timestamp: nestedIntroduction.timestamp } : {}),
      title: 'Additional project boundaries discovered',
      description: `${scan.projectRoots.size} project roots are visible, including nested or sibling manifests.`,
      source: 'Bounded project-marker scan',
      confidence: nestedIntroduction ? 'high' : 'medium',
      evidence: [
        { type: 'file', source: 'Project manifests and build markers' },
        ...(nestedIntroduction ? [{ type: 'git' as const, source: 'First nested project marker', commit: nestedIntroduction.hash }] : []),
      ],
      metadata: { projectRoots: [...scan.projectRoots].sort() },
    });
  }

  for (const tag of git.tags) {
    addEvent({
      type: 'release',
      ...(tag.timestamp ? { timestamp: tag.timestamp } : {}),
      title: `Release ${tag.name}`,
      description: 'A Git tag marks a named point in the project history.',
      source: 'Git tag',
      confidence: 'high',
      evidence: [{ type: 'git', source: `Tag ${tag.name}` }],
      metadata: { tag: tag.name },
    });
  }

  const analysisGeneratedAt = context.audit?.generatedAt ?? null;
  const languageSummary = [...scan.languages.keys()].sort();
  const frameworkSummary = [...scan.frameworks].sort();
  const moduleSummary = [...scan.modules].sort();
  const architecture = inferArchitecture(scan.projectRoots.size, languageSummary, frameworkSummary);
  const analysisDescription = [
    `${scan.projectRoots.size} project root${scan.projectRoots.size === 1 ? '' : 's'}`,
    languageSummary.length > 0 ? languageSummary.join(', ') : 'no source language identified',
    frameworkSummary.length > 0 ? `frameworks: ${frameworkSummary.join(', ')}` : 'no framework identified',
    moduleSummary.length > 0 ? `modules: ${moduleSummary.slice(0, 5).join(', ')}` : 'no major module directories identified',
    context.snapshot.tasks.length > 0 ? `${context.snapshot.tasks.length} ForgeLoop task${context.snapshot.tasks.length === 1 ? '' : 's'}` : 'no ForgeLoop tasks',
  ].join(' · ');
  addEvent({
    type: 'analysis',
    ...(analysisGeneratedAt ? { timestamp: analysisGeneratedAt } : {}),
    title: 'Current Architecture',
    description: `ForgeLoopAudit currently sees ${analysisDescription}.`,
    source: context.forgeLoopVersion ? `ForgeLoop ${context.forgeLoopVersion} analysis` : 'ForgeLoopAudit analysis',
    confidence: context.audit ? 'high' : 'medium',
    evidence: [
      { type: 'forgeloop', source: context.audit ? 'Latest ProjectAuditSnapshot' : 'Current ProjectSnapshot' },
    ],
    metadata: {
      projectCount: scan.projectRoots.size,
      languages: languageSummary,
      frameworks: frameworkSummary,
      modules: moduleSummary,
      relationships: null,
      architecture,
    },
    current: true,
  });

  const historical = events.filter((event) => !event.current).sort(compareTimelineEvents);
  const current = events.filter((event) => event.current);
  const orderedEvents = [...historical, ...current].map((event, index) => ({ ...event, order: index }));
  return {
    schemaVersion: 1,
    timelineSchemaVersion: TIMELINE_SCHEMA_VERSION,
    project: context.snapshot.project,
    git: {
      available: git.available,
      head: git.head,
      shallow: git.shallow,
      commitCount: git.commitCount,
      tagCount: git.tags.length,
    },
    analysis: {
      generatedAt: analysisGeneratedAt,
      forgeLoopVersion: context.forgeLoopVersion,
      projectCount: scan.projectRoots.size,
      languages: languageSummary,
      frameworks: frameworkSummary,
      modules: moduleSummary,
      relationships: null,
      architecture,
    },
    events: orderedEvents,
    warnings,
  };
}

function compareTimelineEvents(left: ProjectTimelineEvent, right: ProjectTimelineEvent): number {
  if (left.timestamp && right.timestamp) return left.timestamp.localeCompare(right.timestamp) || left.title.localeCompare(right.title);
  if (left.timestamp) return -1;
  if (right.timestamp) return 1;
  return left.title.localeCompare(right.title);
}

function timelineId(type: ProjectTimelineEventType, title: string): string {
  return `${type}-${title.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')}`;
}

function inferArchitecture(projectCount: number, languages: string[], frameworks: string[]): string | null {
  if (projectCount > 1) return 'Multi-project repository';
  if (frameworks.some((framework) => ['React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Vite'].includes(framework))) return 'Web application';
  if (languages.some((language) => ['C#', 'Java', 'Go', 'Rust'].includes(language))) return 'Service or native application';
  return languages.length > 0 ? 'Source repository' : null;
}

async function scanProject(root: string): Promise<ProjectScan> {
  const scan: ProjectScan = {
    fileCount: 0,
    languages: new Map(),
    frameworks: new Set(),
    dependencies: new Set(),
    projectRoots: new Set(['.']),
    modules: new Set(),
    evidenceFiles: new Set(),
    truncated: false,
  };
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  while (pending.length > 0 && scan.fileCount < MAX_SCANNED_FILES) {
    const current = pending.shift();
    if (!current) break;
    let entries;
    try { entries = await readdir(current.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = resolve(current.directory, entry.name);
      const relativePath = relative(root, fullPath).split(sep).join('/');
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || current.depth >= MAX_SCAN_DEPTH) continue;
        pending.push({ directory: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      scan.fileCount += 1;
      const extension = extname(entry.name).toLocaleLowerCase();
      for (const language of LANGUAGE_PATTERNS) {
        if (language.extensions.includes(extension)) scan.languages.set(language.label, (scan.languages.get(language.label) ?? 0) + 1);
      }
      const topLevel = relativePath.split('/')[0];
      if (relativePath.includes('/') && topLevel && !topLevel.startsWith('.')) scan.modules.add(topLevel);
      if (isProjectMarker(entry.name)) {
        const projectRoot = dirname(relativePath).split(sep).join('/') || '.';
        scan.projectRoots.add(projectRoot);
        scan.evidenceFiles.add(relativePath);
        await inspectProjectMarker(fullPath, entry.name, scan);
      }
      if (entry.name === 'Dockerfile' || relativePath.startsWith('.github/workflows/')) {
        scan.frameworks.add(entry.name === 'Dockerfile' ? 'Docker' : 'GitHub Actions');
        scan.evidenceFiles.add(relativePath);
      }
      if (entry.name === 'schema.prisma' || extension === '.sql') {
        scan.frameworks.add('Database');
        scan.evidenceFiles.add(relativePath);
      }
    }
  }
  scan.truncated = pending.length > 0;
  return scan;
}

function isProjectMarker(name: string): boolean {
  return ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pubspec.yaml', 'composer.json', 'Package.swift', 'CMakeLists.txt'].includes(name)
    || /\.(?:csproj|fsproj|vbproj|sln)$/iu.test(name)
    || name === 'pom.xml'
    || name === 'build.gradle'
    || name === 'build.gradle.kts';
}

async function inspectProjectMarker(path: string, name: string, scan: ProjectScan): Promise<void> {
  const text = await readBoundedText(path);
  if (name === 'package.json') {
    scan.languages.set('Node.js', scan.languages.get('Node.js') ?? 0);
    if (text) {
      try {
        const packageJson = JSON.parse(text) as Record<string, unknown>;
        for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
          const values = packageJson[section];
          if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
          for (const dependency of Object.keys(values)) {
            scan.dependencies.add(dependency);
            const framework = DEPENDENCY_FRAMEWORKS[dependency];
            if (framework) scan.frameworks.add(framework);
          }
        }
      } catch { /* malformed manifests remain visible as project boundaries */ }
    }
    if (scan.dependencies.has('typescript')) scan.languages.set('TypeScript', scan.languages.get('TypeScript') ?? 0);
  } else if (name === 'pubspec.yaml') {
    scan.languages.set('Dart', scan.languages.get('Dart') ?? 0);
    if (text?.includes('flutter:')) scan.frameworks.add('Flutter');
  } else if (name === 'pyproject.toml' || name === 'requirements.txt') {
    scan.languages.set('Python', scan.languages.get('Python') ?? 0);
  } else if (name === 'go.mod') {
    scan.languages.set('Go', scan.languages.get('Go') ?? 0);
  } else if (name === 'Cargo.toml') {
    scan.languages.set('Rust', scan.languages.get('Rust') ?? 0);
  } else if (name === 'composer.json') {
    scan.languages.set('PHP', scan.languages.get('PHP') ?? 0);
  } else if (name === 'Package.swift') {
    scan.languages.set('Swift', scan.languages.get('Swift') ?? 0);
  } else if (/\.(?:csproj|fsproj|vbproj|sln)$/iu.test(name)) {
    scan.languages.set('C#', scan.languages.get('C#') ?? 0);
    if (text?.includes('Microsoft.NET.Sdk.Web')) scan.frameworks.add('ASP.NET Core');
  } else if (name === 'pom.xml' || name === 'build.gradle' || name === 'build.gradle.kts') {
    scan.languages.set('Java', scan.languages.get('Java') ?? 0);
  } else if (name === 'CMakeLists.txt') {
    scan.languages.set('C/C++', scan.languages.get('C/C++') ?? 0);
  }
}

async function readBoundedText(path: string): Promise<string | null> {
  try { return (await readFile(path, 'utf8')).slice(0, 256 * 1024); } catch { return null; }
}

async function readGitHistory(root: string, scan: ProjectScan): Promise<GitHistory> {
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') return { available: false, head: null, shallow: false, commitCount: null, firstCommit: null, tags: [], introductions: new Map() };
  const firstCommit = parseGitRecord(await runGit(root, ['log', '--reverse', '-n', '1', '--format=%H%x1f%aI%x1f%s']));
  const head = await runGit(root, ['rev-parse', 'HEAD']);
  const shallow = (await runGit(root, ['rev-parse', '--is-shallow-repository'])) === 'true';
  const countText = await runGit(root, ['rev-list', '--count', 'HEAD']);
  const commitCount = countText && /^\d+$/u.test(countText) ? Number(countText) : null;
  const tagLines = (await runGit(root, ['for-each-ref', '--sort=creatordate', '--format=%(creatordate:iso-strict)%09%(refname:short)', 'refs/tags']))?.split('\n') ?? [];
  const tags = tagLines.map((line) => {
    const [timestamp, name] = line.split('\t');
    return { name, ...(validTimestamp(timestamp) ? { timestamp } : {}) };
  }).filter((tag): tag is { name: string; timestamp?: string } => typeof tag.name === 'string' && tag.name.length > 0).slice(-MAX_TAGS);
  const introductions = new Map<string, GitRecord>();
  for (const language of LANGUAGE_PATTERNS) {
    const record = parseGitRecord(await runGit(root, ['log', '--reverse', '--diff-filter=A', '-n', '1', '--format=%H%x1f%aI%x1f%s', '--', ...language.paths]));
    if (record) introductions.set(`language:${language.label}`, record);
  }
  const manifestIntroduction = parseGitRecord(await runGit(root, ['log', '--reverse', '--diff-filter=A', '-n', '1', '--format=%H%x1f%aI%x1f%s', '--', 'package.json', '**/package.json', 'pubspec.yaml', '**/pubspec.yaml', 'pyproject.toml', '**/pyproject.toml']));
  if (manifestIntroduction) introductions.set('framework:package-manifest', manifestIntroduction);
  const moduleIntroduction = parseGitRecord(await runGit(root, ['log', '--reverse', '--diff-filter=A', '-n', '1', '--format=%H%x1f%aI%x1f%s', '--', 'src', 'app', 'lib', 'server', 'client', 'packages', 'apps', 'modules']));
  if (moduleIntroduction) introductions.set('architecture:modules', moduleIntroduction);
  if (scan.projectRoots.size > 1) {
    const nested = [...scan.projectRoots].filter((entry) => entry !== '.').slice(0, 20);
    const nestedIntroduction = parseGitRecord(await runGit(root, ['log', '--reverse', '--diff-filter=A', '-n', '1', '--format=%H%x1f%aI%x1f%s', '--', ...nested]));
    if (nestedIntroduction) introductions.set('architecture:nested-projects', nestedIntroduction);
  }
  return { available: true, head, shallow, commitCount, firstCommit, tags, introductions };
}

async function runGit(root: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFile('git', args, { cwd: root, timeout: 3500, maxBuffer: 512 * 1024, windowsHide: true });
    return result.stdout.trim();
  } catch { return null; }
}

function parseGitRecord(value: string | null): GitRecord | null {
  if (!value) return null;
  const [hash, timestamp, ...subjectParts] = value.split('\x1f');
  if (!hash || !validTimestamp(timestamp)) return null;
  return { hash, timestamp, subject: subjectParts.join('\x1f').trim() };
}

function validTimestamp(value: string | undefined): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

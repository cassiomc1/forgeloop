export type ForgeLoopRiskClass =
  | "READ_ONLY"
  | "LOOP_MUTATION"
  | "CLAIM_REACQUISITION"
  | "EXTERNAL_EXECUTION"
  | "AUTHORITY_MUTATION"
  | "EXTERNAL_STATE_ATTESTATION"
  | "MAINTENANCE"
  | "CLAIM_RELEASE_RECOVERY"
  | "LEGACY_MIGRATION"
  | "FORCE_DESTRUCTIVE";

export interface ForgeLoopCommandInput {
  [key: string]: unknown;
  path?: string;
  taskId?: string | null;
  json?: boolean;
  timeoutMs?: number | null;
  commandArgv?: string[];
}

export interface RepositorySearchRequest {
  pattern: string;
  globs?: string[];
  types?: string[];
  fixedStrings?: boolean;
  ignoreCase?: boolean;
  smartCase?: boolean;
  wordRegexp?: boolean;
  context?: number | null;
  beforeContext?: number | null;
  afterContext?: number | null;
  maxCount?: number | null;
  filesWithMatches?: boolean;
  stats?: boolean;
  /** Explicit host-selected binary override; ForgeLoop never discovers PATH executables. */
  binaryPath?: string;
  /** Preloaded archive used by the managed-engine provisioning path. */
  assetPath?: string;
}

export interface RepositorySearchSubmatch {
  start: number;
  end: number;
  match: string | null;
}

export interface RepositorySearchMatch {
  path: string;
  line: number;
  column: number | null;
  offset: number | null;
  text: string;
  submatches: readonly RepositorySearchSubmatch[];
}

export interface RepositorySearchResult {
  schemaVersion: 1;
  query: RepositorySearchRequest & { globs: readonly string[]; types: readonly string[] };
  repositoryIndex: { engine: string; engineVersion: string | null; indexed: boolean; server: boolean };
  matches: readonly RepositorySearchMatch[];
  contexts: readonly RepositorySearchMatch[];
  files: readonly string[];
  stats: Readonly<Record<string, number>>;
  metrics: {
    queryDurationMs: number;
    nativeDurationMs: number;
    matchCount: number;
    matchedFileCount: number;
    engine: string;
    engineVersion: string | null;
    serverUsed: boolean;
    exitCode: number;
    ignoredNativeEvents: number;
    bytesSearched?: number;
    matchedLines?: number;
  };
}

export interface RepositoryIndexStatus {
  schemaVersion: 1;
  required: true;
  engine: "tgrep";
  engineVersion: string | null;
  managedBinary: boolean;
  overridden: boolean;
  index: {
    present: boolean;
    complete: boolean;
    files: number | null;
    trigrams: number | null;
    createdAt: number | null;
    updatedAt: number | null;
  };
  policy: { maxFileSize: string | number; maxCpuPercent: number; watcherQueueCap: number; autoSaveMutations: number };
  server: { running: boolean; owned: boolean; pid: number | null; port: number | null; watcher: string; indexing: string; files: number | null };
  health: "READY" | "INDEXING" | "NOT_INITIALIZED" | "ENGINE_MISSING" | "ENGINE_INVALID" | "SERVER_DOWN" | "SERVER_UNHEALTHY" | "ERROR";
  diagnostics: readonly { code: string; message: string }[];
}

export declare function repositorySearch(input: RepositorySearchRequest & { projectPath?: string }): Promise<RepositorySearchResult>;
export declare function repositoryIndexStatus(input?: { projectPath?: string; binaryPath?: string; assetPath?: string }): Promise<RepositoryIndexStatus>;

export interface ForgeLoopCommandEnvelope<T = unknown> {
  ok: boolean;
  command: string | null;
  exitCode: number;
  result: T | null;
  error: { code: string; message: string; next?: string } | null;
  metadata: {
    protocolVersion: number;
    integrationApiVersion: number;
    packageVersion?: string;
  };
}

export interface ForgeLoopCommandDefinition {
  name: string;
  category: string;
  mutation: "READ_ONLY" | "MUTATING" | "EXTERNAL_EXECUTION";
  options: Readonly<Record<string, Record<string, unknown>>>;
  writes: readonly string[];
  removes: readonly string[];
  mayExecuteExternalProcess: boolean;
  description: string;
}

export interface ForgeLoopInvocationClassification {
  command: string;
  riskClass: ForgeLoopRiskClass;
  readOnly: boolean;
  mutatesProtocol: boolean;
  removesArtifacts: boolean;
  executesExternalProcess: boolean;
  affectsClaimAuthority: boolean;
  destructive: boolean;
  requiredCapability: string | null;
}

export interface ForgeLoopContext {
  authorityContext: Record<string, unknown>;
  verificationExecutionAdapter?: Record<string, unknown>;
  verificationExecutionPolicy?: { requiredIsolation: string };
  usageProvider?: ForgeLoopUsageProvider;
  structuralQualityProviders?: Readonly<Record<string, ForgeLoopStructuralQualityProvider | ForgeLoopStructuralQualityProviderFactory>>;
  advisoryContextProviders?: Readonly<Record<string, ForgeLoopAdvisoryContextProvider | ForgeLoopAdvisoryContextProviderFactory>>;
}

export interface ForgeLoopAdvisoryContextItem {
  title?: string;
  summary: string;
  sourceRef?: string;
  observedAt?: string;
  confidence?: number;
  itemFingerprint?: string;
}

export interface ForgeLoopAdvisoryContextRecallInput {
  projectPath: string;
  taskId: string;
  query: string;
  limit?: number;
  maxItemChars?: number;
  maxTotalChars?: number;
  timeoutMs?: number;
}

export interface ForgeLoopAdvisoryContextRecallOutput {
  items: Array<{
    title?: string;
    summary: string;
    sourceRef?: string;
    observedAt?: string;
    confidence?: number;
  }>;
}

export interface ForgeLoopAdvisoryRecallOptions {
  limit: number;
  maxItemChars: number;
  maxTotalChars: number;
  timeoutMs: number;
}

export interface ForgeLoopAdvisoryContextProvider {
  id: string;
  version?: string;
  recall(input: ForgeLoopAdvisoryContextRecallInput): Promise<ForgeLoopAdvisoryContextRecallOutput> | ForgeLoopAdvisoryContextRecallOutput;
}

export type ForgeLoopAdvisoryContextProviderFactory = () => ForgeLoopAdvisoryContextProvider | Promise<ForgeLoopAdvisoryContextProvider>;

/** Options for the optional, host-injected Ripwire advisory adapter. */
export interface ForgeLoopRipwireProviderOptions {
  /** Absolute path selected by the host; ForgeLoop does not discover it. */
  executablePath: string;
  /** Exact version string qualified by the host and checked lazily at recall time. */
  expectedVersion: string;
}

export interface ForgeLoopNormalizedAdvisoryContextResult {
  provider: {
    id: string;
    version?: string;
  };
  taskId: string | null;
  authority: "ADVISORY";
  evidenceAuthority: "NONE";
  actionability: "NON_EXECUTABLE";
  trustRole: "NON_EVIDENCE_ADVISORY_CONTEXT";
  persisted: false;
  items: readonly ForgeLoopAdvisoryContextItem[];
}

export interface ForgeLoopStructuralQualityProviderInput {
  projectPath: string;
  taskId: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export type ForgeLoopStructuralQualityProvider = { id: string } & ({
  observe(input: ForgeLoopStructuralQualityProviderInput): Promise<Record<string, unknown>> | Record<string, unknown>;
} | {
  detect(input: ForgeLoopStructuralQualityProviderInput): Promise<Record<string, unknown>> | Record<string, unknown>;
  scan(input: ForgeLoopStructuralQualityProviderInput): Promise<Record<string, unknown>> | Record<string, unknown>;
});

export type ForgeLoopStructuralQualityProviderFactory = (input: ForgeLoopStructuralQualityProviderInput) => ForgeLoopStructuralQualityProvider | Promise<ForgeLoopStructuralQualityProvider>;

export declare const STRUCTURAL_QUALITY_ROOT_CAUSES: readonly ["modularity", "acyclicity", "depth", "equality", "redundancy"];
export declare const STRUCTURAL_QUALITY_MODES: readonly ["off", "observe", "gate"];
export declare const STRUCTURAL_QUALITY_STATUSES: readonly ["PASS", "FAIL", "BLOCKED", "NOT_OBSERVED"];
export declare const STRUCTURAL_QUALITY_CHECK_ID: "structural-quality";
export declare const STRUCTURAL_QUALITY_REQUIREMENT: string;
export declare function assertStructuralQualityProvider(provider: unknown): ForgeLoopStructuralQualityProvider;
export declare function normalizeStructuralQualitySnapshot(input: unknown, options?: { projectPath?: string | null }): Record<string, unknown>;
export declare function normalizeStructuralQualityDetection(input?: Record<string, unknown>, defaults?: Record<string, unknown>): Record<string, unknown>;

export interface ForgeLoopUsageProvider {
  getTaskUsage(input: { projectPath: string; taskId: string }): Promise<ForgeLoopUsage | Record<string, unknown>> | ForgeLoopUsage | Record<string, unknown>;
}

export interface ForgeLoopUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  model: string | null;
  provider: string | null;
  source: "PROVIDER_REPORTED" | "HOST_REPORTED";
}

export interface ForgeLoopContextUsage {
  source: "HOST_REPORTED" | "UNKNOWN";
  profile: "light" | "balanced" | "full" | null;
  items: {
    taskContext: number | null;
    guides: number | null;
    history: number | null;
    protocolInstructions: number | null;
    repositoryContext: number | null;
    other: number | null;
  };
}

export declare const EXECUTION_PROFILES: readonly ["light", "balanced", "full"];
export declare const EXECUTION_PROFILE_REQUESTS: readonly ["auto", "light", "balanced", "full"];
export declare const LEGACY_EXECUTION_PROFILE: "balanced";
export declare function projectExecutionProfile(route?: Record<string, unknown> | null): "light" | "balanced" | "full" | null;
export declare function resolveExecutionProfile(input?: {
  routeInput?: Record<string, unknown>;
  contract?: Record<string, unknown> | null;
  taskDescriptor?: Record<string, unknown> | null;
  configuredProfile?: "auto" | "light" | "balanced" | "full";
  requestedProfile?: "auto" | "light" | "balanced" | "full" | null;
}): {
  requested: "auto" | "light" | "balanced" | "full";
  floor: "light" | "balanced" | "full";
  resolved: "light" | "balanced" | "full";
  reasons: readonly string[];
  escalated: boolean;
};

export interface ForgeLoopExecutionProfileContext {
  schemaVersion: 1;
  protocolVersion: 1;
  taskId: string;
  executionProfile: {
    requested: "auto" | "light" | "balanced" | "full";
    floor: "light" | "balanced" | "full";
    resolved: "light" | "balanced" | "full";
    reasons: readonly string[];
    escalated: boolean;
  };
  phase: string;
  nextAction: string | null;
  objective: string | null;
  deliverables: readonly string[];
  constraints: readonly string[];
  selectedGuideIds: readonly string[];
  verificationRequirements: readonly Record<string, unknown>[];
  contextPolicy: Record<string, unknown>;
  contextUsage?: ForgeLoopContextUsage;
  optionalContext: { available: readonly string[]; loaded: readonly string[] };
  invariants: Record<string, boolean>;
}

export declare const PROFILE_CONTEXT_POLICIES: Readonly<Record<string, Record<string, unknown>>>;
export declare function getExecutionProfileContextPolicy(profile: "light" | "balanced" | "full"): Record<string, unknown>;
export declare function legacyExecutionProfile(): ForgeLoopExecutionProfileContext["executionProfile"];
export declare function projectExecutionProfileContext(input: Record<string, unknown>): ForgeLoopExecutionProfileContext;
export declare function buildExecutionProfileContext(input: {
  target: string;
  packageRoot?: string;
  taskId: string;
  authorityContext?: Record<string, unknown>;
  runtimeContext?: Record<string, unknown>;
}): Promise<ForgeLoopExecutionProfileContext>;

export declare const FORGELOOP_INTEGRATION_API_VERSION: number;
export declare const FORGELOOP_INTEGRATION_RUNTIME_VERSION: number;
export declare const CLI_COMMAND_DEFINITIONS: Readonly<Record<string, ForgeLoopCommandDefinition>>;
export declare const INTEGRATION_LIMITS: Readonly<Record<string, number>>;
export declare const INTEGRATION_RISK_CLASSES: Readonly<Record<string, ForgeLoopRiskClass>>;
export declare const INTEGRATION_RESOURCE_DEFINITIONS: Readonly<Record<string, { scope: string; description: string }>>;
export declare const VERIFICATION_EXECUTION_POLICY_MODES: readonly string[];
export declare const VERIFICATION_ISOLATION_MODES: readonly string[];

export declare function getForgeLoopPackageVersion(): string;
export declare function defaultCommandInputValues(): ForgeLoopCommandInput;
export declare function validateForgeLoopCommandInput(input: {
  command: string;
  input?: ForgeLoopCommandInput;
  help?: boolean;
}): void;
export declare function executeForgeLoopCommand<T = unknown>(input: {
  command: string;
  projectPath?: string;
  input?: ForgeLoopCommandInput;
  authorityContext?: Record<string, unknown>;
  runtimeContext?: Record<string, unknown>;
}): Promise<ForgeLoopCommandEnvelope<T>>;
export declare function getForgeLoopCapabilities(input?: { packageVersion?: string | null }): Record<string, unknown>;
export declare function classifyForgeLoopInvocation(command: string, input?: ForgeLoopCommandInput): ForgeLoopInvocationClassification;
export declare function readForgeLoopIntegrationResource(uri: string, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function resolveForgeLoopProjectRoot(projectPath?: string, input?: { cwd?: string }): Promise<string>;
export declare function searchRepository(request: RepositorySearchRequest & { repoRoot: string }): Promise<RepositorySearchResult>;
export declare function searchRepository(projectPath: string, request: RepositorySearchRequest): Promise<RepositorySearchResult>;
export declare function getRepositoryIndexStatus(projectPath: string, options?: Record<string, unknown>): Promise<RepositoryIndexStatus>;
export declare function setupRepositoryIndex(projectPath: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function startRepositoryIndexServer(projectPath: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function stopRepositoryIndexServer(projectPath: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function rebuildRepositoryIndex(projectPath: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function restartRepositoryIndexServer(projectPath: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function createForgeLoopContext(input?: Record<string, unknown>): ForgeLoopContext;
export declare function recallAdvisoryContext(input: {
  target: string;
  taskId: string;
  providerName: string;
  query: string;
  limit?: number;
  maxItemChars?: number;
  maxTotalChars?: number;
  timeoutMs?: number;
  runtimeContext?: ForgeLoopContext | Record<string, unknown>;
}): Promise<ForgeLoopNormalizedAdvisoryContextResult>;
export declare function createRipwireAdvisoryContextProvider(
  options: ForgeLoopRipwireProviderOptions,
): ForgeLoopAdvisoryContextProvider;
export declare const ADVISORY_CONTEXT_LIMITS: Readonly<Record<string, number>>;
export declare const ADVISORY_CONTEXT_TRUST: Readonly<Record<string, unknown>>;
export declare function normalizeAdvisoryRecallOptions(input?: Partial<ForgeLoopAdvisoryRecallOptions>): ForgeLoopAdvisoryRecallOptions;
export declare function assertAdvisoryContextProvider(provider: unknown): ForgeLoopAdvisoryContextProvider;
export declare function assertAdvisoryContextProviderIdentity(provider: unknown, expectedId: string): ForgeLoopAdvisoryContextProvider;
export declare function createAdvisoryContextProviderRegistry(options?: { providers?: Record<string, unknown> }): {
  get(id: string): unknown;
  has(id: string): boolean;
  list(): string[];
};
export declare function resolveAdvisoryContextProvider(options: {
  providers?: Record<string, unknown> | Map<string, unknown> | { get(id: string): unknown; has(id: string): boolean };
  providerName: string;
}): Promise<ForgeLoopAdvisoryContextProvider | null>;
export declare function normalizeAdvisoryContextResult(raw: unknown, options?: Record<string, unknown>): ForgeLoopNormalizedAdvisoryContextResult;
export declare function normalizePortableText(value: unknown, options?: { label?: string; maxLength?: number; optional?: boolean }): string | null;
export declare function assertPortableContextSafe<T = unknown>(value: T, options?: { label?: string }): T;
export declare class PortableContextError extends Error {
  code: string;
}
export declare function acceptCanonicalHandoff(target: string, options: {
  taskId: string;
  handoffId: string;
  consumerId: string;
  harness?: string | null;
  packageRoot?: string;
}): Promise<{
  accepted: boolean;
  idempotent: boolean;
  handoffId: string;
  consumerId: string;
  harness: string | null;
  acceptedAt: string;
}>;
export declare function resolveHandoffAcceptance(input: {
  events?: readonly unknown[];
  handoff: unknown;
  ledgerValid?: boolean;
  ledgerErrors?: readonly ({ code?: string } | string)[];
}): {
  status: "OPEN" | "ACCEPTED" | "INCONSISTENT" | "UNBOUND";
  consumerId?: string;
  harness?: string;
  acceptedAt?: string;
  reasonCodes?: readonly string[];
};

export declare const E_VERIFICATION_EXECUTION_INVALID: "E_VERIFICATION_EXECUTION_INVALID";
export declare const E_VERIFICATION_ISOLATION_UNAVAILABLE: "E_VERIFICATION_ISOLATION_UNAVAILABLE";
export declare function createStructuralQualityProviderRegistry(options?: {
  providers?: Readonly<Record<string, ForgeLoopStructuralQualityProvider | ForgeLoopStructuralQualityProviderFactory>>;
  builtIns?: Readonly<Record<string, ForgeLoopStructuralQualityProvider | ForgeLoopStructuralQualityProviderFactory>>;
}): { resolve(name: string, input: ForgeLoopStructuralQualityProviderInput): Promise<ForgeLoopStructuralQualityProvider> };
export declare function resolveStructuralQualityProvider(options: {
  providerName?: string;
  target: string;
  taskId: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  runtimeContext?: ForgeLoopContext;
}): Promise<ForgeLoopStructuralQualityProvider>;

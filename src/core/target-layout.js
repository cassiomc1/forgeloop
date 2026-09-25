export const LAYOUT_VERSION = 2;
export const LEGACY_LAYOUT_VERSION = 1;
export const FORGELOOP_DIR = ".forgeloop";
export const FORGELOOP_KIT_DIR = ".forgeloop/kit";
export const PROFILE_PATH = `${FORGELOOP_KIT_DIR}/PROJECT_PROFILE.md`;
export const LEGACY_PROFILE_PATH = "PROJECT_PROFILE.md";

export const NATIVE_ADAPTER_PATHS = Object.freeze([
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules/project-loop.mdc",
  ".github/copilot-instructions.md",
]);

const NATIVE_ADAPTER_SET = new Set(NATIVE_ADAPTER_PATHS);

export function isNativeAdapterPath(relativePath) {
  return NATIVE_ADAPTER_SET.has(relativePath);
}

export function targetPathForSource(sourcePath) {
  if (sourcePath === ".forgeloop/.gitignore" || isNativeAdapterPath(sourcePath)) {
    return sourcePath;
  }
  return `${FORGELOOP_KIT_DIR}/${sourcePath}`;
}

export function legacyPathForSource(sourcePath) {
  return sourcePath;
}

export function isKitPath(relativePath) {
  return relativePath === FORGELOOP_KIT_DIR || relativePath.startsWith(`${FORGELOOP_KIT_DIR}/`);
}

export function profilePathForLayout(layoutVersion = LAYOUT_VERSION) {
  return layoutVersion >= LAYOUT_VERSION ? PROFILE_PATH : LEGACY_PROFILE_PATH;
}

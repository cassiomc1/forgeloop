import { REPOSITORY_INDEX_ERROR_CODES, repositoryIndexError } from "./errors.js";

const SUPPORTED = new Map([
  ["darwin:arm64", "darwin-arm64"],
  ["darwin:x64", "darwin-x64"],
  ["linux:x64", "linux-x64"],
  ["win32:x64", "windows-x64"],
]);

export function getRepositoryIndexPlatform({ platform = process.platform, arch = process.arch } = {}) {
  const key = SUPPORTED.get(`${platform}:${arch}`);
  if (!key) {
    throw repositoryIndexError(
      REPOSITORY_INDEX_ERROR_CODES.PLATFORM_UNSUPPORTED,
      `Repository Index does not support platform ${platform}/${arch}`,
      { platform, arch },
    );
  }
  return Object.freeze({ platform, arch, key });
}

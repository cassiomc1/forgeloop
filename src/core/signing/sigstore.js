import { needsExistingProjectScope, withExistingProjectScope } from "../../storage/existing-project-scope.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import path from "node:path";
import { ensureWithin, assertSafePath } from "../filesystem.js";
import { withSigningStatementFile } from "./statement-file.js";
import { withSigningBundleFile } from "./bundle-file.js";
import { getOperationalStore } from "../../storage/operational-context.js";
import { withOperationalAttachmentFile } from "../../storage/operational-attachments.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

async function withExistingSigningReadScope(target, read) {
  if (await needsExistingProjectScope(target)) return withExistingProjectScope(target, read, { readOnly: true });
  return read();
}

function signingTaskId(target, statementPath) {
  const store = getOperationalStore(target);
  const taskKey = /^\.forgeloop\/task-state\/([a-f0-9]{64})\/attestations\/statement\.json$/u.exec(statementPath)?.[1];
  const taskId = store && taskKey ? store.taskRow(taskKey)?.task_id : null;
  return taskId;
}

export function createSigstoreSigningProvider({
  command = "cosign",
  execFileImpl = execFileAsync,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const run = (args, options = {}) => execFileImpl(command, args, {
    windowsHide: true,
    shell: false,
    cwd: options.cwd,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const provider = {
    name: "sigstore",
    async detect() {
      try {
        await run(["version"]);
        return true;
      } catch {
        return false;
      }
    },
    async sign({ target, statementPath, outputPath, bundlePath } = {}) {
      const destinationPath = outputPath ?? bundlePath;
      if (!destinationPath) {
        return {
          status: "INVALID",
          code: "E_ATTESTATION_SIGNATURE_INVALID",
          message: "A Sigstore bundle output path is required",
        };
      }
      try {
        await assertSafePath(target, statementPath);
        await assertSafePath(target, destinationPath);
        const signed = await withSigningBundleFile(target, destinationPath, statementPath, bundleAbsolute => withSigningStatementFile(target, statementPath, statementAbsolute => run([
          "attest-blob",
          "--statement", statementAbsolute,
          "--bundle", bundleAbsolute,
          "--yes",
        ], { cwd: path.resolve(target) })));
        return { status: "VALID", ...signed };
      } catch (error) {
        const unavailable = error.code === "ENOENT" || error.cause?.code === "ENOENT";
        const timedOut = error.code === "ETIMEDOUT" || error.killed === true || error.signal === "SIGTERM";
        return {
          status: "INVALID",
          code: unavailable || timedOut ? "E_ATTESTATION_SIGNER_UNAVAILABLE" : "E_ATTESTATION_SIGNATURE_INVALID",
          message: unavailable
            ? "cosign is unavailable for Sigstore signing"
            : timedOut
              ? "Sigstore signing timed out"
              : "Sigstore signing failed",
        };
      }
    },
    async verify({ target, statementPath, bundlePath, policy = {} } = {}) {
      if (!bundlePath) return { status: "UNSIGNED", signer: null };
      try {
        return await withExistingSigningReadScope(target, async () => {
          await assertSafePath(target, statementPath);
          await assertSafePath(target, bundlePath);
          const taskId = signingTaskId(target, statementPath);
          const statementAbsolute = ensureWithin(target, statementPath);
          const bundleAbsolute = ensureWithin(target, bundlePath);
          const args = [
            "verify-blob-attestation",
            "--statement", statementAbsolute,
            "--bundle", bundleAbsolute,
          ];
          const identities = Array.isArray(policy.identities)
            ? [...new Set(policy.identities.filter((value) => typeof value === "string" && value.length > 0))]
            : [];
          if (policy.identity) args.push("--certificate-identity", policy.identity);
          else if (identities.length === 1) args.push("--certificate-identity", identities[0]);
          else if (identities.length > 1) {
            const exactAlternatives = identities
              .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
              .join("|");
            args.push("--certificate-identity-regexp", `^(?:${exactAlternatives})$`);
          }
          if (policy.issuer) args.push("--certificate-oidc-issuer", policy.issuer);
          if (policy.trustedRoot) {
            await assertSafePath(target, policy.trustedRoot);
            args.push("--trusted-root", ensureWithin(target, policy.trustedRoot));
          }
          await withSigningStatementFile(target, statementPath, statementFilename => {
            args[args.indexOf("--statement") + 1] = statementFilename;
            return withOperationalAttachmentFile(target, bundlePath, taskId, bundleFilename => {
              args[args.indexOf("--bundle") + 1] = bundleFilename;
              return run(args, { cwd: path.resolve(target) });
            });
          });
          return { status: "VALID", signer: policy.identity ?? (identities.length === 1 ? identities[0] : null) };
        });
      } catch (error) {
        if (error.code === "E_ATTESTATION_SIGNER_UNAVAILABLE") throw error;
        const unavailable = error.code === "ENOENT" || error.cause?.code === "ENOENT";
        const timedOut = error.code === "ETIMEDOUT" || error.killed === true || error.signal === "SIGTERM";
        const outputLimit = error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        const diagnostic = `${error.stderr ?? error.cause?.stderr ?? ""}`.toLowerCase();
        const identityUntrusted = Boolean(policy.identity) && /identity|certificate-identity|subject/iu.test(diagnostic);
        const issuerUntrusted = Boolean(policy.issuer) && /issuer|oidc/iu.test(diagnostic);
        return {
          status: "INVALID",
          code: unavailable || timedOut || outputLimit
            ? "E_ATTESTATION_SIGNER_UNAVAILABLE"
            : identityUntrusted
              ? "E_ATTESTATION_IDENTITY_UNTRUSTED"
              : issuerUntrusted
                ? "E_ATTESTATION_ISSUER_UNTRUSTED"
                : "E_ATTESTATION_SIGNATURE_INVALID",
          message: unavailable
            ? "cosign is unavailable for Sigstore verification"
            : timedOut
              ? "Sigstore verification timed out"
              : outputLimit
                ? "Sigstore verification exceeded the output limit"
                : identityUntrusted
                  ? "Sigstore signer identity is not trusted"
                  : issuerUntrusted
                    ? "Sigstore certificate issuer is not trusted"
              : "Sigstore signature verification failed",
        };
      }
    },
  };
  return provider;
}

/**
 * Convenience wrapper for callers that only need to verify one bundle.
 * All process, path, timeout, and output-boundary rules remain owned by the
 * canonical signing provider.
 */
export async function verifySigstoreBundle({
  target,
  statementPath,
  bundlePath,
  identity = null,
  issuer = null,
  trustedRootPath = null,
  command = "cosign",
  execFileImpl = execFileAsync,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const provider = createSigstoreSigningProvider({ command, execFileImpl, timeoutMs });
  return provider.verify({
    target,
    statementPath,
    bundlePath,
    policy: {
      ...(identity ? { identity } : {}),
      ...(issuer ? { issuer } : {}),
      ...(trustedRootPath ? { trustedRoot: trustedRootPath } : {}),
    },
  });
}

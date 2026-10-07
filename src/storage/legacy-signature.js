import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { assertSafePath } from "../core/filesystem.js";
import { taskAttestationBundlePath, taskAttestationStatementPath, taskAttestationStatementHistoryPath } from "../core/task-paths.js";
import { validateAttestationStatement } from "../core/attestation.js";
import { legacyAttachmentReferenceId, signatureReferencePrefix } from "../core/signing/bundle-reference.js";
import { publishAttachmentFile } from "./attachment-files.js";
import { validateAttachmentReference } from "./attachment-binding.js";
import { assertTaskDescriptorIdentity } from "../core/task-identity.js";
import { assertJsonLimits, JSON_LIMITS } from "../core/json-safety.js";

function invalid(message) { return Object.assign(new Error(message), { code: "E_STORAGE_ATTACHMENT_INVALID" }); }

function assertInventoryFile(file, expectedPath) {
  if (!file || file.path !== expectedPath || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/u.test(file.sha256 ?? "")) {
    throw invalid("Legacy signature preparation requires task-scoped recorded source bindings");
  }
}

async function recordedStream(root, file) {
  const filename = await assertSafePath(root, file.path);
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.size !== file.size) throw invalid("Legacy attachment source disagrees with recorded file size/type");
  return Readable.from((async function* () {
    let size = 0;
    for await (const bytes of createReadStream(filename)) {
      size += bytes.length;
      if (size > file.size) throw invalid("Legacy attachment source grew beyond recorded size");
      yield bytes;
    }
  })());
}

async function recordedDescriptor(root, file, taskKey) {
  assertInventoryFile(file, `.forgeloop/task-state/${taskKey}/task.json`);
  if (file.size > JSON_LIMITS.maxBytes) throw invalid("Recorded task descriptor exceeds the JSON byte limit");
  const chunks = [];
  for await (const bytes of await recordedStream(root, file)) chunks.push(bytes);
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== file.size || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw invalid("Recorded task descriptor bytes changed");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw invalid("Recorded task descriptor is not UTF-8");
  const descriptor = JSON.parse(text);
  assertJsonLimits(descriptor, "Recorded task descriptor");
  assertTaskDescriptorIdentity(descriptor, null, taskKey);
  return descriptor;
}

/** Discover only captured signatures; no live directory scan or invented task IDs. */
export async function prepareRecordedLegacySignatures(sourceRoot, attachmentRoot, files, { packageRoot } = {}) {
  if (!Array.isArray(files)) throw invalid("Recorded signature discovery requires a source inventory");
  const relevant = new Map();
  const signatures = [];
  for (const file of files) {
    if (!file || typeof file.path !== "string") throw invalid("Malformed recorded source entry");
    if (file.path.endsWith("/task.json") || file.path.endsWith("/statement.json") || file.path.endsWith("/statement.sigstore.json")) {
      if (relevant.has(file.path)) throw invalid("Duplicate recorded signature source entry");
      relevant.set(file.path, file);
    }
    if (file.path.endsWith("/statement.sigstore.json")) signatures.push(file);
  }
  const descriptors = new Map();
  const references = [];
  const mappings = [];
  for (const signature of signatures.sort((left, right) => left.path.localeCompare(right.path))) {
    const match = /^\.forgeloop\/task-state\/([a-f0-9]{64})\/attestations\/(?:history\/cycle-([1-9][0-9]*)\/)?statement\.sigstore\.json$/u.exec(signature.path);
    if (!match) throw invalid("Recorded signature has no supported task namespace mapping");
    const taskKey = match[1];
    let descriptor = descriptors.get(taskKey);
    if (!descriptor) {
      descriptor = await recordedDescriptor(sourceRoot, relevant.get(`.forgeloop/task-state/${taskKey}/task.json`), taskKey);
      descriptors.set(taskKey, descriptor);
    }
    const statement = relevant.get(signature.path.replace(/statement\.sigstore\.json$/u, "statement.json"));
    const prepared = await prepareLegacySignatureAttachment(sourceRoot, attachmentRoot, {
      taskId: descriptor.taskId, signature, statement, packageRoot,
      verificationCycle: match[2] === undefined ? null : Number(match[2]),
    });
    references.push(...prepared.references);
    mappings.push(prepared);
  }
  return { root: attachmentRoot, references, mappings };
}

/** Prepare external bytes separately; the caller owns atomic binding publication. */
export async function prepareLegacySignatureAttachment(sourceRoot, attachmentRoot, { taskId, signature, statement, packageRoot, verificationCycle = null } = {}) {
  if (verificationCycle !== null && (!Number.isSafeInteger(verificationCycle) || verificationCycle < 1)) throw invalid("Invalid historical signature cycle");
  const statementPath = verificationCycle === null ? taskAttestationStatementPath(taskId) : taskAttestationStatementHistoryPath(taskId, verificationCycle);
  const signaturePath = verificationCycle === null ? taskAttestationBundlePath(taskId) : statementPath.replace(/\.json$/u, ".sigstore.json");
  assertInventoryFile(signature, signaturePath);
  assertInventoryFile(statement, statementPath);
  const source = await realpath(sourceRoot);
  const destination = await realpath(attachmentRoot);
  const inside = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
  if (inside(source, destination) || inside(destination, source)) throw invalid("Attachment preparation must not overlap the retained source tree");
  if (statement.size > 64 * 1024 * 1024) throw invalid("Legacy attestation statement exceeds the supported byte limit");
  const chunks = [];
  let size = 0;
  for await (const chunk of await recordedStream(source, statement)) { chunks.push(chunk); size += chunk.length; }
  const bytes = Buffer.concat(chunks, size);
  if (bytes.length !== statement.size || createHash("sha256").update(bytes).digest("hex") !== statement.sha256) throw invalid("Legacy statement disagrees with recorded source bytes");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw invalid("Legacy statement is not valid UTF-8");
  const value = await validateAttestationStatement(JSON.parse(text), packageRoot);
  if (value.predicate.task.taskId !== taskId) throw invalid("Legacy statement belongs to another task");
  if (verificationCycle !== null && value.predicate.task.verificationCycle !== verificationCycle) throw invalid("Historical statement disagrees with its source cycle");
  const binding = await publishAttachmentFile(destination, await recordedStream(source, signature));
  if (binding.size !== signature.size || binding.sha256 !== signature.sha256) throw invalid("Legacy signature disagrees with recorded source bytes");
  const alias = legacyAttachmentReferenceId(signature.path);
  const references = [alias, `${signatureReferencePrefix(text)}${alias}`].map(referenceId => validateAttachmentReference({ taskId, referenceId, ...binding }));
  return { sourcePath: signature.path, statementPath: statement.path, statementByteSha256: statement.sha256, binding, references };
}

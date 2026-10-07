import { createHash } from "node:crypto";
import { canonicalFingerprint } from "../core/artifacts.js";

/** Validate byte evidence separately from the domain payload schema. */
export function artifactByteDigest(record) {
  if (typeof record?.sourceText !== "string" || typeof record?.byteDigest !== "string") {
    const error = new Error("Original artifact byte evidence is unavailable");
    error.code = "E_STORAGE_ARTIFACT_BYTES_UNAVAILABLE";
    throw error;
  }
  try {
    const digest = createHash("sha256").update(record.sourceText).digest("hex");
    if (digest !== record.byteDigest || canonicalFingerprint(JSON.parse(record.sourceText)) !== canonicalFingerprint(record.payload)) {
      throw new Error("Artifact source bytes, digest and canonical payload disagree");
    }
    return digest;
  } catch (cause) {
    const error = new Error("Stored artifact byte evidence is invalid", { cause });
    error.code = "E_STORAGE_ARTIFACT_INVALID";
    throw error;
  }
}

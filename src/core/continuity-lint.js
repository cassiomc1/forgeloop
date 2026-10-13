import { assertSafePath, ensureWithin, fileExists } from "./filesystem.js";
import { operationalArtifactExists } from "../storage/operational-context.js";
import { withProjectReadSnapshot } from "../storage/project-read-snapshot.js";

function finding(code, severity, field, itemId = null) {
  return { code, severity, field, itemId };
}

function hasOperationalHints(continuity) {
  return Boolean(
    continuity.currentFocus
    || continuity.remainingWork?.length
    || continuity.knownIssues?.length
    || continuity.changedAreas?.length
    || continuity.inspectFirst?.length
    || (typeof continuity.resumeNote === "string" && continuity.resumeNote.trim() !== ""),
  );
}

async function inspectPathExists(target, relativePath) {
  return operationalArtifactExists(target, relativePath) ?? await fileExists(ensureWithin(target, relativePath));
}

export async function lintContinuity(options = {}) {
  if (typeof options.target !== "string" || options.target.trim() === "") return lintSelectedContinuity(options);
  return withProjectReadSnapshot(options.target, () => lintSelectedContinuity(options));
}

async function lintSelectedContinuity({ target, continuity, state } = {}) {
  const findings = [];
  if (!continuity || typeof continuity !== "object" || Array.isArray(continuity)) {
    return { status: "PASS", findings };
  }

  const completedSteps = new Set(
    Array.isArray(state?.completedSteps) ? state.completedSteps : [],
  );

  for (const [index, item] of (continuity.remainingWork ?? []).entries()) {
    if (!item?.id) continue;
    if (completedSteps.has(item.id)) {
      findings.push(finding(
        "CONTINUITY_REMAINING_ALREADY_COMPLETED",
        "WARN",
        `remainingWork[${index}]`,
        item.id,
      ));
    }
  }

  if (continuity.currentFocus?.id && completedSteps.has(continuity.currentFocus.id)) {
    findings.push(finding(
      "CONTINUITY_FOCUS_ALREADY_COMPLETED",
      "WARN",
      "currentFocus",
      continuity.currentFocus.id,
    ));
  }

  const knownIssueIds = new Set(
    (continuity.knownIssues ?? []).map((item) => item?.id).filter(Boolean),
  );
  for (const [index, item] of (continuity.remainingWork ?? []).entries()) {
    if (item?.id && knownIssueIds.has(item.id)) {
      findings.push(finding(
        "CONTINUITY_ITEM_ROLE_CONFLICT",
        "WARN",
        `remainingWork[${index}]`,
        item.id,
      ));
    }
  }

  if (typeof target === "string" && target.trim() !== "") {
    for (const [index, inspectPath] of (continuity.inspectFirst ?? []).entries()) {
      try {
        await assertSafePath(target, inspectPath);
        if (!(await inspectPathExists(target, inspectPath))) {
          findings.push(finding(
            "CONTINUITY_INSPECT_PATH_MISSING",
            "WARN",
            `inspectFirst[${index}]`,
          ));
        }
      } catch {
        // Invalid or unsafe paths are rejected by continuity schema validation;
        // lint never resolves an unchecked path or turns it into authority.
      }
    }
  }

  if (!hasOperationalHints(continuity)) {
    findings.push(finding("CONTINUITY_EMPTY_HINT_SET", "INFO", "continuity"));
  }

  return {
    status: findings.some((item) => item.severity === "WARN") ? "WARN" : "PASS",
    findings,
  };
}

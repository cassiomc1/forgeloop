#!/usr/bin/env python3
"""Detect secret-shaped values in repository-maintained text files."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import re
import sys


TEXT_SUFFIXES = {
    ".bash",
    ".cjs",
    ".cfg",
    ".conf",
    ".json",
    ".jsonc",
    ".js",
    ".jsx",
    ".key",
    ".md",
    ".mdc",
    ".mjs",
    ".pem",
    ".properties",
    ".py",
    ".sh",
    ".toml",
    ".txt",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
    ".zsh",
}
TEXT_FILENAMES = {".env", ".envrc", ".gitignore", ".npmrc"}
EXCLUDED_PARTS = {
    ".git",
    ".worktrees",
    ".superpowers",
    "__pycache__",
    ".commandcode",
    "node_modules",
    "coverage",
}
EXCLUDED_PREFIXES = {
    ("vendor", "archify"),
}

TOKEN_PATTERNS = (
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    (
        "github-token",
        re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    ),
    ("gitlab-token", re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("openai-token", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b")),
    (
        "jwt-token",
        re.compile(
            r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\."
            r"[A-Za-z0-9_-]{16,}\b"
        ),
    ),
)

SENSITIVE_LABEL = re.compile(
    r"(?i)\b(?:password|passwd|token|secret|api[ _-]*key|credential|"
    r"private[ _-]*key)\b"
)
ASSIGNMENT = re.compile(
    r"^\s*(?![-*+]\s)[\"']?(?P<label>[A-Za-z0-9_. -]+?)[\"']?\s*[:=]\s*"
    r"(?P<value>.+?)\s*$"
)
ENVIRONMENT_REFERENCE = re.compile(
    r"^(?:\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^{}]+\}|\$\{\{[^{}]+\}\}|"
    r"%[A-Za-z_][A-Za-z0-9_]*%)$"
)
GITHUB_ACTIONS_PERMISSION = re.compile(r"^\.github[\\/]workflows[\\/]")
NPM_AUTH_ASSIGNMENT = re.compile(
    r"^\s*//[^=\s]+:\s*_authToken\s*=\s*(?P<value>.+?)\s*$"
)
SAFE_PLACEHOLDERS = {
    "example",
    "masked",
    "n/a",
    "none",
    "not applicable",
    "not identified",
    "redacted",
    "unknown",
}

SENSITIVE_TABLE_LABELS = {
    "password",
    "passwd",
    "token",
    "secret",
    "api token",
    "api key",
    "access token",
    "auth token",
    "credential",
    "credentials",
    "client secret",
    "private key",
}


@dataclass(frozen=True)
class Finding:
    """A redacted secret finding."""

    rule: str
    path: Path
    line: int


def should_scan_path(path: Path) -> bool:
    """Return whether a repository-relative path is maintained text."""

    if EXCLUDED_PARTS.intersection(path.parts) or any(
        path.parts[: len(prefix)] == prefix for prefix in EXCLUDED_PREFIXES
    ):
        return False
    name = path.name.lower()
    is_environment_file = name == ".env" or name.startswith(".env.")
    return (
        is_environment_file
        or name in TEXT_FILENAMES
        or path.suffix.lower() in TEXT_SUFFIXES
    )


def is_placeholder(raw_value: str) -> bool:
    """Return whether a sensitive field contains an explicit safe placeholder."""

    value = raw_value.strip().rstrip(",;").strip().strip("`\"'").strip()
    folded = value.casefold()
    if folded in SAFE_PLACEHOLDERS:
        return True
    if any(folded.startswith(f"{prefix} ") for prefix in SAFE_PLACEHOLDERS):
        return True
    if value.startswith("<") and value.endswith(">"):
        return True
    if ENVIRONMENT_REFERENCE.fullmatch(value):
        return True
    if len(value) >= 4 and not value.strip("*xX•.-"):
        return True
    return False


def is_sensitive_table_label(value: str) -> bool:
    """Return whether a Markdown first-column cell is a sensitive field label.

    The scanner treats a table row as a sensitive-value field only when its
    first cell is a concise field label, not descriptive threat prose that
    merely contains a sensitive term. Matching is against an exact normalized
    label vocabulary, with underscores and hyphens folded to spaces so
    variants such as "api_key" or "private-key" stay detected, while
    sentences such as "Credential or path leakage in errors and results"
    are not.
    """

    normalized = value.strip().strip("`\"'").casefold()
    normalized = re.sub(r"[_-]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized in SENSITIVE_TABLE_LABELS


def is_github_actions_permission(label: str, value: str, path: Path) -> bool:
    """Return whether a token-looking YAML permission is non-secret metadata."""

    return (
        label.strip().casefold() == "id-token"
        and value.strip().casefold() in {"read", "write", "none"}
        and bool(GITHUB_ACTIONS_PERMISSION.match(path.as_posix()))
    )


def _add_finding(
    findings: list[Finding],
    seen: set[tuple[str, int]],
    rule: str,
    path: Path,
    line: int,
) -> None:
    key = (rule, line)
    if key not in seen:
        findings.append(Finding(rule=rule, path=path, line=line))
        seen.add(key)


def scan_text(text: str, path: Path) -> list[Finding]:
    """Scan text and return redacted findings ordered by line and rule."""

    findings: list[Finding] = []
    seen: set[tuple[str, int]] = set()

    for rule, pattern in TOKEN_PATTERNS:
        for match in pattern.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            _add_finding(findings, seen, rule, path, line)

    for line_number, line in enumerate(text.splitlines(), 1):
        npm_auth = NPM_AUTH_ASSIGNMENT.fullmatch(line)
        if npm_auth and not is_placeholder(npm_auth.group("value")):
            _add_finding(findings, seen, "npm-auth-token", path, line_number)

        assignment = ASSIGNMENT.fullmatch(line)
        if assignment and SENSITIVE_LABEL.search(assignment.group("label")):
            if is_github_actions_permission(
                assignment.group("label"), assignment.group("value"), path
            ):
                continue
            if not is_placeholder(assignment.group("value")):
                _add_finding(
                    findings,
                    seen,
                    "sensitive-assignment",
                    path,
                    line_number,
                )

        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [cell.strip() for cell in stripped[1:-1].split("|")]
            if len(cells) >= 2 and is_sensitive_table_label(cells[0]):
                if not is_placeholder(cells[1]):
                    _add_finding(
                        findings,
                        seen,
                        "sensitive-table-value",
                        path,
                        line_number,
                    )

    return sorted(findings, key=lambda finding: (finding.line, finding.rule))


def iter_scannable_files(root: Path):
    """Yield maintained text files without following excluded trees."""

    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_symlink():
            relative = path.relative_to(root)
            if should_scan_path(relative):
                yield path, relative


def scan_repository(root: Path) -> list[Finding]:
    """Scan repository-maintained text without returning candidate values."""

    findings: list[Finding] = []
    for path, relative in iter_scannable_files(root.resolve()):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        findings.extend(scan_text(text, relative))
    return findings


def format_finding(finding: Finding) -> str:
    """Format a redacted diagnostic."""

    return (
        f"{finding.path}:{finding.line}: secret-like value detected "
        f"[{finding.rule}]"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    root = args.root.resolve()
    findings = scan_repository(root)
    if findings:
        for finding in findings:
            print(format_finding(finding), file=sys.stderr)
        print(f"secret scan failed: {len(findings)} finding(s)", file=sys.stderr)
        return 1

    scanned = sum(1 for _ in iter_scannable_files(root))
    print(f"secret scan passed: {scanned} text files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate the portable universal project-loop instruction kit."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
import tempfile


REQUIRED_FILES = (
    "LOOP_ENGINEERING.md",
    "GUIDE_ROUTER.md",
    "PROJECT_PROFILE.md",
    "LOOP_SYSTEM_DESIGN.md",
    "THIRD_PARTY_NOTICES.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".github/copilot-instructions.md",
    ".cursor/rules/project-loop.mdc",
    "QUALITY_SCORECARD.md",
    "TERMINOLOGY.md",
    "ORCHESTRATOR_INTEGRATION.md",
    "THREAT_MODEL.md",
    "CONTRACT_COVERAGE.md",
    "PROTOCOL_INTEGRATION.md",
)

WORK_PHASES = (
    "RECEIVED",
    "DISCOVERING",
    "CONTRACT_READY",
    "ROUTED",
    "DESIGNING",
    "PLANNED",
    "EXECUTING",
    "VERIFYING",
    "DIAGNOSING",
    "CORRECTING",
    "REVIEWING",
    "COMPLETE",
    "BLOCKED",
)

WORK_TRANSITIONS = (
    ("RECEIVED", "DISCOVERING"),
    ("DISCOVERING", "CONTRACT_READY"),
    ("CONTRACT_READY", "ROUTED"),
    ("ROUTED", "DESIGNING"),
    ("ROUTED", "PLANNED"),
    ("DESIGNING", "PLANNED"),
    ("PLANNED", "EXECUTING"),
    ("EXECUTING", "VERIFYING"),
    ("VERIFYING", "DIAGNOSING"),
    ("DIAGNOSING", "CORRECTING"),
    ("CORRECTING", "VERIFYING"),
    ("VERIFYING", "REVIEWING"),
    ("REVIEWING", "COMPLETE"),
    ("Any non-terminal state", "BLOCKED"),
)

SCHEMA_FILES = (
    "routing-input.schema.json",
    "routing-result.schema.json",
    "work-state.schema.json",
    "execution-receipt.schema.json",
    "task-brief.schema.json",
    "delegated-result.schema.json",
    "evidence.schema.json",
    "current-contract.schema.json",
    "gate.schema.json",
    "source-registry.schema.json",
    "config.schema.json",
    "preflight.schema.json",
    "check.schema.json",
    "execution.schema.json",
    "evidence-coverage.schema.json",
    "event.schema.json",
    "activation.schema.json",
    "policy.schema.json",
    "task-bundle.schema.json",
)

FAILURE_CLASSES = (
    "CONTRACT_FAILURE",
    "DISCOVERY_FAILURE",
    "ROUTING_FAILURE",
    "IMPLEMENTATION_FAILURE",
    "VERIFICATION_FAILURE",
    "REGRESSION_FAILURE",
    "REVIEW_FAILURE",
    "CAPABILITY_FAILURE",
    "AUTHORITY_FAILURE",
    "ENVIRONMENT_FAILURE",
    "EXTERNAL_SERVICE_FAILURE",
    "STALE_STATE_FAILURE",
    "OPERATOR_INTERRUPTION",
)

LOOP_INVARIANTS = (
    "no completion claim without current verification evidence;",
    "no route without a reason code;",
    "no retry without new evidence or a changed hypothesis;",
    "no destructive action without validated authority and target;",
    "no project-profile fact without a source;",
    "no external publication implied by local success;",
    "no skipped failed check silently treated as passed;",
    "no unrelated refactor during uncertain diagnosis;",
    "no secret in the profile, work state, receipt, or delegation artifacts;",
    "no independent-agent claim when only self-review occurred.",
    "no EXECUTING phase without a valid current contract.",
    "no EXECUTING phase without a valid route when routing is required.",
    "no EXECUTING phase while a mandatory pre-implementation gate is unsatisfied.",
    "no COMPLETE phase without evidence coverage for every required success criterion.",
    "no COMPLETE phase with stale contract, route, gate, state, or receipt fingerprints.",
    "selected guides must match across route, work state, and receipt.",
    "an agent decision cannot be recorded as a user fact.",
    "a required OBSERVED check cannot be satisfied by INFERRED evidence.",
    "BLOCKED evidence cannot be represented as PASSED.",
    "completion must be validated by the protocol, not only declared by the agent.",
    "protocol chronology must not permit execution before mandatory preflight events.",
    "publication status and production readiness must remain independent from local task completion.",
    "a persisted PREFLIGHT_READY result must reconcile with a resumable state and",
)

ADAPTERS = (
    "AGENTS.md",
    "CLAUDE.md",
    ".github/copilot-instructions.md",
    ".cursor/rules/project-loop.mdc",
)

CANONICAL_REFERENCES = (
    "LOOP_ENGINEERING.md",
    "PROJECT_PROFILE.md",
    "GUIDE_ROUTER.md",
)

ROUTING_SCENARIOS = {
    "landing-page-premium": "premium,design,taste,accessibility,clean,test,security,performance",
    "api-auth": "clean,test,security,performance",
    "bug-without-ui": "clean,test",
    "app-mobile-ui": "clean,test,design,accessibility,security,performance",
    "game-web-multiplayer": "games,clean,test,security,performance,accessibility,design",
    "documentation": "documentation",
    "flutter-app-feature": "flutter,clean,test",
    "dotnet-app-feature": "dotnet,clean,test",
    "rust-app-feature": "rust,clean,test",
}

REQUIRED_GUIDE_FRONTMATTER = {
    "name",
    "language",
    "description",
    "version",
    "last-reviewed",
}
QUOTED_GUIDE_FRONTMATTER = {"description", "version", "last-reviewed"}
PLAIN_GUIDE_FRONTMATTER = {
    "name": re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*"),
    "language": re.compile(r"[a-z]{2}(?:-[A-Z]{2})?"),
    "guide-id": re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*"),
}
LIST_GUIDE_FRONTMATTER = {"requires-gates", "completion-evidence"}
GUIDE_VERSION = "2026.09"
FIXTURE_GUIDE_LAST_REVIEWED = "2026-08-10"


class ValidationError(RuntimeError):
    """Raised when the loop kit violates its structural contract."""


def validate_required_files(root: Path) -> None:
    if (root / "PT-BR").exists():
        raise ValidationError("Portuguese guide tree is forbidden: PT-BR")
    for relative in REQUIRED_FILES:
        path = root / relative
        if not path.is_file():
            raise ValidationError(f"{relative}: missing required file")


def validate_adapters(root: Path) -> None:
    resolved_root = root.resolve()
    link_pattern = re.compile(r"\]\(([^)]+)\)")

    for relative in ADAPTERS:
        path = root / relative
        text = path.read_text(encoding="utf-8")
        line_count = len(text.splitlines())
        if line_count > 45:
            raise ValidationError(f"{relative}: adapter exceeds 45 lines ({line_count})")

        links = link_pattern.findall(text)
        for canonical in CANONICAL_REFERENCES:
            matching = [raw for raw in links if Path(raw.split("#", 1)[0]).name == canonical]
            if len(matching) != 1:
                raise ValidationError(
                    f"{relative}: missing canonical reference to {canonical}"
                )

            raw_target = matching[0].split("#", 1)[0]
            resolved = (path.parent / raw_target).resolve()
            try:
                resolved.relative_to(resolved_root)
            except ValueError as error:
                raise ValidationError(
                    f"{relative}: canonical reference escapes repository: {raw_target}"
                ) from error
            if not resolved.is_file():
                raise ValidationError(
                    f"{relative}: canonical reference target is missing: {raw_target}"
                )


def _parse_guide_scalar(
    key: str,
    raw_value: str,
    path: Path,
    line_number: int,
) -> str:
    value = raw_value.strip()
    if not value:
        raise ValidationError(f"{path}:{line_number}: empty frontmatter value")

    if key in QUOTED_GUIDE_FRONTMATTER:
        if value.startswith('"'):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as error:
                raise ValidationError(
                    f"{path}:{line_number}: invalid double-quoted scalar"
                ) from error
            if not isinstance(parsed, str):
                raise ValidationError(
                    f"{path}:{line_number}: frontmatter value must be a string"
                )
            return parsed
        if value.startswith("'"):
            if len(value) < 2 or not value.endswith("'"):
                raise ValidationError(
                    f"{path}:{line_number}: invalid single-quoted scalar"
                )
            body = value[1:-1]
            if "'" in body.replace("''", ""):
                raise ValidationError(
                    f"{path}:{line_number}: invalid single-quote escape"
                )
            return body.replace("''", "'")
        raise ValidationError(f"{path}:{line_number}: {key} must be a quoted string")

    if value.startswith(('"', "'")):
        raise ValidationError(f"{path}:{line_number}: {key} must be a plain scalar")
    pattern = PLAIN_GUIDE_FRONTMATTER.get(key)
    if pattern is None or not pattern.fullmatch(value):
        raise ValidationError(
            f"{path}:{line_number}: unsupported plain scalar for {key}"
        )
    return value


def parse_guide_frontmatter(path: Path) -> dict[str, object]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != "---":
        raise ValidationError(f"{path}: missing exact opening frontmatter delimiter")
    try:
        closing = lines.index("---", 1)
    except ValueError as error:
        raise ValidationError(
            f"{path}: missing exact closing frontmatter delimiter"
        ) from error

    metadata: dict[str, object] = {}
    index = 1
    while index < closing:
        line_number = index + 1
        list_match = re.fullmatch(r"(requires-gates|completion-evidence):[ \t]*", lines[index])
        if list_match:
            key = list_match.group(1)
            if key in metadata:
                raise ValidationError(f"{path}:{line_number}: duplicate frontmatter key {key}")
            values: list[str] = []
            index += 1
            while index < closing:
                item_match = re.fullmatch(r"[ \t]+-[ \t]+(.+)", lines[index])
                if not item_match:
                    break
                item_line = index + 1
                item = item_match.group(1).strip()
                if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", item):
                    raise ValidationError(f"{path}:{item_line}: invalid {key} item")
                values.append(item)
                index += 1
            metadata[key] = values
            continue

        match = re.fullmatch(
            r"(name|language|description|version|last-reviewed|guide-id):[ \t]+(.+)",
            lines[index],
        )
        if not match:
            raise ValidationError(f"{path}:{line_number}: invalid frontmatter line")
        key, raw_value = match.groups()
        if key in metadata:
            raise ValidationError(f"{path}:{line_number}: duplicate frontmatter key {key}")
        metadata[key] = _parse_guide_scalar(key, raw_value, path, line_number)
        index += 1

    if not REQUIRED_GUIDE_FRONTMATTER.issubset(metadata):
        raise ValidationError(f"{path}: frontmatter keys differ from contract")
    return metadata


def validate_iso_date(value: str, field_name: str, relative_path: str) -> None:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        raise ValidationError(f"{relative_path}: {field_name} must be in YYYY-MM-DD format, got '{value}'")
    try:
        from datetime import date
        parsed = date.fromisoformat(value)
    except ValueError as err:
        raise ValidationError(f"{relative_path}: {field_name} invalid date '{value}': {err}")
    today = date.today()
    if parsed > today:
        raise ValidationError(f"{relative_path}: {field_name} cannot be in the future: '{value}'")


def load_guide_registry(root: Path) -> dict[str, str]:
    registry_path = root / "src" / "config" / "guides.json"
    if not registry_path.is_file():
        raise ValidationError("missing canonical guide registry: src/config/guides.json")

    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValidationError(f"invalid guide registry JSON: {error}") from error

    if not isinstance(data, dict):
        raise ValidationError("guide registry root must be an object")

    result: dict[str, str] = {}
    for guide_id, definition in data.items():
        if not isinstance(guide_id, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", guide_id):
            raise ValidationError(f"invalid guide ID in registry: '{guide_id}'")

        if not isinstance(definition, dict):
            raise ValidationError(f"guide registry entry '{guide_id}' must be an object")

        relative = definition.get("path")
        install = definition.get("install")

        if not isinstance(relative, str) or not relative or not relative.startswith("ENG/") or not relative.endswith(".md"):
            raise ValidationError(f"guide registry entry '{guide_id}' has invalid path: '{relative}'")

        relative_path = Path(relative)
        if relative_path.is_absolute():
            raise ValidationError(f"guide registry entry '{guide_id}' has absolute path: '{relative}'")

        try:
            (root / relative_path).resolve().relative_to(root.resolve())
        except ValueError as error:
            raise ValidationError(f"guide path escapes repository: '{relative}'") from error

        if not isinstance(install, bool):
            raise ValidationError(f"guide registry entry '{guide_id}' has invalid install flag: '{install}'")

        result[guide_id] = relative

    return result


def validate_guides(root: Path) -> None:
    guides = load_guide_registry(root)
    registry_paths = set(guides.values())
    disk_paths = {p.relative_to(root).as_posix() for p in root.glob("ENG/*.md")}

    missing = registry_paths - disk_paths
    unregistered = disk_paths - registry_paths

    if missing:
        raise ValidationError("registered guide files missing: " + ", ".join(sorted(missing)))
    if unregistered:
        raise ValidationError("unregistered guide files: " + ", ".join(sorted(unregistered)))

    names: set[str] = set()
    for guide_id, relative in guides.items():
        path = root / relative
        metadata = parse_guide_frontmatter(path)
        if metadata["name"] != path.stem:
            raise ValidationError(f"{relative}: name must match filename")
        if metadata["language"] != "en":
            raise ValidationError(f"{relative}: language must be en")
        if not metadata["description"]:
            raise ValidationError(f"{relative}: description must not be empty")
        if metadata["version"] != GUIDE_VERSION:
            raise ValidationError(f"{relative}: unexpected version")
        validate_iso_date(str(metadata["last-reviewed"]), "last-reviewed", relative)
        if "guide-id" in metadata and metadata["guide-id"] != guide_id:
            raise ValidationError(f"{relative}: frontmatter guide-id '{metadata['guide-id']}' does not match registry key '{guide_id}'")
        if metadata["name"] in names:
            raise ValidationError(f"{relative}: duplicate guide name {metadata['name']}")
        names.add(metadata["name"])


def validate_router(root: Path) -> None:
    path = root / "GUIDE_ROUTER.md"
    text = path.read_text(encoding="utf-8")
    guides = load_guide_registry(root)

    for guide_id, relative in guides.items():
        if f"`{guide_id}`" not in text:
            raise ValidationError(f"GUIDE_ROUTER.md: missing guide ID {guide_id}")
        if relative not in text:
            raise ValidationError(f"GUIDE_ROUTER.md: missing guide path {relative}")
        if not (root / relative).is_file():
            raise ValidationError(f"GUIDE_ROUTER.md: guide target is missing: {relative}")

    raw_markers = re.findall(r"<!--\s*route:(.*?)-->", text)
    for raw in raw_markers:
        if "PT-BR/" in raw or "ENG/" in raw or ".md" in raw:
            raise ValidationError(
                "GUIDE_ROUTER.md: route markers must use guide IDs, not language paths"
            )

    parsed: dict[str, str] = {}
    for raw in raw_markers:
        if "=" not in raw:
            raise ValidationError(f"GUIDE_ROUTER.md: malformed route marker: {raw}")
        scenario, guide_ids = (part.strip() for part in raw.split("=", 1))
        if scenario in parsed:
            raise ValidationError(f"GUIDE_ROUTER.md: duplicate routing scenario {scenario}")
        parsed[scenario] = guide_ids

    allowed = set(guides) | {"domain"}
    for scenario, guide_ids in parsed.items():
        unknown = set(guide_ids.split(",")) - allowed
        if unknown:
            raise ValidationError(
                f"GUIDE_ROUTER.md: scenario {scenario} references unknown IDs: {','.join(sorted(unknown))}"
            )

    for scenario, expected_ids in ROUTING_SCENARIOS.items():
        if scenario not in parsed:
            raise ValidationError(f"GUIDE_ROUTER.md: missing routing scenario {scenario}")
        if parsed[scenario] != expected_ids:
            raise ValidationError(
                f"GUIDE_ROUTER.md: scenario {scenario} expected {expected_ids}, got {parsed[scenario]}"
            )


def validate_protocol_assets(root: Path) -> None:
    loop = (root / "LOOP_ENGINEERING.md").read_text(encoding="utf-8")
    scorecard = (root / "QUALITY_SCORECARD.md").read_text(encoding="utf-8")
    terminology = (root / "TERMINOLOGY.md").read_text(encoding="utf-8")

    if "protocol-version: 1" not in loop:
        raise ValidationError("LOOP_ENGINEERING.md: protocol version marker is missing")
    for failure_class in FAILURE_CLASSES:
        if failure_class not in loop:
            raise ValidationError(
                f"LOOP_ENGINEERING.md: failure taxonomy is missing {failure_class}"
            )
    for invariant in LOOP_INVARIANTS:
        if invariant not in loop:
            raise ValidationError(
                f"LOOP_ENGINEERING.md: loop invariant is missing: {invariant}"
            )
    if "10/10 evidence" not in scorecard:
        raise ValidationError("QUALITY_SCORECARD.md: evidence criteria are missing")
    if "| Term | Meaning |" not in terminology:
        raise ValidationError("TERMINOLOGY.md: terminology table is missing")

    for relative in SCHEMA_FILES:
        path = root / "schemas" / relative
        if not path.is_file():
            raise ValidationError(f"schemas/{relative}: missing required schema")
        try:
            schema = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ValidationError(f"schemas/{relative}: invalid JSON") from error
        if schema.get("type") != "object":
            raise ValidationError(f"schemas/{relative}: top-level type must be object")
        properties = schema.get("properties")
        if not isinstance(properties, dict) or properties.get("schemaVersion", {}).get("const") != 1:
            raise ValidationError(f"schemas/{relative}: schemaVersion const 1 is required")
        required = schema.get("required")
        if not isinstance(required, list) or "schemaVersion" not in required:
            raise ValidationError(f"schemas/{relative}: schemaVersion must be required")


def _has_transition(text: str, source: str, target: str) -> bool:
    pattern = re.compile(
        rf"\|\s*`{re.escape(source)}`\s*\|.*\|\s*`{re.escape(target)}`\s*\|"
    )
    return pattern.search(text) is not None


def _section(text: str, heading: str) -> str:
    match = re.search(
        rf"^{re.escape(heading)}\s*$([\s\S]*?)(?=^##\s|\Z)",
        text,
        re.MULTILINE,
    )
    return match.group(1) if match else ""


def validate_graph_readiness(root: Path) -> None:
    integration = (root / "ORCHESTRATOR_INTEGRATION.md").read_text(encoding="utf-8")
    design = (root / "LOOP_SYSTEM_DESIGN.md").read_text(encoding="utf-8")
    router = (root / "GUIDE_ROUTER.md").read_text(encoding="utf-8")
    scorecard = (root / "QUALITY_SCORECARD.md").read_text(encoding="utf-8")

    if integration.count("## Canonical workflow diagram") != 1:
        raise ValidationError(
            "ORCHESTRATOR_INTEGRATION.md: exactly one canonical workflow diagram is required"
        )
    if "```text" not in integration:
        raise ValidationError(
            "ORCHESTRATOR_INTEGRATION.md: canonical workflow diagram must be text-serializable"
        )
    if "## Phase names" not in integration:
        raise ValidationError("ORCHESTRATOR_INTEGRATION.md: phase names section is missing")
    phase_section = _section(integration, "## Phase names")
    for phase in WORK_PHASES:
        if f"`{phase}`" not in phase_section:
            raise ValidationError(
                f"ORCHESTRATOR_INTEGRATION.md: workflow phase name is missing: {phase}"
            )

    if "## Canonical transition table" not in integration:
        raise ValidationError(
            "ORCHESTRATOR_INTEGRATION.md: canonical transition table is missing"
        )
    transition_section = _section(integration, "## Canonical transition table")
    for source, target in WORK_TRANSITIONS:
        if not _has_transition(transition_section, source, target):
            raise ValidationError(
                f"ORCHESTRATOR_INTEGRATION.md: transition row is missing: {source} -> {target}"
            )

    if "## State invariants" not in integration:
        raise ValidationError("ORCHESTRATOR_INTEGRATION.md: state invariants section is missing")
    invariant_patterns = (
        ("COMPLETE requires verification evidence", r"`?COMPLETE`?\s+requires verification evidence"),
        ("BLOCKED requires blocker evidence", r"`?BLOCKED`?\s+requires blocker evidence"),
        ("CORRECTING requires a diagnosed hypothesis", r"`?CORRECTING`?\s+requires a diagnosed hypothesis"),
    )
    for invariant, pattern in invariant_patterns:
        if re.search(pattern, integration) is None:
            raise ValidationError(
                f"ORCHESTRATOR_INTEGRATION.md: state invariant is missing: {invariant}"
            )

    for marker in (
        "schemaVersion: 1",
        "protocolVersion: 1",
        "JSON-compatible",
        "does not provide a graph runtime",
        "does not provide a provider adapter",
        "does not provide a scheduler",
        "no runtime required",
    ):
        if marker.casefold() not in integration.casefold():
            raise ValidationError(
                f"ORCHESTRATOR_INTEGRATION.md: integration boundary marker is missing: {marker}"
            )

    if "reason code" not in router.casefold():
        raise ValidationError(
            "GUIDE_ROUTER.md: route contract must document reason code language"
        )

    for evidence_reference in (
        "src/core/router.js",
        "src/core/receipt.js",
        "src/core/work-state.js",
        "src/core/delegation.js",
        "ORCHESTRATOR_INTEGRATION.md",
        "tests/router.test.js",
        "tests/observability.test.js",
        "tests/work-state.test.js",
        "tests/delegation.test.js",
        "tests/portability.test.js",
    ):
        if evidence_reference not in scorecard:
            raise ValidationError(
                f"QUALITY_SCORECARD.md: evidence reference is missing: {evidence_reference}"
            )

    for forbidden in ("src/graph/", "src/llm/", "forgeloop run"):
        if forbidden in design or forbidden in integration:
            raise ValidationError(
                f"product architecture contract contains prohibited runtime term: {forbidden}"
            )


def validate_profile(root: Path) -> None:
    path = root / "PROJECT_PROFILE.md"
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if len(lines) < 3 or lines[0] != "---":
        raise ValidationError("PROJECT_PROFILE.md: missing frontmatter")
    try:
        closing = lines.index("---", 1)
    except ValueError as error:
        raise ValidationError("PROJECT_PROFILE.md: unclosed frontmatter") from error

    metadata: dict[str, str] = {}
    for line in lines[1:closing]:
        if ":" not in line:
            raise ValidationError(f"PROJECT_PROFILE.md: malformed frontmatter line: {line}")
        key, value = (part.strip() for part in line.split(":", 1))
        if key in metadata:
            raise ValidationError(f"PROJECT_PROFILE.md: duplicate frontmatter key: {key}")
        metadata[key] = value.strip("\"'")

    allowed_values = {
        "language": {"en"},
        "profile-mode": {"template", "project"},
        "profile-status": {"uninitialized", "partial", "verified"},
    }
    for key, values in allowed_values.items():
        if metadata.get(key) not in values:
            raise ValidationError(
                f"PROJECT_PROFILE.md: {key} must be one of {sorted(values)}"
            )


def validate_cursor_frontmatter(root: Path) -> None:
    path = root / ".cursor/rules/project-loop.mdc"
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 4 or lines[0] != "---":
        raise ValidationError(f"{path.relative_to(root)}: missing frontmatter")
    try:
        closing = lines.index("---", 1)
    except ValueError as error:
        raise ValidationError(f"{path.relative_to(root)}: unclosed frontmatter") from error

    metadata: dict[str, str] = {}
    for line in lines[1:closing]:
        if ":" not in line:
            raise ValidationError(
                f"{path.relative_to(root)}: malformed frontmatter line: {line}"
            )
        key, value = (part.strip() for part in line.split(":", 1))
        metadata[key] = value
    if metadata.get("alwaysApply") != "true":
        raise ValidationError(f"{path.relative_to(root)}: alwaysApply must be true")
    if not metadata.get("description"):
        raise ValidationError(f"{path.relative_to(root)}: description is required")


def validate_repository(root: Path) -> None:
    validate_required_files(root)
    validate_adapters(root)
    validate_guides(root)
    validate_router(root)
    validate_protocol_assets(root)
    validate_graph_readiness(root)
    validate_profile(root)
    validate_cursor_frontmatter(root)


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _fixture_guide_registry() -> dict[str, dict]:
    return {
        "premium": {"path": "ENG/premium-sites-studio-eng.md", "install": True},
        "clean": {"path": "ENG/clean-code-eng.md", "install": True},
        "test": {"path": "ENG/test-code-eng.md", "install": True},
        "security": {"path": "ENG/sec-code-eng.md", "install": True},
        "design": {"path": "ENG/design-code-eng.md", "install": True},
        "taste": {"path": "ENG/taste-frontend-eng.md", "install": True},
        "performance": {"path": "ENG/perf-code-eng.md", "install": True},
        "accessibility": {"path": "ENG/accessibility-eng.md", "install": True},
        "games": {"path": "ENG/games-code-design-web-eng.md", "install": True},
        "documentation": {"path": "ENG/documentation-quality-eng.md", "install": True},
        "flutter": {"path": "ENG/flutter-development-eng.md", "install": True},
        "dotnet": {"path": "ENG/dotnet-aspnetcore-development-eng.md", "install": True},
        "rust": {"path": "ENG/rust-development-eng.md", "install": True},
    }


def _valid_fixture(root: Path) -> None:
    registry = _fixture_guide_registry()
    _write(
        root / "src" / "config" / "guides.json",
        json.dumps(registry, indent=2) + "\n",
    )
    for guide_id, def_data in registry.items():
        guide_path = def_data["path"]
        path = root / guide_path
        _write(
            path,
            "---\n"
            f"name: {path.stem}\n"
            "language: en\n"
            'description: "Fixture guide."\n'
            f'version: "{GUIDE_VERSION}"\n'
            f'last-reviewed: "{FIXTURE_GUIDE_LAST_REVIEWED}"\n'
            f"guide-id: {guide_id}\n"
            "---\n"
            "# Guide\n",
        )

    failure_text = "\n".join(FAILURE_CLASSES)
    invariant_text = "\n".join(f"- {invariant}" for invariant in LOOP_INVARIANTS)
    _write(
        root / "LOOP_ENGINEERING.md",
        "# Loop\nprotocol-version: 1\n"
        f"{failure_text}\n{invariant_text}\n",
    )
    _write(
        root / "LOOP_SYSTEM_DESIGN.md",
        "# Design\n",
    )
    _write(root / "THIRD_PARTY_NOTICES.md", "# Third-party notices\n")
    _write(root / "THREAT_MODEL.md", "# Threat model\n")
    _write(root / "CONTRACT_COVERAGE.md", "# Coverage\n")
    _write(root / "PROTOCOL_INTEGRATION.md", "# Protocol Integration\n")
    _write(
        root / "QUALITY_SCORECARD.md",
        "# Scorecard\n10/10 evidence\n"
        "src/core/router.js src/core/receipt.js src/core/work-state.js "
        "src/core/delegation.js ORCHESTRATOR_INTEGRATION.md\n"
        "tests/router.test.js tests/observability.test.js tests/work-state.test.js "
        "tests/delegation.test.js tests/portability.test.js\n",
    )
    _write(root / "TERMINOLOGY.md", "# Terminology\n| Term | Meaning |\n")
    for schema_name in SCHEMA_FILES:
        _write(
            root / "schemas" / schema_name,
            json.dumps(
                {
                    "type": "object",
                    "required": ["schemaVersion"],
                    "properties": {"schemaVersion": {"const": 1}},
                }
            ),
        )
    _write(
        root / "PROJECT_PROFILE.md",
        "---\nlanguage: en\nprofile-mode: template\n"
        "profile-status: uninitialized\nlast-confirmed: unknown\n---\n"
        "# Profile\nNot identified — confirm from the stated source.\n",
    )

    catalog = "\n".join(
        f"| `{guide_id}` | [Guide](./{def_data['path']}) |"
        for guide_id, def_data in registry.items()
    )
    scenarios = {
        "landing-page-premium": "premium,design,taste,accessibility,clean,test,security,performance",
        "api-auth": "clean,test,security,performance",
        "bug-without-ui": "clean,test",
        "app-mobile-ui": "clean,test,design,accessibility,security,performance",
        "game-web-multiplayer": "games,clean,test,security,performance,accessibility,design",
        "documentation": "documentation",
        "flutter-app-feature": "flutter,clean,test",
        "dotnet-app-feature": "dotnet,clean,test",
        "rust-app-feature": "rust,clean,test",
    }
    markers = "\n".join(
        f"<!-- route:{scenario}={ids} -->" for scenario, ids in scenarios.items()
    )
    _write(
        root / "GUIDE_ROUTER.md",
        f"# Router\n{catalog}\nReason codes are stable outputs.\n{markers}\n",
    )

    phase_lines = "\n".join(f"- `{phase}`" for phase in WORK_PHASES)
    transition_rows = "\n".join(
        f"| `{source}` | transition condition | `{target}` |"
        for source, target in WORK_TRANSITIONS
    )
    _write(
        root / "ORCHESTRATOR_INTEGRATION.md",
        "# Orchestrator integration\n"
        "## Canonical workflow diagram\n"
        "```text\nRECEIVED -> DISCOVERING -> CONTRACT_READY -> ROUTED\n```\n"
        "## Phase names\n"
        f"{phase_lines}\n"
        "## Canonical transition table\n"
        "| From | Condition | To |\n| --- | --- | --- |\n"
        f"{transition_rows}\n"
        "## State invariants\n"
        "COMPLETE requires verification evidence.\n"
        "BLOCKED requires blocker evidence.\n"
        "CORRECTING requires a diagnosed hypothesis.\n"
        "## No-runtime boundary\n"
        "schemaVersion: 1 and protocolVersion: 1 are JSON-compatible.\n"
        "The protocol does not provide a graph runtime.\n"
        "The protocol does not provide a provider adapter.\n"
        "The protocol does not provide a scheduler.\n"
        "No runtime required.\n",
    )

    root_adapter = (
        "# Adapter\n[Loop](./LOOP_ENGINEERING.md)\n"
        "[Profile](./PROJECT_PROFILE.md)\n[Router](./GUIDE_ROUTER.md)\n"
    )
    nested_adapter = (
        "# Adapter\n[Loop](../LOOP_ENGINEERING.md)\n"
        "[Profile](../PROJECT_PROFILE.md)\n[Router](../GUIDE_ROUTER.md)\n"
    )
    cursor_adapter = (
        "---\ndescription: Universal verified project loop\nalwaysApply: true\n---\n"
        "# Cursor\n[Loop](../../LOOP_ENGINEERING.md)\n"
        "[Profile](../../PROJECT_PROFILE.md)\n[Router](../../GUIDE_ROUTER.md)\n"
    )
    _write(root / "AGENTS.md", root_adapter)
    _write(root / "CLAUDE.md", root_adapter)
    _write(root / ".github/copilot-instructions.md", nested_adapter)
    _write(root / ".cursor/rules/project-loop.mdc", cursor_adapter)


def _expect_invalid(root: Path, expected_fragment: str) -> None:
    try:
        validate_repository(root)
    except ValidationError as error:
        if expected_fragment not in str(error):
            raise AssertionError(
                f"expected error containing {expected_fragment!r}, got {error!r}"
            ) from error
    else:
        raise AssertionError(f"expected ValidationError containing {expected_fragment!r}")


def run_self_tests() -> None:
    cases = 0

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        validate_repository(root)
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        (root / "LOOP_ENGINEERING.md").unlink()
        _expect_invalid(root, "missing required file")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        (root / "THIRD_PARTY_NOTICES.md").unlink()
        _expect_invalid(root, "missing required file")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        _write(root / "AGENTS.md", "# Adapter\n[Loop](./LOOP_ENGINEERING.md)\n")
        _expect_invalid(root, "missing canonical reference")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        _write(root / "CLAUDE.md", "# Adapter\n" + "line\n" * 45)
        _expect_invalid(root, "exceeds 45 lines")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        router = (root / "GUIDE_ROUTER.md").read_text(encoding="utf-8")
        router = router.replace(
            "[Guide](./ENG/accessibility-eng.md)",
            "[Guide](./ENG/missing.md)",
        )
        _write(root / "GUIDE_ROUTER.md", router)
        _expect_invalid(root, "missing guide path")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        router = (root / "GUIDE_ROUTER.md").read_text(encoding="utf-8")
        router = router.replace(
            "<!-- route:api-auth=clean,test,security,performance -->",
            "<!-- route:api-auth=PT-BR/clean-code-pt.md,ENG/clean-code-eng.md -->",
        )
        _write(root / "GUIDE_ROUTER.md", router)
        _expect_invalid(root, "route markers must use guide IDs")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        router = (root / "GUIDE_ROUTER.md").read_text(encoding="utf-8")
        router = router.replace("<!-- route:documentation=documentation -->", "")
        _write(root / "GUIDE_ROUTER.md", router)
        _expect_invalid(root, "missing routing scenario")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        router = (root / "GUIDE_ROUTER.md").read_text(encoding="utf-8")
        _write(
            root / "GUIDE_ROUTER.md",
            router + "<!-- route:extra=clean,unknown-guide -->\n",
        )
        _expect_invalid(root, "unknown IDs")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        guide = root / "ENG/clean-code-eng.md"
        text = guide.read_text(encoding="utf-8")
        _write(
            guide,
            text.replace(
                'description: "Fixture guide."',
                'description: "Unclosed description.',
            ),
        )
        _expect_invalid(root, "invalid double-quoted scalar")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        profile = (root / "PROJECT_PROFILE.md").read_text(encoding="utf-8")
        _write(
            root / "PROJECT_PROFILE.md",
            profile.replace("language: en", "language: pt-BR"),
        )
        _expect_invalid(root, "language must be one of")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        _write(root / "PT-BR/legacy.md", "# Legacy\n")
        _expect_invalid(root, "Portuguese guide tree is forbidden")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        cursor = (root / ".cursor/rules/project-loop.mdc").read_text(encoding="utf-8")
        _write(
            root / ".cursor/rules/project-loop.mdc",
            cursor.replace("alwaysApply: true", "alwaysApply: false"),
        )
        _expect_invalid(root, "alwaysApply")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        outside = root.parent / f"{root.name}-outside"
        outside.mkdir()
        try:
            _valid_fixture(root)
            _write(outside / "LOOP_ENGINEERING.md", "# outside\n")
            adapter = (root / "AGENTS.md").read_text(encoding="utf-8")
            adapter = adapter.replace(
                "./LOOP_ENGINEERING.md",
                f"../{outside.name}/LOOP_ENGINEERING.md",
            )
            _write(root / "AGENTS.md", adapter)
            _expect_invalid(root, "escapes repository")
            cases += 1
        finally:
            (outside / "LOOP_ENGINEERING.md").unlink(missing_ok=True)
            outside.rmdir()
        root = Path(directory)
        _valid_fixture(root)
        (root / "src" / "config" / "guides.json").unlink()
        _expect_invalid(root, "missing canonical guide registry")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        _write(root / "src" / "config" / "guides.json", "{ invalid json")
        _expect_invalid(root, "invalid guide registry JSON")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        orphan = root / "ENG" / "orphan-eng.md"
        _write(
            orphan,
            "---\n"
            "name: orphan-eng\n"
            "language: en\n"
            'description: "Fixture guide."\n'
            'version: "2026.09"\n'
            'last-reviewed: "2026-08-17"\n'
            "guide-id: orphan\n"
            "---\n"
            "# Guide\n",
        )
        _expect_invalid(root, "unregistered guide files")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        (root / "ENG" / "clean-code-eng.md").unlink()
        _expect_invalid(root, "registered guide files missing")
        cases += 1

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        _valid_fixture(root)
        registry = _fixture_guide_registry()
        registry["clean"]["install"] = "yes"
        _write(root / "src" / "config" / "guides.json", json.dumps(registry))
        _expect_invalid(root, "invalid install flag")
        cases += 1

    print(f"loop self-tests passed: {cases} cases")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    try:
        if args.self_test:
            run_self_tests()
        else:
            resolved_root = args.root.resolve()
            validate_repository(resolved_root)
            guides = load_guide_registry(resolved_root)
            print(
                "validated loop system: "
                f"{len(ADAPTERS)} adapters, {len(guides)} English guides, "
                f"{len(ROUTING_SCENARIOS)} routing scenarios"
            )
        return 0
    except (ValidationError, AssertionError) as error:
        print(f"loop validation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

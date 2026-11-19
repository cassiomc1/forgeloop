#!/usr/bin/env python3
"""Validate Markdown fences, links, and guide frontmatter for the repository."""

from __future__ import annotations

import argparse
import json
import re
import string
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote

try:
    from scripts.validate_loop_system import GUIDE_VERSION
except ModuleNotFoundError:
    from validate_loop_system import GUIDE_VERSION

required = {"name", "language", "description", "version", "last-reviewed"}

class ValidationError(ValueError):
    pass


def balanced_fences(text, path):
    opening = None
    for line_number, line in enumerate(text.splitlines(), 1):
        match = re.match(r"^[ \t]{0,3}(`{3,}|~{3,})(.*)$", line)
        if not match:
            continue
        marker = match.group(1)
        if opening is None:
            opening = (marker[0], len(marker), line_number)
        elif (
            marker[0] == opening[0]
            and len(marker) >= opening[1]
            and re.fullmatch(r"[ \t]*", match.group(2))
        ):
            opening = None
    if opening is not None:
        raise ValidationError(
            f"{path}: unclosed code fence opened at line {opening[2]}"
        )

quoted_frontmatter_keys = {"description", "version", "last-reviewed"}
plain_frontmatter_patterns = {
    "name": re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*"),
    "language": re.compile(r"[a-z]{2}(?:-[A-Z]{2})?"),
    "guide-id": re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*"),
}
list_frontmatter_keys = {"requires-gates", "completion-evidence"}
implicit_plain_yaml = re.compile(
    r"(?ix:"
    r"~|null|true|false|yes|no|on|off|"
    r"[-+]?(?:0b[01_]+|0o[0-7_]+|0x[0-9a-f_]+|0[0-7_]+|"
    r"(?:0|[1-9][0-9_]*))|"
    r"[-+]?(?:[0-9][0-9_]*)?\.[0-9_]+(?:e[-+]?[0-9]+)?|"
    r"[-+]?[0-9][0-9_]*e[-+]?[0-9]+|"
    r"[-+]?\.(?:inf|nan)|"
    r"[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:"
    r"(?:[Tt]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?(?:[ \t]*(?:Z|[-+][0-9]{1,2}(?::[0-9]{2})?))?"
    r")?"
    r")"
)

def parse_scalar(key, raw_value, path, line_number):
    value = raw_value.strip()
    if not value:
        raise ValidationError(
            f"{path}:{line_number}: empty frontmatter value"
        )

    is_quoted = value.startswith(('"', "'"))
    if key in quoted_frontmatter_keys and not is_quoted:
        raise ValidationError(
            f"{path}:{line_number}: {key} must be a quoted string"
        )
    if key in plain_frontmatter_patterns and is_quoted:
        raise ValidationError(
            f"{path}:{line_number}: {key} must be a plain scalar"
        )

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

    if implicit_plain_yaml.fullmatch(value):
        raise ValidationError(
            f"{path}:{line_number}: implicit non-string YAML value is forbidden"
        )
    pattern = plain_frontmatter_patterns.get(key)
    if pattern is None or not pattern.fullmatch(value):
        raise ValidationError(
            f"{path}:{line_number}: unsupported plain scalar for {key}"
        )
    return value

def parse_frontmatter(text, path):
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValidationError(f"{path}: missing exact opening frontmatter delimiter")
    try:
        closing_index = lines.index("---", 1)
    except ValueError as error:
        raise ValidationError(
            f"{path}: missing exact closing frontmatter delimiter"
        ) from error

    metadata = {}
    index = 1
    while index < closing_index:
        line_number = index + 1
        line = lines[index]
        list_match = re.fullmatch(r"(requires-gates|completion-evidence):[ \t]*", line)
        if list_match:
            key = list_match.group(1)
            if key in metadata:
                raise ValidationError(
                    f"{path}:{line_number}: duplicate frontmatter key {key}"
                )
            values = []
            index += 1
            while index < closing_index:
                item_match = re.fullmatch(r"[ \t]+-[ \t]+(.+)", lines[index])
                if not item_match:
                    break
                item_line = index + 1
                item = item_match.group(1).strip()
                if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", item):
                    raise ValidationError(
                        f"{path}:{item_line}: invalid {key} item"
                    )
                values.append(item)
                index += 1
            metadata[key] = values
            continue

        match = re.fullmatch(
            r"(name|language|description|version|last-reviewed|guide-id):[ \t]+(.+)",
            line,
        )
        if not match:
            raise ValidationError(
                f"{path}:{line_number}: invalid frontmatter line"
            )
        key, raw_value = match.groups()
        if key in metadata:
            raise ValidationError(
                f"{path}:{line_number}: duplicate frontmatter key {key}"
            )
        metadata[key] = parse_scalar(key, raw_value, path, line_number)
        index += 1

    if not required.issubset(metadata):
        raise ValidationError(f"{path}: frontmatter keys differ from contract")
    return metadata

def is_escaped(text, index):
    backslashes = 0
    index -= 1
    while index >= 0 and text[index] == "\\":
        backslashes += 1
        index -= 1
    return backslashes % 2 == 1

def strip_inline_code(line):
    characters = list(line)
    index = 0
    while index < len(line):
        if line[index] != "`" or is_escaped(line, index):
            index += 1
            continue
        run_end = index
        while run_end < len(line) and line[run_end] == "`":
            run_end += 1
        run_length = run_end - index
        search = run_end
        closing_end = None
        while search < len(line):
            candidate = line.find("`", search)
            if candidate < 0:
                break
            candidate_end = candidate
            while candidate_end < len(line) and line[candidate_end] == "`":
                candidate_end += 1
            if (
                not is_escaped(line, candidate)
                and candidate_end - candidate == run_length
            ):
                closing_end = candidate_end
                break
            search = candidate_end
        if closing_end is None:
            index = run_end
            continue
        for position in range(index, closing_end):
            if characters[position] not in "\r\n":
                characters[position] = " "
        index = closing_end
    return "".join(characters)

def markdown_without_code(text):
    output = []
    opening = None
    for line in text.splitlines(keepends=True):
        content = line.rstrip("\r\n")
        line_ending = line[len(content):]
        match = re.match(r"^[ \t]{0,3}(`{3,}|~{3,})(.*)$", content)
        if opening is None and match:
            marker = match.group(1)
            opening = (marker[0], len(marker))
            output.append(line_ending)
        elif opening is not None:
            if (
                match
                and match.group(1)[0] == opening[0]
                and len(match.group(1)) >= opening[1]
                and re.fullmatch(r"[ \t]*", match.group(2))
            ):
                opening = None
            output.append(line_ending)
        else:
            output.append(line)
    return strip_inline_code("".join(output))

def normalize_reference_label(label):
    return re.sub(r"[ \t\r\n]+", " ", label.strip()).casefold()

def scan_bracket_label(text, opening_index):
    if opening_index >= len(text) or text[opening_index] != "[":
        return None
    depth = 1
    index = opening_index + 1
    while index < len(text):
        character = text[index]
        if character in "\r\n":
            return None
        if (
            character == "\\"
            and index + 1 < len(text)
            and text[index + 1] in string.punctuation
        ):
            index += 2
            continue
        if character == "[":
            depth += 1
        elif character == "]":
            depth -= 1
            if depth == 0:
                return text[opening_index + 1:index], index + 1
        index += 1
    return None

def scan_markdown_labels(text):
    labels = []
    index = 0
    while index < len(text):
        span_start = index
        if (
            text[index] == "!"
            and not is_escaped(text, index)
            and index + 1 < len(text)
            and text[index + 1] == "["
        ):
            opening_index = index + 1
        elif text[index] == "[" and not is_escaped(text, index):
            opening_index = index
        else:
            index += 1
            continue
        parsed = scan_bracket_label(text, opening_index)
        if parsed is None:
            index = opening_index + 1
            continue
        label, end = parsed
        labels.append((span_start, opening_index, label, end))
        adjacent = (
            scan_bracket_label(text, end)
            if end < len(text) and text[end] == "["
            else None
        )
        index = adjacent[1] if adjacent is not None else end
    return labels

def unescape_markdown_target(target):
    return re.sub(r"\\([\\`*{}\[\]()#+.!_>-])", r"\1", target)

def parse_optional_title(text, index, closing_character, path):
    while index < len(text) and text[index] in " \t\r\n":
        index += 1
    if index < len(text) and text[index] == closing_character:
        return index + 1
    if index >= len(text) or text[index] not in "\"'(":
        raise ValidationError(f"{path}: malformed Markdown link title")
    opener = text[index]
    closer = ")" if opener == "(" else opener
    index += 1
    while index < len(text):
        if text[index] == closer and not is_escaped(text, index):
            index += 1
            break
        index += 1
    else:
        raise ValidationError(f"{path}: unclosed Markdown link title")
    while index < len(text) and text[index] in " \t\r\n":
        index += 1
    if index >= len(text) or text[index] != closing_character:
        raise ValidationError(f"{path}: malformed Markdown link")
    return index + 1

def parse_inline_destination(text, opening_index, path):
    index = opening_index + 1
    while index < len(text) and text[index] in " \t\r\n":
        index += 1
    if index >= len(text):
        raise ValidationError(f"{path}: unclosed Markdown link")

    if text[index] == "<":
        target_start = index + 1
        index = target_start
        while index < len(text):
            if text[index] == ">" and not is_escaped(text, index):
                target = text[target_start:index]
                return target, parse_optional_title(text, index + 1, ")", path)
            if text[index] in "\r\n":
                break
            index += 1
        raise ValidationError(f"{path}: malformed angle-bracket link target")

    target_start = index
    depth = 0
    while index < len(text):
        character = text[index]
        if character == "\\" and index + 1 < len(text):
            index += 2
            continue
        if character == "(":
            depth += 1
        elif character == ")":
            if depth == 0:
                target = unescape_markdown_target(text[target_start:index])
                return target, index + 1
            depth -= 1
        elif character in " \t\r\n" and depth == 0:
            target = unescape_markdown_target(text[target_start:index])
            return target, parse_optional_title(text, index, ")", path)
        index += 1
    raise ValidationError(f"{path}: unclosed Markdown link")

def parse_definition_destination(raw_value, path):
    value = raw_value.lstrip()
    if not value:
        raise ValidationError(f"{path}: empty reference definition")
    if value.startswith("<"):
        index = 1
        while index < len(value):
            if value[index] == ">" and not is_escaped(value, index):
                target = value[1:index]
                remainder = value[index + 1:].strip()
                break
            index += 1
        else:
            raise ValidationError(f"{path}: malformed reference target")
    else:
        depth = 0
        index = 0
        while index < len(value):
            character = value[index]
            if character == "\\" and index + 1 < len(value):
                index += 2
                continue
            if character == "(":
                depth += 1
            elif character == ")":
                if depth == 0:
                    raise ValidationError(f"{path}: unbalanced reference target")
                depth -= 1
            elif character in " \t" and depth == 0:
                break
            index += 1
        if depth:
            raise ValidationError(f"{path}: unbalanced reference target")
        target = unescape_markdown_target(value[:index])
        remainder = value[index:].strip()
    if not target:
        raise ValidationError(f"{path}: empty reference target")
    if remainder and not (
        len(remainder) >= 2
        and remainder[0] in "\"'("
        and remainder[-1] == (")" if remainder[0] == "(" else remainder[0])
    ):
        raise ValidationError(f"{path}: malformed reference title")
    return target

def scan_reference_definitions(text, path):
    definitions = {}
    targets = []
    spans = []
    line_start = 0
    for line in text.splitlines(keepends=True):
        content = line.rstrip("\r\n")
        indentation = re.match(r"^[ \t]{0,3}", content).end()
        if indentation < len(content) and content[indentation] == "[":
            parsed = scan_bracket_label(content, indentation)
            if parsed is not None:
                raw_label, end = parsed
                if end < len(content) and content[end] == ":":
                    label = normalize_reference_label(raw_label)
                    if label and not label.startswith("^"):
                        if label in definitions:
                            raise ValidationError(
                                f"{path}: duplicate reference definition "
                                f"[{raw_label}]"
                            )
                        target = parse_definition_destination(
                            content[end + 1:], path
                        )
                        definitions[label] = target
                        targets.append(target)
                        spans.append(
                            (line_start + indentation, line_start + len(content))
                        )
        line_start += len(line)
    return definitions, targets, spans

def extract_markdown_targets(text, path):
    visible = markdown_without_code(text)
    definitions, targets, definition_spans = scan_reference_definitions(
        visible, path
    )
    labels = scan_markdown_labels(visible)
    inline_spans = []
    for span_start, _, _, label_end in labels:
        if any(start <= span_start < end for start, end in definition_spans):
            continue
        if label_end < len(visible) and visible[label_end] == "(":
            target, end = parse_inline_destination(visible, label_end, path)
            targets.append(target)
            inline_spans.append((span_start, end))

    reference_spans = []
    occupied = definition_spans + inline_spans
    for span_start, _, raw_label, label_end in labels:
        if any(start <= span_start < end for start, end in occupied):
            continue
        if label_end >= len(visible) or visible[label_end] != "[":
            continue
        parsed_reference = scan_bracket_label(visible, label_end)
        if parsed_reference is None:
            continue
        raw_reference, reference_end = parsed_reference
        label = normalize_reference_label(raw_reference or raw_label)
        if label not in definitions:
            raise ValidationError(
                f"{path}: missing reference definition "
                f"[{raw_reference or raw_label}]"
            )
        reference_spans.append((span_start, reference_end))

    occupied.extend(reference_spans)
    for span_start, _, raw_label, label_end in labels:
        if any(start <= span_start < end for start, end in occupied):
            continue
        label = normalize_reference_label(raw_label)
        if label in definitions:
            occupied.append((span_start, label_end))
    return targets

def validate_relative_links(text, path, repository_root):
    resolved_root = repository_root.resolve()
    for target in extract_markdown_targets(text, path):
        target = target.strip()
        if (
            not target
            or target.startswith("#")
            or target.startswith("//")
            or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", target)
        ):
            continue
        clean_target = unquote(target.split("#", 1)[0].split("?", 1)[0])
        linked_path = (
            resolved_root / clean_target.lstrip("/")
            if clean_target.startswith("/")
            else path.parent / clean_target
        )
        resolved_link = linked_path.resolve()
        try:
            resolved_link.relative_to(resolved_root)
        except ValueError as error:
            raise ValidationError(
                f"{path}: relative link target escapes repository {target}"
            ) from error
        if clean_target and not resolved_link.exists():
            raise ValidationError(
                f"{path}: missing relative link target {target}"
            )


def run_self_tests():
    valid_frontmatter = f"""---
name: sample
language: en
description: "Valid scalar with punctuation."
version: "{GUIDE_VERSION}"
last-reviewed: "2026-08-10"
guide-id: sample
requires-gates:
  - design
completion-evidence:
  - build
---
# Sample
"""
    parse_frontmatter(valid_frontmatter, "frontmatter-positive")
    invalid_frontmatter = {
        "duplicate key": valid_frontmatter.replace(
            "language: en\n", "language: en\nlanguage: en\n"
        ),
        "flow sequence": valid_frontmatter.replace(
            'description: "Valid scalar with punctuation."', "description: ["
        ),
        "wrong opening delimiter": valid_frontmatter.replace(
            "---\n", "...\n", 1
        ),
        "wrong closing delimiter": valid_frontmatter.replace(
            "---\n# Sample", "...\n# Sample"
        ),
        "nested value": valid_frontmatter.replace(
            'description: "Valid scalar with punctuation."',
            "description:\n  nested: true",
        ),
        "implicit boolean": valid_frontmatter.replace(
            "name: sample", "name: true"
        ),
        "unquoted hex": valid_frontmatter.replace(
            'description: "Valid scalar with punctuation."',
            "description: 0x10",
        ),
        "unquoted octal": valid_frontmatter.replace(
            f'version: "{GUIDE_VERSION}"', "version: 0o10"
        ),
        "unquoted float": valid_frontmatter.replace(
            f'version: "{GUIDE_VERSION}"', "version: 2026.08"
        ),
        "unquoted timestamp": valid_frontmatter.replace(
            'last-reviewed: "2026-08-10"',
            "last-reviewed: 2026-08-08T12:30:00Z",
        ),
        "quoted plain key": valid_frontmatter.replace(
            "name: sample", 'name: "sample"'
        ),
        "unterminated quote": valid_frontmatter.replace(
            f'version: "{GUIDE_VERSION}"', f'version: "{GUIDE_VERSION}'
        ),
    }
    for case, fixture in invalid_frontmatter.items():
        try:
            parse_frontmatter(fixture, case)
        except ValidationError:
            pass
        else:
            raise AssertionError(f"frontmatter self-test accepted {case}")

    with tempfile.TemporaryDirectory() as directory:
        sandbox = Path(directory)
        fixture_root = sandbox / "repository"
        (fixture_root / "docs").mkdir(parents=True)
        outside = sandbox / "outside"
        outside.mkdir()
        (outside / "target.md").write_text("# Outside\n", encoding="utf-8")
        symlink_escape_available = True
        try:
            (fixture_root / "escape").symlink_to(
                outside, target_is_directory=True
            )
        except (OSError, NotImplementedError):
            symlink_escape_available = False
        existing = fixture_root / "docs/example_(v1).md"
        existing.write_text("# Existing\n", encoding="utf-8")
        escaped_label_target = fixture_root / "docs/escaped-label.md"
        escaped_label_target.write_text("# Escaped\n", encoding="utf-8")
        plain_label_target = fixture_root / "docs/plain-label.md"
        plain_label_target.write_text("# Plain\n", encoding="utf-8")
        source = fixture_root / "source.md"
        positive = r"""[inline](docs/example_(v1).md)
[escaped inline x\]y](docs/example_(v1).md)
![escaped image x\]y](docs/example_(v1).md)
[nested [label]](docs/example_(v1).md)
[reference][guide]
[reference followed by text][guide](docs/missing.md)
[escaped reference][escaped\]label]
[collapsed][]
[shortcut]

[guide]: docs/example_(v1).md
[escaped\]label]: docs/example_(v1).md
[collapsed]: docs/example_(v1).md
[shortcut]: docs/example_(v1).md
        """
        validate_relative_links(positive, source, fixture_root)
        distinct_escaped_labels = r"""[escaped][foo\!]
[plain][foo!]

[foo\!]: docs/escaped-label.md
[foo!]: docs/plain-label.md
"""
        validate_relative_links(
            distinct_escaped_labels, source, fixture_root
        )
        ignored = """`[inline-code](missing.md)`
`http://apache.org/xml/features/disallow-doctype-decl`
`multiline code
[multiline-code](missing.md)
span`
```md
[fenced-code](missing.md)
http://apache.org/xml/features/disallow-doctype-decl
```
"""
        if extract_markdown_targets(ignored, source):
            raise AssertionError("code-contained links were not ignored")
        invalid_links = {
            "missing reference": "[reference][absent]",
            "missing local target": "[missing](docs/missing_(v1).md)",
            "parent traversal": "[outside](../outside/target.md)",
        }
        if symlink_escape_available:
            invalid_links["symlink escape"] = "[outside](escape/target.md)"
        for case, fixture in invalid_links.items():
            try:
                validate_relative_links(fixture, source, fixture_root)
            except ValidationError:
                pass
            else:
                raise AssertionError(f"link self-test accepted {case}")

        escaped_containment = {
            "escaped inline parent traversal": (
                r"[x\]y](../outside/target.md)"
            ),
            "escaped reference parent traversal": r"""[use][x\]y]

[x\]y]: ../outside/target.md
""",
        }
        if symlink_escape_available:
            escaped_containment["escaped definition symlink"] = (
                r"[x\]y]: escape/target.md"
            )
        for case, fixture in escaped_containment.items():
            try:
                validate_relative_links(fixture, source, fixture_root)
            except ValidationError as error:
                if "escapes repository" not in str(error):
                    raise AssertionError(
                        f"link self-test {case} failed for wrong reason: "
                        f"{error}"
                    ) from error
            else:
                raise AssertionError(f"link self-test accepted {case}")

    print(
        "parser self-tests passed: per-key frontmatter; balanced inline "
        "targets; escaped/nested labels; escape-distinct references; "
        "repository containment; missing targets; code ignored"
    )

def _markdown_files(root: Path) -> list[Path]:
    excluded_parts = {
        ".git",
        ".worktrees",
        ".superpowers",
        ".forgeloop",
        "node_modules",
        "coverage",
    }
    return sorted(
        path for path in root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".md", ".mdc"}
        and not (excluded_parts & set(path.relative_to(root).parts))
    )


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


def load_guide_registry(root: Path) -> dict[str, dict]:
    registry_path = root / "src" / "config" / "guides.json"
    if not registry_path.is_file():
        raise ValidationError("missing canonical guide registry: src/config/guides.json")
    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValidationError(f"invalid guide registry JSON: {error}") from error
    if not isinstance(data, dict):
        raise ValidationError("guide registry root must be an object")
    return data


def validate_repository(root: Path) -> None:
    root = root.resolve()
    registry = load_guide_registry(root)
    registry_paths = {def_data.get("path") for def_data in registry.values() if isinstance(def_data, dict)}
    disk_paths = {path.relative_to(root).as_posix() for path in root.glob("ENG/*.md")}

    missing = registry_paths - disk_paths
    unregistered = disk_paths - registry_paths

    if missing:
        raise ValidationError("registered guide files missing: " + ", ".join(sorted(missing)))
    if unregistered:
        raise ValidationError("unregistered guide files: " + ", ".join(sorted(unregistered)))

    guides = sorted(root.glob("ENG/*.md"))
    names = set()
    for path in guides:
        if not path.is_file():
            raise ValidationError(f"{path}: guide file is missing")
        text = path.read_text(encoding="utf-8")
        metadata = parse_frontmatter(text, path)
        if metadata["name"] != path.stem or not metadata["description"]:
            raise ValidationError(f"{path}: invalid name or empty description")
        if path.parent.name != "ENG" or metadata["language"] != "en":
            raise ValidationError(f"{path}: expected English guide with language en")
        if metadata["version"] != GUIDE_VERSION:
            raise ValidationError(f"{path}: unexpected version")
        validate_iso_date(str(metadata["last-reviewed"]), "last-reviewed", str(path))
        if metadata["name"] in names:
            raise ValidationError(f"{path}: duplicate name {metadata['name']}")
        names.add(metadata["name"])

    for path in _markdown_files(root):
        text = path.read_text(encoding="utf-8")
        balanced_fences(text, path)
        validate_relative_links(text, path, root)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    try:
        if args.self_test:
            run_self_tests()
        else:
            root = args.root.resolve()
            validate_repository(root)
            guide_count = len(sorted(root.glob("ENG/*.md")))
            print(f"validated {guide_count} guides; fences and relative links in {len(_markdown_files(root))} Markdown files")
        return 0
    except (ValidationError, AssertionError) as error:
        print(f"Markdown validation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

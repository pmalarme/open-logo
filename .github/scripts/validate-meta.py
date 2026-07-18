#!/usr/bin/env python3
"""Validate OpenLogo repo metadata: issue forms, label manifest, labeler, workflows, and
agent/skill frontmatter.

Run in CI (see .github/workflows/ci.yml, meta job). Fails if an issue template or the
labeler references a label that is not defined in .github/labels.yml, if any of the
metadata YAML files fail to parse, or if an agent/skill markdown frontmatter block is
missing, malformed, invalid YAML, or lacks a non-empty `name`/`description`.
"""
import glob
import os
import sys

import yaml


def load(path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def check_frontmatter(path):
    """Return a list of error strings for the YAML frontmatter of a markdown file.

    Enforces: an opening `---` fence on the first line, a matching closing `---` fence,
    a block that parses as a YAML mapping, and non-empty `name` and `description` keys.
    An empty list means the file is valid.
    """
    errors = []
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    # Tolerate a UTF-8 BOM; splitlines() normalises CRLF/CR/LF line endings.
    if text.startswith("\ufeff"):
        text = text[1:]
    lines = text.splitlines()

    if not lines or lines[0].strip() != "---":
        errors.append(f"{path}: missing opening '---' frontmatter fence")
        return errors

    closing = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if closing is None:
        errors.append(f"{path}: missing closing '---' frontmatter fence")
        return errors

    block = "\n".join(lines[1:closing])
    try:
        data = yaml.safe_load(block)
    except yaml.YAMLError as exc:
        detail = str(exc).splitlines()[0] if str(exc) else exc.__class__.__name__
        errors.append(f"{path}: frontmatter is not valid YAML ({detail})")
        return errors

    if not isinstance(data, dict):
        errors.append(f"{path}: frontmatter must be a YAML mapping with name/description")
        return errors

    for key in ("name", "description"):
        value = data.get(key)
        if value is None:
            errors.append(f"{path}: frontmatter is missing '{key}'")
        elif isinstance(value, str) and not value.strip():
            errors.append(f"{path}: frontmatter '{key}' is empty")
        elif not isinstance(value, str):
            errors.append(f"{path}: frontmatter '{key}' must be a non-empty string")
    return errors


def main():
    errors = []

    # Label taxonomy is the source of truth.
    labels = load(".github/labels.yml")
    label_names = {entry["name"] for entry in labels}

    # Every issue form's default labels must exist in the manifest.
    for fp in sorted(glob.glob(".github/ISSUE_TEMPLATE/*.yml")):
        if os.path.basename(fp) == "config.yml":
            continue
        doc = load(fp)
        for label in doc.get("labels", []) or []:
            if label not in label_names:
                errors.append(f"{fp}: label '{label}' is not defined in labels.yml")

    # Every labeler target label must exist in the manifest.
    labeler = load(".github/labeler.yml")
    for label in labeler.keys():
        if label not in label_names:
            errors.append(f".github/labeler.yml: label '{label}' is not defined in labels.yml")

    # All workflows must parse.
    for fp in sorted(glob.glob(".github/workflows/*.yml")):
        load(fp)

    # Every agent and skill playbook must carry a valid name/description frontmatter block.
    agent_files = sorted(glob.glob(".github/agents/*.agent.md"))
    skill_files = sorted(glob.glob(".github/skills/**/SKILL.md", recursive=True))
    for fp in agent_files + skill_files:
        errors.extend(check_frontmatter(fp))

    # Runnable examples are optional early on; note their absence without failing.
    if not glob.glob("spec/examples/*.logo"):
        print("note: no spec/examples/*.logo yet (skipping example run in meta)")

    if errors:
        print("META VALIDATION FAILED:")
        for e in errors:
            print("  -", e)
        sys.exit(1)

    print(f"meta validation passed: {len(label_names)} labels, "
          f"{len(glob.glob('.github/ISSUE_TEMPLATE/*.yml'))} issue forms, "
          f"{len(agent_files)} agents, {len(skill_files)} skills checked")


if __name__ == "__main__":
    main()

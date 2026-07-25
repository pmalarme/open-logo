#!/usr/bin/env python3
"""Validate Conventional Commits for OpenLogo PR titles and commit subjects.

Enforces `type(scope): subject` where:
  * type  is one of the Conventional Commit types below;
  * scope is a profile or area from the OpenLogo taxonomy (a few infra scopes allowed);
  * an optional `!` marks a breaking change.

Usage (CI): set PR_TITLE and optionally BASE_SHA/HEAD_SHA, then run this script.
  - PR_TITLE (required in CI) is linted as the squash-merge subject.
  - If BASE_SHA and HEAD_SHA are set, every commit subject in BASE_SHA..HEAD_SHA is linted too.
Locally: `python .github/scripts/validate-commits.py "feat(data): add lists"` lints the argument.

See .github/skills/devops/branching-and-commits/SKILL.md (source of truth for scopes).
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

TYPES = {
    "feat", "fix", "docs", "style", "refactor",
    "perf", "test", "build", "ci", "chore", "revert",
}

# Scopes = OpenLogo profiles + cross-cutting areas + a few infra scopes.
PROFILES = {
    "core", "turtle-rendering", "data", "geometry", "heritage", "sprites",
    "interaction", "sound", "modules", "localization", "educational", "tutor-ai",
}
AREAS = {"grammar", "highlighter", "checker", "runtime", "rendering", "studio", "edu", "ci", "docs", "spec"}
INFRA = {"deps", "release", "repo", "meta"}
SCOPES = PROFILES | AREAS | INFRA

# type(scope)!: subject   — scope + `!` optional; subject non-empty.
PATTERN = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[a-z0-9-]+)\))?(?P<bang>!)?: (?P<subject>.+)$")


def check(kind: str, message: str) -> list[str]:
    """Return a list of error strings for one title/subject (empty = valid)."""
    subject = message.splitlines()[0].strip() if message else ""
    if not subject:
        return [f"{kind}: empty message"]
    # Allow the generated merge/revert commit subjects git/GitHub create outside the
    # convention — but ONLY for commit subjects, never for a PR title (a PR title is
    # authored and must always be a well-formed Conventional Commit).
    if kind == "commit subject" and (subject.startswith("Merge ") or subject.startswith("Revert ")):
        return []
    m = PATTERN.match(subject)
    if not m:
        return [
            f'{kind}: "{subject}"\n'
            f"    must match `type(scope): subject` (e.g. `feat(data): add list primitives`)."
        ]
    errors: list[str] = []
    if m.group("type") not in TYPES:
        errors.append(f'{kind}: "{subject}"\n    unknown type "{m.group("type")}"; use one of: {", ".join(sorted(TYPES))}.')
    scope = m.group("scope")
    if scope is None:
        errors.append(f'{kind}: "{subject}"\n    missing scope; add a profile/area scope, e.g. `{m.group("type")}(runtime): ...`.')
    elif scope not in SCOPES:
        errors.append(f'{kind}: "{subject}"\n    unknown scope "{scope}"; use a profile or area (see branching-and-commits).')
    return errors


def commit_subjects(base: str, head: str) -> list[str]:
    out = subprocess.run(
        ["git", "log", "--no-merges", "--format=%s", f"{base}..{head}"],
        capture_output=True, text=True, check=True,
    ).stdout
    return [line for line in out.splitlines() if line.strip()]


def main() -> int:
    errors: list[str] = []

    if len(sys.argv) > 1:  # local: lint the argument only
        errors += check("commit subject", sys.argv[1])
    else:
        title = os.environ.get("PR_TITLE", "").strip()
        if title:
            errors += check("PR title", title)
        base, head = os.environ.get("BASE_SHA", ""), os.environ.get("HEAD_SHA", "")
        if base and head:
            for subject in commit_subjects(base, head):
                errors += check("commit subject", subject)
        if not title and not (base and head):
            print("nothing to lint (set PR_TITLE or BASE_SHA/HEAD_SHA, or pass a subject arg)")
            return 0

    if errors:
        print("Conventional Commit check failed:\n")
        for e in errors:
            print(f"  - {e}")
        print("\nFormat: type(scope): subject — see .github/skills/devops/branching-and-commits/SKILL.md")
        return 1
    print("Conventional Commit check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

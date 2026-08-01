#!/usr/bin/env python3
"""Validate Conventional Commits for OpenLogo PR titles and commit subjects.

Enforces `type(scope): subject` where:
  * type  is one of the Conventional Commit types below — REQUIRED;
  * scope is OPTIONAL (Conventional Commits v1.0.0). When present it must be one to three
    comma-separated scopes from the OpenLogo taxonomy (a few infra scopes allowed);
  * an optional `!` marks a breaking change;
  * subject is REQUIRED.

Two severities, because the two surfaces have different fates:
  * PR title       — BLOCKING. It becomes the squash-merge subject, so it is what lands in
                     history on `main` / `saga/*`.
  * commit subject — ADVISORY. Squash-merge discards individual subjects, and a cloud coding
                     agent cannot rewrite the bootstrap commits the platform creates before its
                     first turn. Reported as warnings; never fails the build.

Usage (CI): set PR_TITLE and optionally BASE_SHA/HEAD_SHA, then run this script.
  - PR_TITLE (required in CI) is linted as the squash-merge subject (blocking).
  - If BASE_SHA and HEAD_SHA are set, every commit subject in BASE_SHA..HEAD_SHA is linted too
    (advisory; emitted as GitHub warning annotations when running in Actions).
Locally: `python .github/scripts/validate-commits.py "feat(data): add lists"` lints the argument
  as a commit subject — blocking, so the local `.githooks/commit-msg` hook can use it.

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

# Scopes = OpenLogo profiles + cross-cutting areas + governance/infra scopes.
# Keep in sync with .github/skills/devops/branching-and-commits/SKILL.md (source of truth)
# and .github/labels.yml. PROFILES mirror `profile:*`; AREAS mirror the `area:*` labels
# EXCEPT `core` (already a profile scope, so not duplicated here). GOVERN/INFRA scopes have
# no `area:*` label: `spec` is the maintainer-owned spec/ surface (tracked by `type:spec`).
PROFILES = {
    "core", "turtle-rendering", "data", "geometry", "heritage", "sprites",
    "interaction", "sound", "modules", "localization", "educational", "tutor-ai",
}
# AREAS mirror `area:*` labels (minus `core`, which is a profile scope above).
AREAS = {"grammar", "highlighter", "checker", "runtime", "rendering", "studio", "edu", "ci", "docs"}
# Governance + infra scopes (no `area:*` label).
INFRA = {"spec", "deps", "release", "repo", "meta"}
SCOPES = PROFILES | AREAS | INFRA

# More than this many scopes means the change should be split (or use an umbrella scope).
MAX_SCOPES = 3

# type(scope,scope)!: subject   — scope + `!` optional; subject non-empty.
PATTERN = re.compile(
    r"^(?P<type>[a-z]+)(?:\((?P<scope>[a-z0-9,-]+)\))?(?P<bang>!)?: (?P<subject>.+)$"
)


def check(kind: str, message: str) -> tuple[list[str], list[str]]:
    """Lint one title/subject. Returns (errors, notes); empty errors = valid."""
    subject = message.splitlines()[0].strip() if message else ""
    if not subject:
        return ([f"{kind}: empty message"], [])
    # Allow the generated merge/revert commit subjects git/GitHub create outside the
    # convention — but ONLY for commit subjects, never for a PR title (a PR title is
    # authored and must always be a well-formed Conventional Commit).
    if kind == "commit subject" and (subject.startswith("Merge ") or subject.startswith("Revert ")):
        return ([], [])
    m = PATTERN.match(subject)
    if not m:
        return ([
            f'{kind}: "{subject}"\n'
            f"    must match `type(scope): subject` (e.g. `feat(data): add list primitives`); "
            f"scope is optional, so `feat: ...` is also valid."
        ], [])
    errors: list[str] = []
    notes: list[str] = []
    if m.group("type") not in TYPES:
        errors.append(f'{kind}: "{subject}"\n    unknown type "{m.group("type")}"; use one of: {", ".join(sorted(TYPES))}.')
    raw_scope = m.group("scope")
    if raw_scope is None:
        # Scope is optional (Conventional Commits v1.0.0) — nudge, never block.
        notes.append(f'{kind}: "{subject}"\n    consider adding a scope, e.g. `{m.group("type")}(runtime): ...`.')
    else:
        scopes = raw_scope.split(",")
        if any(not s for s in scopes):
            errors.append(f'{kind}: "{subject}"\n    malformed scope "{raw_scope}"; use `scope` or `scope,scope` with no empty entries.')
        else:
            unknown = [s for s in scopes if s not in SCOPES]
            if unknown:
                errors.append(
                    f'{kind}: "{subject}"\n    unknown scope{"s" if len(unknown) > 1 else ""} '
                    f'{", ".join(chr(34) + s + chr(34) for s in unknown)}; use a profile or area (see branching-and-commits).'
                )
            if len(scopes) > MAX_SCOPES:
                errors.append(
                    f'{kind}: "{subject}"\n    {len(scopes)} scopes; at most {MAX_SCOPES} are allowed — '
                    f"pick the primary domain, split the change, or use an umbrella scope (`repo`, `meta`)."
                )
            if len(scopes) != len(set(scopes)):
                errors.append(f'{kind}: "{subject}"\n    duplicate scope in "{raw_scope}".')
    return (errors, notes)


def commit_subjects(base: str, head: str) -> list[str]:
    out = subprocess.run(
        ["git", "log", "--no-merges", "--format=%s", f"{base}..{head}"],
        capture_output=True, text=True, check=True,
    ).stdout
    return [line for line in out.splitlines() if line.strip()]


def annotate(level: str, text: str) -> None:
    """Emit a GitHub Actions annotation when running in Actions; plain text otherwise."""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::{level}::{text.replace(chr(10), ' ')}")
    else:
        print(f"  - {text}")


def main() -> int:
    errors: list[str] = []
    advisories: list[str] = []
    notes: list[str] = []

    if len(sys.argv) > 1:  # local (and git hook): lint the argument, blocking
        e, n = check("commit subject", sys.argv[1])
        errors += e
        notes += n
    else:
        title = os.environ.get("PR_TITLE", "").strip()
        if title:
            e, n = check("PR title", title)
            errors += e
            notes += n
        base, head = os.environ.get("BASE_SHA", ""), os.environ.get("HEAD_SHA", "")
        if base and head:
            for subject in commit_subjects(base, head):
                e, _ = check("commit subject", subject)
                advisories += e  # commit subjects never block — see module docstring
        if not title and not (base and head):
            print("nothing to lint (set PR_TITLE or BASE_SHA/HEAD_SHA, or pass a subject arg)")
            return 0

    for note in notes:
        annotate("notice", note)
    if advisories:
        print("Commit subjects that do not follow the convention (advisory — squash-merge "
              "uses the PR title, which is linted strictly):\n")
        for a in advisories:
            annotate("warning", a)
        print()

    if errors:
        print("Conventional Commit check failed:\n")
        for e in errors:
            print(f"  - {e}")
        print("\nFormat: type(scope): subject — scope optional, up to 3 comma-separated scopes.")
        print("See .github/skills/devops/branching-and-commits/SKILL.md")
        return 1
    print("Conventional Commit check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Guard that every gh-aw agentic-workflow source has its compiled lock file, and vice versa.

Issue #597: `gh-aw compile` (see AGENTS.md §"gh-aw bootstrap" and
docs/adr/0017-gh-aw-toolchain-bootstrap.md) turns each `.github/workflows/*.md` source into a
committed `*.lock.yml`. Content drift between a source and its lock file is caught separately, by
recompiling and diffing (see the `workflows-compile` job in .github/workflows/ci.yml) — but
`gh-aw compile` never deletes a lock file whose source disappeared, and it has nothing to compile
for a source that was added without ever being compiled. Both are silent otherwise: an orphaned
`*.lock.yml` with no matching `*.md` still runs in Actions even though nobody can review the
source that produced it, and a `*.md` with no `*.lock.yml` never ran at all. This script closes
that gap by checking the two file sets pair up 1:1, before `gh-aw compile` ever runs.

Stdlib only; never touches the network. Self-tested by test-validate-workflow-lockfiles.py, which
runs in the same CI job.

Usage (CI): `python .github/scripts/validate-workflow-lockfiles.py [path-to-workflows-dir]`.
A missing workflows directory is not an error — the repository may not have one.
"""

from __future__ import annotations

import os
import sys

MD_SUFFIX = ".md"
LOCK_SUFFIX = ".lock.yml"


def workflow_ids(directory: str, suffix: str) -> set[str]:
    """Return the set of workflow ids (basename without `suffix`) for files matching `suffix`."""
    ids: set[str] = set()
    for name in os.listdir(directory):
        path = os.path.join(directory, name)
        if not os.path.isfile(path):
            continue
        if name.endswith(suffix):
            ids.add(name[: -len(suffix)])
    return ids


def find_problems(directory: str) -> list[str]:
    """Return a list of actionable error messages for unpaired `.md`/`.lock.yml` files.

    Empty means every `.md` source has exactly one compiled `.lock.yml`, and every
    `.lock.yml` has exactly one `.md` source.
    """
    md_ids = workflow_ids(directory, MD_SUFFIX)
    lock_ids = workflow_ids(directory, LOCK_SUFFIX)

    problems: list[str] = []

    for workflow_id in sorted(md_ids - lock_ids):
        problems.append(
            f"{workflow_id}.md has no compiled {workflow_id}.lock.yml. "
            f"Fix: sh .github/aw/install.sh && gh-aw compile && "
            f"git add .github/workflows/{workflow_id}.lock.yml"
        )

    for workflow_id in sorted(lock_ids - md_ids):
        problems.append(
            f"{workflow_id}.lock.yml has no source {workflow_id}.md (orphaned compiled "
            f"workflow). Fix: restore .github/workflows/{workflow_id}.md, or delete the "
            f"orphaned lock file: git rm .github/workflows/{workflow_id}.lock.yml"
        )

    return problems


def main(argv: list[str]) -> int:
    directory = argv[1] if len(argv) > 1 else os.path.join(".github", "workflows")
    if not os.path.isdir(directory):
        print(f"{directory} not found — nothing to check.")
        return 0

    problems = find_problems(directory)
    if problems:
        print(
            f"{directory}: agentic-workflow source/lock-file pairing is broken:",
            file=sys.stderr,
        )
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    md_count = len(workflow_ids(directory, MD_SUFFIX))
    print(f"{directory}: every .md source has a .lock.yml and vice versa ({md_count} pair(s)).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

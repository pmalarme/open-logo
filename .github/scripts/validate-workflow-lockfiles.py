#!/usr/bin/env python3
"""Guard that every gh-aw agentic-workflow source has its compiled lock file, and vice versa.

Issue #597: `gh-aw compile` (see AGENTS.md §"gh-aw bootstrap" and
docs/adr/0017-gh-aw-toolchain-bootstrap.md) turns each `.github/workflows/*.md` source into a
committed `*.lock.yml` — but only for a source gh-aw actually treats as a compilable workflow.
Verified empirically against the pinned gh-aw v0.83.1: a `.md` gh-aw will compile must have its
*first line* be a frontmatter opener (`---`) AND its frontmatter must declare a top-level `on:`
trigger. Anything else is legitimately lock-free, not an error:
  - No frontmatter opener at all (e.g. a plain `README.md`) — gh-aw silently ignores the file.
  - Frontmatter present but no `on:` trigger — gh-aw treats it as an importable fragment/include
    ("Skipping compilation.") even though it still counts toward "Compiled N workflow(s)".
  - Anything under a subdirectory (e.g. `.github/workflows/shared/*.md`) — gh-aw only compiles
    files directly in `.github/workflows/`, never recurses.
`requires_lock()` below reimplements exactly that first-line + top-level-`on:` test so this guard
never demands a `.lock.yml` gh-aw would never produce.

Content drift between a paired source and its lock file is caught separately, by recompiling and
diffing (see the `workflows-compile` job in .github/workflows/ci.yml) — but `gh-aw compile` never
deletes a lock file whose source disappeared, and it has nothing to compile for a source that was
added without ever being compiled. Both are silent otherwise: an orphaned `*.lock.yml` with no
matching `*.md` still runs in Actions even though nobody can review the source that produced it,
and a compilable `*.md` with no `*.lock.yml` never ran at all. This script closes that gap by
checking the two file sets pair up 1:1 — for the subset of `.md` files gh-aw would actually
compile — before `gh-aw compile` ever runs. The orphan direction (`*.lock.yml` with no matching
`*.md`) is unconditional: any `.md` with that basename counts as its source, compilable or not,
since a lock file cannot exist without something having once compiled it.

Stdlib only; never touches the network — deliberately does not import `pyyaml` (the `meta` job
happens to install it for other checks, but a minimal frontmatter scan is simpler and enough here;
see `requires_lock()` for exactly what it does and does not parse). Self-tested by
test-validate-workflow-lockfiles.py, which runs in the same CI job.

Usage (CI): `python .github/scripts/validate-workflow-lockfiles.py [path-to-workflows-dir]`.
A missing workflows directory is not an error — the repository may not have one.
"""

from __future__ import annotations

import os
import re
import sys

MD_SUFFIX = ".md"
LOCK_SUFFIX = ".lock.yml"

# Matches a top-level `on:` key, i.e. at the very start of a frontmatter line — not indented
# (which would mean it is nested under some other key, e.g. `permissions:\n  on: ...`, not a
# gh-aw trigger) and not merely a prefix of a longer key (e.g. `onward:`), thanks to the `:`
# right after `on` and requiring whitespace-or-end-of-line after it.
_TOP_LEVEL_ON_KEY = re.compile(r"^on:(\s|$)")


def requires_lock(path: str) -> bool:
    """Return True if gh-aw would actually compile `path` into a `.lock.yml`.

    Reimplements gh-aw's real compile semantics (empirically verified against the pinned gh-aw
    v0.83.1 in a throwaway repo, not assumed): the file's first line must be a frontmatter opener
    (`---`), and the frontmatter block (the lines between that opener and the next line that is
    exactly `---`) must contain a top-level `on:` key. Everything else — no frontmatter opener, or
    frontmatter with no top-level `on:` — is a file gh-aw does not compile, so it is not a source
    that needs a paired lock file.

    Deliberately does not fully parse YAML: it only needs to answer "is there a top-level `on:`
    key in the frontmatter," and a line-oriented scan bounded by the frontmatter delimiters is
    both correct for that question and avoids taking a `pyyaml` dependency in a stdlib-only,
    network-free script. `on:` text in the markdown body (after the closing `---`) or indented
    under another key must not count, and does not — see `_TOP_LEVEL_ON_KEY` and the bound to
    `frontmatter_lines`.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            lines = handle.read().splitlines()
    except OSError:
        return False

    if not lines or lines[0].strip() != "---":
        return False

    closing_index = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            closing_index = index
            break

    # No closing delimiter found: treat the rest of the file as frontmatter, best-effort — an
    # unterminated frontmatter block is malformed either way, and gh-aw's own parser would reject
    # it long before this guard's opinion on "does it need a lock file" matters.
    frontmatter_lines = lines[1:closing_index] if closing_index is not None else lines[1:]

    return any(_TOP_LEVEL_ON_KEY.match(line) for line in frontmatter_lines)


def workflow_ids(directory: str, suffix: str, predicate=None) -> set[str]:
    """Return the set of workflow ids (basename without `suffix`) for files matching `suffix`.

    `predicate`, if given, is called with the full path of each matching file; only files for
    which it returns True are included. `os.listdir` only lists direct children of `directory`,
    so files nested under a subdirectory (e.g. `.github/workflows/shared/`) are never considered
    — matching gh-aw, which never recurses into subdirectories either.
    """
    ids: set[str] = set()
    for name in os.listdir(directory):
        path = os.path.join(directory, name)
        if not os.path.isfile(path):
            continue
        if name.endswith(suffix):
            if predicate is not None and not predicate(path):
                continue
            ids.add(name[: -len(suffix)])
    return ids


def find_problems(directory: str) -> list[str]:
    """Return a list of actionable error messages for unpaired `.md`/`.lock.yml` files.

    Empty means every `.md` source gh-aw would actually compile has exactly one compiled
    `.lock.yml`, and every `.lock.yml` has exactly one `.md` file of the same basename (compilable
    or not — see the module docstring for why the orphan direction stays unconditional).
    """
    all_md_ids = workflow_ids(directory, MD_SUFFIX)
    compilable_md_ids = workflow_ids(directory, MD_SUFFIX, predicate=requires_lock)
    lock_ids = workflow_ids(directory, LOCK_SUFFIX)

    problems: list[str] = []

    for workflow_id in sorted(compilable_md_ids - lock_ids):
        problems.append(
            f"{workflow_id}.md has no compiled {workflow_id}.lock.yml. "
            f"Fix: sh .github/aw/install.sh && gh-aw compile && "
            f"git add .github/workflows/{workflow_id}.lock.yml"
        )

    for workflow_id in sorted(lock_ids - all_md_ids):
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

    pair_count = len(workflow_ids(directory, MD_SUFFIX, predicate=requires_lock))
    print(
        f"{directory}: every compilable .md source has a .lock.yml and vice versa "
        f"({pair_count} pair(s))."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

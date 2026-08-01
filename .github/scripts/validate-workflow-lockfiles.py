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

`requires_lock()` below does **not** reimplement gh-aw's full YAML+frontmatter grammar — that
would need a real YAML parser, which this deliberately stdlib-only script does not take a
dependency on (see below). It only recognizes the one shape that matters for KISS: a top-level
`on:` key on a block-style frontmatter line (unquoted, single-, or double-quoted, any whitespace
before the colon). Flow-mapping frontmatter (frontmatter that is itself a single `{...}`, e.g.
`{on: push, name: x}`) is not parsed at all — it is treated as **requiring** a lock unconditionally,
whether or not it actually has an `on:` key. This is deliberately blunt rather than a hand-rolled
flow-YAML tokenizer: verified empirically against gh-aw v0.83.1 that a flow mapping with `on:`
nested only under another key (e.g. `{tools: {on: push}, name: x}`) does not quietly get skipped
either — `gh-aw compile` itself fails outright on it ("field 'name' cannot be used in shared
workflows (only allowed in main workflows with 'on' trigger)" / "compilation failed", exit 1). So
for the one case a smarter parser would exist to distinguish, CI already goes red one way or the
other — via the `workflows-compile` job's failing compile, or via this guard's pairing error — and
a tokenizer to tell the two flow shapes apart buys no additional signal, just bespoke code to rot
on the next gh-aw upgrade. Any frontmatter shape this scan cannot confidently classify is treated
as **requiring** a lock: failing closed (over-eager, possibly-spurious pairing errors that a
maintainer notices and can fix) is deliberately preferred over failing open (silent skip of a file
gh-aw actually compiles and runs). The `workflows-compile` job's `gh-aw compile` recompile-and-diff
step is the ground-truth backstop either way: it does not depend on this guard having classified
anything correctly, only on this guard having demanded a `.lock.yml` exists so `gh-aw compile` gets
a chance to check it for drift.

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

# Matches a top-level `on:` key on a block-style frontmatter line — not indented (which would
# mean it is nested under some other key, e.g. `permissions:\n  on: ...`, not a gh-aw trigger),
# not merely a prefix of a longer key (e.g. `onward:`), and allowing an unquoted, single-, or
# double-quoted key spelling and optional whitespace before the colon (all three compile
# identically under gh-aw v0.83.1 — verified empirically: `on: push`, `"on": push`, `'on': push`,
# and `on : push` all produce a `.lock.yml`).
_TOP_LEVEL_ON_KEY = re.compile(r"""^(?:"on"|'on'|on)\s*:(\s|$)""")


def requires_lock(path: str) -> bool:
    """Return True if gh-aw would actually compile `path` into a `.lock.yml`.

    Empirically verified against the pinned gh-aw v0.83.1 in throwaway repos, not assumed: the
    file's first line must be a frontmatter opener (`---`), and the frontmatter block (the lines
    between that opener and the next line that is exactly `---`) must declare a top-level `on:`
    trigger. Everything else — no frontmatter opener, or frontmatter with no top-level `on:` — is
    a file gh-aw does not compile, so it is not a source that needs a paired lock file.

    Two shapes are recognized:
      - Block-style: any frontmatter line matching `_TOP_LEVEL_ON_KEY` (unquoted/quoted key,
        optional space before the colon). This is the path that matters and is fully parsed.
      - Flow-style: the *entire* frontmatter, once joined and stripped, looks like a single flow
        mapping (starts with `{`). This is **not parsed at all** — it is treated as requiring a
        lock unconditionally, on the fail-closed policy below. A frontmatter that
        mixes block lines with an embedded flow value (e.g. `on: {branches: [main]}`) is still a
        block-style top-level `on:` and is caught by the first case; this second case only
        applies when the flow mapping *is* the frontmatter.

    Deliberately does not fully parse YAML — no `pyyaml` dependency (see module docstring), and
    deliberately no hand-rolled flow-mapping tokenizer either, since it would buy no real signal
    (see module docstring for why, verified against gh-aw v0.83.1). Two YAML corners are
    consciously out of scope and documented as known limitations rather than silently mishandled:
      - A block-style frontmatter is only found up to a `---` treated as the closing delimiter;
        a `---` inside e.g. a multi-line quoted scalar would be misread as the close. gh-aw
        workflow frontmatter is simple key/value config in practice, so this has not been
        observed, but if it happens, the scan still fails closed on whatever it finds truncated
        into `frontmatter_lines` rather than silently exempting the file.
      - `True:`/`yes:` and similar YAML-1.1 boolean-ish bare keys are not treated as spellings of
        `on:` — verified empirically that gh-aw itself does not honour them as trigger aliases
        (it errors with "Unknown property: true/yes"), so no special-casing is needed here.
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

    if any(_TOP_LEVEL_ON_KEY.match(line) for line in frontmatter_lines):
        return True

    # Flow-mapping frontmatter is not parsed at all: fail closed unconditionally (see module
    # docstring for why this is safe — gh-aw compile itself fails on the one shape a smarter
    # parser would exist to distinguish, so CI goes red either way).
    joined = "\n".join(frontmatter_lines).strip()
    if joined.startswith("{"):
        return True

    return False


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

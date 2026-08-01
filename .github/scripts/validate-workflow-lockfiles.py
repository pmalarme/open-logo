#!/usr/bin/env python3
"""Guard that every gh-aw agentic-workflow source has its compiled lock file, and vice versa.

Issue #597: `gh-aw compile` (see AGENTS.md §"gh-aw bootstrap" and
docs/adr/0017-gh-aw-toolchain-bootstrap.md) turns each `.github/workflows/*.md` source into a
committed `*.lock.yml` — but only for a source gh-aw actually treats as a compilable workflow.
Verified empirically against the pinned gh-aw v0.83.1: a `.md` gh-aw will compile must have its
*first line* be a frontmatter opener (`---`) AND its frontmatter must declare a top-level `on:`
trigger. Anything else is legitimately lock-free, not an error:
  - Any `README.md` (case-insensitive) — gh-aw excludes it by name as documentation, before it
    ever looks for frontmatter (`strings.EqualFold(filepath.Base(f), "readme.md")`, v0.83.1).
  - No frontmatter opener at all — gh-aw silently ignores the file.
  - Frontmatter present but no `on:` trigger — gh-aw treats it as an importable fragment/include
    ("Skipping compilation.") even though it still counts toward "Compiled N workflow(s)".
  - Anything under a subdirectory (e.g. `.github/workflows/shared/*.md`) — gh-aw only compiles
    files directly in `.github/workflows/`, never recurses.

`requires_lock()` below classifies a source by **parsing its frontmatter as YAML** (PyYAML's
`BaseLoader`, so every scalar stays a raw string — `on:` resolves to the key `"on"`, exactly as
gh-aw's Go YAML 1.2 parser sees it, rather than to YAML 1.1's boolean `True`) and asking whether it
declares a top-level `on` key. The `---` delimiters are matched the way gh-aw matches them — the
line with surrounding whitespace trimmed, BOM **not** stripped (`strings.TrimSpace(firstLine) ==
"---"` in pkg/cli/workflows.go and `isFrontmatterDelimiterLine` in pkg/parser/
frontmatter_content.go, v0.83.1) — so neither a padded ` ---` opener (which gh-aw *does* compile)
nor a BOM-prefixed one (which it does *not*) can make the guard disagree with the compiler. Block
style and flow style (`{on: push, name: x}`) are handled by the same code path, so a flow-style importable fragment with no trigger is correctly
lock-free instead of being spuriously flagged. Frontmatter this scan cannot confidently classify —
YAML that does not parse, or that parses to something other than a mapping — is treated as
**requiring** a lock: failing closed (an over-eager, maintainer-visible pairing error) is
deliberately preferred over failing open (a silent skip of a file gh-aw actually compiles and
runs). The `workflows-compile` job's `gh-aw compile` recompile-and-diff step is the ground-truth
backstop either way: it does not depend on this guard having classified anything correctly, only on
this guard having demanded a `.lock.yml` exists so `gh-aw compile` gets a chance to check it for
drift.

Content drift between a paired source and its lock file is caught separately, by recompiling and
diffing (see the `workflows-compile` job in .github/workflows/ci.yml) — but `gh-aw compile` never
deletes a lock file whose source disappeared, and it has nothing to compile for a source that was
added without ever being compiled. Both are silent otherwise: an orphaned `*.lock.yml` with no
matching `*.md` still runs in Actions even though nobody can review the source that produced it,
and a compilable `*.md` with no `*.lock.yml` never ran at all. This script closes that gap by
checking the two file sets pair up 1:1 — for the subset of `.md` files gh-aw would actually
compile — before `gh-aw compile` ever runs. A `*.lock.yml` is reported whenever its `*.md` is
missing **or** is no longer a file gh-aw compiles (its top-level `on:` trigger was removed,
demoting it to an importable fragment): both leave executable YAML that nothing recompiles, so
drift in it would never surface.

Never touches the network. Depends only on `pyyaml`, the same single dependency
`validate-meta.py` already relies on and every CI job running this guard installs. Self-tested by
test-validate-workflow-lockfiles.py, which runs in the same CI job.

Usage (CI): `python .github/scripts/validate-workflow-lockfiles.py [path-to-workflows-dir]`.
A missing workflows directory is not an error — the repository may not have one.
"""

from __future__ import annotations

import os
import sys

MD_SUFFIX = ".md"
LOCK_SUFFIX = ".lock.yml"

# The frontmatter key gh-aw reads as a workflow trigger. Parsed with PyYAML's `BaseLoader`, every
# scalar stays a raw string, so this matches `on:`, `"on":`, `'on':`, and `on :` — and, correctly,
# does *not* match YAML-1.1 boolean-ish spellings such as `True:` or `yes:` (gh-aw's Go YAML 1.2
# parser does not honour those as trigger aliases either; verified empirically against v0.83.1,
# where gh-aw errors with "Unknown property: true/yes" rather than compiling).
TRIGGER_KEY = "on"

# gh-aw excludes README.md from workflow discovery by name, case-insensitively, as documentation
# rather than a workflow — before any frontmatter is parsed (pkg/cli/workflows.go, v0.83.1). A
# README with frontmatter and an `on:` key is therefore never compiled, so demanding a lock file
# for it would be an impossible-to-satisfy CI failure.
EXCLUDED_MD_BASENAME = "readme.md"


def read_lines(path: str) -> list[str] | None:
    """Return `path`'s lines the way Go reads them, or None if it cannot be read.

    Split on `\n` only — deliberately **not** `str.splitlines()`, which also splits on U+0085,
    U+2028 and friends that Go's line scanning does not treat as line breaks. Mirroring Go here is
    what lets one shared implementation classify a source identically to gh-aw. Read as plain
    `utf-8`, never `utf-8-sig`: gh-aw does not strip a UTF-8 BOM (its delimiter test trims Unicode
    whitespace, and U+FEFF is not whitespace), so a BOM-prefixed `---` is a file it silently
    ignores; stripping the BOM here would demand a lock file no `gh-aw compile` can ever produce.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().split("\n")
    except OSError:
        return None


def is_delimiter(line: str | None) -> bool:
    """Return True if `line` is a frontmatter delimiter — `---` with surrounding whitespace.

    Mirrors gh-aw v0.83.1 exactly: `strings.TrimSpace(firstLine) == "---"` in pkg/cli/workflows.go
    and `isFrontmatterDelimiterLine` in pkg/parser/frontmatter_content.go. So a padded ` ---` (or a
    CRLF `---\r`, or one padded with U+00A0/U+0085) IS an opener and the source IS compiled;
    treating it as a plain doc would fail *open*. Python's `str.strip()` covers the same characters
    as Go's `unicode.IsSpace`, U+FEFF excluded from both.
    """
    return line is not None and line.strip() == "---"


def has_compilable_source(directory: str) -> bool:
    """Return True if the directory holds at least one `.md` gh-aw would try to compile.

    This is the *opener-only* question the `workflows-compile` job asks before invoking
    `gh-aw compile`, which exits 1 with "no workflow markdown files found" when a directory holds
    `.md` files but none with a frontmatter opener. Answering it here rather than re-deriving it in
    shell keeps one implementation of gh-aw's rules: a divergence between the two probes could let
    a stale or hand-edited `.lock.yml` skip drift detection while the pairing check passed. It
    needs no YAML parse — and therefore no PyPI download — so the compile job keeps its promise of
    no network beyond the pinned gh-aw release asset.
    """
    if not os.path.isdir(directory):
        return False

    for name in sorted(os.listdir(directory)):
        path = os.path.join(directory, name)
        if not os.path.isfile(path) or not name.endswith(MD_SUFFIX):
            continue
        if name.lower() == EXCLUDED_MD_BASENAME:
            continue
        lines = read_lines(path)
        if lines and is_delimiter(lines[0]):
            return True
    return False


def requires_lock(path: str) -> bool:
    """Return True if gh-aw would actually compile `path` into a `.lock.yml`.

    Empirically verified against the pinned gh-aw v0.83.1 in throwaway repos, not assumed: the
    the file must not be a `README.md` (gh-aw excludes that basename case-insensitively, as
    documentation), its first line must be a frontmatter opener (`---`), and the frontmatter block (the lines
    between that opener and the next line that is exactly `---`) must declare a top-level `on:`
    trigger. Everything else — no frontmatter opener, or frontmatter with no top-level `on:` — is
    a file gh-aw does not compile, so it is not a source that needs a paired lock file.

    The frontmatter is parsed as YAML with `yaml.BaseLoader` (all scalars kept as raw strings, so
    key spellings are compared exactly as gh-aw's Go YAML 1.2 parser sees them). Block style and
    flow style (`{on: push, name: x}`) therefore go through the same code path: a flow-style
    importable fragment with no trigger is correctly lock-free, and an `on:` nested under another
    key is correctly not a top-level trigger, in either style.

    Fails **closed** — returns True — whenever the frontmatter cannot be confidently classified:
    YAML that does not parse (e.g. an unterminated frontmatter block, which gh-aw would reject
    too), or that parses to anything other than a mapping. An over-eager pairing error is visible
    and fixable; a silent skip of a file gh-aw actually compiles and runs is not. Empty
    frontmatter parses to `None`, which is unambiguously "no trigger", so it needs no lock.

    Delimiters and file reading follow `is_delimiter()` / `read_lines()`, which mirror gh-aw's Go
    rules exactly, so the compile job's `--has-sources` probe and this pairing check can never
    disagree about whether a source is compilable.
    """
    if os.path.basename(path).lower() == EXCLUDED_MD_BASENAME:
        return False

    lines = read_lines(path)
    if lines is None:
        return False

    if not is_delimiter(lines[0] if lines else None):
        return False

    closing_index = None
    for index in range(1, len(lines)):
        if is_delimiter(lines[index]):
            closing_index = index
            break

    # No closing delimiter found: treat the rest of the file as frontmatter, best-effort — an
    # unterminated frontmatter block is malformed either way, and gh-aw's own parser would reject
    # it long before this guard's opinion on "does it need a lock file" matters.
    frontmatter_lines = lines[1:closing_index] if closing_index is not None else lines[1:]

    # gh-aw normalizes a non-breaking space to a plain space before unmarshalling
    # (pkg/parser/frontmatter_content.go `parseFrontmatterYAML`); mirror it so a source it parses
    # is not misread as unparsable here.
    block = "\n".join(frontmatter_lines).replace("\u00a0", " ")

    # Imported here, not at module scope, so `--has-sources` (the compile job's opener-only probe)
    # runs on a bare `python3` with no PyPI download; only the pairing check needs pyyaml, and it
    # runs in the `meta` job, which installs it.
    import yaml

    try:
        frontmatter = yaml.load(block, Loader=yaml.BaseLoader)
    except yaml.YAMLError:
        return True

    if frontmatter is None:
        return False
    if not isinstance(frontmatter, dict):
        return True

    return TRIGGER_KEY in frontmatter


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
    `.lock.yml`, and every `.lock.yml` is backed by a `.md` that gh-aw would actually *recompile*.
    A lock whose source exists but is no longer compilable (its top-level `on:` trigger was
    removed, turning it into an importable fragment) is just as stale as one whose source was
    deleted outright: `gh-aw compile` skips the source and never deletes the lock, so the
    orphaned YAML keeps running with nothing recompiling or reviewing it. Both cases are reported,
    with a message naming the actual cause.
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

    for workflow_id in sorted(lock_ids - compilable_md_ids):
        if workflow_id in all_md_ids:
            problems.append(
                f"{workflow_id}.lock.yml exists but {workflow_id}.md is not a workflow gh-aw "
                f"compiles (no frontmatter opener on line 1, or no top-level `on:` trigger), so "
                f"the lock file is stale and nothing will recompile it. Fix: restore the trigger "
                f"in .github/workflows/{workflow_id}.md and recompile, or delete the stale lock "
                f"file: git rm .github/workflows/{workflow_id}.lock.yml"
            )
        else:
            problems.append(
                f"{workflow_id}.lock.yml has no source {workflow_id}.md (orphaned compiled "
                f"workflow). Fix: restore .github/workflows/{workflow_id}.md, or delete the "
                f"orphaned lock file: git rm .github/workflows/{workflow_id}.lock.yml"
            )

    return problems


def main(argv: list[str]) -> int:
    args = argv[1:]
    # `--has-sources` answers only "would gh-aw find anything to compile here?", printing `true` or
    # `false` and exiting 0 either way — the `workflows-compile` job's early-exit probe. Sharing
    # this module's rules is the point: a second, hand-rolled shell implementation of the same
    # question could disagree, and a source the pairing check demands a lock for but the probe
    # skips would let a stale or hand-edited `.lock.yml` slip past the recompile-and-diff backstop.
    has_sources_mode = "--has-sources" in args
    if has_sources_mode:
        args = [arg for arg in args if arg != "--has-sources"]

    directory = args[0] if args else os.path.join(".github", "workflows")

    if has_sources_mode:
        print("true" if has_compilable_source(directory) else "false")
        return 0

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

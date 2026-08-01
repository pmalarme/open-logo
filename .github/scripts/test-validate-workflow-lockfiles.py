#!/usr/bin/env python3
"""Self-test for the workflow lock-file pairing guard in validate-workflow-lockfiles.py.

Runs in the CI `workflows-compile` job alongside the guard itself. Stdlib only; never touches
the network. Exits non-zero on any unexpected result.

Locks the edge cases the guard exists for: a compilable `.md` source with no compiled lock, a
`.lock.yml` with no source (orphaned), an empty directory (today's actual repo state — must pass
cleanly, not silently skip forever), a directory that does not exist at all, and — per the
gh-aw v0.83.1 compile semantics `requires_lock()` reimplements (see that function's docstring) —
every shape of `.md` that must NOT be treated as needing a lock file: no frontmatter opener at
all, frontmatter with no top-level `on:` trigger, a subdirectory fragment, `on:` appearing only in
the markdown body (after the closing `---`), and `on:` appearing only indented/nested under
another frontmatter key.
"""

import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "validate_workflow_lockfiles", os.path.join(HERE, "validate-workflow-lockfiles.py")
)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

failures = []

# A real gh-aw-compilable workflow source: frontmatter opener as the first line, top-level `on:`.
COMPILABLE_MD = "---\non: push\n---\n\nDo a thing.\n"


def write(directory: str, name: str, content: str = "placeholder\n") -> str:
    path = os.path.join(directory, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)
    return path


# --- requires_lock() unit checks: exactly what gh-aw v0.83.1 does and does not compile -------

with tempfile.TemporaryDirectory() as directory:
    compilable = write(directory, "compilable.md", COMPILABLE_MD)
    if not guard.requires_lock(compilable):
        failures.append("requires_lock: a frontmatter .md with top-level `on:` must be True")

    no_frontmatter = write(directory, "no-frontmatter.md", "# Just a README\n\nNo frontmatter.\n")
    if guard.requires_lock(no_frontmatter):
        failures.append("requires_lock: a .md with no frontmatter opener must be False")

    frontmatter_no_on = write(
        directory,
        "frontmatter-no-on.md",
        "---\nname: A shared fragment\ntools:\n  bash: true\n---\n\nBody.\n",
    )
    if guard.requires_lock(frontmatter_no_on):
        failures.append("requires_lock: frontmatter with no top-level `on:` must be False")

    on_in_body_only = write(
        directory,
        "on-in-body-only.md",
        "---\nname: no trigger here\n---\n\non: this is prose in the body, not YAML\n",
    )
    if guard.requires_lock(on_in_body_only):
        failures.append(
            "requires_lock: `on:`-looking text in the markdown body (after the closing "
            "delimiter) must not count as a trigger"
        )

    on_indented_only = write(
        directory,
        "on-indented-only.md",
        "---\npermissions:\n  on: push\n---\n\nBody.\n",
    )
    if guard.requires_lock(on_indented_only):
        failures.append(
            "requires_lock: an indented/nested `on:` (not a top-level frontmatter key) must "
            "not count as a trigger"
        )

    unterminated = write(directory, "unterminated.md", "---\non: push\n\nNo closing delimiter.\n")
    if not guard.requires_lock(unterminated):
        failures.append(
            "requires_lock: an unterminated frontmatter block should still be scanned "
            "best-effort and find the top-level `on:` it contains"
        )

# --- find_problems()/main() integration checks -------------------------------------------------

with tempfile.TemporaryDirectory() as directory:
    # Today's actual repo state: no .md, no .lock.yml at all. Must pass — not a silent skip
    # forever, just nothing to pair yet.
    if guard.find_problems(directory) != []:
        failures.append("empty directory: expected no problems")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 0:
        failures.append("main: empty directory should exit 0")

    # A clean pair: one compilable .md, one matching .lock.yml.
    write(directory, "demo.md", COMPILABLE_MD)
    write(directory, "demo.lock.yml")
    if guard.find_problems(directory) != []:
        failures.append("clean pair: expected no problems")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 0:
        failures.append("main: clean pair should exit 0")

    # A non-frontmatter .md (e.g. a README dropped into .github/workflows/) must never be
    # mistaken for a workflow source needing a lock file: gh-aw silently ignores it (fact 1).
    write(directory, "README.md", "# Workflows\n\nSee AGENTS.md.\n")
    if guard.find_problems(directory) != []:
        failures.append("no-frontmatter README.md: must not require a lock file")
    os.remove(os.path.join(directory, "README.md"))

    # A .md with frontmatter but no top-level `on:` (an importable fragment/include, fact 2)
    # must not require a lock file either.
    write(directory, "fragment.md", "---\ntools:\n  bash: true\n---\n\nShared prose.\n")
    if guard.find_problems(directory) != []:
        failures.append("frontmatter-without-on fragment.md: must not require a lock file")
    os.remove(os.path.join(directory, "fragment.md"))

    # A .md under a subdirectory (fact 3: gh-aw never recurses into .github/workflows/shared/)
    # must not require a lock file, even if it has a top-level `on:` trigger.
    write(directory, os.path.join("shared", "helper.md"), COMPILABLE_MD)
    if guard.find_problems(directory) != []:
        failures.append("shared/ subdirectory fragment: must not require a lock file")
    os.remove(os.path.join(directory, "shared", "helper.md"))
    os.rmdir(os.path.join(directory, "shared"))

    # A compilable .md source with no compiled lock file (forgot to run `gh-aw compile`).
    write(directory, "nolock.md", COMPILABLE_MD)
    problems = guard.find_problems(directory)
    if not any("nolock.md has no compiled nolock.lock.yml" in problem for problem in problems):
        failures.append(f"missing lock: expected a nolock.md problem, got {problems!r}")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 1:
        failures.append("main: a compilable .md source with no lock should exit 1")
    os.remove(os.path.join(directory, "nolock.md"))

    # An orphaned .lock.yml with no matching .md source (source deleted, lock left behind).
    write(directory, "ghost.lock.yml")
    problems = guard.find_problems(directory)
    if not any("ghost.lock.yml has no source ghost.md" in problem for problem in problems):
        failures.append(f"orphaned lock: expected a ghost.lock.yml problem, got {problems!r}")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 1:
        failures.append("main: an orphaned .lock.yml should exit 1")
    os.remove(os.path.join(directory, "ghost.lock.yml"))

    # Non-workflow files (e.g. hand-written *.yml) must never be mistaken for a lock file: only
    # the exact ".lock.yml" suffix counts, not any file ending in ".yml".
    write(directory, "ci.yml")
    if guard.find_problems(directory) != []:
        failures.append("hand-written .yml: must not be treated as an orphaned lock file")
    os.remove(os.path.join(directory, "ci.yml"))

# A missing workflows directory is not an error.
missing = os.path.join(tempfile.gettempdir(), "definitely-does-not-exist-validate-workflow-locks")
if guard.main(["validate-workflow-lockfiles.py", missing]) != 0:
    failures.append("main: a missing directory should exit 0")

if failures:
    print("Workflow lock-file pairing guard self-test FAILED:", file=sys.stderr)
    for failure in failures:
        print(f"  - {failure}", file=sys.stderr)
    sys.exit(1)

print("Workflow lock-file pairing guard self-test passed.")

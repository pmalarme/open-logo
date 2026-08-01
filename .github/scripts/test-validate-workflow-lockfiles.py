#!/usr/bin/env python3
"""Self-test for the workflow lock-file pairing guard in validate-workflow-lockfiles.py.

Runs in the CI `workflows-compile` job alongside the guard itself. Stdlib only; never touches
the network. Exits non-zero on any unexpected result.

Locks the edge cases the guard exists for: a `.md` source with no compiled lock, a `.lock.yml`
with no source (orphaned), an empty directory (today's actual repo state — must pass cleanly,
not silently skip forever), and a directory that does not exist at all.
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


def write(directory: str, name: str) -> None:
    with open(os.path.join(directory, name), "w", encoding="utf-8") as handle:
        handle.write("placeholder\n")


with tempfile.TemporaryDirectory() as directory:
    # Today's actual repo state: no .md, no .lock.yml at all. Must pass — not a silent skip
    # forever, just nothing to pair yet.
    if guard.find_problems(directory) != []:
        failures.append("empty directory: expected no problems")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 0:
        failures.append("main: empty directory should exit 0")

    # A clean pair: one .md, one matching .lock.yml.
    write(directory, "demo.md")
    write(directory, "demo.lock.yml")
    if guard.find_problems(directory) != []:
        failures.append("clean pair: expected no problems")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 0:
        failures.append("main: clean pair should exit 0")

    # A .md source with no compiled lock file (forgot to run `gh-aw compile`).
    write(directory, "nolock.md")
    problems = guard.find_problems(directory)
    if not any("nolock.md has no compiled nolock.lock.yml" in problem for problem in problems):
        failures.append(f"missing lock: expected a nolock.md problem, got {problems!r}")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 1:
        failures.append("main: a .md source with no lock should exit 1")
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

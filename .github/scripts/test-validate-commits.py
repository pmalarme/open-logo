#!/usr/bin/env python3
"""Self-test for the Conventional Commit checker in validate-commits.py.

Runs in the CI meta job alongside test-validate-meta.py. Stdlib only; never touches git or the
network. Exits non-zero on any unexpected result.

Covers the rules documented in .github/skills/devops/branching-and-commits/SKILL.md:
scope is optional, up to three comma-separated scopes are allowed, unknown scopes and types are
rejected, and generated Merge/Revert subjects are exempt for commits but not for PR titles.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "validate_commits", os.path.join(HERE, "validate-commits.py")
)
validate_commits = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate_commits)
check = validate_commits.check

# (label, kind, message, should_pass, should_note)
CASES = [
    # --- valid, with a scope ---
    ("single scope", "PR title", "feat(data): add list primitives", True, False),
    ("area scope", "PR title", "fix(runtime): correct repeat nesting", True, False),
    ("infra scope", "PR title", "ci(repo): pin actions", True, False),
    ("breaking change", "PR title", "feat(grammar)!: drop legacy block form", True, False),
    ("hyphenated scope", "PR title", "feat(turtle-rendering): add pen width", True, False),
    # --- valid, scope omitted (Conventional Commits v1.0.0) — passes with a nudge ---
    ("no scope", "PR title", "feat: add list primitives", True, True),
    ("no scope, breaking", "PR title", "feat!: drop legacy block form", True, True),
    ("no scope, commit", "commit subject", "chore: initial plan", True, True),
    # --- valid, multiple scopes ---
    ("two scopes", "PR title", "feat(grammar,runtime): add for-in loop", True, False),
    ("three scopes", "PR title", "feat(grammar,runtime,docs): add for-in loop", True, False),
    # --- invalid ---
    ("four scopes", "PR title", "feat(grammar,runtime,docs,edu): too broad", False, False),
    ("unknown scope", "PR title", "feat(frobnicator): nope", False, False),
    ("one unknown of two", "PR title", "feat(runtime,frobnicator): nope", False, False),
    ("duplicate scope", "PR title", "feat(runtime,runtime): nope", False, False),
    ("empty scope entry", "PR title", "feat(runtime,): nope", False, False),
    ("unknown type", "PR title", "frobnicate(runtime): nope", False, False),
    ("no type", "PR title", "just a sentence", False, False),
    ("missing space", "PR title", "feat(runtime):nope", False, False),
    ("empty subject", "PR title", "feat(runtime): ", False, False),
    ("empty message", "PR title", "", False, False),
    ("uppercase type", "PR title", "Feat(runtime): nope", False, False),
    # --- generated subjects: exempt for commits, never for a PR title ---
    ("merge commit exempt", "commit subject", "Merge branch 'main' into feature/1", True, False),
    ("revert commit exempt", "commit subject", "Revert \"feat(runtime): x\"", True, False),
    ("merge PR title not exempt", "PR title", "Merge branch 'main' into feature/1", False, False),
    ("revert PR title not exempt", "PR title", "Revert \"feat(runtime): x\"", False, False),
    # --- only the first line is linted ---
    ("body ignored", "PR title", "feat(runtime): ok\n\nnot a valid subject line", True, False),
]

failures = []
for label, kind, message, should_pass, should_note in CASES:
    errors, notes = check(kind, message)
    passed = not errors
    if passed != should_pass:
        failures.append(
            f"{label}: expected {'pass' if should_pass else 'fail'}, got "
            f"{'pass' if passed else 'fail'} ({errors})"
        )
    if bool(notes) != should_note:
        failures.append(
            f"{label}: expected {'a' if should_note else 'no'} scope nudge, got {notes}"
        )

# Every documented scope must be accepted, so the allowlist and the SKILL cannot silently drift.
for scope in sorted(validate_commits.SCOPES):
    errors, _ = check("PR title", f"feat({scope}): sample")
    if errors:
        failures.append(f"documented scope {scope!r} rejected: {errors}")

if failures:
    print("test-validate-commits.py FAILED:")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)

print(f"test-validate-commits.py: {len(CASES)} cases + {len(validate_commits.SCOPES)} scopes OK")

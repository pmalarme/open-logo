#!/usr/bin/env python3
"""Self-test for the agent/skill frontmatter check in validate-meta.py.

Runs in the CI meta job alongside validate-meta.py. Uses only the stdlib + PyYAML (already
present) and temporary files, so it never touches the real tree. Exits non-zero on any
unexpected result.
"""
import importlib.util
import os
import sys
import tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "validate_meta", os.path.join(HERE, "validate-meta.py")
)
validate_meta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate_meta)
check_frontmatter = validate_meta.check_frontmatter

VALID = "---\nname: sample\ndescription: A sample description.\n---\n\nBody text.\n"

# (label, content, should_pass)
CASES = [
    ("well-formed", VALID, True),
    ("well-formed CRLF", VALID.replace("\n", "\r\n"), True),
    ("folded description", "---\nname: sample\ndescription: >-\n  Folded text here.\n---\n", True),
    ("--- inside body ignored", VALID + "\nsome --- dashes\n---\n", True),
    ("no frontmatter", "Just a plain markdown body.\n", False),
    ("opening fence only", "---\nname: sample\ndescription: x\n", False),
    ("missing name", "---\ndescription: only description\n---\n", False),
    ("missing description", "---\nname: only-name\n---\n", False),
    ("empty name", "---\nname: \"\"\ndescription: x\n---\n", False),
    ("empty description", "---\nname: x\ndescription: \"   \"\n---\n", False),
    ("invalid yaml", "---\nname: x\ndescription: : : broken\n\t bad\n---\n", False),
    ("not a mapping", "---\n- just\n- a\n- list\n---\n", False),
    ("empty file", "", False),
]

failures = []
for label, content, should_pass in CASES:
    with tempfile.NamedTemporaryFile(
        "w", suffix=".md", delete=False, newline="", encoding="utf-8"
    ) as fh:
        fh.write(content)
        path = fh.name
    try:
        errors = check_frontmatter(path)
    finally:
        os.unlink(path)
    passed = not errors
    if passed != should_pass:
        failures.append(
            f"{label}: expected {'PASS' if should_pass else 'FAIL'}, got "
            f"{'PASS' if passed else 'FAIL'} (errors={errors})"
        )

# --- Gate wiring: CI must invoke every DoD gate, and no gate may be fail-open (issue #978) ------
#
# Review defeated two versions of this repository's own wiring: swapping `npm run -s lint` in
# ci.yml for a second `format:check` left the required "Lint & format" job green without linting,
# and a `continue-on-error: true` neutered label-drift.yml while its own self-test still passed.
# These MUTATION cases lock both, driven from a scratch tree so they never depend on the real one.
GATE_CASES = [
    (
        "every gate wired, nothing fail-open",
        {"jobs": {"lint": {"steps": [{"run": "npm run -s lint"}]}}},
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        True,
    ),
    (
        "MUTATION: ci.yml stops invoking the lint gate",
        {"jobs": {"lint": {"steps": [{"run": "npm run -s format:check"}]}}},
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        False,
    ),
    (
        "MUTATION: a gate JOB is fail-open",
        {"jobs": {"lint": {"steps": [{"run": "npm run -s lint"}]}}},
        {"jobs": {"drift": {"continue-on-error": True, "steps": [{"run": "python x.py"}]}}},
        False,
    ),
    (
        "MUTATION: a gate STEP is fail-open",
        {
            "jobs": {
                "lint": {"steps": [{"run": "npm run -s lint", "continue-on-error": True}]}
            }
        },
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        False,
    ),
]

for label, ci_document, other_document, should_pass in GATE_CASES:
    scratch = tempfile.mkdtemp()
    os.makedirs(os.path.join(scratch, ".github", "workflows"))
    # Only the lint gate is asserted in these fixtures; the rest are supplied so the "wired" case
    # is genuinely clean rather than passing because the check found nothing at all.
    ci_document["jobs"].setdefault("all", {"steps": []})["steps"] = [
        {"run": command}
        for command in (
            "npm run -s build",
            "npm run -s typecheck",
            "npm run -s format:check",
            "npm run -s test",
            "npm run -s conformance",
            "npm run -s examples",
            "npm run -s built-in-names",
            "npm run -s spec-citations",
            "npm run -s coverage",
        )
    ]
    with open(os.path.join(scratch, ".github", "workflows", "ci.yml"), "w", encoding="utf-8") as fh:
        yaml.safe_dump(ci_document, fh)
    with open(os.path.join(scratch, ".github", "workflows", "other.yml"), "w", encoding="utf-8") as fh:
        yaml.safe_dump(other_document, fh)

    cwd = os.getcwd()
    try:
        os.chdir(scratch)
        gate_errors = validate_meta.check_gate_wiring()
    finally:
        os.chdir(cwd)
    gate_passed = not gate_errors
    if gate_passed != should_pass:
        failures.append(
            f"{label}: expected {'PASS' if should_pass else 'FAIL'}, got "
            f"{'PASS' if gate_passed else 'FAIL'} (errors={gate_errors})"
        )

# The shipped workflows must themselves satisfy it.
shipped = validate_meta.check_gate_wiring()
if shipped:
    failures.append(f"the shipped workflows must pass the gate-wiring check, got {shipped}")

if failures:
    print("FRONTMATTER SELF-TEST FAILED:")
    for f in failures:
        print("  -", f)
    sys.exit(1)

print(
    f"validate-meta self-test passed: {len(CASES)} frontmatter cases, "
    f"{len(GATE_CASES)} gate-wiring cases"
)

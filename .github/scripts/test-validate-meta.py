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

if failures:
    print("FRONTMATTER SELF-TEST FAILED:")
    for f in failures:
        print("  -", f)
    sys.exit(1)

print(f"frontmatter self-test passed: {len(CASES)} cases")

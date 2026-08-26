#!/usr/bin/env python3
"""Self-test for the agent/skill frontmatter check in validate-meta.py.

Runs in the CI meta job alongside validate-meta.py. Uses only the stdlib + PyYAML (already
present) and temporary files, so it never touches the real tree. Exits non-zero on any
unexpected result.
"""
import importlib.util
import json
import os
import re
import sys
import tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
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

#: Every npm Definition-of-Done gate, written out independently of package.json.
ALL_GATES = [
    "build", "typecheck", "lint", "format:check", "test",
    "conformance", "examples", "built-in-names", "spec-citations", "coverage",
]

#: The Python metadata gates, written out INDEPENDENTLY of how validate-meta.py derives them.
#:
#: Review emptied the old hand-written tuple to `()` and every check still passed, because the
#: fixtures were built FROM the thing they were supposed to verify — issue #964's defect, and worse,
#: because the printed count was static so the collapse to zero was invisible. The production side
#: now derives this set from disk; this list is the second opinion that says the derivation found
#: the right things.
EXPECTED_PYTHON_GATES = [
    "python .github/scripts/validate-meta.py",
    "python .github/scripts/test-validate-meta.py",
    "python .github/scripts/validate-labels.py",
    "python .github/scripts/test-validate-labels.py",
    "python .github/scripts/validate-lockfile-registry.py",
    "python .github/scripts/test-validate-lockfile-registry.py",
    "python .github/scripts/validate-workflow-lockfiles.py",
    "python .github/scripts/test-validate-workflow-lockfiles.py",
]


def seed_scratch(scratch, gate_names=None, python_gates=None):
    """Lay out a scratch repo the derivations can actually read: package.json + gate scripts.

    Both halves are now derived from disk, so a fixture that omits the scripts makes the derivation
    correctly find nothing and every mutation pass vacuously. The fixture has to materialise the
    world it is testing.
    """
    gate_names = ALL_GATES if gate_names is None else gate_names
    python_gates = EXPECTED_PYTHON_GATES if python_gates is None else python_gates
    os.makedirs(os.path.join(scratch, ".github", "workflows"), exist_ok=True)
    os.makedirs(os.path.join(scratch, ".github", "scripts"), exist_ok=True)
    with open(os.path.join(scratch, "package.json"), "w", encoding="utf-8") as handle:
        json.dump({"scripts": {name: "x" for name in gate_names}}, handle)
    for command in python_gates:
        name = command.rsplit("/", 1)[-1]
        with open(os.path.join(scratch, ".github", "scripts", name), "w", encoding="utf-8") as handle:
            handle.write("# stub\n")
    return python_gates


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
    (
        "MUTATION: a gate JOB carries `if: false`",
        {"jobs": {"lint": {"if": "${{ false }}", "steps": [{"run": "npm run -s lint"}]}}},
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        False,
    ),
    (
        # N2: review slipped past an `is True` check with the expression form, so the two
        # fail-open cases above are re-run in the shape that actually defeated a previous version.
        "MUTATION: a gate JOB is fail-open via the ${{ }} expression form",
        {"jobs": {"lint": {"steps": [{"run": "npm run -s lint"}]}}},
        {"jobs": {"drift": {"continue-on-error": "${{ true }}", "steps": [{"run": "python x.py"}]}}},
        False,
    ),
    (
        "MUTATION: a gate STEP is fail-open via the ${{ }} expression form",
        {
            "jobs": {
                "lint": {
                    "steps": [{"run": "npm run -s lint", "continue-on-error": "${{ true }}"}]
                }
            }
        },
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        False,
    ),
    (
        # N2: a gate STEP can be skipped by its own `if:` just as a job can. validate-meta.py
        # rejects this, but nothing locked the behaviour, so a regression would have shipped green.
        "MUTATION: a gate STEP carries a condition",
        {
            "jobs": {
                "lint": {"steps": [{"run": "npm run -s lint", "if": "${{ false }}"}]}
            }
        },
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        False,
    ),
    (
        # `has_toolchain` guarded the code jobs while the repository had no `package.json`. That
        # stopped being possible in M0, so the guard became dead code in a gate — a claim about a
        # case that cannot occur. Deleting it emptied PERMITTED_JOB_CONDITIONS, so NO job condition
        # is permitted any more; this case locks the stronger rule that replaced the whitelist.
        "MUTATION: the retired toolchain condition is no longer permitted",
        {
            "jobs": {
                "lint": {
                    "if": "${{ needs.meta.outputs.has_toolchain == 'true' }}",
                    "steps": [{"run": "npm run -s lint"}],
                }
            }
        },
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        False,
    ),
    (
        # Finding 1: a multiline `run:` hid a command from the line-wise reader, so
        # `if false; then npm run -s lint; fi` certified a lint that never ran. The scalar must now
        # EQUAL the command, so a block scalar can never satisfy the requirement.
        "MUTATION: a gate command is buried in a multiline `run:` block",
        {"jobs": {"lint": {"steps": [{"run": "if false; then npm run -s lint; fi\n"}]}}},
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        False,
    ),
    (
        "MUTATION: a gate step runs under a custom `shell:`",
        {"jobs": {"lint": {"steps": [{"run": "npm run -s lint", "shell": "python"}]}}},
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        False,
    ),
    (
        # Finding 2: GitHub skips a job whose `needs` target was skipped, so a gate job pointed at a
        # dormant job is switched off while its own `if:` stays clean.
        "MUTATION: a gate job depends on a job that is not the permitted anchor",
        {
            "jobs": {
                "dormant": {"if": "${{ false }}", "steps": [{"run": "echo hi"}]},
                "lint": {"needs": ["dormant"], "steps": [{"run": "npm run -s lint"}]},
            }
        },
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        False,
    ),
    (
        "a gate job depending on the permitted anchor is allowed",
        {"jobs": {"lint": {"needs": "meta", "steps": [{"run": "npm run -s lint"}]}}},
        {"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}},
        True,
    ),
]

# The anchor `meta` job the whitelist names must exist and be unconditional; these two cases assert
# the guard notices when it is not, so the whitelist cannot be satisfied vacuously.
ANCHOR_CASES = [
    ("MUTATION: the permitted anchor job is itself conditional", {"if": "${{ false }}"}),
    ("MUTATION: the permitted anchor job depends on another job", {"needs": ["other"]}),
    ("MUTATION: the permitted anchor job does not exist", None),
]


def build_ci(ci_document, anchor_overrides=()):
    """Assemble a scratch ci.yml: the case's own jobs plus an unconditional `meta` anchor.

    `meta` carries every gate the case is not varying, mirroring the real workflow, so a passing
    case passes because the wiring is genuinely complete rather than because nothing was found.
    """
    document = {"jobs": dict(ci_document.get("jobs") or {})}
    if anchor_overrides is not None:
        anchor = {
            "steps": [{"run": f"npm run -s {name}"} for name in ALL_GATES if name != "lint"]
            + [{"run": command} for command in EXPECTED_PYTHON_GATES]
        }
        anchor.update(anchor_overrides)
        document["jobs"]["meta"] = anchor
    return document


for label, ci_document, other_document, should_pass in GATE_CASES:
    scratch = tempfile.mkdtemp()
    seed_scratch(scratch)
    with open(os.path.join(scratch, ".github", "workflows", "ci.yml"), "w", encoding="utf-8") as fh:
        yaml.safe_dump(build_ci(ci_document), fh)
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

for anchor_label, anchor_overrides in ANCHOR_CASES:
    scratch = tempfile.mkdtemp()
    seed_scratch(scratch)
    with open(os.path.join(scratch, ".github", "workflows", "ci.yml"), "w", encoding="utf-8") as fh:
        yaml.safe_dump(
            build_ci(
                {"jobs": {"lint": {"needs": "meta", "steps": [{"run": "npm run -s lint"}]}}},
                anchor_overrides,
            ),
            fh,
        )
    with open(os.path.join(scratch, ".github", "workflows", "other.yml"), "w", encoding="utf-8") as fh:
        yaml.safe_dump({"jobs": {"drift": {"steps": [{"run": "python x.py"}]}}}, fh)
    cwd = os.getcwd()
    try:
        os.chdir(scratch)
        anchor_errors = validate_meta.check_gate_wiring()
    finally:
        os.chdir(cwd)
    if not anchor_errors:
        failures.append(f"{anchor_label}: expected FAIL, got PASS")

# The shipped workflows must themselves satisfy it.
shipped = validate_meta.check_gate_wiring()
if shipped:
    failures.append(f"the shipped workflows must pass the gate-wiring check, got {shipped}")

# MUTATION, parameterised over EVERY gate: dropping any one of them from ci.yml must fail. Review
# found only `lint` was locked, so deleting the coverage step left the 100%-coverage gate unrun
# with nothing red.
# Four sources, one assertion: this independent list, the derivation on disk, package.json's
# scripts, and ci.yml's wiring must all agree. Emptying or trimming any one now fails here.
derived_python = sorted(validate_meta.required_python_gates())
if derived_python != sorted(EXPECTED_PYTHON_GATES):
    failures.append(
        "validate-meta.py's derived Python gates do not match this test's independent list: "
        f"derived={derived_python} expected={sorted(EXPECTED_PYTHON_GATES)}"
    )
if not derived_python:
    failures.append("the Python gate derivation returned nothing; it would assert nothing")

derived_npm = sorted(validate_meta.npm_gate_scripts())
if derived_npm != sorted(ALL_GATES):
    failures.append(
        f"package.json's gate scripts do not match this test's independent list: "
        f"derived={derived_npm} expected={sorted(ALL_GATES)}"
    )

# An INDEPENDENT reader, deliberately not the one validate-meta.py uses.
#
# Review's rule: a verifier that shares the parser of the thing it verifies inherits its blind spot.
# An earlier version called PyYAML and split each `run:` scalar into lines — exactly what the
# production side did — so when that reader accepted a command buried in a multiline block, this
# check accepted it too and reported nothing.
#
# So this one does not parse YAML at all. It reads ci.yml as TEXT. Two corrections review found in
# the first text version, which are opposite errors and both mattered:
#
#   * too STRICT — it required the command to end the line, so an ordinary inline comment
#     (`run: npm run -s lint # required gate`) made the self-test red while production was happy.
#     A gate that cries wolf gets deleted by the next maintainer, so a false red is worse than a
#     missed bypass. Inline comments are NOT forbidden; they are stripped, exactly as YAML says.
#   * too PERMISSIVE — its regex matched a `run:`-looking line INSIDE a `run: |` block, so it was
#     leaning on the production parser to reject that, which is the very coupling it exists to
#     remove. Block extents are now skipped by indentation.
#
# Both readers therefore agree on one documented lexical form: a gate step is a single-line
# `run: <command>`, optionally quoted, optionally followed by a `#` comment.
BLOCK_RUN = re.compile(r"^(\s*)(?:-\s+)?run:\s*[|>][+-]?\d*\s*$")
PLAIN_RUN = re.compile(r"^(\s*)(?:-\s+)?run:[ \t]+(.*)$")


def plain_run_commands(text):
    """Every single-line `run:` command in `text`, with block-scalar bodies skipped."""
    found = set()
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        block = BLOCK_RUN.match(line)
        if block:
            # Skip the body: every following line that is blank or indented deeper than the key.
            indent = len(block.group(1))
            index += 1
            while index < len(lines):
                body = lines[index]
                if body.strip() and (len(body) - len(body.lstrip())) <= indent:
                    break
                index += 1
            continue
        plain = PLAIN_RUN.match(line)
        if plain:
            value = plain.group(2)
            # Strip a trailing YAML comment: ` #...` preceded by whitespace, outside quotes.
            unquoted = value.strip()
            if not (unquoted[:1] in {"'", '"'}):
                value = re.split(r"\s+#", value, maxsplit=1)[0]
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            found.add(value.strip())
        index += 1
    return found


with open(os.path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), encoding="utf-8") as fh:
    shipped_ci_commands = plain_run_commands(fh.read())

for command in EXPECTED_PYTHON_GATES + [f"npm run -s {name}" for name in ALL_GATES]:
    if command not in shipped_ci_commands:
        # Do NOT say "has no step running X" -- QA's point on the false-red case: when the command
        # IS present but written in an unsupported spelling, that message asserts something untrue
        # about the tree. A gate that lies while failing is worse than one that merely fails, so the
        # message states what this reader looked for and shows what it actually found.
        failures.append(
            f"ci.yml has no single-line `run: {command}` step that this reader recognises. It "
            f"reads the file as text (independently of validate-meta.py's YAML reader), accepting "
            f"a plain, single- or double-quoted scalar with an optional trailing `#` comment, and "
            f"skipping block-scalar bodies. Commands it did recognise: {sorted(shipped_ci_commands)}"
        )

# Self-check the independent reader on both correction cases, so neither can regress unseen.
READER_CASES = [
    ("plain", "      - run: npm run -s lint\n", True),
    ("inline comment is stripped, NOT rejected", "      - run: npm run -s lint # required\n", True),
    ("single-quoted", "      - run: 'npm run -s lint'\n", True),
    ("double-quoted", '      - run: "npm run -s lint"\n', True),
    ("inside a block scalar is NOT counted", "      - run: |\n          run: npm run -s lint\n", False),
    ("block body is NOT counted", "      - run: |\n          npm run -s lint\n", False),
]
for reader_label, snippet, should_find in READER_CASES:
    if ("npm run -s lint" in plain_run_commands(snippet)) != should_find:
        failures.append(
            f"independent reader: {reader_label} — expected "
            f"{'to find' if should_find else 'NOT to find'} the command, got the opposite"
        )

# The declared exceptions must be real scripts that are really INVOKED elsewhere, not a way to
# shrink the derived set silently.
#
# This used to assert the script's filename appeared anywhere in the named workflow. Review defeated
# that by replacing the blocking invocation with `echo python .github/scripts/validate-commits.py`:
# the filename survived in a comment and in the neighbouring test-validate-commits.py step, so the
# substring was still present while nothing ran. That is round 1's `echo` defeat, in the one file
# the fix had not reached. Substring presence is not execution, so the complete `run:` scalar must
# equal the approved command — the same rule ci.yml's gate steps already obey, read with the same
# independent reader.
EXPECTED_EXCEPTION_COMMANDS = {
    "validate-commits.py": "python .github/scripts/validate-commits.py",
    "test-validate-commits.py": "python .github/scripts/test-validate-commits.py",
}
for name, reason in validate_meta.PYTHON_GATE_EXCEPTIONS.items():
    if not os.path.exists(os.path.join(REPO_ROOT, ".github", "scripts", name)):
        failures.append(f"PYTHON_GATE_EXCEPTIONS names `{name}`, which does not exist")
    if not reason.strip():
        failures.append(f"PYTHON_GATE_EXCEPTIONS entry `{name}` has no reason")
    expected_command = EXPECTED_EXCEPTION_COMMANDS.get(name)
    if expected_command is None:
        failures.append(
            f"PYTHON_GATE_EXCEPTIONS names `{name}`, but this test declares no approved command "
            f"for it, so its invocation would go unchecked"
        )
        continue
    with open(os.path.join(REPO_ROOT, ".github", "workflows", "commitlint.yml"), encoding="utf-8") as fh:
        commitlint_commands = plain_run_commands(fh.read())
    if expected_command not in commitlint_commands:
        failures.append(
            f"PYTHON_GATE_EXCEPTIONS claims `{name}` runs in commitlint.yml, but no single-line "
            f"`run: {expected_command}` step is there. Found: {sorted(commitlint_commands)}"
        )

def drop_loop_ci(npm_gates, python_gates, extra_jobs=None):
    """A scratch ci.yml whose gate steps live in the anchor job `meta`.

    These loops previously named the job `all`. Round 4 taught `check_gate_wiring` to require the
    permitted anchor to exist, so an anchor-less scratch tree ALWAYS produced an error, `if not
    dropped_errors:` became dead, and **18 mutation cases silently passed for free** — the #964
    vacuity class, inside the fix for the vacuity class, introduced by the fix itself. The control
    assertion below is the general remedy: a mutation loop needs a clean control, or every mutant
    passes for nothing.
    """
    jobs = dict(extra_jobs or {})
    jobs["meta"] = {
        "steps": [{"run": f"npm run -s {name}"} for name in npm_gates]
        + [{"run": command} for command in python_gates]
    }
    return {"jobs": jobs}


def gate_wiring_errors(scratch, document, python_gates=None):
    seed_scratch(scratch, python_gates=python_gates)
    with open(os.path.join(scratch, ".github", "workflows", "ci.yml"), "w", encoding="utf-8") as fh:
        yaml.safe_dump(document, fh)
    cwd = os.getcwd()
    try:
        os.chdir(scratch)
        return validate_meta.check_gate_wiring()
    finally:
        os.chdir(cwd)


# CONTROL: the unmutated scratch tree must produce ZERO errors. Without this, every mutation below
# is vacuous — which is exactly what happened between round 3 and round 4, undetected.
control_errors = gate_wiring_errors(
    tempfile.mkdtemp(), drop_loop_ci(ALL_GATES, EXPECTED_PYTHON_GATES)
)
if control_errors:
    failures.append(
        "CONTROL: the unmutated drop-loop scratch tree must produce no errors, but produced "
        f"{control_errors}. Every drop mutation below would pass for free."
    )

dropped_mutants_fired = 0
for dropped in ALL_GATES:
    dropped_errors = gate_wiring_errors(
        tempfile.mkdtemp(),
        drop_loop_ci([name for name in ALL_GATES if name != dropped], EXPECTED_PYTHON_GATES),
    )
    if not dropped_errors:
        failures.append(f"MUTATION: dropping the `{dropped}` gate from ci.yml must fail, but passed")
    else:
        dropped_mutants_fired += 1


# MUTATION, parameterised over EVERY Python metadata gate: dropping any one from ci.yml must fail.
# Review deleted both offline label steps and the wiring guard stayed green, because the required set
# was hand-written and these have no npm script.
for dropped_python in EXPECTED_PYTHON_GATES:
    dropped_errors = gate_wiring_errors(
        tempfile.mkdtemp(),
        drop_loop_ci(
            ALL_GATES, [c for c in EXPECTED_PYTHON_GATES if c != dropped_python]
        ),
    )
    if not dropped_errors:
        failures.append(
            f"MUTATION: dropping `{dropped_python}` from ci.yml must fail, but passed"
        )
    else:
        dropped_mutants_fired += 1

# MUTATION: a Python gate script exists on disk but ci.yml never runs it. The derivation must pull
# it in unprompted — this is the direction that catches a NEW gate nobody wired.
unwired_errors = gate_wiring_errors(
    tempfile.mkdtemp(),
    drop_loop_ci(ALL_GATES, EXPECTED_PYTHON_GATES),
    python_gates=EXPECTED_PYTHON_GATES + ["python .github/scripts/validate-brand-new.py"],
)
if not any("validate-brand-new.py" in e for e in unwired_errors):
    failures.append(
        "MUTATION: a new gate script that ci.yml does not run must fail, but passed "
        f"(errors={unwired_errors})"
    )

# The count is DERIVED and printed, so a collapse to zero is visible rather than inferred.
if dropped_mutants_fired != len(ALL_GATES) + len(EXPECTED_PYTHON_GATES):
    failures.append(
        f"MUTATION: expected {len(ALL_GATES) + len(EXPECTED_PYTHON_GATES)} drop mutants to fire, "
        f"got {dropped_mutants_fired}"
    )


if failures:
    print("FRONTMATTER SELF-TEST FAILED:")
    for f in failures:
        print("  -", f)
    sys.exit(1)

print(
    f"validate-meta self-test passed: {len(CASES)} frontmatter cases, "
    f"{len(GATE_CASES)} gate-wiring cases, {len(ANCHOR_CASES)} anchor cases, "
    f"{dropped_mutants_fired} drop mutants fired, "
    # Print the DERIVED sizes, not just the fixture count. Review emptied the old hand-written
    # tuple and the collapse to zero was invisible because the printed number was static.
    f"{len(derived_python)} python gate(s) + {len(derived_npm)} npm gate(s) cross-checked"
)

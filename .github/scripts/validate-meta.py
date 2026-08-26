#!/usr/bin/env python3
"""Validate OpenLogo repo metadata: issue forms, label manifest, labeler, workflows, and
agent/skill frontmatter.

Run in CI (see .github/workflows/ci.yml, meta job). Fails if an issue template or the
labeler references a label that is not defined in .github/labels.yml, if any of the
metadata YAML files fail to parse, or if an agent/skill markdown frontmatter block is
missing, malformed, invalid YAML, or lacks a non-empty `name`/`description`.
"""
import glob
import os
import sys

import yaml


def load(path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def check_frontmatter(path):
    """Return a list of error strings for the YAML frontmatter of a markdown file.

    Enforces: an opening `---` fence on the first line, a matching closing `---` fence,
    a block that parses as a YAML mapping, and non-empty `name` and `description` keys.
    An empty list means the file is valid.
    """
    errors = []
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    # Tolerate a UTF-8 BOM; splitlines() normalises CRLF/CR/LF line endings.
    if text.startswith("\ufeff"):
        text = text[1:]
    lines = text.splitlines()

    if not lines or lines[0].strip() != "---":
        errors.append(f"{path}: missing opening '---' frontmatter fence")
        return errors

    closing = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if closing is None:
        errors.append(f"{path}: missing closing '---' frontmatter fence")
        return errors

    block = "\n".join(lines[1:closing])
    try:
        data = yaml.safe_load(block)
    except yaml.YAMLError as exc:
        detail = str(exc).splitlines()[0] if str(exc) else exc.__class__.__name__
        errors.append(f"{path}: frontmatter is not valid YAML ({detail})")
        return errors

    if not isinstance(data, dict):
        errors.append(f"{path}: frontmatter must be a YAML mapping with name/description")
        return errors

    for key in ("name", "description"):
        value = data.get(key)
        if value is None:
            errors.append(f"{path}: frontmatter is missing '{key}'")
        elif isinstance(value, str) and not value.strip():
            errors.append(f"{path}: frontmatter '{key}' is empty")
        elif not isinstance(value, str):
            errors.append(f"{path}: frontmatter '{key}' must be a non-empty string")
    return errors


def workflow_steps(document):
    """Yield (job_name, job, step) for every step in a parsed workflow."""
    for job_name, job in (document.get("jobs") or {}).items():
        for step in job.get("steps") or []:
            yield job_name, job, step


def is_fail_open(value):
    """Whether a `continue-on-error` value lets a failure through.

    Accepts the literal `true` and any expression, because `continue-on-error: ${{ true }}` parses as
    the STRING `${{ true }}` — review used exactly that to slip past an `is True` check. An
    expression here cannot be evaluated statically, so it is rejected rather than trusted, and a
    legitimate one is declared in FAIL_OPEN_EXCEPTIONS with its reason.
    """
    if value is True:
        return True
    return isinstance(value, str) and value.strip() != "" and value.strip().lower() != "false"


#: Steps allowed to be fail-open, each with the reason. Keyed by (workflow basename, step id).
#: Declaring an exception is a review question — the point of the check is that a NEW one cannot
#: appear silently, not that none may ever exist.
FAIL_OPEN_EXCEPTIONS = {
    ("dependency-review.yml", "actions/dependency-review-action@v5"): (
        "Advisory while the repository is private and a hard gate once public: the Dependency Graph "
        "it needs is a GHAS feature unavailable on private repos, so the action cannot succeed there. "
        "The value is `${{ github.event.repository.private }}`, which flips to a blocking check "
        "automatically when the repo goes public. See workflows.instructions.md."
    ),
}


#: The Python metadata gates CI must run, alongside the npm ones derived from package.json. These
#: have no npm script, so nothing derived them and `check_gate_wiring` did not require them — review
#: deleted both offline label steps from `ci.yml` and the wiring guard stayed green.
REQUIRED_PYTHON_GATES = (
    "python .github/scripts/validate-meta.py",
    "python .github/scripts/test-validate-meta.py",
    "python .github/scripts/validate-labels.py",
    "python .github/scripts/test-validate-labels.py",
    "python .github/scripts/validate-lockfile-registry.py",
    "python .github/scripts/test-validate-lockfile-registry.py",
    "python .github/scripts/validate-workflow-lockfiles.py",
    "python .github/scripts/test-validate-workflow-lockfiles.py",
)

#: The one job-level `if:` a gate job may carry: the toolchain guard every code job is gated on
#: while the workspace manifest may be absent. Anything else can switch a gate off silently.
PERMITTED_JOB_CONDITIONS = frozenset(
    {"${{ needs.meta.outputs.has_toolchain == 'true' }}"}
)


def check_gate_wiring():
    """Return errors for Definition-of-Done gates that CI does not run, or runs fail-open.

    Three holes review found, each of which left every other check green (issue #978):

      * `.github/workflows/ci.yml` could stop invoking `npm run -s lint` — swap it for a second
        `format:check` and the required "Lint & format" job passes without linting anything.
      * a `continue-on-error` on a gate job or step neuters it while its own self-tests still pass,
        because those test the script, not whether anybody heeds its exit code.
      * an `if:` condition on a gate step skips it entirely: `if: ${{ false }}` left both metadata
        checks green while the lint step never ran.

    A gate nothing invokes, whose failure nothing heeds, or that never executes, is the same defect
    as a gate that checks too little: a green signal certifying less than its name implies.
    """
    errors = []

    # Every DoD script CI is expected to run, derived from package.json rather than restated here —
    # a hand-written list is an assertion nothing re-derives, which is this epic's own defect.
    # `dev`, `clean`, lifecycle hooks (`pre*`/`post*`) and workspace-only scripts are not gates.
    with open("package.json", encoding="utf-8") as fh:
        scripts = (yaml.safe_load(fh) or {}).get("scripts", {})
    not_gates = {"dev", "clean", "prepare", "format"}
    required = {
        name: f"npm run -s {name}"
        for name in scripts
        if name not in not_gates and not name.startswith(("pre", "post"))
    }
    ci = load(".github/workflows/ci.yml")
    gate_commands = set(required.values()) | set(REQUIRED_PYTHON_GATES)
    for command in REQUIRED_PYTHON_GATES:
        required[command] = command

    ci_commands = set()
    for job_name, job, step in workflow_steps(ci):
        commands = {line.strip() for line in str(step.get("run", "")).splitlines()}
        running_a_gate = commands & gate_commands
        if running_a_gate:
            ci_commands |= commands
            # A gate step must be unconditional: an `if:` can skip it without failing anything.
            if "if" in step:
                errors.append(
                    f".github/workflows/ci.yml: job `{job_name}` runs {sorted(running_a_gate)} "
                    f"under an `if:` condition, so the gate can be skipped without failing."
                )
            # ...and so can a job-level `if:`, which review used to switch the whole lint job — and
            # therefore #978's fix — off while this guard stayed green. Only the toolchain condition
            # every code job legitimately carries is permitted.
            condition = job.get("if")
            if condition is not None and str(condition).strip() not in PERMITTED_JOB_CONDITIONS:
                errors.append(
                    f".github/workflows/ci.yml: job `{job_name}` runs {sorted(running_a_gate)} but "
                    f"the JOB carries `if: {condition}`, so the whole job can be skipped without "
                    f"failing. Permitted: {sorted(PERMITTED_JOB_CONDITIONS)}."
                )
    for name, command in sorted(required.items()):
        if command not in ci_commands:
            errors.append(
                f".github/workflows/ci.yml: no unconditional step runs `{command}`; the {name} gate "
                f"would not run in CI even though every local check passes."
            )

    # No gate workflow may be fail-open.
    for fp in sorted(glob.glob(".github/workflows/*.y*ml")):
        document = load(fp)
        for job_name, job in (document.get("jobs") or {}).items():
            if is_fail_open(job.get("continue-on-error")):
                errors.append(
                    f"{fp}: job `{job_name}` sets continue-on-error, so it cannot fail the build."
                )
            for step in job.get("steps") or []:
                if is_fail_open(step.get("continue-on-error")):
                    label = step.get("name") or step.get("run") or step.get("uses") or "<step>"
                    key = (os.path.basename(fp), str(step.get("uses") or step.get("name") or "").strip())
                    if key in FAIL_OPEN_EXCEPTIONS:
                        continue
                    errors.append(
                        f"{fp}: job `{job_name}` step `{str(label).splitlines()[0][:60]}` sets "
                        f"continue-on-error, so its failure is ignored. If that is deliberate, "
                        f"declare it in FAIL_OPEN_EXCEPTIONS with a reason."
                    )
    return errors


def main():
    errors = []

    # Label taxonomy is the source of truth.
    labels = load(".github/labels.yml")
    label_names = {entry["name"] for entry in labels}

    # No label name may be declared twice in the manifest.
    seen = set()
    for entry in labels:
        name = entry["name"]
        if name in seen:
            errors.append(f".github/labels.yml: label '{name}' is declared more than once")
        seen.add(name)

    # Every issue form's default labels must exist in the manifest.
    for fp in sorted(glob.glob(".github/ISSUE_TEMPLATE/*.yml")):
        if os.path.basename(fp) == "config.yml":
            continue
        doc = load(fp)
        for label in doc.get("labels", []) or []:
            if label not in label_names:
                errors.append(f"{fp}: label '{label}' is not defined in labels.yml")

    # Every labeler target label must exist in the manifest.
    labeler = load(".github/labeler.yml")
    for label in labeler.keys():
        if label not in label_names:
            errors.append(f".github/labeler.yml: label '{label}' is not defined in labels.yml")

    # All workflows must parse.
    for fp in sorted(glob.glob(".github/workflows/*.y*ml")):
        load(fp)

    # The gates must actually be invoked, and must be allowed to fail the build.
    errors.extend(check_gate_wiring())

    # Every agent and skill playbook must carry a valid name/description frontmatter block.
    agent_files = sorted(glob.glob(".github/agents/*.agent.md"))
    skill_files = sorted(glob.glob(".github/skills/**/SKILL.md", recursive=True))
    for fp in agent_files + skill_files:
        errors.extend(check_frontmatter(fp))

    # Runnable examples are optional early on; note their absence without failing.
    if not glob.glob("spec/examples/*.logo"):
        print("note: no spec/examples/*.logo yet (skipping example run in meta)")

    if errors:
        print("META VALIDATION FAILED:")
        for e in errors:
            print("  -", e)
        sys.exit(1)

    print(f"meta validation passed: {len(label_names)} labels, "
          f"{len(glob.glob('.github/ISSUE_TEMPLATE/*.yml'))} issue forms, "
          f"{len(agent_files)} agents, {len(skill_files)} skills checked")


if __name__ == "__main__":
    main()

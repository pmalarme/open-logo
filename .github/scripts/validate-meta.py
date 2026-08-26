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


#: Python metadata gates that legitimately run somewhere other than `ci.yml`, with the reason.
#: A declared, reasoned exception — the same shape as FAIL_OPEN_EXCEPTIONS and labels-retired.yml —
#: so a NEW script cannot quietly escape the requirement.
PYTHON_GATE_EXCEPTIONS = {
    "validate-commits.py": "runs in commitlint.yml, which lints the PR title and commit subjects",
    "test-validate-commits.py": "self-test for validate-commits.py; runs in commitlint.yml",
}


def required_python_gates():
    """The Python metadata gates `ci.yml` must run, **derived from disk**.

    This used to be a hand-written tuple, and its self-test iterated over that same tuple — so
    emptying it produced zero mutants and a vacuous pass, with the success line unchanged because
    the printed count was static. That is issue #964's defect (`excluded = []` printed
    `0 carve-outs` and exited 0), and worse: here the collapse to zero was invisible.

    It is worse still in context, because the comment six lines below in `check_gate_wiring` says a
    hand-written list "is an assertion nothing re-derives, which is this epic's own defect" — the
    file stated the rule and then broke it. The npm half was always derived from `package.json` and
    was always solid; only this half was hand-written, and that was the whole bug.

    Now derived the same way: every `validate-*.py` / `test-validate-*.py` under `.github/scripts/`,
    minus the declared exceptions. Adding a gate script requires no edit here; removing one from
    `ci.yml` fails.
    """
    found = set()
    for pattern in ("validate-*.py", "test-validate-*.py"):
        for path in glob.glob(os.path.join(".github", "scripts", pattern)):
            name = os.path.basename(path)
            if name not in PYTHON_GATE_EXCEPTIONS:
                found.add(f"python .github/scripts/{name}")
    return sorted(found)

#: Job-level conditions permitted on a job that runs a Definition-of-Done gate: **none**.
#:
#: There used to be one — `needs.meta.outputs.has_toolchain == 'true'`, guarding the code jobs while
#: the workspace manifest might not exist yet. Review pointed out that pinning the condition's *text*
#: while leaving the *value it reads* unpinned is the same defect one level down: forcing
#: `has_toolchain=false` skipped every code gate and this guard still passed. The manifest has
#: existed since M0, so the guard was dead code — a claim about a case that cannot happen — and it
#: was deleted rather than pinned. An empty allow-list is both stronger and smaller: a gate job may
#: not be conditional at all.
PERMITTED_JOB_CONDITIONS = frozenset()

#: Jobs a gate job may depend on: exactly the always-on `meta` job.
#:
#: GitHub skips a job whose `needs` target was skipped, so a gate job pointed at a dormant job is
#: switched off while its own `if:` stays clean — review's finding 3. Traversing the dependency
#: graph to decide reachability is the analysis trap that defeated two earlier rounds; this is a set
#: membership test instead. `check_gate_wiring` additionally asserts that every job named here
#: exists, carries no `if:`, and has no `needs:` of its own, so the whitelist cannot be satisfied by
#: an anchor that is itself conditional.
PERMITTED_GATE_JOB_NEEDS = frozenset({"meta"})


def npm_gate_scripts():
    """The npm Definition-of-Done gates, derived from `package.json` rather than restated.

    `dev`, `clean`, `prepare`, `format` and the `pre*`/`post*` lifecycle hooks are not gates.
    """
    with open("package.json", encoding="utf-8") as handle:
        scripts = (yaml.safe_load(handle) or {}).get("scripts", {})
    not_gates = {"dev", "clean", "prepare", "format"}
    return sorted(
        name
        for name in scripts
        if name not in not_gates and not name.startswith(("pre", "post"))
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

    # Both halves are derived, never restated — a hand-written list is an assertion nothing
    # re-derives, which is this epic's own defect. The npm half comes from package.json; the Python
    # half from the scripts on disk. Review emptied a hand-written version of the latter and every
    # check still passed, so this comment used to sit six lines above the rule it broke.
    required = {name: f"npm run -s {name}" for name in npm_gate_scripts()}
    ci = load(".github/workflows/ci.yml")
    python_gates = required_python_gates()
    gate_commands = set(required.values()) | set(python_gates)
    for command in python_gates:
        required[command] = command

    ci_commands = set()
    for job_name, job, step in workflow_steps(ci):
        raw_run = step.get("run")
        if raw_run is None:
            continue
        # FORBID what cannot be analysed, rather than analysing it.
        #
        # This used to split a `run:` scalar into lines and accept any line that matched, so
        #   run: |
        #     if false; then npm run -s lint; fi
        # certified a lint that never runs — and review's third round showed the same construct
        # defeats any line-wise reader, because reachability inside a shell block is undecidable.
        # "Is this step reached?" is unbounded in GitHub Actions (step `if`, job `if`, `needs`,
        # shell control flow, `continue-on-error`, triggers, `strategy`, `container`). "Is this
        # step written in the one permitted shape?" is a closed question. So a gate step must be a
        # SINGLE-LINE scalar whose complete trimmed text equals the approved command, run by the
        # default shell. Anything else is refused without being interpreted.
        command = str(raw_run).strip()
        if command not in gate_commands:
            # Not a gate step. A multiline block here is ordinary CI authoring and stays legal;
            # it cannot un-gate anything, because a gate command hidden inside it would have to
            # match exactly to count, and it does not.
            continue
        if "\n" in str(raw_run):
            # A block scalar (`run: |`) that happens to hold exactly one command DOES run it, so
            # this is not a correctness hazard — it is an ambiguity hazard. The independent reader
            # in test-validate-meta.py works on text and must skip block extents to avoid matching
            # a `run:`-looking line inside one, so if this side accepted the block form the two
            # readers would disagree and the self-test would go red on a workflow that is fine.
            # One documented spelling, accepted by both, is worth more than either tolerance.
            errors.append(
                f".github/workflows/ci.yml: job `{job_name}` runs `{command}` as a multi-line "
                f"block scalar. Write a gate step as a single-line `run: {command}` so both the "
                f"structural and the textual reader agree on what is wired."
            )
            continue
        ci_commands.add(command)
        running_a_gate = {command}
        if step.get("shell") is not None:
            errors.append(
                f".github/workflows/ci.yml: job `{job_name}` runs `{command}` under a custom "
                f"`shell:`, which changes how — and whether — the command executes."
            )
        # A gate step must be unconditional: an `if:` can skip it without failing anything.
        if "if" in step:
            errors.append(
                f".github/workflows/ci.yml: job `{job_name}` runs {sorted(running_a_gate)} "
                f"under an `if:` condition, so the gate can be skipped without failing."
            )
        # ...and so can a job-level `if:`, which review used to switch the whole lint job — and
        # therefore #978's fix — off while this guard stayed green. `PERMITTED_JOB_CONDITIONS` is
        # empty: the one condition that used to be whitelisted guarded a case that can no longer
        # occur, so it was deleted rather than trusted.
        condition = job.get("if")
        if condition is not None and str(condition).strip() not in PERMITTED_JOB_CONDITIONS:
            errors.append(
                f".github/workflows/ci.yml: job `{job_name}` runs {sorted(running_a_gate)} but "
                f"the JOB carries `if: {condition}`, so the whole job can be skipped without "
                f"failing. Permitted: {sorted(PERMITTED_JOB_CONDITIONS)}."
            )
        # ...and so can a DEPENDENCY: GitHub skips a job whose `needs` target was skipped, so
        # pointing a gate job at a dormant job switches it off while its own `if:` stays clean.
        # This does NOT traverse the graph — that is the analysis trap again. It is a set
        # membership test against one known-unconditional job, asserted below.
        needs = job.get("needs")
        needs_set = frozenset([needs] if isinstance(needs, str) else (needs or []))
        if not needs_set <= PERMITTED_GATE_JOB_NEEDS:
            errors.append(
                f".github/workflows/ci.yml: job `{job_name}` runs {sorted(running_a_gate)} but "
                f"depends on {sorted(needs_set)}; a gate job may only depend on "
                f"{sorted(PERMITTED_GATE_JOB_NEEDS)}, because GitHub skips a job whose dependency "
                f"was skipped."
            )

    # The whitelist above is only sound while every permitted dependency is itself unconditional,
    # so assert that here instead of assuming it.
    for anchor in sorted(PERMITTED_GATE_JOB_NEEDS):
        anchor_job = (ci.get("jobs") or {}).get(anchor)
        if anchor_job is None:
            errors.append(
                f".github/workflows/ci.yml: gate jobs may depend on `{anchor}`, but no such job "
                f"exists, so the dependency whitelist asserts nothing."
            )
            continue
        if anchor_job.get("if") is not None:
            errors.append(
                f".github/workflows/ci.yml: job `{anchor}` is the permitted gate dependency, so it "
                f"must be unconditional, but it carries `if: {anchor_job.get('if')}`."
            )
        if anchor_job.get("needs"):
            errors.append(
                f".github/workflows/ci.yml: job `{anchor}` is the permitted gate dependency, so it "
                f"must not itself depend on another job, but it needs {anchor_job.get('needs')}."
            )
        if anchor_job.get("strategy"):
            # A `strategy.matrix` whose axis is an empty list expands to ZERO jobs, so the anchor
            # runs nothing while still existing, being unconditional, and having no `needs`. Review
            # judged it an implausible accident and therefore a residual; it costs one field in a
            # block that already asserts three, so it is closed rather than documented.
            errors.append(
                f".github/workflows/ci.yml: job `{anchor}` is the permitted gate dependency, so it "
                f"must not carry a `strategy:` — an empty matrix axis expands to zero jobs and "
                f"silently runs nothing. Found: {anchor_job.get('strategy')}."
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
          f"{len(agent_files)} agents, {len(skill_files)} skills, "
          f"{len(required_python_gates())} python gate(s) + "
          f"{len(npm_gate_scripts())} npm gate(s) wired")


if __name__ == "__main__":
    main()

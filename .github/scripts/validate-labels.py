#!/usr/bin/env python3
"""Validate the OpenLogo label taxonomy against reality, in both directions (issue #972, epic #901).

## Why this exists

`AGENTS.md` and the team working agreement both state:

    **Labels are a manifest.** `.github/labels.yml` is the single source of truth.

That was not true. Measured at `0277d5ff`: the manifest declared **10** `area:*` labels, **14** were
in use on open issues, and **15** existed on the repository. Across all namespaces, **9 labels in
use spanned 3 namespaces** (`area:` diagnostics/infra/parser/testing/tooling, `profile:`
core-language/interaction-events, `type:` enhancement/task) without appearing in the manifest at
all, on **37** distinct open issues/PRs. This change manifests 5 of those 9 and relabels the other 4
onto manifested equivalents. Re-derive any of these with `validate-labels.py --live`, which prints
every direction's count on every run; do not trust the numbers in this paragraph, which is prose and
therefore exactly the kind of claim epic #901 exists to stop trusting.

The mechanism that would have made the manifest authoritative — `label-sync.yml` — is **additive by
design** ("does not delete labels missing from the manifest"), so a label created ad hoc through the
API survives indefinitely and the manifest describes a *subset* of reality rather than defining it.

`validate-meta.py` did not catch it because it checks the manifest is **well-formed** — no duplicate
names, every issue-form and labeler reference defined — never that it is **complete with respect to
labels actually in use**. Well-formed-but-incomplete is exactly how a manifest stays green while
ceasing to describe the world, and it is epic #901's subject: a claim nothing executes.

## The directions, and why they differ in severity

Offline (deterministic, runs on every PR):

  M. **manifest <-> commit scopes.** `validate-commits.py` claims in a comment that its `PROFILES`
     and `AREAS` mirror the `profile:*` and `area:*` labels. This re-derives **both** mirrors instead
     of trusting the comment. A comment asserting a correspondence that does not hold is the same
     defect one layer down, and it has a concrete blocking consequence: a label with no matching
     scope means every PR arising from those issues fails the blocking PR-title check, discovered
     only at review time.

Live (needs `gh`; runs on a schedule, on demand, and after a label sync):

  A. **in use -> manifest.** Every label on an open issue or PR is in the manifest. **FAILS.** This
     is the direction that was missing and the one that catches every drifted issue.
  B. **manifest -> repository.** Every manifested label exists on the repository. **FAILS**, except
     under `--proposed` (see below).
  C. **repository -> manifest.** Labels that exist on the repository but are not manifested.
     **Split by namespace, because the two cases are not alike:**
       * a label carrying a **managed prefix** (`agent:`/`type:`/`profile:`/`area:`/`level:`) is a
         taxonomy label somebody created outside the manifest — it **FAILS** unless it is declared
         in `.github/labels-retired.yml` with a reason. This is what stops the next `area:infra`;
       * anything **unnamespaced** is **REPORTED, not failed.** GitHub creates nine stock labels
         (`bug`, `duplicate`, `wontfix`, ...) on every repository, and failing on them would demand
         a destructive change nobody has decided on.
  D. **manifest -> in use.** Manifested labels nobody uses. **REPORTED, not failed.** `level:1`,
     `level:2` and `profile:localization` are legitimately reserved for work that has not started;
     an unused label is a forecast, not a defect.

Every direction prints its count, so a drop to zero is observable rather than silent.

## Why the sync stays additive

Recorded here because the decision is the mechanism. `sync-labels.py` keeps its skip-delete
behaviour, and this gate is the detector, because:

  1. Deleting a label deletes it **off every issue that ever carried it, including closed ones**,
     and GitHub does not restore those applications when it is re-created. The triage record is gone.
  2. The manifest is edited by pull request. A typo or rename in a PR would, under a destructive
     sync, silently strip that label from every issue at merge — with no review of the blast radius.
  3. Direction B is already guaranteed by the additive sync. What was missing is *detection*
     (direction A and the namespaced half of C), not *mutation*.
  4. A destructive sync would delete GitHub's nine stock labels on its first run.

An additive sync plus a failing gate makes drift **visible without being destructive**, which is the
property we actually wanted. Deleting a retired label stays a deliberate, separate act.

## Fail closed

In live mode a `gh` failure is a **finding**, not a skip. A gate that quietly checks nothing is worse
than no gate, because it also removes the human who was checking.

Usage:
  python .github/scripts/validate-labels.py             # offline checks only (no network)
  python .github/scripts/validate-labels.py --live      # offline + live checks (needs gh + GH_TOKEN)
  python .github/scripts/validate-labels.py --live --proposed
        As --live, but direction B reports instead of failing. For the pull-request run: a PR that
        ADDS a label is comparing a manifest against a repository the sync has not reached yet, so
        the label is legitimately missing and failing there would be a false red on correct work.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))

MANIFEST_PATH = ".github/labels.yml"
RETIRED_PATH = ".github/labels-retired.yml"

#: `core` is already a profile scope, so it is deliberately not duplicated as an area scope.
AREA_SCOPE_EXEMPT = {"core"}

#: Namespace prefix -> the name of the set in validate-commits.py it must mirror.
MIRRORED_NAMESPACES = (("area:", "AREAS", AREA_SCOPE_EXEMPT), ("profile:", "PROFILES", frozenset()))


def load_yaml(path: str) -> list[dict]:
    """Parse a label list file into its entries."""
    with open(path, encoding="utf-8") as handle:
        return yaml.safe_load(handle) or []


def load_manifest(path: str = MANIFEST_PATH) -> list[dict]:
    return load_yaml(path)


def manifest_names(entries: list[dict]) -> set[str]:
    """The set of label names a label list declares."""
    return {entry["name"] for entry in entries}


def managed_prefixes(names: set[str]) -> set[str]:
    """The namespaces the manifest itself defines, derived rather than hard-coded."""
    return {name.split(":", 1)[0] + ":" for name in names if ":" in name}


def namespace_members(names: set[str], prefix: str, exempt: frozenset[str] | set[str]) -> set[str]:
    """The commit scopes one label namespace implies, which its mirror set must equal."""
    return {name[len(prefix):] for name in names if name.startswith(prefix)} - set(exempt)


def load_commit_scope_sets() -> dict[str, set[str]]:
    """Import `validate-commits.py` (a hyphenated filename) and read its scope sets."""
    spec = importlib.util.spec_from_file_location(
        "validate_commits", os.path.join(HERE, "validate-commits.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {"AREAS": set(module.AREAS), "PROFILES": set(module.PROFILES)}


def check_scope_mirrors(names: set[str], scope_sets: dict[str, set[str]]) -> tuple[list[str], list[str]]:
    """Direction M — each mirrored label namespace and its commit-scope set must be the same set."""
    errors: list[str] = []
    notes: list[str] = []
    for prefix, set_name, exempt in MIRRORED_NAMESPACES:
        expected = namespace_members(names, prefix, exempt)
        scopes = scope_sets[set_name]
        for scope in sorted(expected - scopes):
            errors.append(
                f"`{prefix}{scope}` is in {MANIFEST_PATH} but `{scope}` is not a commit scope in "
                f"validate-commits.py's {set_name} — every PR titled `type({scope}): ...` would fail "
                f"the blocking PR-title check."
            )
        for scope in sorted(scopes - expected):
            if f"{prefix}{scope}" in names:
                errors.append(
                    f"`{scope}` is a commit scope in validate-commits.py's {set_name}, and the label "
                    f"`{prefix}{scope}` exists, but the label is exempt from this mirror "
                    f"({sorted(exempt)}) — remove the scope or the exemption."
                )
            else:
                errors.append(
                    f"`{scope}` is a commit scope in validate-commits.py's {set_name} but there is no "
                    f"`{prefix}{scope}` label in {MANIFEST_PATH}; {set_name} claims to mirror those labels."
                )
        notes.append(
            f"{prefix}* <-> {set_name}: {len(expected)} scope(s) checked in both directions"
        )
    return errors, notes


def check_retired(names: set[str], retired: list[dict]) -> tuple[list[str], list[str]]:
    """A retired label must be a real exception: reasoned, and not also manifested."""
    errors: list[str] = []
    for entry in retired:
        name = entry["name"]
        if name in names:
            errors.append(
                f"`{name}` is declared in both {MANIFEST_PATH} and {RETIRED_PATH}; a label is either "
                f"managed or retired, not both."
            )
        if not (entry.get("why") or "").strip():
            errors.append(f"`{name}` in {RETIRED_PATH} has no `why`; an exception without a reason is drift.")
    return errors, [f"retired declarations: {len(retired)} checked"]


def gh_json(args: list[str]) -> list[dict]:
    """Run a `gh` command that emits JSON, failing loudly rather than degrading to an empty list."""
    completed = subprocess.run(["gh", *args], capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"`gh {' '.join(args)}` failed: {completed.stderr.strip()}")
    return json.loads(completed.stdout)


def labels_in_use(issues: list[dict], pulls: list[dict]) -> dict[str, list[str]]:
    """Map every label applied to an open issue/PR to the items carrying it."""
    in_use: dict[str, list[str]] = {}
    for kind, items in (("#", issues), ("PR #", pulls)):
        for item in items:
            for label in item.get("labels", []):
                in_use.setdefault(label["name"], []).append(f"{kind}{item['number']}")
    return in_use


def check_live(
    names: set[str],
    retired_names: set[str],
    repo_labels: set[str],
    in_use: dict[str, list[str]],
    proposed: bool = False,
) -> tuple[list[str], list[str]]:
    """Directions A-D. Returns (errors, notes)."""
    errors: list[str] = []
    notes: list[str] = []
    prefixes = managed_prefixes(names)

    # A — in use -> manifest. The direction that was missing.
    unmanifested = sorted(set(in_use) - names)
    for label in unmanifested:
        items = in_use[label]
        shown = ", ".join(items[:8]) + (", ..." if len(items) > 8 else "")
        errors.append(
            f"label `{label}` is applied to {len(items)} open issue(s)/PR(s) but is not in "
            f"{MANIFEST_PATH}: {shown}"
        )
    notes.append(
        f"in use -> manifest: {len(in_use)} label(s) in use across open issues/PRs, "
        f"{len(unmanifested)} unmanifested"
    )

    # B — manifest -> repository. The additive sync should already guarantee this, except on a PR
    # that proposes a new label: the sync only runs after merge, so the label is legitimately absent.
    missing = sorted(names - repo_labels)
    for label in missing:
        message = (
            f"label `{label}` is in {MANIFEST_PATH} but does not exist on the repository; "
            f"the label sync has not run or did not succeed."
        )
        if proposed:
            notes.append(f"    proposed (not yet synced): {label}")
        else:
            errors.append(message)
    notes.append(
        f"manifest -> repository: {len(names)} manifested label(s), {len(missing)} missing on the "
        f"repo{' (reported, not failed: --proposed)' if proposed else ''}"
    )

    # C — repository -> manifest, split by namespace.
    unmanaged = sorted(repo_labels - names)
    namespaced = [label for label in unmanaged if any(label.startswith(p) for p in prefixes)]
    undeclared = [label for label in namespaced if label not in retired_names]
    for label in undeclared:
        errors.append(
            f"label `{label}` carries a managed namespace but is in neither {MANIFEST_PATH} nor "
            f"{RETIRED_PATH}. Manifest it, or declare it retired with a reason."
        )
    notes.append(
        f"repository -> manifest: {len(repo_labels)} label(s) on the repo, {len(unmanaged)} not "
        f"manifested - {len(namespaced)} namespaced ({len(undeclared)} undeclared), "
        f"{len(unmanaged) - len(namespaced)} unnamespaced (GitHub stock; reported, not failed)"
    )
    for label in unmanaged:
        kind = "retired" if label in retired_names else ("NAMESPACED" if label in namespaced else "stock")
        notes.append(f"    unmanaged [{kind}]: {label}{' (IN USE)' if label in in_use else ''}")

    # D — manifest -> in use. Reported: an unused label is a forecast, not a defect.
    unused = sorted(names - set(in_use))
    notes.append(
        f"manifest -> in use: {len(unused)} manifested label(s) currently unused "
        f"(reported, not failed): {', '.join(unused) if unused else 'none'}"
    )
    return errors, notes


def main() -> int:
    argv = sys.argv[1:]
    live = "--live" in argv
    proposed = "--proposed" in argv

    entries = load_manifest()
    names = manifest_names(entries)
    retired = load_yaml(RETIRED_PATH)
    retired_names = manifest_names(retired)

    errors, notes = check_scope_mirrors(names, load_commit_scope_sets())
    retired_errors, retired_notes = check_retired(names, retired)
    errors += retired_errors
    notes += retired_notes

    if live:
        try:
            repo_labels = {
                entry["name"]
                for entry in gh_json(["label", "list", "--limit", "500", "--json", "name"])
            }
            issues = gh_json(
                ["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,labels"]
            )
            pulls = gh_json(
                ["pr", "list", "--state", "open", "--limit", "500", "--json", "number,labels"]
            )
        except (RuntimeError, json.JSONDecodeError) as exc:
            print("LABEL VALIDATION FAILED:")
            print(f"  - could not read the live label state, so this gate would certify nothing: {exc}")
            return 1
        live_errors, live_notes = check_live(
            names, retired_names, repo_labels, labels_in_use(issues, pulls), proposed
        )
        errors += live_errors
        notes += live_notes
    else:
        notes.append("live checks skipped (offline mode); run with --live to compare against the repository")

    for note in notes:
        print(f"  {note}")

    if errors:
        print("LABEL VALIDATION FAILED:")
        for error in errors:
            print("  -", error)
        print(
            f"\nFix by adding the label to {MANIFEST_PATH} (and to validate-commits.py's AREAS or "
            f"PROFILES when it is an area or a profile), by relabelling the issues onto a manifested "
            f"equivalent, or — for a label deliberately kept but never applied again — by declaring "
            f"it in {RETIRED_PATH} with a reason.\n"
            "See .github/skills/product-owner/triage-and-label/SKILL.md"
        )
        return 1

    print(f"label validation passed: {len(names)} manifested label(s) checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate the OpenLogo label taxonomy against reality, in both directions (issue #972, epic #901).

## Why this exists

`AGENTS.md` and the team working agreement both state:

    **Labels are a manifest.** `.github/labels.yml` is the single source of truth.

That was not true. `.github/labels.yml` defined 10 `area:*` labels while 15 were in use; nine labels
across four namespaces were applied to open issues without appearing in the manifest at all. The
mechanism that would have made the manifest authoritative — `label-sync.yml` — is **additive by
design** ("does not delete labels missing from the manifest"), so a label created ad hoc through the
API survives indefinitely and the manifest describes a *subset* of reality rather than defining it.

`validate-meta.py` did not catch it because it checks the manifest is **well-formed** — no duplicate
names, every issue-form and labeler reference defined — never that it is **complete with respect to
labels actually in use**. Well-formed-but-incomplete is exactly how a manifest stays green while
ceasing to describe the world, and it is epic #901's subject: a claim nothing executes.

## The directions, and why they differ in severity

Offline (deterministic, runs on every PR):

  M. **manifest -> commit scopes.** `validate-commits.py`'s `AREAS` claims in a comment to mirror the
     `area:*` labels. This re-derives that mirror instead of trusting the comment. A comment
     asserting a correspondence that does not hold is the same defect one layer down, and it has a
     concrete blocking consequence: an `area:*` label with no matching scope means every PR arising
     from those issues fails the blocking PR-title check, discovered only at review time.

Live (needs `gh`; runs on a schedule, on dispatch, and on any PR that edits the manifest):

  A. **in use -> manifest.** Every label on an open issue or PR is in the manifest. **FAILS.** This
     is the direction that was missing and the one that catches every drifted issue.
  B. **manifest -> repository.** Every manifested label exists on the repository. **FAILS** — the
     additive sync should already guarantee it, so a gap means the sync did not run or did not work.
  C. **repository -> manifest.** Labels that exist on the repository but are not manifested.
     **REPORTED, not failed.** GitHub creates nine stock labels (`bug`, `duplicate`, `wontfix`, ...)
     on every repository; failing on them would demand a destructive change nobody has decided on.
     Reporting keeps them visible, which is the actual goal.
  D. **manifest -> in use.** Manifested labels nobody uses. **REPORTED, not failed.** `level:1`,
     `level:2` and `profile:localization` are legitimately reserved for work that has not started;
     an unused label is a forecast, not a defect.

Every direction prints its count, so a drop to zero is observable rather than silent.

## Why the sync stays additive

Recorded here because the decision is the mechanism. `label-sync.py` keeps its skip-delete
behaviour, and this gate is the detector, because:

  1. Deleting a label deletes it **off every live issue**, and GitHub does not restore those
     applications when the label is re-created. The triage information is simply gone.
  2. The manifest is edited by pull request. A typo or rename in a PR would, under a destructive
     sync, silently strip that label from every issue at merge — with no review of the blast radius.
  3. Direction B is already guaranteed by the additive sync. What was missing is *detection*
     (direction A), not *mutation*.
  4. A destructive sync would delete GitHub's nine stock labels on its first run.

An additive sync plus a failing gate makes drift **visible without being destructive**, which is the
property we actually wanted. Deleting a retired label stays a deliberate, separate act.

## Fail closed

In live mode a `gh` failure is a **finding**, not a skip. A gate that quietly checks nothing is worse
than no gate, because it also removes the human who was checking.

Usage:
  python .github/scripts/validate-labels.py            # offline checks only (no network)
  python .github/scripts/validate-labels.py --live     # offline + live checks (needs gh + GH_TOKEN)
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

#: Namespace prefix whose members must mirror `validate-commits.py`'s AREAS.
AREA_PREFIX = "area:"

#: `core` is already a profile scope, so it is deliberately not duplicated as an area scope.
AREA_SCOPE_EXEMPT = {"core"}


def load_manifest(path: str = MANIFEST_PATH) -> list[dict]:
    """Parse the label manifest into its list of entries."""
    with open(path, encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def manifest_names(entries: list[dict]) -> set[str]:
    """The set of label names the manifest declares."""
    return {entry["name"] for entry in entries}


def area_scopes(names: set[str]) -> set[str]:
    """The commit scopes the `area:*` labels imply, which AREAS must equal."""
    return {name[len(AREA_PREFIX):] for name in names if name.startswith(AREA_PREFIX)} - AREA_SCOPE_EXEMPT


def load_commit_scopes() -> set[str]:
    """Import `validate-commits.py` (a hyphenated filename) and read its AREAS set."""
    spec = importlib.util.spec_from_file_location(
        "validate_commits", os.path.join(HERE, "validate-commits.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return set(module.AREAS)


def check_area_scope_mirror(names: set[str], scopes: set[str]) -> tuple[list[str], list[str]]:
    """Direction M — the `area:*` labels and the commit AREAS scopes must be the same set."""
    expected = area_scopes(names)
    errors = []
    for scope in sorted(expected - scopes):
        errors.append(
            f"`{AREA_PREFIX}{scope}` is in {MANIFEST_PATH} but `{scope}` is not a commit scope in "
            f"validate-commits.py's AREAS — every PR titled `type({scope}): ...` would fail the "
            f"blocking PR-title check."
        )
    for scope in sorted(scopes - expected):
        errors.append(
            f"`{scope}` is a commit scope in validate-commits.py's AREAS but there is no "
            f"`{AREA_PREFIX}{scope}` label in {MANIFEST_PATH}; AREAS claims to mirror those labels."
        )
    return errors, [f"area/scope mirror: {len(expected)} area scope(s) checked in both directions"]


def gh_json(args: list[str]) -> list[dict]:
    """Run a `gh` command that emits JSON, failing loudly rather than degrading to an empty list."""
    completed = subprocess.run(
        ["gh", *args], capture_output=True, text=True, check=False
    )
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
    names: set[str], repo_labels: set[str], in_use: dict[str, list[str]]
) -> tuple[list[str], list[str]]:
    """Directions A-D. Returns (errors, notes); only A and B contribute errors."""
    errors: list[str] = []
    notes: list[str] = []

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

    # B — manifest -> repository. The additive sync should already guarantee this.
    missing = sorted(names - repo_labels)
    for label in missing:
        errors.append(
            f"label `{label}` is in {MANIFEST_PATH} but does not exist on the repository; "
            f"the label sync has not run or did not succeed."
        )
    notes.append(
        f"manifest -> repository: {len(names)} manifested label(s), {len(missing)} missing on the repo"
    )

    # C — repository -> manifest. Reported, never failed (GitHub's stock labels live here).
    unmanaged = sorted(repo_labels - names)
    notes.append(
        f"repository -> manifest: {len(repo_labels)} label(s) on the repo, "
        f"{len(unmanaged)} not in the manifest (reported, not failed)"
    )
    for label in unmanaged:
        notes.append(f"    unmanaged: {label}{' (IN USE)' if label in in_use else ''}")

    # D — manifest -> in use. Reported: an unused label is a forecast, not a defect.
    unused = sorted(names - set(in_use))
    notes.append(
        f"manifest -> in use: {len(unused)} manifested label(s) currently unused "
        f"(reported, not failed): {', '.join(unused) if unused else 'none'}"
    )
    return errors, notes


def main() -> int:
    live = "--live" in sys.argv[1:]
    entries = load_manifest()
    names = manifest_names(entries)

    errors, notes = check_area_scope_mirror(names, load_commit_scopes())

    if live:
        try:
            repo_labels = {entry["name"] for entry in gh_json(["label", "list", "--limit", "500", "--json", "name"])}
            issues = gh_json(["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,labels"])
            pulls = gh_json(["pr", "list", "--state", "open", "--limit", "500", "--json", "number,labels"])
        except (RuntimeError, json.JSONDecodeError) as exc:
            print("LABEL VALIDATION FAILED:")
            print(f"  - could not read the live label state, so this gate would certify nothing: {exc}")
            return 1
        live_errors, live_notes = check_live(names, repo_labels, labels_in_use(issues, pulls))
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
            "\nFix by adding the label to .github/labels.yml (and to validate-commits.py's AREAS "
            "when it is an area), or by relabelling the issues onto a manifested equivalent.\n"
            "See .github/skills/product-owner/triage-and-label/SKILL.md"
        )
        return 1

    print(f"label validation passed: {len(names)} manifested label(s) checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

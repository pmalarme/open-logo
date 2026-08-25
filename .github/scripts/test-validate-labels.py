#!/usr/bin/env python3
"""Self-test for the bidirectional label gate in validate-labels.py (issue #972).

Runs in the CI meta job alongside test-validate-meta.py. Stdlib + pyyaml only; **never touches the
network** — the live directions are exercised against synthetic label state, and the run that reads
the real repository (`--live`) is wired into the label-drift workflow instead.

The `MUTATION:` cases are the point of this file. Issue #972 asks for a gate that fails when the
manifest and reality disagree, and a gate that passes on deliberately broken input asserts nothing —
so each mutation below breaks one direction on purpose and requires the gate to notice.
"""

import contextlib
import importlib.util
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "validate_labels", os.path.join(HERE, "validate-labels.py")
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

REPO_ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))

failures = []


def expect(condition, message):
    if not condition:
        failures.append(message)


def issue(number, *labels):
    return {"number": number, "labels": [{"name": name} for name in labels]}


def scope_sets(areas, profiles=frozenset()):
    return {"AREAS": set(areas), "PROFILES": set(profiles)}


# --- namespace_members: strips the prefix, drops other namespaces, honours the exemption ----------
expect(
    gate.namespace_members({"area:grammar", "area:core", "type:bug", "profile:data"}, "area:", {"core"})
    == {"grammar"},
    "namespace_members must strip the prefix, drop other namespaces, and exempt core",
)
expect(
    gate.managed_prefixes({"area:ci", "type:bug", "level:1", "unnamespaced"})
    == {"area:", "type:", "level:"},
    "managed_prefixes must derive the namespaces from the manifest, not hard-code them",
)

# --- Direction M: both mirrors ---------------------------------------------------------------
errors, notes = gate.check_scope_mirrors(
    {"area:grammar", "area:core", "profile:data"}, scope_sets({"grammar"}, {"data"})
)
expect(errors == [], f"mirrors that agree must produce no errors, got {errors}")
expect(len(notes) == 2, f"both namespaces must report a count, got {notes}")

errors, _ = gate.check_scope_mirrors({"area:grammar", "area:testing"}, scope_sets({"grammar"}))
expect(
    len(errors) == 1 and "area:testing" in errors[0] and "blocking PR-title check" in errors[0],
    f"MUTATION: an area label with no commit scope must fail, got {errors}",
)

errors, _ = gate.check_scope_mirrors({"area:grammar"}, scope_sets({"grammar", "runtime"}))
expect(
    len(errors) == 1 and "`runtime` is a commit scope" in errors[0],
    f"MUTATION: a commit scope with no area label must fail, got {errors}",
)

# MUTATION: the profile mirror, which the first round of this gate did not check at all.
errors, _ = gate.check_scope_mirrors({"profile:sound"}, scope_sets(set(), set()))
expect(
    len(errors) == 1 and "profile:sound" in errors[0] and "PROFILES" in errors[0],
    f"MUTATION: a profile label with no commit scope must fail, got {errors}",
)
errors, _ = gate.check_scope_mirrors(set(), scope_sets(set(), {"sound"}))
expect(
    len(errors) == 1 and "PROFILES" in errors[0],
    f"MUTATION: a profile scope with no label must fail, got {errors}",
)

# An exempt label (area:core) that is nevertheless added to AREAS must say so accurately, rather
# than claiming the label does not exist.
errors, _ = gate.check_scope_mirrors({"area:core"}, scope_sets({"core"}))
expect(
    len(errors) == 1 and "exempt from this mirror" in errors[0],
    f"the exempt-label message must not claim area:core is missing, got {errors}",
)

# --- The real manifest and the real validate-commits.py scope sets must actually agree ------------
real_names = gate.manifest_names(gate.load_manifest(os.path.join(REPO_ROOT, ".github", "labels.yml")))
real_scopes = gate.load_commit_scope_sets()
expect(
    real_scopes["AREAS"] and real_scopes["PROFILES"],
    "load_commit_scope_sets must import AREAS and PROFILES from validate-commits.py",
)
errors, _ = gate.check_scope_mirrors(real_names, real_scopes)
expect(errors == [], f"the shipped manifest and the commit scopes must mirror each other, got {errors}")

# --- Retired declarations must be reasoned, and must not double as manifested ---------------------
real_retired = gate.load_yaml(os.path.join(REPO_ROOT, ".github", "labels-retired.yml"))
errors, _ = gate.check_retired(real_names, real_retired)
expect(errors == [], f"the shipped retired list must be valid, got {errors}")
expect(
    all((entry.get("why") or "").strip() for entry in real_retired),
    "every shipped retired entry must carry a reason",
)

errors, _ = gate.check_retired({"area:ci"}, [{"name": "area:ci", "why": "x"}])
expect(
    any("not both" in e for e in errors),
    f"MUTATION: a label both manifested and retired must fail, got {errors}",
)
errors, _ = gate.check_retired(set(), [{"name": "area:gone", "why": "  "}])
expect(
    any("no `why`" in e for e in errors),
    f"MUTATION: a retired entry without a reason must fail, got {errors}",
)

# --- labels_in_use: merges issues and pull requests ----------------------------------------------
in_use = gate.labels_in_use(
    [issue(1, "area:ci"), issue(2, "area:ci", "type:bug")], [issue(9, "area:ci")]
)
expect(
    in_use["area:ci"] == ["#1", "#2", "PR #9"],
    f"labels_in_use must record issues and PRs that carry a label, got {in_use}",
)
expect(in_use["type:bug"] == ["#2"], f"labels_in_use must not over-attribute, got {in_use}")

# --- Directions A-D on a clean world -------------------------------------------------------------
names = {"area:ci", "type:bug", "level:8"}
errors, notes = gate.check_live(names, set(), names, {"area:ci": ["#1"], "type:bug": ["#1"]})
expect(errors == [], f"a manifest that matches reality must produce no errors, got {errors}")
expect(
    any("level:8" in note and "currently unused" in note for note in notes),
    f"direction D must report an unused label without failing, got {notes}",
)

# --- MUTATION: a label in use but absent from the manifest (the direction that was missing) ------
errors, _ = gate.check_live({"area:ci"}, set(), {"area:ci", "area:testing"}, {"area:testing": ["#5", "#6"]})
expect(
    any("area:testing" in e and "not in .github/labels.yml" in e for e in errors),
    f"MUTATION: an unmanifested label in use must fail the gate, got {errors}",
)
expect(any("#5, #6" in e for e in errors), f"the failure must name the issues carrying it, got {errors}")

# --- MUTATION: remove a real, in-use label from the real manifest --------------------------------
# The acceptance criterion verbatim: "remove a label from the manifest while it is still in use ->
# must fail". Applied to the shipped manifest rather than a toy one, so it cannot drift away from it.
victim = "area:ci"
expect(victim in real_names, f"{victim} must be in the shipped manifest for this mutation to mean anything")
errors, _ = gate.check_live(real_names - {victim}, set(), real_names, {victim: ["#978"]})
expect(
    any(victim in e and "not in .github/labels.yml" in e for e in errors),
    f"MUTATION: dropping {victim} from the manifest while it is in use must fail, got {errors}",
)

# --- MUTATION: a manifested label that does not exist on the repository --------------------------
errors, _ = gate.check_live({"area:ci", "area:ghost"}, set(), {"area:ci"}, {"area:ci": ["#1"]})
expect(
    any("area:ghost" in e and "does not exist on the repository" in e for e in errors),
    f"MUTATION: a manifested label missing from the repo must fail, got {errors}",
)

# --proposed downgrades exactly that case when the branch adds the label, because on a PR the sync
# has not run yet.
errors, notes = gate.check_live(
    {"area:ci", "area:ghost"}, set(), {"area:ci"}, {"area:ci": ["#1"]},
    proposed=True, added={"area:ghost"},
)
expect(errors == [], f"--proposed must not fail on a label the sync has not created yet, got {errors}")
expect(
    any("proposed (not yet synced): area:ghost" in note for note in notes),
    f"--proposed must still report it, got {notes}",
)

# --- MUTATION: a namespaced label on the repo that is neither manifested nor retired -------------
# This is the hole the first round left: `area:infra` was treated exactly like GitHub's `wontfix`.
errors, _ = gate.check_live({"area:ci"}, set(), {"area:ci", "area:infra"}, {"area:ci": ["#1"]})
expect(
    any("area:infra" in e and "is namespaced" in e for e in errors),
    f"MUTATION: an unmanifested namespaced label must fail even when nobody uses it, got {errors}",
)

# Declaring it retired is the sanctioned escape, and it must work.
errors, notes = gate.check_live(
    {"area:ci"}, {"area:infra"}, {"area:ci", "area:infra"}, {"area:ci": ["#1"]}
)
expect(errors == [], f"a declared retired label must not fail the gate, got {errors}")
expect(
    any("unmanaged [retired]: area:infra" in note for note in notes),
    f"a retired label must still be reported, got {notes}",
)

# --- Unnamespaced stock labels are reported, never failed ----------------------------------------
errors, notes = gate.check_live(
    {"area:ci"}, set(), {"area:ci", "wontfix", "good first issue"}, {"area:ci": ["#1"]}
)
expect(errors == [], f"GitHub's stock labels must not fail the gate, got {errors}")
expect(
    any("unmanaged [stock]: wontfix" in note for note in notes),
    f"direction C must still report them, got {notes}",
)

# --- An unmanaged label that IS in use is both reported and failed -------------------------------
errors, notes = gate.check_live({"area:ci"}, set(), {"area:ci", "area:legacy"}, {"area:legacy": ["#7"]})
expect(errors != [], "an unmanaged label in use must fail")
expect(
    any("unmanaged [NAMESPACED]: area:legacy (IN USE)" in note for note in notes),
    f"direction C must mark an unmanaged namespaced label that is in use, got {notes}",
)

# --- Fail closed: a gh failure raises rather than degrading to an empty result -------------------
class _Failed:
    returncode = 1
    stdout = ""
    stderr = "gh: not authenticated"


original_run = gate.subprocess.run
gate.subprocess.run = lambda *args, **kwargs: _Failed()
try:
    gate.gh_json(["label", "list"])
    failures.append("gh_json must raise when gh fails, so the gate cannot pass on no data")
except RuntimeError as exc:
    expect("not authenticated" in str(exc), f"the raised error must carry gh's reason, got {exc}")
finally:
    gate.subprocess.run = original_run

# --- MUTATION: a label in an entirely NEW namespace must not pass as a stock label -------------
# `managed_prefixes` derived the namespaces from the manifest, so `infra:runner` was classified
# "unnamespaced (GitHub stock)" and passed. Somebody inventing a namespace is exactly this
# direction's job.
expect(gate.is_namespaced("infra:runner"), "a colon makes a label namespaced")
expect(not gate.is_namespaced("good first issue"), "a stock label is not namespaced")
errors, _ = gate.check_live({"area:ci"}, set(), {"area:ci", "infra:runner"}, {"area:ci": ["#1"]})
expect(
    any("infra:runner" in e and "is namespaced" in e for e in errors),
    f"MUTATION: a label in an unknown namespace must fail direction C, got {errors}",
)

# --- main(): argv parsing, --proposed wiring, and the gh-failure exit path -----------------------
# Round-2 review found main() entirely unexercised. It is the code CI actually runs.
original_gh = gate.gh_json
original_argv = sys.argv


def _fake_gh(labels, issues, pulls):
    def run(args):
        if args[0] == "label":
            return [{"name": name} for name in labels]
        if args[0] == "issue":
            return issues
        return pulls

    return run


def run_main(argv):
    """Call main() with argv, swallowing its report so the self-test's own output stays readable."""
    sys.argv = ["validate-labels.py", *argv]
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        return gate.main()


try:
    expect(run_main([]) == 0, "offline main() must pass on the shipped manifest")

    # --live with a clean world passes.
    gate.gh_json = _fake_gh(real_names, [issue(1, "area:ci")], [])
    expect(run_main(["--live"]) == 0, "live main() must pass when the world matches the manifest")

    # An unmanifested label in use must make main() exit non-zero.
    gate.gh_json = _fake_gh(real_names | {"area:invented"}, [issue(1, "area:invented")], [])
    expect(run_main(["--live"]) == 1, "live main() must fail on an unmanifested label in use")

    # --proposed must downgrade direction B, but ONLY for a label this branch actually adds.
    gate.gh_json = _fake_gh(real_names - {"area:ci"}, [], [])
    expect(run_main(["--live"]) == 1, "without --proposed, a label missing on the repo must fail")
    expect(
        run_main(["--live", "--proposed", "--base=HEAD"]) == 1,
        "MUTATION: --proposed must NOT excuse a manifested label this branch did not add — a label "
        "deleted off the repository must still fail",
    )

    # A gh failure must exit 1 rather than certify nothing.
    def _raise(_args):
        raise RuntimeError("gh: not authenticated")

    gate.gh_json = _raise
    expect(run_main(["--live"]) == 1, "main() must exit 1 when the live state cannot be read")
finally:
    gate.gh_json = original_gh
    sys.argv = original_argv

# --- --proposed excuses only the ADDED set ------------------------------------------------------
errors, notes = gate.check_live(
    {"area:ci", "area:new"}, set(), {"area:ci"}, {"area:ci": ["#1"]},
    proposed=True, added={"area:new"},
)
expect(errors == [], f"--proposed must excuse a label this branch adds, got {errors}")
expect(
    any("proposed (not yet synced): area:new" in note for note in notes),
    f"--proposed must still report the added label, got {notes}",
)

errors, _ = gate.check_live(
    {"area:ci", "area:old"}, set(), {"area:ci"}, {"area:ci": ["#1"]},
    proposed=True, added=set(),
)
expect(
    any("area:old" in e and "does not exist on the repository" in e for e in errors),
    f"MUTATION: --proposed must still fail on a pre-existing label missing from the repo, got {errors}",
)

# labels_added_against returns the difference, and degrades to "excuse nothing" on an unreadable base.
expect(
    gate.labels_added_against({"a", "b"}, "definitely-not-a-ref") == set(),
    "an unreadable base must excuse nothing — the safe direction",
)

# --- The module's real process exit ---------------------------------------------------------------
# main() returning 1 is not the same as the process exiting 1: `raise SystemExit(main())` is its own
# line, and deleting it made a failing live run print failure and exit 0.
completed = subprocess.run(
    [sys.executable, os.path.join(HERE, "validate-labels.py"), "--live", "--base=HEAD"],
    capture_output=True,
    text=True,
    cwd=REPO_ROOT,
    env={**os.environ, "PATH": os.environ.get("PATH", ""), "GH_TOKEN": "invalid-on-purpose"},
)
expect(
    completed.returncode in (0, 1),
    f"the module must exit 0 or 1, never crash; got {completed.returncode}: {completed.stderr[-400:]}",
)

if failures:
    print("LABEL GATE SELF-TEST FAILED:")
    for failure in failures:
        print("  -", failure)
    sys.exit(1)

print("label gate self-test passed")

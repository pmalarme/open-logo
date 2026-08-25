#!/usr/bin/env python3
"""Self-test for the bidirectional label gate in validate-labels.py (issue #972).

Runs in the CI meta job alongside test-validate-meta.py. Stdlib + pyyaml only; **never touches the
network** — the live directions are exercised against synthetic label state, and the one check that
reads the real repository (`--live`) is wired into the label-drift workflow instead.

The `MUTATION:` cases are the point of this file. Issue #972 asks for a gate that fails when the
manifest and reality disagree, and a gate that passes on deliberately broken input asserts nothing —
so each mutation below breaks one direction on purpose and requires the gate to notice.
"""

import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "validate_labels", os.path.join(HERE, "validate-labels.py")
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

failures = []


def expect(condition, message):
    if not condition:
        failures.append(message)


def issue(number, *labels):
    return {"number": number, "labels": [{"name": name} for name in labels]}


# --- area_scopes: strips the namespace and exempts `core` (already a profile scope) -------------
expect(
    gate.area_scopes({"area:grammar", "area:core", "type:bug", "profile:data"}) == {"grammar"},
    "area_scopes must strip the area: prefix, drop other namespaces, and exempt core",
)

# --- Direction M: the AREAS mirror ---------------------------------------------------------------
errors, notes = gate.check_area_scope_mirror({"area:grammar", "area:core"}, {"grammar"})
expect(errors == [], f"a mirror that agrees must produce no errors, got {errors}")
expect(notes and "1 area scope(s)" in notes[0], f"the mirror must report its count, got {notes}")

errors, _ = gate.check_area_scope_mirror({"area:grammar", "area:testing"}, {"grammar"})
expect(
    len(errors) == 1 and "area:testing" in errors[0] and "blocking PR-title check" in errors[0],
    f"MUTATION: an area label with no commit scope must fail, got {errors}",
)

errors, _ = gate.check_area_scope_mirror({"area:grammar"}, {"grammar", "runtime"})
expect(
    len(errors) == 1 and "`runtime` is a commit scope" in errors[0],
    f"MUTATION: a commit scope with no area label must fail, got {errors}",
)

# --- The real manifest and the real validate-commits.py AREAS must actually agree ---------------
real_names = gate.manifest_names(gate.load_manifest(os.path.join(HERE, "..", "labels.yml")))
real_scopes = gate.load_commit_scopes()
expect(len(real_scopes) > 0, "load_commit_scopes must import AREAS from validate-commits.py")
errors, _ = gate.check_area_scope_mirror(real_names, real_scopes)
expect(errors == [], f"the shipped manifest and AREAS must mirror each other, got {errors}")

# --- labels_in_use: merges issues and pull requests ----------------------------------------------
in_use = gate.labels_in_use([issue(1, "area:ci"), issue(2, "area:ci", "type:bug")], [issue(9, "area:ci")])
expect(
    in_use["area:ci"] == ["#1", "#2", "PR #9"],
    f"labels_in_use must record issues and PRs that carry a label, got {in_use}",
)
expect(in_use["type:bug"] == ["#2"], f"labels_in_use must not over-attribute, got {in_use}")

# --- Directions A-D on a clean world -------------------------------------------------------------
names = {"area:ci", "type:bug", "level:8"}
errors, notes = gate.check_live(names, names, {"area:ci": ["#1"], "type:bug": ["#1"]})
expect(errors == [], f"a manifest that matches reality must produce no errors, got {errors}")
expect(
    any("level:8" in note and "currently unused" in note for note in notes),
    f"direction D must report an unused label without failing, got {notes}",
)

# --- MUTATION: a label in use but absent from the manifest (the direction that was missing) ------
errors, _ = gate.check_live({"area:ci"}, {"area:ci", "area:testing"}, {"area:testing": ["#5", "#6"]})
expect(
    any("area:testing" in e and "not in .github/labels.yml" in e for e in errors),
    f"MUTATION: an unmanifested label in use must fail the gate, got {errors}",
)
expect(
    any("#5, #6" in e for e in errors),
    f"the failure must name the issues carrying it, got {errors}",
)

# --- MUTATION: remove a real, in-use label from the real manifest --------------------------------
# The acceptance criterion verbatim: "remove a label from the manifest while it is still in use ->
# must fail". Applied to the shipped manifest rather than a toy one, so it cannot drift away from it.
victim = "area:ci"
expect(victim in real_names, f"{victim} must be in the shipped manifest for this mutation to mean anything")
errors, _ = gate.check_live(real_names - {victim}, real_names, {victim: ["#978"]})
expect(
    any(victim in e and "not in .github/labels.yml" in e for e in errors),
    f"MUTATION: dropping {victim} from the manifest while it is in use must fail, got {errors}",
)

# --- MUTATION: a manifested label that does not exist on the repository --------------------------
errors, _ = gate.check_live({"area:ci", "area:ghost"}, {"area:ci"}, {"area:ci": ["#1"]})
expect(
    any("area:ghost" in e and "does not exist on the repository" in e for e in errors),
    f"MUTATION: a manifested label missing from the repo must fail, got {errors}",
)

# --- Direction C is reported, never failed (GitHub's stock labels live there) --------------------
errors, notes = gate.check_live({"area:ci"}, {"area:ci", "wontfix", "good first issue"}, {"area:ci": ["#1"]})
expect(errors == [], f"unmanifested labels that nobody uses must not fail the gate, got {errors}")
expect(
    any("unmanaged: wontfix" in note for note in notes),
    f"direction C must still report them, got {notes}",
)

# --- An unmanaged label that IS in use is both reported and failed -------------------------------
errors, notes = gate.check_live({"area:ci"}, {"area:ci", "area:legacy"}, {"area:legacy": ["#7"]})
expect(errors != [], "an unmanaged label in use must fail via direction A")
expect(
    any("unmanaged: area:legacy (IN USE)" in note for note in notes),
    f"direction C must mark an unmanaged label that is in use, got {notes}",
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

if failures:
    print("LABEL GATE SELF-TEST FAILED:")
    for failure in failures:
        print("  -", failure)
    sys.exit(1)

print("label gate self-test passed")

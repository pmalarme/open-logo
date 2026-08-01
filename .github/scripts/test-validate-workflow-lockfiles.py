#!/usr/bin/env python3
"""Self-test for the workflow lock-file pairing guard in validate-workflow-lockfiles.py.

Runs in CI in **both** the always-on `meta` job and the path-scoped `workflows-compile` job,
alongside the guard itself. Never touches the network; depends only on `pyyaml`, like the guard.
Exits non-zero on any unexpected result.

Locks the edge cases the guard exists for: a compilable `.md` source with no compiled lock, a
`.lock.yml` with no source (orphaned), a `.lock.yml` whose source still exists but is no longer
compilable (stale — nothing will recompile it), an empty directory (today's actual repo state —
must pass cleanly, not silently skip forever), a directory that does not exist at all, and — per
the gh-aw v0.83.1 compile semantics `requires_lock()` approximates (see that function's
docstring) —
every shape of `.md` that must NOT be treated as needing a lock file: no frontmatter opener at
all, a BOM-prefixed opener (which gh-aw does not recognize either), frontmatter with no top-level `on:` trigger, a subdirectory fragment, `on:` appearing only in
the markdown body (after the closing `---`), and `on:` appearing only indented/nested under
another frontmatter key (block-style).

Also locks every additional top-level-`on:` shape empirically confirmed against gh-aw v0.83.1 in
throwaway repos during the R1 follow-up (see the PR discussion): a single- or double-quoted `on:`
key in block style, and `on :` with a space before the colon. Flow-mapping frontmatter goes through
the same YAML parse as block style (R3 follow-up), so `{on: push, name: x}` requires a lock while a
flow-style importable fragment such as `{tools: {}}` — or one whose only `on:` is nested under
another key — correctly does not. Finally it locks the fail-closed fallbacks (frontmatter that does
not parse, or parses to a non-mapping) and the YAML-1.1 boolean-ish bare keys (`True:`, `yes:`)
that are deliberately NOT treated as `on:` aliases, because gh-aw does not honour them either.
"""

import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "validate_workflow_lockfiles", os.path.join(HERE, "validate-workflow-lockfiles.py")
)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

failures = []

# A real gh-aw-compilable workflow source: frontmatter opener as the first line, top-level `on:`.
COMPILABLE_MD = "---\non: push\n---\n\nDo a thing.\n"


def write(directory: str, name: str, content: str = "placeholder\n") -> str:
    path = os.path.join(directory, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)
    return path


# --- requires_lock() unit checks: exactly what gh-aw v0.83.1 does and does not compile -------

with tempfile.TemporaryDirectory() as directory:
    compilable = write(directory, "compilable.md", COMPILABLE_MD)
    if not guard.requires_lock(compilable):
        failures.append("requires_lock: a frontmatter .md with top-level `on:` must be True")

    no_frontmatter = write(directory, "no-frontmatter.md", "# Just a README\n\nNo frontmatter.\n")
    if guard.requires_lock(no_frontmatter):
        failures.append("requires_lock: a .md with no frontmatter opener must be False")

    frontmatter_no_on = write(
        directory,
        "frontmatter-no-on.md",
        "---\nname: A shared fragment\ntools:\n  bash: true\n---\n\nBody.\n",
    )
    if guard.requires_lock(frontmatter_no_on):
        failures.append("requires_lock: frontmatter with no top-level `on:` must be False")

    on_in_body_only = write(
        directory,
        "on-in-body-only.md",
        "---\nname: no trigger here\n---\n\non: this is prose in the body, not YAML\n",
    )
    if guard.requires_lock(on_in_body_only):
        failures.append(
            "requires_lock: `on:`-looking text in the markdown body (after the closing "
            "delimiter) must not count as a trigger"
        )

    on_indented_only = write(
        directory,
        "on-indented-only.md",
        "---\npermissions:\n  on: push\n---\n\nBody.\n",
    )
    if guard.requires_lock(on_indented_only):
        failures.append(
            "requires_lock: an indented/nested `on:` (not a top-level frontmatter key) must "
            "not count as a trigger"
        )

    unterminated = write(directory, "unterminated.md", "---\non: push\n\nNo closing delimiter.\n")
    if not guard.requires_lock(unterminated):
        failures.append(
            "requires_lock: an unterminated frontmatter block should still be scanned "
            "best-effort and find the top-level `on:` it contains"
        )

    # --- R3 follow-up: the delimiter match mirrors gh-aw, which TRIMS the line -----------------
    #
    # gh-aw v0.83.1 tests `strings.TrimSpace(firstLine) == "---"` (pkg/cli/workflows.go) and trims
    # the same way in `isFrontmatterDelimiterLine` (pkg/parser/frontmatter_content.go), so a
    # padded ` ---` IS a frontmatter opener and the source IS compiled. Treating it as a plain doc
    # here would fail *open*: gh-aw would compile a workflow this guard never demanded a lock for.
    padded_opener = write(directory, "padded-opener.md", " ---\non: push\n ---\n\nBody.\n")
    if not guard.requires_lock(padded_opener):
        failures.append(
            "requires_lock: a whitespace-padded ` ---` opener/closer is a frontmatter delimiter "
            "for gh-aw (strings.TrimSpace), so the source is compilable — expected True"
        )

    # CRLF line endings must not change any verdict: `.gitattributes` pins these sources to LF,
    # but a Windows client with core.autocrlf=true can still produce them locally, and the ci.yml
    # probe strips a trailing `\r` for the same reason. `str.splitlines()` handles it here.
    crlf_compilable = write(directory, "crlf-compilable.md", "---\r\non: push\r\n---\r\n\r\nBody.\r\n")
    if not guard.requires_lock(crlf_compilable):
        failures.append("requires_lock: a CRLF-encoded compilable source must still be True")

    crlf_fragment = write(directory, "crlf-fragment.md", "---\r\ntools:\r\n  bash: true\r\n---\r\n")
    if guard.requires_lock(crlf_fragment):
        failures.append("requires_lock: a CRLF-encoded `on:`-less fragment must still be False")

    # --- R1 follow-up: additional top-level `on:` shapes verified against gh-aw v0.83.1 --------

    double_quoted_key = write(directory, "double-quoted-key.md", '---\n"on": push\n---\n\nBody.\n')
    if not guard.requires_lock(double_quoted_key):
        failures.append('requires_lock: a double-quoted `"on":` block-style key must be True')

    single_quoted_key = write(directory, "single-quoted-key.md", "---\n'on': push\n---\n\nBody.\n")
    if not guard.requires_lock(single_quoted_key):
        failures.append("requires_lock: a single-quoted `'on':` block-style key must be True")

    space_before_colon = write(directory, "space-before-colon.md", "---\non : push\n---\n\nBody.\n")
    if not guard.requires_lock(space_before_colon):
        failures.append("requires_lock: `on :` (space before the colon) must be True")

    # --- R3 follow-up: flow-mapping frontmatter is classified by the same YAML parse -----------
    #
    # A flow mapping is YAML like any other, so it is parsed rather than guessed at: a real
    # top-level `on:` requires a lock, and a flow-style importable fragment (gh-aw's own shared /
    # include shape, which it skips compiling) does not. The earlier heuristic failed this last
    # case closed, spuriously demanding a lock file no `gh-aw compile` would ever produce.

    flow_style = write(
        directory, "flow-style.md", "---\n{on: push, name: flow}\n---\n\nBody.\n"
    )
    if not guard.requires_lock(flow_style):
        failures.append("requires_lock: a flow-mapping frontmatter with `on:` must be True")

    flow_style_fragment = write(
        directory,
        "flow-style-fragment.md",
        "---\n{tools: {}}\n---\n\nBody.\n",
    )
    if guard.requires_lock(flow_style_fragment):
        failures.append(
            "requires_lock: a flow-mapping importable fragment with no top-level `on:` is "
            "lock-free for gh-aw and must be False — flagging it would fail a legitimate "
            "shared workflow that no `gh-aw compile` can ever produce a lock file for"
        )

    flow_style_nested_no_on = write(
        directory,
        "flow-style-nested-no-on.md",
        "---\n{tools: {on: push}, name: nested-no-on}\n---\n\nBody.\n",
    )
    if guard.requires_lock(flow_style_nested_no_on):
        failures.append(
            "requires_lock: an `on:` nested under another key is not a top-level trigger in flow "
            "style either, so it must be False — gh-aw compile itself fails on this shape "
            "(\"field 'name' cannot be used in shared workflows\"), so CI still goes red there"
        )

    # --- R3 follow-up: fail-closed fallbacks for frontmatter that cannot be classified ---------

    unparsable = write(
        directory, "unparsable.md", "---\nname: x\n  bad: : indentation\n---\n\nBody.\n"
    )
    if not guard.requires_lock(unparsable):
        failures.append(
            "requires_lock: frontmatter that is not valid YAML must fail closed (True) rather "
            "than silently exempt a file gh-aw might compile"
        )

    non_mapping = write(directory, "non-mapping.md", "---\n- just\n- a list\n---\n\nBody.\n")
    if not guard.requires_lock(non_mapping):
        failures.append(
            "requires_lock: frontmatter that parses to something other than a mapping must fail "
            "closed (True)"
        )

    empty_frontmatter = write(directory, "empty-frontmatter.md", "---\n---\n\nBody.\n")
    if guard.requires_lock(empty_frontmatter):
        failures.append(
            "requires_lock: empty frontmatter is unambiguously trigger-less and must be False"
        )

    # A UTF-8 BOM is NOT stripped, because gh-aw does not strip one either: Go's TrimSpace does
    # not treat U+FEFF as whitespace, so `\ufeff---` is not a delimiter and gh-aw skips the file.
    # Demanding a lock for it would be an impossible-to-satisfy false block.
    bom_opener = write(directory, "bom-opener.md", "\ufeff---\non: push\n---\n\nBody.\n")
    if guard.requires_lock(bom_opener):
        failures.append(
            "requires_lock: a UTF-8 BOM before the opener means gh-aw does not see frontmatter "
            "and never compiles the file — expected False"
        )

    # A non-breaking space inside the frontmatter is normalized to a plain space before parsing,
    # exactly as gh-aw's parseFrontmatterYAML does, so a source it parses is not misread here.
    nbsp_frontmatter = write(
        directory, "nbsp-frontmatter.md", "---\non:\u00a0push\n---\n\nBody.\n"
    )
    if not guard.requires_lock(nbsp_frontmatter):
        failures.append(
            "requires_lock: a non-breaking space in the frontmatter must be normalized like "
            "gh-aw does — expected True"
        )

    # --- R1 follow-up: documented, deliberately-tested known limitations -----------------------
    #
    # These are NOT bugs: `requires_lock()`'s docstring documents both as consciously out of
    # scope for a stdlib-only, non-YAML-parsing scan. They are asserted here so the *documented*
    # behaviour cannot silently regress (e.g. someone "fixing" one without updating the other).

    # YAML-1.1 boolean-ish bare keys (`True:`, `yes:`) are not `on:` aliases — verified
    # empirically that gh-aw itself does not honour them (it errors "Unknown property: true/yes"
    # rather than compiling). Parsing with `yaml.BaseLoader` keeps them as the raw strings
    # `"True"`/`"yes"` instead of collapsing them onto YAML 1.1's boolean, so `requires_lock`
    # agrees with gh-aw here rather than merely happening to.
    true_key = write(directory, "true-key.md", "---\nTrue: push\n---\n\nBody.\n")
    if guard.requires_lock(true_key):
        failures.append(
            "requires_lock: a literal `True:` key is not an `on:` alias (known limitation; "
            "gh-aw itself rejects it as an unknown property) — expected False"
        )

    yes_key = write(directory, "yes-key.md", "---\nyes: push\n---\n\nBody.\n")
    if guard.requires_lock(yes_key):
        failures.append(
            "requires_lock: a literal `yes:` key is not an `on:` alias (known limitation; "
            "gh-aw itself rejects it as an unknown property) — expected False"
        )

# --- find_problems()/main() integration checks -------------------------------------------------

with tempfile.TemporaryDirectory() as directory:
    # Today's actual repo state: no .md, no .lock.yml at all. Must pass — not a silent skip
    # forever, just nothing to pair yet.
    if guard.find_problems(directory) != []:
        failures.append("empty directory: expected no problems")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 0:
        failures.append("main: empty directory should exit 0")

    # A clean pair: one compilable .md, one matching .lock.yml.
    write(directory, "demo.md", COMPILABLE_MD)
    write(directory, "demo.lock.yml")
    if guard.find_problems(directory) != []:
        failures.append("clean pair: expected no problems")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 0:
        failures.append("main: clean pair should exit 0")

    # A non-frontmatter .md (e.g. a README dropped into .github/workflows/) must never be
    # mistaken for a workflow source needing a lock file: gh-aw silently ignores it (fact 1).
    write(directory, "README.md", "# Workflows\n\nSee AGENTS.md.\n")
    if guard.find_problems(directory) != []:
        failures.append("no-frontmatter README.md: must not require a lock file")
    os.remove(os.path.join(directory, "README.md"))

    # A .md with frontmatter but no top-level `on:` (an importable fragment/include, fact 2)
    # must not require a lock file either.
    write(directory, "fragment.md", "---\ntools:\n  bash: true\n---\n\nShared prose.\n")
    if guard.find_problems(directory) != []:
        failures.append("frontmatter-without-on fragment.md: must not require a lock file")
    os.remove(os.path.join(directory, "fragment.md"))

    # A .md under a subdirectory (fact 3: gh-aw never recurses into .github/workflows/shared/)
    # must not require a lock file, even if it has a top-level `on:` trigger.
    write(directory, os.path.join("shared", "helper.md"), COMPILABLE_MD)
    if guard.find_problems(directory) != []:
        failures.append("shared/ subdirectory fragment: must not require a lock file")
    os.remove(os.path.join(directory, "shared", "helper.md"))
    os.rmdir(os.path.join(directory, "shared"))

    # A compilable .md source with no compiled lock file (forgot to run `gh-aw compile`).
    write(directory, "nolock.md", COMPILABLE_MD)
    problems = guard.find_problems(directory)
    if not any("nolock.md has no compiled nolock.lock.yml" in problem for problem in problems):
        failures.append(f"missing lock: expected a nolock.md problem, got {problems!r}")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 1:
        failures.append("main: a compilable .md source with no lock should exit 1")
    os.remove(os.path.join(directory, "nolock.md"))

    # An orphaned .lock.yml with no matching .md source (source deleted, lock left behind).
    write(directory, "ghost.lock.yml")
    problems = guard.find_problems(directory)
    if not any("ghost.lock.yml has no source ghost.md" in problem for problem in problems):
        failures.append(f"orphaned lock: expected a ghost.lock.yml problem, got {problems!r}")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 1:
        failures.append("main: an orphaned .lock.yml should exit 1")
    os.remove(os.path.join(directory, "ghost.lock.yml"))

    # --- R2 follow-up: a lock whose source still EXISTS but is no longer compilable is just as
    # stale as one whose source was deleted. `gh-aw compile` skips the demoted source and never
    # deletes the lock, so the executable YAML keeps running with nothing recompiling it — a
    # pairing check that accepted any .md of the same basename would fail open here.
    write(directory, "demoted.md", "---\nname: demoted to a fragment\n---\n\nBody.\n")
    write(directory, "demoted.lock.yml")
    problems = guard.find_problems(directory)
    if not any(
        "demoted.lock.yml exists but demoted.md is not a workflow gh-aw compiles" in problem
        for problem in problems
    ):
        failures.append(f"stale lock (source demoted): expected a problem, got {problems!r}")
    if guard.main(["validate-workflow-lockfiles.py", directory]) != 1:
        failures.append("main: a lock whose source is no longer compilable should exit 1")
    os.remove(os.path.join(directory, "demoted.md"))
    os.remove(os.path.join(directory, "demoted.lock.yml"))

    # A CRLF-encoded pair still pairs cleanly end to end (guard-level regression lock for the
    # `.gitattributes` LF pin and the ci.yml `tr -d '\r'` probe).
    write(directory, "crlf.md", "---\r\non: push\r\n---\r\n\r\nBody.\r\n")
    write(directory, "crlf.lock.yml")
    if guard.find_problems(directory) != []:
        failures.append("CRLF pair: expected no problems")
    os.remove(os.path.join(directory, "crlf.md"))
    os.remove(os.path.join(directory, "crlf.lock.yml"))

    # Non-workflow files (e.g. hand-written *.yml) must never be mistaken for a lock file: only
    # the exact ".lock.yml" suffix counts, not any file ending in ".yml".
    write(directory, "ci.yml")
    if guard.find_problems(directory) != []:
        failures.append("hand-written .yml: must not be treated as an orphaned lock file")
    os.remove(os.path.join(directory, "ci.yml"))

# A missing workflows directory is not an error.
missing = os.path.join(tempfile.gettempdir(), "definitely-does-not-exist-validate-workflow-locks")
if guard.main(["validate-workflow-lockfiles.py", missing]) != 0:
    failures.append("main: a missing directory should exit 0")

if failures:
    print("Workflow lock-file pairing guard self-test FAILED:", file=sys.stderr)
    for failure in failures:
        print(f"  - {failure}", file=sys.stderr)
    sys.exit(1)

print("Workflow lock-file pairing guard self-test passed.")

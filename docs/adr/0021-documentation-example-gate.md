# 21. Documentation examples are gated, with an out-of-tree expectations manifest

- Status: Accepted
- Date: 2026-08-22
- Deciders: OpenLogo maintainer (@pmalarme) + testing + devops + orchestrator
- Amends: [ADR-0005](0005-toolchain.md) (lines 47-53 defined `examples` as the
  `spec/examples/*.logo` gate only; this extends that script to the prose corpus)
- Related: [ADR-0000](0000-record-architecture-decisions.md) (immutability rule);
  [ADR-0007](0007-conformance-harness.md) (`tests/conformance/` and its `_harness-selftest/`
  prove-it-goes-red discipline); [ADR-0009](0009-test-layout.md) (co-located `.test.mjs` +
  loaded-module coverage policy, which is why a CLI shell is subprocess-tested);
  [ADR-0014](0014-deterministic-coverage-gate.md) (the precedent for a DoD gate with its own
  decision record); issue #850; issues #752/#849 (the defect that motivated it)

## Context

The team's Definition of Done says runnable `spec/examples/*.logo` **and doc examples** still parse
and run. Only the first half was enforced. `scripts/examples-gate.mjs` walks the standalone `.logo`
files under `spec/examples/`, so the 300-plus OpenLogo programs embedded in `spec/` and `docs/`
prose were never parsed and never executed.

That gap shipped a defect. `spec/turtles-and-sprites.md` taught `set_shape` with

```text
:bee = new_turtle
ask :bee [
  set_shape "bee"
  ...
]
```

`"bee"` is not a shape word any conforming renderer accepts; the block raises `ol-type`. It sat
inside a **0.1.0 conformance claim** and was found by a human reading the prose, not by CI
(issue #752, corrected in #849). Everything CI checked was green.

Building a gate for the prose corpus runs into three problems that a naive "extract and execute
everything" script gets wrong, and one constraint that rules out the obvious solution to all three:

1. **Not every ` ```logo ` block is OpenLogo.** `spec/grammar.md` fences EBNF production rules that
   way; nothing can infer that from the content.
2. **Most blocks are fragments.** A C3 entry shows `print :nums[1]` where `:nums` is assigned in the
   paragraph above. Executed alone it raises `ol-undefined-var` — correctly, and uninterestingly.
3. **Some blocks are deliberately invalid.** `spec/error-model.md` and `spec/tooling.md` show
   programs that MUST raise a named `ol-*` code, quoted in the prose beneath them. These are the
   most valuable blocks in the corpus to check, because the expected diagnostic can be *asserted*.

The constraint: **`spec/` is maintainer-owned** (AGENTS.md). A gate may not annotate the documents
it checks, so the in-band solution every doc-test system reaches for — a marker in the info string,
an HTML comment, a header — is unavailable. `scripts/examples-profiles.json` already faced the same
constraint and answered it the same way.

## Decision

**Extend `npm run examples` rather than adding a ninth Definition-of-Done script.**
`package.json`'s `examples` runs `scripts/check-examples.mjs && node
scripts/check-markdown-examples.mjs`. The DoD sentence is one item; `ci.yml`'s `test` job already
runs `npm run -s examples`, so no workflow change is needed and the gate blocks merge immediately. A
ninth script would have forced a `ci.yml` edit for no gain.

**One uniform rule, with no automatic tolerance.** Every ` ```logo ` block in `spec/**.md` and
`docs/**.md` is parsed, statically checked (`check()` with the full profile set), and executed under
a fixed instruction budget. It must either produce **no** error-severity diagnostic, or carry an
entry in `scripts/markdown-examples-expectations.json` declaring exactly what it produces.

We *did* first build the tolerant version — auto-excusing `ol-undefined-var`/`ol-unknown-command` as
"this is an excerpt" — and rejected it in review. `forwad 100` and `forward :szie` are
**indistinguishable by diagnostic code** from a legitimate excerpt calling a procedure defined in the
prose, so that tolerance silently swallowed precisely the typo class the gate exists to catch. The
cost of the strict rule is ~90 manifest entries; the benefit is that each is an assertion instead of
a mute button.

**Expectations live out of tree, keyed by content fingerprint.** The manifest maps a POSIX file path
to entries pinned by the first 16 hex digits of the SHA-256 of the block's source. Prose edits above
a block therefore never churn the manifest, while editing the block itself changes its fingerprint
and **forces a re-triage**. Each entry carries a closed `kind` (`prose-fragment`,
`deliberate-error`, `not-openlogo`, `non-terminating`, `profile-not-implemented`, `known-broken`), a
mandatory `why` stating only what is verifiable about the block, and the field its kind asserts —
`codes` (validated against `@openlogo/core`'s `ol-*` registry, not merely its shape) or `profiles`.
An entry may also carry a `setup` preamble (see Consequences) and an `issue`; `known-broken` requires
one, and is announced on every run.

**Everything is asserted in both directions.** The gate fails when a listed block stops producing
its declared codes, when it becomes clean (a stale expectation), when a fingerprint matches no block
— or matches two, so one entry can never excuse a copied block.

**Prove it goes red.** Re-introducing `set_shape "bee"` locally turns the gate red at
`spec/turtles-and-sprites.md:122`; that case, and every other way the gate is meant to fail, is
locked in as a self-test in `scripts/check-markdown-examples.test.mjs` — the discipline
`tests/conformance/_harness-selftest/` already established with fixtures that declare
`expect: "mismatch"`.

## Consequences

**A hand-rolled fence extractor, with a loud guard instead of a CommonMark dependency.** The
extractor implements the fence rules this corpus uses (backtick/tilde families, fence length,
indentation stripping, info string) and **refuses** the ones it does not — a fence in a blockquote,
a fence sharing its line with a list marker, or a fence indented four or more columns — reporting
each as a failure rather than guessing where the block starts. None occur in `spec/` or `docs/`
today. Pulling in a CommonMark parser would add a runtime dependency to a repository whose toolchain
is deliberately minimal (ADR-0005) for constructs nothing uses; if the corpus ever needs them, the
guard fails loudly and this decision can be revisited with a new ADR.

**Execution stops at a block's first runtime error.** Parsing and static checking always cover the
whole block, so a misspelled command, undefined variable, bad arity, or syntax error is caught
wherever it sits. But the lines *below* a block's first runtime error would never execute, so a
runtime-only defect down there (`ol-type`, `ol-range`, `ol-unknown-key`, `ol-unknown-field`) would
not be observed. Two things address this. An entry may carry a **`setup` preamble** — faithful
context drawn from the surrounding prose, prepended before the block runs — which lets an excerpt
execute to completion and assert a clean result instead of halting on line one; `inputs` does the
same for a blocking `input`, scripting the answer the learner would have typed. Most excerpts are
handled that way. A preamble must parse, check, *and* execute cleanly **on its own**, must not
define a name the block also defines, and must not redefine anything OpenLogo provides — every
profile's primitives *and* every Heritage surface spelling — at any depth. So it can only supply
context: never absorb a block's malformed structure, never lean on the block it is supporting, never
shadow away a real defect. Where context is impossible — a block whose whole point is the error it
stops on — the limit is **surfaced rather than claimed away**: the block is reported as `PARTIAL`,
with its own count in the summary line. Today that is exactly one block,
`spec/data-structures.md`'s `ol-unknown-key` demo, whose halt *is* the lesson and whose corrected
`# ok:` example therefore never executes; splitting it is a `spec/` edit, tracked on #888. A green
run does not mean every line of every block executed, and the gate says so.

Deliberately, no count in this record is a number you have to keep in sync: the gate prints the live
totals — clean, asserted, known-broken, partial, failed — on every run, and a hand-maintained tally
in an immutable document goes stale the first time someone adds an entry.

Measuring that honestly needs a program counter, not a span: a diagnostic points at the construct
that raised, not at where execution stopped, so a multi-line final statement raising on its own head
line has still run everything there was to run. The gate compares the halt against the **last
top-level statement's** start line, which is why a `forever` demo and a `map` whose body did run are
correctly *not* reported as partial. That granularity is the measure's known limit, stated rather
than hidden: a halt *inside* the final statement — `if :done [ print "x" ]` stopping on the
condition — is not reported, because nothing after that statement was skipped. The remedy for such a
block is a `setup`, not a wider measure.

**Unlabelled fences are invisible by construction**, so the convention "OpenLogo source in prose is
fenced ` ```logo `" is now recorded in AGENTS.md, the Definition-of-Done skill, and the Epic Gate.
Eight programs already hiding in bare fences under `docs/learn-how-its-built/` were relabelled when
the gate landed.

**Blocks needing an unimplemented profile are recorded, not silently skipped.** Modules,
Localization, Educational, and Tutor (AI) have no implementation yet, so their spellings are not in
the grammar. Such a block gets a `profile-not-implemented` entry that asserts the exact profile set —
so a block that quietly starts needing a different profile, or stops needing one, fails.

**The manifest is a maintenance surface**, and deliberately so: touching a listed block re-triages
it. The failure message prints the exact JSON entry to paste, but the gate never writes the manifest
itself — an auto-updating golden file would rubber-stamp the regression it exists to catch.

**Recorded defects are routed, not excused.** Turning the gate on surfaced eight documentation
defects, all tracked rather than fixed in this PR: two comma-separated list literals in
`docs/design-notes/0006` (#887, `known-broken`), five fences labelled ` ```logo ` that hold EBNF or a
word list (#888, `not-openlogo`), and `spec/data-structures.md`'s unreachable corrected example
(#888). When each is fixed its entry is **deleted**, not re-fingerprinted — an `ebnf` fence is
simply skipped by the gate rather than carved out of it — so the manifest shrinks toward holding
only genuinely-exceptional blocks.

**Runtime cost is about two seconds, not the twenty the wall clock suggests.** The 300-plus-block
corpus costs ≈2 s (the `spec/examples/*.logo` half ≈1 s). `npm run examples` measures ≈20 s
end-to-end on Windows/Node 26 because `preexamples` rebuilds the workspace first; in CI's `test`
job that build is already paid for by `pretest`, so the **marginal** cost of this gate is ≈2 s.

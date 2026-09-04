# The third fault class: registered, but unevaluable

Saga #811 is about statements that run silently. Issue #816 characterized **two** fault shapes;
this directory holds the **third**, added by issue #1087 and repaired by issue #815.

| class | example | registered? | evaluable? | `check()` | `execute()` |
| --- | --- | --- | --- | --- | --- |
| shape A — unresolvable name | `print (wibble 2)` | no | — | `ol-unknown-command` | `ol-unknown-command` |
| shape B — command in value position | `wait forward 5` | yes | yes (fault is positional) | `ol-no-output` | `ol-no-output` |
| **third — registered but unevaluable** | **`challenge`** | **yes** | **no** | clean | `ol-not-implemented` |

The third row's answers hold **for a run that claims Tutor (AI)**, and that qualifier is normative
rather than incidental: [`spec/error-model.md:131`](../../../../spec/error-model.md) says "a call
under a profile the run does not claim is still `ol-unknown-command`, because there the name does
not resolve". `SUPPORTED_PROFILES` does not list `tutor-ai`, so a default run of `challenge` still
reports `ol-unknown-command` — correctly — and the three fixtures here name the set explicitly via
`executeOptions.profiles`. That same row also makes the distinction load-bearing in the other
direction: emitting `ol-not-implemented` "for a primitive of a profile the implementation **claims**
is a conformance failure of that profile", which is why this is a defensible state for `challenge`
and would not be for `forward`.

`challenge` is registered by `@openlogo/parser`'s Tutor primitive table, and its canonical signature
is **normative** in [`spec/conformance.md:239-244`](../../../../spec/conformance.md) — not in
[`spec/ai-tutor.md`](../../../../spec/ai-tutor.md), which describes `challenge` at length but is
marked `Status: Informative` (`spec/conformance.md:236` says so outright). `@openlogo/runtime` has no
evaluator for it.

## What was wrong, and why this directory still records it

**The third class used to be classified identically to shape A**, and that is the fact worth
preserving: `challenge` and `print (wibble 2)` produced the same diagnostic **code**, at the same
**stage**, with the same **severity**, and both then executed silently emitting only their statement
marker. They were never identical in every byte — the `params`, the message and the source spans all
differ, because the two programs name different words at different offsets. What a learner could not
tell apart was the two **fault classes**: nothing distinguished *"this name does not exist"* from
*"this name exists and we withheld it"*. The implementation reported the learner's typo for its own
omission.

Measured at the time, the harm was sharper than "indistinguishable". Both diagnostics carried the
same advice —

```text
i don't know how to challenge. check the spelling, or define it with 'define'.
i don't know how to wibble. check the spelling, or define it with 'define'.
```

— and for `challenge` **neither remediation it offered could resolve the problem**: the spelling was
already correct, so checking it changed nothing, and the other option is forbidden —
`define challenge` reports `ol-reserved-word`, at check and at run time. The learner was handed two
suggestions, one useless and one prohibited, for a fault that was not theirs.

That identity was the strongest available argument for the `ol-not-implemented` code the #814 ruling
introduced. The ruling made the old behaviour an explicit violation rather than merely an unfortunate
one: [`spec/tooling.md:194`](../../../../spec/tooling.md) says an implementation "MUST NOT reach for
`ol-unknown-command` instead — including by withholding the name from the visible vocabulary so the
call reads as unknown", which was verbatim the mechanism `packages/parser/src/checker-names.ts` used.
Issue #815 deleted it. **The fix destroys the evidence** — after it, `challenge` stops reporting
`ol-unknown-command` while `wibble` keeps it, and nothing would otherwise record that they were ever
the same — which is why the relation is asserted rather than dropped.

It lives in `indistinguishable-from-unknown.test.mjs` rather than in an `.expected.json`, because a
conformance fixture pairs **one** source with **one** expected stream and this is a **relation
between two sources** — the same reason `scripts/examples-semantic-sweep.test.mjs` is a test. The
per-source behaviour is pinned by the fixtures.

## What #815 changed here, and what it left alone

Read each file's opening line; the directory is not uniform.

| file | kind | outcome |
| --- | --- | --- |
| `challenge-check` | `REGRESSION WALL` (was `CHARACTERIZATION FIXTURE`) | **flipped** — the `ol-unknown-command` is gone and the expectation is an **empty** diagnostics list. Read the modality before reading a requirement into that: `ol-not-implemented`'s stage **MAY** be `semantic` when the implementation knows before running that no evaluation exists and **MUST** be `runtime` otherwise, and `spec/tooling.md:194` correspondingly lets the checker report it *"only when"* it knows — a necessary condition, not a mandate. This implementation declines the MAY, because whether an evaluation exists is a fact about `@openlogo/runtime` that `@openlogo/parser` must not depend on. An implementation reporting a semantic `ol-not-implemented` here is equally conformant. |
| `challenge-execute` | `REGRESSION WALL` (was `CHARACTERIZATION FIXTURE`) | **flipped** — running it reports `ol-not-implemented` at `runtime` instead of being silent |
| `challenge-with-argument` | `NO-REGRESSION` | **unchanged**, byte-for-byte in `events` and `diagnostics`; it gained only the `executeOptions.profiles` that makes the run claim what the fixture's `profiles` already declared |
| `indistinguishable-from-unknown.test.mjs` | relation assertion | **inverted, not deleted** — the equality became a disequality, which is how the fix proves it worked |

`challenge-with-argument` is the one to be careful with. Its `ol-bad-token` is **not** a symptom of
the missing evaluator: [`spec/conformance.md:239-244`](../../../../spec/conformance.md) makes
`challenge`'s canonical signature normative and its arity table row gives `| challenge | Command | 0 |
none (tutor output) |`, so arity 0 is the contract and an excess input is a genuine error whatever
#815 did. It is also the bound on #815's new precedence rule, which suppresses a token whose only
fault is following a callee **nothing resolves**: `challenge` resolves under a claiming run, so its
stray argument survives — as `forward 100 200`'s does. Drop the `executeOptions.profiles` and the
same program reports `ol-unknown-command` instead, which is correct for a run that does not claim
Tutor (AI).

## Provenance

Every expectation here was generated from a real `parse()` / `check()` / `execute()` run rather than
hand-written, and each `.expected.json` was then perturbed — a fixture asserting no diagnostic given
one, a fixture asserting one having it removed — and `node scripts/conformance.mjs` confirmed to
report `FAIL` for that fixture before the file was restored. The test file was verified the same way,
by mutation rather than by inspection. **Both were re-perturbed after #815 flipped them**, because a
flipped fixture is a new assertion and inherits none of the original's evidence — and "flipped but no
longer biting" is the worse failure, being indistinguishable from a healthy pass.

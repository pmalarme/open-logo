# The third fault class: registered, but unevaluable

Saga #811 is about statements that run silently. PR #1081 characterizes **two** fault shapes; this
directory holds the **third**, added by issue #1087.

| class | example | registered? | evaluable? | `check()` today | `execute()` today |
| --- | --- | --- | --- | --- | --- |
| shape A — unresolvable name | `print (wibble 2)` | no | — | `ol-unknown-command` | silent |
| shape B — command in value position | `wait forward 5` | yes | yes (fault is positional) | clean | silent |
| **third — registered but unevaluable** | **`challenge`** | **yes** | **no** | `ol-unknown-command` | silent |

`challenge` is registered by `@openlogo/parser`'s Tutor primitive table, and its canonical signature
is **normative** in [`spec/conformance.md:239-244`](../../../../spec/conformance.md) — not in
[`spec/ai-tutor.md`](../../../../spec/ai-tutor.md), which describes `challenge` at length but is
marked `Status: Informative` (`spec/conformance.md:236` says so outright). `@openlogo/runtime` has no
evaluator for it, so `packages/parser/src/checker-names.ts` deliberately withholds the name (its
reasoning is recorded there, and it is a considered choice rather than an oversight: making the name
visible would let `challenge` check clean and then silently do nothing, which is the worse failure).

## Why this directory exists, and why now

**The third class is classified identically to shape A**, and that is the fact worth preserving:
`challenge` and `print (wibble 2)` produce the same diagnostic **code**, at the same **stage**, with
the same **severity**, and both then execute silently emitting only their statement marker. They are
not identical in every byte — the `params`, the message and the source spans all differ, because the
two programs name different words at different offsets, and a learner can of course see that one
message says `challenge` and the other says `wibble`. What a learner cannot tell apart is the two
**fault classes**: nothing distinguishes *"this name does not exist"* from *"this name exists and we
withheld it"*. The implementation reports the learner's typo for its own omission.

Measured, the harm is sharper than "indistinguishable". Both diagnostics carry the same advice —

```text
i don't know how to challenge. check the spelling, or define it with 'define'.
i don't know how to wibble. check the spelling, or define it with 'define'.
```

— and for `challenge` **neither remediation it offers can resolve the problem**: the spelling is
already correct, so checking it changes nothing, and the other option is forbidden —
`define challenge` reports `ol-reserved-word`, at check and at run time. The learner is handed two
suggestions, one useless and one prohibited, for a fault that is not theirs.

That identity is the strongest available argument for the `ol-not-implemented` code the #814 ruling
introduces, and **the fix destroys it**: once #815 lands, `challenge` stops reporting
`ol-unknown-command` while `wibble` keeps it, and nothing would otherwise record that they were ever
the same. A fixture written after the fix can only assert the fix; it proves nothing about what was
wrong. That is the ordering issue #816 exists to enforce, applied one class further out.

The equality itself lives in `indistinguishable-from-unknown.test.mjs` rather than in an
`.expected.json`, because a conformance fixture pairs **one** source with **one** expected stream and
this is a **relation between two sources** — the same reason `scripts/examples-semantic-sweep.test.mjs`
is a test. The per-source behaviour is pinned by the fixtures.

## What flips when #815 lands, and what must not

Read each file's opening line; the directory is not uniform.

| file | kind | after the fix |
| --- | --- | --- |
| `challenge-check` | `CHARACTERIZATION FIXTURE` | **flips** — the `ol-unknown-command` must disappear. What replaces it is **not** settled here: depending on how #815 routes the fix, `check()` may report `ol-not-implemented` at `semantic`, or may simply go **clean** with the diagnostic raised at run time instead. Measured: removing the withholding makes `check()` clean, not `ol-not-implemented`. |
| `challenge-execute` | `CHARACTERIZATION FIXTURE` | **flips** — running it must stop being silent |
| `challenge-with-argument` | `NO-REGRESSION` | **unchanged** |
| `indistinguishable-from-unknown.test.mjs` | identity assertion | **inverted, not deleted** — the equality becomes a disequality, which is how the fix proves it worked |

`challenge-with-argument` is the one to be careful with. Its `ol-bad-token` is **not** a symptom of
the missing evaluator: [`spec/conformance.md:239-244`](../../../../spec/conformance.md) makes
`challenge`'s canonical signature normative and its arity table row gives `| challenge | Command | 0 |
none (tutor output) |`, so arity 0 is the contract and an excess input is a genuine error whatever
#815 does. The arity path and the missing-evaluator path are independent, and #815 must make bare
`challenge` stop being silent **without** disturbing this one.

## Provenance

Every expectation here was generated from a real `parse()` / `check()` / `execute()` run rather than
hand-written, and each `.expected.json` was then perturbed — a fixture asserting no diagnostic given
one, a fixture asserting one having it removed — and `node scripts/conformance.mjs` confirmed to
report `FAIL` for that fixture before the file was restored. The test file was verified the same way,
by mutation rather than by inspection.

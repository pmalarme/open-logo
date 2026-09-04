# The third fault class: registered, but unevaluable

Saga #811 is about statements that run silently. PR #1081 characterizes **two** fault shapes; this
directory holds the **third**, added by issue #1087.

| class | example | registered? | evaluable? | `check()` today | `execute()` today |
| --- | --- | --- | --- | --- | --- |
| shape A — unresolvable name | `print (wibble 2)` | no | — | `ol-unknown-command` | silent |
| shape B — command in value position | `wait forward 5` | yes | yes (fault is positional) | clean | silent |
| **third — registered but unevaluable** | **`challenge`** | **yes** | **no** | `ol-unknown-command` | silent |

`challenge` is defined normatively by [`spec/ai-tutor.md`](../../../../spec/ai-tutor.md) and
registered by `@openlogo/parser`'s Tutor primitive table, but `@openlogo/runtime` has no evaluator
for it, so `packages/parser/src/checker-names.ts` deliberately withholds the name (its reasoning is
recorded there, and it is a considered choice rather than an oversight: making the name visible would
let `challenge` check clean and then silently do nothing, which is the worse failure).

## Why this directory exists, and why now

**The third class is observationally identical to shape A**, and that is the fact worth preserving:
`challenge` and `print (wibble 2)` produce the same diagnostic code, at the same stage, with the same
severity, and both then execute silently emitting only their statement marker. So the corpus cannot
currently distinguish *"this name does not exist"* from *"this name exists and we withheld it"* — the
implementation reports the learner's typo for its own omission.

That identity is the strongest available argument for the `ol-not-implemented` code the #814 ruling
introduces, and **the fix destroys it**: once #815 lands, `challenge` reports `ol-not-implemented`
while `wibble` keeps `ol-unknown-command`, and nothing would otherwise record that they were ever the
same. A fixture written after the fix can only assert the fix; it proves nothing about what was
wrong. That is the ordering issue #816 exists to enforce, applied one class further out.

The equality itself lives in `indistinguishable-from-unknown.test.mjs` rather than in an
`.expected.json`, because a conformance fixture pairs **one** source with **one** expected stream and
this is a **relation between two sources** — the same reason `scripts/examples-semantic-sweep.test.mjs`
is a test. The per-source behaviour is pinned by the fixtures.

## What flips when #815 lands, and what must not

Read each file's opening line; the directory is not uniform.

| file | kind | after the fix |
| --- | --- | --- |
| `challenge-check` | `CHARACTERIZATION FIXTURE` | **flips** — the diagnostic becomes `ol-not-implemented` |
| `challenge-execute` | `CHARACTERIZATION FIXTURE` | **flips** — running it must stop being silent |
| `challenge-with-argument` | `NO-REGRESSION` | **unchanged** |
| `indistinguishable-from-unknown.test.mjs` | identity assertion | **inverted, not deleted** — the equality becomes a disequality, which is how the fix proves it worked |

`challenge-with-argument` is the one to be careful with. Its `ol-bad-token` is **not** a symptom of
the missing evaluator: [`spec/ai-tutor.md:173`](../../../../spec/ai-tutor.md) fixes the canonical
signature as "a Command invoked as the bare word `challenge` with no inputs", so arity 0 is the
contract and an excess input is a genuine error whatever #815 does. The arity path and the
missing-evaluator path are independent, and #815 must make bare `challenge` report
`ol-not-implemented` **without** disturbing this one.

## Provenance

Every expectation here was generated from a real `parse()` / `check()` / `execute()` run rather than
hand-written, and each `.expected.json` was then perturbed — a fixture asserting no diagnostic given
one, a fixture asserting one having it removed — and `node scripts/conformance.mjs` confirmed to
report `FAIL` for that fixture before the file was restored. The test file was verified the same way,
by mutation rather than by inspection.

# 6. Effect-event snapshot timing is emission-time, not evaluation-time

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + team

## Context

`print`, `show`, `return`, and `procedure-exit` are all **effect events** in OpenLogo's normative
trace/event stream: each carries a `payload` describing the value(s) it emits. Because OpenLogo's
`list`, `dict`, and `record` values are mutable reference values that can be shared and aliased
(`spec/execution-model.md`, "Trace and event registry"), a question arises whenever a single
instruction observes more than one value and at least one of those values is a shared, mutable
reference that another part of the same instruction can mutate before the instruction finishes:

```logo
:l = [1]
define mutate
  add 2 to :l
  return 0
end
(print :l mutate)
```

`(print :l mutate)` has two arguments: the variable `:l` (a list) and a call to `mutate`, which
mutates that same list as a side effect and then returns `0`. Both arguments must be evaluated,
left to right, before the `print` effect event's payload can be assembled — but *when*, relative to
that evaluation, is each argument's contribution to the payload actually captured? Two answers are
possible, and they disagree on this exact example:

- **Emission-time:** evaluate every argument first (running every side effect, in order), then take
  one snapshot of the whole assembled payload immediately before the event is emitted. Every value
  in the payload reflects program state as of that single instant — after `mutate` has already run.
  Result: `[1, 2] 0`.
- **Evaluation-time:** freeze each argument's contribution to the payload the instant that argument
  is individually evaluated, before any later sibling argument runs. `:l` would be captured as
  `[1]`, before `mutate`'s `add 2 to :l` has had a chance to run. Result: `[1] 0`.

This is a genuine design fork, not an implementation detail: a maintainer reviewing the behavior
found the emission-time result "both values reflect state *after* `mutate` ran" surprising and hard
to explain to a learner, and asked whether some other language instead does the more
locally-predictable, evaluation-time thing. The question was raised, discussed, and settled as a
dedicated design-decision review (see issue #543 for the full write-up); this LDR records that
decision and its rationale. It does not describe a spec change: `spec/execution-model.md`'s
snapshot-timing rule already specifies emission-time capture, unambiguously, before this question
was raised — what was in question, and is now resolved, is whether that existing text was the right
call, not what it says.

## Decision

OpenLogo's effect-event payloads use **emission-time snapshot semantics**. When an instruction
produces more than one value for a single effect event's payload (for example, `print`'s multiple
arguments), every argument is evaluated first, left to right, running every side effect each
argument's evaluation causes — and only once every argument has finished evaluating does the
runtime take a single, whole-payload, point-in-time snapshot, immediately before the event is
emitted. The snapshot is never taken per-argument, immediately after that argument alone finishes
evaluating.

Concretely, for:

```logo
:l = [1]
define mutate
  add 2 to :l
  return 0
end
(print :l mutate)
```

the `print` event's payload is `{values: [[1, 2], 0]}` — `:l`'s snapshotted value reflects the
mutation `mutate` performed, because the whole statement's evaluation (both arguments, including
`mutate`'s side effect) completes before the single snapshot for the whole payload is taken. The
statement never produces `{values: [[1], 0]}`.

This is not a new rule invented for this decision: it restates, precisely, the snapshot-timing
paragraph already normative in `spec/execution-model.md`'s "Trace and event registry" section — "An
effect event's `payload` captures the value or values it describes as a point-in-time snapshot
taken at the moment of emission, not a live reference to mutable state" — applied to the
multi-argument case. The snapshot itself remains a transitive, immutable copy of the value graph
(preserving aliasing and cycles via snapshot-local reference identity), exactly as that section
specifies; this decision is about *when*, relative to evaluating a multi-argument instruction, that
one snapshot instant occurs — at emission, after all arguments (and their side effects) have run.

## Rationale

Emission-time was chosen over evaluation-time for five compounding reasons:

1. **The spec text was already unambiguous.** "A point-in-time snapshot" (singular) "taken at the
   moment of emission" describes exactly one capture instant, after the instruction's full
   evaluation — it does not describe capturing each argument independently, frozen the instant it
   is individually evaluated. Re-deriving the semantics from scratch was not necessary; confirming
   the existing wording and closing a runtime bug that contradicted it was the actual task.
2. **Emission-time is the natural consequence of OpenLogo's existing data model, not a new
   exception to it.** OpenLogo already chose mutable, aliasable reference values for `list`, `dict`,
   and `record` (the same section explicitly allows a self-referential list via `add :l to :l`).
   Given that choice, a trace event recorded at a given instant should show the true, shared state
   as of that instant — which is exactly what emission-time snapshotting does. Evaluation-time
   freezing would instead require a value's *observed* contents to sometimes lag behind its *actual*
   contents at the moment the trace is written, for no reason connected to the value's own
   mutability — a second, inconsistent capture rule layered on top of the first.
3. **The triggering scenario is an advanced edge case, not an early-curriculum concern.** A
   side-effecting procedure call sharing a mutable variable with a sibling argument in the same
   multi-argument statement is not a pattern early lessons construct — shapes, `repeat`, and
   procedures are taught well before intentionally aliased mutation across an argument list. The
   pedagogical stakes of this specific ordering surprise are low, and it remains explainable via
   `why`/`debug` once a learner does encounter it, because the snapshot rule keeps every prior
   event's payload immutable and inspectable.
4. **KISS: evaluation-time would add conceptual surface, not remove it.** OpenLogo is already a
   reference-semantics language for its mutable collection types. Carving out one special case where
   arguments to a single statement are captured on a per-argument timeline, different from the
   whole-statement timeline used everywhere else in the trace/event model, is a second rule a
   learner (and every future contributor) would need to hold in mind, not a simplification.
   Emission-time keeps exactly one snapshot rule for the entire trace/event stream.
5. **The decision was reached only after a dedicated, rubber-duck-reviewed design pass** (issue
   #543), which considered the evaluation-time alternative seriously — including the pedagogical
   argument for it — before rejecting it for the reasons above. The rejected alternative and its
   trade-offs are recorded in full in that issue and summarized in "How other languages do it" below.

## How other languages do it

| Language family | What happens with a shared mutable value across sibling arguments | Relationship to OpenLogo's decision |
|---|---|---|
| Python | `print(l, mutate())` evaluates every argument (running every side effect) before `print` produces any output; if `mutate()` mutates `l`, the printed value reflects the mutation. Verified directly: `print(l, mutate())` prints `[1, 2] 0`. | Same family: reference semantics, emission/output reflects state after all arguments (and their side effects) finish evaluating. |
| JavaScript (Node) | `console.log(l, mutate())` behaves identically for the same reason — arrays are shared references, and every argument expression, including any mutation, runs before `console.log` is invoked. Verified directly: `console.log(l, mutate())` prints `[1, 2] 0`. | Same family as OpenLogo and Python. |
| Go | Slices alias their backing array the same way, so a function that mutates a shared slice's elements in place is visible to a sibling expression evaluated afterward — with the caveat that an `append` which triggers reallocation detaches the mutated slice from the original backing array, so that particular mutation would *not* be visible through the original variable. | Same family in the common case; the `append`-reallocation caveat is a Go-specific wrinkle in *how* aliasing is preserved, not a different timing model. |
| Rust | This exact aliasing pattern is normally rejected at compile time by the borrow checker: you cannot hold a shared reference to `l` for printing while also holding a mutable reference for `mutate` to write through, in the same expression. Reaching the OpenLogo scenario at all requires opting in explicitly via `Rc<RefCell<...>>`. | Rust does not reject emission-time timing; it rejects the *aliasing precondition* by default, making the "surprising" case require deliberate effort rather than happening by accident. |
| Swift | Arrays and dictionaries passed as ordinary parameters use copy-on-write value semantics: a callee cannot mutate the caller's original collection unless the parameter is `inout` or the value is captured by a closure. | The aliasing precondition mostly does not arise by default, similar in spirit to Rust, via a different mechanism (value semantics rather than ownership). |
| Haskell, Elm, Clojure, Erlang | Immutable-by-default: there is no in-place mutation to observe, so this scenario cannot be constructed at all — `mutate` could not mutate `:l`'s equivalent; it could only return a new value. | Structurally sidesteps the question rather than choosing a timing model; not applicable to a language, like OpenLogo, that has already chosen mutable reference collections. |
| Classic Logo | Predominantly built around immutable list operations (`first`, `butfirst`, `fput`); true in-place mutation (`.setfirst`, `setitem`) exists but is a rarely taught, advanced corner. | Also mostly sidesteps the question; OpenLogo's Data profile deliberately embraces first-class mutable collections instead, so the question is live for OpenLogo in a way it barely is for classic Logo. |

Python, JavaScript, and Go's common case are the closest precedent, and OpenLogo's decision matches
them precisely, for the same underlying reason: once a language chooses shared, mutable reference
collections, "evaluate everything (including side effects), then observe/print/emit" is the timing
that keeps observed state consistent with actual state. Languages that avoid the surprise do so by
avoiding the *precondition* (no mutation at all, or no aliasing by default) rather than by adopting
a different snapshot-timing rule on top of aliasable mutation — which is exactly the "novel,
inconsistent carve-out" OpenLogo chose not to introduce (Rationale, point 4).

## Consequences

- **One snapshot rule for the entire trace/event stream, with no per-construct exception.** Every
  effect event's payload — whether it carries one value or several — is captured at exactly one
  instant: immediately before that event is emitted, after every argument of the triggering
  instruction (and every side effect that evaluating those arguments causes) has already run. A
  contributor implementing a new effect event never has to ask "does this one snapshot
  per-argument or per-statement?" — the answer is always per-statement, at emission.
- **A later argument's side effect can change how an earlier argument's snapshotted value reads**,
  when both arguments are evaluated as part of the same instruction and share a mutable reference.
  This is a deliberately accepted, low-stakes pedagogical trade-off (Rationale, point 3): the
  scenario requires a learner to have already reached mutable, aliased collections and deliberately
  combine a mutating call with a shared variable in one statement, and remains fully inspectable
  after the fact via `why`/`debug`, because the snapshot rule guarantees every already-emitted
  event's payload stays immutable regardless of what runs afterward.
- **Once emitted, an event's payload is permanently trustworthy for replay, stepping, and
  tutoring.** Because the snapshot is taken once, at emission, and is a transitive immutable copy,
  no later mutation — through the original live reference, at any depth — can retroactively change
  a payload already recorded. This is what makes deterministic replay and `why`/`debug` inspection
  of prior events well-defined even though the underlying values are ordinarily mutable, aliasable,
  and possibly self-referential.
- **This decision forecloses adding a per-argument capture mode later as a silent behavior change.**
  Any future proposal to freeze arguments individually, rather than the whole payload at emission,
  would be a genuine semantic change to already-Accepted spec text and would need its own superseding
  LDR, not a quiet runtime adjustment — exactly the trail this record exists to leave.
- Normative source: `spec/execution-model.md` — "Trace and event registry" — the effect-event
  snapshot-timing paragraph ("a point-in-time snapshot taken at the moment of emission") and the
  transitive/aliasing/cycle-preservation rules that accompany it.

## Spec references

- `spec/execution-model.md` — [Trace and event registry](../../spec/execution-model.md#trace-and-event-registry):
  the effect-event snapshot-timing rule ("a point-in-time snapshot taken at the moment of emission,
  not a live reference to mutable state"), the transitive-copy requirement for lists/dicts/records,
  and the snapshot-local reference identity rule that preserves aliasing and cycles across a single
  capture — the exact text this decision confirms and applies to the multi-argument case.

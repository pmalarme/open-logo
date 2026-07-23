# 4. No lambda or first-class procedure values in v0.1

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + team

## Context

Higher-order data transformation is a genuine, useful idea: given a list, transform each item, keep
some of them, or combine them into one value. Most languages expose this power through an anonymous
function value — a lambda — that a caller builds on the fly and hands to `map`/`filter`/`reduce` as
an argument (`nums.map(n => n * 2)` in JavaScript, `map(lambda n: n * 2, nums)` in Python). That
design requires a learner to first understand that a procedure is itself a value: something that can
be created without a name, passed as an argument, stored in a variable, and invoked later, possibly
capturing variables from its defining scope (a closure). OpenLogo's [`spec/grammar.md`](../../spec/grammar.md)
gives `map`, `filter`, and `reduce` a different shape. The grammar's `comprehension` production
(**Expressions and calls**, `spec/grammar.md`) defines `map-expression`, `filter-expression`, and
`reduce-expression` each as `binder "in" expression expression-block` (or, for `reduce`, with an
extra accumulator name and `"from" expression`) — the transformation is written as a plain expression
in a bracketed body next to the loop it belongs to, not built, named, or passed separately. The
**Collections, records, and comprehensions** section is explicit that "Core comprehension forms are
special forms, not function-valued higher-order calls" (`spec/grammar.md`), and **Blocks and bracket
roles** states as a grammar-level rule that "Comprehension bodies for `map`, `filter`, and `reduce`
are bracketed expression blocks only" (`spec/grammar.md`). `spec/conformance.md`'s **Core Language**
profile section says the same thing as a conformance requirement: Core comprehensions come "with
bracketed expression bodies and no lambda or first-class procedure values" (`spec/conformance.md`),
and the **Feature to profile table** repeats it: "No lambda; bracketed expression body"
(`spec/conformance.md`) next to its row for values: "No arrays, no null, no procedure values."
(`spec/conformance.md`). `spec/grammar.md` has no syntax anywhere for building an unnamed procedure
value, storing a `define`d procedure in a variable, or passing one as a call argument — `define …
end` only ever creates a name bound in the procedure namespace, and `spec/conformance.md`'s Core
Language value list confirms procedures are not among Core's values, so a procedure name is never a
value.

## Decision

OpenLogo v0.1's Core Language has **no anonymous function/lambda syntax**, **no first-class
procedure values** (a procedure name cannot be read as a value, stored in a variable, or passed as an
argument), and **no closures-as-values**. `map`, `filter`, and `reduce` are Core **special forms**:
each takes a binder, a source expression, and a bracketed **expression body** evaluated once per
item with the binder (and, for `reduce`, the accumulator) bound in that body's scope. The body is
never a `... end` long block, never a stand-alone value referring to a procedure, and the comprehension
keyword itself — not a passed-in function — decides the operation (transform, keep, or fold).
`define … end` still creates named, callable procedures, but only as call targets, never as
values.

## Rationale

OpenLogo's [`spec/educational-model.md`](../../spec/educational-model.md) sequences ideas across
eight learner levels so that no lesson requires an idea the learner hasn't met yet. Comprehensions
are deliberately the very last concept in that sequence, Level 8b, introduced only after the learner
already has variables (Level 3), conditions (Level 4), procedures (Level 5), and recursion
(Level 8a) — and even there, the spec restates the constraint directly: "Comprehensions transform,
choose, or combine data **without introducing lambdas or first-class procedure values**"
(`spec/educational-model.md`, Level 8b). Treating a procedure as a value that can be created
anonymously, stored, and passed around is its own separate conceptual leap — one more commonly
associated with a university-level "functions as values" unit — and is unrelated to what a learner
is actually trying to do at Level 8b: transform a list. A bracketed expression body gives nearly all
of the practical power (`map num in :nums [ :num * 2 ]` reads like "for each num in nums, keep num
times two") while keeping every other rule the learner already knows unchanged: `:name` still reads a
variable, `[ ]` is still a body the learner has seen since `repeat`, and there is no new value kind,
no new scoping rule for captured variables, and no new call syntax to learn. This keeps the language
consistent with OpenLogo's broader **KISS** principle (`.github/instructions/openlogo-team.instructions.md`,
§11): ship the simplest form that satisfies the spec's goals, and defer a genuinely bigger idea
(functions as values) rather than bundling it into a lesson about list transformation.

## How other languages do it

- **Python** introduces `lambda` early and treats functions as first-class from the start —
  `map(lambda n: n * 2, nums)` or the more idiomatic list comprehension `[n * 2 for n in nums]` are
  both available to a beginner within their first weeks, alongside closures over enclosing scope.
- **JavaScript** goes further: arrow functions (`n => n * 2`) are near-omnipresent, and passing a
  function as a callback (to `Array.prototype.map`, event handlers, promises) is idiomatic from a
  learner's very first exercises — there is no gate before a beginner meets "a function is a value."
- **Scheme** (and Lisp generally) makes this the foundational idea: `lambda` is one of the first
  special forms taught, because in these languages procedures being ordinary values *is* the point of
  the language — higher-order functions are not a late addition but the substrate everything else is
  built on.
- **Classic Logo dialects (UCBLogo)** actually *do* have a first-class-procedure-like mechanism:
  `map`/`filter`/`reduce` (and `apply`/`run`) accept a **template** — a quoted procedure name passed
  as a word, or an anonymous list of instructions using `?` as a placeholder for the current item
  (`map [? * 2] :nums`). This is genuinely higher-order — the template is a value built separately
  from the loop and handed to it as an argument — inherited from Logo's Lisp ancestry. OpenLogo's
  bracketed comprehension body looks superficially similar (`map num in :nums [ :num * 2 ]`) but is
  not the same mechanism: the bracketed body is parsed as part of the `map` special form's own
  grammar, evaluated in place with the binder already bound, and is never a separately-built value
  that could be stored in a variable or passed to a different call — the resemblance is syntactic,
  not semantic.
- **Scratch**, an explicitly block-based educational language, takes the opposite path from Python/JS/
  Scheme and from UCBLogo's templates: there is no user-facing lambda or first-class procedure/block
  value in its language at all. Its iteration blocks (`repeat`, `repeat until`, `forever`) contain a
  fixed C-shaped substack of literal blocks — the same shape as OpenLogo's bracketed comprehension
  body — rather than accepting a block value built and passed in separately. OpenLogo's Core
  comprehensions sit with Scratch in this respect: the transformation is always written inline as
  part of the calling form, never built as an independent, passable value, the same simplification
  UCBLogo's templates (and Python/JS/Scheme generally) decline to make.

## Consequences

- Learners can already transform, filter, and combine data in v0.1 using `map`, `filter`, and
  `reduce` with bracketed expression bodies (`spec/grammar.md`, `spec/educational-model.md` Level 8b),
  and can factor out any named, reusable logic with `define … end` (Level 5) — the two mechanisms
  cover the overwhelming majority of what a beginner needs a lambda for, without exposing procedures
  as values.
- A learner cannot write `map "double :nums` (UCBLogo's template style) or pass a `define`d
  procedure's name as an argument to another call; every comprehension's operation is written inline,
  and every procedure call is a fixed, syntactically-known call, never a value computed and invoked
  indirectly.
- `spec/conformance.md`'s **Versioning** section confirms that "Minor or major versions MAY add,
  remove, or change profile requirements" — so first-class procedure values, if ever added, would
  need a deliberate future minor/major version and an explicit profile or Core change, proposed and
  reviewed the same way any other spec change is (`.github/instructions/openlogo-team.instructions.md`,
  §2). No such profile or version currently exists in `spec/conformance.md`'s required or optional
  profile list or its profile dependency DAG: this LDR records that the omission through v0.1 is
  deliberate, not an oversight, so a future proposal to add lambdas/first-class procedures should
  read this record and explicitly supersede it (per the LDR-0000 convention) rather than treating the
  gap as unintentional.
- The runtime, grammar, and curriculum stay simpler in the meantime: no closure-capture semantics to
  specify in `spec/execution-model.md`, no new value kind in `spec/grammar.md`'s value grammar, and
  no additional trace-event or diagnostic surface for procedure-value call sites.

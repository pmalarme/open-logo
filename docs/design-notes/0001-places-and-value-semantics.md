# 1. Places and value semantics — why `(point 0 0).z = 1` is `ol-not-a-place`

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + team

## Context

A learner or advanced user who has just declared a struct type reaches for the most natural-looking
syntax to tweak one field of a value they just built:

```logo
struct point [ x y ]
(point 0 0).z = 1
```

This raises `ol-not-a-place`, not `ol-unknown-field` — even though `point` has no `z` field, that
is not the error OpenLogo reports. The same rejection holds for a struct that *does* declare `z`:
`(point 0 0).x = 1` is equally `ol-not-a-place`, because the problem is not the field name, it is
what sits to the left of the field access. A constructor call — or any parenthesized expression —
produces a value, and OpenLogo's assignment grammar only ever targets a variable-rooted place, never
the result of a call. This is easy to miss coming from reference-semantics languages, where
`Point(0, 0).z = 1` at least parses (even if it silently does nothing useful), so it is worth
recording *why* OpenLogo closes the door earlier, at the grammar, rather than diagnosing it as a
missing-field problem at the value.

## Decision

OpenLogo's assignable-place grammar is **closed and variable-rooted**: every place production
ultimately starts at a `:name` (or, in the `set … to` spelling, the bare `name` that follows
`set`), with zero or more postfixes (`[key-term]` or `.identifier`) layered on top. There is no
production that lets a place start at a parenthesized expression, a call, or any other unbound
result — regardless of whether the value that expression produces is itself a plain number/word or
a mutable reference value such as a list, dict, record, or turtle (`spec/execution-model.md`,
"Lists, dicts, records, and turtles are mutable reference values"). This decision is about the
**assignment target**, not about the representation of the value it would have written: a fresh
`(point 0 0)` result is not yet bound to any name, so even though the record it produces is a
mutable reference value once bound (e.g. once assigned to `:p`), there is no binding at the call
site itself to route a write through.

`spec/grammar.md`'s ["Places, selectors, and keys"](../../spec/grammar.md#places-selectors-and-keys)
section states the grammar directly:

> The set of assignable places is closed and recursive. Only these forms are places: ... A colon
> place starts with `:` and a name. A bare place is the same syntax without `:` and appears only
> after `set` before `to`. Both may have any number of postfixes.

and the productions themselves (`spec/grammar.md`, EBNF block) fix the rule syntactically:

```ebnf
colon-place ::= ":" name { postfix }
bare-place  ::= name { postfix }
postfix     ::= selector | "." identifier
```

Both productions are anchored at `name`, never at `expression` or `call`. `(point 0 0)` is a
call/postfix-expression, so `(point 0 0).z` can be parsed as a *read* (a postfix expression), but it
can never be reduced to a `colon-place`/`bare-place` — there is no rewrite from "call result" to
"named binding." `spec/execution-model.md`'s
["Assignable places and mutation"](../../spec/execution-model.md#assignable-places-and-mutation)
section confirms the same closure from the runtime side and names the diagnostic:

> The assignable-place set is closed and recursive. ... Reporters such as `first`, `count`, and
> `keys` are not places and raise `ol-not-a-place` if used as assignment targets.

The same rule that rejects a reporter call as an assignment target rejects a struct constructor
call for the identical reason: both are *expression results with no binding attached*, not places.
This is exercised end to end by the
conformance fixture `tests/conformance/data/check/struct-constructor-write-target-stays-not-a-place`,
which asserts that `(point 0 0).z = 1` raises exactly one semantic `ol-not-a-place` diagnostic (and
nothing else — no `ol-unknown-field`, because the field-existence rule never runs on a target that
was never a place to begin with).

## Rationale

A parenthesized constructor call is a **computed result with no binding behind it**. `(point 0 0)`
evaluates to a fresh record; nothing in the program holds a name for it once the expression
finishes evaluating (unless it is assigned to a variable first). Allowing `(point 0 0).z = 1` to
parse would force one of two outcomes, both bad for a learner-facing language:

1. **Silently discard the write.** The mutation happens to a record that no name in the program
   refers to, so once the statement finishes there is no way to observe it happened; the program
   continues as if nothing happened. This is the single most confusing failure mode for a
   beginner — no error, no effect, and a debugging session that starts from "but I wrote
   `.z = 1`, why is `z` still missing?"
2. **Mutate a transient result reached through no stable name.** This requires the runtime to
   resolve a write target that exists only for the duration of one expression — a place with
   nothing durable behind it — for a pattern the language never intends to support (you cannot read
   that mutation back through any binding afterward).

Rejecting the pattern at the grammar/semantic layer, with the specific `ol-not-a-place` code, tells
the learner immediately and precisely: *this is a value, not a place you can change* — matching the
diagnostic's own message text in the conformance fixture above. The fix is always the same shape:
bind the result to a name first (`:p = point 0 0`, then `:p.z = 1` — which itself raises
`ol-unknown-field` if `z` isn't declared, the *correct* diagnostic once there is a real place to
check; once bound, `:p` is a mutable reference value and `:p.z = 1` mutates it in place exactly as
`spec/data-structures.md`'s record example shows — "Records and structs"). Anchoring places at `:name` also keeps mutation
**traceable to a binding** the trace/event stream and tutoring commands (`explain`, `why`) can point
to; a place that could be an arbitrary sub-expression would have nothing stable to describe.

## How other languages do it

| Language family | Does `Ctor(...).field = value` parse? | What happens |
|---|---|---|
| Python (reference semantics) | Yes | `Point(0, 0).z = 1` is ordinarily legal syntax: it sets an attribute on the freshly constructed object, which is then normally unreachable once the statement ends — unless `Point` overrides `__setattr__`, uses `__slots__`, or otherwise customizes attribute assignment, in which case the write can raise or have other observable effects. |
| JavaScript (reference semantics) | Yes | `new Point(0, 0).z = 1;` ordinarily assigns a new property to the temporary object and is simply lost once the statement ends; it can throw in strict mode if the object is frozen/non-extensible, or behave differently through a setter or `Proxy`. |
| Ruby (reference semantics) | Rarely, but "yes" for open objects | `Point.new(0, 0).z = 1` calls the `z=` setter method on the temporary receiver if defined; otherwise it raises `NoMethodError` at the *method-dispatch* layer, not because the target is unassignable in principle — any object able to receive `foo=` accepts writes to a transient receiver. |
| Rust | Yes (the temporary is mutated, then dropped) | `Point::new(0, 0).z = 1;` compiles: the call result is materialized into an implicit temporary, `.z` names a mutable place within it, and the write succeeds — but the temporary is never bound to a name, so it is dropped at the end of the statement. For an ordinary `Point` with a scalar `z` and no observable destructor behavior, the mutation leaves no lasting reachable state, much like the reference-semantics cases above; in general, a `Drop` implementation could still observe it. Value semantics does *not* by itself forbid the write. |
| Swift (value semantics) | No | Assigning to a field of a temporary struct value produced by a call/initializer is a compile-time error ("cannot assign to property: function call returns immutable value"): a call result is not an lvalue. |
| C++ (prvalue temporaries) | No (for a scalar field) | `Point(0, 0).z = 1;` is rejected: the call yields a prvalue that is automatically materialized so that `.z` is an xvalue, but built-in assignment requires its left operand to be a *modifiable lvalue*, and that materialized field is not one. (A class-type field whose type overloads `operator=` can still be assigned, since that dispatches to a member function rather than built-in assignment.) |

The reference-semantics languages — and Rust — let the syntax through: the field write executes but
targets a temporary that is immediately discarded, so it usually leaves no lasting reachable state
(though language hooks or destructors can make it observable). Swift and C++ instead
reject a call result as an assignment target at compile time — the same shape OpenLogo takes:
assignment targets must be *places*, rooted in a named, addressable binding, and a call result is never
one of those, so the error surfaces where the mistake is made, not silently downstream. Rust shows the
two axes are independent: it has value semantics yet still permits the transient write, because it
materializes an implicit mutable temporary rather than requiring a named binding.

## Consequences

- **Predictable mutation, traceable to a binding.** Every successful assignment in OpenLogo targets
  a   named binding (`:name` plus a chain of selectors/fields), so the runtime, the
  trace/event stream, and tutoring commands (`explain`, `why`, `hint`) can always describe *which
  binding changed*. This does not make records copy-on-assign — they remain mutable reference
  values once bound (`spec/execution-model.md`, "Lists, dicts, records, and turtles are mutable
  reference values"; `:p = point 3 4` then `:q = :p` makes `:p` and `:q` alias the same record) —
  but it does mean a write can never target a result that has no binding at all.
- **The diagnostic is exact and immediate.** `(point 0 0).z = 1` fails with `ol-not-a-place` at the
  point of the mistake, whether or not `z` is a declared field — the field-existence check never
  runs on a target that was never assignable, keeping the two failure modes (`ol-not-a-place` vs
  `ol-unknown-field`) cleanly separated, as locked by the conformance fixture cited above.
- **It forecloses fluent, in-place mutation of expression results.** There is no OpenLogo equivalent
  of chaining a constructor call directly into a field write; a learner must always bind the value to
  a name first (`:p = point 0 0` then `:p.z = 1`). This is a deliberate trade: it costs a line of
  code in exchange for every mutation being nameable and inspectable — consistent with the
  language's broader preference (grammar-level, not just this rule) for explicit, traceable state
  over compact but opaque expression chaining.
- **The rule generalizes**, not just to structs: any call result — a reporter like `first :xs`, a
  primitive, a user procedure, or a struct constructor — hits the same `ol-not-a-place` check for the
  same reason, so learners only need to internalize one rule ("assignment targets start at `:name`"),
  not a special case per value kind.

## Spec references

- [`spec/grammar.md` — "Places, selectors, and keys"](../../spec/grammar.md#places-selectors-and-keys)
  — the closed, variable-rooted `colon-place`/`bare-place` productions and the `ol-not-a-place`
  rule for reporters used as assignment targets.
- [`spec/execution-model.md` — "Assignable places and mutation"](../../spec/execution-model.md#assignable-places-and-mutation)
  — the runtime-side statement of the same closed place set and the `ol-not-a-place` diagnostic.
- `tests/conformance/data/check/struct-constructor-write-target-stays-not-a-place` — the exact
  `(point 0 0).z = 1` example, validated against the built runtime (`npm run build` +
  `node scripts/conformance.mjs`): passes with exactly one semantic `ol-not-a-place` diagnostic and
  no `ol-unknown-field`.

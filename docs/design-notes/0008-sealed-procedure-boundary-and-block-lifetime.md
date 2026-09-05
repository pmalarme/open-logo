# 8. The sealed procedure boundary, the block as a lifetime boundary, and `global` as declared sharing

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme), ruling on issue #821 under saga #819
- Related: [LDR-0001](0001-places-and-value-semantics.md) (places and value semantics — the
  names-versus-values half of this record), [LDR-0004](0004-no-lambda-first-class-procedures.md)
  (no lambda or first-class procedure values — why handler lifetime is the only closure question
  this decision raises), [LDR-0006](0006-effect-event-snapshot-timing.md) (effect-event snapshot
  timing — a decision this one leaves intact but whose illustration it changed),
  [LDR-0007](0007-binding-vs-registration.md) (binding versus registration — why reserving `global`
  still leaves it bindable as data),
  [ADR-0032](../adr/0032-semantic-token-modifiers-extend-the-informative-list.md) (the
  semantic-token channel that carries this decision's one acknowledged readability cost)

## Context

Every language with procedures has to answer one question: **when a procedure assigns a name that
already exists outside it, which binding does the assignment reach?** OpenLogo answered it badly.

Before this decision, an assignment to a name that had no visible binding created or updated a
**global**. That is the classic-Logo default, and OpenLogo had inherited it without inheriting the
reason for it. Three consequences followed, and the third is what forced the ruling.

First, a procedure could write outside itself silently. Nothing in a procedure's header told a
reader which names it touched; you had to read the body, and then read every other procedure that
might touch the same names.

Second, the language contradicted itself on what a `[ … ]` block means. A `for` or `map` binder was
already correctly body-local, while a `repeat`, `if`, or `while` body leaked every name it created
to the top level. Same brackets, opposite rules, with nothing in the source to distinguish them.

Third — and this is the defect that made the question urgent rather than merely untidy —
**recursion with a non-parameter local was broken.** Every recursive frame shared one binding, so
the innermost call overwrote every outer one:

```logo
define countdown :n
  local step = :n
  if :n > 0 [ countdown :n - 1 ]
  print :step
end
countdown 2
```

That program printed `0 0 0`. It now prints `0 1 2`. Nothing raised, nothing warned; the output was
merely wrong, and plausibly wrong. The contrast that makes the argument is inside the same
procedure shape: a recursive procedure that captures its **parameter** was always correct, because
parameters were already per-frame. Assigned names were not. Recursion is a Level 8 topic and
fractals are the flagship of `spec/examples/`, so the language's showcase sat directly on top of
the broken half.

The constraints on any fix were sharp. The accumulator idiom
(`:total = 0` then `repeat 4 [ :total = :total + 1 ]`) is taught early and used by shipped examples
— `spec/examples/03-variables.logo`, `10-game.logo`, and `11-music.logo` all depend on a block
updating a name declared outside it — so blocks could not simply become sealed too. And OpenLogo
had already rejected classic Logo's **dynamic** scoping in favour of lexical frame scoping, so
whatever replaced global-by-default had to be justified lexically rather than by "that is how Logo
does it".

## Decision

One sentence decides every case, and `spec/execution-model.md`'s
[§ *Variables, scoping, and procedures*](../../spec/execution-model.md#variables-scoping-and-procedures)
states it normatively:

> **A name is born where it is first assigned, lives until that scope ends, and a procedure's edge
> is sealed.**

Three rules unfold from it.

**A procedure is a total boundary.** A procedure body sees exactly three things: its own
parameters, the bindings its body has already created, and names declared `global`. Every other
variable of every enclosing scope is **invisible** — not merely unwritable. Reading one raises
`ol-var-not-visible`, a diagnostic that names the procedure whose boundary hid it
(§ *What a scope can see*).

```logo
:count = 0
define draw_steps
  repeat 4 [
    forward :count * 10
    :count = :count + 1
  ]
end
draw_steps
```

`draw_steps` cannot see the top-level `count`, so `forward :count * 10` raises
`ol-var-not-visible`. The diagnostic fires on the **read**, because the read comes first. The fix
is one word at the top level: `global count = 0`.

**A block is a lifetime boundary, not a write boundary.** A block may update any binding visible
from its enclosing scope, so the accumulator idiom keeps working. A name *born* inside a block goes
out of scope at the `]`, and each entry into the block creates a fresh binding
(§ *Blocks update what they can see*). The whole rule fits in two lines:

```logo
repeat 4 [ :x = 0   :x = :x + 1   print :x ]
:x = 0
repeat 4 [ :x = :x + 1   print :x ]
```

The first loop prints `1 1 1 1` — `:x` is born inside the block, fresh on every turn. The second
prints `1 2 3 4` — `:x` is born outside it, so all four turns update one binding.

**`global name = value` is a root-scope declaration of shared state.** The name is written bare
(not `:name`), the initializer is required, and the declaration is legal only at the root scope;
anywhere else it raises `ol-global-outside-root` (§ *`global`*). Once declared, the name is visible
to every procedure in the document for reading and for writing alike, with no ceremony at the point
of assignment:

```logo
global count = 0
define bump
  :count = :count + 1
end
bump
bump
print :count
```

That prints `2`. `local name` and `local name = value` are unchanged in spirit and now behave
identically in a block and in a procedure: they create a binding in the **current** scope,
shadowing anything of that name that was visible (§ *`local`*).

Two further consequences are ruled rather than left to inference. The boundary governs the
**variable** namespace only — primitives, procedures, and struct constructors are registered before
execution and stay callable everywhere, so a procedure may still call `forward`, recurse, and use
any constructor. And `repcount` is **lexical**: it reports the turn of the `repeat` it is written
inside, never one running in a caller, so dynamic loop state does not cross the sealed edge any more
than a name does (§ *`repcount` is lexical*).

## Rationale

### Why seal reads, when no other language does

This is the part of the decision a knowledgeable reader will attack first, and it deserves a
straight answer: **OpenLogo is stricter here than Python, JavaScript, Go, Java, C++, or Rust, all of
which let a function read enclosing state without ceremony.** Reading is universally treated as the
easy case. OpenLogo treats it as the load-bearing one.

The reason is pedagogical and is stated in the normative text itself: *everything a procedure
touches is named at its boundary, so it can be understood from its header plus the `global` names it
uses, without reading the code around it.* A learner debugging `draw_steps` has a closed list of
inputs. If the procedure misbehaves, the cause is in the header, in the body, or in a name the
program declared shared on purpose — and there is no fourth possibility. Allowing reads would
reintroduce exactly the fourth possibility, and it is the one a beginner cannot see: an invisible
dependency on a name defined a hundred lines away that changes under them.

**It is a real cost and should not be sold as free.** A program that shares state across procedures
will carry more `global` declarations than the same program in any other language. The cost is not
spread evenly, either: it concentrates in code that keeps a named handle at the top level and
addresses it from inside a procedure — the shape sprite code naturally takes. The ruling accepted
that concentration knowingly. What it buys is that the declaration site, not the write site, is
where sharing is stated once and can be read at a glance.

### Why a block is different, and why that is principled rather than a compromise

The asymmetry is the design, not a concession to compatibility. **You can see a block's enclosing
scope by looking up the page; you cannot see a procedure's caller.** A block executes in place,
lexically nested inside the source a reader is already reading, so the names it can reach are on
screen. A procedure is invoked from somewhere its reader cannot see, and may be invoked from many
such places. The two constructs deserve different rules because they present different amounts of
context to the person reading them.

The alternative was measured against the corpus and rejected on cost as well as on principle. Had a
block been made a write boundary too, `:total = 0` followed by `repeat 4 [ :total = :total + 1 ]`
would print `0`, silently breaking the accumulator idiom in `spec/examples/03-variables.logo`,
`10-game.logo`, and `11-music.logo` — and breaking a Level 3 lesson to buy a property that, by the
paragraph above, blocks do not need.

What blocks *did* need was the other half of the rule: a fresh binding per entry. That is what
turns each turn of a loop into its own scope, and it is why a handler registered in a loop body now
captures its own turn's binding:

```logo
repeat 3 [ :n = repcount * 10   every 5 [ print :n ] ]
wait 8
```

That prints `10`, `20`, `30`. Before the ruling it printed `30` three times — which is precisely the
JavaScript `var`-in-a-loop closure bug that `let` was introduced to fix, and the single most
recognisable prior art for fresh-binding-per-iteration. (Measured for this record on Node: the same
loop written with `var` collects `40 40 40`, with `let` it collects `10 20 30`.)

### Why `global` is framed as permission to write, not as visibility

`global` reads best as a single English sentence: **"procedures are allowed to change this."** That
framing is deliberate. The declaration site carries the whole statement of intent, and every write
afterwards is unadorned — a procedure body says `:count = :count + 1` and nothing more.

The alternative framing, marking each *write*, is Python's, and it was rejected as a workaround
being mistaken for a design. Go, Java, C++, and Rust have **no top-level executable code**: only
declarations live outside a function, so "global" there is a *position*, not a keyword. Precisely
because that position is an unambiguous declaration, those languages let a function mutate it freely
with no per-write ceremony. Python needs `global x` inside every writing function because it has no
declaration syntax to hang the permission on — a top-level `x = 5` is an ordinary assignment,
indistinguishable from a local one. **OpenLogo has top-level executable code and therefore has
Python's problem, but it solved it with Go's answer**: introduce the declaration the compiled
languages get free from position, then write freely.

The spelling followed from the same reasoning. `global name = value` uses the bare-name convention
every other binding form already uses (`local x`, `set x to 5`, `define f :a`). `:=` was considered
and rejected twice over: it does not lex today, and Go's precedent points the opposite way — `:=`
is illegal at package level there and creates *locals* inside a function.

One detail is worth recording because it makes the change cheaper than it looks: `global` reaches
built-in-name status through the primitive matrix rather than the keyword list, and OpenLogo's
grammar keeps **binding** a name separate from **registering** one. So reserving `global` did not
outlaw it as data — `:global = 1` and `local global` remain conforming programs, and
`spec/grammar.md`'s [§ *Keywords, primitives, and built-in names*](../../spec/grammar.md#keywords-primitives-and-built-in-names)
says so explicitly. See [LDR-0007](0007-binding-vs-registration.md) for why that distinction exists.

### The boundary seals names, not values

*"A procedure sees only its parameters and `global` names"* reads stronger than it is, so the spec
states the limit outright (§ *The boundary seals names, not values*):

```logo
define push_last :items
  add 99 to :items
end
:numbers = [1 2]
push_last :numbers
print :numbers
```

That prints `[1 2 99]`. The procedure changed the caller's list without any `global` at all.

This is not an exception to the sealed edge; it is a direct consequence of a decision made
elsewhere. Lists, dicts, records, and turtles are **mutable reference values**, and passing one
copies the reference, not the structure (`spec/execution-model.md`, § *Value and type model*, and
[LDR-0001](0001-places-and-value-semantics.md)). Scoping governs which *bindings* a name can reach;
it says nothing about what is inside a value that was handed over deliberately. Rebinding a
parameter never escapes; mutating a shared value always does. A procedure doing this is doing what
the language promises, and the checker must not diagnose it.

### Closure lifetime without closure values

Sealing the edge raised one question that looks like it threatens [LDR-0004](0004-no-lambda-first-class-procedures.md).
A handler registered inside a procedure must keep working after that procedure returns:

```logo
define setup :speed
  every 5 [ print :speed ]
end
setup 10
wait 8
```

That prints `10`. So a scope — a block scope as much as a procedure frame — lives as long as any
handler registered inside it may still run (§ *Frames, handlers, and lifetime*).

That is closure **lifetime**, and it is not closure **values**. Blocks are still not values: writing
`:f = [ print 1 ]` binds nothing, and reading `:f` afterwards raises `ol-undefined-var`. A block
cannot be stored in a variable or passed to a procedure, v0.1 still has no lambda, and deferred
event handlers are the only construct where the question arises at all. LDR-0004's promise is
untouched.

A related asymmetry is worth stating because it surprises people: a `define` written inside a
procedure body is hoisted and registered globally, so it does **not** capture the frame it appears
in, while a handler block written in the same place does. Two things that look equally nested
capture differently, because one is a declaration and the other is a block.

### The one readability cost, and where it is paid

The decision accepts a genuine cost knowingly. When a procedure's first touch of a name it cannot
see is a **write**, that write silently creates a procedure-local. This is correct — it is a
genuinely different variable — and it is deliberately not diagnosed. But it means a reader of
`:temp = 7` inside a procedure body cannot tell locally whether it targets a shared global or
creates a private name:

```logo
define stash
  :temp = 7
  print :temp
end
:temp = 1
stash
print :temp
```

That prints `7` then `1`: `stash`'s `:temp` is its own. Had `temp` been declared `global`, the same
two characters would have printed `7` then `7`. The source text is identical; only a declaration
elsewhere distinguishes them.

The mitigation is tooling rather than syntax: a variable occurrence that resolves to a `global`
binding carries a `global` **semantic-token modifier**. It is a modifier and not a sixteenth token
class because `spec/tooling.md`'s class table is normative and closed, and the spec already models
sub-roles — the five grammatical roles of brackets — as modifiers over an existing class.
[ADR-0032](../adr/0032-semantic-token-modifiers-extend-the-informative-list.md) records that ruling
and its limits. **Be clear about what that means for a learner today: the parser emits the modifier,
and the studio does not yet render it, so nothing is visible on screen.** Issue #1106 is the slice
that pays that cost; until it lands, the mitigation exists in the token stream only.

## How other languages do it

**Classic Logo (UCBLogo/Berkeley Logo) is dynamically scoped.** `:x` searches the running
procedure, then the *caller's* frame, up the live call stack, and finally the globals; `local "x`
makes a name local to a procedure **and to everything that procedure calls**. Global-by-default made
sense in that world, because values flowed down the call chain naturally and `local` was the tool
for *cutting* that flow.

This is the spine of the whole record. **OpenLogo replaced dynamic scoping with lexical scoping but
kept classic Logo's global-by-default anyway.** The rationale left; the default stayed. This
decision finishes a migration that was started and abandoned — which is why "it is stricter than
classic Logo" is not the criticism it first appears to be: under lexical scoping the old default
had no argument left behind it. It also sets the constraint for the Heritage profile: saga #797's
classic-primitive work must be reconciled *with* this ruling, not against it. Heritage supplies
classic *spellings* (`to`, `make`, `output`), never classic *scoping* — `make "n" v` resolves
exactly as `:n = v` does.

**Python** is the closest analogue to OpenLogo's situation, because it too has top-level executable
code and no declaration syntax to hang permission on. Its consequences were verified against CPython
for this record: a function may **read** a module-level name freely (`def show(): print(counter)`
prints `5`), but adding `counter = counter + 1` to a function makes `counter` local for the *entire
body*, so the read on the right-hand side fails with
`UnboundLocalError: cannot access local variable 'counter' where it is not associated with a value`.
That retroactive breakage of a previously legal read is one of Python's most notorious beginner
errors, and OpenLogo rejected it explicitly: **visibility decides which binding an assignment
reaches, never statement order** (§ *What an assignment targets*). OpenLogo has no rule that makes a
whole body local because of an assignment later in it.

**JavaScript** contributes the loop half. `var` is function-scoped with one binding per loop, so
closures created in a loop body all capture the same variable; `let` creates a fresh binding per
iteration and fixes it. Measured on Node for this record: three `setTimeout` callbacks over
`for (var i = 1; i <= 3; i++)` collect `40 40 40`, while the same loop with `let` collects
`10 20 30`. OpenLogo's fresh-binding-per-scope-entry is the `let` answer, applied to every block
rather than only to loop heads — and OpenLogo never had a `var` to keep compatible with, so it does
not need two spellings.

**Go, Java, C++, and Rust** have no top-level executable code at all. A name outside a function is a
*declaration*, so "global" is a position rather than a keyword, and a function may mutate one with
no per-write ceremony:

```go
var counter = 0          // package level — a declaration
func inc() { counter++ } // legal, no ceremony whatsoever
```

OpenLogo's `global` is this model, not Python's. (These four rows are documented from the languages'
own references; unlike the Python and JavaScript rows above, they were not executed for this
record.)

**Scheme and the Lisp family** provide the lexical-closure baseline: an inner procedure sees its
enclosing scope's bindings and captures them by reference, with lifetime extending as long as the
closure is reachable. OpenLogo takes the *lifetime* half of that model wholesale — a scope lives as
long as a handler registered inside it can still run — and deliberately declines the *visibility*
half at the procedure edge. It can do so at a much lower price than Scheme could, because OpenLogo
has no first-class procedure values (LDR-0004), so the only construct that outlives its scope is a
deferred event handler.

## Consequences

- **Recursion with a non-parameter local is correct.** The motivating defect is repaired: the
  `countdown` program in *Context* prints `0 1 2`, not `0 0 0`, and every recursive frame owns its
  own bindings. This matters most exactly where the curriculum is most ambitious.
- **A procedure can be read from its header plus its `global` names.** That is the property the
  decision exists to buy, and it is why reads are sealed and not merely writes.
- **Programs that share state across procedures pay for it in `global` declarations.** The cost is
  real and concentrated in code that addresses a top-level handle from inside a procedure. It was
  accepted knowingly; a future ergonomic remedy would be a new decision, not a reinterpretation of
  this one.
- **Two block behaviours that used to differ now agree.** `for`/`map` binders were always
  body-local; `repeat`/`if`/`while` bodies now are too, so brackets mean one thing.
- **`ol-var-not-visible` is decidable at the `semantic` stage**, because the boundary is lexical and
  absolute — no execution order can bring a hidden binding inside. The checker can report it before
  a program runs, which is what makes the sealed edge teachable rather than merely enforced.
- **The silent-local write remains undiagnosable by design**, and its mitigation lives in the
  semantic-token channel (ADR-0032) rather than in the language. Nothing renders it yet; issue #1106
  is that work. A reader of this record should not assume a learner can see the distinction today.
- **[LDR-0006](0006-effect-event-snapshot-timing.md)'s decision is unaffected.** Its worked example
  had to change how `mutate` *reaches* its list — the list is now declared `global`, because a plain
  top-level name would be invisible inside a procedure — but capture-by-binding and
  snapshot-at-emission operate at different layers and compose cleanly. Effect-event payloads are
  still snapshotted at emission time; only the illustration's plumbing moved.
- **Per-turn handler capture is implemented and measured** (the `repeat 3 [ … every 5 [ print :n ] ]`
  program above prints `10`, `20`, `30`). Two sentences in `spec/execution-model.md`'s
  § *Frames, handlers, and lifetime* still described it as unimplemented when this record was
  written, having been drafted before the runtime slice landed; issue **#1110** tracks removing them.
  Where this record and those two sentences disagree, the runtime is the evidence.
- **The Heritage profile inherits a constraint.** Saga #797's classic-primitive work supplies classic
  spellings, never classic dynamic scoping; `make "n" v` resolves exactly as `:n = v` does.

### Spec sections this record explains

- [`spec/execution-model.md` § *Variables, scoping, and procedures*](../../spec/execution-model.md#variables-scoping-and-procedures)
  — the normative ruling, including *Scopes and bindings*, *What a scope can see*, *The boundary
  seals names, not values*, *What an assignment targets*, *`local`*, *`global`*, *Blocks update what
  they can see*, *Frames, handlers, and lifetime*, and *`repcount` is lexical*.
- [`spec/execution-model.md` § *Value and type model*](../../spec/execution-model.md#value-and-type-model)
  — lists, dicts, records, and turtles are mutable reference values, which is why the boundary seals
  names rather than values.
- [`spec/commands.md`](../../spec/commands.md) — the C3 entries for `<place> = <value>`,
  `set … to`, `local`, and `global`, including `ol-global-outside-root`.
- [`spec/grammar.md` § *Keywords, primitives, and built-in names*](../../spec/grammar.md#keywords-primitives-and-built-in-names)
  — the `global-statement` production, and why reserving the word still leaves it bindable as data.
- [`spec/tooling.md`](../../spec/tooling.md) — the normative, closed token-class table over which the
  `global` semantic-token modifier is layered.

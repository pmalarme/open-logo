# 7. Binding versus registration: you cannot register a built-in name, you can bind data to any name

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + team
- Ruling: issue #833 (maintainer-signed-off). This record is the **rationale layer** over that
  ruling. The normative `spec/` sections cited throughout are amended to match it by the grammar
  slice (#837) and the error-model slice; until those land they still state the **pre-ruling** rule,
  and where that matters this record says so inline rather than leaving a reader to trip over it.
- Related: [LDR-0001](0001-places-and-value-semantics.md) (what a *place* is, and why writing
  through one introduces no name); [LDR-0005](0005-profiles-and-the-conformance-dag.md) (why this
  rule is nevertheless **not** profile-conditional);
  [ADR-0021](../adr/0021-built-in-names-list-and-ci-gate.md) (who owns the list of built-in names
  and how CI keeps it honest)

## Context

OpenLogo's built-in names are ordinary English words. `end`, `value`, `key`, `at`, `by`, `from`,
`in`, `clear` and `add` are all **keywords**, in the normative list in
[`spec/grammar.md`](../../spec/grammar.md)'s *Reserved words and namespaces* section; `count`,
`first` and `word` are Core **primitives** sitting beside them. Every one of them is also a word a
nine-year-old will reach for when naming a piece of data. `:end` is the obvious name for when a
timer stops; `:count` is the archetypal counter; `for end from 1 to 3` is a perfectly ordinary loop.
A language that hands a learner a 43-word list of English nouns and then refuses to let them name
anything after those nouns has taxed the learner for the implementation's convenience.

At the same time, some names genuinely cannot be taken. If a learner writes their own `forward`,
something has to give: either the learner's procedure wins and the turtle stops moving, or the
built-in wins and the learner's procedure never runs. Neither is a good outcome, and neither
announces itself.

The tension was invisible for as long as the two situations shared one verb. The spec's original
sentence — that these words "may not be redefined as variables, procedures, primitives, or struct
type constructors" — packs two unrelated questions under the single word *redefine*:

1. **Binding** — storing a value under a name in an environment. `:name = …`, `set … to …`,
   `local`, a procedure parameter, a `for`/comprehension binder, a destructuring pattern.
2. **Registration** — adding a name to one of the registries the reader resolves against: the
   callable table, the type table, or the alias table. `define`, `to` (Heritage), `struct`, and the
   *new* name of an `alias`.

Only the second can collide with the language, because only the second puts a name where the reader
looks. Conflating them produced errors in **both** directions at once, and the project shipped both
mistakes before noticing. Measured at saga tip `7a37504`:

| program | today's behaviour | what it should be |
|---|---|---|
| `:end = 7` then `print :end` | `ol-reserved-word` at `check()` — but runs fine and prints `7` | legal |
| `for end from 1 to 3` | `ol-reserved-word` at `check()` — but runs fine and prints `1 2 3` | legal |
| `:count = 1` | clean everywhere — a *primitive*, so the binding rule never reached it | legal |
| `define forward :x` then `forward 10` | **no diagnostic at all**; prints the learner's body and emits **zero** `move` events | rejected |

The binding half was not an oversight: it was implemented deliberately (issue #739, "reserved word
is reserved word") on the reading that the spec sentence meant what it said. The registration half
was never implemented for Turtle & Rendering names at all. So the strict rule was tried, and the
result was a language that rejected `:end = 7` — which is harmless — while silently accepting
`define forward`, which stops the turtle.

## Decision

**You cannot REGISTER a built-in name. You can BIND data to any name.**

A **built-in name** is a name OpenLogo itself implements. It has two implementation categories and
one learner-facing meaning:

- a **keyword** — a structural word recognized by the reader (`define`, `if`, `repeat`, `end`; the
  six profile block heads `ask`/`each` for Sprites and `when`/`every`/`on_key`/`on_click` for
  Interaction & Events; and the Sprites command `tell`, which takes no block —
  [`spec/grammar.md`](../../spec/grammar.md) calls it "a mode switch that takes no block", so it is
  profile-*reserved* without being a block head. Whether `tell` is finally listed as a keyword or a
  primitive is an open question on ruling #833 that the maintainer has not settled; under this
  decision the outcome is identical either way, because both categories are blocked at
  registration);
- a **primitive** — a built-in command or reporter, **aliases included** (`forward`, `set_xy`,
  `setxy`, `fd`, `pr`, `grid`).

The two categories are how the implementation is organized; the learner meets one idea — *OpenLogo
already owns this name* — and the words *keyword*, *primitive* and *alias* never appear in the
error. The category vocabulary is the one
[`spec/tooling.md`](../../spec/tooling.md)'s *Normative token-class model* already uses; the
umbrella term "built-in names" is what unifies them.

**Registration positions are exactly**: `define <name>`, `to <name>` (the Heritage procedure
opener), `struct <name>`, and the new name of `alias <new> <existing>`. Taking a built-in name in
one of those positions raises `ol-reserved-word`. Everything else that introduces a name is a
binding position and is unrestricted: `:name = …`, `set … to …`, `make "name" …` (Heritage),
`local`, procedure parameters, `for` binders, comprehension binders and the `reduce` accumulator,
and destructuring patterns. Struct field names, dictionary keys and bare selector keys are freer
still — [`spec/grammar.md`](../../spec/grammar.md) classifies them as **data, not declarations**, so
they were never restricted in the first place and are not "positions" this decision had to free.

Three consequences of that rule are worth stating explicitly, because each is a place a reasonable
implementer would guess wrong:

- **Nothing shadows.** `define count`, `define forward` and `define fd` are all errors. There is no
  "the learner's definition wins" and no "the built-in wins"; there is no shadowing to have a rule
  about.
- **The rule is not profile-conditional.** A program cannot declare which profiles it wants, so a
  name that is legal or illegal depending on the host's profile set is unpredictable from the
  source alone. Sprite and event names are owned whether or not the host implements Sprites.
- **A name that OpenLogo *implements* is built-in; a name that merely *exists* is not.** The
  geometry standard library is OpenLogo source (see below), so its names are not built-in names.

Only the alias's **new** name registers; its `<existing>` operand is deliberately unrestricted and
may itself be a keyword, because that is exactly how a localized keyword pack renames one —
`alias definir define` ([`spec/localization.md`](../../spec/localization.md)). Blocking both
operands would break the Localization profile outright.

Registering a name **you** already registered is a different situation and gets its own code,
`ol-duplicate-definition`, carrying both source spans so the message can point at the first
definition. That split leaves `ol-reserved-word` with exactly one meaning — *OpenLogo owns this
name* — which is what makes it safe to drop its `namespace` parameter and use a single
learner-facing message.

## Rationale

### Binding is free because `:name` is a different namespace, and the strict rule could not be made coherent

[`spec/grammar.md`](../../spec/grammar.md) already says that primitives, user procedures and struct
constructors share **one** callable namespace, and that field names and dictionary keys are data
rather than declarations. A `:name` variable is in none of those. `:count = 1` shadows nothing:
`count` and `:count` cannot be confused by the reader, which is why the runtime has always executed
all 43 keyword bindings correctly — measured, all 43 parse, run, and print `7`. Only the checker
objected.

The attempt to enforce the strict reading is the best argument against it. Because `local` is
optional in OpenLogo — `:brandnew = 1` creates a variable with no declaration anywhere — a rule
enforced only at `local` is bypassed by omitting a keyword. Making it real therefore meant
extending it to assignment, parameters, loop binders and comprehension binders, which is exactly
what #739 did. The blast radius was immediately visible: `for end from 1 to 3` and
`map value in :xs [ … ]` became errors for a reason no learner can see, since both run perfectly.
Widening the rule one step further — to primitives as well as keywords — would have rejected
`:count = 1`, the archetypal beginner counter. A rule whose only stable stopping points are "reject
ordinary English words" or "reject the word `count`" is the wrong rule.

**#739's concern is not discarded — it is relocated.** Its worry was sound: a rule enforced only at
an *optional* keyword can be evaded by omitting that keyword. This decision answers it by moving
enforcement to the **registration positions, which are not optional** — there is no way to define a
procedure without writing `define`, `to` or `struct`. So the intent survives intact and lands
somewhere it cannot be side-stepped, which is a better outcome than either widening the binding rule
until it rejects `:count` or narrowing it until it means nothing.

(One asymmetry to expect while reading the current code: `local` is the odd one out. It is a binding
position under this decision, but today it runs the **full** registration check, so `local count`
raises `namespace: "primitive"` and `local end` raises `namespace: "reserved"` — while
`local forward` is clean. The checker slice therefore has to remove a *primitive*-category check at
`local`, not only a keyword one.)

Writing *through* a place is not a binding at all and never was restricted: `:people.repeat = 1`
and `:nums[1] = 9` introduce no name, they modify an existing value (LDR-0001). Field names, dict
keys and bare selector keys are the same story from the other side — `struct point [ repeat y ]`,
`{ end: 1 }` and `:ages[end]` are **data, not declarations**
([`spec/grammar.md`](../../spec/grammar.md)), and all three check clean today.

### The rule is keyed to the position, not to the grammar's name for the identifier

There is one trap here that decided the design, and it is worth recording because the obvious
formulation is wrong. `spec/grammar.md` reaches these names through two nonterminals,
`callable-name` and `type-name` — but each of them appears at **registration** sites (`define`,
`to`, `struct`) *and* at **call** sites (`fixed-call`, `parenthesized-call`,
`type-constructor-call`). So "a built-in name is illegal at `callable-name`" would make
**`forward 100` illegal**: calling a primitive is the single most common thing an OpenLogo program
does, and it goes through the same nonterminal as defining one.

The rule is therefore **registration-position**-based. The grammar makes that derivable rather than
merely asserted by giving the declaration slots their own nonterminals — `declared-callable-name`
and `declared-type-name` — used by `define`, `to`, `struct` and `alias`'s first operand, while
`callable-name`/`type-name` keep their current definitions for calls. Parsing is completely
unchanged, because every one of these still expands to `identifier`; the split exists purely so the
semantic rule can be read off the grammar instead of maintained as a prose list beside it. That
matters more than it sounds: a prose enumeration of blocked positions would be a *second list that
can drift from the grammar*, which is the precise failure mode this whole design exists to remove.

### Registration is blocked because shadowing has no good outcome — and, worse, no consistent one

The obvious guess is that `define if` is rejected because the parser would break. It is not. Every
one of these parses cleanly; the failure is entirely semantic, and today it is mostly silent.
Measured at `7a37504`, shadowing produces **three different outcomes depending on which built-in
you picked**:

| program | result | who won | diagnosed today? |
|---|---|---|---|
| `define first :xs / return 999` then `print first [10 20 30]` | prints **`10`** | the primitive; the learner's procedure is dead | yes — `ol-reserved-word` at `check()` |
| `define forward :x / print 999` then `forward 10` | prints **`999`**, **0** `move` events | the learner; the turtle silently stops moving | **no** — clean at every stage |
| `define setxy :x :y / print 999` then `set_xy 10 20` | prints nothing, **1** `move` + **1** `draw-segment` event | the primitive — because the *other spelling* was called | **no** — clean at every stage |

Nothing is announced *at runtime* in any of the three. The `check()` column carries its own lesson:
blocking today is inconsistent **across profiles**, not merely incomplete. Core primitives like
`first` are already caught; Turtle & Rendering names, Heritage aliases and Educational commands are
not — which is the defect the unconditional rule closes.

The third row is the sharpest. `setxy` and `set_xy` are two independent entries bound to one
primitive, so defining either produces a **call-site-dependent split**: half the call sites reach
the learner's procedure and half reach the turtle, decided purely by which spelling was typed. The
learner most likely to type the short form is the one least equipped to diagnose it.

A language can afford shadowable built-ins when it has a compiler and a type checker to catch the
consequences. OpenLogo's readers are children, and its feedback loop is a drawing that silently
came out wrong. So the design goal is not "make shadowing well-defined" but "make the question not
arise": if nothing shadows, there is no resolution order to learn, no precedence rule to document,
and no silent no-op to debug. It also removes a real defect by construction — the runtime already
enforces some of these names itself, in registration and in reporter dispatch, so today
`struct forward [ x y ]` passes the checker and then halts at run time. With nothing shadowing, the
checker and the runtime can finally agree.

### Why "keyword", not "reserved word"

The maintainer's objection was that it "seems strange to call `if` or `define` a reserved word —
they are core elements of the language". That is right, and it is also how every language a learner
meets next uses the term. Python, JavaScript, Java, C++, Go and Rust all say **keyword** for the
structural words; in several of them "reserved word" means the narrower *reserved for future use*
set — Java's unused `goto` and `const`, JavaScript's `enum`. Calling OpenLogo's structural words
"reserved" borrowed a term that means something else, for a category that is not a leftover but the
spine of the grammar.

### Zero exceptions, including `mod`

`mod` is infix — `print 7 mod 3` reports `1`, and `mod 7 3` is a parse error — so `define mod`
cannot hijack anything the way `define forward` does. It is blocked anyway. A rule with zero
exceptions is the entire value of this design; one saved identifier is not worth a footnote every
learner has to carry. `mod` is blocked as a **keyword**, not as a primitive: it is a word-spelled
infix operator whose three siblings `and`, `or` and `not` are already in the keyword list, and it
was simply omitted — so the Core keyword list goes from 43 words to **44**, and the keyword half of
the built-in names from 50 to **51** once the profile-reserved words are counted. Its token class is
unaffected — measured, it stays `operator`, exactly like `and`, which is on the keyword list and
painted `operator` all the same. Keyword-list membership (*what you may not register*) and token
class (*how it is coloured*) are independent axes.

### The subtle case: the geometry standard library is a library, not a built-in

`polygon`, `circle`, `arc`, `star`, `area` and `perimeter` are **not** built-in names, and this is
the **library carve-out** — the one place where a name OpenLogo ships is nevertheless free to take.
(The contextual words below are a separate matter: they are not carved out of the rule, they simply
never were built-in names.) They are ordinary OpenLogo procedures, shipped as real `.logo` source
(ADR-0012), and
[`spec/educational-model.md`](../../spec/educational-model.md)'s Level 5 material is explicit that
learners **build** `polygon` from `repeat` and that it is never introduced as a black-box drawing
trick. **A learner redefining `polygon` is the lesson**, not a mistake to diagnose.

So the rule is *a name OpenLogo implements*, not *a name that exists somewhere*. The distinction is
checkable rather than a matter of taste: `polygon` has a `.logo` file, `grid` does not. `grid`,
`axes` and `measure` are renderer-backed primitives and stay blocked; the six library commands stay
free. And the carve-out costs no new concept, because the two diagnostics this design already
defines cover it exactly: `ol-reserved-word` means *OpenLogo owns this name*, and
`ol-duplicate-definition` means *something already defines this* — which is what a collision with a
**loaded** library procedure is, the same as colliding with a procedure the learner wrote earlier
in the file.

### Contextual words are excluded, and being a keyword *in a position* is not owning the name

`empty`, `member`, `of` and `a` act as keywords only inside an `is`-predicate — and `of` is also
the preposition in the Heritage `value of … for key` reader — and are ordinary names everywhere
else. They are **not** built-in names — these four are the set ruling #833 excludes, and the
exclusion has to be recorded explicitly or the next reader will "complete" the list by adding them.
(That is a statement about these four words, not a promise that the contextual set can never grow:
a future contextual word would be ruled on the same way, by the test below.)

The test they pass is the same one this whole design turns on: *could taking this name make a
definition silently dead, or the grammar ambiguous?* Measured, no — `define of` is legal, and
`print value of :d for key "a"` still reports `1` afterwards; `define empty` is legal, and
`print [ ] is empty` still reports `true`. Because these words are structural **by position only**,
taking the name cannot break the reader. The inference to avoid is "the highlighter paints `of` as
a keyword, therefore `define of` must be blocked": token class and registration are different
questions with different, both-correct answers. `of` makes the point twice over — measured, it is
painted `keyword` in `2 is member of [1 2]` and `primitive` in `value of :d for key "a"`, and
neither classification has any bearing on whether `define of` is legal.

### Measuring, not inferring

The size of the registration gap this rule closes moved four times before it settled: 23 → 65 → 42
→ **45** (44 primitives plus `mod`). Every correction came from re-deriving it a different way — a
hand-sample that missed two profiles; an enumeration run against a branch that lacked four
registries; a spec-heading extraction that missed the five alias spellings, which have no heading
of their own. Two of the design claims recorded along the way were also wrong until someone ran
them: that redefining an alias spelling was "silently dead" (it is a call-site split), and that
keyword binding "was never implemented" (it was, and it fires). The rule this design is built on
is therefore not just *nothing shadows* but *a probe you did not run is not evidence, and a probe
that returns nothing is an unproven result rather than a negative one*.

## How other languages do it

**Classic Logo is closer to this design than its reputation suggests.** Berkeley Logo (and FMSLogo
after it) refuse to redefine a primitive by default, reporting an error unless the workspace
variable `REDEFP` is explicitly set true — an escape hatch OpenLogo deliberately does not provide.
And binding was always free: the Berkeley user manual's own worked example defines
`TO PLURAL :WORD`, a variable named `WORD` living happily beside the primitive `WORD`, precisely
because `:WORD` and `WORD` are lexically distinct. OpenLogo's two halves are each continuous with
that tradition; what is new is that classic Logo had almost no keywords to reason about — Berkeley
Logo describes its own syntax as having "no special forms except `TO`" — whereas OpenLogo has 44
keywords plus 7 profile-reserved words, which is exactly why it needs one concept spanning keywords
and primitives instead of a rule about primitives alone.

**Python** hard-reserves its keywords — 35 of them in 3.11, enumerable as `keyword.kwlist`:
`if = 1` is a `SyntaxError`, in binding position as much as anywhere else. Its **builtins are the
opposite** — they are ordinary names in a module, so `list = [1, 2]` silently rebinds `list` for the
rest of the scope, and the failure surfaces much later as a confusing `TypeError`. Python's soft
keywords (`match`, `case` and `_`, enumerable as `keyword.softkwlist`) are the closest analogue to
OpenLogo's contextual `empty`/`member`/`of`/`a`.
Note that OpenLogo is Python's mirror image on the keyword axis: Python blocks `if` in *both*
positions, OpenLogo blocks it only in registration position, because `:if` is unambiguous where
Python's bare `if` is not.

**Go** reserves exactly 25 keywords, and puts its builtins — `len`, `cap`, `make`, `new`, `append`
— in the universe block as *predeclared identifiers* rather than keywords. Declaring `len := 3`
inside a function is legal Go and shadows the builtin for that scope. Go's trade-off is deliberate
and defensible: the shadow is lexically scoped and explicit at the declaration, so a reader can see
where it starts and ends. But the declaration itself is not diagnosed — nothing warns that `len` has
been taken — and whether anything catches the consequence depends on the shadow's type. A later
*incompatible* use fails to compile; a same-typed shadow compiles and silently changes what the
program means. OpenLogo rejects the trade-off because its failure mode is worse in exactly the place
Go's is mildest: there is no type checker standing behind it, and the symptom is a drawing that came
out wrong with no message at all.

**JavaScript** has reserved words plus a growing set of contextual ones — `of`, `as`, `from`,
`get`, `set`, `async`, `await`, `let` outside strict mode — and its globals are just properties, so
`Array = 5` is accepted at the top level. It is the cautionary tale for positional recognition at
scale: each contextual keyword is individually reasonable and the accumulated rules are not
learnable. OpenLogo's contextual set is four words fixed by the `is`-predicate and the Heritage
reader, and the bar for adding a fifth is the same test the four had to pass.

**Java, C# and C++** reserve a fixed keyword set (Java still reserving `goto` and `const` purely for
future use) while leaving library names such as `List` entirely available — you can declare a
method named `list` — which is the ordinary "keywords are closed, library names are yours"
settlement. C# adds a verbatim-identifier escape hatch, `@class`, and C++ goes further by reserving
identifier *patterns* (a leading underscore followed by an uppercase letter, or any name containing
a double underscore) to partition the namespace between the implementation and the user. OpenLogo
needs neither: 51 keywords plus a published primitive list is small enough to state, and pattern
reservation would tax every name a learner invents.

**Rust** splits its keywords three ways — strict, reserved-for-future-use, and weak/contextual —
and provides a raw-identifier escape hatch, `r#type`, so an identifier that collides with a keyword
can still be spelled. OpenLogo has no escape hatch on purpose: an escape hatch is a feature for
people who *must* interoperate with a foreign name (an FFI symbol, a generated binding), which is
not a situation a learner is in, and every escape hatch is a second spelling of the same idea for
everyone else to read.

**Scheme** sits at the far end: syntactic keywords are bindings in the same namespace as variables,
so a local binding named `if` shadows the syntax within its scope, and a program can rebind much of
the standard library. That maximal flexibility is coherent for a language whose whole point is that
users extend the syntax; it is the opposite of coherent for one whose whole point is that a
beginner can predict what a line does.

## Consequences

- **The learner-facing surface shrinks to one sentence.** "`count` is already part of OpenLogo.
  Choose another name." No namespace parameter, no *keyword*/*primitive*/*alias* vocabulary, and no
  "…but only when the Sprites profile is active" clause. Two error codes carry the whole design:
  `ol-reserved-word` (OpenLogo owns this name) and `ol-duplicate-definition` (something already
  defines this).
- **A whole class of silent failure disappears.** The three inconsistent shadowing outcomes
  measured above become one diagnostic at the point of definition. In particular the checker and
  the runtime stop disagreeing: today `struct forward [ x y ]` passes `check()` and halts at
  `execute()`, and `define foo` twice is flagged by `check()` yet silently overridden by
  `execute()`.
- **Every ordinary English word stays available for data.** `:end`, `:count`, `:value`,
  `for end from 1 to 3`, `map value in :xs [ … ]`, `{ end: 1 }`, `struct point [ repeat y ]` — all
  legal, with no carve-outs to memorize. This reverses the binding restriction that issue #739
  implemented from the spec's earlier wording.
- **The list of built-in names becomes a shipped artifact, not folklore.** Because the rule is
  unconditional, "which names are taken" is answerable once per spec version instead of per
  program. That raises an engineering question this record does not settle — who owns the list and
  how CI stops the implementation from drifting away from it — which is
  [ADR-0021](../adr/0021-built-in-names-list-and-ci-gate.md).
- **Heritage aliases are covered by construction, not by a parallel list.** Because an alias is a
  primitive, `define fd` is exactly as illegal as `define forward`, and the `setxy`/`set_xy` split
  has nothing left to fall into.
- **The Geometry lesson survives.** `polygon` stays redefinable, so
  `spec/educational-model.md`'s "learners build `polygon` from `repeat`" remains literally true;
  once a Modules-profile loader can load the library, a collision with it reports
  `ol-duplicate-definition` rather than `ol-reserved-word`, and library procedure names reach that
  check as ordinary registered procedures rather than by being added to the built-in list.
- **What it forecloses.** There is no way to take over a built-in name — no `REDEFP` flag, no
  `r#`-style escape, no per-profile relaxation. An implementation that wants an alternate `forward`
  must name it something else, and a future primitive added to any profile is a **breaking change**
  for any program that had registered that name, which is a cost this design accepts in exchange
  for never having to explain a resolution order to a nine-year-old.

Spec reference: [`spec/grammar.md`](../../spec/grammar.md) (*Reserved words and namespaces* — the
keyword list, the shared callable namespace, and the data-not-declarations rule for field names,
dictionary keys and bare selector keys),
[`spec/tooling.md`](../../spec/tooling.md) (*Normative token-class model* and *Reserved words for
tooling* — the `keyword`/`primitive` token classes this record's two categories come from),
[`spec/error-model.md`](../../spec/error-model.md) (*Normative code registry* — `ol-reserved-word`),
[`spec/execution-model.md`](../../spec/execution-model.md) (*Reader pipeline* — the alias pre-pass
and phase-1 registration, which is what "registration position" means operationally),
[`spec/localization.md`](../../spec/localization.md) (why an `alias`'s `existing_name` operand is
unrestricted), and
[`spec/educational-model.md`](../../spec/educational-model.md) (Level 5 — "learners build `polygon`
from `repeat`").

**Reading these citations before the spec slices land.** The maintainer ruling this record explains
is issue #833, and the normative text moves to match it in separate, serialized `spec/` PRs. Until
they land, three of the sections cited above still state the *pre-ruling* rule, and a reader
following the link will see the opposite of what this record says:

- `spec/grammar.md` and `spec/tooling.md` still say built-in names "may not be redefined **as
  variables**", the binding restriction this decision removes; the grammar slice (#837) inverts that
  sentence, renames *reserved words* to *keywords* in both documents, and retitles them
  *Keywords and namespaces* and *Keywords for tooling* — so a reader who finds those titles is
  looking at the sections cited here.
- `spec/error-model.md` still carries `ol-reserved-word`'s `namespace` parameter, which this
  decision drops, and does not yet register `ol-duplicate-definition` at all; both changes land with
  the error-model slice.

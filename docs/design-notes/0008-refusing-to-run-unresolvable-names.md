# 8. Refusing to run a program whose names cannot be resolved

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + team
- Related: LDR-0007 (binding versus registration) — that record says which names a program may
  *declare*; this one says what happens when a program *uses* a name nothing answers to.

## Context

Before a program can mean anything, three separate questions have to be answered about it: can it be
read (parse), do its names resolve to something the language knows (semantic), and do its values
behave when the program runs (runtime). `spec/error-model.md:59` names exactly those three stages,
and `spec/error-model.md:65` places the middle one "after parsing but before, or independent of,
execution".

OpenLogo had a fourth outcome that none of those three describes, and that the cross-language survey
below finds nowhere: **nothing at all**. A statement whose callable name resolved to no procedure and
no primitive did not stop the program, did not report a diagnostic, and did not run. It simply was
not there. Measured at commit `2a1888c1`, driving `parse()`, `check()` and `execute()` from the
built packages with every profile active:

```text
print 1
print (wibble 2)
print 3

  parse()   -> (no diagnostics)
  check()   -> ol-unknown-command  { name: "wibble" }
  execute() -> (no diagnostics)
  effect    -> two print events. The middle statement vanished.
```

The semantic checker had the right answer the whole time. Nothing asked it. That is the first of two
faults this record is about, and it is the one with a name: **an unresolvable name**.

The second fault has no name to be unresolvable, which is why it needs stating separately. `forward`
is a perfectly good name; it is a **command**, so it reports no value, and using it where a value is
required is a category error rather than a spelling one. Three separate programs, each measured at
the same commit and each producing the same three lines:

```text
wait forward 5
repeat forward 5 [ print 1 ]
right forward 5

  for each of the three, run on its own:
    check()   -> (no diagnostics)
    execute() -> (no diagnostics)
    effect    -> nothing happens
```

Here there was no better answer sitting unconsulted: the checker had no rule for this shape at all,
because `forward` resolves. Any decision that reached only the first fault would have left every
line above exactly as silent as it was.

There is a third thing wrong in the same neighbourhood, and it deserves to be told apart from both:
a name that is known, correctly used, and part of a completely valid program, for which the
evaluator simply has **no branch yet**. The checker is silent there by design — the program really
is valid — and the gap is in the implementation, not in what the learner wrote. That has shipped
twice: `sin`/`cos`/`tan`/`pi` (issue #323) and `reverse`/`pick`/`sort` (issue #190) all parsed clean,
checked clean, and quietly did nothing.

A learner cannot tell these three apart from the outside, because from the outside all three look
identical: the turtle did not move and the language said nothing. The question this record answers
is not "which diagnostic should each raise" — the spec already had codes for two of them — but
**what a language whose users are learning should do when it cannot resolve what a program is asking
for.**

## Decision

**OpenLogo does not run a program it cannot resolve.** The decision has two halves, one per fault,
plus a precedence rule that decides which message a learner sees when both stages have an opinion.
The normative wording lives in `spec/`; what follows states the shape of the decision, in the spec's
own vocabulary, so the rationale below has something to attach to.

**An unresolvable name stops the run before it starts.** Executing a program runs the semantic check
first and declines to run a program that fails it — the same way a program carrying **parse**
diagnostics already declines to run, as the `fowad 100` transcript below shows by producing no events
at all. Doing that for one stage and not the next was the inconsistency; there was never a reason a
program that cannot be *read* should be refused while a program whose names cannot be *resolved* runs
half of itself.

Three details make that rule safe rather than merely strict:

- **The profile set comes from the caller, never from a default.** `spec/tooling.md:176` already
  requires the semantic layer to "use the active conformance profile set when deciding which
  primitives and profile block-heads are available", and this is where that requirement earns its
  keep: measured at `2a1888c1`, `forward 100` checks `ol-unknown-command` under `core-language`
  alone and clean once `turtle-rendering` is active. A check-before-run gate reading the wrong
  profile set would refuse to run every turtle program ever written.
- **Style lints never block a run.** `ol-style-*` findings are `severity: warning`
  (`spec/tooling.md:233`), and a warning "MUST NOT change program meaning"
  (`spec/error-model.md:86`). Blocking a run on one would do exactly that.
- **Any teaching opt-out is opt-*out*, never the default.** A host may choose to let a learner run
  an unfinished program on purpose; it may not silently restore silence for everyone.

**The evaluator never ends in silent deferral.** This is a narrow companion to the rule above, not a
duplicate of it, and it exists for the third case in the Context: the known name with no evaluator
branch. The checker cannot catch that class by construction, since the program is valid. It gets its
own diagnostic, distinct from `ol-unknown-command` and from `ol-undefined-var`, because it reports
**our** bug and not the learner's — and telling a learner they misspelled something they spelled
correctly is worse than saying nothing.

**A command used where a value is required is `ol-no-output`.** No new code: the rule already exists
and simply was not being applied to built-ins. `spec/execution-model.md:369` already states it in the
language's own vocabulary — "A procedure that reaches `return` is usable as a reporter; a procedure
that does not is a command. Using a command procedure where a value is required raises
`ol-no-output` at the call site" — and `spec/commands.md:15` classifies every built-in primitive on
that same axis, where "Kind is **Command**, **Reporter**, or **Special form**." `forward` **is** a
command. The change is one generalized word, from "command procedure" to "command", built-in or
user-defined.

Where that is caught differs by what is knowable statically. A built-in's Kind is part of its
registration row and cannot be left unstated (`packages/parser/src/signatures.ts`, issue #932), so
the built-in case is statically decidable and belongs to the **semantic** stage. Whether a *user*
procedure reaches `return` can depend on a branch, so it is not statically decidable in general and
stays a **runtime** diagnostic at the call site — which is where `spec/error-model.md:114` already
puts it: "reported at the call site."

**When two stages describe the same mistake, the learner sees the better message.** The commonest
learner typo is a misspelled command *with* an argument, and it produced this, measured at
`2a1888c1`:

```text
fowad 100

  check()   -> ol-unknown-command  { name: "fowad", suggestion: "forward" }
  execute() -> ol-bad-token        { text: "100" }
```

`fowad` **alone** reported correctly; the wrong message appeared only once the command had an
argument, because an unregistered name is given arity `0` and the `100` is left over as a stray
token. So the learner who pressed Run was handed a diagnostic pointing at the `100` — the argument
blamed, the typo unmentioned — while the exact message the spec's own Philosophy section holds up as
the model, `i don't know how to fowad. did you mean forward?` (`spec/error-model.md:20`), already
existed one stage earlier. The decision therefore includes a de-duplication rule: when a parse
diagnostic blames a stray argument and the semantic stage names the unknown callee, the learner sees
the typo.

## Rationale

### Silence is the only outcome that teaches the wrong thing

OpenLogo's pedagogy is constructionist, and its first move is literally to make the result visible:
"**See it** — a movement, turn, mark, value, **or error** becomes visible"
(`spec/educational-model.md:15`). A vanished statement is the one result that cannot be seen. The
learner sees a drawing with a piece missing and no reason for it, and the debugging skill the moment
was supposed to teach — *look at what the language told you* — has nothing to attach to. Worse, the
lesson that does land is the wrong one: that the computer sometimes just ignores you.

Every other design in this area is defensible. A language may report an unknown name early, or
report it late; both are teachable, and reasonable languages do each. What no design defends is
saying nothing, because a learner has no way to distinguish "your program is wrong" from "your
program is right and did nothing interesting."

### The cost matrix for a learner is not the cost matrix for a professional

Strictness is a trade, and in a general-purpose language it is a genuinely contested one: refusing to
run an incomplete program costs an experienced programmer real time in the inner loop, which is why
dynamic languages that defer name errors to the moment of use are popular and successful. That
argument is about a user who can *read a stack trace and reason backwards*.

A learner cannot yet do that. For a learner the ordering of outcomes is different, and it is worth
stating explicitly:

1. **Best** — the program is right and runs.
2. **Good** — the program is wrong, and the language says which word is wrong and what to try.
3. **Bad** — the program is wrong and the language stops with a confusing message.
4. **Worst** — the program is wrong, runs anyway, and produces something that looks plausible.

Outcome 4 is the expensive one, because the learner has no independent way to check the answer. The
turtle drew *something*; a wrong drawing and a right drawing are equally convincing to someone who is
still learning what the right drawing should look like. Sitting at the strict end of the spectrum
buys a shift from 4 to 2, which is the only trade in this list a learner-facing language should be
eager to make. The inner-loop cost that makes the trade contested elsewhere is also much smaller here:
OpenLogo programs are short, and the studio re-checks as the learner types, so "refuse to run" arrives
as a message beside the line rather than as a lost minute.

### Check-before-run is how a language without a compiler gets compile-time behaviour

OpenLogo has no separate compilation step to hang an error on. It does have a semantic stage that
already computes the answer, and `spec/error-model.md:76` already leans this way for the whole
diagnostic model: "If an implementation can detect a condition earlier without changing behavior, it
SHOULD report the earlier stage. The `code` remains the same; the `stage` records when it was found."

Running that stage before execution and honouring its verdict is what turns a SHOULD about *when a
diagnostic is reported* into an observable guarantee about *whether a wrong program runs*. It is
also the smaller of the two available designs: the checker exists, its rules exist, and its codes
are already normative. The alternative — teaching the evaluator to detect each of these conditions
again as it goes — would duplicate every rule in `spec/tooling.md`'s Layer 2 table into a second
implementation that could drift from the first, and would still report the fault only once execution
reached it, after the earlier half of the drawing had already happened.

The narrow evaluator net is kept precisely because it is *not* that duplicate. It has one job the
checker cannot do: notice that the implementation itself has no answer.

### The command-in-value-position fault needed a generalization, not an invention

Two alternatives to the rule already written down were considered, and both were rejected.

A **new** code was rejected because `spec/execution-model.md:369` already describes the correct
outcome for a command in value position, and `spec/commands.md:15` already puts built-in primitives
on the same Command/Reporter axis that sentence turns on. Adding a second code for "the same fault,
but the callee happens to be built in" would give learners two names for one idea and give the
Educational profile's `explain`/`why` two templates to keep consistent.

**`ol-reserved-word` was rejected on stronger grounds**: it would have been wrong, not merely
redundant. [LDR-0007](0007-binding-vs-registration.md) records the settled rule that a program may
not *declare* a built-in name but may *bind* a value to any name (`spec/grammar.md:363`), and
`spec/grammar.md:386` requires that an
implementation "MUST NOT raise `ol-reserved-word` — or any other diagnostic — for the name alone" in
binding positions, "at any stage". `wait forward 5` is neither a declaration nor a binding — it is a
**use** — so reaching for that code would have blurred a distinction the language had just spent a
whole ruling sharpening. It would also have missed half the fault: the `p` in `wait p` is a user
procedure, not a built-in name, and leaving that case silent is the exact failure this decision
exists to end.

`ol-no-value` was not a candidate either, for a reason worth recording because it is easy to
misread: it is scoped to a `map`/`filter`/`reduce` **body** that produces no final value
(`spec/error-model.md:115`). That is a body-shaped fault. This one is a call-site fault, which is
`ol-no-output`'s territory.

### A better message must not lose to a worse one

`spec/error-model.md:13` opens with "OpenLogo errors are part of teaching," and
`spec/error-model.md:196` makes did-you-mean a **MUST** for `ol-unknown-command`. A language can
satisfy both of those and still fail the learner, if the message that reaches them is chosen by
accident of stage ordering rather than by usefulness. `fowad 100` was that failure: two true
diagnostics, and the less useful one won because it happened to be produced by an earlier stage.

This is a second, independent reason for the decision, and it is worth separating from the first.
Even if silence had never existed, a language that computes `did you mean forward?` and then blames
the `100` is not delivering what `spec/error-model.md`'s Philosophy section promises. Fixing
silence and fixing precedence happen to have the same cause — the run path not consulting the stage
that knew — but they would each have justified the change alone.

## How other languages do it

Every claim below was checked against a primary source — a language specification, an official
reference, or the canonical compiler's own message table — and each is linked. Where a source says
something narrower than the familiar folklore, the narrower thing is what is written here.

### A name that resolves to nothing

Languages split into two families, and OpenLogo before this decision belonged to neither.

**Family 1 — refuse to run.** The name is resolved before anything executes, and a program that
fails resolution produces no runnable artifact at all.

| Language | What the source says | Reported as |
|---|---|---|
| Go | *"Every identifier in a program must be declared."* ([Go spec, Declarations and scope](https://go.dev/ref/spec#Declarations_and_scope)) | `undefined: x` |
| Rust | Name resolution failure is error [E0425](https://doc.rust-lang.org/error_codes/E0425.html), whose official index text opens *"An unresolved name was used."* | a resolution error; compilation fails |
| Java | §6.5.6.1's enumeration of how a simple expression name is resolved ends *"Otherwise, a compile-time error occurs."* ([JLS SE21 §6.5](https://docs.oracle.com/javase/specs/jls/se21/html/jls-6.html)) | `cannot find symbol` |
| C# | *"Otherwise, the simple_name is undefined and a compile-time error occurs."* ([ECMA-334 §12.8.4](https://github.com/dotnet/csharpstandard/blob/draft-v9/standard/expressions.md)) | [CS0103](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/cs0103), *"The name 'x' does not exist in the current context"* |
| Elm | The compiler rejects the module during canonicalization and emits no JavaScript ([`Reporting/Error/Canonicalize.hs`](https://github.com/elm/compiler/blob/master/compiler/src/Reporting/Error/Canonicalize.hs)) | a `NAMING ERROR` reading "I cannot find a `x` variable:" |
| Racket (**module**) | *"At phase level 0, `(#%top . id)` is an immediate syntax error if `id` is not bound."* ([Racket Reference, `#%top`](https://docs.racket-lang.org/reference/__top.html)) | `x: unbound identifier` |

Racket is worth stating carefully, because the popular summary overshoots: the immediate-error rule
is scoped to a module. The same page says that *"in a top-level context, `(#%top . id)` always refers
to a top-level variable, even if `id` is unbound"*, so at the REPL the reference is deferred and the
failure surfaces at run time instead. A Racket **module** refuses to run; the Racket top level does
not.

**Family 2 — run, and raise when the reference is reached.** The program starts, everything before
the bad line happens for real, and the error arrives at the moment of use.

- **Python** raises [`NameError`](https://docs.python.org/3/library/exceptions.html) — *"Raised when
  a local or global name is not found."* The timing is specified, not incidental: *"Name resolution
  of free variables occurs at runtime, not at compile time"*
  ([Language Reference, execution model](https://docs.python.org/3.12/reference/executionmodel.html#interaction-with-dynamic-features)).
  Python does compile the whole module first, so a `SyntaxError` prevents any execution — the
  parse/semantic split OpenLogo has, with the line drawn one stage earlier.
- **JavaScript** throws a `ReferenceError`, and the specification says so directly:
  `GetValue` step 2 is *"If IsUnresolvableReference(refRecord) is true, throw a **ReferenceError**
  exception."*
  ([ECMA-262 §6.2.5.5](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-getvalue)).
- **Ruby** raises `NameError` for an undefined bare name and `NoMethodError` for a message the
  receiver does not implement, both when the expression is evaluated
  ([`error.c`](https://github.com/ruby/ruby/blob/master/error.c)).
- **Smalltalk** turns an unimplemented message send into a run-time `doesNotUnderstand:` on the
  receiver ([Pharo `Object`](https://github.com/pharo-project/pharo/blob/Pharo12/src/Kernel/Object.class.st)).
  That is the safely citable part; how an unknown *variable* is handled is an image/IDE interaction
  rather than a language rule, so this record claims nothing about it.
- **Classic Logo** is in this family too. Berkeley Logo's error table lists *"13 I don't know how to
  PROC (recoverable)"* and *"24 I don't know how to PROC (not recoverable)"*
  ([UCBLogo user manual, ERROR CODES](https://github.com/jrincayc/ucblogo-code/blob/master/usermanual)),
  raised when the line is evaluated. One honest caveat, because the default configuration matters:
  `ALLOWGETSET` is TRUE by default, so a bare argumentless unknown name is first tried as an implicit
  variable getter and may instead produce *"11 VAR has no value"*. The message is not guaranteed —
  but an error is.

**And nobody is silent.** The weakest mainstream behaviour found is PHP's, and it is still not
silence: since PHP 8, reading an undefined variable is a **Warning** (upgraded from a notice) and the
expression evaluates to `null`, which the manual demonstrates with its own transcript
(*"Warning: Undefined variable $unset_var"*,
[Variable basics](https://www.php.net/manual/en/language.variables.basics.php);
[PHP 8.0 backward-incompatible changes](https://www.php.net/manual/en/migration80.incompatible.php)).
Two genuinely silent cases do exist and are worth naming rather than glossing over — PHP's array
autovivification from an undefined variable, documented as producing no warning, and JavaScript's
sloppy-mode assignment to an undeclared name, which creates a global because `PutValue` throws only
when the reference is strict
([ECMA-262 §6.2.5.6](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-putvalue)).
Both are a *binding being created*, not an unknown name being read. On the actual question — what
happens when a program uses a name that resolves to nothing — the field is unanimous, and OpenLogo
was off the map: it neither refused nor raised.

Given a choice between the two families, OpenLogo takes Family 1. The reason is the second row of the
cost matrix above: Family 2's guarantee is "you will find out when you get there", and a learner
whose drawing is half-finished has no way to tell "I got there and it failed" from "I never got
there."

### A command used where a value is required

This is the fault with the sharper cross-language lesson, because here the languages disagree with
each other and one of them is a cautionary tale.

**Java rejects it outright**, and the rule is written in exactly the terms OpenLogo uses: *"If the
compile-time declaration is `void`, then the method invocation must be a top level expression … or a
compile-time error occurs. Such a method invocation produces no value and so must be used only in a
situation where a value is not needed."*
([JLS SE21 §15.12.3](https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html)); `javac` says
`'void' type not allowed here`.

**Go rejects it too**, though by typing rather than by an explicit prohibition: a function declared
with no results has no result type, so a call to it satisfies no context that needs a value, and the
compiler reports `f() (no value) used as value`
([`types2/operand.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/types2/operand.go),
[`types2/expr.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/types2/expr.go)).

**Rust does *not* reject it**, and this is the place where "statically typed languages catch it" turns
out to be too broad a claim to make. A function with no declared return type returns the unit value
`()` — *"the tuple type with no fields (`()`) is often called unit"*, and *"various expressions will
produce the unit value if there is no other meaningful value for it to evaluate to"*
([The Rust Reference, tuple types](https://doc.rust-lang.org/reference/types/tuple.html)) — so
`let x = f();` compiles happily and binds unit. Only using that unit where a different type is
expected is an error ([E0308](https://doc.rust-lang.org/error_codes/E0308.html)). Rust is closer to
Python here than the static/dynamic split would suggest.

**Python is the cautionary tale, and it is the exact trap this decision exists to avoid.**
`x = print("hi")` binds `None`. There is no error, no warning, and nothing in the output to notice.
The chain is specified rather than accidental: `print` has no explicit return, and the Language
Reference says of `None` that *"it is returned from functions that don't explicitly return anything"*
([Data model §3.2.1](https://docs.python.org/3/reference/datamodel.html)), which the tutorial
restates as *"even functions without a `return` statement do return a value, albeit a rather boring
one"*
([Defining functions](https://docs.python.org/3/tutorial/controlflow.html#defining-functions)). The
result is a wrong value flowing onward through the program with no diagnostic anywhere — the shape
of failure ranked worst in the cost matrix above. It is a perfectly coherent choice for a language
whose users can inspect `x` and reason about `None`; it is the wrong choice for a language whose
users are ten.

**Classic Logo rejects it, including for built-ins** — which matters, because it means the OpenLogo
decision restores heritage behaviour rather than inventing a rule. Berkeley Logo's error 5 is the
template *"PROC didn't output to PROC"* (user manual, ERROR CODES), and the placeholders are generic:
Berkeley's own implementation notes work through a case whose expected message is
`print didn't output to output  in foo`
([`plm`](https://github.com/jrincayc/ucblogo-code/blob/master/plm)) — with the **primitive** `print`
on the left-hand side. UCBLogo also reports the converse, *"9 You don't say what to do with DATUM"*,
when a value is produced and nothing consumes it.

### The heritage line

Read together, the two OpenLogo codes are not new ideas but old ones given stable identities:

| Berkeley Logo | OpenLogo |
|---|---|
| `I don't know how to PROC` (errors 13 / 24) | `ol-unknown-command`, whose learner message at `spec/error-model.md:97` is literally *"i don't know how to {name}. did you mean {suggestion}?"* |
| `PROC didn't output to PROC` (error 5), primitives included | `ol-no-output` (`spec/error-model.md:114`), generalized here from "command procedure" to "command" |

What OpenLogo adds is the stage. Classic Logo tells you at run time, when the interpreter reaches the
line; OpenLogo tells you before the run starts, so nothing has been drawn yet that the learner will
have to un-see.

## Consequences

**What it enables.**

- A learner's program either runs or says why it does not. There is no third result to explain, and
  no state in which the honest answer to "why didn't it draw?" is "I don't know."
- `explain`, `why`, `hint`, and `debug` have something to work with. Those commands are deterministic
  and template-based (`spec/educational-model.md:435`) and they build their answers from the parsed
  program, source spans, trace events and **diagnostics** — so a fault that produces no diagnostic is
  a fault the Educational profile is structurally unable to teach. Refusing to run converts an
  unteachable event into a teachable one.
- The three faults in the Context become distinguishable from the outside: a misspelled name, a
  command used as a value, and a primitive the implementation has not finished. The third one says
  so, which means a learner never spends an afternoon debugging a program that was correct.
- Diagnostics stop competing. Choosing the message by usefulness rather than by stage order means the
  did-you-mean that `spec/error-model.md:196` requires actually reaches the person it was computed
  for.

**What it forecloses, and what it costs.**

- **Partial runs of a program with a bad name are gone.** A program with one misspelled word no
  longer draws the other nine shapes first. This is a real loss for a particular workflow — sketching
  the whole drawing, then filling in the procedure names — and it is accepted deliberately, because
  the same behaviour is indistinguishable from a program that is finished and wrong. A host that
  wants the sketching workflow back must opt *out* explicitly.
- **The gate is only as good as the profile set it is given.** This decision moves the active
  profile set from a detail of the checker's configuration onto the critical path of every run: get
  it wrong and a correct turtle program is refused. `spec/tooling.md:176` is what keeps that safe, and
  it is now load-bearing in a way it was not before.
- **The semantic stage acquires a new obligation: it must not be wrong.** A false positive used to be
  a spurious squiggle in the editor; it now stops a run. That raises the cost of adding an
  over-eager Layer 2 rule, and is the reason `spec/tooling.md:196` — "Tools MUST NOT report
  speculative type errors when dynamic values are unknown" — matters more after this decision than
  before it.
- **Two stages can now report the same underlying mistake, so precedence is permanent work.** Every
  future diagnostic that can be produced by both parse and semantic analysis inherits the `fowad 100`
  question, and answering it is now part of adding one.
- **OpenLogo lands at the strict end of the spectrum and stays there.** A later profile that wanted
  looser, more exploratory behaviour would be reversing this record, not extending it, and would need
  a superseding LDR.

## Spec references

This record explains, and does not restate, the following normative text:

- `spec/error-model.md` — the [Philosophy](../../spec/error-model.md#philosophy) section
  (`spec/error-model.md:13`, and the `i don't know how to fowad. did you mean forward?` example at
  `spec/error-model.md:20`); [Stages](../../spec/error-model.md#stages), which defines `parse`,
  `semantic` and `runtime` (`spec/error-model.md:59`, `spec/error-model.md:65`) and the earlier-stage
  rule (`spec/error-model.md:76`); [Severity](../../spec/error-model.md#severity)
  (`spec/error-model.md:86`); the [normative code
  registry](../../spec/error-model.md#normative-code-registry) rows for `ol-unknown-command`
  (`spec/error-model.md:97`), `ol-no-output` (`spec/error-model.md:114`) and `ol-no-value`
  (`spec/error-model.md:115`); and [Did-you-mean](../../spec/error-model.md#did-you-mean)
  (`spec/error-model.md:196`).
- `spec/execution-model.md` — the reporter/command rule and `ol-no-output` at the call site
  (`spec/execution-model.md:369`).
- `spec/commands.md` — the primitive-entry shape whose **Kind** is Command, Reporter or Special form
  (`spec/commands.md:15`).
- `spec/tooling.md` — [Layer 2: semantic checking](../../spec/tooling.md#layer-2-semantic-checking),
  its active-profile-set requirement (`spec/tooling.md:176`) and its prohibition on speculative type
  errors (`spec/tooling.md:196`); and [Layer 3: style
  lints](../../spec/tooling.md#layer-3-style-lints), which makes style findings warnings
  (`spec/tooling.md:233`).
- `spec/grammar.md` — the declare-versus-bind rule (`spec/grammar.md:363`) and the prohibition on
  raising `ol-reserved-word` for a bound name at any stage (`spec/grammar.md:386`), which is why that
  code was not the answer to a *use*.
- `spec/educational-model.md` — the constructionist "See it" step, in which an error is one of the
  things that must become visible (`spec/educational-model.md:15`), and the deterministic,
  diagnostic-driven baseline for `explain`/`why`/`hint`/`debug`
  (`spec/educational-model.md:435`).

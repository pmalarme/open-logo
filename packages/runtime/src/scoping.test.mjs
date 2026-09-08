// Runtime scoping — issue #824, the executable form of `spec/execution-model.md`'s
// § *Variables, scoping, and procedures* (the #821 ruling).
//
// One sentence decides every case below: **a name is born where it is first assigned, lives until
// that scope ends, and a procedure's edge is sealed.** These tests run whole programs through the
// public `execute()` and assert what a learner would see — printed values and `ol-*` diagnostics —
// rather than poking at frames, because the frame chain is an implementation of the rule and the
// rule is what the spec states.
//
// Four of the behaviours here are BEHAVIOUR CHANGES, and each was mutation-checked against the
// runtime this slice replaced (measured, not assumed):
//
//   - recursion (`:tmp` per frame)         printed `0 0 0`   before, `0 1 2`   now
//   - handler capture in a loop            printed `30 30 30` before, `10 20 30` now
//   - a procedure reading a caller's block printed `[5] [5]` before, diagnoses now
//   - a block-local name outliving its `]` printed `1`       before, diagnoses now
//
// and two were SILENT WRONG ANSWERS that `local`/`global` parsing (issue #823) had left behind:
// `:count = 0 / local count = 5 / print :count` printed `0`, and `:count = 5 / global count = 0 /
// print :count` printed `5`. Both are pinned below.
//
// **One root cause underlies all of them**, and the review gate's QA reviewer named it: the old
// `assignVar` created an unbound name in the ROOT frame — globals by default — where this model
// creates it in the current scope. Every case above, plus sibling-procedure leakage and the
// write-first shadow, is a consequence of that single change. The block-lifetime half reaches every
// block form, not just `if`/`else`: `while`, `repeat`, `for`, `ask`, `each`, handler bodies, and a
// comprehension body all now end their own names' lives, and each is pinned here.
//
// The `local`/`global` NON-regressions that the same rules imply — the accumulator idiom, `for`/
// comprehension binders, mutation through a parameter — are pinned here too, because this slice's
// whole risk is over-reaching: sealing too much would break exactly those.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "scoping.logo";

/** Run `source`, asserting a clean run, and report the printed values in order. */
function printsOf(source, options = undefined) {
  const result = execute(source, doc, options);
  assert.deepEqual(
    result.diagnostics,
    [],
    `expected a clean run for ${JSON.stringify(source)}`,
  );
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

/** Run `source` and report its single diagnostic, asserting there is exactly one. */
function soleDiagnosticOf(source) {
  const { diagnostics } = execute(source, doc);
  assert.equal(
    diagnostics.length,
    1,
    `expected exactly one diagnostic for ${JSON.stringify(source)}, got ${JSON.stringify(diagnostics.map((diagnostic) => diagnostic.code))}`,
  );
  return diagnostics[0];
}

// --- The sealed procedure boundary (spec/execution-model.md:381-453) --------------------------

test("a procedure cannot see a plain top-level name — the READ raises ol-var-not-visible, naming the boundary", () => {
  // `spec/execution-model.md:431-447`'s own worked example, verbatim. The diagnostic fires on the
  // read because the read comes first, and its message must name the boundary and the one-word fix
  // — a generic "undefined variable" is explicitly not sufficient (`spec/error-model.md:132`).
  const diagnostic = soleDiagnosticOf(
    ":count = 0\ndefine draw_steps\n  repeat 4 [\n    forward :count * 10\n    :count = :count + 1\n  ]\nend\ndraw_steps",
  );

  assert.equal(diagnostic.code, "ol-var-not-visible");
  assert.deepEqual(diagnostic.params, {
    name: "count",
    procedure: "draw_steps",
  });
  assert.equal(diagnostic.stage, "runtime");
  assert.match(diagnostic.message, /:count is not defined inside draw_steps/);
  assert.match(diagnostic.message, /global count = \(its starting value\)/);
});

test("the same program with `global count = 0` runs, and the global accumulates across calls", () => {
  assert.deepEqual(
    printsOf(
      "global count = 0\ndefine bump\n  :count = :count + 1\nend\nbump\nbump\nprint :count",
    ),
    [2],
  );
});

test("a procedure's first touch of an INVISIBLE name being a WRITE silently creates a procedure-local — ruled correct, never diagnosed", () => {
  // Deliberately asserted rather than left implicit: it is a genuinely different variable, so no
  // diagnostic belongs here (`spec/execution-model.md:443-446`). The top-level `:x` is untouched
  // and the procedure's own `:x` is gone once the call returns.
  assert.deepEqual(
    printsOf(
      ":x = 1\ndefine shadow\n  :x = 99\n  print :x\nend\nshadow\nprint :x",
    ),
    [99, 1],
  );
});

test("VISIBILITY decides which binding a write reaches, never statement order: a write-first procedure UPDATES a visible global", () => {
  // The load-bearing qualifier. An unqualified "write-first creates a local" reading would print 5
  // and leave `global` readable-but-not-writable, defeating the ruling's headline feature.
  assert.deepEqual(
    printsOf(
      "global count = 5\ndefine reset\n  :count = 0\nend\nreset\nprint :count",
    ),
    [0],
  );
});

test("read-first and write-first reach the SAME global — ordering must not change which binding is targeted", () => {
  const readFirst = printsOf(
    "global count = 5\ndefine bump\n  :count = :count + 1\nend\nbump\nprint :count",
  );
  const writeFirst = printsOf(
    "global count = 5\ndefine reset\n  :count = 0\n  :count = :count + 1\nend\nreset\nprint :count",
  );

  assert.deepEqual(readFirst, [6]);
  assert.deepEqual(writeFirst, [1]);
});

test("a procedure cannot see the BLOCK that called it — dynamic scope is not scope", () => {
  // BEHAVIOUR CHANGE: this printed `[5] [5]` before the seal. The code is `ol-undefined-var` rather
  // than `ol-var-not-visible` because the boundary is not what hid it: `:temp` is born in a block
  // scope, and a block encloses no procedure body (see the lexical-set tests below).
  const diagnostic = soleDiagnosticOf(
    "define helper\n  print :temp\nend\nrepeat 2 [ :temp = 5   helper ]",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "temp" });
});

test("a procedure cannot see its CALLER's parameters or locals either", () => {
  const diagnostic = soleDiagnosticOf(
    "define inner\n  print :hidden\nend\ndefine outer :hidden\n  inner\nend\nouter 7",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "hidden" });
});

test("a SIBLING procedure's binding is invisible too — a different failure site from a top-level name", () => {
  // Found by `@testing` in the review gate: this is not the same case as reading a name the top
  // level binds. `:o` is born in `outer`'s frame, which encloses nothing `inner` is written inside,
  // so `inner`'s read is the ordinary failed read. Before the seal it printed `1`.
  const diagnostic = soleDiagnosticOf(
    "define outer\n  :o = 1\n  inner\nend\ndefine inner\n  print :o\nend\nouter",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "o" });
});

test("the boundary governs the VARIABLE namespace only — a procedure still calls primitives, procedures, and itself", () => {
  assert.deepEqual(
    printsOf(
      "define double :n\n  return :n * 2\nend\ndefine quadruple :n\n  return double double :n\nend\nprint quadruple 3",
    ),
    [12],
  );
});

test("a postfix place's base is a READ, so writing through one a procedure cannot see raises on the base", () => {
  // `spec/execution-model.md:492-499`: `:people = <value>` inside a procedure that cannot see
  // `people` silently creates a local, while `:people.tom = <value>` raises on the base, because
  // only the second needs an existing value to write into.
  const diagnostic = soleDiagnosticOf(
    ":people = { tom: 1 }\ndefine age\n  :people.tom = 99\nend\nage",
  );

  assert.equal(diagnostic.code, "ol-var-not-visible");
  assert.deepEqual(diagnostic.params, { name: "people", procedure: "age" });
});

test('`thing "name"` is sugar for `:name`, so it hits the same boundary with the same identity', () => {
  const sugar = soleDiagnosticOf(
    ":count = 0\ndefine peek\n  print :count\nend\npeek",
  );
  const spelled = soleDiagnosticOf(
    ':count = 0\ndefine peek\n  print thing "count"\nend\npeek',
  );

  assert.equal(spelled.code, "ol-var-not-visible");
  assert.deepEqual(spelled.params, sugar.params);
});

test("resolution is case-insensitive, so `:Count` and `:count` are ONE condition with one identity", () => {
  const diagnostic = soleDiagnosticOf(
    ":count = 0\ndefine peek\n  print :Count\nend\npeek",
  );

  assert.equal(diagnostic.code, "ol-var-not-visible");
  assert.deepEqual(diagnostic.params, { name: "count", procedure: "peek" });
});

test("the code choice is LEXICAL, not temporal — a read that runs before the top-level assignment line is still boundary-hidden", () => {
  // `spec/execution-model.md:405-414` and `spec/error-model.md:132`: "a name an enclosing scope
  // binds anywhere in the declaring document takes this code whether or not that binding has been
  // created by the time the read executes", which is what keeps it decidable at the `semantic`
  // stage — so the runtime and issue #825's checker report ONE identity for one condition rather
  // than two that disagree on execution order.
  const diagnostic = soleDiagnosticOf(
    "define peek\n  print :later\nend\npeek\n:later = 1",
  );

  assert.equal(diagnostic.code, "ol-var-not-visible");
  assert.deepEqual(diagnostic.params, { name: "later", procedure: "peek" });
});

test("a name no scope binds at all is the ordinary ol-undefined-var, boundary or not", () => {
  const diagnostic = soleDiagnosticOf(
    "define peek\n  print :nowhere\nend\npeek",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "nowhere" });
});

test("a name declared `global` is NOT boundary-hidden, so a read before its declaration line is ol-undefined-var", () => {
  // `spec/execution-model.md:412-414` states this exception explicitly: the declaration takes effect
  // when it runs, and until then the name is simply unbound "like any other name".
  const diagnostic = soleDiagnosticOf(
    "define peek\n  print :count\nend\npeek\nglobal count = 0",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "count" });
});

test("the `global` exception wins even where the root scope ALSO assigns the name plainly", () => {
  // The discriminating case, and the one a mutation check found the previous test could not reach:
  // with only a `global` declaration in the document there is no plain root binding to exclude, so
  // an implementation that forgot the exclusion still looked right. Here `:count = 5` puts the name
  // in the root scope's lexical set AND `global count = 0` takes it out again
  // (`spec/execution-model.md:412-414` with `:576-580` — the declaration names that same binding),
  // so a read running before either line is an ordinary unbound read, not a boundary-hidden one.
  const diagnostic = soleDiagnosticOf(
    "define peek\n  print :count\nend\npeek\n:count = 5\nglobal count = 0",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "count" });
});

test("a name only a top-level BLOCK binds is not boundary-hidden — a block encloses no procedure body", () => {
  // The lexical set is the ROOT scope's own names. `:temp` is born in the `repeat` body, which is a
  // block scope and encloses nothing the procedure is written inside, so the boundary is not what
  // hid it: this is `ol-undefined-var`, the ordinary failed read (`spec/error-model.md:102`).
  const diagnostic = soleDiagnosticOf(
    "define helper\n  print :temp\nend\nrepeat 2 [ :temp = 5   helper ]",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "temp" });
});

// --- The boundary seals names, not values (spec/execution-model.md:455-474) --------------------

test("a procedure DOES mutate a list its caller handed it — required non-diagnosis", () => {
  assert.deepEqual(
    printsOf(
      "define push_last :items\n  add 99 to :items\nend\n:numbers = [1 2]\npush_last :numbers\nprint :numbers",
    ),
    [[1, 2, 99]],
  );
});

test("a procedure DOES mutate a record field through a parameter — required non-diagnosis", () => {
  assert.deepEqual(
    printsOf(
      "struct point [ x y ]\ndefine move_it :p\n  :p.x = 99\nend\n:q = point 1 2\nmove_it :q\nprint :q.x",
    ),
    [99],
  );
});

test("rebinding a parameter never escapes, while mutating through it always does", () => {
  assert.deepEqual(
    printsOf(
      "define rebind :items\n  :items = [7]\nend\n:numbers = [1 2]\nrebind :numbers\nprint :numbers",
    ),
    [[1, 2]],
  );
});

// --- Blocks: lifetime boundary, not a write boundary (spec/execution-model.md:595-615) ---------

test("the two-loop contrast IS the rule: born inside prints 1 1 1 1, born outside prints 1 2 3 4", () => {
  assert.deepEqual(
    printsOf("repeat 4 [ :x = 0   :x = :x + 1   print :x ]"),
    [1, 1, 1, 1],
  );
  assert.deepEqual(
    printsOf(":x = 0\nrepeat 4 [ :x = :x + 1   print :x ]"),
    [1, 2, 3, 4],
  );
});

test("the accumulator idiom keeps working — a block MAY update a binding its enclosing scope holds", () => {
  assert.deepEqual(
    printsOf(":total = 0\nrepeat 4 [ :total = :total + 1 ]\nprint :total"),
    [4],
  );
});

test("a name born inside a `repeat` body is gone after the `]`", () => {
  // BEHAVIOUR CHANGE: this printed `1` before blocks were scopes.
  const diagnostic = soleDiagnosticOf("repeat 3 [ :i = 1 ]\nprint :i");

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "i" });
});

test("`if`, `while`, `forever`, and `for` bodies are all block scopes, on both branches of `if`", () => {
  for (const source of [
    "if 1 < 2 [ :y = 5 ]\nprint :y",
    "if 1 > 2 [ print 0 ] else [ :y = 5 ]\nprint :y",
    ":n = 0\nwhile :n < 1 [ :n = 1   :z = 9 ]\nprint :z",
    "define run\n  forever [ :w = 9   stop ]\nend\nrun\nprint :w",
    "for k in [1 2] [ :inner = 1 ]\nprint :inner",
    "for k from 1 to 2 [ :inner = 1 ]\nprint :inner",
  ]) {
    assert.equal(
      soleDiagnosticOf(source).code,
      "ol-undefined-var",
      `expected the block-local name to be gone after the block in ${JSON.stringify(source)}`,
    );
  }
});

test("a block nested in a block sees out through every enclosing scope it is written in", () => {
  assert.deepEqual(
    printsOf(
      ":total = 0\nrepeat 2 [ repeat 3 [ :total = :total + 1 ] ]\nprint :total",
    ),
    [6],
  );
});

test("a block inside a procedure body sees everything the body sees, and nothing more", () => {
  assert.deepEqual(
    printsOf(
      "define total :n\n  :sum = 0\n  repeat :n [ :sum = :sum + repcount ]\n  return :sum\nend\nprint total 4",
    ),
    [10],
  );
});

test("`stop` leaving a block leaks none of the block's own names", () => {
  const diagnostic = soleDiagnosticOf(
    "define run_once\n  repeat 3 [ :inside = 1   stop ]\nend\nrun_once\nprint :inside",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "inside" });
});

// --- Fresh bindings per scope entry, and recursion (spec/execution-model.md:371-379) -----------

test("each recursive call gets its own binding for a name its body creates", () => {
  // BEHAVIOUR CHANGE: this printed `0 0 0` — every frame shared one top-level `:tmp`.
  assert.deepEqual(
    printsOf(
      "define f :n\n  :tmp = :n\n  if :n > 0 [ f :n - 1 ]\n  print :tmp\nend\nf 2",
    ),
    [0, 1, 2],
  );
});

test("parameters were already per-frame and stay that way — non-regression", () => {
  assert.deepEqual(
    printsOf("define f :n\n  if :n > 0 [ f :n - 1 ]\n  print :n\nend\nf 2"),
    [0, 1, 2],
  );
});

// --- Handler capture and frame lifetime (spec/execution-model.md:617-669) ----------------------

test("each turn of a loop captures its OWN binding — handlers registered in different passes see different values", () => {
  // BEHAVIOUR CHANGE: this printed `30 30 30`, the JS `var`-in-a-loop bug. It is now a MUST in the
  // spec's own worked example (`spec/execution-model.md:625-633`).
  assert.deepEqual(
    printsOf(
      ":i = 0\nrepeat 3 [ :i = :i + 1   :n = :i * 10   every 5 [ print :n ] ]\nwait 8",
    ),
    [10, 20, 30],
  );
});

test("the spec's own `repcount * 10` capture example prints 10, 20, 30", () => {
  assert.deepEqual(
    printsOf("repeat 3 [ :n = repcount * 10   every 5 [ print :n ] ]\nwait 8"),
    [10, 20, 30],
  );
});

test("a handler outlives the procedure frame that registered it", () => {
  assert.deepEqual(
    printsOf(
      "define setup :speed\n  every 5 [ print :speed ]\nend\nsetup 10\nwait 8",
    ),
    [10],
  );
});

test("capture is by BINDING, not by value — a handler sees a later write to the captured name", () => {
  assert.deepEqual(
    printsOf(":x = 1\nevery 5 [ print :x ]\n:x = 99\nwait 6"),
    [99],
  );
});

test("a handler block is itself a block scope: a name born in it dies with the invocation", () => {
  const diagnostic = soleDiagnosticOf(
    "every 5 [ :inside = 1 ]\nwait 6\nprint :inside",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "inside" });
});

test("a handler MAY update a name its captured scope holds — the on_click score idiom", () => {
  assert.deepEqual(
    printsOf(
      "global score = 0\nevery 5 [ :score = :score + 1 ]\nwait 8\nprint :score",
      {
        foreverIterationLimit: undefined,
      },
    ),
    [1],
  );
});

test("`repcount` inside a handler block has no enclosing `repeat` of its own, however the loop is placed", () => {
  // `spec/execution-model.md:682-690`: a handler invocation is a separate, deferred instruction, so
  // it is never on a turn of a `repeat` outside the handler block — including one still running.
  const diagnostic = soleDiagnosticOf(
    "repeat 2 [ every 4 [ print repcount ]   wait 8 ]",
  );

  assert.equal(diagnostic.code, "ol-repcount-outside-repeat");
});

test("a `repeat` written INSIDE a handler block is unaffected — it prints 1, 2, 3 on each firing", () => {
  assert.deepEqual(
    printsOf("every 5 [ repeat 3 [ print repcount ] ]\nwait 6"),
    [1, 2, 3],
  );
});

test("`repcount` in a procedure called from inside a `repeat` raises — dynamic loop state does not cross the boundary", () => {
  const diagnostic = soleDiagnosticOf(
    "define show_turn\n  print repcount\nend\nrepeat 2 [ show_turn ]",
  );

  assert.equal(diagnostic.code, "ol-repcount-outside-repeat");
});

// --- `local` (spec/commands.md:103-122, spec/execution-model.md:501-543) -----------------------

test("`local name = value` evaluates its initializer BEFORE creating the binding — the silent wrong answer #823 left behind", () => {
  // Measured before this slice: this program printed `0`, with zero diagnostics, because the
  // initializer was dropped on the floor. Before issue #823 it was an `ol-bad-token` parse error,
  // so the regression was loud-to-silent.
  assert.deepEqual(printsOf(":count = 0\nlocal count = 5\nprint :count"), [5]);
});

test("`local count = :count + 1` snapshots the binding the statement could already see", () => {
  assert.deepEqual(
    printsOf(
      "global count = 4\ndefine f\n  local count = :count + 1\n  print :count\nend\nf\nprint :count",
    ),
    [5, 4],
  );
});

test("the `local`-shadows-`global` worked example prints 5 then 0", () => {
  assert.deepEqual(
    printsOf(
      "global count = 0\ndefine f\n  local count = 5\n  print :count\nend\nf\nprint :count",
    ),
    [5, 0],
  );
});

test("`local` behaves IDENTICALLY in a block — the same program with `repeat 1 [ … ]` prints the same two lines", () => {
  const inProcedure = printsOf(
    "global count = 0\ndefine f\n  local count = 5\n  print :count\nend\nf\nprint :count",
  );
  const inBlock = printsOf(
    "global count = 0\nrepeat 1 [ local count = 5   print :count ]\nprint :count",
  );

  assert.deepEqual(inBlock, inProcedure);
});

test("a bare `local` shadows for real: the enclosing binding is untouched", () => {
  assert.deepEqual(
    printsOf(":x = 1\nrepeat 1 [ local x   :x = 99 ]\nprint :x"),
    [1],
  );
});

test("reading a bare `local` before anything assigns it is an ordinary ol-undefined-var", () => {
  const diagnostic = soleDiagnosticOf("repeat 1 [ local x   print :x ]");

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "x" });
});

test("the parenthesized multi-name form declares every name it lists", () => {
  assert.deepEqual(
    printsOf(
      ":a = 1\n:b = 2\nrepeat 1 [ (local a b)   :a = 9   :b = 9 ]\nprint :a\nprint :b",
    ),
    [1, 2],
  );
});

test("`local` shadowing a PARAMETER is legal and is not diagnosed", () => {
  assert.deepEqual(
    printsOf("define f :a\n  local a\n  :a = 99\n  print :a\nend\nf 1"),
    [99],
  );
});

test("at the ROOT scope `local` names the root scope's own binding and leaves an existing global global", () => {
  // `spec/execution-model.md:520-526`: a second, procedure-invisible binding beside a `global`
  // would hide shared state from every procedure without saying so.
  assert.deepEqual(
    printsOf(
      "global count = 0\nlocal count = 5\ndefine peek\n  print :count\nend\npeek",
    ),
    [5],
  );
});

test("a bare `local` at the root scope leaves an existing binding's VALUE alone", () => {
  assert.deepEqual(printsOf(":x = 7\nlocal x\nprint :x"), [7]);
});

test("the `local` initializer's own failure propagates as that expression's diagnostic", () => {
  const diagnostic = soleDiagnosticOf("local x = :missing + 1");

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "missing" });
});

test("a `local` initializer the evaluator does not implement is skipped rather than half-applied", () => {
  // The same "unsupported shape" gate every other statement operand uses. `forward` is a command,
  // not a reporter, so it has no expression-position branch in the evaluator; a `local` whose
  // initializer is one is therefore skipped exactly as an `Assign` of the same shape is — the name
  // is not bound to a wrong value, and no ad-hoc diagnostic is invented for what `check()` reports
  // properly (`execute()` runs `parse()` only, never `check()`).
  const { diagnostics } = execute("local x = forward 1\nprint 1", doc);

  assert.deepEqual(diagnostics, []);
});

// --- `global` (spec/commands.md:123-140, spec/execution-model.md:545-593) ----------------------

test("`global` declares AND initializes: the C3 entry's example prints 2", () => {
  assert.deepEqual(
    printsOf(
      "global count = 0\ndefine bump\n  :count = :count + 1\nend\nbump\nbump\nprint :count",
    ),
    [2],
  );
});

test("declaring `global` over an existing root binding assigns it and marks it shared — the second silent wrong answer", () => {
  // Measured before this slice: this printed `5`, with zero diagnostics.
  assert.deepEqual(printsOf(":count = 5\nglobal count = 0\nprint :count"), [0]);
});

test("a re-declaration assigns again rather than creating a second binding or raising ol-duplicate-definition", () => {
  assert.deepEqual(
    printsOf("global count = 1\nglobal count = 2\nprint :count"),
    [2],
  );
});

test("a name that was a plain top-level binding becomes visible to procedures once declared global", () => {
  assert.deepEqual(
    printsOf(
      ":count = 5\nglobal count = 0\ndefine bump\n  :count = :count + 1\nend\nbump\nprint :count",
    ),
    [1],
  );
});

test("a read that runs before the `global` line has run finds no binding", () => {
  const diagnostic = soleDiagnosticOf("print :count\nglobal count = 0");

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "count" });
});

test("`global` anywhere but the root scope raises ol-global-outside-root — procedure, block, and handler alike", () => {
  for (const [where, source] of [
    ["a procedure body", "define f\n  global count = 0\nend\nf"],
    ["a control-form body", "repeat 1 [ global count = 0 ]"],
    ["an if body", "if 1 < 2 [ global count = 0 ]"],
    ["a handler block", "every 5 [ global count = 0 ]\nwait 6"],
  ]) {
    const diagnostic = soleDiagnosticOf(source);
    assert.equal(
      diagnostic.code,
      "ol-global-outside-root",
      `expected ol-global-outside-root inside ${where}`,
    );
    assert.deepEqual(diagnostic.params, { name: "count" });
    assert.equal(diagnostic.stage, "runtime");
  }
});

test("a misplaced `global` has no effect at all — its initializer never runs", () => {
  // The placement is judged before the initializer is evaluated, so a misplaced declaration cannot
  // half-apply. `:count` is bound by nothing, and the run stops at the declaration.
  const { diagnostics, events } = execute(
    "repeat 1 [ global count = 0 ]\nprint :count",
    doc,
  );

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-global-outside-root"],
  );
  assert.deepEqual(
    events.filter((event) => event.kind === "print"),
    [],
  );
});

test("the `global` initializer's own failure propagates as that expression's diagnostic", () => {
  const diagnostic = soleDiagnosticOf("global count = :missing + 1");

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "missing" });
});

test("a `global` initializer the evaluator does not implement is skipped rather than half-applied", () => {
  // Same gate, same reason as the `local` case above: `forward` has no expression-position branch.
  const { diagnostics } = execute("global count = forward 1\nprint 1", doc);

  assert.deepEqual(diagnostics, []);
});

test("`global` is case-insensitive like every other name", () => {
  assert.deepEqual(
    printsOf("global Count = 3\ndefine peek\n  print :count\nend\npeek"),
    [3],
  );
});

// --- Binders: already correct, locked (spec/execution-model.md:769-808) ------------------------

test("a `for … in` binder is body-local and leaves a same-named outer binding alone", () => {
  assert.deepEqual(
    printsOf(":k = 99\nfor k in [1 2 3] [ print :k ]\nprint :k"),
    [1, 2, 3, 99],
  );
});

test("a comprehension binder does not escape its body", () => {
  const diagnostic = soleDiagnosticOf(
    "print map n in [1 2] [ :n * 2 ]\nprint :n",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "n" });
});

test("`reduce`'s accumulator and element are BOTH binders — neither is an outer read", () => {
  assert.deepEqual(
    printsOf(
      ":list = [1 2 3]\nprint reduce sum turn in :list from 0 [ :sum + :turn ]",
    ),
    [6],
  );
});

// --- A comprehension body is a block scope too (spec/execution-model.md:367-369) ---------------

test("a comprehension body is a block scope, so it may declare a `local`", () => {
  // Found by the review gate's logic/spec reviewer. An unsupported leading statement makes the WHOLE
  // comprehension a silent no-op — no value, no diagnostic — so omitting `local` here would not have
  // skipped a declaration, it would have deleted the program.
  assert.deepEqual(
    printsOf("print map n in [1 2] [\n  local x = :n * 3\n  :x\n]"),
    [[3, 6]],
  );
});

test("a `local` declared in a comprehension body does not escape it", () => {
  const diagnostic = soleDiagnosticOf(
    "print map n in [1] [\n  local x = :n\n  :x\n]\nprint :x",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "x" });
});

test("a `global` written in a comprehension body is off the root scope and is rejected", () => {
  const diagnostic = soleDiagnosticOf(
    "print map n in [1] [\n  global bad = 0\n  :n\n]",
  );

  assert.equal(diagnostic.code, "ol-global-outside-root");
  assert.deepEqual(diagnostic.params, { name: "bad" });
});

test("a comprehension body MAY update a binding its enclosing scope holds", () => {
  assert.deepEqual(
    printsOf(
      ":seen = 0\nprint map n in [1 2 3] [ :seen = :seen + 1   :n ]\nprint :seen",
    ),
    [[1, 2, 3], 3],
  );
});

test("a comprehension body ENDING in a binding statement raises ol-no-value — it never vanishes", () => {
  // The second half of the same defect, found by the review gate's logic/spec reviewer in round 2:
  // an unsupported FINAL statement rejects the whole comprehension just as an unsupported leading
  // one does, so `print map n in [1] [ local x = :n ]` printed nothing with no diagnostic. A body
  // must end in a value-producing expression (`spec/execution-model.md:217-230,804-807`), and a
  // binding statement produces none — so the outcome is `ol-no-value`, exactly as for a body ending
  // in a command. All three binding forms are checked, because they share one classification.
  for (const source of [
    "print map n in [1] [ local x = :n ]",
    "print map n in [1] [ global bad = 0 ]",
    "print map n in [1] [ :x = :n ]",
  ]) {
    assert.equal(
      soleDiagnosticOf(source).code,
      "ol-no-value",
      `expected ol-no-value for ${JSON.stringify(source)}`,
    );
  }
});

test("a bare `local` replaces an earlier binding of the same name in the SAME block scope", () => {
  // Raised by `@testing` as an undisclosed silent change. `local name` "creates a new binding in the
  // current scope" (`spec/commands.md:110`), and where that scope already holds one there is nothing
  // to shadow into — the new binding replaces it, and reading before assigning is the ordinary
  // unbound read. The root scope is the documented exception (`spec/execution-model.md:520-526`),
  // covered separately above.
  const diagnostic = soleDiagnosticOf(
    "repeat 1 [ :x = 5   local x   print :x ]",
  );

  assert.equal(diagnostic.code, "ol-undefined-var");
  assert.deepEqual(diagnostic.params, { name: "x" });
});

test("a name born in a `while`, `for`, `ask`, or handler body dies with it, exactly as in a `repeat`", () => {
  // `@testing` measured that the block-lifetime change reaches far more forms than the `if`/`else`
  // case first disclosed. Each of these printed a value before this slice.
  for (const source of [
    ":n = 0\nwhile :n < 2 [ :n = :n + 1   :seen = :n ]\nprint :seen",
    "for k in [1 2] [ :seen = :k ]\nprint :seen",
    "for k from 1 to 2 [ :seen = :k ]\nprint :seen",
    "every 5 [ :seen = 1 ]\nwait 6\nprint :seen",
  ]) {
    assert.equal(
      soleDiagnosticOf(source).code,
      "ol-undefined-var",
      `expected the block-local name to be gone after the block in ${JSON.stringify(source)}`,
    );
  }
});

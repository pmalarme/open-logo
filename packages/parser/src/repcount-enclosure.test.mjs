// The Layer-2 half of the `repcount` lexical-enclosure ruling — issue #1097, the
// `ol-repcount-outside-repeat` row of `spec/tooling.md`'s semantic-checking table (`spec/tooling.md:195`).
//
// `packages/runtime/src/repeat-forever-repcount.test.mjs` and `scoping.test.mjs` are this file's
// twins: same ruling (`spec/execution-model.md:671-690`), same code, asserted at the runtime stage.
// Where those run whole programs and assert what a learner *sees*, this one runs `check()` and
// asserts what a learner is *told before running*.
//
// The rule has two halves and the second is the hard one. `spec/execution-model.md:688-690`:
// **"Lexical enclosure is therefore necessary but not sufficient: it must be enclosure by a `repeat`
// whose body the code runs as part of."** So "is there a `Repeat` above me in the AST" is the WRONG
// implementation, and `repeat 3 [ every 5 [ print repcount ] ]` — where a `Repeat` genuinely is
// above the read — is the case that discriminates.
//
// MEASURED BEFORE-STATE (at saga tip 904b71ac, before this slice): `check()` reported **nothing**
// for any of these programs. The whole row was unimplemented at Layer 2, both halves. The runtime
// already decided every one of them correctly, so every expectation below is the checker being
// brought into agreement with the evaluator — except the last two tests, which are programs the
// runtime can never reach and which are the reason this row is worth having at all.
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only `check()`.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "repcount-enclosure.logo";
const PROFILES = ["core-language", "turtle-rendering", "interaction-events"];

/** Parse then check, so a test never checks an AST the reader already rejected. */
function checkSource(source, profiles = PROFILES) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(diagnostics, [], `parse: ${source}`);
  return OL.check(ast, { profiles, source }).diagnostics;
}

/** The codes `check()` reports for `source`, in report order. */
function codes(source, profiles = PROFILES) {
  return checkSource(source, profiles).map((diagnostic) => diagnostic.code);
}

/** Assert `source` checks clean — no diagnostic of any code. */
function assertClean(source, profiles = PROFILES) {
  assert.deepEqual(codes(source, profiles), [], source);
}

/** Assert `source` reports exactly one `ol-repcount-outside-repeat` and nothing else. */
function assertReported(source, profiles = PROFILES) {
  assert.deepEqual(
    codes(source, profiles),
    ["ol-repcount-outside-repeat"],
    source,
  );
}

test("a `repcount` in the body of the `repeat` it is written inside is clean", () => {
  assertClean("repeat 3 [ print repcount ]");
});

test("a nested `repeat` still encloses — the innermost one is the enclosing one", () => {
  assertClean("repeat 2 [ repeat 2 [ print repcount ] ]");
});

test("a bare `repcount` with no `repeat` anywhere raises", () => {
  assertReported("print repcount");
});

test("the diagnostic is the registered identity: semantic stage, error, no params, at the word", () => {
  const [diagnostic] = checkSource("print repcount");
  // `spec/error-model.md:120` — stage `semantic`, params `none`.
  assert.equal(diagnostic.code, "ol-repcount-outside-repeat");
  assert.equal(diagnostic.stage, "semantic");
  assert.equal(diagnostic.severity, "error");
  assert.deepEqual(diagnostic.params, {});
  // The span is the word itself, not the whole `print` statement — the same span the runtime
  // reports for this program (`tests/conformance/core-language/execution/repcount-outside-repeat`).
  assert.deepEqual(diagnostic.source_span, {
    document: doc,
    start: [1, 7],
    end: [1, 15],
  });
  // `spec/error-model.md:120` asks the message to explain what `repcount` reports and that it only
  // has meaning inside a `repeat`. It is deliberately the SAME sentence `@openlogo/runtime` raises,
  // so one code teaches one lesson at both stages.
  assert.equal(
    diagnostic.message,
    "repcount only reports a turn number inside a repeat loop — there is no enclosing repeat here.",
  );
});

// --- the procedure boundary (`spec/execution-model.md:673-678`) ---

test("a `repcount` in a procedure body raises even though the only call site is inside a `repeat`", () => {
  assertReported("define f\n  print repcount\nend\nrepeat 3 [ f ]");
});

test("a `repeat` written inside the procedure encloses normally", () => {
  assertClean("define f\n  repeat 2 [ print repcount ]\nend\nf");
});

test("a `define` written INSIDE a `repeat` body is still a boundary", () => {
  // The shape that actually discriminates the procedure seal. A `define` at the top level is not on
  // a turn of anything to begin with, so removing the seal changes nothing there — measured, a
  // mutant that made a procedure body inherit its surrounding answer survived every other test in
  // this file. A `define` nested in a loop body is legal (it is registered globally in phase 1,
  // `spec/execution-model.md`'s Reader pipeline), and the runtime agrees: measured, this program
  // raises `ol-repcount-outside-repeat` at run time.
  assertReported("repeat 2 [\n  define f\n    print repcount\n  end\n  f\n]");
});

test("a parameter default is sealed by the same boundary as the body", () => {
  // Measured at the runtime before this rule existed: `define f (:n repcount) … end` raises
  // `ol-repcount-outside-repeat` even when `f` is called from inside a live `repeat`, so the
  // default is NOT evaluated on the caller's turn. Written with the `define` nested in the loop for
  // the same reason as the test above — that is the placement that discriminates.
  assertReported("define f (:n repcount)\n  print :n\nend\nrepeat 2 [ f ]");
  assertReported("repeat 2 [ define f (:n repcount)\n  print :n\nend\n  f ]");
});

// --- the handler boundary (`spec/execution-model.md:682-690`) ---

test("a `repcount` in a handler block with no `repeat` at all raises", () => {
  assertReported("every 5 [ print repcount ]");
});

test("a `repcount` in a handler block nested INSIDE a `repeat` still raises", () => {
  // The discriminating case. A `Repeat` is lexically above this read, so an implementation that
  // asks only "is there a `repeat` above me" passes every other test in this file and fails here.
  assertReported("repeat 3 [ every 5 [ print repcount ] ]");
});

test("the handler boundary holds whether or not the registering loop has finished", () => {
  // `spec/execution-model.md:685-686` — "however the loop is placed and whether or not it has
  // finished". Here the `wait` is inside the loop body, so the loop is still running when the
  // handler fires; the static answer must not depend on that.
  assertReported("repeat 2 [ every 4 [ print repcount ]   wait 8 ]");
});

test("a `repeat` written INSIDE the handler block encloses normally", () => {
  // `spec/execution-model.md:686-688` — `every 5 [ repeat 3 [ print repcount ] ]` prints 1, 2, 3
  // on each firing, so it must check clean.
  assertClean("every 5 [ repeat 3 [ print repcount ] ]");
});

test("every Interaction & Events handler head is a boundary, not just `every`", () => {
  assertReported('repeat 2 [ when "start" [ print repcount ] ]');
  assertReported('repeat 2 [ on_key "a" [ print repcount ] ]');
  assertReported("repeat 2 [ on_click [ print repcount ] ]");
});

test("a handler HEAD argument is not inside the handler block, so it reads the enclosing turn", () => {
  // Measured: `repeat 2 [ every repcount [ print 1 ] ]` runs clean and schedules on the outer
  // turn's number, so the head argument keeps the enclosing answer while the body loses it.
  assertClean("repeat 2 [ every repcount [ print 1 ] ]");
  assertReported("every repcount [ print 1 ]");
});

// --- everything else runs as part of the statement that contains it ---

test("an `if`, `while`, `for … in` or `forever` body inside a `repeat` stays enclosed", () => {
  // `spec/execution-model.md:664-667` — every block other than a handler block or a comprehension
  // body "runs as part of the statement that contains it".
  assertClean("repeat 2 [ if repcount > 1 [ print repcount ] ]");
  assertClean(
    "repeat 2 [ :i = 0   while :i < 1 [ :i = :i + 1   print repcount ] ]",
  );
  assertClean("repeat 2 [ for n in [1] [ print repcount ] ]");
  assertClean("repeat 2 [ forever [ print repcount ] ]");
});

test("a comprehension body inside a `repeat` stays enclosed", () => {
  // Deliberately NOT justified by `spec/execution-model.md:664-667`, which expressly excludes a
  // comprehension body from that list — it excludes it for `return` (answered by
  // `ol-return-in-comprehension`), which says nothing about `repcount`. This rests on
  // `spec/execution-model.md:671-690` naming exactly two boundaries, so a block it does not name
  // inherits — and on the runtime, measured: this program prints [1] then [2].
  assertClean("repeat 2 [ print map n in [1] [ repcount ] ]");
});

test("a Sprites `ask`/`tell`/`each` block inside a `repeat` stays enclosed", () => {
  // `spec/execution-model.md:678-680` — the Sprites addressing model "carries dynamic *turtle
  // state*, not a name binding, so they are unaffected by this rule".
  const profiles = [...PROFILES, "sprites"];
  assertClean("repeat 2 [ each [ print repcount ] ]", profiles);
  assertClean("repeat 2 [ ask 1 [ print repcount ] ]", profiles);
  assertClean("repeat 2 [ tell 1   print repcount ]", profiles);
});

test("`forever` is not an enclosing loop — only `repeat` has a turn number", () => {
  // `spec/commands.md:804` ties `repcount` to "the innermost `repeat`". Measured at the runtime:
  // `forever [ print repcount ]` raises, so treating `forever` as enclosing would put the checker
  // in disagreement with the evaluator.
  assertReported("forever [ print repcount ]");
});

test("a `repeat`'s own count expression is outside its body", () => {
  // Measured: `repeat 2 [ repeat repcount [ print 9 ] ]` prints three times — the inner count reads
  // the OUTER turn — so the count is judged in the enclosing context and only the body is on a turn
  // of this loop.
  assertReported("repeat repcount [ print 1 ]");
  assertClean("repeat 2 [ repeat repcount [ print 9 ] ]");
});

test("the parenthesized call form is the same read", () => {
  assertClean("repeat 2 [ print (repcount) ]");
  assertReported("print (repcount)");
});

test("identifiers are case-insensitive, so a shouted `REPCOUNT` is judged too", () => {
  assertReported("print REPCOUNT");
  assertClean("repeat 2 [ print REPCOUNT ]");
});

test("every offending read is reported, not just the first", () => {
  assert.deepEqual(codes("print repcount\nprint repcount"), [
    "ol-repcount-outside-repeat",
    "ol-repcount-outside-repeat",
  ]);
});

// --- the two programs the runtime can never reach ---

test("a `repcount` in a procedure that is never called is still reported", () => {
  // The runtime prints `1` and reports nothing here: it never enters an uncalled body. Enclosure is
  // a purely lexical property of where the word is written, so no execution order could make this
  // read valid and the static stage is free — and obliged — to say so.
  assertReported("define f\n  print repcount\nend\nprint 1");
});

test("a `repcount` in a handler that never fires is still reported", () => {
  // Same shape: with no host input the `on_key` block never runs, so `execute()` reports nothing
  // and the learner discovers the defect only if a key is ever pressed.
  assertReported('repeat 2 [ on_key "a" [ print repcount ] ]');
});

// --- conservatism ---

test("a program that declares its own `repcount` is left to `ol-reserved-word` alone", () => {
  // `repcount` is a built-in name, so `define repcount … end` is already rejected
  // (`ol-reserved-word`), and `@openlogo/runtime`'s dispatch resolves a call to a same-named user
  // procedure ahead of the primitive — so these call sites are not reads of the reporter at all.
  // The reason is structural, not a general "no cascades" policy: `spec/tooling.md:199-200`'s
  // MUST NOT is narrower, covering speculative *type* errors when dynamic values are unknown.
  assert.deepEqual(codes("define repcount\n  return 7\nend\nprint repcount"), [
    "ol-reserved-word",
  ]);
});

test("a `repcount` assignment TARGET is left to `ol-not-a-place` alone", () => {
  // `repcount = 100` is a write position, not a read: `ol-not-a-place` already rules it and the
  // evaluator never runs the reporter there. Regression guard for
  // `tests/conformance/core-language/assignment/bare-place-invalid`, which this rule
  // double-reported before the exemption existed.
  assert.deepEqual(codes("repcount = 100"), ["ol-not-a-place"]);
  // `set <name> to` takes a bare NAME, so this one parses as an ordinary `Place` — the variable
  // `repcount`, not the reporter — and is no business of this rule at either stage.
  assert.deepEqual(codes("set repcount to 100"), []);
});

test("only the target's own head is exempt — its subtree is still read", () => {
  const profiles = [...PROFILES, "data"];
  assert.deepEqual(
    codes(":cells[(repcount)] = 9", profiles).filter(
      (code) => code === "ol-repcount-outside-repeat",
    ),
    ["ol-repcount-outside-repeat"],
  );
  assertClean("repeat 2 [ :cells = [1 2]   :cells[(repcount)] = 9 ]", profiles);
  // A bare word in a `[ ]` key position is a literal key rather than a call, so `:cells[repcount]`
  // never reads the reporter at all — measured on the parsed AST, whose segment key is a `WordLit`.
  assertClean(":cells = [1 2]\n:cells[repcount] = 9", profiles);
  // The exempt head's OWN arguments are still read. `repcount` takes none, so this only arises for
  // a malformed call — but it is reachable, and a mutant that skipped the whole target subtree
  // survived until this case was written.
  const nested = checkSource("(repcount (repcount)) = 5").filter(
    (diagnostic) => diagnostic.code === "ol-repcount-outside-repeat",
  );
  assert.equal(nested.length, 1);
  assert.deepEqual(nested[0].source_span.start, [1, 11]);
});

test("the span is the whole call node, not just the callee word", () => {
  // For a well-formed `repcount` the two are the same span, so this pins the choice on the one
  // program where they differ. It matches `@openlogo/runtime`, which reports at the call node too.
  const [found] = checkSource("(repcount 1)").filter(
    (diagnostic) => diagnostic.code === "ol-repcount-outside-repeat",
  );
  assert.deepEqual(found.source_span, {
    document: doc,
    start: [1, 1],
    end: [1, 13],
  });
});

// Unit tests for the Sprites `each <block>` form (issue #676, SP4), driven end to end through
// `execute()`. `each` runs its block ONCE per turtle in the current `tell`/`ask` set; during each
// run `who` reports that turtle and its per-turtle commands affect (and stamp their events with) only
// that turtle. Iteration order is the addressed set's insertion order, which `tell`/`ask` already
// de-duplicate by stable id where the set is built, so a turtle listed twice still runs the block
// once (issues #713, #748) — the same rule the direct `tell`/`ask` path obeys. Like `ask`, `each`
// restores the addressed set active before it on every exit path — normal, `stop`, `return`,
// `throw`, or a runtime error. It composes with `ask`/`tell`, and works at top level with a single
// addressed turtle and with an empty addressed set (zero runs). See spec/turtles-and-sprites.md's
// "Canonical forms" and "Addressing model"; the same behavior is locked from source by the
// conformance fixtures under tests/conformance/sprites/each-*.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const moves = (events) =>
  events
    .filter((event) => event.kind === "move")
    .map((event) => [event.turtle_id, event.payload.to]);

const prints = (events) =>
  events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values);

test("each runs the block once per addressed turtle, in insertion order, stamping each turtle's events", () => {
  // The acceptance-criteria program: `tell [ :a :b ]` then `each [ print who forward 40 right 120 ]`
  // runs once for :a (id 1) then once for :b (id 2); each move carries that turtle's id.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach [\n  forward 40\n  right 120\n]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 40]],
    [2, [0, 40]],
  ]);
});

test("inside each, who reports the turtle of the current iteration (not the whole set, not the main turtle)", () => {
  // `print who == :a` is true on :a's run and false on :b's run; the reverse for :b. Proving `who`
  // tracks the per-iteration current turtle — the observable heart of this slice.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach [ print who == :a ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(prints(result.events), [[true], [false]]);
});

test("each at top level with only the default turtle addressed runs the block once for that turtle", () => {
  // Acceptance criterion: `each` with no `tell` runs once for the implicit default main turtle (id 0).
  // `each` forces addressing explicit for its iteration, so the move carries turtle_id 0.
  const result = execute("each [\n  forward 10\n]", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [[0, [0, 10]]]);
});

test("each with an empty addressed set runs the block zero times", () => {
  const result = execute(
    ":a = new_turtle\ntell [ ]\neach [ forward 99 ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), []);
});

test("each with a single addressed turtle runs the block once for it", () => {
  const result = execute(
    ":a = new_turtle\ntell :a\neach [ forward 25 ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [[1, [0, 25]]]);
});

test("the long form closing with `end each` behaves identically to the bracket form", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach\n  forward 40\nend each",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 40]],
    [2, [0, 40]],
  ]);
});

test("the long form closing with a bare `end` behaves identically to the bracket form", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach\n  forward 40\nend",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 40]],
    [2, [0, 40]],
  ]);
});

test("`each` closed by `end ask` raises ol-mismatched-end", () => {
  const result = execute(
    ":a = new_turtle\ntell :a\neach\n  forward 40\nend ask",
    "main.logo",
  );
  const finding = result.diagnostics.find(
    (d) => d.code === "ol-mismatched-end",
  );
  assert.ok(
    finding,
    "expected ol-mismatched-end for `each` closed by `end ask`",
  );
});

test("#713/#748: a turtle listed twice in the addressed set runs the each block once (dedup by id)", () => {
  // `tell [ :a :a ]` LISTS :a twice but addresses it once; the addressed set is a SET (turtle == is
  // keyed on id), so `each` runs its block ONCE for :a. Exactly one move, not two. Since #748 the
  // de-duplication happens where `tell`/`ask` build the set, so `each` inherits it instead of
  // re-deciding it.
  const result = execute(
    ":a = new_turtle\ntell [ :a :a ]\neach [ forward 40 ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [[1, [0, 40]]]);
});

test("each restores the previous `tell` set after it finishes", () => {
  // `tell [ :a :b ]`; `each [ forward 10 ]` iterates :a then :b; the trailing `forward 30` runs for
  // the set active before `each` — still `[ :a :b ]` — so it applies to both.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach [ forward 10 ]\nforward 30",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 10]],
    [2, [0, 10]],
    [1, [0, 40]],
    [2, [0, 40]],
  ]);
});

test("each composes with ask: it iterates the ask scope, and the previous set is restored after ask", () => {
  // `tell :a`; `ask :b [ each [ forward 10 ] ]` — inside `ask :b` the current set is just :b, so
  // `each` iterates :b only; after the `ask` block the set returns to :a, so `forward 30` runs for :a.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell :a\nask :b [ each [ forward 10 ] ]\nforward 30",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [2, [0, 10]],
    [1, [0, 30]],
  ]);
});

test("each iterates a two-turtle ask scope once per turtle", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\nask [ :a :b ] [ each [ forward 10 ] ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 10]],
    [2, [0, 10]],
  ]);
});

test("each inside repeat runs the block once per turtle each pass, deterministically", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nrepeat 2 [ each [ forward 5 ] ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 5]],
    [2, [0, 5]],
    [1, [0, 10]],
    [2, [0, 10]],
  ]);
});

test("each inside a procedure body iterates the addressed set active at the call site", () => {
  const result = execute(
    "define march\n  each [ forward 15 ]\nend\n:a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nmarch",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 15]],
    [2, [0, 15]],
  ]);
});

test("a `stop` inside each stops iteration and restores the previous addressed set (no leak)", () => {
  // `stop` inside `each` (within a procedure) unwinds the procedure; iteration stops immediately (only
  // :a moves, not :b). After the call, the set active before the call is restored, so `forward 30`
  // runs for both :a and :b — proving the abnormal exit did not corrupt the addressed set.
  const result = execute(
    "define once\n  each [ forward 10 stop ]\nend\n:a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nonce\nforward 30",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 10]],
    [1, [0, 40]],
    [2, [0, 30]],
  ]);
});

test("a `return` inside each stops iteration and propagates the reported value, restoring the set", () => {
  const result = execute(
    "define first_x\n  each [ forward 10 return xcor ]\nend\n:a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nprint first_x\nforward 30",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  // Only :a moved inside `each` before `return`; after the call `forward 30` runs for both.
  assert.deepEqual(moves(result.events), [
    [1, [0, 10]],
    [1, [0, 40]],
    [2, [0, 30]],
  ]);
});

test("a runtime error inside each halts and restores the addressed set (finally runs on the error path)", () => {
  // `forward "not a number"` raises `ol-type` on :a's run; the loop halts. Only :a's (failed) command
  // was reached — no :b move — and the run stops with the diagnostic.
  const result = execute(
    ':a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach [ forward "x" ]',
    "main.logo",
  );
  const finding = result.diagnostics.find((d) => d.code === "ol-type");
  assert.ok(finding, 'expected ol-type for `forward "x"` inside each');
  assert.deepEqual(moves(result.events), []);
});

test("a `throw` inside each halts and restores the addressed set (finally runs on the throw path)", () => {
  // A `throw` on :a's run halts the program (v0.1 has no try/catch, so it stops like any runtime
  // error, spec/commands.md:980) and surfaces `ol-user-error`. The loop stops on the first iteration
  // — :a's `forward 10` ran but :b never does — and the finally still runs, so the addressed set is
  // not left corrupted (proven by the absence of any :b move; the run cannot continue past the throw).
  const result = execute(
    ':a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach [ forward 10 throw "stop now" ]\nforward 30',
    "main.logo",
  );
  const finding = result.diagnostics.find((d) => d.code === "ol-user-error");
  assert.ok(finding, "expected ol-user-error for `throw` inside each");
  // Only :a's forward ran; :b never moved and the trailing `forward 30` never ran (the throw halts).
  assert.deepEqual(moves(result.events), [[1, [0, 10]]]);
});

test("after a `stop` unwinds each, `who`, `xcor`, and the addressed set report the turtle(s) from before the loop (pointer + state cache + set restored, not leaked)", () => {
  // Directly asserts the current-turtle pointer, its derived state cache (`environment.turtle`), AND
  // the id set are restored after an abnormal exit, distinguishing restoration from leakage. :a and :b
  // are given DIFFERENT positions (x 11 vs 22). `tell [ :a :b ]` makes :a (id 1, first of set) the
  // current turtle, but the `each` `stop`s during :b's iteration (`if who == :b [ stop ]` is false for
  // :a, true for :b), so the iteration turtle when `stop` fires is :b — DIFFERENT from the pre-each
  // pointer :a. After the call `who == :a` is true, `who == :b` is false, and a bare `xcor` reports 11
  // (:a's x), not 22 (:b's): the finally restored `currentId` and `environment.turtle` to :a rather
  // than leaking :b's pointer or cache. The trailing `forward 10` then runs for the restored
  // `tell [ :a :b ]` set (both turtles), confirming the set — not just the pointer — is intact too.
  const result = execute(
    [
      "define once",
      "  each [ if who == :b [ stop ] ]",
      "end",
      ":a = new_turtle",
      ":b = new_turtle",
      "ask :a [ set_xy 11 0 ]",
      "ask :b [ set_xy 22 0 ]",
      "tell [ :a :b ]",
      "once",
      "print who == :a",
      "print who == :b",
      "print xcor",
      "forward 10",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(prints(result.events), [[true], [false], [11]]);
  // Moves: the two `set_xy` positioning ops, then `forward 10` for BOTH turtles of the restored
  // `tell [ :a :b ]` set — confirming the addressed set (not just the pointer) survived the abnormal exit.
  assert.deepEqual(moves(result.events), [
    [1, [11, 0]],
    [2, [22, 0]],
    [1, [11, 10]],
    [2, [22, 10]],
  ]);
});

test("nested each inside each iterates each turtle against every turtle of the inner set", () => {
  // Outer `each` over [ :a :b ]; inside each iteration the addressed set is the single current turtle,
  // so an inner `each` iterates just that turtle — two total inner runs, one per outer turtle.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach [ each [ forward 7 ] ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 7]],
    [2, [0, 7]],
  ]);
});

const primitives = (events) =>
  events
    .filter((event) => event.kind === "primitive")
    .map((event) => event.payload.name);

test("on_click is now dispatched upstream and emits its primitive rather than falling through dispatchProfileStatement", () => {
  // Regression retarget from SP4/#727: this test originally used `on_click` as an incidental stand-in
  // for "a registered profile block-head that dispatchProfileStatement does not handle", covering that
  // function's final `NOT_A_PROFILE_STATEMENT` fall-through. That coupled the assertion to on_click being
  // unimplemented. Now that I6/#685 dispatches `on_click`, the honest assertion is the NEW truth: the
  // head is intercepted upstream (before dispatchProfileStatement) and emits its registration `primitive`
  // event with no move. The guard in dispatchProfileStatement is retained deliberately (it defends a
  // future head registered in PROFILE_STATEMENT_FORMS without a handler); see the PR body and #685.
  const result = execute("on_click [ forward 1 ]", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), []);
  assert.deepEqual(primitives(result.events), ["on_click"]);
});

// Unit tests for the Sprites `ask` scoped-addressing form (issue #675, SP3), driven end to end
// through `execute()`. `ask <turtle|turtle-list> <block>` temporarily runs its block for the given
// turtle(s), then RESTORES the addressed set that was active before it — including when the block
// exits abnormally (an error, `stop`, `return`, or a `throw`). It accepts the bracket block form and
// the long `… end` / `… end ask` forms; a mismatched labeled `end` raises `ol-mismatched-end`. A
// non-turtle argument (or a list containing one) raises `ol-type`. A turtle listed twice is one
// member of the scoped set, so the block's commands still apply once (issue #748). Nesting restores
// exactly one level, so `ask` inside `ask`, and `ask` inside a `tell` scope, each unwind their own
// level. See spec/turtles-and-sprites.md's "Canonical forms" and "Addressing model"; the same
// behavior is locked from source by the conformance fixtures under tests/conformance/sprites/ask-*.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const moves = (events) =>
  events
    .filter((event) => event.kind === "move")
    .map((event) => [event.turtle_id ?? null, event.payload.to]);

test("ask runs the block for its turtle, then restores the previous addressed set (default turtle)", () => {
  // The acceptance-criteria program: `:t` turns red and moves inside the block; the trailing
  // `forward 20` runs for the set active BEFORE `ask` — the default main turtle (id 0, unstamped).
  const result = execute(
    ':t = new_turtle\nask :t [\n  set_color "red"\n  forward 80\n]\nforward 20',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 80]],
    [null, [0, 20]],
  ]);
  // Only the addressed turtle (id 1) turned red; the color change carries its turtle_id.
  const colorIds = result.events
    .filter((event) => event.kind === "color-change")
    .map((event) => event.turtle_id);
  assert.deepEqual(colorIds, [1]);
});

test("the long form closing with `end ask` behaves identically to the bracket form", () => {
  const result = execute(
    ":t = new_turtle\nask :t\n  forward 80\nend ask\nforward 20",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 80]],
    [null, [0, 20]],
  ]);
});

test("the long form closing with a bare `end` behaves identically to the bracket form", () => {
  const result = execute(
    ":t = new_turtle\nask :t\n  forward 80\nend\nforward 20",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 80]],
    [null, [0, 20]],
  ]);
});

test("`ask :t` closed by `end each` raises ol-mismatched-end", () => {
  const result = execute(
    ":t = new_turtle\nask :t\n  forward 80\nend each",
    "main.logo",
  );
  const finding = result.diagnostics.find(
    (d) => d.code === "ol-mismatched-end",
  );
  assert.ok(
    finding,
    "expected ol-mismatched-end for `ask` closed by `end each`",
  );
});

test("ask restores the previous `tell` set: after the block, commands address the tell set again", () => {
  // `tell :a` sets the persistent set to :a; `ask :b [ … ]` addresses :b only for the block; the
  // trailing `forward 30` must return to :a — the set restored after the scoped `ask`.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell :a\nask :b [ forward 10 ]\nforward 30",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [2, [0, 10]],
    [1, [0, 30]],
  ]);
});

test("nested ask restores exactly one level", () => {
  // `ask :a [ … ask :b [ … ] forward 5 ]`: the inner `ask :b` addresses :b for its block, then the
  // outer `ask :a` set is restored so the outer `forward 5` moves :a, not :b.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\nask :a [ ask :b [ forward 10 ] forward 5 ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [2, [0, 10]],
    [1, [0, 5]],
  ]);
});

test("ask with a list of turtles applies each block command once per addressed turtle", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\nask [ :a :b ] [ forward 50 ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 50]],
    [2, [0, 50]],
  ]);
});

test("ask to an empty turtle list runs the block for no turtle, then restores", () => {
  const result = execute(
    ":t = new_turtle\ntell :t\nask [ ] [ forward 80 ]\nforward 20",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  // The block addressed no turtle, so it emitted no move; the trailing `forward 20` runs for the
  // restored `tell :t` set (turtle 1).
  assert.deepEqual(moves(result.events), [[1, [0, 20]]]);
});

test("who inside the ask block reports the addressed turtle; after the block it reports the previous one", () => {
  const result = execute(
    ":t = new_turtle\nask :t [ print who == :t ]\nprint who == first turtles",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const prints = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  // Inside the block `who` is :t; afterward `who` falls back to the main turtle (id 0 = first turtles).
  assert.deepEqual(prints, [true, true]);
});

test("a `throw` inside an ask block surfaces its ol-user-error", () => {
  // The block throws, and `ol-user-error` surfaces in `result.diagnostics`. That single diagnostic
  // is the whole of what the assertion below establishes (issue #753) — not that the program halts,
  // which nothing here could show, since no statement follows the `ask`.
  //
  // Nor the addressed-set restore: that comes from the `try`/`finally` in `executeAsk`, whose
  // `restoreAddressedSet` emits the restored set on every exit path. sprites-addressing-
  // events.test.mjs proves it from output on the analogous halting path — "a runtime error inside
  // ask still publishes the restored set before the run halts" — from a different program.
  const result = execute(
    ':a = new_turtle\ntell :a\nask [ ] [ throw "boom" ]',
    "main.logo",
  );
  const finding = result.diagnostics.find((d) => d.code === "ol-user-error");
  assert.ok(finding, "expected the throw's ol-user-error to surface");
});

test("#748: ask with a turtle listed twice addresses it once — the block's command applies once, and the previous set is still restored", () => {
  // `ask` builds its scoped set through the same `turtleIdsFor` as `tell`, so `ask [ :a :a ]`
  // addresses :a ONCE (spec/turtles-and-sprites.md:44's "addressed set" + :113's "once for each
  // addressed turtle"; turtle `==` is "Same turtle identity", spec/execution-model.md:692). One move
  // for :a inside the block, then the trailing `forward 20` for the restored default main turtle.
  const result = execute(
    ":a = new_turtle\nask [ :a :a ] [ forward 10 ]\nforward 20",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 10]],
    [null, [0, 20]],
  ]);
});

test("#748: ask's dedup preserves first-occurrence order, so who inside the block reports the first-listed turtle", () => {
  // `ask [ :b :a :b ]` drops the repeat of :b but keeps its first occurrence at position 0: `who`
  // inside the block reports :b, and the block's command runs for :b then :a — two moves, not three.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\nask [ :b :a :b ] [ print who == :b forward 10 ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload.values, [true]);
  assert.deepEqual(moves(result.events), [
    [2, [0, 10]],
    [1, [0, 10]],
  ]);
});

test("a non-turtle argument to ask raises ol-type and leaves the addressed set unchanged", () => {
  const result = execute("ask 5 [ forward 10 ]", "main.logo");
  const [finding] = result.diagnostics;
  assert.equal(finding.code, "ol-type");
  assert.equal(finding.params.operation, "ask");
  assert.equal(finding.params.expected, "turtle");
  // The block never ran: no move was emitted.
  assert.equal(
    result.events.some((event) => event.kind === "move"),
    false,
  );
});

test("a list passed to ask that contains a non-turtle value raises ol-type", () => {
  const result = execute(
    ":a = new_turtle\nask [ :a 5 ] [ forward 10 ]",
    "main.logo",
  );
  const finding = result.diagnostics.find((d) => d.code === "ol-type");
  assert.ok(finding, "expected ol-type for a list containing a non-turtle");
  assert.equal(finding.params.operation, "ask");
});

test("a stop inside an ask block unwinds the enclosing procedure and restores the scope", () => {
  // `stop` inside the block exits `go`; the trailing `forward 99` in `go` never runs. `ask`'s
  // restore still executes via its finally.
  const result = execute(
    "define go\n  :t = new_turtle\n  ask :t [ forward 5 stop ]\n  forward 99\nend\ngo\nforward 20",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  // Inside `go`: :t (id 1) moved 5 then `stop` exited `go`, so `forward 99` never ran. After `go`
  // returns, the top-level addressed set is the default main turtle (id 0), which moves 20.
  assert.deepEqual(moves(result.events), [
    [1, [0, 5]],
    [null, [0, 20]],
  ]);
});

test("a return inside an ask block propagates its value and restores the scope", () => {
  // `return :n` fires from inside the `ask` block: the value must propagate out of the procedure
  // (so `chooser` reports 42), and `ask`'s finally must still restore the addressed set — proven by the
  // trailing top-level `forward 20` running for the default main turtle (id 0, unstamped), not the
  // turtle `ask` had addressed. This exercises the return/output propagation path through `ask`'s
  // finally, the observable abnormal exit `throw` cannot show (a throw halts the whole program).
  const result = execute(
    "define chooser\n  :n = new_turtle\n  ask :n [ forward 5 return 42 ]\nend\nprint chooser\nforward 20",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const prints = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(prints, [42]);
  // :n (id 1) moved 5 inside the block; after `chooser` returns, the top-level set is the default
  // main turtle (id 0, unstamped), so `forward 20` is unstamped — the scope was restored across
  // `return`.
  assert.deepEqual(moves(result.events), [
    [1, [0, 5]],
    [null, [0, 20]],
  ]);
});

test("ask inside a repeat restores its scope on every iteration", () => {
  // Each `ask :friend` iteration addresses :friend for its block then restores; the outer default
  // turtle is never permanently narrowed, so the trailing `forward 7` moves the default turtle.
  const result = execute(
    ":friend = new_turtle\nrepeat 2 [ ask :friend [ forward 3 ] ]\nforward 7",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 3]],
    [1, [0, 6]],
    [null, [0, 7]],
  ]);
});

test("an ask argument that references an undefined variable surfaces that diagnostic (not an ask type error)", () => {
  const result = execute("ask :missing [ forward 10 ]", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("an ask argument that is not yet evaluable (a call to an unregistered name) is left un-evaluated, changing nothing", () => {
  // Mirrors `tell`'s deferral test: an argument `isSupportedArgument` reports unsupported (a call to
  // an unregistered builtin) defers the whole `ask` — no addressing change, no block run, no
  // diagnostic — exactly like every other command. The block never runs, so no move is emitted, and
  // the following `forward 50` runs on the still-default (unstamped) main turtle.
  const result = execute(
    ":a = new_turtle\nask (nonexistent_builtin 1) [ forward 10 ]\nforward 50",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const moveList = moves(result.events);
  assert.deepEqual(moveList, [[null, [0, 50]]]);
});

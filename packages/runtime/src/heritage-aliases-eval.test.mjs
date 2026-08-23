// Runtime equivalence tests for the Heritage short command aliases — `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/
// `st`/`ht`/`cs`/`pr` — slice H3 (issue #668). The Heritage profile is "alternate spellings only, no
// new semantics" (spec/conformance.md#heritage): each alias MUST execute through the exact same code
// path, and produce the exact same event stream, as the Core command it spells. The runtime achieves
// this by normalizing an alias call to its `canonical` Core name at a SINGLE dispatch chokepoint
// (top of `executeStatements`), before any `is*Call` predicate or executor runs — so every downstream
// executor and every emitted event payload sees only the Core name, never the surface alias.
//
// The centrepiece proof is `full-event-stream identity`: an alias program and its Core twin produce
// byte-identical event streams once the necessarily-different source spans (a 2-char alias occupies
// fewer columns than its full Core name) are stripped. This is the strongest possible evidence of
// "no new semantics" — it covers the payloads too, so a `move`/`turn`/`print` payload, and the
// `procedure-enter`/`procedure-exit` names, carry the canonical Core name and never the alias.
//
// (The PROFILE GATE — rejecting these aliases in Core — is a parser/checker concern, covered by
// packages/parser/src/heritage-aliases.test.mjs. The runtime never gates on profiles, so these
// programs are executed directly here regardless of profile.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "heritage-aliases-eval.logo";

/** Run `source`, asserting a clean run, and return its events. */
function eventsOf(source) {
  const result = execute(source, doc);
  assert.deepEqual(
    result.diagnostics,
    [],
    `expected a clean run for ${JSON.stringify(source)}`,
  );
  return result.events;
}

/** The same events with every `source_span` stripped — spans necessarily differ between an alias
 * and its longer Core spelling, but NOTHING else may. */
function withoutSpans(events) {
  return events.map(({ source_span, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// The centrepiece: byte-identical event streams (payloads included)
// ---------------------------------------------------------------------------

test("an all-ten-aliases program produces an event stream byte-identical (spans aside) to its Core twin", () => {
  // Every alias, exercised in awkward positions the runtime must still canonicalize: inside a
  // `repeat [ … ]` block body (`pu`/`fd`/`pd`/`bk`) and inside a procedure body (`rt`/`fd` in
  // `spin`), plus top-level `st`/`ht`/`cs`/`pr`.
  const alias = eventsOf(
    "to spin :n\n  rt 90\n  fd :n\nend\nrepeat 2 [pu fd 10 pd bk 10]\nst\nht\ncs\nspin 40\npr 7\n",
  );
  const core = eventsOf(
    "define spin :n\n  right 90\n  forward :n\nend\nrepeat 2 [pen_up forward 10 pen_down back 10]\nshow_turtle\nhide_turtle\nclear_screen\nspin 40\nprint 7\n",
  );
  assert.deepEqual(withoutSpans(alias), withoutSpans(core));
});

// ---------------------------------------------------------------------------
// Payload names carry the canonical Core name, never the alias
// ---------------------------------------------------------------------------

test("a procedure called via a body of aliases emits procedure-enter/exit with the CANONICAL turtle payloads", () => {
  // `spin` draws with `rt`/`fd`; its move/turn events must carry the same payloads as the
  // `right`/`forward` twin — the surface alias never leaks into an event. Comparing against the twin
  // (rather than hardcoding) keeps the assertion exact without transcribing floating-point results.
  const alias = eventsOf("to spin\n  rt 90\n  fd 10\nend\nspin\n");
  const core = eventsOf("define spin\n  right 90\n  forward 10\nend\nspin\n");
  assert.deepEqual(withoutSpans(alias), withoutSpans(core));
  const kinds = alias.map((e) => e.kind);
  assert.ok(kinds.includes("procedure-enter"));
  assert.ok(kinds.includes("procedure-exit"));
  assert.ok(kinds.includes("turn"));
  assert.ok(kinds.includes("move"));
  // The procedure-enter/exit names are the procedure's own (`spin`); the point proven by the
  // full-stream identity above is that the alias bodies inside it emit Core-identical payloads.
  const enter = alias.find((e) => e.kind === "procedure-enter");
  assert.equal(enter.payload.name, "spin");
});

test("`cs` emits a clear event whose payload mode is the canonical `clear_screen`, not the alias", () => {
  // [instruction, move, turn, clear] — since issue #847 `clear_screen` makes its homing
  // observable, so the alias emits the homing pair before the clear just as the Core spelling does.
  const events = eventsOf("cs\n");
  assert.deepEqual(
    events.map((e) => e.kind),
    ["instruction", "move", "turn", "clear"],
  );
  const clear = events.at(-1);
  assert.deepEqual(clear.payload, { mode: "clear_screen" });
});

test("`pr` emits a print event identical to `print`", () => {
  const alias = eventsOf("pr 7\n");
  const core = eventsOf("print 7\n");
  assert.deepEqual(withoutSpans(alias), withoutSpans(core));
  const print = alias.find((e) => e.kind === "print");
  assert.deepEqual(print.payload, { values: [7] });
});

// ---------------------------------------------------------------------------
// Per-alias equivalence, each in an awkward position
// ---------------------------------------------------------------------------

const MOTION_ALIASES = [
  ["fd 25", "forward 25"],
  ["bk 25", "back 25"],
  ["lt 45", "left 45"],
  ["rt 45", "right 45"],
  ["pu", "pen_up"],
  ["pd", "pen_down"],
  ["st", "show_turtle"],
  ["ht", "hide_turtle"],
  ["cs", "clear_screen"],
];

for (const [alias, core] of MOTION_ALIASES) {
  test(`\`${alias}\` inside a repeat block executes identically to \`${core}\``, () => {
    // The repeat wrapper puts the alias in a non-top-level position, proving the chokepoint
    // canonicalizes a nested statement exactly as a top-level one.
    const aliasEvents = eventsOf(`repeat 1 [${alias}]\n`);
    const coreEvents = eventsOf(`repeat 1 [${core}]\n`);
    assert.deepEqual(withoutSpans(aliasEvents), withoutSpans(coreEvents));
  });
}

// ---------------------------------------------------------------------------
// The chokepoint is a strict no-op for Core spellings (non-regression)
// ---------------------------------------------------------------------------

test("a Core-only program is bit-for-bit unchanged — no `canonical`, so the chokepoint is a no-op", () => {
  // Every Core spelling carries no `canonical`, so `canonicalizeHeritageAliasCall` returns the node
  // unchanged. This is the non-regression guarantee: the entire existing Core suite is the evidence,
  // and this case pins one representative program that mixes a call, an assignment, and a block.
  const events = eventsOf("set x to 3\nrepeat :x [forward 5]\nprint :x\n");
  // A stable structural fingerprint: the ordered event kinds are exactly what Core produced before
  // this slice existed (a call/assignment/repeat mix touches the chokepoint on every statement).
  assert.deepEqual(
    events.map((e) => e.kind),
    [
      "instruction",
      "instruction",
      "instruction",
      "move",
      "draw-segment",
      "instruction",
      "move",
      "draw-segment",
      "instruction",
      "move",
      "draw-segment",
      "instruction",
      "print",
    ],
  );
});

test("aliases and Core spellings intermixed in one program are equivalent statement-by-statement", () => {
  // A program that alternates alias and Core spellings of the SAME command proves the chokepoint
  // normalizes only the alias nodes and leaves the Core nodes untouched, with no ordering artifact.
  const mixed = eventsOf("fd 10\nforward 10\nrt 90\nright 90\n");
  const allCore = eventsOf("forward 10\nforward 10\nright 90\nright 90\n");
  assert.deepEqual(withoutSpans(mixed), withoutSpans(allCore));
});

// ---------------------------------------------------------------------------
// INVERTED by issue #839 (maintainer ruling #833 rule 3, "nothing shadows"):
// a user procedure can no longer be NAMED like an alias, nor like an alias's
// canonical, so neither shadowing direction is reachable any more.
// ---------------------------------------------------------------------------
//
// These tests are kept — not deleted — as regression locks pointing the other way. Each still runs
// the exact program that used to exercise the shadow path, and asserts that phase-1 registration
// (`spec/execution-model.md:82-89`) now rejects the declaration outright with `ol-reserved-word`
// (`spec/error-model.md:125`). If anyone ever re-legalises `define fd` / `define forward`, these go
// red again and the reader is led straight back to why the shadow paths existed.

test("a user procedure whose name is an alias is rejected at registration, so it can never shadow the alias", () => {
  // Was: `define fd :x … end` made `fd` the user's procedure and the statement chokepoint had to
  // avoid rewriting `fd` to `forward`. `fd` is an alias spelling of a primitive, so declaring it is
  // now `ol-reserved-word` — the shadow the guard protected against cannot be created.
  const result = execute("define fd :x\n  print :x\nend\nfd 99\n", doc);
  assert.deepEqual(
    result.diagnostics.map((d) => [d.code, d.params]),
    [["ol-reserved-word", { name: "fd" }]],
  );
  assert.deepEqual(result.events, [], "nothing runs");
});

test("an alias whose CANONICAL name is declared is rejected at registration, so the alias can never reach a user procedure", () => {
  // The mirror case: overriding `forward` itself so `fd` would dispatch to the user's procedure.
  // `forward` is a Turtle & Rendering primitive, so the declaration is rejected first.
  const result = execute("define forward :x\n  print :x\nend\nfd 7\n", doc);
  assert.deepEqual(
    result.diagnostics.map((d) => [d.code, d.params]),
    [["ol-reserved-word", { name: "forward" }]],
  );
  assert.deepEqual(result.events, []);
});

// ---------------------------------------------------------------------------
// The same, from REPORTER position — issue #787's host crash, now unreachable
// ---------------------------------------------------------------------------
//
// Statement position has its own chokepoint (`canonicalizeHeritageAliasCall`, which rewrites the
// callee node). Expression position has a second one (`resolveHeritageAliasName`), and it resolved
// the alias for DISPATCH only while handing the UNRESOLVED node to `callProcedure` — whose
// `runProcedureBody` re-derives its lookup key from `node.callee.name`. The two disagreed, so a
// reporter-position alias over a user-defined canonical looked up `fd`, found `undefined`, and
// dereferenced it: a raw host `TypeError` escaping to the embedder with no `ol-*` diagnostic at all,
// which `spec/error-model.md` never admits as an outcome. `withResolvedCallee` closed it by
// rewriting the node there too.
//
// #839 removes the *precondition* instead: a reporter-position alias can no longer have a
// user-defined canonical, because `define forward` is `ol-reserved-word`. The crash repro below is
// therefore kept verbatim and inverted — it is the cheapest possible guard against the precondition
// coming back without `withResolvedCallee`'s fix coming with it.

test("#787: the reporter-position crash repro is now rejected at registration", () => {
  // The literal crash repro from the issue: `define forward … end` then `print fd`.
  const result = execute("define forward\n  return 55\nend\nprint fd\n", doc);
  assert.deepEqual(
    result.diagnostics.map((d) => [d.code, d.params]),
    [["ol-reserved-word", { name: "forward" }]],
  );
  assert.deepEqual(
    result.events,
    [],
    "the program halts at registration, before `print fd` could reach the crash",
  );
});

test("#787: a reporter-position alias over a BUILT-IN canonical still behaves exactly like that canonical", () => {
  // What survives of #787's rule once the user-procedure route is gone: `fd` in reporter position
  // must be indistinguishable from `forward` there — same events, same diagnostics — because
  // Heritage is "alternate spellings only, no new semantics" (`spec/conformance.md:146`). Asserted
  // as full-result equivalence rather than against a named diagnostic, because these calls do not
  // currently produce one: a command in reporter position is accepted leniently and yields no value,
  // no `print` event and no `ol-*` code at all. That leniency is NOT this slice's to change (it is
  // the runtime reporter-arity question issue #874 raised) — but it is exactly why this assertion
  // has to compare the two spellings' whole results instead of pinning a code that isn't there.
  //
  // The user-procedure arity/no-output guards this test used to reach through an alias are covered
  // by `heritage-alias-chokepoint.test.mjs` (the alias→canonical→procedure dispatch itself) and by
  // the ordinary reporter-position procedure calls in `procedure-calls.test.mjs`; with
  // `withResolvedCallee` rewriting the node before dispatch, the alias route IS the ordinary route.
  for (const [aliasSource, coreSource] of [
    ["print (fd 1 2)\n", "print (forward 1 2)\n"],
    ["print fd\n", "print forward\n"],
    ["print bf [1 2 3]\n", "print butfirst [1 2 3]\n"],
    ["print (bf)\n", "print (butfirst)\n"],
    ["print bf []\n", "print butfirst []\n"],
  ]) {
    const alias = execute(aliasSource, doc);
    const core = execute(coreSource, doc);
    assert.deepEqual(
      alias.diagnostics.map((d) => [d.code, d.params]),
      core.diagnostics.map((d) => [d.code, d.params]),
      `${aliasSource} must report the same identity as its Core twin`,
    );
    assert.deepEqual(
      withoutSpans(alias.events),
      withoutSpans(core.events),
      `${aliasSource} must emit the same events as its Core twin`,
    );
    // Derive the surface spelling from the row rather than hard-coding one: a fixed `"fd"` check
    // can never fail on a `bf` row, and the `bf` rows are the only ones here that produce a
    // diagnostic at all — so the assertion would have been inert exactly where it mattered.
    const surface = aliasSource.match(/\b(fd|bf)\b/)[1];
    for (const diagnostic of alias.diagnostics) {
      for (const value of Object.values(diagnostic.params)) {
        assert.notEqual(
          value,
          surface,
          `no structured param may carry the surface spelling ${surface}`,
        );
      }
    }
  }
});

test("#787: a user procedure named like the alias is rejected in reporter position too", () => {
  // The expression-position twin of the statement chokepoint's shadowing guard: when the SURFACE
  // name was itself a registered procedure, `resolveHeritageAliasName` returned the surface name.
  // `define fd` is now `ol-reserved-word`, so that guard's precondition is gone from this direction
  // as well.
  const result = execute("define fd\n  return 55\nend\nprint fd\n", doc);
  assert.deepEqual(
    result.diagnostics.map((d) => [d.code, d.params]),
    [["ol-reserved-word", { name: "fd" }]],
  );
  assert.deepEqual(result.events, [], "nothing runs");
});

test("#787: an ordinary reporter-position procedure call is untouched", () => {
  // The no-op guard for `withResolvedCallee`'s early return. What is asserted is BEHAVIOURAL
  // non-regression: a callee carrying no `canonical` takes the Core path unchanged. An earlier
  // wording claimed "the very same node object is dispatched" — object identity is an
  // implementation detail this test cannot see and the language does not promise, so a
  // copy-returning implementation would pass it too and the claim was simply unfalsifiable here.
  // The early return exists for cheapness, not for an identity contract.
  const events = eventsOf(
    "define twice :x\n  return :x + :x\nend\nprint twice 4\n",
  );
  assert.deepEqual(
    events.filter((e) => e.kind === "print").map((e) => e.payload),
    [{ values: [8] }],
  );
});

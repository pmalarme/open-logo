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
// A user procedure named like an alias SHADOWS the alias (the chokepoint must
// never hijack a user's `define fd :x … end`)
// ---------------------------------------------------------------------------

test("a user procedure whose name is an alias shadows the alias, exactly as an ordinary name would", () => {
  // `define fd :x … end` makes `fd` the user's procedure — the chokepoint must NOT rewrite `fd` to
  // `forward` and run the turtle, which would silently invent a semantic difference from what the
  // learner wrote (and would fire even with Heritage inactive, since the reader sets `canonical`
  // profile-blind). Proof: the alias-named procedure behaves identically to the same program written
  // with an ordinary (non-alias) procedure name — same event kinds and same payloads once the
  // procedure's own name (necessarily `fd` vs `foo`) is disregarded.
  const shadow = eventsOf("define fd :x\n  print :x\nend\nfd 99\n");
  const ordinary = eventsOf("define foo :x\n  print :x\nend\nfoo 99\n");
  const stripNames = (events) =>
    withoutSpans(events).map(({ payload, ...rest }) => ({
      ...rest,
      payload:
        rest.kind === "procedure-enter" || rest.kind === "procedure-exit"
          ? { ...payload, name: "·" }
          : payload,
    }));
  assert.deepEqual(stripNames(shadow), stripNames(ordinary));
  // Concretely: the user's `print` ran and NO `move` was emitted (the alias did not reach `forward`).
  assert.ok(shadow.some((e) => e.kind === "print"));
  assert.ok(!shadow.some((e) => e.kind === "move"));
});

test("an alias whose CANONICAL name is a user procedure dispatches to that procedure", () => {
  // The mirror case: the user overrides `forward` itself. `fd` should then dispatch to the user's
  // `forward` (the alias means "whatever `forward` means"), not a built-in turtle move — and
  // identically to writing `forward` directly, since both resolve to the same procedure.
  const alias = eventsOf("define forward :x\n  print :x\nend\nfd 7\n");
  const core = eventsOf("define forward :x\n  print :x\nend\nforward 7\n");
  assert.deepEqual(withoutSpans(alias), withoutSpans(core));
  assert.ok(!alias.some((e) => e.kind === "move"));
});

// ---------------------------------------------------------------------------
// The same, from REPORTER position — issue #787's host crash
// ---------------------------------------------------------------------------
//
// Statement position has its own chokepoint (`canonicalizeHeritageAliasCall`, which rewrites the
// callee node). Expression position has a second one (`resolveHeritageAliasName`), and it resolved
// the alias for DISPATCH only while handing the UNRESOLVED node to `callProcedure` — whose
// `runProcedureBody` re-derives its lookup key from `node.callee.name`. The two disagreed, so a
// reporter-position alias over a user-defined canonical looked up `fd`, found `undefined`, and
// dereferenced it: a raw host `TypeError` escaping to the embedder with no `ol-*` diagnostic at all,
// which `spec/error-model.md` never admits as an outcome. `withResolvedCallee` closes it by
// rewriting the node here too, so both chokepoints behave the same way.
//
// Note this is reachable ONLY through `execute()`: it runs `parse()` and never `check()`, so no
// checker rule can stand in for these tests (the same cross-stage split as #741).

test("#787: a reporter-position alias over a user-defined canonical does not crash the host", () => {
  // The literal crash repro from the issue. It must produce a value, not a `TypeError`.
  const alias = eventsOf("define forward\n  return 55\nend\nprint fd\n");
  const core = eventsOf("define forward\n  return 55\nend\nprint forward\n");
  assert.deepEqual(withoutSpans(alias), withoutSpans(core));
  assert.deepEqual(
    alias.filter((e) => e.kind === "print").map((e) => e.payload),
    [{ values: [55] }],
  );
});

test("#787: the reporter path's procedure events carry the CANONICAL name, never the surface alias", () => {
  // Canonicalization must be total, not just enough to stop the crash: a surface spelling reaching
  // an event payload is the same class of defect as one reaching a diagnostic's params.
  const events = eventsOf("define forward\n  return 55\nend\nprint fd\n");
  const names = events
    .filter((e) => e.kind === "procedure-enter" || e.kind === "procedure-exit")
    .map((e) => e.payload.name);
  assert.deepEqual(names, ["forward", "forward"]);
});

test("#787: the reporter path's spans still point at the alias the learner wrote", () => {
  // Canonicalizing the dispatch name must not canonicalize the span — `withResolvedCallee` keeps
  // `callee.source_span`. `fd` occupies two columns, so `procedure-enter` spans [4,7]–[4,9], not the
  // seven columns `forward` would.
  const events = eventsOf("define forward\n  return 55\nend\nprint fd\n");
  const enter = events.find((e) => e.kind === "procedure-enter");
  assert.deepEqual(enter.source_span.start, [4, 7]);
  assert.deepEqual(enter.source_span.end, [4, 9]);
});

test("#787: the reporter path reaches the user procedure's arity and no-output guards", () => {
  // Both were unreachable before the fix — the undefined lookup blew up on the line before them.
  // `params.callable`/`params.procedure` must carry the CANONICAL name (#670/#733/#741's rule), and
  // must be byte-identical to what the Core spelling reports.
  for (const [aliasSource, coreSource] of [
    [
      "define forward\n  return 55\nend\nprint (fd 1 2)\n",
      "define forward\n  return 55\nend\nprint (forward 1 2)\n",
    ],
    [
      "define forward :x\n  return 55\nend\nprint (fd)\n",
      "define forward :x\n  return 55\nend\nprint (forward)\n",
    ],
    [
      "define forward\n  print 1\nend\nprint fd\n",
      "define forward\n  print 1\nend\nprint forward\n",
    ],
  ]) {
    const alias = execute(aliasSource, doc).diagnostics;
    const core = execute(coreSource, doc).diagnostics;
    assert.equal(alias.length, 1, `expected one diagnostic for ${aliasSource}`);
    assert.deepEqual(
      alias.map((d) => [d.code, d.params]),
      core.map((d) => [d.code, d.params]),
      `${aliasSource} must report the same identity as its Core twin`,
    );
    for (const value of Object.values(alias[0].params)) {
      assert.notEqual(
        value,
        "fd",
        "no structured param may carry the surface spelling",
      );
    }
  }
});

test("#787: a user procedure named like the alias still shadows it in reporter position too", () => {
  // The statement chokepoint's shadowing guard has an expression-position twin, and
  // `withResolvedCallee` must not disturb it: when the SURFACE name is itself a registered
  // procedure, `resolveHeritageAliasName` returns the surface name and the node is returned
  // unchanged. `define fd` must therefore reach the learner's own `fd`, not `forward`.
  const events = eventsOf("define fd\n  return 55\nend\nprint fd\n");
  assert.deepEqual(
    events
      .filter((e) => e.kind === "procedure-enter")
      .map((e) => e.payload.name),
    ["fd"],
  );
  assert.deepEqual(
    events.filter((e) => e.kind === "print").map((e) => e.payload),
    [{ values: [55] }],
  );
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

// Runtime equivalence tests for the Heritage list-reporter aliases — `bf`/`bl`/`se` — slice H4
// (issue #669). The Heritage profile is "alternate spellings only, no new semantics"
// (spec/conformance.md#heritage): each alias MUST evaluate through the exact same code path, and
// produce the exact same value and event stream, as the Core reporter it spells
// (`bf`→`butfirst`, `bl`→`butlast`, `se`→`sentence`).
//
// These are REPORTERS, so they appear in EXPRESSION position (as arguments to `print`, as an
// assignment RHS, composed with one another) — a different runtime path from H3's command aliases,
// which the runtime canonicalizes at the *statement* chokepoint. A reporter alias is normalized at
// the single EXPRESSION-position chokepoint (`resolveHeritageAliasName`, top of `evaluateCall` and
// the `Call`/`ParenCall` arm of `isSupportedExpression`) before any `name === …` predicate runs, so
// every downstream evaluator and every emitted event payload sees only the Core name.
//
// The centrepiece proof is `byte-identical event stream`: an all-three-reporter-aliases program and
// its Core twin produce byte-identical streams once the necessarily-different source spans (a 2-char
// alias occupies fewer columns than its full Core name) are stripped. This covers the `print`
// payloads and the `procedure-enter`/`procedure-exit` names, so no alias spelling reaches a payload.
//
// (The PROFILE GATE — rejecting these aliases in Core — is a parser/checker concern covered by
// packages/parser/src/heritage-list-reporter-aliases.test.mjs. The runtime never gates on profiles,
// so these programs are executed directly here regardless of profile.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "heritage-list-reporter-aliases-eval.logo";

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
 *  and its longer Core spelling, but NOTHING else may. */
function withoutSpans(events) {
  return events.map(({ source_span, ...rest }) => rest);
}

/** The `values` payload of every `print` event, in order — the observable output of a reporter. */
function printedValues(events) {
  return events.filter((e) => e.kind === "print").map((e) => e.payload.values);
}

// ---------------------------------------------------------------------------
// The centrepiece: byte-identical event streams (payloads included)
// ---------------------------------------------------------------------------

test("an all-three-reporter-aliases program produces an event stream byte-identical (spans aside) to its Core twin", () => {
  // Every reporter alias, exercised in awkward positions the runtime must still canonicalize: as an
  // argument to `print`, composed with one another (`bf bl :l`), inside a `repeat [ … ]` block body,
  // inside a procedure body, and as an assignment RHS (`make "s" se …`) later printed.
  const alias = eventsOf(
    'make "l" [10 20 30 40]\n' +
      "print bf :l\n" +
      "print bl :l\n" +
      "print bf bl :l\n" +
      'print se "a" "b"\n' +
      'repeat 2 [print se "x" "y"]\n' +
      "to rest :xs\n  print bf :xs\nend\n" +
      "rest :l\n" +
      'make "s" se "p" "q"\n' +
      "print :s\n",
  );
  const core = eventsOf(
    'make "l" [10 20 30 40]\n' +
      "print butfirst :l\n" +
      "print butlast :l\n" +
      "print butfirst butlast :l\n" +
      'print sentence "a" "b"\n' +
      'repeat 2 [print sentence "x" "y"]\n' +
      "define rest :xs\n  print butfirst :xs\nend\n" +
      "rest :l\n" +
      'make "s" sentence "p" "q"\n' +
      "print :s\n",
  );
  assert.deepEqual(withoutSpans(alias), withoutSpans(core));
});

// ---------------------------------------------------------------------------
// Value equivalence — each reporter alias reports exactly its Core twin's value
// ---------------------------------------------------------------------------

test("`bf`/`bl`/`se` report identical values to `butfirst`/`butlast`/`sentence`", () => {
  const alias = printedValues(
    eventsOf(
      "print bf [1 2 3]\nprint bl [1 2 3]\n" +
        'print se "a" "b"\nprint se [1 2] [3 4]\n',
    ),
  );
  const core = printedValues(
    eventsOf(
      "print butfirst [1 2 3]\nprint butlast [1 2 3]\n" +
        'print sentence "a" "b"\nprint sentence [1 2] [3 4]\n',
    ),
  );
  assert.deepEqual(alias, core);
  // And the concrete expected values, so this test also pins the Core semantics it mirrors.
  assert.deepEqual(alias, [[[2, 3]], [[1, 2]], [["a", "b"]], [[1, 2, 3, 4]]]);
});

test("`(se …)` variadic reports identically to `(sentence …)`", () => {
  const alias = printedValues(eventsOf('print (se "a" "b" "c")\n'));
  const core = printedValues(eventsOf('print (sentence "a" "b" "c")\n'));
  assert.deepEqual(alias, core);
  assert.deepEqual(alias, [[["a", "b", "c"]]]);
});

// ---------------------------------------------------------------------------
// No alias spelling leaks into any event payload (the profile-contract guarantee)
// ---------------------------------------------------------------------------

test("no `bf`/`bl`/`se` spelling appears anywhere in the emitted event stream", () => {
  const events = eventsOf(
    'make "l" [1 2 3]\nprint bf :l\nprint bl :l\nprint se "a" "b"\n',
  );
  const serialized = JSON.stringify(events);
  for (const alias of ["bf", "bl", "se"]) {
    assert.equal(
      serialized.includes(`"${alias}"`),
      false,
      `the alias "${alias}" must never reach an event payload`,
    );
  }
});

// ---------------------------------------------------------------------------
// The chokepoint is a strict no-op for Core spellings (non-regression evidence)
// ---------------------------------------------------------------------------

test("a Core-only reporter program is bit-for-bit unchanged — no `canonical`, so the chokepoint is a no-op", () => {
  // Every Core spelling carries no `canonical`, so `resolveHeritageAliasName` returns the surface
  // name unchanged; running the same program twice yields identical event streams, and this program
  // uses only Core reporters, so the whole existing behaviour is preserved.
  const first = eventsOf(
    "print butfirst [1 2 3]\nprint butlast [1 2 3]\n" +
      'print sentence "a" "b"\n',
  );
  const second = eventsOf(
    "print butfirst [1 2 3]\nprint butlast [1 2 3]\n" +
      'print sentence "a" "b"\n',
  );
  assert.deepEqual(first, second);
});

// ---------------------------------------------------------------------------
// Shadowing — a user procedure named like a reporter alias shadows the alias
// ---------------------------------------------------------------------------

test("a user procedure named `bf` shadows the alias — the surface name is not silently rewritten", () => {
  // `define bf … end` makes `bf` the user's procedure, exactly as `define butfirst … end` would
  // shadow the Core reporter. The runtime's guard skips canonicalization when the surface name is a
  // registered procedure, so the call dispatches to the user procedure, not `butfirst`.
  const events = eventsOf("to bf :x\n  print :x\nend\nbf 7\n");
  const enters = events.filter((e) => e.kind === "procedure-enter");
  assert.equal(enters.length, 1);
  assert.equal(enters[0].payload.name, "bf");
  assert.deepEqual(printedValues(events), [[7]]);
});

// ---------------------------------------------------------------------------
// Diagnostic equivalence — an alias that ERRORS must fail identically to its
// Core twin, and the diagnostic must carry the Core name, not the alias
// spelling (else Heritage would be observably different through diagnostics).
// ---------------------------------------------------------------------------

/** The diagnostics of `source` with every `source_span` stripped — spans differ between a short
 *  alias and its longer Core spelling, but the code, params, severity and stage must not. */
function diagnosticsWithoutSpans(source) {
  return execute(source, doc).diagnostics.map(
    ({ source_span, ...rest }) => rest,
  );
}

test("`bf`/`bl` on an empty list report the SAME runtime diagnostic as `butfirst`/`butlast`", () => {
  // A range error names the Core operation in its params. If the alias spelling leaked into the
  // diagnostic, Heritage would be observably different from Core through the error stream — the very
  // thing spec/conformance.md#heritage forbids. The `operation` param must read "butfirst"/"butlast".
  assert.deepEqual(
    diagnosticsWithoutSpans("print bf []\n"),
    diagnosticsWithoutSpans("print butfirst []\n"),
  );
  assert.deepEqual(
    diagnosticsWithoutSpans("print bl []\n"),
    diagnosticsWithoutSpans("print butlast []\n"),
  );
  // Pin that the Core name — not "bf"/"bl" — is what the diagnostic params surface.
  const [range] = diagnosticsWithoutSpans("print bf []\n");
  assert.equal(range.code, "ol-range");
  assert.equal(range.params.operation, "butfirst");
});

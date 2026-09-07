// The FOUR bounds on the precedence rule's suppression (`one-fault.ts`).
//
// `spec/execution-model.md:768-777` lets a token be spared exactly when its *only* fault is
// following a callee nothing resolves. Every word of that is a bound, and each is a separate
// mechanism that can be wrong on its own:
//
//   1. POSITION — a token that could never have been an argument keeps its own diagnostic.
//   2. TRAILING — the call must finish where the STATEMENT finishes, not merely somewhere.
//   3. SAME LINE — orphanhood propagates along a line and stops at the line boundary.
//   4. CODE     — only `ol-bad-token` may be suppressed at an orphan position.
//
// They are collected here because a reader auditing the precedence rule should find all four in
// one place, and **each label is red for its own mechanism** — a review measured an earlier draft
// where `BOUND 3` failed for the same-line check rather than the propagation it named, and
// `BOUND 1` only when suppression was disabled wholesale. A label that is red for a neighbouring
// mechanism is the table-row problem again: it reports a pass about something it did not test.
//
// **The fourth is the one worth reading about.** `one-fault.ts` argues at length that a *missing*
// entry in `couldBeAnArgument` only over-reports while a *wrong* entry suppresses a real diagnostic
// silently — correct, and load-bearing, and about the line twelve rows above the code filter that
// has the identical direction. Making the filter suppress EVERY code at an orphan position left
// 5,110 tests and 1,004 conformance fixtures green while four independent real faults vanished: a
// second unknown command, an arity error, an undefined variable. Argument about one token is not
// evidence about the one beside it.
//
// Every bound below asserts the SPAN as well as the code. A row asserting only that two codes
// appear could pass because the position was never an orphan at all — the same lesson as asserting
// the AST shape a row claims to construct, transposed onto positions.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { analyze, parse, walk } from "@openlogo/parser";

const PROFILES = ["core-language", "turtle-rendering", "data"];

/** Every finding for `source`, rendered as `code@line:column`, in order. */
function findings(source) {
  return analyze(source, "one-fault.logo", {
    profiles: PROFILES,
  }).diagnostics.map(
    (diagnostic) =>
      `${diagnostic.code}@${diagnostic.source_span.start.join(":")}`,
  );
}

test("BOUND 4 (code): only ol-bad-token may be suppressed at an orphan position", () => {
  // Each of these has a genuine second fault at column 9 or 11 — the orphan position — that is NOT
  // an `ol-bad-token`, and each must survive. Asserting the span is what makes the row mean
  // something: without it, a case could pass because column 9 was never an orphan.
  assert.deepEqual(findings("fowad 1 bar 2"), [
    "ol-unknown-command@1:1",
    "ol-unknown-command@1:9",
  ]);
  assert.deepEqual(findings("fowad 1 print"), [
    "ol-unknown-command@1:1",
    "ol-not-enough-inputs@1:9",
  ]);
  assert.deepEqual(findings("fowad 1 :x[9]"), [
    "ol-unknown-command@1:1",
    "ol-undefined-var@1:9",
  ]);
  assert.deepEqual(findings("fowad 1 2 bar 3"), [
    "ol-unknown-command@1:1",
    "ol-unknown-command@1:11",
  ]);
});

test("BOUND 4, positive half: an ol-bad-token at an orphan position IS suppressed", () => {
  // The control that keeps the four rows above from being satisfied by a rule that suppresses
  // nothing at all. `fowad 100` earns its `ol-bad-token` on `100` and loses it.
  assert.deepEqual(findings("fowad 100"), ["ol-unknown-command@1:1"]);
  // And the callee resolving is what makes the token independent again.
  assert.deepEqual(findings("forward 100 200"), ["ol-bad-token@1:13"]);
});

test("BOUND 2 (trailing): the call must finish where the STATEMENT finishes", () => {
  // Comparing a call's end to itself rather than to the statement's suppresses the `7` in
  // `[ fowad 1 ] 7`, where `fowad` merely occurs INSIDE a completed list literal and the `7` is an
  // independent fault. That mutation leaves the whole Definition of Done green.
  assert.deepEqual(findings("[ fowad 1 ] 7"), [
    "ol-bad-token@1:13",
    "ol-unknown-command@1:3",
  ]);
});

test("BOUND 1 (position): a token that could never be an argument keeps its diagnostic", () => {
  // `spec/execution-model.md:771-773`. A bracket that closes nothing follows the unresolvable
  // callee but could not have been an argument whatever the callee turned out to be.
  assert.deepEqual(findings("fowad 100 ]"), [
    "ol-unmatched-bracket@1:11",
    "ol-unknown-command@1:1",
  ]);
  // And a statement-only FORM likewise — this is the row that exercises `couldBeAnArgument`, the
  // predicate this bound is actually about. Without it the label was red only when suppression was
  // disabled wholesale, which is a different mechanism.
  assert.deepEqual(findings("fowad if 1 [ ]"), [
    "ol-bad-token@1:7",
    "ol-unknown-command@1:1",
  ]);
});

test("BOUND 3 (same line): orphanhood propagates along a line and stops at its end", () => {
  // The propagation is real and load-bearing: in `fowad 100 200` the `200` is suppressed ONLY
  // because the `100` before it was orphaned, so `previousWasOrphan` carries it along. An earlier
  // draft of this file described the mechanism backwards — as one orphan NOT reaching the next
  // token — and asserted the line boundary while calling it chaining.
  assert.deepEqual(findings("fowad 100 200"), ["ol-unknown-command@1:1"]);
  // Where it stops: each statement is judged on its own callee.
  assert.deepEqual(findings("fowad 1\nfowad 2"), [
    "ol-unknown-command@1:1",
    "ol-unknown-command@2:1",
  ]);
  // And a RESOLVING callee on the second line keeps its own extra-argument fault. Parse-stage
  // findings precede semantic ones in the merged list, as `fowad 100 ]` above also shows.
  assert.deepEqual(findings("fowad 1\nforward 100 200"), [
    "ol-bad-token@2:13",
    "ol-unknown-command@1:1",
  ]);
});

test("BOUND 1, parenthesized: a delimited call's arity is known, so a later token is independent", () => {
  // `(fowad 100) 5` keeps its `ol-bad-token`. The suppression's rationale
  // (`spec/execution-model.md:759-766`) is that a token after an unresolvable callee MIGHT have been
  // its argument, which cannot be judged because the arity is unknown. Parentheses delimit the
  // arguments, so that doubt does not arise — and the control shows the token's independence has
  // nothing to do with whether the callee resolves.
  assert.deepEqual(findings("(fowad 100) 5"), [
    "ol-bad-token@1:13",
    "ol-unknown-command@1:2",
  ]);
  assert.deepEqual(findings("(forward 100) 5"), ["ol-bad-token@1:15"]);
});

test("no code the two scans can see is emitted at both severities, which is what makes first-wins safe", () => {
  // `dedupeDiagnostics` keeps the FIRST of a colliding pair, so a warning arriving before an
  // identical-identity error would drop the error and silently defeat the run gate. The doc argues
  // that cannot happen because only `checker-style.ts` emits warnings, under `ol-style-*` codes no
  // error shares — and a review measured that the argument HOLDS today and that **nothing observes
  // it**. A correct prose promise about a safety precondition is still ungated prose.
  //
  // WHAT THE INSTRUMENTS ENUMERATE, stated because a scan that does not say so invites being read
  // as proof of more than it measured. Both walk every `.ts` file under `packages/` except
  // `node_modules` and `dist`, and they are deliberately DIFFERENT SHAPES, because a single
  // enumeration cannot see its own blind spot:
  //
  //   1. OBJECT LITERALS — a `code: "ol-…"` and a `severity:` literal within 400 characters. This
  //      is the shape the original argument was made about. Measured, it sees 26 of the 45
  //      registered codes.
  //   2. FACTORY CALL SITES — `parseError("ol-…"` / `runtimeError("ol-…"`. Those two factories take
  //      the code as an ARGUMENT and pin `severity: "error"` as a literal in their own bodies, so
  //      every code they emit is error-only by construction. This is the shape scan 1 is blind to,
  //      and it is not a hypothetical gap: it swallows the entire parse stage — `ol-type`,
  //      `ol-limit`, `ol-not-implemented`, every bracket and delimiter code, 19 in all.
  //
  // A REVERSED-ORDER arm (`severity:` before `code:`) was added in an earlier round and then
  // removed, because measuring it is what the rule above demands: it matched 3 times and all 3 were
  // CROSS-OBJECT artifacts — the lazy quantifier pairing a `severity:` that closes one function's
  // object with the `code:` of the next function. It contributed zero pairs the forward arm did not
  // already have, while opening a false-positive channel. Adding an arm because a shape is
  // conceivable, rather than because the corpus contains it, is how an instrument acquires noise.
  //
  // What remains invisible to both: a code held in a variable, or emitted through some third
  // factory. Closing that properly wants the severity to follow from the code in the type system,
  // or `dedupeDiagnostics` to be error-dominant rather than first-wins; both are larger than this
  // slice and neither is assumed here.
  const add = (into, name, severity) => {
    into.set(name, (into.get(name) ?? new Set()).add(severity));
  };
  const recordLiteralPairs = (into, text) => {
    for (const [, name, severity] of text.matchAll(
      /code:\s*"(ol-[a-z0-9-]+)"[\s\S]{0,400}?severity:\s*"(error|warning)"/g,
    )) {
      add(into, name, severity);
    }
  };
  const recordFactoryCalls = (into, text) => {
    for (const [, name] of text.matchAll(
      /\b(?:parseError|runtimeError)\(\s*"(ol-[a-z0-9-]+)"/g,
    )) {
      add(into, name, "error");
    }
  };
  const fromLiterals = new Map();
  const fromFactories = new Map();
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") {
          walk(full);
        }
        continue;
      }
      if (!entry.name.endsWith(".ts")) {
        continue;
      }
      const text = readFileSync(full, "utf8");
      recordLiteralPairs(fromLiterals, text);
      recordFactoryCalls(fromFactories, text);
    }
  };
  walk("packages");

  const union = new Map();
  for (const source of [fromLiterals, fromFactories]) {
    for (const [name, severities] of source) {
      for (const severity of severities) {
        add(union, name, severity);
      }
    }
  }
  assert.deepEqual(
    [...union].filter(([, severities]) => severities.size > 1),
    [],
    "a code emitted at both severities makes dedupe's first-wins able to drop an error behind a warning",
  );

  // Instrument controls. The first two prove each scan sees the shape it claims; the third proves
  // the second scan is LOAD-BEARING rather than decorative, which is the assertion the removed
  // reversed arm could not have passed.
  const control = new Map();
  recordLiteralPairs(control, '{ code: "ol-probe-a", severity: "warning" }');
  recordFactoryCalls(
    control,
    'return parseError("ol-probe-b", span, {}, "m");',
  );
  recordFactoryCalls(control, 'runtimeError(\n  "ol-probe-c",\n  span,\n);');
  assert.deepEqual(
    [...control].map(([name, severities]) => [name, [...severities]]).sort(),
    [
      ["ol-probe-a", ["warning"]],
      ["ol-probe-b", ["error"]],
      ["ol-probe-c", ["error"]],
    ],
    "each scan must see its own shape, including a factory call broken across lines",
  );
  assert.ok(
    fromLiterals.size > 0 && fromFactories.size > 0,
    "neither scan may be silently matching nothing",
  );
  const onlyFromFactories = [...fromFactories.keys()].filter(
    (name) => !fromLiterals.has(name),
  );
  assert.ok(
    onlyFromFactories.length > 0,
    `the factory scan must reach codes the literal scan cannot, or it adds nothing; it reached ${onlyFromFactories.length}`,
  );
  // PREMISE of the factory scan: it attributes `"error"` to every code those two factories emit,
  // which is only sound while the factories PIN that severity themselves and offer no way to vary
  // it. Nothing asserted that, so adding a severity parameter to either one would have silently
  // weakened the gate this test exists to be — the same "a mechanism with no assertion" shape the
  // scan itself was written to fix, one level up.
  for (const [path, factory] of [
    ["packages/parser/src/errors.ts", "parseError"],
    ["packages/runtime/src/errors.ts", "runtimeError"],
  ]) {
    const source = readFileSync(path, "utf8");
    const start = source.indexOf(`function ${factory}(`);
    assert.notEqual(start, -1, `${factory} must exist in ${path}`);
    // Bound the slice to the factory's OWN body, then strip comments from it. Slicing to
    // end-of-file made the assertion satisfiable by any later occurrence — a review measured
    // `parseError` unpinned plus one comment eleven thousand characters below passing the whole
    // suite. Bounding alone was not enough: a comment INSIDE the body satisfied it too. A premise
    // pin a decoy can satisfy is the shape this test exists to reject, so it is checked twice, and
    // the second check is behavioural rather than textual.
    const body = source
      .slice(start, source.indexOf("\n}", start) + 2)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    const signature = body.slice(0, body.indexOf("): Diagnostic"));
    assert.ok(
      body.includes('severity: "error"'),
      `${factory} must pin severity as a literal, or the scan's attribution is invented`,
    );
    assert.ok(
      !/severity/.test(signature),
      `${factory} must not take a severity parameter, or its call sites could vary it`,
    );
  }
  // And the behavioural half, which no comment and no decoy string can fake: a diagnostic each
  // factory really produced must actually carry `severity: "error"`. `[` is a parse fault and
  // `fowad 100` a SEMANTIC one — both from `parseError`. `runtimeError` lives in another package,
  // so its probe is in `packages/runtime`'s own suite; a review measured that this file alone could
  // not see `runtimeError` lose its pinned severity, and a single-quoted decoy defeated the textual
  // check, which is why both quoting styles are now stripped above.
  const produced = [
    parse("[", "one-fault.logo").diagnostics[0],
    analyze("fowad 100", "one-fault.logo", { profiles: PROFILES })
      .diagnostics[0],
  ];
  assert.deepEqual(
    produced.map((diagnostic) => diagnostic?.stage),
    ["parse", "semantic"],
    "the probes must really be the stages this test claims to cover",
  );
  for (const diagnostic of produced) {
    assert.equal(
      diagnostic.severity,
      "error",
      `${diagnostic.code} is attributed "error" by the factory scan and must really be one`,
    );
  }
});

test("BOUND 1's premise: a ParenCall's span starts before its callee's", () => {
  // The `ParenCall` arm of `endsInUnresolvableCall` was removed as structurally dead — restoring it
  // leaves 5,122 tests and 1,004 fixtures green, so the behaviour pin above cannot detect it coming
  // back. What the removal actually rests on is two facts, and this asserts them so that the day
  // either moves, something goes red rather than the arm quietly coming alive as a silent
  // over-suppression:
  //
  //   1. a `ParenCall`'s span starts at its `(`, NOT at its callee, and
  //   2. `checker-unknown-command` reports at the CALLEE's span.
  //
  // Together they make the arm's key lookup unable to match, which is why it never fired.
  const { ast } = parse("(fowad 100) 5", "one-fault.logo");
  let parenCall;
  walk(ast, (node) => {
    if (node.kind === "ParenCall") {
      parenCall = node;
    }
  });
  assert.ok(parenCall, "the sample must actually build a ParenCall");
  assert.notDeepEqual(
    parenCall.source_span.start,
    parenCall.callee.source_span.start,
    "a ParenCall starting at its callee would make the removed arm live again",
  );

  const reported = analyze("(fowad 100) 5", "one-fault.logo", {
    profiles: PROFILES,
  }).diagnostics.find((d) => d.code === "ol-unknown-command");
  assert.deepEqual(
    reported?.source_span.start,
    parenCall.callee.source_span.start,
    "ol-unknown-command is reported at the callee span, not the node span",
  );
});

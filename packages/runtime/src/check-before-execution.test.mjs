// The check before execution (`spec/execution-model.md:632-694`) and the terminal rule
// (`:696-735`), as `execute()` surfaces them — issue #815.
//
// This file owns the four mechanisms that slice introduced, and one property of each is worth
// stating here rather than leaving to the per-command suites: the gate decides by **severity**, the
// profile set governing the check is the **run's own**, the opt-out **runs anyway and still
// reports**, and evaluation **never ends in a skip**.
//
// It also carries the runtime twins that the gate would otherwise make unreachable. Every rule the
// semantic checker decides statically has a copy inside the runtime, because `evaluate()` and
// `createEnvironment()` are public API and a host can drive them with no checker at all. A checked
// run never reaches those copies — that is the whole point of the gate — so the only way to keep
// them honest is to run the same programs under `runUnchecked`, which is exactly what the spec's
// opt-out is for.

import assert from "node:assert/strict";
import test from "node:test";
import { makeSpan } from "@openlogo/core";
import { OL_CHECK_PROFILES, parse } from "@openlogo/parser";
import { createEnvironment, evaluate, execute } from "@openlogo/runtime";

const doc = "check-before-execution.logo";

/** Every diagnostic code `source` reports, in order. */
function codes(source, options) {
  return execute(source, doc, options).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
}

/** Every diagnostic `source` reports, in order. */
function diagnostics(source, options) {
  return execute(source, doc, options).diagnostics;
}

/** The kinds of every trace event `source` emits — empty when Phase 2 never began. */
function events(source, options) {
  return execute(source, doc, options).events.map((event) => event.kind);
}

/**
 * The `kind` of the nearest AST node enclosing the call to `callee` in `source`.
 *
 * A duplicate of the helper in `@openlogo/parser`'s `checker-command-in-value-position.test.mjs`,
 * and deliberately so: duplicating a *verification* is not the hazard duplicating a *rule* is. If
 * these two drift, each still checks its own file's claims correctly — whereas a shared identity
 * rule that drifts makes two packages disagree, which is the defect this slice found three times.
 */
function nearestEnclosingKind(source, callee) {
  const { ast, diagnostics: parsed } = parse(source, doc);
  assert.deepEqual(
    parsed,
    [],
    `${source}: must parse cleanly, or the case measures error recovery`,
  );
  const enclosing = [];
  const visit = (node, parent) => {
    if (node === null || typeof node !== "object") {
      return;
    }
    if (
      (node.kind === "Call" || node.kind === "ParenCall") &&
      node.callee?.name === callee
    ) {
      // Every row nests the call, so a missing parent is a broken row rather than a top-level
      // case: it fails the comparison below with "undefined" instead of being papered over.
      enclosing.push(parent?.kind);
    }
    const nextParent = node.kind === undefined ? parent : node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item, nextParent);
        }
      } else {
        visit(value, nextParent);
      }
    }
  };
  visit(ast, null);
  // Exactly ONE call, so a row naming a kind cannot be answered by a different call to the same
  // name. Taking the last match would fail *safe* — a second call is necessarily in statement
  // position, a kind no row claims — but it would fail saying "Program !== IsPredicate" rather
  // than saying what is actually wrong.
  assert.equal(
    enclosing.length,
    1,
    `${source}: expected exactly one call to ${callee}, found ${enclosing.length}`,
  );
  return enclosing[0];
}

/** The single diagnostic `source` reports, asserting there is exactly one. */
function only(source, options) {
  const { diagnostics } = execute(source, doc, options);
  assert.equal(
    diagnostics.length,
    1,
    `expected one diagnostic from ${JSON.stringify(source)}, got ${JSON.stringify(
      diagnostics.map((diagnostic) => diagnostic.code),
    )}`,
  );
  return diagnostics[0];
}

// --- The gate ---------------------------------------------------------------------------------

test("a program that fails the check does not run: no instruction, no trace event", () => {
  // `spec/execution-model.md:659-664`. `wibble` is unresolvable, so Phase 2 never begins — and the
  // statements around it, which would have run before, do not run either.
  const result = execute("print 1\nprint (wibble 2)\nprint 3", doc);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
  );
  assert.deepEqual(result.events, []);
});

test("the gate decides by SEVERITY, never by the presence of diagnostics", () => {
  // `spec/execution-model.md:666-671`, and the measurement behind it: `FORWARD 100` is a correct
  // program whose only finding is the Layer-3 warning `ol-style-name-case`. A presence test — the
  // shape sitting a few lines above the gate in `execute-internal.ts` — would refuse to run it.
  const result = execute("FORWARD 100", doc, { styleChecks: true });
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => [
      diagnostic.code,
      diagnostic.severity,
    ]),
    [["ol-style-name-case", "warning"]],
  );
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "move", "draw-segment"],
  );
});

test("style lints are off by default, so an ordinary run's diagnostics are unchanged", () => {
  assert.deepEqual(codes("FORWARD 100"), []);
});

test("the check runs under the RUN's profile set, not a fixed one", () => {
  // `spec/execution-model.md:673-680` names the wrong default outright: under a fixed **Core
  // Language**-only set `forward 100` is an unknown command, so an implementation claiming Turtle
  // & Rendering "would refuse to run a correct program". The default here is what this
  // implementation actually claims, and narrowing it is a caller's own, deliberate choice.
  assert.deepEqual(codes("forward 100"), []);
  assert.deepEqual(codes("forward 100", { profiles: ["core-language"] }), [
    "ol-unknown-command",
  ]);
});

test("a profile the run does not claim keeps ol-unknown-command; claiming it reaches the gap", () => {
  // The two halves of `spec/error-model.md:131`. `challenge` is a Tutor-AI primitive this
  // implementation registers but cannot evaluate. Under a run that does not claim Tutor the name
  // does not resolve at all, and the honest answer is that OpenLogo does not know it *here*. Under
  // one that does, the name is known and the gap is ours — which is what `ol-not-implemented` says,
  // and it is never `ol-unknown-command`, because that would blame the learner for our gap.
  assert.deepEqual(codes("challenge"), ["ol-unknown-command"]);
  const implemented = only("challenge", {
    profiles: [...OL_CHECK_PROFILES],
  });
  assert.equal(implemented.code, "ol-not-implemented");
  assert.deepEqual(implemented.params, { name: "challenge" });
  assert.equal(implemented.stage, "runtime");
  assert.match(implemented.message, /that is my gap, not your mistake/);
});

// --- The opt-out ------------------------------------------------------------------------------

test("runUnchecked is off by default, per run, and still delivers what it declined to act on", () => {
  // `spec/execution-model.md:687-694`. The same program, twice: refused by default, run under the
  // opt-out — and the finding is reported either way. "It changes whether the program also runs;
  // it never restores silence."
  const source = "forward 100\nprint :nope";
  const refused = execute(source, doc);
  assert.deepEqual(refused.events, []);
  assert.deepEqual(
    refused.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-undefined-var"],
  );

  const ran = execute(source, doc, { runUnchecked: true });
  assert.deepEqual(
    ran.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-undefined-var"],
  );
  assert.equal(
    ran.events.some((event) => event.kind === "draw-segment"),
    true,
    "the drawing before the mistake is still produced — that is what the opt-out is for",
  );
});

test("the opt-out does not reach Layer 1: a program that cannot be READ still does not run", () => {
  // A parse failure leaves no statements to run up to a first mistake, so the opt-out has nothing
  // to opt out of.
  const result = execute("repeat 4\nforward 10", doc, { runUnchecked: true });
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-missing-end"],
  );
  assert.deepEqual(result.events, []);
});

test("under the opt-out a fault the check already reported is suppressed, not delivered twice", () => {
  // `spec/execution-model.md:746-748`. Each of these raises the identical fault at both stages —
  // the runtime's own copy of a checker rule — and exactly one report survives.
  for (const source of [
    "first :nums = 1", // ol-not-a-place
    "forward", // ol-not-enough-inputs
    "(back 10 20)", // ol-too-many-inputs
    "return 1", // ol-return-outside-proc
    "stop", // ol-stop-outside-proc
    'print (5 is a "banana")', // ol-unknown-type
    "define forward\nend", // ol-reserved-word, from phase-1 registration
  ]) {
    const { diagnostics } = execute(source, doc, { runUnchecked: true });
    const byCode = new Map();
    for (const diagnostic of diagnostics) {
      byCode.set(diagnostic.code, (byCode.get(diagnostic.code) ?? 0) + 1);
    }
    for (const [code, count] of byCode) {
      assert.equal(count, 1, `${source} reported ${code} ${count} times`);
    }
  }
});

test("phase-1 registration's own refusal still delivers the check's findings beside it", () => {
  // The registration gate returns before the program runs, and it must not drop what the check
  // already found — the opt-out's "MUST still deliver" applies to it too.
  const result = execute("define forward\nend\nprint :nope", doc, {
    runUnchecked: true,
  });
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-undefined-var", "ol-reserved-word"],
  );
  assert.deepEqual(result.events, []);
});

// --- The terminal rule ------------------------------------------------------------------------

test("evaluation never ends in a skip, at any depth or argument position", () => {
  // `spec/execution-model.md:717-720`. Each of these used to run, produce nothing, and report
  // nothing; each now ends in a diagnostic. The nesting is the point — the rule holds "at any
  // depth, in any argument position, and for any callable".
  for (const source of [
    "print (wibble 2)",
    "print (first (wibble [1 2]))",
    "define p :a :b\n  print :a\nend\np 50 wibble",
    "print (difference 10 5)",
  ]) {
    assert.deepEqual(codes(source), ["ol-unknown-command"], source);
  }
});

test("a comprehension body this evaluator cannot run says so, naming the form", () => {
  // The body evaluator is deliberately narrower than `executeStatements`; before this slice that
  // narrowness silently discarded the whole comprehension and left `:out` unbound.
  const finding = only(":out = map n in [1] [\n  if true [ print 1 ]\n  :n\n]");
  assert.equal(finding.code, "ol-not-implemented");
  assert.deepEqual(finding.params, { name: "if" });
});

test("without source text the unrunnable form is named by its node kind, never left silent", () => {
  // `createEnvironment()` is public API, so a host can evaluate an AST it never had source text
  // for. The head word is read out of the source precisely so it prints what the learner wrote, and
  // when there is no source the node kind is the only name left — a worse word, never a missing
  // diagnostic, which is what the terminal rule actually requires.
  const { ast } = parse(
    ":out = map n in [1] [\n  if true [ print 1 ]\n  :n\n]",
    doc,
  );
  const comprehension = ast.body[0].value;
  const result = evaluate(comprehension, createEnvironment());
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-implemented");
  assert.deepEqual(result.diagnostic.params, { name: "If" });
});

test("the terminal rule reads the same in both call forms, bare and parenthesized", () => {
  // `Call` and `ParenCall` are two surface spellings of one thing, so neither terminal may answer
  // differently for them — the asymmetry a per-kind branch invites.
  const bareBody = only(":out = map n in [1] [ print :n\n  :n ]");
  const parenBody = only(":out = map n in [1] [ (print :n)\n  :n ]");
  for (const finding of [bareBody, parenBody]) {
    assert.equal(finding.code, "ol-not-implemented");
    assert.deepEqual(finding.params, { name: "print" });
  }
  const bareStatement = only("challenge", { profiles: [...OL_CHECK_PROFILES] });
  const parenStatement = only("(challenge)", {
    profiles: [...OL_CHECK_PROFILES],
  });
  for (const finding of [bareStatement, parenStatement]) {
    assert.equal(finding.code, "ol-not-implemented");
    assert.deepEqual(finding.params, { name: "challenge" });
  }
});

test("a bare expression statement is evaluated for effect, not skipped", () => {
  // `spec/execution-model.md:214-227`'s block-result rule. No statement executor claims a reporter
  // call, so `new_turtle` used to fall off the end of the dispatcher and spawn nothing at all.
  const result = execute("new_turtle", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "spawn-turtle"],
  );
  // And an arithmetic statement still just discards its value, with no diagnostic.
  assert.deepEqual(codes("1 + 1"), []);
});

test("a built-in that is neither a Command nor evaluable reports ol-not-implemented", () => {
  // The third arm of `evaluateCall`'s terminal, and the one no source program can reach: OpenLogo
  // has no registered *reporter* without an evaluation today, which is the healthy state
  // (`spec/error-model.md:131` makes such a gap a conformance failure of the profile that claims
  // it). The arm still has to be right for the day one appears, so it is exercised the way this
  // file's neighbours exercise other evaluator-internal invariants the grammar makes unreachable:
  // by handing `evaluate()` a node the parser would never build. `if` is a built-in word that is
  // not a Command, so it takes exactly that path.
  const span = makeSpan(doc, [1, 1], [1, 3]);
  const call = {
    kind: "Call",
    source_span: span,
    callee: { name: "if", source_span: span },
    args: [],
  };
  const result = evaluate(call, createEnvironment());
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-implemented");
  assert.deepEqual(result.diagnostic.params, { name: "if" });
});

test("the opt-out's suppression folds a coarser report into a more detailed one, either way round", () => {
  // The check's `ol-unknown-command` carries a `suggestion`; the runtime's cannot, because the
  // did-you-mean is computed over the visible vocabulary, which is a Layer-2 concept. So the two
  // sides of the params comparison are of different sizes, and the fold has to work whichever side
  // is larger. One report survives, and it is the one that can help.
  const finding = only("print (fowad 5)", { runUnchecked: true });
  assert.equal(finding.code, "ol-unknown-command");
  assert.deepEqual(finding.params, { name: "fowad", suggestion: "forward" });
});

// --- One fault, one diagnostic ------------------------------------------------------------------

test("a token whose only fault is following an unresolvable callee carries no diagnostic", () => {
  // `spec/execution-model.md:750-766`, the commonest learner typo. `100` has no grammatical home
  // because `fowad` has unknown arity — but it is not the fault, and reporting it buries the one
  // repair the learner can make.
  const suggested = only("fowad 100");
  assert.equal(suggested.code, "ol-unknown-command");
  assert.deepEqual(suggested.params, { name: "fowad", suggestion: "forward" });
});

test("the did-you-mean is computed over the VISIBLE vocabulary", () => {
  // Same line: `suggestion: "forward"` when Turtle & Rendering is in the run's profile set, "and
  // no `suggestion` when it is not, because `forward` is not visible to suggest".
  assert.deepEqual(only("fowad 100", { profiles: ["core-language"] }).params, {
    name: "fowad",
  });
});

test("the suppression is bounded: an independently wrong token is still reported", () => {
  // `spec/execution-model.md:768-777`. The bracket "is wrong whatever the callee turns out to be";
  // the `@` characters are not OpenLogo tokens at all.
  assert.deepEqual(codes("fowad 100 ]"), [
    "ol-unmatched-bracket",
    "ol-unknown-command",
  ]);
  assert.deepEqual(codes("fowad @@@"), [
    "ol-bad-token",
    "ol-bad-token",
    "ol-bad-token",
    "ol-unknown-command",
  ]);
});

test("the suppression is bounded the other way: a RESOLVABLE callee is untouched", () => {
  // The no-regression half. In both of these the callee resolves and its arity is known, so the
  // extra argument is a genuine finding.
  assert.deepEqual(codes("forward 100 200"), ["ol-bad-token"]);
  assert.deepEqual(codes("define f :a\n  print :a\nend\nf 1 2"), [
    "ol-bad-token",
  ]);
  // `challenge` is arity 0 and, under a run claiming Tutor, resolvable — so its stray argument is
  // reported exactly as `forward`'s is, rather than inheriting the unresolvable-callee suppression.
  assert.deepEqual(
    codes('challenge "x"', { profiles: [...OL_CHECK_PROFILES] }),
    ["ol-bad-token"],
  );
});

test("the chain covers every orphan of one unresolvable call, not just the first", () => {
  assert.deepEqual(codes("fowad 100 200"), ["ol-unknown-command"]);
});

// --- ol-no-output for built-in commands ---------------------------------------------------------

test("a built-in command used where a value is required is reported, uniformly across forms", () => {
  // Issue #716's finding, and why it is one rule: the same fault appears in a wait duration, a
  // repeat count, a turtle command's argument, an event operand, and a print argument, and fixing
  // one form alone would have made the inconsistency worse.
  for (const source of [
    "wait forward 5",
    "repeat forward 5 [ print 1 ]",
    "right forward 5",
    'when forward 5 [ print "x" ]',
    'every forward 5 [ print "x" ]',
    "print forward 5",
  ]) {
    const finding = only(source);
    assert.equal(finding.code, "ol-no-output", source);
    assert.deepEqual(finding.params, { procedure: "forward" }, source);
    assert.equal(finding.stage, "semantic", source);
  }
});

test("a Heritage alias reports its CANONICAL spelling, like every other diagnostic param", () => {
  assert.deepEqual(only("print fd 5").params, { procedure: "forward" });
});

test("a comprehension body ending in a command is ol-no-value, not ol-no-output", () => {
  // `spec/tooling.md:189` draws the boundary: the block-result rule owns that case, and the two
  // rows must not both fire on it.
  assert.deepEqual(codes(":out = map n in [1 2] [ forward :n ]"), [
    "ol-no-value",
  ]);
});

test("a list literal's elements are value expressions, so a command there is ol-no-output", () => {
  // OpenLogo lists are not classic Logo's word lists: `spec/grammar.md:208` reads
  // `list-literal ::= "[" [ expression { expression } ] "]"`, and `spec/data-structures.md:51`
  // calls the elements "whitespace-separated value expressions". So `[ print 1 ]` holds a Command
  // where a value is required, and `[a b c]` is three calls to names nothing resolves — a list of
  // words is written `["a" "b" "c"]`. Both used to be silent.
  assert.equal(only("print [ print 1 ]").stage, "semantic");
  assert.deepEqual(events("print [ print 1 ]"), []);
  assert.deepEqual(codes("print [a b c]"), [
    "ol-unknown-command",
    "ol-unknown-command",
    "ol-unknown-command",
  ]);
  assert.deepEqual(codes('print ["a" "b"]'), []);
});

test("value position propagates into EVERY nesting form, statically", () => {
  // `ol-no-output` has a RUNTIME twin, so asserting the code alone cannot tell "the checker caught
  // it before Phase 2" from "the program ran and the runtime raised it afterwards". A review
  // proved the difference is real: deleting the one line that propagates value position through
  // non-`Program`/`Block` nodes left the whole Definition of Done green while an `instruction`
  // event escaped for `print [ print 1 ]` — mechanism 1's headline promise ("on a `severity:
  // error`, no instruction, no trace event") violated and unobserved.
  //
  // So `stage` and the EVENT STREAM are what these assert. The event stream is the load-bearing
  // half: it is the only observation that distinguishes a program refused before Phase 2 from one
  // that ran and was diagnosed on the way.
  //
  // Each entry names a different `ExpressionNode` nesting, because the rule is written
  // structurally — everything that is not `Program`/`Block` is a value position — and only
  // deliberate coverage of each form can tell that design from an enumeration of the four that
  // happened to be tested.
  for (const [form, source] of [
    ["ListLit", ":x = [ 1 forward 1 ]"],
    ["Throw", "throw forward 1"],
    ["Comprehension", ":x = map n in forward 1 [ :n ]"],
    ["ComparisonChain", ":x = 1 < (forward 1) < 3"],
    ["ForRange", "for i from 1 to forward 1 [ print 1 ]"],
    ["ForIn", "for i in forward 1 [ print 1 ]"],
    ["IsPredicate", ":x = (forward 1) is empty"],
    ["DictLit", ":x = {a: forward 1}"],
    ["PostfixExpression", ":x = (forward 1)[1]"],
  ]) {
    // Assert the shape the row claims, not just the diagnostic. Two earlier rows named
    // `ComparisonChain` and `IsPredicate` and constructed neither — `forward` binds the whole
    // following expression, so `if forward 1 == 2 [ … ]` is `if (forward (1 == 2))` and the
    // finding came from the `If` arm a row above already covered. Every other assertion passed.
    assert.equal(
      nearestEnclosingKind(source, "forward"),
      form,
      `${source}: this row claims to nest the command in ${form}`,
    );
    const findings = diagnostics(source);
    // Pinned, not filtered: filtering for `ol-no-output` tolerates extra semantic diagnostics, and
    // a case reporting only through parse recovery would pass. Measured, every row here produces
    // exactly this one finding, so pinning the whole list costs nothing and closes the gap.
    assert.deepEqual(
      findings.map((finding) => finding.code),
      ["ol-no-output"],
      `${form}: exactly one finding, and nothing else`,
    );
    assert.equal(
      findings[0]?.stage,
      "semantic",
      `${form}: reported at runtime means the program RAN — the gate did not stop it`,
    );
    assert.deepEqual(
      events(source),
      [],
      `${form}: Phase 2 must not begin at all`,
    );
  }

  // The instrument control: `events` must be able to see an event stream, or every assertion above
  // is satisfied by a helper that reports nothing whatever it is given. This is the same shape as
  // the empty-list controls elsewhere in this file, and the reason they exist: a review found a
  // profile sweep whose negative cases were all satisfied by a preamble that halted first.
  assert.notDeepEqual(events("forward 1"), []);
});

// --- The runtime twins the gate would otherwise hide --------------------------------------------

test("the runtime's own arity guards still fire when the check is bypassed", () => {
  // Each of these is a guard inside `@openlogo/runtime`, reachable through `evaluate()` and
  // `createEnvironment()` with no checker in sight — so it must keep working even though a checked
  // run never gets to it.
  for (const [source, code] of [
    ["print (sqrt 1 2)", "ol-too-many-inputs"],
    ["print (pi 1)", "ol-too-many-inputs"],
    ["print (is_a? 1)", "ol-not-enough-inputs"],
    ["print (uppercase)", "ol-not-enough-inputs"],
    ["print (dict 1)", "ol-too-many-inputs"],
    ["(explain 1)", "ol-too-many-inputs"],
    ["print (input)", "ol-not-enough-inputs"],
    ["define p\n  print 1\nend\n(p 1)", "ol-too-many-inputs"],
    ["define p :a\n  print :a\nend\n(p)", "ol-not-enough-inputs"],
  ]) {
    const { diagnostics } = execute(source, doc, { runUnchecked: true });
    assert.equal(
      diagnostics.some((diagnostic) => diagnostic.code === code),
      true,
      `${source} should report ${code}, got ${JSON.stringify(diagnostics.map((d) => d.code))}`,
    );
  }
});

test("a reporter propagates a diagnostic raised while evaluating its own operand", () => {
  for (const source of [
    "print (uppercase (1 / 0))",
    "print (input (1 / 0))",
    "add 1 to (1 / 0)",
    "print (list 1 (1 / 0))",
  ]) {
    assert.deepEqual(
      codes(source, { runUnchecked: true }),
      ["ol-div-zero"],
      source,
    );
  }
});

test("uppercase and lowercase report a case-mapped word, and reject a non-word", () => {
  // Both were registered with no evaluator until this slice, which is exactly the gap
  // `ol-not-implemented` made visible — in an example shipped in `spec/commands.md` itself.
  const printed = (source) =>
    execute(source, doc)
      .events.filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]);
  assert.deepEqual(printed('print uppercase "logo"'), ["LOGO"]);
  assert.deepEqual(printed('print lowercase "Logo"'), ["logo"]);
  const typeError = only("print uppercase 5");
  assert.equal(typeError.code, "ol-type");
  assert.deepEqual(typeError.params, {
    expected: "word",
    actual: "number",
    value: 5,
    operation: "uppercase",
  });
});

test("the runtime's own duplicate-binder guard still fires when the check is bypassed", () => {
  const finding = only(":out = reduce n [ :n :n ] in [1] from 0 [ :n ]", {
    runUnchecked: true,
  });
  assert.equal(finding.code, "ol-duplicate-binder");
  const accumulator = only(
    ":out = reduce total total in [1] from 0 [ :total ]",
    { runUnchecked: true },
  );
  assert.equal(accumulator.code, "ol-duplicate-binder");
});

test("a return or stop escaping an event handler body is still the runtime's to report", () => {
  // A handler block is not a procedure, so an escape inside one is `ol-return-outside-proc`. The
  // checker decides that statically, so a checked run is refused before the handler could ever
  // fire; the opt-out is what still reaches the runtime's own copy — the one a host driving
  // `execute()` with no checker would depend on.
  for (const [source, code] of [
    ['on_key "a" [ return 1 ]\nwait 2', "ol-return-outside-proc"],
    ['on_key "a" [ stop ]\nwait 2', "ol-stop-outside-proc"],
    ["on_click [ return 1 ]\nwait 2", "ol-return-outside-proc"],
    ["on_click [ stop ]\nwait 2", "ol-stop-outside-proc"],
  ]) {
    const result = execute(source, doc, {
      runUnchecked: true,
      hostInput: {
        events: [
          { tick: 1, kind: "key", key: "a" },
          { tick: 1, kind: "click" },
        ],
      },
    });
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => diagnostic.code),
      [code],
      source,
    );
  }
});

// --- Round-11 review: `local` is a KNOWN GAP, characterized here rather than assumed ------------
//
// `isExpressionStatement` excludes three statement kinds. Two — `ProcedureDef` and `StructDef` —
// are excluded because Phase 1 already registered them, so the statement has nothing left to do.
// The third, `Local`, was excluded on the same stated reason, and that reason is FALSE: `local` is
// specified to introduce a binding in the enclosing procedure's frame
// (`spec/execution-model.md:340-349`), and this evaluator never creates one.
//
// The behaviour is pinned below rather than described, because a comment claiming "nothing to run"
// is exactly the kind of unverified prose this slice exists to distrust. It predates issue #815 —
// no run of any profile has ever created a local frame entry — and converting it to
// `ol-not-implemented` would refuse the corpus programs that use `local`, inside a slice scoped to
// the check gate, value-position commands, the terminal rule and de-duplication. It is escalated,
// not absorbed: **issue #818** already tracks it ("runtime: `local` has no effect at execution — the
// checker gets it right, `execute()` ignores it"), and this measurement is an independent
// rediscovery of it.
//
// WHEN #818 IS FIXED these assertions must FLIP, and the `Local` arm of `isExpressionStatement`
// must be deleted rather than preserved. Naming the issue is what makes that a tracked claim rather
// than a sentence hoping someone reads it.

/** Every value `source` prints, in order. */
function printed(source, options) {
  return execute(source, doc, options)
    .events.filter((event) => event.kind === "print")
    .map((event) => event.payload.values);
}

const CORE_AND_TURTLE = { profiles: ["core-language", "turtle-rendering"] };

test("CHARACTERIZATION: `local` does not shadow — the assignment reaches the global", () => {
  const source = ":x = 1\ndefine f\n  local x\n  :x = 2\nend\nf\nprint :x\n";
  assert.deepEqual(codes(source, CORE_AND_TURTLE), []);
  assert.deepEqual(
    printed(source, CORE_AND_TURTLE),
    [[2]],
    "CHARACTERIZES THE WRONG BEHAVIOUR (#818): the global was written. Correct is [[1]] — when this fails with actual [[1]], #818 is fixed and this assertion must flip",
  );
});

test("the parameter-shadowing control proves frames themselves work", () => {
  // This is what makes the case above a `local` defect rather than a scoping one: the same
  // program written with a parameter shadows correctly, so the frame machinery is present and
  // only `local` fails to write into it.
  const source = ":x = 1\ndefine g :x\n  :x = 2\nend\ng 5\nprint :x\n";
  assert.deepEqual(codes(source, CORE_AND_TURTLE), []);
  assert.deepEqual(printed(source, CORE_AND_TURTLE), [[1]]);
});

test("`local` is skipped SILENTLY — the gap is invisible, which is why it is recorded", () => {
  // The terminal rule turns an undispatched statement into `ol-not-implemented`. `Local` is
  // excluded from that rule, so nothing marks the gap at run time. This assertion is the marker.
  assert.deepEqual(codes("define f\n  local y\nend\nf\n", CORE_AND_TURTLE), []);
});

// --- Round-12 review: the de-duplicator must not decide which diagnostic a program gets ---------
//
// `canonicalize` walks a diagnostic's `params`, and `params` carry real `OLValue`s. A self-
// referential list overflowed that walk, so the owed `ol-type` was replaced by `ol-limit` — a wrong
// diagnostic manufactured by the machinery whose only job is to decide which findings survive.
// `spec/execution-model.md:717-720` requires evaluation to end in a value, an effect, or a
// diagnostic; it does not permit the wrong one.

test("a cyclic list reaches the diagnostic it is owed, not ol-limit", () => {
  const result = execute(":x = []\nadd :x to :x\nforward :x\n", doc, {
    profiles: ["core-language", "turtle-rendering", "data"],
  });
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-type"],
  );
});

test("a cyclic list nested inside another value is also safe", () => {
  const result = execute(
    ":x = []\nadd :x to :x\n:y = [1]\nadd :x to :y\nforward :y\n",
    doc,
    { profiles: ["core-language", "turtle-rendering", "data"] },
  );
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-type"],
  );
});

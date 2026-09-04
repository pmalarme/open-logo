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
import { OL_CHECK_PROFILES, parse } from "@openlogo/parser";
import { createEnvironment, evaluate, execute } from "@openlogo/runtime";

const doc = "check-before-execution.logo";

/** Every diagnostic code `source` reports, in order. */
function codes(source, options) {
  return execute(source, doc, options).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
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
  assert.deepEqual(codes("print [ print 1 ]"), ["ol-no-output"]);
  assert.deepEqual(codes("print [a b c]"), [
    "ol-unknown-command",
    "ol-unknown-command",
    "ol-unknown-command",
  ]);
  assert.deepEqual(codes('print ["a" "b"]'), []);
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

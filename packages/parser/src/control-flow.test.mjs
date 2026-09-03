import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for issue #114 — control-flow statics (`ol-return-outside-proc`,
 * `ol-stop-outside-proc`, `ol-return-in-comprehension`, `ol-no-value`, `ol-duplicate-binder`).
 * Behavior is verified through the public `@openlogo/parser` surface (`parse` + `check`), matching
 * the package's black-box test convention. Assertions check diagnostic identity — code, params,
 * stage, severity, and span — never the (non-normative) English message text.
 */

const CONTROL_FLOW_CODES = new Set([
  "ol-return-outside-proc",
  "ol-stop-outside-proc",
  "ol-return-in-comprehension",
  "ol-no-value",
  "ol-duplicate-binder",
]);

function controlFlowFindings(source, profiles = ["core-language"]) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, "unit.logo");
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles }).diagnostics.filter((d) =>
    CONTROL_FLOW_CODES.has(d.code),
  );
}

// --- ol-return-outside-proc -------------------------------------------------

test("flags `return` used at top level, outside any procedure", () => {
  const diagnostics = controlFlowFindings("return 5");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-return-outside-proc");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { keyword: "return" });
  // Span points at just the `return` control word, not `return 5`.
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 1],
    end: [1, 7],
  });
});

test("its message uses the warm lowercase Logo voice", () => {
  const { ast } = OL.parse("return 5", "unit.logo");
  const [finding] = OL.check(ast, { profiles: ["core-language"] }).diagnostics;
  assert.match(finding.message, /^return only reports a value/);
});

test("accepts `return` inside a `define … end` procedure body", () => {
  const diagnostics = controlFlowFindings("define f\n  return 5\nend");
  assert.deepEqual(diagnostics, []);
});

// --- ol-stop-outside-proc ---------------------------------------------------

test("flags a bare `stop` at top level, outside any procedure", () => {
  const diagnostics = controlFlowFindings("stop");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-stop-outside-proc");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, {});
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 1],
    end: [1, 5],
  });
});

test("accepts `stop` inside a `define … end` procedure body", () => {
  const diagnostics = controlFlowFindings("define halt\n  stop\nend");
  assert.deepEqual(diagnostics, []);
});

// --- ol-return-in-comprehension ---------------------------------------------

test("flags `return` inside a comprehension body with its form", () => {
  const diagnostics = controlFlowFindings("print map n in :nums [ return :n ]");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-return-in-comprehension");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { keyword: "return", form: "map" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 24],
    end: [1, 30],
  });
});

test("routes `stop` inside a comprehension body to the comprehension code", () => {
  const diagnostics = controlFlowFindings("print map n in :nums [ stop ]");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-return-in-comprehension");
  assert.deepEqual(finding.params, { keyword: "stop", form: "map" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 24],
    end: [1, 28],
  });
});

test("prefers the comprehension code over outside-proc when nested in a procedure", () => {
  const diagnostics = controlFlowFindings(
    "define f\n  print map n in :nums [ return :n ]\nend",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-return-in-comprehension");
  assert.deepEqual(diagnostics[0].params, { keyword: "return", form: "map" });
});

test("reports the form of the nearest enclosing comprehension (filter, reduce)", () => {
  const filter = controlFlowFindings("print filter n in :nums [ stop ]");
  assert.deepEqual(filter[0].params, { keyword: "stop", form: "filter" });
  const reduce = controlFlowFindings(
    "print reduce acc n in :nums from 0 [ return :acc ]",
  );
  assert.deepEqual(reduce[0].params, { keyword: "return", form: "reduce" });
});

// --- ol-no-value ------------------------------------------------------------

test("reproduces the spec worked example: `map … [ print :num ]` has no value", () => {
  const diagnostics = controlFlowFindings(
    ":nums = [1 2 3]\n:doubled = map num in :nums [\n  print :num\n]",
  );
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-no-value");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { form: "map" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [2, 12],
    end: [4, 2],
  });
});

test("flags an empty comprehension body as no-value", () => {
  const diagnostics = controlFlowFindings("print map n in :nums []");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-no-value");
  assert.deepEqual(diagnostics[0].params, { form: "map" });
});

test("flags a comprehension body ending in a non-value statement (if) as no-value", () => {
  const diagnostics = controlFlowFindings(
    "print map n in :nums [ if :n [ print :n ] ]",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-no-value");
});

test("flags a comprehension body ending in a parenthesized Core command as no-value", () => {
  const diagnostics = controlFlowFindings(
    "print map n in :nums [ (print :n) ]",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-no-value");
  assert.deepEqual(diagnostics[0].params, { form: "map" });
});

test("does not double-report no-value when the last statement is an escape", () => {
  const diagnostics = controlFlowFindings("print map n in :nums [ return :n ]");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-return-in-comprehension");
});

test("accepts a comprehension body ending in a value-producing expression", () => {
  const varRef = controlFlowFindings("print map n in :nums [ :n ]");
  assert.deepEqual(varRef, []);
  const infix = controlFlowFindings("print map n in :nums [ :n * 2 ]");
  assert.deepEqual(infix, []);
});

test("treats a call to an unknown (non-Core-command) callee as value-producing", () => {
  const diagnostics = controlFlowFindings(
    "print map n in :nums [ neighbors :n ]",
  );
  assert.deepEqual(diagnostics, []);
});

test("treats a Core command as value-producing when core-language is not active", () => {
  const diagnostics = controlFlowFindings(
    "print map n in :nums [ print :n ]",
    [],
  );
  assert.deepEqual(diagnostics, []);
});

// --- ol-duplicate-binder ----------------------------------------------------

test("flags a `reduce` whose accumulator and item binder share a name", () => {
  const diagnostics = controlFlowFindings(
    "print reduce sum sum in :nums from 0 [ :sum ]",
  );
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-duplicate-binder");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { name: "sum", form: "reduce" });
  // Span points at the second (item) binder occurrence.
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 18],
    end: [1, 21],
  });
});

test("accepts a `reduce` whose accumulator and item binder differ", () => {
  const diagnostics = controlFlowFindings(
    "print reduce acc n in :nums from 0 [ :acc ]",
  );
  assert.deepEqual(diagnostics, []);
});

test("accepts a `reduce` whose item binder destructures (issue #72)", () => {
  // `reduce acc [:x :y]`: the accumulator is distinct from the pattern and the pattern's own
  // names are distinct, so neither the accumulator-vs-pattern collision (#407/F8) nor the
  // pattern-internal duplicate (#440) fires. A colliding accumulator or a repeated pattern name
  // would — see the map/filter/reduce destructuring tests below.
  const diagnostics = controlFlowFindings(
    "print reduce acc [:x :y] in :pairs from 0 [ :acc ]",
  );
  assert.deepEqual(diagnostics, []);
});

test("flags a repeated name inside a `for … in` destructuring pattern", () => {
  const diagnostics = controlFlowFindings("for [:x :x] in :pairs [ print :x ]");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-duplicate-binder");
  assert.deepEqual(finding.params, { name: "x", form: "destructuring" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 9],
    end: [1, 11],
  });
});

test("accepts a `for … in` destructuring pattern whose names are distinct", () => {
  const diagnostics = controlFlowFindings("for [:x :y] in :pairs [ print :x ]");
  assert.deepEqual(diagnostics, []);
});

test("accepts a plain (non-destructuring) `for … in` binder", () => {
  const diagnostics = controlFlowFindings("for n in :nums [ print :n ]");
  assert.deepEqual(diagnostics, []);
});

// issue #440: a repeated name inside a comprehension's destructuring pattern is an
// `ol-duplicate-binder` for `map`/`filter`/`reduce`, just as it is for `for … in` — before #440
// the semantic checker caught it only for `for … in`, so the map/filter/reduce cases reached the
// runtime unflagged (a semantic/runtime parity gap).

test("flags a repeated name inside a `map` destructuring pattern", () => {
  const diagnostics = controlFlowFindings("print map [:x :x] in :pairs [ :x ]");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-duplicate-binder");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { name: "x", form: "destructuring" });
  // Span points at the second `:x` occurrence, same convention as `for … in`.
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 15],
    end: [1, 17],
  });
});

test("flags a repeated name inside a `filter` destructuring pattern", () => {
  const diagnostics = controlFlowFindings(
    "print filter [:x :x] in :pairs [ :x ]",
  );
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-duplicate-binder");
  assert.deepEqual(finding.params, { name: "x", form: "destructuring" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 18],
    end: [1, 20],
  });
});

test("flags a repeated name inside a `reduce` destructuring pattern (accumulator distinct)", () => {
  const diagnostics = controlFlowFindings(
    "print reduce a [:x :x] in :pairs from 0 [ :a ]",
  );
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-duplicate-binder");
  assert.deepEqual(finding.params, { name: "x", form: "destructuring" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 20],
    end: [1, 22],
  });
});

test("reports one finding when a `reduce` name both collides with the accumulator and repeats in the pattern", () => {
  // `reduce x [:x :x]`: `x` collides with the accumulator (#407/F8) AND repeats inside the
  // pattern (#440). Exactly one `ol-duplicate-binder` — the pattern-internal repeat wins (later
  // occurrence, `form:"destructuring"`) and the accumulator collision for that same name is
  // suppressed, so there is no double-report.
  const diagnostics = controlFlowFindings(
    "print reduce x [:x :x] in :pairs from 0 [ :x ]",
  );
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-duplicate-binder");
  assert.deepEqual(finding.params, { name: "x", form: "destructuring" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 20],
    end: [1, 22],
  });
});

test("flags a `reduce` accumulator colliding with one distinct destructuring pattern name (issue #407/F8)", () => {
  // `reduce x [:x :y]`: the accumulator reuses the pattern's first name, which appears only once,
  // so the accumulator-collision check reports it with `form:"reduce"` — the pattern has no
  // internal duplicate, so no destructuring finding is added and the collision is not suppressed.
  const diagnostics = controlFlowFindings(
    "print reduce x [:x :y] in :pairs from 0 [ :x + :y ]",
  );
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-duplicate-binder");
  assert.deepEqual(finding.params, { name: "x", form: "reduce" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 17],
    end: [1, 19],
  });
});

test("accepts a `map` destructuring pattern whose names are distinct", () => {
  const diagnostics = controlFlowFindings(
    "print map [:x :y] in :pairs [ :x + :y ]",
  );
  assert.deepEqual(diagnostics, []);
});

test("accepts a `filter` destructuring pattern whose names are distinct", () => {
  const diagnostics = controlFlowFindings(
    "print filter [:x :y] in :pairs [ :x > :y ]",
  );
  assert.deepEqual(diagnostics, []);
});

// --- traversal: context threads through nested constructs -------------------

test("descends into a procedure body to flag a nested comprehension's no-value", () => {
  const diagnostics = controlFlowFindings(
    "define f\n  :x = map n in :nums [ print :n ]\nend",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-no-value");
});

test("descends into a `return` value expression to reach a nested comprehension", () => {
  const diagnostics = controlFlowFindings(
    "define f\n  return map n in :nums [ print :n ]\nend",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-no-value");
});

test("judges an escape inside a `for … in` loop body by the surrounding context", () => {
  const outside = controlFlowFindings("for n in :nums [ return 1 ]");
  assert.equal(outside.length, 1);
  assert.equal(outside[0].code, "ol-return-outside-proc");
  const inside = controlFlowFindings(
    "define f\n  for n in :nums [ return 1 ]\nend",
  );
  assert.deepEqual(inside, []);
});

// --- an event-handler block (`when [ … ]`) is a fresh control-flow boundary (issue #682) ----
// A handler body is neither a procedure body nor a comprehension body, so the static checker must
// judge a `return`/`stop` inside it as OUTSIDE any procedure — matching the runtime, which
// reclassifies an escaping handler signal at the handler boundary. Without this the checker would
// accept code the runtime rejects when the `when` is written inside a `define`.

const withInteraction = ["core-language", "interaction-events"];

test("flags `return` inside a `when` handler as outside a procedure (top level)", () => {
  const diagnostics = controlFlowFindings(
    'when "start" [ return 7 ]',
    withInteraction,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-return-outside-proc");
});

test("flags `return` inside a `when` handler even when the `when` is inside a procedure", () => {
  // The enclosing `define` does NOT make the handler body procedure-local: the handler is a fresh
  // boundary, so the runtime raises ol-return-outside-proc here and the checker must agree.
  const diagnostics = controlFlowFindings(
    'define setup\n  when "start" [ return 7 ]\nend',
    withInteraction,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-return-outside-proc");
});

test("flags `stop` inside a `when` handler nested in a procedure as outside a procedure", () => {
  const diagnostics = controlFlowFindings(
    'define setup\n  when "start" [ stop ]\nend',
    withInteraction,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-stop-outside-proc");
});

test("accepts an ordinary body inside a `when` handler (no escape)", () => {
  const diagnostics = controlFlowFindings(
    'when "start" [ print "hi" ]',
    withInteraction,
  );
  assert.deepEqual(diagnostics, []);
});

test("a comprehension body inside a `when` handler is still a comprehension boundary", () => {
  // The handler reset re-establishes a control boundary, but a `map` inside it re-enters a
  // comprehension value-context, so a `return` there is ol-return-in-comprehension, not
  // ol-return-outside-proc.
  const diagnostics = controlFlowFindings(
    'when "start" [ print map n in [1] [ return :n ] ]',
    withInteraction,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-return-in-comprehension");
});

// --- Heritage spellings keep the CANONICAL diagnostic identity (issue #737) -------------------
// `output`/`op` are Heritage *alternate spellings* of `return` (spec/conformance.md#heritage —
// "alternate spellings only, no new semantics"), lowered onto the same `Return` node. Diagnostic
// identity is `code` plus structured `params`, and the same condition MUST keep the same code AND
// the same params (spec/error-model.md:255-260), so all three spellings raise byte-identical
// diagnostic IDENTITIES — same `code`, same `params`, with `params.keyword` always the canonical
// `"return"`. The whole diagnostic is not identical and is not required to be: the prose `message`
// may echo the learner's own word, and `source_span` covers the surface control word, so it differs
// in width between `op` and `output`/`return`. That is the localization boundary and it is permitted.

const HERITAGE_ACTIVE = ["core-language", "heritage"];

// Every surface spelling of the ONE construct, with the canonical word it must report as.
const RETURN_SPELLINGS = ["return", "output", "op"];

test("ol-return-outside-proc: every `return` spelling reports the canonical keyword, not the surface one", () => {
  for (const spelling of RETURN_SPELLINGS) {
    const diagnostics = controlFlowFindings(`${spelling} 5`, HERITAGE_ACTIVE);
    assert.equal(diagnostics.length, 1, `one finding for ${spelling}`);
    const [finding] = diagnostics;
    assert.equal(finding.code, "ol-return-outside-proc");
    assert.deepEqual(
      finding.params,
      { keyword: "return" },
      `${spelling} must report params.keyword "return", never its surface spelling`,
    );
    assert.equal(finding.stage, "semantic");
    assert.equal(finding.severity, "error");
  }
});

test("ol-return-outside-proc: a Heritage spelling's params are byte-identical to the Core twin's", () => {
  // The class rule stated as the reviewers should check it: compare the actual emitted params of
  // the two programs, rather than reasoning about intent.
  const [core] = controlFlowFindings("return 5", HERITAGE_ACTIVE);
  for (const spelling of ["output", "op"]) {
    const [heritage] = controlFlowFindings(`${spelling} 5`, HERITAGE_ACTIVE);
    assert.deepEqual(heritage.params, core.params);
    assert.equal(heritage.code, core.code);
    assert.equal(heritage.stage, core.stage);
    assert.equal(heritage.severity, core.severity);
  }
});

test("ol-return-outside-proc: the prose message still echoes the learner's own spelling", () => {
  // Params are canonical; prose is presentation (spec/error-model.md "Localization boundary"), so a
  // learner who wrote `op` is answered about `op`.
  for (const spelling of RETURN_SPELLINGS) {
    const [finding] = controlFlowFindings(`${spelling} 5`, HERITAGE_ACTIVE);
    assert.match(
      finding.message,
      new RegExp(`^${spelling} only reports a value`),
      `message should name the surface spelling ${spelling}`,
    );
  }
});

test("ol-return-outside-proc: the span still covers exactly the surface control word", () => {
  // Canonicalizing the param must not canonicalize the span — it points at what was typed.
  const expectedEnd = { return: 7, output: 7, op: 3 };
  for (const spelling of RETURN_SPELLINGS) {
    const [finding] = controlFlowFindings(`${spelling} 5`, HERITAGE_ACTIVE);
    assert.deepEqual(finding.source_span, {
      document: "unit.logo",
      start: [1, 1],
      end: [1, expectedEnd[spelling]],
    });
  }
});

test("ol-return-in-comprehension: every `return` spelling reports the canonical keyword", () => {
  for (const spelling of RETURN_SPELLINGS) {
    const diagnostics = controlFlowFindings(
      `print map n in :nums [ ${spelling} :n ]`,
      HERITAGE_ACTIVE,
    );
    assert.equal(diagnostics.length, 1, `one finding for ${spelling}`);
    const [finding] = diagnostics;
    assert.equal(finding.code, "ol-return-in-comprehension");
    assert.deepEqual(
      finding.params,
      { keyword: "return", form: "map" },
      `${spelling} must report params.keyword "return", never its surface spelling`,
    );
  }
});

test("ol-return-in-comprehension: a Heritage spelling's params are byte-identical to the Core twin's", () => {
  const [core] = controlFlowFindings(
    "print map n in :nums [ return :n ]",
    HERITAGE_ACTIVE,
  );
  for (const spelling of ["output", "op"]) {
    const [heritage] = controlFlowFindings(
      `print map n in :nums [ ${spelling} :n ]`,
      HERITAGE_ACTIVE,
    );
    assert.deepEqual(heritage.params, core.params);
    assert.equal(heritage.code, core.code);
  }
});

test("ol-return-in-comprehension: `stop` still reports itself, and every comprehension form is canonical", () => {
  // `stop` has no Heritage spelling, so its canonical word is `stop` — canonicalization must not
  // collapse it into `return`.
  const [stopFinding] = controlFlowFindings(
    "print map n in :nums [ stop ]",
    HERITAGE_ACTIVE,
  );
  assert.deepEqual(stopFinding.params, { keyword: "stop", form: "map" });
  for (const form of ["filter", "reduce"]) {
    const source =
      form === "reduce"
        ? "print reduce acc n in :nums from 0 [ op :acc ]"
        : "print filter n in :nums [ op :n ]";
    const [finding] = controlFlowFindings(source, HERITAGE_ACTIVE);
    assert.deepEqual(finding.params, { keyword: "return", form });
  }
});

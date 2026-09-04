// Unit tests for the `global` declaration (issue #823) — the reserved word, the statement form, and
// the `ol-global-outside-root` placement rule.
//
// The ruling is `spec/execution-model.md`'s *Variables, scoping, and procedures* section, merged in
// PR #1096. Three normative facts drive every test here:
//
//   1. `global-statement ::= "global" name "=" expression` (`spec/grammar.md:157`) — a **bare** name,
//      and the initializer is **required** (`spec/execution-model.md:547-549`).
//   2. A `global` declaration is legal **only at the root scope** and raises `ol-global-outside-root`
//      anywhere else (`spec/execution-model.md:561-563`, `spec/error-model.md:131`).
//   3. Reserving the word restricts the **four declaration slots** and nothing else. Binding it stays
//      legal — `spec/grammar.md:390` is a MUST NOT, and `spec/grammar.md:388` names this very word:
//      "`:global = 1`, `local global`, and `set global to 1` are conforming programs". The issue's
//      original acceptance criterion said `:global = 1` should raise; it was corrected against this
//      text, and the negative controls below are what keep the corrected reading.
//
// Runs under `node --test` against the built `@openlogo/parser` package.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "global-variables.logo";
const span = (start, end) => ({ document: doc, start, end });

const parse = (source) => OL.parse(source, doc);
const codesOf = (diagnostics) => diagnostics.map((d) => d.code);

/** Parse then check, so a test never checks an AST the reader already rejected. */
function checkClean(source, options = {}) {
  const { ast, diagnostics } = parse(source);
  assert.deepEqual(diagnostics, [], `parse: ${source}`);
  return OL.check(ast, { source, ...options }).diagnostics;
}

// --- The declaration form ---------------------------------------------------

test("global name = value parses to its own node kind, distinct from an assignment", () => {
  const { ast, diagnostics } = parse("global count = 0");

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 1);
  const declaration = ast.body[0];
  assert.equal(declaration.kind, "Global");
  assert.notEqual(declaration.kind, "Assign");
  assert.equal(declaration.name.name, "count");
  assert.equal(declaration.value.kind, "NumberLit");
  assert.equal(declaration.value.value, 0);
});

test("every part of the declaration carries its own source span", () => {
  const { ast } = parse("global count = 0");
  const declaration = ast.body[0];

  // The node runs from `global` to the end of the initializer...
  assert.deepEqual(declaration.source_span, span([1, 1], [1, 17]));
  // ...the name spans only itself, which is what ol-global-outside-root points at...
  assert.deepEqual(declaration.name.source_span, span([1, 8], [1, 13]));
  // ...and the initializer spans only itself.
  assert.deepEqual(declaration.value.source_span, span([1, 16], [1, 17]));
});

test("the initializer is a full expression, not just a literal", () => {
  const { ast, diagnostics } = parse("global total = 1 + 2 * 3");

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].value.kind, "Call");
  assert.equal(ast.body[0].value.callee.name, "+");
});

test("`global` is a walkable node whose one child is its initializer", () => {
  const { ast } = parse("global count = 0");
  const kinds = [];
  OL.walk(ast, (node) => kinds.push(node.kind));

  assert.deepEqual(kinds, ["Program", "Global", "NumberLit"]);
});

// --- The rejected spellings -------------------------------------------------

test("global :count = 0 is rejected: the declaration takes a bare name", () => {
  const { diagnostics } = parse("global :count = 0");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.deepEqual(diagnostics[0].params, { text: ":count" });
  assert.deepEqual(diagnostics[0].source_span, span([1, 8], [1, 14]));
});

test("global count is rejected: the initializer is required", () => {
  const { ast, diagnostics } = parse("global count");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  // No Global node is built, so nothing downstream sees a declaration with no value.
  assert.deepEqual(ast.body, []);
});

test("global count = with no expression is rejected at the end of the line", () => {
  const { ast, diagnostics } = parse("global count =");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.deepEqual(ast.body, []);
});

test("the `=` itself is required: `global count 5` is rejected, not read as an initializer", () => {
  // The case that pins the `=` check specifically. Every other negative here fails for an EARLIER
  // reason — a colon-name, an end of line, a stray colon — so a reader that dropped the `=` check
  // entirely would still pass all of them. `@testing`'s mutation probe M3 survived until this landed.
  const { ast, diagnostics } = parse("global count 5");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.deepEqual(diagnostics[0].params, { text: "5" });
  // No `Global` node is built; the stray `5` is resynced as its own expression statement, which is
  // what proves the reader did not fold it in as an initializer.
  assert.deepEqual(
    ast.body.map((node) => node.kind),
    ["NumberLit"],
  );
});

test("global count := 0 raises ol-bad-token — `:=` is not a token, and this ruling adds none", () => {
  const { diagnostics } = parse("global count := 0");

  assert.deepEqual(codesOf(diagnostics), ["ol-bad-token", "ol-bad-token"]);
  assert.deepEqual(diagnostics[0].params, { text: ":" });
});

test("regression guard: `:x := 5` remains rejected exactly as before", () => {
  const { diagnostics } = parse(":x := 5");

  assert.deepEqual(codesOf(diagnostics), ["ol-bad-token", "ol-bad-token"]);
});

// --- Reserving the word: the declaration slots -------------------------------
//
// `spec/grammar.md:384` names four — `define`, the heritage `to`, `struct`, and the first operand of
// `alias`. Three are exercised below. `alias` is deliberately absent and that is measured, not
// overlooked: the reader has no `alias-statement` production yet, so `alias global forward` is an
// `ol-bad-token` at the parse stage and never reaches the semantic rule at all. That is a
// pre-existing gap shared by every built-in name (`errors.ts`'s `KEYWORDS_WITH_NO_READER_PRODUCTION`
// records it for `alias`, `export` and `import`), not something this slice introduces or should fix.

test("define global raises ol-reserved-word with the span of the name itself", () => {
  const diagnostics = checkClean("define global\nend");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-reserved-word");
  assert.deepEqual(diagnostics[0].params, { name: "global" });
  assert.deepEqual(diagnostics[0].source_span, span([1, 8], [1, 14]));
});

test("struct global raises ol-reserved-word too — every declaration slot, not just define", () => {
  const diagnostics = checkClean("struct global [ x ]", {
    profiles: ["core-language", "data"],
  });

  assert.deepEqual(codesOf(diagnostics), ["ol-reserved-word"]);
});

test("the heritage `to global` opener raises ol-reserved-word under the Heritage profile", () => {
  const diagnostics = checkClean("to global\nend", {
    profiles: ["core-language", "heritage"],
  });

  assert.deepEqual(codesOf(diagnostics), ["ol-reserved-word"]);
});

test("the fourth slot, `alias`, has no reader production — so it never reaches the semantic rule", () => {
  // Measured rather than assumed, so the qualified claim above stays honest: this is a parse-stage
  // rejection of the `alias` statement itself, identical for every name, not a reserved-word finding.
  const { diagnostics } = parse("alias global forward");

  assert.deepEqual(codesOf(diagnostics), ["ol-bad-token", "ol-bad-token"]);
  assert.deepEqual(diagnostics[0].params, { text: "alias" });
});

// --- Reserving the word does NOT restrict binding (issue #823, correction 1) --

test("`:global = 1` stays legal — a binding form MUST NOT be diagnosed (spec/grammar.md:388,390)", () => {
  assert.deepEqual(checkClean(":global = 1"), []);
});

test('`local global`, `set global to 1` and `make "global" 1` stay legal', () => {
  assert.deepEqual(checkClean("local global"), []);
  assert.deepEqual(checkClean("set global to 1"), []);
  assert.deepEqual(
    checkClean('make "global" 1', {
      profiles: ["core-language", "heritage"],
    }),
    [],
  );
});

test("a binder, a parameter and a dictionary key named global stay legal", () => {
  assert.deepEqual(
    checkClean("for global in [ 1 2 ]\n  print :global\nend"),
    [],
  );
  assert.deepEqual(checkClean("define f :global\n  print :global\nend"), []);
  assert.deepEqual(
    checkClean("print { global: 1 }", { profiles: ["core-language", "data"] }),
    [],
  );
});

// --- Placement: ol-global-outside-root --------------------------------------

test("a global at the root scope is clean, and its name is visible inside a procedure", () => {
  assert.deepEqual(
    checkClean(
      "global count = 0\ndefine bump\n  :count = :count + 1\nend\nbump\nprint :count",
    ),
    [],
  );
});

test("a global in a procedure body raises ol-global-outside-root, pointing at the name", () => {
  const diagnostics = checkClean("define bump\n  global count = 0\nend");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-global-outside-root");
  assert.equal(diagnostics[0].stage, "semantic");
  assert.equal(diagnostics[0].severity, "error");
  assert.deepEqual(diagnostics[0].params, { name: "count" });
  assert.deepEqual(diagnostics[0].source_span, span([2, 10], [2, 15]));
});

test("the message says where the declaration belongs and names the local repair", () => {
  const [diagnostic] = checkClean("define bump\n  global count = 0\nend");

  // `spec/error-model.md:131` asks for both halves, in the warm lowercase voice.
  assert.equal(
    diagnostic.message,
    "global count belongs at the top level of your program. to make a private name here, write local count = ...",
  );
});

test("every non-root scope is rejected: control body, if body, handler block, comprehension body", () => {
  for (const source of [
    "repeat 2 [ global count = 0 ]",
    "if true [ global count = 0 ]",
    "while false [ global count = 0 ]",
    "forever [ global count = 0 ]",
    "for i in [ 1 2 ]\n  global count = 0\nend",
    "for i from 1 to 2\n  global count = 0\nend",
    "print map n in [ 1 2 ] [ global count = 0\n  :n ]",
  ]) {
    assert.deepEqual(
      codesOf(checkClean(source)),
      ["ol-global-outside-root"],
      source,
    );
  }
});

test("a handler block is a block scope too, so a global inside one is rejected", () => {
  // `spec/error-model.md:131` names the handler block among the four places this code covers, and
  // `spec/execution-model.md:367-369` is why: a block scope is created by *each entry into a block*
  // and is not the root scope. The rule is about the scope, never about procedures.
  assert.deepEqual(
    codesOf(
      checkClean('when "start" [ global count = 0 ]', {
        profiles: ["core-language", "interaction-events"],
      }),
    ),
    ["ol-global-outside-root"],
  );
});

test("REGRESSION: a global inside a legal ROOT global's own initializer is still rejected", () => {
  // The first revision of `globalPlacementRule` exempted a root-level `Global` and skipped its whole
  // subtree, on the reasoning that the initializer is an expression and `global-statement` is
  // statement-only. The second half is true and the conclusion does not follow: `spec/grammar.md:144`
  // makes an `expression-block` a sequence of statements, so a comprehension body — which
  // `spec/error-model.md:131` names explicitly — can carry one. All three review-gate reviewers found
  // it; every other root statement kind covered for it, which is why it needs its own test.
  for (const source of [
    "global totals = map n in [ 1 2 ] [ global bad = 0\n  :n ]",
    "global totals = filter n in [ 1 2 ] [ global bad = 0\n  true ]",
    "global totals = reduce acc n in [ 1 2 ] from 0 [ global bad = 0\n  :acc ]",
  ]) {
    assert.deepEqual(
      codesOf(checkClean(source)),
      ["ol-global-outside-root"],
      source,
    );
  }
});

test("the root declaration itself is still exempt — walking its subtree does not report it", () => {
  // The paired positive control for the regression above: a fix that reported the outer declaration
  // too would satisfy that test and break this one.
  assert.deepEqual(
    checkClean("global totals = map n in [ 1 2 ] [ :n * 2 ]"),
    [],
  );
});

test("nesting depth does not dilute the rule, and a legal sibling is untouched", () => {
  const diagnostics = checkClean(
    "global ok = 1\ndefine f\n  repeat 2 [ global bad = 2 ]\nend",
  );

  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { name: "bad" });
});

test("two misplaced declarations are both reported, in source order", () => {
  const diagnostics = checkClean(
    "repeat 1 [ global a = 1 ]\ndefine f\n  global b = 2\nend",
  );

  assert.deepEqual(
    diagnostics.map((d) => d.params.name),
    ["a", "b"],
  );
});

test("a misplaced global still declares its name, so it is not ALSO reported as undefined", () => {
  // One mistake, one diagnostic: `collectGlobalNames` records the name whatever scope it is in, so
  // `ol-global-outside-root` is the only finding.
  assert.deepEqual(
    codesOf(checkClean("define f\n  global count = 0\n  print :count\nend")),
    ["ol-global-outside-root"],
  );
});

// --- Reads, initializers and the checker ------------------------------------

test("an unbound name read in a global's initializer is still ol-undefined-var", () => {
  assert.deepEqual(codesOf(checkClean("global count = :missing")), [
    "ol-undefined-var",
  ]);
});

test("an unbound name read in a local's initializer is still ol-undefined-var", () => {
  assert.deepEqual(
    codesOf(checkClean("define f\n  local total = :missing\nend")),
    ["ol-undefined-var"],
  );
});

test("a local declared inside a local's initializer is reachable — the initializer is walked", () => {
  // A comprehension body holds statements, so a `local` can nest inside an initializer. The frame
  // collector descends into it rather than stopping at the outer `Local`.
  assert.deepEqual(
    checkClean(
      "define f\n  local totals = map n in [ 1 2 ] [ local seen\n    :seen = :n\n    :seen ]\n  return :totals\nend",
    ),
    [],
  );
});

// --- Highlighting -----------------------------------------------------------

test("`global` paints as a keyword, like `local` and `set`, in every position", () => {
  for (const source of [
    "global",
    "print global",
    "[ global ]",
    "local global",
    ":p.global",
    "export global",
    "for global from 1 to 3\nend",
    "for global in [ 1 2 ]\nend",
    "set global to 1",
  ]) {
    const classes = [
      ...OL.highlight(source, doc, { profiles: ["core-language"] }),
    ]
      .filter((token) => token.text.toLowerCase() === "global")
      .map((token) => token.class);

    assert.ok(classes.length > 0, source);
    assert.deepEqual([...new Set(classes)], ["keyword"], source);
  }
});

// --- Style ------------------------------------------------------------------

test("a mis-cased global name earns ol-style-name-case, like every other declared name", () => {
  const diagnostics = checkClean("global Count = 0", { style: true });

  assert.deepEqual(codesOf(diagnostics), ["ol-style-name-case"]);
  assert.deepEqual(diagnostics[0].params.name, "Count");
});

test("a lowercase global name is style-clean", () => {
  assert.deepEqual(checkClean("global count = 0", { style: true }), []);
});

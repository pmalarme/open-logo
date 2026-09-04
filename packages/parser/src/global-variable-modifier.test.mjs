// Unit tests for the `global` semantic-token modifier (issue #826) — the highlighter half of the
// maintainer's variable-scoping ruling (`spec/execution-model.md`'s *Variables, scoping, and
// procedures*, merged in PR #1096).
//
// Why this exists at all. `spec/execution-model.md:441-446` records the one case the ruling
// deliberately does **not** diagnose: when a procedure's first touch of a name it cannot see is a
// write, it silently creates a procedure-local, "which is correct, because that is a genuinely
// different variable". So inside one procedure body `:private = 1` and `:shared = 1` look identical
// and mean entirely different things, and no diagnostic will ever say so. The paint is the only
// reader-facing guard for that case.
//
// The mechanism is a **modifier on the existing `:variable` class**, not a sixteenth token class:
// `spec/tooling.md`'s normative table is closed (its `## Non-goals` measures conformance against
// "the token classes … above") and already answers this shape of question with a modifier — five
// bracket roles over one `bracket` class, exposed "as semantic-token modifiers where possible, even
// when the visible theme maps all roles to the same bracket color" (`spec/tooling.md:83-84`).
//
// The property under test throughout is that the answer follows **resolution, not spelling**.
//
// Runs under `node --test` against the built `@openlogo/parser` package.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "global-variable-modifier.logo";

/** Every `:variable` token, as `[text, global]` pairs in source order. */
function variableFlags(source) {
  return OL.highlight(source, doc)
    .filter((token) => token.class === ":variable")
    .map((token) => [token.text, token.global]);
}

/** Every `:variable` token that carries the `global` modifier, by text, in source order. */
function globalModifierTexts(source) {
  return OL.semanticTokens(source, doc)
    .filter((token) => token.modifiers.includes("global"))
    .map((token) => token.text);
}

/** The token class of the first token whose text matches `text`. */
function classOf(source, text) {
  return OL.highlight(source, doc).find((token) => token.text === text)?.class;
}

// --- The declaration keyword (regression guard for #823) --------------------

test("the `global` keyword itself keeps the `keyword` class", () => {
  // #823 put `global` in `OL_KEYWORDS` with `tokenClass: "keyword"` in
  // `spec/built-in-names.json`. This slice paints *variables*, and must not disturb that.
  assert.equal(classOf("global count = 0", "global"), "keyword");
  assert.equal(
    classOf("define f\n  global count = 0\nend", "global"),
    "keyword",
  );
});

test("the bare declared name is untouched, exactly as `local`'s is", () => {
  // `global count = 0` writes its name bare, so `count` is a `name` token and takes
  // `spec/tooling.md:31`'s grammar-safe fallback — the same class `local count = 0` already gave
  // it. This slice classifies `:name` occurrences only; the binder spelling is a separate question.
  assert.equal(classOf("global count = 0", "count"), "primitive");
  assert.equal(classOf("local count = 0", "count"), "primitive");
});

// --- A global read and a global write ---------------------------------------

test("a global is marked wherever it is read or written, at any depth", () => {
  const source = [
    "global count = 0",
    "define bump",
    "  :count = :count + 1",
    "end",
    "print :count",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":count", true], // the write target, inside a procedure
    [":count", true], // the read in its own initializer expression
    [":count", true], // the top-level read
  ]);
  assert.deepEqual(globalModifierTexts(source), [":count", ":count", ":count"]);
});

test("a global reached through a postfix place is marked on its base", () => {
  const source = [
    "global people = { tom: 8 }",
    "define age_up",
    "  :people.tom = :people.tom + 1",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":people", true],
    [":people", true],
  ]);
});

test("a global inside a block, a loop, and a handler stays global", () => {
  const source = [
    "global score = 0",
    "repeat 3 [ :score = :score + 1 ]",
    "for step from 1 to 3 [ print :score ]",
    "on_click [ :score = :score + 1 ]",
  ].join("\n");

  assert.deepEqual(
    variableFlags(source).map(([, isGlobal]) => isGlobal),
    [true, true, true, true, true],
  );
});

// --- A procedure-private name, beside a global -------------------------------

test("a private name and a global are distinguishable AT THE ASSIGNMENT SITE", () => {
  // This is the case `spec/execution-model.md:441-446` rules correct and never diagnoses: `:private`
  // is not visible inside `mixed`, so the write creates a procedure-local. Nothing but the paint
  // tells the reader that the two adjacent statements do entirely different things.
  const source = [
    "global shared = 0",
    "define mixed",
    "  :private = 1",
    "  :shared = 1",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":private", false],
    [":shared", true],
  ]);
  assert.deepEqual(globalModifierTexts(source), [":shared"]);
});

test("a procedure parameter shadows a same-named global for the whole body", () => {
  // A parameter is bound when the frame is created (`spec/execution-model.md:365-366`), so it
  // shadows from the first statement — including a read written before any other mention.
  const source = [
    "global count = 0",
    "define draw :count",
    "  print :count",
    "  :count = :count + 1",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":count", false], // the parameter's own binding site
    [":count", false],
    [":count", false],
    [":count", false],
  ]);
  assert.deepEqual(globalModifierTexts(source), []);
});

// --- `local` shadowing: the class follows resolution, not spelling -----------

test("a `local` shadowing a global is a local, from its own statement onward", () => {
  // `spec/execution-model.md:530-543`'s own example, which prints `5` then `0`. The read BEFORE the
  // declaration still resolves to the global — `:398-399`, a binding a scope creates for itself is
  // visible only "from the point the statement that creates it has run".
  const source = [
    "global count = 0",
    "define f",
    "  print :count",
    "  local count = 5",
    "  print :count",
    "end",
    "print :count",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":count", true], // before the `local` — still the global
    [":count", false], // after it — the shadowing local
    [":count", true], // outside the procedure — the global again
  ]);
  assert.deepEqual(globalModifierTexts(source), [":count", ":count"]);
});

test("a `local` initializer resolves against the scope BEFORE the shadow exists", () => {
  // `spec/execution-model.md:508-515`: the initializer sees "whatever `count` the statement could
  // already see", which is what makes snapshotting a shared value into a same-named local possible.
  const source = [
    "global count = 0",
    "define snapshot",
    "  local count = :count + 1",
    "  print :count",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":count", true], // the initializer's read — still the global
    [":count", false], // after the declaration — the local
  ]);
});

test("a `local` inside a block shadows only within that block", () => {
  const source = [
    "global count = 0",
    "define f",
    "  repeat 2 [",
    "    local count = 5",
    "    print :count",
    "  ]",
    "  print :count",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":count", false], // inside the block, after the `local`
    [":count", true], // back in the procedure body — the global
  ]);
});

test("a root-scope `local` leaves an existing global global", () => {
  // `spec/execution-model.md:520-526`: at the root there is no enclosing scope to shadow into, so
  // `local` names the root scope's own binding and, where that binding is already `global`, "leaves
  // it global". Painting it private here would tell the reader a shared name had become private.
  const source = [
    "global count = 0",
    "local count = 5",
    "print :count",
    "define f",
    "  print :count",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":count", true],
    [":count", true],
  ]);
});

test("a `for` binder and a comprehension binder shadow a global inside their bodies", () => {
  const source = [
    "global item = 0",
    "global total = 0",
    "for item in [1 2] [ print :item ]",
    "print :item",
    ":doubled = map item in [1 2] [ :item * 2 ]",
    ":summed = reduce total item in [1 2] from 0 [ :total + :item ]",
    "print :total",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":item", false], // the `for … in` binder's body
    [":item", true], // outside the loop — the global again
    [":doubled", false], // an ordinary top-level name, never declared global
    [":item", false], // the `map` binder's body
    [":summed", false],
    [":total", false], // the `reduce` accumulator shadows too
    [":item", false],
    [":total", true], // outside the comprehension — the global again
  ]);
});

test("a destructuring pattern's names shadow a global inside the body", () => {
  const source = [
    "global x = 0",
    "for [ :x :y ] in [[1 2]] [ print :x ]",
    "print :x",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":x", false], // the pattern's own binding site
    [":y", false],
    [":x", false], // the body's read of the bound name
    [":x", true], // outside the loop
  ]);
});

test("a `for … from … to … by` step expression is an ordinary read position", () => {
  const source = [
    "global step = 2",
    "global limit = 10",
    "for i from 1 to :limit by :step [ print :i ]",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":limit", true],
    [":step", true],
    [":i", false],
  ]);
});

test("a selector key inside a place is an ordinary read position", () => {
  // `spec/tooling.md:40` makes the `[ ]` of `:nums[:index]` an `index/dot` selector; the key inside
  // it is a full expression, so a global read there is marked like any other.
  const source = [
    "global index = 1",
    "global rows = [10 20]",
    "define pick",
    "  print :rows[:index]",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":rows", true],
    [":index", true],
  ]);
});

test("an optional parameter's default resolves inside the procedure boundary", () => {
  // `spec/grammar.md:152` — `optional-parameter ::= "(" ":" name expression ")"`. The spec does not
  // say which scope evaluates a default, so the paint reads it the way the sealed boundary reads
  // everything else written inside the procedure: `:scale` is a global, `:size` is the procedure's
  // own parameter and shadows the global of the same name.
  const source = [
    "global scale = 2",
    "global size = 100",
    "define draw :size (:step :scale)",
    "  print :step",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":size", false], // the required parameter's binding site
    [":step", false], // the optional parameter's binding site
    [":scale", true], // its default — a global, not shadowed by any parameter
    [":step", false],
  ]);
});

test("an optional parameter's default is shadowed by a same-named parameter", () => {
  const source = [
    "global size = 100",
    "define draw :size (:step :size)",
    "  print :step",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":size", false],
    [":step", false],
    [":size", false], // the default reads the parameter, not the global
    [":step", false],
  ]);
});

test("a misplaced `global` declares nothing, so it paints nothing", () => {
  // It is `ol-global-outside-root` (`spec/execution-model.md:561-563`), so the declaration never
  // takes effect. Painting from it would tell the reader that a rejected declaration had worked.
  const source = [
    "define f",
    "  global count = 0",
    "  print :count",
    "end",
  ].join("\n");

  assert.equal(
    OL.check(OL.parse(source, doc).ast, { source }).diagnostics.some(
      (diagnostic) => diagnostic.code === "ol-global-outside-root",
    ),
    true,
  );
  assert.deepEqual(variableFlags(source), [[":count", false]]);
});

test("a plain top-level name is not a global", () => {
  // The whole point of the ruling: a top-level `:count` is NOT shared with a procedure. Only a
  // `global` declaration makes it so.
  const source = [":count = 0", "define f", "  print :count", "end"].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":count", false],
    [":count", false],
  ]);
  assert.deepEqual(globalModifierTexts(source), []);
});

test("a declaration below a use still marks that use", () => {
  // The paint is lexical over the whole document, the same reading `spec/execution-model.md:405-408`
  // gives `ol-var-not-visible`. Whether the read *runs* before the declaration is a runtime-order
  // fact `ol-undefined-var` reports (`:571-574`); the paint does not restate it.
  const source = ["define f", "  print :count", "end", "global count = 0"].join(
    "\n",
  );

  assert.deepEqual(variableFlags(source), [[":count", true]]);
});

test('`thing "count"` is a word literal, so no modifier reaches it', () => {
  const source = ["global count = 0", 'print thing "count"'].join("\n");

  assert.deepEqual(variableFlags(source), []);
  assert.deepEqual(globalModifierTexts(source), []);
});

// --- Contract shape ----------------------------------------------------------

test("`global` is only ever set on `:variable` tokens", () => {
  const source = [
    "global count = 0",
    'print "hello"',
    "repeat 2 [ forward :count ]",
  ].join("\n");

  for (const token of OL.highlight(source, doc)) {
    assert.equal(
      token.global === undefined,
      token.class !== ":variable",
      `${token.class} ${token.text}`,
    );
  }
});

test("`global` is in the exported modifier vocabulary", () => {
  assert.equal(OL.OL_TOKEN_MODIFIERS.includes("global"), true);
  // The seven from `spec/tooling.md:281-283` stay first, in the document's own order.
  assert.deepEqual(OL.OL_TOKEN_MODIFIERS.slice(0, 7), [
    "declaration",
    "reference",
    "readonly",
    "defaultLibrary",
    "listRole",
    "blockRole",
    "selectorRole",
  ]);
});

test("the `global` modifier composes with the modifiers already derived", () => {
  const source = [
    "global count = 0",
    "define f :count",
    "  print :count",
    "end",
  ].join("\n");
  const [parameter, read] = OL.semanticTokens(source, doc).filter(
    (token) => token.class === ":variable",
  );

  assert.deepEqual(parameter.modifiers, ["declaration"]);
  assert.deepEqual(read.modifiers, ["reference"]);
});

test("malformed source still classifies without throwing", () => {
  const source = "global count = 0\ndefine f\n  print :count";

  assert.deepEqual(variableFlags(source), [[":count", true]]);
});

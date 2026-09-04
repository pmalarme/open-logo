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
  const token = OL.highlight(source, doc).find((each) => each.text === text);
  assert.ok(token, `no token with text ${text}`);
  return token.class;
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

test("a name the program only DECLARES is not marked", () => {
  // Not a class-based exclusion — that reasoning was overturned in round 2, and the worded forms
  // above are marked precisely because a modifier decorates whatever class a token has. A bare
  // declared name is excluded because it *introduces* a binding rather than resolving one, exactly
  // as a procedure's `:param` binding site does. Whether it should also stop reading as a library
  // call (it still takes `defaultLibrary`, #831's over-application) is issue #1107's question.
  const source = ["global count = 0", "local other = 1"].join("\n");
  const byText = new Map(
    OL.highlight(source, doc).map((token) => [token.text, token.global]),
  );

  assert.equal(classOf(source, "count"), "primitive");
  assert.equal(byText.get("count"), undefined);
  assert.equal(byText.get("other"), undefined);
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
  // say which scope evaluates a default, so the paint follows the runtime, which is where the spec
  // leaves the question: `execute-internal.ts` evaluates each omitted optional's default "in the
  // callee frame, once its earlier (already-bound) siblings are in place".
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

test("an optional parameter's default is shadowed by an EARLIER parameter", () => {
  const source = [
    "global size = 100",
    "define draw :size (:step :size)",
    "  print :step",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":size", false],
    [":step", false],
    [":size", false], // the default reads the earlier parameter, not the global
    [":step", false],
  ]);
});

test("an optional parameter's default reaches PAST a later same-named parameter", () => {
  // Parameters bind incrementally, so a default written before `:size` cannot see it and resolves
  // to the global instead. Pre-binding the whole parameter set would paint this `false` — that is
  // what `checker-undefined-var.ts` does, and the runtime's evaluation order is why the paint does
  // not copy it (issue #826 review, round 1, rubber-duck finding 4).
  const source = [
    "global size = 100",
    "define draw (:step :size) (:size 3)",
    "  print :step",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":step", false],
    [":size", true], // the default, resolved before `:size` is bound
    [":size", false], // the later parameter's own binding site
    [":step", false],
  ]);
});

test("an optional parameter's own default is resolved BEFORE that parameter binds", () => {
  // The precise off-by-one: `define f (:x :x)` — the default is the parameter's own name. Binding
  // the parameter before resolving its own default would paint the default `false`; the runtime
  // binds it after (`execute-internal.ts`), so it resolves to the global. This is the untested
  // mirror of the pre-bind-all case above (issue #826 review, round 2, @testing finding 5 —
  // surviving mutant MP2).
  const source = ["global x = 0", "define f (:x :x)", "  print :x", "end"].join(
    "\n",
  );

  assert.deepEqual(variableFlags(source), [
    [":x", false], // the parameter's own binding site
    [":x", true], // its default — resolved before the parameter binds
    [":x", false], // the body — the parameter now shadows
  ]);
});

test("a procedure written inside a block is sealed from that block's locals", () => {
  // `spec/execution-model.md:389-394` — a procedure body sees only its own parameters, its own
  // bindings, and the globals. `:651-652` states the neighbouring case, a `define` inside a
  // procedure body, which "does not capture the frame it appears in"; a `define` inside a block is
  // the same shape of declaration, and this is the case that proves the walk RESTARTS rather than
  // inheriting the enclosing shadows (issue #826 review, round 1, @testing finding 3 — the
  // surviving mutant M6b).
  const source = [
    "global x = 0",
    "repeat 2 [",
    "  local x = 1",
    "  define f",
    "    print :x",
    "  end",
    "  print :x",
    "]",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [
    [":x", true], // inside the procedure — the block's `local` cannot reach in
    [":x", false], // in the block itself, after its own `local`
  ]);
});

test("a deferred handler body is resolved at its registration position", () => {
  // A DECIDED limit, not an oversight. `spec/execution-model.md:401-403` gives a deferred handler
  // "whenever the handler fires" rather than an inline block's "from that block's own position", so
  // a click after `setup` returns really would resolve `:shared` to the retained procedure-local.
  // One token, two resolutions, decided by an event time no static pass can know — see the module
  // doc comment in `global-variable-resolution.ts`. Pinned here so the choice cannot drift while
  // issue #1108 seeks a ruling.
  const source = [
    "global shared = 0",
    "define setup",
    "  on_click [ print :shared ]",
    "  local shared = 7",
    "end",
  ].join("\n");

  assert.deepEqual(variableFlags(source), [[":shared", true]]);
});

// --- Every spelling of an assignment, not just the colon form -----------------

test("a `set` target and a `make` target carry the modifier too", () => {
  // A modifier decorates whatever class a token already has, so the worded forms need no new class
  // and no `spec/` change. `spec/execution-model.md:478-481` makes all three assignment spellings
  // "resolve the same way", and the paint now agrees with the language rather than with the lexer.
  // An earlier revision declined these on the grounds that they are not `:variable` tokens — true,
  // and irrelevant (issue #826 review, round 2, rubber-duck finding 1).
  const source = [
    "global shared = 0",
    "set shared to 1",
    'make "shared" 2',
    'print thing "shared"',
  ].join("\n");

  // The classes are untouched — this adds no class and classifies nothing inside the string.
  assert.equal(classOf(source, "shared"), "primitive");
  assert.equal(classOf(source, '"shared"'), "word/string");
  assert.deepEqual(globalModifierTexts(source), [
    "shared",
    '"shared"',
    '"shared"',
  ]);
});

test("a worded assignment follows resolution too — a `local` shadows it", () => {
  const source = [
    "global shared = 0",
    "define f",
    "  set other to 0",
    "  set shared to 9",
    "  local shared = 1",
    "  set shared to 2",
    "end",
  ].join("\n");
  const flags = OL.highlight(source, doc)
    .filter((token) => token.global !== undefined && token.text === "shared")
    .map((token) => token.global);

  // The declaration's own bare name is excluded (it binds rather than resolves), and so is the
  // `local` binder, so these two are the `set` targets either side of the shadow.
  assert.deepEqual(flags, [true, false]);
});

test("a name that names no variable carries no `global` field at all", () => {
  // The distinction that makes the field readable: absent means "this token names no variable",
  // which is different from `false`, "it names one and it is not global".
  const source = ["global shared = 0", "forward 100", "set other to 5"].join(
    "\n",
  );
  const byText = new Map(
    OL.highlight(source, doc).map((token) => [token.text, token.global]),
  );

  assert.equal(byText.get("forward"), undefined); // a real primitive call
  assert.equal(byText.get("100"), undefined); // not a name at all
  assert.equal(byText.get("other"), false); // names a variable; not global
});

test("a `set` target that names a variable is not decorated `defaultLibrary`", () => {
  // Narrows the #831 over-application for the one case there is now positive evidence for: a
  // `primitive`-classed token the resolver identified as naming a variable is provably not a call
  // into the standard library.
  const source = ["global shared = 0", "set shared to 1", "forward 100"].join(
    "\n",
  );
  const semantic = OL.semanticTokens(source, doc);
  // The `set` target on line 2 — not the declaration's own bare name on line 1, which binds rather
  // than resolves and so carries no `global` field.
  const target = semantic.find(
    (token) => token.text === "shared" && token.source_span.start[0] === 2,
  );
  const call = semantic.find((token) => token.text === "forward");

  assert.deepEqual(target.modifiers, ["global"]);
  assert.deepEqual(call.modifiers, ["defaultLibrary"]);
});

test("a document with no `global` at all still marks its variable uses `false`", () => {
  // The regression guard for the removed `globals.size === 0` fast path. Restoring that early
  // return keeps every other test in this file green while silently dropping the `primitive` and
  // `word/string` marks — on the most common document shape there is (issue #826 review, round 3,
  // @testing finding 2, surviving mutant n2). `:variable` stays total either way, so only the
  // worded forms expose it.
  const source = ["set count to 1", 'make "other" 2', "print :count"].join(
    "\n",
  );
  const marked = OL.highlight(source, doc)
    .filter((token) => token.global !== undefined)
    .map((token) => [token.text, token.class, token.global]);

  assert.deepEqual(marked, [
    ["count", "primitive", false],
    ['"other"', "word/string", false],
    [":count", ":variable", false],
  ]);
});

// --- What is and is not a declaration ---------------------------------------

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

test('`thing "count"` is a read, so the modifier reaches its word literal', () => {
  const source = ["global count = 0", 'print thing "count"'].join("\n");

  // Not a `:variable` token, so `variableFlags` (which filters on that class) sees nothing...
  assert.deepEqual(variableFlags(source), []);
  // ...but the literal itself carries the modifier, on its own `word/string` class.
  assert.deepEqual(globalModifierTexts(source), ['"count"']);
  assert.equal(classOf(source, '"count"'), "word/string");
});

test('a shadowed `thing "count"` carries no modifier', () => {
  const source = [
    "global count = 0",
    "define f :count",
    '  print thing "count"',
    "end",
  ].join("\n");

  assert.deepEqual(globalModifierTexts(source), []);
});

test("only a one-argument `thing` call with a literal name is a read", () => {
  // The three ways the `thing` form can fail to name a variable statically. None may be marked:
  // a different callee, the wrong arity (a parenthesized over-arity call, which parses), and a
  // computed name the reader cannot resolve.
  const source = [
    "global count = 0",
    'print first "count"',
    'print (thing "count" "count")',
    "print thing :which",
  ].join("\n");

  assert.deepEqual(globalModifierTexts(source), []);
});

// --- Contract shape ----------------------------------------------------------

test("`global` is total on `:variable`, and present elsewhere only where a name resolves", () => {
  const source = [
    "global count = 0",
    'print "hello"',
    "set count to 1",
    'make "count" 2',
    "repeat 2 [ forward :count ]",
  ].join("\n");

  for (const token of OL.highlight(source, doc)) {
    if (token.class === ":variable") {
      // Total: always present, so "a variable that is not global" is expressible.
      assert.equal(typeof token.global, "boolean", token.text);
    } else if (token.global !== undefined) {
      // Present elsewhere only on the token shapes that can name a variable.
      assert.equal(
        token.class === "primitive" || token.class === "word/string",
        true,
        `${token.class} ${token.text}`,
      );
    }
  }
  // The plain word literal names nothing, so it carries no field.
  assert.equal(
    OL.highlight(source, doc).find((token) => token.text === '"hello"').global,
    undefined,
  );
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

test("a shadowing parameter yields no `global` modifier at all", () => {
  // The negative half of composition: when the parameter shadows, `global` must be ABSENT from the
  // array — not merely false somewhere. (Renamed in round 2: this case cannot show composition,
  // because it never produces the modifier — @testing finding 4.)
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

test("the `global` modifier composes with the modifiers already derived", () => {
  // The full array, in emission order — so composition AND ordering are asserted, not just
  // membership (@testing finding 4).
  const source = ["global count = 0", "define f", "  print :count", "end"].join(
    "\n",
  );
  const [read] = OL.semanticTokens(source, doc).filter(
    (token) => token.class === ":variable",
  );

  assert.deepEqual(read.modifiers, ["reference", "global"]);
});

test("`highlight()` and `semanticTokens()` agree on every token", () => {
  // The invariant the studio will depend on when it switches channels (issue #1106): the modifier
  // is derived from `Token.global` and must never disagree with it (@learner-experience finding 5).
  const source = [
    "global shared = 0",
    "define bump :step",
    "  :private = 1",
    "  local hidden = :shared",
    "  :shared = :shared + :step",
    "end",
    "set shared to 7",
    'make "shared" 8',
    "for shared in [1 2] [ print :shared ]",
    "print :shared",
  ].join("\n");
  const tokens = OL.highlight(source, doc);
  const semantic = OL.semanticTokens(source, doc);

  assert.equal(semantic.length, tokens.length);
  for (const [index, token] of tokens.entries()) {
    const counterpart = semantic[index];
    assert.equal(counterpart.class, token.class);
    assert.deepEqual(counterpart.source_span, token.source_span);
    assert.equal(counterpart.global, token.global);
    assert.equal(
      counterpart.modifiers.includes("global"),
      token.global === true,
      `${token.class} ${token.text}`,
    );
  }
});

test("malformed source still classifies without throwing", () => {
  const source = "global count = 0\ndefine f\n  print :count";

  assert.deepEqual(variableFlags(source), [[":count", true]]);
});

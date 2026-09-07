// Unit tests for #285's real syntax-highlighting `HighlightProvider`
// (packages/studio/src/highlighter.ts): the `@openlogo/parser`-backed classifier that maps every
// normative token class onto a stable `ol-tok-*` CSS class and every painted semantic-token
// modifier onto a stable `ol-mod-*` one (#1106), plus the a11y assertions the #285 and #1106 hard
// gates require.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DEFAULT_CHECK_PROFILES,
  highlight,
  OL_PROFILE_KEYWORDS,
  OL_TOKEN_CLASSES,
  semanticTokens,
} from "@openlogo/parser";
import * as OL from "@openlogo/studio";

const {
  OL_GLOBAL_VARIABLE_DESCRIPTION,
  OL_HIGHLIGHT_CSS_CLASS,
  OL_HIGHLIGHT_CSS_CLASS_PREFIX,
  OL_HIGHLIGHT_MODIFIER_CSS_CLASS,
  OL_HIGHLIGHT_MODIFIER_CSS_CLASS_PREFIX,
  STUDIO_PROFILES,
  createParserHighlighter,
} = OL;

/** The one shipped stylesheet both a11y gates in this file read (never a duplicated color table). */
const STYLES_PATH = fileURLToPath(
  new URL("../web/styles.css", import.meta.url),
);

test("OL_HIGHLIGHT_CSS_CLASS maps every one of the 15 normative token classes", () => {
  assert.equal(
    Object.keys(OL_HIGHLIGHT_CSS_CLASS).length,
    OL_TOKEN_CLASSES.length,
  );
  for (const tokenClass of OL_TOKEN_CLASSES) {
    const cssClass = OL_HIGHLIGHT_CSS_CLASS[tokenClass];
    assert.equal(typeof cssClass, "string");
    assert.ok(cssClass.startsWith(OL_HIGHLIGHT_CSS_CLASS_PREFIX));
    // A CSS class must be a valid bare identifier — no `/` or `:` left over from the spec's own
    // "word/string" / ":variable" / "index/dot" spellings.
    assert.match(cssClass, /^[a-z][a-z-]*$/);
  }
});

test("createParserHighlighter classifies keywords, primitives, numbers, strings, and variables", () => {
  const highlighter = createParserHighlighter();
  const tokens = highlighter('define go :n\n  forward :n\nend\nprint "done"');

  const byText = (text) => tokens.find((token) => token.text === text);

  assert.equal(byText("define").class, "ol-tok-keyword");
  assert.equal(byText("end").class, "ol-tok-keyword");
  assert.equal(byText("forward").class, "ol-tok-primitive");
  assert.equal(byText(":n").class, "ol-tok-variable");
  assert.equal(byText("go").class, "ol-tok-procedure-name");
  assert.equal(byText('"done"').class, "ol-tok-string");
});

test("createParserHighlighter classifies numbers, comments, and delimiters", () => {
  const highlighter = createParserHighlighter();
  const tokens = highlighter("repeat 4 [\n  forward 100 # go\n]");

  const byText = (text) => tokens.filter((token) => token.text === text);

  assert.equal(byText("4")[0].class, "ol-tok-number");
  assert.equal(byText("100")[0].class, "ol-tok-number");
  assert.equal(byText("# go")[0].class, "ol-tok-comment");
  // `every` on an empty array is vacuously true, so the counts are asserted first — otherwise
  // these two lines would still pass if the fixture produced no brackets at all.
  assert.equal(byText("[").length, 1);
  assert.equal(byText("]").length, 1);
  assert.ok(byText("[").every((token) => token.class === "ol-tok-bracket"));
  assert.ok(byText("]").every((token) => token.class === "ol-tok-bracket"));
});

test("createParserHighlighter classifies dict braces, operators, and dict keys", () => {
  const highlighter = createParserHighlighter();
  const tokens = highlighter(":ages = { tom: 8 }\nprint :ages.tom");

  const byText = (text) => tokens.find((token) => token.text === text);

  assert.equal(byText("{").class, "ol-tok-brace");
  assert.equal(byText("}").class, "ol-tok-brace");
  assert.equal(byText("=").class, "ol-tok-operator");
  assert.equal(byText("tom").class, "ol-tok-dict-key");
  assert.equal(byText(".").class, "ol-tok-index-dot");
});

test("createParserHighlighter classifies struct type/field names and parens", () => {
  const highlighter = createParserHighlighter();
  const tokens = highlighter(
    "struct point [ x y ]\ndefine move :p\n  set_xy (:p.x) (:p.y)\nend",
  );

  const byText = (text) => tokens.filter((token) => token.text === text);

  assert.equal(byText("point")[0].class, "ol-tok-type-name");
  assert.ok(byText("x").some((token) => token.class === "ol-tok-field-name"));
  assert.ok(byText("y").some((token) => token.class === "ol-tok-field-name"));
  // Counts first: `every` is vacuously true on an empty array (see above).
  assert.equal(byText("(").length, 2);
  assert.equal(byText(")").length, 2);
  assert.ok(byText("(").every((token) => token.class === "ol-tok-paren"));
  assert.ok(byText(")").every((token) => token.class === "ol-tok-paren"));
});

test("createParserHighlighter never throws on malformed/mid-edit input", () => {
  const highlighter = createParserHighlighter();
  assert.doesNotThrow(() => highlighter("repeat 4 forward"));
  assert.doesNotThrow(() => highlighter(""));
  assert.doesNotThrow(() => highlighter(":ages = { tom"));
});

test("every token's start/end positions round-trip onto the exact source substring", () => {
  const highlighter = createParserHighlighter();
  const source = "forward 100\nright 90";
  const tokens = highlighter(source);
  const lines = source.split("\n");

  // Every token in this fixture is single-line (no multi-line strings/comments), so a same-line
  // slice is sufficient to prove start/end positions round-trip onto the token's own text.
  function slice(start, end) {
    return lines[start[0] - 1].slice(start[1] - 1, end[1] - 1);
  }

  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    assert.equal(token.start[0], token.end[0]);
    assert.equal(slice(token.start, token.end), token.text);
  }
});

// #740 — the active profile set reaches the studio's highlighter.
//
// `spec/tooling.md:30` puts the profile block-heads, plus the Sprites mode-switch command `tell`,
// in the `keyword` class "while their profile is active"; `:31` puts "a profile word whose profile
// is inactive" in `primitive`. Both directions are asserted below over the same fixture, because a
// highlighter that ignored the profile set entirely would still satisfy either one alone.

/**
 * The words whose token class depends on the active profile set, each paired with the profile that
 * owns it — derived from the parser's own registry rather than restated here, so a profile
 * block-head added parser-side is covered by these tests automatically. That is this repo's house
 * rule for profile-specific names (compare `packages/parser/src/profile-arity-derivation.test.mjs`
 * and `checker-reserved-word.test.mjs`, both driven off the registry rather than a hand-kept list).
 *
 * Ownership is kept, not flattened away: each entry carries the profile that owns the word, so the
 * tests can state — and check — that every registry profile is one the studio actually has active,
 * which is what makes `keyword` the right expectation for all of them today. A future block-head
 * from a profile this build does not claim must stay `primitive` (`spec/tooling.md:31`); the tests
 * assert that precondition rather than branching on it, because a branch no test can reach would
 * fail the 100%-branch gate.
 */
const PROFILE_BLOCK_HEADS = Object.entries(OL_PROFILE_KEYWORDS).flatMap(
  ([profile, words]) => words.map((word) => ({ profile, word })),
);

/**
 * The seven profile words the registry holds today (`spec/tooling.md:30`'s "a profile's
 * block-heads and its mode-switch commands"). Asserted so the derivation
 * above cannot silently *shrink* — a `words.slice(0, 1)` slip would otherwise drop five words from
 * every profile test and stay green. Unlike a hand-written list, this pins the derivation's shape
 * rather than restating the words; when the registry legitimately grows, this failing is the
 * intended "extend this test" signal, since {@link PROFILE_BLOCK_HEAD_SOURCE} needs a new line for
 * the new word anyway.
 */
const PROFILE_BLOCK_HEAD_COUNT = 7;

/**
 * A well-formed program (zero parse diagnostics, and zero `check()` findings under the studio's
 * profile set) exercising all seven of them. Every form matches its normative signature —
 * `tell <turtle|turtle-list>` and `ask <turtle|turtle-list> <block>`
 * (`spec/turtles-and-sprites.md:22-23`) take turtle *values*, not words, and
 * `when <event-word> <block>`/`on_key <key-word> <block>`
 * (`spec/interaction-events.md:27,29`) take words, not conditions.
 */
const PROFILE_BLOCK_HEAD_SOURCE = [
  ":t = new_turtle",
  "tell :t",
  "ask :t [ right 90 ]",
  "each [ forward 1 ]",
  'when "start" [ print "ready" ]',
  "every 30 [ right 15 ]",
  'on_key "space" [ forward 20 ]',
  "on_click [ stamp ]",
].join("\n");

/**
 * The control case: Sound's commands and Interaction's `wait`/`input` are ordinary profile
 * *primitives*, not block-heads, so `spec/tooling.md:30`'s "while their profile is active" clause
 * never applied to them — `primitive` is their correct class under every profile set.
 */
const PROFILE_PRIMITIVES = [
  "set_tempo",
  "note",
  "beep",
  "rest",
  "play",
  "wait",
  "input",
];

const PROFILE_PRIMITIVE_SOURCE = [
  "set_tempo 90",
  'note "c4" 1',
  "beep",
  "rest 1",
  'play [ "c4" 1 "e4" 2 ]',
  "wait 2",
  'print input "what is your name?"',
].join("\n");

/** The class of the token spelled `text`, failing loudly if the fixture never produced one. */
function classOf(tokens, text) {
  const token = tokens.find((candidate) => candidate.text === text);
  assert.ok(token, `the fixture produced no token spelled ${text}`);
  return token.class;
}

test("the default profile set classifies every active-profile block-head as keyword", () => {
  const tokens = createParserHighlighter()(PROFILE_BLOCK_HEAD_SOURCE);

  assert.equal(PROFILE_BLOCK_HEADS.length, PROFILE_BLOCK_HEAD_COUNT);
  for (const { profile, word } of PROFILE_BLOCK_HEADS) {
    // Tripwire, not a branch: see the derivation docblock above.
    assert.ok(
      STUDIO_PROFILES.includes(profile),
      `${profile} owns a block-head but is not active in the studio — extend this test`,
    );
    assert.equal(
      classOf(tokens, word),
      "ol-tok-keyword",
      `${word} (${profile})`,
    );
  }
});

test("an explicit Core-Language-only set classifies those same words as primitive", () => {
  const tokens = createParserHighlighter({ profiles: ["core-language"] })(
    PROFILE_BLOCK_HEAD_SOURCE,
  );

  assert.equal(PROFILE_BLOCK_HEADS.length, PROFILE_BLOCK_HEAD_COUNT);
  for (const { profile, word } of PROFILE_BLOCK_HEADS) {
    assert.equal(
      classOf(tokens, word),
      "ol-tok-primitive",
      `${word} (${profile})`,
    );
  }
});

test("an explicitly empty profile set is honored, not replaced by the default", () => {
  // `[]` is a legitimate, observable request — "no profiles active at all", which the parser
  // supports explicitly — so `??` must not treat it like an omitted option. Without this, a
  // `options.profiles?.length ? … : STUDIO_PROFILES` regression that silently overrode a caller's
  // deliberate empty set would ship green.
  const tokens = createParserHighlighter({ profiles: [] })(
    PROFILE_BLOCK_HEAD_SOURCE,
  );

  assert.equal(PROFILE_BLOCK_HEADS.length, PROFILE_BLOCK_HEAD_COUNT);
  for (const { profile, word } of PROFILE_BLOCK_HEADS) {
    assert.equal(
      classOf(tokens, word),
      "ol-tok-primitive",
      `${word} (${profile})`,
    );
  }
});

test("profile primitives stay primitive under the studio set and under Core alone", () => {
  const underStudioProfiles = createParserHighlighter()(
    PROFILE_PRIMITIVE_SOURCE,
  );
  const underCoreOnly = createParserHighlighter({
    profiles: DEFAULT_CHECK_PROFILES,
  })(PROFILE_PRIMITIVE_SOURCE);

  assert.equal(PROFILE_PRIMITIVES.length, 7);
  for (const word of PROFILE_PRIMITIVES) {
    assert.equal(classOf(underStudioProfiles, word), "ol-tok-primitive", word);
    assert.equal(classOf(underCoreOnly, word), "ol-tok-primitive", word);
  }
});

test("createParserHighlighter defaults to the studio's profile set, not the parser's", () => {
  // The regression guard for the #740 defect itself: `highlight()` defaults to Core Language alone,
  // so a studio highlighter that forwards no profile set silently gives `ask` the plain
  // `primitive` fallback. Pinning the default against *both* candidate sets — equal to the
  // studio's, different from the parser's — is what makes that reversion fail here.
  const classes = (highlighter) =>
    highlighter(PROFILE_BLOCK_HEAD_SOURCE).map((token) => token.class);

  const byDefault = classes(createParserHighlighter());
  const explicitStudioSet = classes(
    createParserHighlighter({ profiles: STUDIO_PROFILES }),
  );
  const parserDefaultSet = classes(
    createParserHighlighter({ profiles: DEFAULT_CHECK_PROFILES }),
  );

  assert.ok(byDefault.length > 0);
  assert.deepEqual(byDefault, explicitStudioSet);
  assert.notDeepEqual(byDefault, parserDefaultSet);
});

test("the studio's classes match batch highlight() token-for-token for the same profile set", () => {
  // The token classes are normative (`spec/tooling.md:8`), so this adapter has no licence to
  // classify differently from a batch `highlight()` on the same source and profile set. Asserted
  // for a non-default set too: before #740 the two agreed only because both were profile-blind.
  for (const profiles of [STUDIO_PROFILES, DEFAULT_CHECK_PROFILES]) {
    const studioTokens = createParserHighlighter({ profiles })(
      PROFILE_BLOCK_HEAD_SOURCE,
    );
    const batchTokens = highlight(PROFILE_BLOCK_HEAD_SOURCE, "<input>", {
      profiles,
    });

    assert.ok(batchTokens.length > 0);
    assert.equal(studioTokens.length, batchTokens.length);
    for (const [index, batchToken] of batchTokens.entries()) {
      assert.equal(studioTokens[index].text, batchToken.text);
      assert.equal(
        studioTokens[index].class,
        OL_HIGHLIGHT_CSS_CLASS[batchToken.class],
        `${batchToken.text} under ${profiles.join("+")}`,
      );
    }
  }
});

// #285 a11y hard gate: coloring must never rely on color alone and must meet WCAG AA (4.5:1)
// contrast for normal text. This reads the exact shipped `web/styles.css` (no duplicated color
// table to drift out of sync) and computes the contrast ratio of every `.ol-tok-*` rule's `color`
// against the editor's white background.
function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

/**
 * WCAG contrast ratio of a foreground `hex` color against a fixed white (`#ffffff`) background
 * (the `.cm-editor`/`.pane-editor` surface color) — every `.ol-tok-*` rule sets only a text
 * `color`, never a background, so white is always the relevant comparison. `relativeLuminance`
 * of any real (non-white) foreground color is always below white's `1`, so this only ever needs
 * the one fixed ordering, unlike a general-purpose two-color contrast helper.
 */
function contrastAgainstWhite(hex) {
  return (1 + 0.05) / (relativeLuminance(hex) + 0.05);
}

test("every .ol-tok-* rule in web/styles.css meets 4.5:1 contrast against white", () => {
  const css = readFileSync(STYLES_PATH, "utf8");
  const ruleRe = /\.ol-tok-([a-z-]+)\s*\{([^}]*)\}/g;
  const found = new Map();
  for (const match of css.matchAll(ruleRe)) {
    const [, name, body] = match;
    const colorMatch = /color:\s*(#[0-9a-fA-F]{6})/.exec(body);
    assert.ok(colorMatch, `.ol-tok-${name} must set a color`);
    found.set(name, colorMatch[1]);
  }

  // Every CSS class this module produces must actually be styled in the shipped stylesheet.
  const expectedNames = new Set(
    Object.values(OL_HIGHLIGHT_CSS_CLASS).map((cssClass) =>
      cssClass.slice(OL_HIGHLIGHT_CSS_CLASS_PREFIX.length),
    ),
  );
  assert.equal(found.size, expectedNames.size);
  for (const name of expectedNames) {
    assert.ok(found.has(name), `web/styles.css is missing .ol-tok-${name}`);
    const ratio = contrastAgainstWhite(found.get(name));
    assert.ok(
      ratio >= 4.5,
      `.ol-tok-${name} (${found.get(name)}) only has ${ratio.toFixed(2)}:1 contrast against white`,
    );
  }
});

// #1106 — the `global` semantic-token modifier reaches the rendered output.
//
// The defect these tests close is the one the maintainer hit while reviewing #826: `packages/parser`
// already resolves which `:name` occurrences reach a `global` binding, but `packages/studio` mapped
// token *class* onto a CSS class and dropped every other field, so a learner saw NO difference
// whatsoever. Everything below is asserted in both directions — a modifier that is always present,
// or always absent, fails as loudly as one that is never emitted.

/**
 * The maintainer's own program (issue #1106). Measured on `saga/819-variable-scoping`, it prints
 * `6` then `0`: the `local` shadows the global, so the increment touches the private binding and
 * the shared `score` stays `0`. Delete only the `local` line ({@link UNSHADOWED_PROGRAM}) and the
 * byte-identical `:score = :score + 1` prints `1` then `1`, because now it is the shared variable
 * being changed. That line is what a learner cannot tell apart without scanning upward, and it is
 * what this modifier paints.
 */
const SHADOWED_PROGRAM = [
  "global score = 0",
  "define f",
  "  local score = 5",
  "  :score = :score + 1",
  "  print :score",
  "end",
  "f",
  "print :score",
].join("\n");

/** {@link SHADOWED_PROGRAM} with only the `local score = 5` line removed. */
const UNSHADOWED_PROGRAM = SHADOWED_PROGRAM.split("\n")
  .filter((line) => line.trim() !== "local score = 5")
  .join("\n");

/** The `ol-mod-*` class the `global` modifier paints, read from the module rather than restated. */
const GLOBAL_MODIFIER_CLASS = OL_HIGHLIGHT_MODIFIER_CSS_CLASS.global;

/** Every token of `source` spelled `text`, in source order, with its 1-based start line. */
function tokensSpelled(source, text) {
  return createParserHighlighter()(source).filter(
    (token) => token.text === text,
  );
}

/** `true` when `token` carries the `global` modifier's CSS class. */
function isPaintedGlobal(token) {
  return (token.modifiers ?? []).includes(GLOBAL_MODIFIER_CLASS);
}

test("the global modifier maps onto a distinct, valid ol-mod-* CSS class namespace", () => {
  assert.notEqual(
    OL_HIGHLIGHT_MODIFIER_CSS_CLASS_PREFIX,
    OL_HIGHLIGHT_CSS_CLASS_PREFIX,
  );
  const values = Object.values(OL_HIGHLIGHT_MODIFIER_CSS_CLASS);
  assert.ok(values.length > 0);
  for (const cssClass of values) {
    assert.ok(cssClass.startsWith(OL_HIGHLIGHT_MODIFIER_CSS_CLASS_PREFIX));
    assert.match(cssClass, /^[a-z][a-z-]*$/);
    // The two namespaces must not overlap, or a `.ol-tok-*` theme rule would style a modifier.
    assert.ok(!cssClass.startsWith(OL_HIGHLIGHT_CSS_CLASS_PREFIX));
  }
  assert.equal(GLOBAL_MODIFIER_CLASS, "ol-mod-global");
});

test("a shared variable is painted, and a local shadowing it is not — the same byte-identical line", () => {
  // The whole point of the slice: `:score = :score + 1` is spelled identically in both programs.
  const shadowedLine = SHADOWED_PROGRAM.split("\n")[3];
  const unshadowedLine = UNSHADOWED_PROGRAM.split("\n")[2];
  assert.equal(shadowedLine, unshadowedLine);

  const shadowed = tokensSpelled(SHADOWED_PROGRAM, ":score");
  const unshadowed = tokensSpelled(UNSHADOWED_PROGRAM, ":score");

  // Four `:score` uses in each program: two on the assignment line, one in the procedure's
  // `print`, one at the root. Counted first, so neither `every` below can pass vacuously.
  assert.equal(shadowed.length, 4);
  assert.equal(unshadowed.length, 4);

  // Shadowed: the three uses inside `f` reach the `local`, so they are NOT painted; only the
  // root-scope `print :score` reaches the shared binding.
  assert.deepEqual(
    shadowed.map(isPaintedGlobal),
    [false, false, false, true],
    "only the root-scope use reaches the shared variable when a local shadows it",
  );

  // Unshadowed: every use reaches the shared binding, including the two on that identical line.
  assert.deepEqual(unshadowed.map(isPaintedGlobal), [true, true, true, true]);
});

test("a painted token keeps its own normative token class — the modifier is additive, never a substitute", () => {
  const painted = tokensSpelled(UNSHADOWED_PROGRAM, ":score");
  assert.equal(painted.length, 4);
  for (const token of painted) {
    assert.equal(token.class, OL_HIGHLIGHT_CSS_CLASS[":variable"]);
    assert.deepEqual(token.modifiers, [GLOBAL_MODIFIER_CLASS]);
  }
});

test("all three assignment spellings are painted, each keeping its own class", () => {
  // `spec/execution-model.md:478-481` makes `:x = …`, `set x to …` and `make "x" …` resolve
  // identically, and a modifier decorates whatever class a token already has — so the studio must
  // paint a `primitive` place head and a `word/string` literal too, not only `:variable`.
  const source = [
    "global count = 0",
    ":count = 1",
    "set count to 2",
    'make "count" 3',
    'print thing "count"',
  ].join("\n");
  const tokens = createParserHighlighter()(source);
  const at = (line, text) =>
    tokens.find((token) => token.start[0] === line && token.text === text);

  assert.equal(at(2, ":count").class, OL_HIGHLIGHT_CSS_CLASS[":variable"]);
  assert.ok(isPaintedGlobal(at(2, ":count")));
  assert.equal(at(3, "count").class, OL_HIGHLIGHT_CSS_CLASS.primitive);
  assert.ok(isPaintedGlobal(at(3, "count")));
  assert.equal(at(4, '"count"').class, OL_HIGHLIGHT_CSS_CLASS["word/string"]);
  assert.ok(isPaintedGlobal(at(4, '"count"')));
  assert.equal(at(5, '"count"').class, OL_HIGHLIGHT_CSS_CLASS["word/string"]);
  assert.ok(isPaintedGlobal(at(5, '"count"')));
});

test("a declaration site is not painted — `global` stays a keyword and its name introduces a binding", () => {
  const tokens = createParserHighlighter()(UNSHADOWED_PROGRAM);
  const keyword = tokens.find((token) => token.text === "global");
  const declaredName = tokens.find(
    (token) => token.start[0] === 1 && token.text === "score",
  );

  assert.equal(keyword.class, OL_HIGHLIGHT_CSS_CLASS.keyword);
  assert.ok(!isPaintedGlobal(keyword));
  assert.ok(
    declaredName,
    "the fixture produced no declared `score` name token",
  );
  assert.ok(!isPaintedGlobal(declaredName));
});

test("a program with no global declares no modifiers at all — the field stays absent", () => {
  const tokens = createParserHighlighter()(
    "define go :n\n  forward :n\nend\ngo 10",
  );

  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    assert.equal(
      token.modifiers,
      undefined,
      `${token.text} carries modifiers it should not`,
    );
    assert.equal(token.description, undefined);
  }
});

test("unmapped parser modifiers are dropped rather than leaking a CSS class", () => {
  // `semanticTokens()` puts `reference`/`declaration`/`defaultLibrary`/`readonly` and the three
  // bracket roles on nearly every token; only the modifiers with a `ol-mod-*` mapping may reach the
  // DOM. Asserted against the parser's own output so a future parser-side modifier cannot silently
  // start painting.
  const parserTokens = semanticTokens(UNSHADOWED_PROGRAM, "<input>", {
    profiles: STUDIO_PROFILES,
  });
  const studioTokens = createParserHighlighter()(UNSHADOWED_PROGRAM);

  const dropped = new Set();
  assert.equal(studioTokens.length, parserTokens.length);
  for (const [index, parserToken] of parserTokens.entries()) {
    const expected = parserToken.modifiers
      .map((modifier) => {
        const mapped = OL_HIGHLIGHT_MODIFIER_CSS_CLASS[modifier];
        if (mapped === undefined) {
          dropped.add(modifier);
        }
        return mapped;
      })
      .filter((cssClass) => cssClass !== undefined);
    assert.deepEqual(
      studioTokens[index].modifiers ?? [],
      expected,
      `${parserToken.text} (${parserToken.modifiers.join(",")})`,
    );
  }
  // The fixture really does exercise unmapped modifiers, so the loop above is not vacuous.
  assert.ok(dropped.size > 0);
  assert.ok(!dropped.has("global"));
});

test("only a painted token carries the learner-facing description", () => {
  const tokens = createParserHighlighter()(SHADOWED_PROGRAM);
  assert.ok(tokens.length > 0);
  let described = 0;
  for (const token of tokens) {
    if (isPaintedGlobal(token)) {
      assert.equal(token.description, OL_GLOBAL_VARIABLE_DESCRIPTION);
      described += 1;
    } else {
      assert.equal(token.description, undefined);
    }
  }
  // Exactly the one root-scope `:score` in the shadowed program.
  assert.equal(described, 1);
  // The text is for a learner, not a compiler writer: it must explain the consequence, not just
  // restate the keyword the learner can already read on screen.
  assert.match(OL_GLOBAL_VARIABLE_DESCRIPTION, /whole program/i);
});

test("the description is keyed off the painted CSS class, so text and paint cannot diverge", () => {
  // Review finding (rubber-duck r1, #3): deriving the description from the raw modifier name while
  // deriving the paint from the mapped CSS class would let a token carry a `title` with no visible
  // treatment if the map entry were ever removed. Both now come from one lookup — asserted by
  // observing that a described token is always a painted one and vice versa, over a fixture that
  // contains both kinds.
  const tokens = createParserHighlighter()(UNSHADOWED_PROGRAM);
  assert.ok(tokens.length > 0);
  const painted = tokens.filter(isPaintedGlobal);
  const described = tokens.filter((token) => token.description !== undefined);
  assert.ok(painted.length > 0);
  assert.ok(described.length < tokens.length);
  assert.deepEqual(
    described.map((token) => token.start),
    painted.map((token) => token.start),
  );
});

// #1106 a11y hard gate: the distinction must not rely on color alone (`spec/rendering.md`), so the
// shipped `.ol-mod-global` rule is read from the same stylesheet the contrast gate above parses.
test("the .ol-mod-global rule conveys the distinction without color", () => {
  const css = readFileSync(STYLES_PATH, "utf8");
  const rule = new RegExp(`\\.${GLOBAL_MODIFIER_CLASS}\\s*\\{([^}]*)\\}`).exec(
    css,
  );
  assert.ok(rule, `web/styles.css is missing .${GLOBAL_MODIFIER_CLASS}`);
  const body = rule[1];

  // No color of its own: it inherits the token class's already-contrast-checked color, so the
  // modifier can never be the thing a color-blind or greyscale reader has to distinguish, and can
  // never override — or fail the contrast of — the class it decorates.
  assert.ok(
    !/(^|[\s;])color:/.test(body),
    ".ol-mod-global must not set a text color",
  );
  assert.ok(
    !/background/.test(body),
    ".ol-mod-global must not set a background",
  );

  // Two channels that survive greyscale and a forced-colors theme: weight, and an underline shape.
  assert.match(body, /font-weight:\s*700/);
  assert.match(body, /text-decoration-style:\s*dotted/);
  // Dotted, never wavy: #317's diagnostic squiggles are wavy, and a shared variable is not an error.
  assert.ok(!/wavy/.test(body));
});

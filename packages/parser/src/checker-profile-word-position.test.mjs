// Guard tests for a **profile word read as a callee** (issue #864) — the profile-conditional half
// of `spec/grammar.md:390`: "A keyword in a position none of these cover has no derivation at all
// and is a parse error, never a silently accepted name".
//
// Issue #853 closed that hole for the six globally reserved words (`reserved-word-value-position.
// test.mjs`), deriving the reader's non-expression-head set from `OL_KEYWORDS`. Its scope note names
// this file's subject as the residue: `OL_PROFILE_KEYWORDS` — the Sprites heads `ask`/`each` and the
// mode switch `tell`, and the Interaction & Events heads `when`/`every`/`on_key`/`on_click` — stayed
// **completely clean** in value position whenever their owning profile was active. Measured at the
// saga tip `a7db8f2`: all seven read clean as `print <word>`, as `:x = <word>`, and in the issue's
// own `repeat <word> [ ]`. The `repeat` ran with no count and nothing said so — the silent no-op
// class (saga #811).
//
// **The rule is deliberately profile-GATED**, which is what the Core-only half below pins. The
// reader is profile-blind by design (`parser.ts`'s `PROFILE_STATEMENT_FORMS`), because a Core-only
// program may legally `define ask … end` and call it — so this is a checker rule, not a reader one.
// Whether these words are built-in names *unconditionally* (`spec/grammar.md:408`) is a different
// question, asked at the four **declaration** slots, and is issue #841's: nothing here touches it.
//
// The sweeps run off `OL.OL_PROFILE_KEYWORDS` rather than a hand-written list, so a profile slice
// that adds a block-head gets covered automatically — the same derive-from-the-registry property
// #837 proved for the Core half when it added `mod`.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "profile-word-position.logo";

/** The profile whose activation each word depends on, flattened from the registry. */
const PROFILE_WORDS = Object.entries(OL.OL_PROFILE_KEYWORDS).flatMap(
  ([profile, words]) => words.map((word) => ({ profile, word })),
);

/** Core Language plus Turtle & Rendering plus `profile` — a realistic active set for that profile. */
function activeSetFor(profile) {
  return ["core-language", "turtle-rendering", profile];
}

const CORE_ONLY = ["core-language"];

/** Parse diagnostics plus the semantic ones `check()` finds under `profiles`. */
function allDiagnostics(source, profiles) {
  const { ast, diagnostics } = OL.parse(source, doc);
  return [...diagnostics, ...OL.check(ast, { profiles, source }).diagnostics];
}

/** Just the `ol-bad-token` `params.text` values, in report order. */
function badTokenTexts(source, profiles) {
  return allDiagnostics(source, profiles)
    .filter((diagnostic) => diagnostic.code === "ol-bad-token")
    .map((diagnostic) => diagnostic.params.text);
}

test("the registry still contributes the seven words this rule is about", () => {
  // A canary on the sweeps below: if a future slice empties or renames the registry, every
  // `for`-loop assertion would vacuously pass and this file would guard nothing.
  assert.deepEqual(PROFILE_WORDS.map(({ word }) => word).sort(), [
    "ask",
    "each",
    "every",
    "on_click",
    "on_key",
    "tell",
    "when",
  ]);
});

test("every profile word is rejected in value position when its profile is active", () => {
  // The three positions issue #864 measured: a call argument, an assignment right-hand side, and
  // the `repeat` count from `spec/grammar.md:390`'s own worked example.
  for (const { profile, word } of PROFILE_WORDS) {
    const profiles = activeSetFor(profile);
    for (const source of [
      `print ${word}\n`,
      `:x = ${word}\n`,
      `repeat ${word} [ ]\n`,
    ]) {
      assert.deepEqual(
        badTokenTexts(source, profiles),
        [word],
        `\`${source.trim()}\` was silently accepted under ${profile}`,
      );
    }
  }
});

test("the diagnostic is the full C10 shape, with the span on the word alone", () => {
  const [finding] = allDiagnostics(
    "print when\n",
    activeSetFor("interaction-events"),
  );

  assert.equal(finding.code, "ol-bad-token");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { text: "when" });
  // `spec/error-model.md:41-42` wants "the most local repair site": the head word, not the whole
  // `print` call and not the whole line.
  assert.deepEqual(finding.source_span.start, [1, 7]);
  assert.deepEqual(finding.source_span.end, [1, 11]);
  assert.equal(finding.source_span.document, doc);
});

test("the message names the word and the closest legal form, in the lowercase Logo voice", () => {
  // Pinned in a UNIT test on purpose: the conformance harness excludes `message` from comparison
  // (`scripts/harness/index.mjs`'s `projectDiagnostic`), so a fixture cannot hold this wording.
  assert.equal(
    allDiagnostics("print when\n", activeSetFor("interaction-events"))[0]
      .message,
    "i don't know how to read when here. when starts its own instruction, so it cannot make a value.",
  );
  // Every word gets the same shape, quoted back in the learner's own surface spelling.
  assert.equal(
    allDiagnostics("print tell\n", activeSetFor("sprites"))[0].message,
    "i don't know how to read tell here. tell starts its own instruction, so it cannot make a value.",
  );
});

test("the word is quoted back in the learner's own spelling, and matching is case-insensitive", () => {
  // OpenLogo identifiers are case-insensitive with lowercase canonical, so `When` must be caught —
  // and `params.text` "names the offending token" (`spec/error-model.md:110`), which is what the
  // learner actually typed.
  const [finding] = allDiagnostics(
    "print When\n",
    activeSetFor("interaction-events"),
  );

  assert.equal(finding.code, "ol-bad-token");
  assert.equal(finding.params.text, "When");
  assert.equal(
    finding.message,
    "i don't know how to read When here. When starts its own instruction, so it cannot make a value.",
  );
});

test("a profile word is rejected as a parenthesized-call callee too, in either position", () => {
  // `parenthesized-call ::= "(" callable-name { expression } ")"` (`spec/grammar.md:215`), and
  // `spec/grammar.md:390` matches a keyword as `callable-name` "only where the C3 primitive matrix
  // also gives that word a callable form" — which none of these seven has. The Core control
  // `( key 1 )` is already a reader-side `ol-bad-token`; before this rule the profile spelling was
  // clean in BOTH a value slot and as a bare statement.
  const profiles = activeSetFor("interaction-events");

  assert.deepEqual(badTokenTexts("print ( when 1 )\n", profiles), ["when"]);
  assert.deepEqual(badTokenTexts("( when 1 )\n", profiles), ["when"]);
  assert.deepEqual(badTokenTexts("( when )\n", profiles), ["when"]);
});

test("nested value slots are reached too — operands, list elements, and a procedure body", () => {
  const profiles = activeSetFor("interaction-events");

  assert.deepEqual(badTokenTexts("print 1 + when\n", profiles), ["when"]);
  assert.deepEqual(badTokenTexts("print [ when ]\n", profiles), ["when"]);
  assert.deepEqual(badTokenTexts("print when == 1\n", profiles), ["when"]);
  assert.deepEqual(
    badTokenTexts("define f\n  return when\nend\nprint f\n", profiles),
    ["when"],
  );
});

test("findings come back in source order, one per occurrence", () => {
  const profiles = ["core-language", "turtle-rendering", "interaction-events"];

  assert.deepEqual(
    badTokenTexts("print every\nprint when\nprint on_key\n", profiles),
    ["every", "when", "on_key"],
  );
});

test("both profiles active at once — each word answers to its own profile", () => {
  const profiles = [
    "core-language",
    "turtle-rendering",
    "sprites",
    "interaction-events",
  ];

  assert.deepEqual(badTokenTexts("print ask\nprint when\n", profiles), [
    "ask",
    "when",
  ]);
});

test("without its profile, a profile word stays an ordinary name — no ol-bad-token", () => {
  // The gate that keeps this rule out of issue #841's territory. Core-only, `when` is simply a name
  // nothing declares, so `checker-unknown-command.ts` reports it exactly as it did before — and a
  // program that DOES declare it checks clean, which is what the conformance fixture
  // `interaction-events/block-heads-free-core-only` pins for the declaration half.
  for (const { word } of PROFILE_WORDS) {
    assert.deepEqual(
      badTokenTexts(`print ${word}\n`, CORE_ONLY),
      [],
      `Core-only \`print ${word}\` must not raise ol-bad-token`,
    );
    assert.deepEqual(
      allDiagnostics(`print ${word}\n`, CORE_ONLY).map(
        (diagnostic) => diagnostic.code,
      ),
      ["ol-unknown-command"],
      `Core-only \`print ${word}\` must stay an ordinary unknown name`,
    );
    assert.deepEqual(
      allDiagnostics(
        `define ${word}\n  return 3\nend\nprint ${word}\n`,
        CORE_ONLY,
      ),
      [],
      `Core-only \`define ${word}\` and its call must stay legal`,
    );
  }
});

test("a sibling profile's activation does not reject the other profile's words", () => {
  // Guards the `isProfileKeyword(name, profiles)` gate against collapsing into "any profile word".
  assert.deepEqual(
    badTokenTexts("print ask\n", activeSetFor("interaction-events")),
    [],
  );
  assert.deepEqual(badTokenTexts("print when\n", activeSetFor("sprites")), []);
});

test("legitimate profile statements are untouched — the head is not a callee", () => {
  // The reader lowers a real profile form into a `ProfileStatement`, whose head lives in `keyword`
  // rather than `callee`, so this rule never sees it. Without that, the fix would have broken every
  // program the profiles exist for.
  const interaction = activeSetFor("interaction-events");
  const sprites = activeSetFor("sprites");

  for (const [source, profiles] of [
    ['when "start" [ print "ready" ]\n', interaction],
    ['when "start"\n  print "ready"\nend when\n', interaction],
    ["every 100 [ print 1 ]\n", interaction],
    ['on_key "a" [ print 1 ]\n', interaction],
    ["on_click [ print 1 ]\n", interaction],
    ["tell 1\n", sprites],
    ["ask 1 [ forward 10 ]\n", sprites],
    ["each [ forward 10 ]\n", sprites],
  ]) {
    assert.deepEqual(
      allDiagnostics(source, profiles),
      [],
      `\`${source.trim()}\` is a legal profile statement and must stay clean`,
    );
  }
});

test("profile words stay legal as data and in every binding position", () => {
  // `spec/grammar.md:386` makes accepting any name in a binding position a normative MUST, and
  // `:406` makes dictionary keys and bare selector keys data. None of these lowers the word into a
  // callee, so the rule must not reach them — asserted rather than assumed, because that is the
  // half a position-blind fix would have broken.
  const profiles = activeSetFor("interaction-events");

  for (const source of [
    ":when = 1\n",
    "set when to 1\n",
    "local when\n",
    ":marks = { when: 1 }\n",
    ":marks = { when: 1 }\nprint :marks.when\n",
    ":marks = { when: 1 }\nprint :marks[when]\n",
    "for when in [ 1 2 ] [ print :when ]\n",
  ]) {
    assert.deepEqual(
      allDiagnostics(source, profiles),
      [],
      `\`${source.trim()}\` uses a profile word as data or a binding, which stays legal`,
    );
  }

  // `make "name" <value>` is the Heritage spelling of the same MUST, so it needs that profile
  // active to be a recognized form at all — without it, `checker-heritage-form.ts` reports the
  // head, which would have nothing to do with the word being bound.
  assert.deepEqual(
    allDiagnostics('make "when" 1\n', [...profiles, "heritage"]),
    [],
  );
});

test("an ordinary call is untouched — the rule only fires on a profile word", () => {
  // The `isCallLike && isProfileKeyword` gate's other arm: a `Call` node whose callee is a perfectly
  // ordinary name must produce nothing.
  assert.deepEqual(
    allDiagnostics(
      "define twice :n\n  return :n * 2\nend\nprint twice 4\n",
      activeSetFor("interaction-events"),
    ),
    [],
  );
});

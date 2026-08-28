// A **generated** corpus for the four contextual keywords' highlighting, issue #959.
//
// ## Why this file exists
//
// Two independent fixes to `markIsPredicateKeywords` shipped incomplete in consecutive review
// rounds, and each author's tests passed. The reason was not carelessness — it was that both
// corpora were *enumerations from the author's head*, so each contained exactly the shapes its
// author was already picturing. A hand-written five-row acceptance matrix, written specifically to
// catch the first miss, then missed three further shapes itself.
//
// **Covering a branch is not asserting a behaviour.** `scripts/built-in-names-gate.mjs` reported
// 100% line and branch coverage of the paren-skipping loop while that loop was wrong, because one
// single-line probe entered the loop without exercising what it decides.
//
// So this corpus is not a list. It is a **cross product**, derived from the grammar's own
// structure, and it asserts that every shape **agrees** — which means a shape nobody thought of
// fails a comparison instead of passing silently.
//
// ## What it is derived from
//
// `spec/grammar.md:185-188` gives the production:
//
//     is-predicate ::= "is" ( "empty" | "member" "of" additive | "a" word-literal
//                           | [ "strictly" ] "between" additive "and" additive )
//
// {@link FORMS} is that alternation, and {@link CONTEXTUAL_WORDS} is the subset of its words that
// `spec/grammar.md:380` makes contextual — `empty`, `member`, `of`, `a`. (`between` and `strictly`
// are keywords everywhere, so they are not this file's subject.)
//
// The operand is an `additive`, which bottoms out at `primary`, whose parenthesised alternative is
// what makes the operand's own span end *before* the tokens that follow it. {@link OPERAND_SHAPES}
// is that alternative applied at increasing depth and with the whitespace the grammar permits
// inside it. Neither list is written from the failures anyone already knew.
//
// ## What it deliberately does NOT cover, and who owns that
//
// The grammar also permits **newlines between adjacent symbols** of the production — after `is`,
// between `member` and `of`, and before `is`. Those positions are a second axis, owned by the
// `indexSkippingNewlines` work on issue #944/#995, and they are **not** generated here: at the time
// of writing they fail, and recording 270 expected failures would institutionalise the defect
// rather than gate it. Adding that axis is one entry in {@link GAP_SHAPES} once #944 lands, and
// this file is written so that is the whole change.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "<contextual-shape-corpus>";

/** Every profile a program can claim, so profile gating never confounds a shape result. */
const ALL_PROFILES = OL.OL_CHECK_PROFILES;

/**
 * The contextual four (`spec/grammar.md:380`). Asserted against the manifest's own declaration in
 * `scripts/built-in-names-gate.test.mjs`; repeated here only as the subject of the cross product.
 */
const CONTEXTUAL_WORDS = ["empty", "member", "of", "a"];

/**
 * The `is-predicate` alternation of `spec/grammar.md:185-188`, minus `between`, whose words are
 * keywords everywhere and so are not contextual. `words` is the contextual words each alternative
 * contributes, in source order.
 */
const FORMS = [
  { name: "empty", tail: "is empty", words: ["empty"] },
  { name: "member-of", tail: "is member of :nums", words: ["member", "of"] },
  { name: "a", tail: 'is a "point"', words: ["a"] },
];

/**
 * The operand, from `primary`'s parenthesised alternative at increasing depth and with the
 * whitespace the grammar permits inside the parentheses.
 *
 * `paren-deep-indent` is not decoration: an operand starting past column 24 and ending on the next
 * line at a small column is the only shape that makes *both* of a span's dimensions decrease, which
 * is what separates a containment-ordered rank from a width-ordered one.
 */
const OPERAND_SHAPES = [
  ["bare", (operand) => operand],
  ["paren", (operand) => `(${operand})`],
  ["paren-nested", (operand) => `((${operand}))`],
  ["paren-deep", (operand) => `(((${operand})))`],
  ["paren-multiline", (operand) => `(\n${operand}\n)`],
  ["paren-indented", (operand) => `  (\n    ${operand}\n  )`],
  ["paren-deep-indent", (operand) => `(${" ".repeat(24)}${operand}\n)`],
];

/**
 * The whitespace between the operand and its `is`. Newline gaps *after* `is` are the #944 axis and
 * are absent by the file header's reasoning; this list is the extension point.
 */
const GAP_SHAPES = [
  ["space", " "],
  ["spaces", "   "],
];

/** Operands that reach different `primary` alternatives, so the shape is not tied to one of them. */
const OPERANDS = [":x", "2", ":p.q", ":nums[1]"];

/**
 * Every generated case: `{ source, form, word, shape, gap }`.
 *
 * Nothing is dropped. An earlier draft skipped combinations that do not parse, which was a branch
 * no input reached — and a corpus that silently narrows is the defect this file exists to prevent.
 * Every combination of these axes *is* a valid program, so that is asserted instead
 * ({@link parseFailures}) and the generator stays total.
 */
function generateCases() {
  const cases = [];
  for (const [shape, wrap] of OPERAND_SHAPES) {
    for (const [gap, spacing] of GAP_SHAPES) {
      for (const form of FORMS) {
        for (const operand of OPERANDS) {
          const source = `print ${wrap(operand)}${spacing}${form.tail}`;
          for (const word of form.words) {
            cases.push({ source, form: form.name, word, shape, gap });
          }
        }
      }
    }
  }
  return cases;
}

const CASES = generateCases();

/** The generated sources that do not parse — a highlighting claim needs a valid program first. */
function parseFailures() {
  return CASES.map(
    (generated) =>
      `${generated.shape}: ${OL.parse(generated.source, doc).diagnostics.length}`,
  ).filter((described) => !described.endsWith(": 0"));
}

/**
 * Every generated case paired with the classes the highlighter gives its word — the whole set, so
 * the assertion is one `deepEqual` over data rather than a conditional that only runs when
 * something is wrong. A disagreement then *is* the diff, and there is no untaken failure branch.
 *
 * `join` is used without a fallback for the empty case deliberately: an empty string is already a
 * visible difference from `keyword`, and a `||` fallback would be a branch nothing reaches while
 * the corpus is green — the shape this file exists to keep out.
 */
function paintedClassesByCase() {
  return CASES.map((generated) => {
    const classes = OL.highlight(generated.source, doc, {
      profiles: ALL_PROFILES,
    })
      .filter((token) => token.text.toLowerCase() === generated.word)
      .map((token) => token.class);
    return `${generated.shape}/${generated.form}/${generated.word} -> ${classes.join(", ")}`;
  });
}

test("the generated corpus is a cross product, not a list that quietly emptied", () => {
  // Without this, a generator bug that dropped every case would make the corpus vacuously green —
  // the same "passes because it checks nothing" shape the gate this corpus supports exists to close.
  const expected =
    OPERAND_SHAPES.length *
    GAP_SHAPES.length *
    OPERANDS.length *
    FORMS.reduce((total, form) => total + form.words.length, 0);
  assert.equal(
    CASES.length,
    expected,
    "every generated combination must parse",
  );
  assert.equal(CASES.length, 224);

  // And it really is a cross product: every axis value reaches the corpus.
  for (const [shape] of OPERAND_SHAPES) {
    assert.ok(
      CASES.some((generated) => generated.shape === shape),
      `no case for operand shape ${shape}`,
    );
  }
  for (const [gap] of GAP_SHAPES) {
    assert.ok(
      CASES.some((generated) => generated.gap === gap),
      `no case for gap ${gap}`,
    );
  }
  for (const word of CONTEXTUAL_WORDS) {
    assert.ok(
      CASES.some((generated) => generated.word === word),
      `no case for contextual word ${word}`,
    );
  }
});

test("every generated shape is a valid program, so each is a highlighting claim", () => {
  // A shape that does not parse would be a PARSE claim and a different test's subject. Asserting
  // this keeps the generator total: it cannot quietly narrow by dropping what it cannot handle.
  assert.deepEqual(parseFailures(), []);
});

test("every contextual word is `keyword` in every generated operand shape", () => {
  // The assertion is AGREEMENT across shapes, not a per-shape expectation: a shape nobody thought
  // of joins the comparison automatically and fails it if the highlighter treats it differently.
  // Compared as one whole set, so a disagreement IS the diff — there is no failure branch that only
  // executes when something is already wrong.
  const expected = CASES.map(
    (generated) =>
      `${generated.shape}/${generated.form}/${generated.word} -> keyword`,
  );
  assert.deepEqual(paintedClassesByCase(), expected);
});

test("the same words are ordinary names outside the predicate, in every shape", () => {
  // The other half of `spec/grammar.md:380`: these four are structural BY POSITION. A corpus that
  // only proved they paint `keyword` would be satisfied by a highlighter that painted them
  // `keyword` everywhere, which is the opposite defect.
  const elsewhere = [];
  for (const word of CONTEXTUAL_WORDS) {
    for (const source of [
      `local ${word}`,
      `print ${word}`,
      `define ${word}\nend`,
      `for ${word} in [ 1 2 ]\nend`,
    ]) {
      const classes = OL.highlight(source, doc, { profiles: ALL_PROFILES })
        .filter((token) => token.text.toLowerCase() === word)
        .map((token) => token.class);
      elsewhere.push({
        source,
        diagnostics: OL.parse(source, doc).diagnostics.length,
        keyword: classes.includes("keyword"),
        painted: classes.length > 0,
      });
    }
  }
  assert.deepEqual(
    elsewhere.filter(
      (each) => each.diagnostics > 0 || each.keyword || !each.painted,
    ),
    [],
  );
});

test("the corpus reproduces the operand shapes that were once wrong", () => {
  // The generator's own check, and the direction matters: these shapes are NOT the generator's
  // input. If deriving from the grammar stopped producing them, the generator is what broke, and
  // this test says so rather than the corpus silently narrowing.
  //
  // Each was a live defect at some point in issue #959's review: a parenthesised operand's span
  // ends before its own `)`, so a scan that stepped a fixed one token past it marked nothing.
  for (const shape of [
    "paren",
    "paren-nested",
    "paren-multiline",
    "paren-indented",
    "paren-deep-indent",
  ]) {
    assert.ok(
      CASES.some((generated) => generated.shape === shape),
      `the generator no longer produces ${shape}, which was once a live defect`,
    );
  }
});

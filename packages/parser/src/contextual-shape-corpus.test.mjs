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
// {@link FORMS} is that alternation as **token sequences**, and {@link CONTEXTUAL_WORDS} is the
// subset of its words that `spec/grammar.md:380` makes contextual — `empty`, `member`, `of`, `a`.
// (`between` and `strictly` are keywords everywhere, so they are not this file's subject.)
//
// Three axes come off that production, and each is a product rather than a list:
//
// - **operand shape.** The operand is an `additive`, bottoming out at `primary`, whose
//   parenthesised alternative makes the operand's own span end *before* the tokens that follow it.
//   {@link OPERAND_SHAPES} is `closing-pattern x opening`, not a flat list of
//   remembered shapes: the three vary independently in the grammar, so combining them reaches
//   sources no alternation of them can express — a deep nest *containing* a newline, and a closing
//   tail where a paren sits *between* two whitespace runs.
// - **gap position.** The grammar permits whitespace at every adjacency of the production, so
//   {@link GAP_DEVIATIONS} is applied at each slot in turn rather than only between the operand and
//   its `is`.
// - **operand form**, so a shape is never tied to one `primary` alternative.
//
// Neither the shapes nor the slots are written from the failures anyone already knew: both are
// enumerated from the grammar's own structure, and the set of cases that currently fail is
// **measured** from them (see below) rather than listed by hand.
//
// ## The one axis whose failures are pinned rather than fixed
//
// Of the seven adjacencies in the alternation, a newline at four of them is still painted wrong.
// That is issue **#995**'s defect ("Multi-line `is` predicates paint `empty`/`member`/`of`/`a` as
// `primitive` in programs that parse completely clean"), not this slice's; the fix is being carried
// by the session working on #944. It is generated here anyway, and pinned as
// {@link DEFERRED_NEWLINE_GAPS} — **five coordinates**, whose expansion over the shape and operand
// axes is measured, not written down.
//
// Pinning the coordinates rather than excluding the axis matters in both directions: the pin is
// compared as a set, so when #995 is fixed and a coordinate starts passing, this test fails and
// forces the corpus to widen — and a *new* adjacency that regresses fails it too. Excluding the
// axis entirely (an earlier draft of this file) left the newline handling that this slice *did* fix
// with no test at all, and credited it in prose to a deferred issue.

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
 * The `is-predicate` alternation of `spec/grammar.md:185-188` as token sequences, minus `between`,
 * whose words are keywords everywhere and so are not contextual.
 *
 * Token sequences rather than rendered tails: a fixed tail string has no adjacency a gap can
 * occupy, so `member of` could only ever be generated with exactly one space in it. `words` is the
 * contextual words the alternative contributes, in source order.
 */
const FORMS = [
  { name: "empty", tokens: ["is", "empty"], words: ["empty"] },
  {
    name: "member-of",
    tokens: ["is", "member", "of", ":nums"],
    words: ["member", "of"],
  },
  { name: "a", tokens: ["is", "a", '"point"'], words: ["a"] },
];

/**
 * The **closing pattern** of a parenthesised operand: how many newlines precede each `)`, listed
 * innermost first. `[0,1]` is `((:x)\n)`; `[1,0,0]` is `(((:x\n)))`.
 *
 * One axis, enumerated exhaustively, rather than three sampled ones. Earlier revisions of this file
 * had a `depth x interior-style x placement` product, and each was found in turn to be a *sample*
 * of the space rather than the space: interiors fixed every newline run at exactly one, and the
 * three placements (innermost/outermost/every) covered only 3 of the `2^depth - 1` non-empty level
 * subsets — so `(((:x)\n))`, which parses clean and paints correctly, was unreachable. Both gaps
 * admitted a phased scanner that satisfied the whole corpus while failing a valid program (issue
 * #959 review rounds 8-9).
 *
 * A vector says exactly what the tail is, so the corpus reaches every interleaving of closing
 * parens and newline runs within its bounds — and {@link signatureOf} reads that tail back off the
 * emitted text and compares it, which no `depth`-only signature could do.
 */
const CLOSING_RUNS = [0, 1, 2];

/** Depths enumerated over the full {@link CLOSING_RUNS} product. */
const EXHAUSTIVE_DEPTHS = [1, 2, 3];

/**
 * One depth beyond the exhaustive range, over the shorter run alphabet, so the scan is anchored
 * from above: a loop capped at three iterations passes an exhaustive-to-3 corpus.
 */
const ANCHOR_DEPTH = 4;
const ANCHOR_RUNS = [0, 1];

/**
 * Leading whitespace inside the innermost paren. Kept as its own axis because it moves where the
 * operand *starts* while the closing pattern moves where it *ends*, and the two are independent in
 * the grammar.
 */
const OPERAND_OPENINGS = [
  ["tight", ""],
  ["wide-indent", " ".repeat(24)],
];

/** Every vector of length `depth` over `alphabet`, in order. */
function closingVectors(depth, alphabet) {
  let vectors = [[]];
  for (let position = 0; position < depth; position += 1) {
    const extended = [];
    for (const prefix of vectors) {
      for (const run of alphabet) {
        extended.push([...prefix, run]);
      }
    }
    vectors = extended;
  }
  return vectors;
}

/**
 * `[name, depth, vector, opening, wrap]` — the bare operand plus
 * `closing-pattern x opening`. The all-zero vector is the whitespace-free nest, so `tight` needs no
 * separate entry.
 */
function buildOperandShapes() {
  const shapes = [["bare", 0, [], "none", (operand) => operand]];
  const patterns = [];
  for (const depth of EXHAUSTIVE_DEPTHS) {
    for (const vector of closingVectors(depth, CLOSING_RUNS)) {
      patterns.push([depth, vector]);
    }
  }
  for (const vector of closingVectors(ANCHOR_DEPTH, ANCHOR_RUNS)) {
    patterns.push([ANCHOR_DEPTH, vector]);
  }
  for (const [depth, vector] of patterns) {
    for (const [opening, lead] of OPERAND_OPENINGS) {
      shapes.push([
        `paren-${depth}-${vector.join("")}-${opening}`,
        depth,
        vector,
        opening,
        (operand) => {
          let text = `${lead}${operand}`;
          for (let level = 0; level < depth; level += 1) {
            text = `(${text}${"\n".repeat(vector[level])})`;
          }
          return text;
        },
      ]);
    }
  }
  return shapes;
}

const OPERAND_SHAPES = buildOperandShapes();

/**
 * Whitespace **deviations** from the single space that separates every adjacent symbol by default.
 *
 * Deviations, not values: a "space" entry applied at slot *i* renders identically to the default,
 * so slot after slot would emit the same source and the corpus would count combinations it does
 * not actually distinguish. The default is generated once per form, as its own baseline variant.
 */
const GAP_DEVIATIONS = [
  ["spaces", "   "],
  ["newline", "\n"],
];

/** Operands that reach different `primary` alternatives, so the shape is not tied to one of them. */
const OPERANDS = [":x", "2", ":p.q", ":nums[1]"];

/**
 * The adjacencies where a newline is still painted wrong, owned by issue #995.
 *
 * `after` is the symbol the gap follows — `"operand"` for the gap before `is`. Five coordinates;
 * how many generated cases each covers is measured in the test, not asserted here.
 */
const DEFERRED_NEWLINE_GAPS = [
  { form: "empty", after: "is", word: "empty" },
  { form: "member-of", after: "is", word: "member" },
  { form: "member-of", after: "is", word: "of" },
  { form: "member-of", after: "member", word: "of" },
  { form: "a", after: "is", word: "a" },
];

/**
 * The structural signature of an emitted operand, read **from the text that was generated** rather
 * than from the generator's own input.
 *
 * A label is a claim about the source, and a label taken from the generator's parameters is a claim
 * that describes the generator instead of what it produced — so a wrapper that emitted the wrong
 * nesting would still be labelled with the depth it was asked for.
 *
 * `tail` is the trailing run of closing parens and whitespace, matched off the **end** of the
 * emitted text — an instrument sharing nothing with the generator's structure. Comparing it against
 * the declared closing vector is what a `depth`-only signature could not do: depth alone cannot
 * distinguish `\n))` from `)\n)` from `)\n))`, and each of those distinguishes a different broken
 * scanner.
 */
function signatureOf(emitted) {
  let depth = 0;
  let deepest = 0;
  for (const character of emitted) {
    if (character === "(") {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (character === ")") {
      depth -= 1;
    }
  }
  const tail = emitted.match(/[)\s]*$/)[0].replace(/[^)\n]/g, "");
  return { depth: deepest, tail };
}

/** The tail a closing vector claims: `[0,1]` claims `")\n)"`. */
function tailOfVector(vector) {
  return vector.map((run) => `${"\n".repeat(run)})`).join("");
}

/** `slot < 0` is the baseline (every adjacency a single space); otherwise the deviation's slot. */
function render(wrap, operand, form, slot, spacing) {
  let text = `print ${wrap(operand)}`;
  for (let index = 0; index < form.tokens.length; index += 1) {
    text += index === slot ? spacing : " ";
    text += form.tokens[index];
  }
  return text;
}

function slotLabel(form, slot) {
  if (slot < 0) {
    return "-";
  }
  return slot === 0 ? "operand" : form.tokens[slot - 1];
}

/**
 * Every generated case: `{ source, shape, depth, vector, opening, signature, operand, form, after,
 * gap, word }`.
 *
 * Nothing is dropped. An earlier draft skipped combinations that do not parse, which was a branch
 * no input reached — and a corpus that silently narrows is the defect this file exists to prevent.
 * Every combination of these axes *is* a valid program, so that is asserted instead
 * ({@link parseFailures}) and the generator stays total.
 */
function generateCases() {
  const cases = [];
  for (const [shape, depth, vector, opening, wrap] of OPERAND_SHAPES) {
    for (const operand of OPERANDS) {
      const signature = signatureOf(wrap(operand));
      for (const form of FORMS) {
        const variants = [{ slot: -1, gap: "default", spacing: " " }];
        for (let slot = 0; slot < form.tokens.length; slot += 1) {
          for (const [gap, spacing] of GAP_DEVIATIONS) {
            variants.push({ slot, gap, spacing });
          }
        }
        for (const variant of variants) {
          const source = render(
            wrap,
            operand,
            form,
            variant.slot,
            variant.spacing,
          );
          for (const word of form.words) {
            cases.push({
              source,
              shape,
              depth,
              vector,
              opening,
              signature,
              operand,
              form: form.name,
              after: slotLabel(form, variant.slot),
              gap: variant.gap,
              word,
            });
          }
        }
      }
    }
  }
  return cases;
}

const CASES = generateCases();

/** Fully qualified: every axis appears, so one label names exactly one generated assertion. */
function labelOf(generated) {
  return `${generated.shape}/${generated.operand}/${generated.form}/after ${generated.after}/${generated.gap}/${generated.word}`;
}

function isDeferred(generated) {
  return DEFERRED_NEWLINE_GAPS.some(
    (pinned) =>
      generated.gap === "newline" &&
      generated.form === pinned.form &&
      generated.after === pinned.after &&
      generated.word === pinned.word,
  );
}

function paintedClassesOf(generated) {
  return OL.highlight(generated.source, doc, { profiles: ALL_PROFILES })
    .filter((token) => token.text.toLowerCase() === generated.word)
    .map((token) => token.class)
    .join(", ");
}

/** The generated sources that do not parse — a highlighting claim needs a valid program first. */
function parseFailures() {
  return CASES.map(
    (generated) =>
      `${labelOf(generated)}: ${OL.parse(generated.source, doc).diagnostics.length}`,
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
  return CASES.map(
    (generated) => `${labelOf(generated)} -> ${paintedClassesOf(generated)}`,
  );
}

test("the generated corpus is a cross product, not a list that quietly emptied", () => {
  // Without this, a generator bug that dropped every case would make the corpus vacuously green —
  // the same "passes because it checks nothing" shape the gate this corpus supports exists to close.
  const expected =
    OPERAND_SHAPES.length *
    OPERANDS.length *
    FORMS.reduce(
      (total, form) =>
        total +
        (1 + form.tokens.length * GAP_DEVIATIONS.length) * form.words.length,
      0,
    );
  assert.equal(CASES.length, expected, "the axes must multiply out");
  assert.equal(CASES.length, 13320);

  // Every case is a distinct assertion: a deviation that rendered the same source as another slot
  // would inflate the count above while distinguishing nothing.
  assert.equal(new Set(CASES.map(labelOf)).size, CASES.length);
  assert.equal(
    new Set(
      CASES.map((generated) => `${generated.source}\u0000${generated.word}`),
    ).size,
    CASES.length,
  );

  // And it really is a cross product: every axis value reaches the corpus.
  for (const [shape] of OPERAND_SHAPES) {
    assert.ok(
      CASES.some((generated) => generated.shape === shape),
      `no case for operand shape ${shape}`,
    );
  }
  for (const [gap] of GAP_DEVIATIONS) {
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
  // Every adjacency of every form carries a deviation, which is what token sequences buy.
  for (const form of FORMS) {
    for (const token of ["operand", ...form.tokens.slice(0, -1)]) {
      assert.ok(
        CASES.some(
          (generated) =>
            generated.form === form.name && generated.after === token,
        ),
        `no gap after ${token} in ${form.name}`,
      );
    }
  }
});

test("every generated shape is a valid program, so each is a highlighting claim", () => {
  // A shape that does not parse would be a PARSE claim and a different test's subject. Asserting
  // this keeps the generator total: it cannot quietly narrow by dropping what it cannot handle.
  assert.deepEqual(parseFailures(), []);
});

test("each shape's declared structure matches the source it actually emits", () => {
  // The label is a claim about the emitted text. Measured back off that text, so a wrapper that
  // emitted a different nesting than its name says fails here rather than mislabelling every case
  // it produces.
  const disagreements = CASES.filter(
    (generated) => generated.signature.depth !== generated.depth,
  ).map(labelOf);
  assert.deepEqual(disagreements, []);

  // And the TAIL matches the vector, not merely the paren count. This is the comparison a
  // `depth`-only signature could not make: `\n))`, `)\n)` and `)\n))` share a depth and separate
  // three different broken scanners.
  const tailDisagreements = CASES.filter(
    (generated) => generated.signature.tail !== tailOfVector(generated.vector),
  ).map(labelOf);
  assert.deepEqual(tailDisagreements, []);

  // The closing-pattern axis is enumerated, so these three properties are consequences of it
  // rather than hand-added cases — but each was a live escape, so each is asserted reachable.
  const tails = new Set(CASES.map((generated) => generated.signature.tail));
  assert.ok(
    [...tails].some((tail) => /\)\n+\)/.test(tail)),
    "no interleaved `) newline )` tail — a phased scanner would pass",
  );
  assert.ok(
    [...tails].some((tail) => /\n\n/.test(tail)),
    "no newline RUN longer than one — a one-newline-per-position scanner would pass",
  );
  assert.ok(
    tails.has(")\n))"),
    "no middle-only closing pattern — the placement axis has collapsed to a sample again",
  );
  // Deeper than the exhaustive range, so a scan capped at three iterations is still caught.
  assert.ok(
    CASES.some((generated) => generated.depth === ANCHOR_DEPTH),
    "the anchor depth is unreachable",
  );
});

test("every contextual word is `keyword` in every generated operand shape", () => {
  // The assertion is AGREEMENT across shapes, not a per-shape expectation: a shape nobody thought
  // of joins the comparison automatically and fails it if the highlighter treats it differently.
  // Compared as one whole set, so a disagreement IS the diff — there is no failure branch that only
  // executes when something is already wrong. The deferred coordinates are pinned to what they
  // currently paint, so they too fail this comparison the moment they change in either direction.
  const expected = CASES.map(
    (generated) =>
      `${labelOf(generated)} -> ${isDeferred(generated) ? "primitive" : "keyword"}`,
  );
  assert.deepEqual(paintedClassesByCase(), expected);
});

test("the deferred newline coordinates are exactly the ones still failing", () => {
  // The pin is a SET comparison in both directions. When #995 is fixed, a fixed coordinate stops
  // appearing here and this fails — the corpus cannot keep claiming a defect that is gone. A newly
  // broken adjacency fails it too.
  const failing = CASES.filter(
    (generated) =>
      generated.gap === "newline" && paintedClassesOf(generated) !== "keyword",
  );
  const measured = [
    ...new Set(
      failing.map(
        (generated) =>
          `${generated.form}/after ${generated.after}/${generated.word}`,
      ),
    ),
  ].sort();
  const declared = DEFERRED_NEWLINE_GAPS.map(
    (pinned) => `${pinned.form}/after ${pinned.after}/${pinned.word}`,
  ).sort();
  assert.deepEqual(measured, declared);

  // Each coordinate fails across the WHOLE shape x operand product, not in one corner of it: a
  // coordinate that started passing for some shapes would otherwise stay pinned and unnoticed.
  assert.equal(
    failing.length,
    DEFERRED_NEWLINE_GAPS.length * OPERAND_SHAPES.length * OPERANDS.length,
  );
  assert.equal(failing.length, 2220);
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
  // ends before its own `)`, so a scan that stepped a fixed one token past it marked nothing. The
  // last three are the round-8 and round-9 escapes — an interleaved tail, a middle-only closing
  // pattern, and a newline run longer than one — none of which the sampled axes could emit.
  const produced = new Set(CASES.map((generated) => generated.shape));
  for (const shape of [
    "paren-1-0-tight",
    "paren-2-00-tight",
    "paren-1-1-tight",
    "paren-1-0-wide-indent",
    "paren-2-01-tight",
    "paren-3-010-tight",
    "paren-1-2-tight",
  ]) {
    assert.ok(
      produced.has(shape),
      `the generator no longer produces ${shape}, which was once a live defect`,
    );
  }
});

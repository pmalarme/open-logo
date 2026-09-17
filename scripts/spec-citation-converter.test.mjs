// Unit tests for the spec-citation converter (saga #1180), the one-shot tool that rewrote every
// line-form citation in the tree into the section anchor of its enclosing heading.
//
// **Why a converter needs its own suite even though the sweep is finished.** The gate re-measures
// the RESULT — zero line citations, a section-anchor count risen by exactly the predicted number —
// and that catches a converter which skipped a file or invented an anchor no heading publishes. What
// it cannot catch is a conversion that is well-formed, resolves, and is still wrong to a human. The
// collapse is exactly that shape: two line specs on one line naming two lines of ONE section must
// become ONE anchor, and emitting `(#debug, #debug)` instead leaves every gate green while a reader
// calls it wrong. So that case is tested by name rather than covered incidentally, together with the
// enclosing-heading boundary, the range that spans two sections, and the hard wrap the converter
// must REFUSE rather than convert half a claim.
//
// Fixtures name a `contract/` directory and this file never writes the real specification
// directory's name as a literal, for the same reason the gate's own suite does not: the gate scans
// this file in CI.

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  anchorsForSpec,
  applyEdits,
  blankLandingIsAmbiguous,
  contentBounds,
  convertTree,
  enclosingHeading,
  expandTail,
  isListElement,
  lineTokens,
  planFile,
  redundantSpan,
  renderAnchors,
} from "./spec-citation-converter.mjs";
import { documentHeadings, splitLines } from "./spec-citations-gate.mjs";

/** The directory name fixtures cite, chosen so it shares no substring with the real one. */
const CONTRACT = "contract";

let TEMP_DIR;

beforeEach(() => {
  TEMP_DIR = mkdtempSync(join(tmpdir(), "ol-citation-convert-"));
});

afterEach(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

/** Write `text` to `<TEMP_DIR>/<name>`, creating intermediate directories. */
function write(name, text) {
  const path = join(TEMP_DIR, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

/** A document whose sections sit at known lines, so every boundary below is exact. */
const GRAMMAR = [
  "# Grammar", // 1
  "", // 2
  "## EBNF notation", // 3
  "", // 4
  "colon-place ::= a", // 5
  "postfix ::= b", // 6
  "", // 7
  "## Expressions and calls", // 8
  "", // 9
  "comparison ::= c", // 10
  "", // 11
  "## Debug", // 12
  "", // 13
  "debug-statement ::= d", // 14
  "more debug prose", // 15
].join("\n");

const HEADINGS = documentHeadings(splitLines(GRAMMAR));
const GRAMMAR_LINES = splitLines(GRAMMAR);

/** Resolve headings for the grammar fixture only; anything else is a missing document. */
const headingsFor = (file) => (file === "grammar.md" ? HEADINGS : null);

/** Resolve document lines for the fixtures that have them, which is what the span rule reads. */
const DOCUMENT_LINES = new Map([["grammar.md", GRAMMAR_LINES]]);
const linesFor = (file) => {
  const lines = DOCUMENT_LINES.get(file);
  // A total lookup on purpose: `planFile` only asks for a document whose headings it already has,
  // so a miss here means a fixture is wired wrong rather than a document legitimately absent.
  assert.ok(lines !== undefined, `no fixture lines for ${file}`);
  return lines;
};

/** Plan one synthetic file and return the rewritten text plus the plan. */
function convert(text, path = "a.ts") {
  const plan = planFile(path, text, CONTRACT, headingsFor, linesFor);
  return { plan, text: applyEdits(text, plan.edits) };
}

// --- The pieces --------------------------------------------------------------------------------

test("expandTail enumerates every continuation form, and flags which the gate can see", () => {
  assert.deepEqual(expandTail(undefined), []);
  assert.deepEqual(expandTail(""), []);
  // The comma-appended tail the gate's own sweep enumerates.
  assert.deepEqual(expandTail(",139"), [
    { start: 139, end: undefined, gateVisible: true },
  ]);
  assert.deepEqual(expandTail(",142-145"), [
    { start: 142, end: 145, gateVisible: true },
  ]);
  // Two forms the gate's bare-reference lookbehind cannot see — a `/` before the colon, and a comma
  // followed by one. They are line claims all the same, so the converter handles them and counts
  // them separately, which is what keeps the two enumerations comparable rather than permanently
  // in disagreement.
  assert.deepEqual(expandTail("/:301"), [
    { start: 301, end: undefined, gateVisible: false },
  ]);
  assert.deepEqual(expandTail(",:85"), [
    { start: 85, end: undefined, gateVisible: false },
  ]);
  assert.deepEqual(expandTail(",139,:85,142-145"), [
    { start: 139, end: undefined, gateVisible: true },
    { start: 85, end: undefined, gateVisible: false },
    { start: 142, end: 145, gateVisible: true },
  ]);
});

test("enclosingHeading puts the line OF a heading in that heading, and the line above it in the previous one", () => {
  // The boundary the whole conversion rests on, pinned on both sides. One line out in either
  // direction sends thousands of citations to an adjacent section — and because the result still
  // resolves, no gate would ever say so.
  const slugAt = (line) => enclosingHeading(HEADINGS, line).slug;
  assert.equal(slugAt(1), "grammar", "the line OF the first heading");
  assert.equal(slugAt(2), "grammar");
  assert.equal(
    slugAt(3),
    "ebnf-notation",
    "the line OF a heading belongs to it",
  );
  assert.equal(slugAt(7), "ebnf-notation", "the line ABOVE the next heading");
  assert.equal(slugAt(8), "expressions-and-calls");
  assert.equal(slugAt(11), "expressions-and-calls");
  assert.equal(slugAt(12), "debug");
  assert.equal(slugAt(15), "debug", "the last line of the document");
  // A blank line still has an enclosing heading, which is why a citation landing in the blank space
  // between sections dissolves rather than needing a decision.
  assert.equal(slugAt(4), "ebnf-notation");
  // A line before every heading has none at all.
  assert.equal(enclosingHeading(documentHeadings(["text"]), 1), null);
  assert.equal(enclosingHeading([], 5), null);
});

test("anchorsForSpec gives one anchor per section a range touches", () => {
  assert.deepEqual(anchorsForSpec(HEADINGS, { start: 5 }), ["ebnf-notation"]);
  assert.deepEqual(anchorsForSpec(HEADINGS, { start: 5, end: 6 }), [
    "ebnf-notation",
  ]);
  assert.deepEqual(anchorsForSpec(HEADINGS, { start: 5, end: 10 }), [
    "ebnf-notation",
    "expressions-and-calls",
  ]);
  // No enclosing heading at all.
  assert.equal(anchorsForSpec(documentHeadings(["text"]), { start: 1 }), null);
  // A heading that publishes no slug cannot be cited, so the site is refused rather than converted
  // into `#` — an anchor naming nothing would resolve nowhere and fail the gate forever.
  assert.equal(
    anchorsForSpec(documentHeadings(["## ![alt](x.png)", "", "text"]), {
      start: 3,
    }),
    null,
  );
});

test("THE SPAN RULE: a range's anchors come from its CONTENT, and cover EVERY section crossed", () => {
  // Two defects in one rule, both of which produce anchors that RESOLVE and so are invisible to
  // every gate. Anchor resolution catches an anchor that names no heading; it never catches one that
  // names the wrong heading, so nothing downstream can correct either.
  //
  // (a) A range whose first line is the blank separator closing the previous section gained an
  // anchor to a section the claim never relied on. Line 7 closes #ebnf-notation; line 8 opens
  // #expressions-and-calls.
  assert.equal(GRAMMAR_LINES[6].trim(), "");
  assert.deepEqual(
    anchorsForSpec(HEADINGS, { start: 7, end: 10 }, GRAMMAR_LINES),
    ["expressions-and-calls"],
    "a leading blank separator must not contribute an anchor",
  );
  // Without the document's lines there is nothing to trim towards and the raw endpoint stands —
  // which is exactly the wrong answer, kept here so the difference the rule makes is visible.
  assert.deepEqual(anchorsForSpec(HEADINGS, { start: 7, end: 10 }), [
    "ebnf-notation",
    "expressions-and-calls",
  ]);
  // Symmetrically at the far end: a range stopping on the blank line before the next heading does
  // not reach into that heading's section.
  assert.deepEqual(
    anchorsForSpec(HEADINGS, { start: 5, end: 7 }, GRAMMAR_LINES),
    ["ebnf-notation"],
  );

  // (b) An inclusive range claims EVERY line between its endpoints, so it claims every section those
  // lines fall in. Emitting only the first and last dropped the middle one — and the middle is often
  // the section the claim actually rests on.
  assert.deepEqual(
    anchorsForSpec(HEADINGS, { start: 5, end: 14 }, GRAMMAR_LINES),
    ["ebnf-notation", "expressions-and-calls", "debug"],
    "a range crossing three sections must name all three",
  );
  assert.deepEqual(
    anchorsForSpec(HEADINGS, { start: 5, end: 10 }, GRAMMAR_LINES),
    ["ebnf-notation", "expressions-and-calls"],
  );
  // A range inside one section still names exactly one.
  assert.deepEqual(
    anchorsForSpec(HEADINGS, { start: 5, end: 6 }, GRAMMAR_LINES),
    ["ebnf-notation"],
  );
  assert.deepEqual(anchorsForSpec(HEADINGS, { start: 5 }, GRAMMAR_LINES), [
    "ebnf-notation",
  ]);
});

test("contentBounds trims blanks off both ends, and says when there is nothing to trim towards", () => {
  assert.deepEqual(contentBounds({ start: 5, end: 6 }, GRAMMAR_LINES), {
    start: 5,
    end: 6,
    allBlank: false,
  });
  assert.deepEqual(contentBounds({ start: 4, end: 7 }, GRAMMAR_LINES), {
    start: 5,
    end: 6,
    allBlank: false,
  });
  assert.deepEqual(contentBounds({ start: 7 }, GRAMMAR_LINES), {
    start: 7,
    end: 7,
    allBlank: true,
  });
  // Without the document there is nothing to measure, so the endpoints stand unchanged.
  assert.deepEqual(contentBounds({ start: 4, end: 7 }, null), {
    start: 4,
    end: 7,
    allBlank: false,
  });
});

test("a blank landing is ambiguous only when it sits on a section boundary", () => {
  // Most blank landings are harmless — a blank line between two paragraphs of one section has that
  // section either side of it. The dangerous one is the separator closing a section, where the text
  // the claim relies on begins below while the enclosing heading is above.
  assert.equal(
    blankLandingIsAmbiguous({ start: 7 }, GRAMMAR_LINES, HEADINGS),
    true,
    "line 7 closes #ebnf-notation and line 8 opens the next section",
  );
  assert.equal(
    blankLandingIsAmbiguous({ start: 13 }, GRAMMAR_LINES, HEADINGS),
    false,
    "line 13 is blank INSIDE #debug, with #debug either side of it",
  );

  // A RUN of blank lines before the heading, which is how a document with generous spacing separates
  // its sections. Looking only at the line immediately after would find another blank and compare
  // the section with itself, so the scan has to walk past the whole run.
  const spaced = ["# One", "", "text", "", "", "", "## Two", "", "more"];
  const spacedHeadings = documentHeadings(spaced);
  assert.equal(
    blankLandingIsAmbiguous({ start: 4 }, spaced, spacedHeadings),
    true,
    "three blank lines still separate #one from #two",
  );
  // And a run of blanks that ends inside the same section is still unambiguous.
  assert.equal(
    blankLandingIsAmbiguous({ start: 8 }, spaced, spacedHeadings),
    false,
  );
  // A blank run reaching end-of-document has nothing below it, so above and below agree.
  assert.equal(
    blankLandingIsAmbiguous(
      { start: 2 },
      ["# One", "", ""],
      documentHeadings(["# One", "", ""]),
    ),
    false,
  );
  // A blank line ABOVE every heading has no section above it at all, which is a different answer
  // from "the same section either side" and must not be conflated with it.
  assert.equal(
    blankLandingIsAmbiguous(
      { start: 1 },
      ["", "# One", "text"],
      documentHeadings(["", "# One", "text"]),
    ),
    true,
  );
});

test("renderAnchors writes the citable form, joining a two-section range with a comma", () => {
  assert.equal(
    renderAnchors(CONTRACT, "grammar.md", ["ebnf-notation"]),
    "contract/grammar.md#ebnf-notation",
  );
  assert.equal(
    renderAnchors(CONTRACT, "grammar.md", ["ebnf-notation", "debug"]),
    "contract/grammar.md#ebnf-notation, contract/grammar.md#debug",
  );
});

test("redundantSpan takes the separator out with the token it removes, and reports which", () => {
  // Without this a collapse leaves the same anchor written twice with a comma between them. Whether
  // a comma was absorbed is reported rather than inferred, because it is half of the safety test.
  const span = (text, start, end) => redundantSpan(text, start, end);
  assert.deepEqual(span("see x and y", 4, 5), {
    from: 4,
    to: 5,
    absorbedComma: false,
  });
  // A wrapping pair of backticks goes first...
  assert.deepEqual(span("see `x` and y", 5, 6), {
    from: 4,
    to: 7,
    absorbedComma: false,
  });
  // ...then the whitespace and single comma in front of it.
  assert.deepEqual(span("see a, b and y", 7, 8), {
    from: 5,
    to: 8,
    absorbedComma: true,
  });
  assert.deepEqual(span("see a,   b and y", 9, 10), {
    from: 5,
    to: 10,
    absorbedComma: true,
  });
  assert.deepEqual(span("see a,\tb", 7, 8), {
    from: 5,
    to: 8,
    absorbedComma: true,
  });
  // Only ONE comma: a second belongs to the neighbour that is being kept.
  assert.deepEqual(span("see a,, b", 8, 9), {
    from: 6,
    to: 9,
    absorbedComma: true,
  });
  // A token at the very start of a line has nothing in front of it to absorb.
  assert.deepEqual(span("x and y", 0, 1), {
    from: 0,
    to: 1,
    absorbedComma: false,
  });
  // A backtick on one side only is not a wrapping pair.
  assert.deepEqual(span("see `x and y", 5, 6), {
    from: 5,
    to: 6,
    absorbedComma: false,
  });
});

test("isListElement tells a citation LIST from a word of a sentence", () => {
  // The single judgement a converter can get wrong in a way no gate will ever see. BOTH properties
  // are needed: a comma was absorbed, and what follows closes a BRACKETED list. Comma-separation
  // alone is not enough, which is the mistake that produced "— states the active half the inactive
  // one" in the first sweep.
  const listElement = (text, start, end) =>
    isListElement(text, redundantSpan(text, start, end));
  assert.equal(listElement("see (a, b) here", 8, 9), true, "closing bracket");
  assert.equal(listElement("see (a, b, c) here", 8, 9), true, "further comma");
  assert.equal(listElement("see [a, b] here", 8, 9), true, "square bracket");
  // Comma-separated but followed by PROSE: removing it welds two clauses together.
  assert.equal(
    listElement("a states the half, b the other one", 18, 19),
    false,
    "a referring expression, not a list element",
  );
  // SENTENCE punctuation is deliberately not enough. `x states it; for the counterexample, y.` is
  // comma-separated and ends in a period, yet deleting `y` removes the object of the clause. When
  // the evidence is weak the anchor is repeated, because verbose beats wrong.
  assert.equal(
    listElement("a states it; for the counterexample, b.", 36, 37),
    false,
    "a period is not evidence of a list",
  );
  assert.equal(
    listElement("a states it; for the counterexample, b", 36, 37),
    false,
    "nor is end-of-line",
  );
  assert.equal(
    listElement("a states it; for the counterexample, b;", 36, 37),
    false,
    "nor is a semicolon",
  );
  // No comma at all: the token is joined by a word, so removing it leaves a hole.
  assert.equal(listElement("the rule a and b now state it", 15, 16), false);
  assert.equal(listElement("offers x (y) and", 10, 11), false);
});

test("applyEdits rewrites last-first, so earlier offsets stay valid", () => {
  const text = "alpha beta gamma";
  assert.equal(
    applyEdits(text, [
      { from: 0, to: 5, text: "ONE" },
      { from: 11, to: 16, text: "THREE" },
      { from: 6, to: 10, text: "TWO" },
    ]),
    "ONE TWO THREE",
  );
  assert.equal(applyEdits(text, []), text);
});

test("lineTokens finds mentions anywhere, and a bare reference only on a prose line", () => {
  const tokens = lineTokens(
    "a.ts",
    "// contract/grammar.md:5-6,10 and also :14 here",
    CONTRACT,
  );
  assert.deepEqual(
    tokens.map((token) => `${token.kind}:${token.start}`),
    ["mention:5", "bare:14"],
  );
  assert.equal(tokens[0].end, 6);
  assert.equal(tokens[0].tail, ",10");
  // A different directory is not this corpus and is left alone.
  assert.deepEqual(lineTokens("a.ts", "// other/grammar.md:5", CONTRACT), []);
  // Live code carries no citations, so a formatted ratio is never offered as one.
  assert.deepEqual(
    lineTokens("a.ts", "const label = ratio + ':1';", CONTRACT),
    [],
  );
  // A colon-and-number INSIDE a mention is part of it, never a second token.
  assert.equal(lineTokens("a.md", "contract/grammar.md:5", CONTRACT).length, 1);
  // A mention with no line spec is still a token — it may carry an anchor a later collapse lands on.
  const anchored = lineTokens(
    "a.md",
    "contract/grammar.md#debug and contract/grammar.md",
    CONTRACT,
  );
  assert.deepEqual(
    anchored.map((token) => token.fragment),
    ["debug", undefined],
  );
});

// --- planFile: the conversion itself -------------------------------------------------------------

test("an explicit citation becomes the anchor of its enclosing section", () => {
  const { plan, text } = convert("// contract/grammar.md:5 defines it.\n");
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.sites, 1);
  assert.deepEqual(plan.produced, ["grammar.md#ebnf-notation"]);
  assert.equal(text, "// contract/grammar.md#ebnf-notation defines it.\n");
});

test("a range spanning two sections becomes BOTH anchors, not half the claim", () => {
  const { plan, text } = convert("// contract/grammar.md:5-10 covers both.\n");
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.spanning, 1);
  assert.equal(
    text,
    "// contract/grammar.md#ebnf-notation, contract/grammar.md#debug covers both.\n".replace(
      "#debug",
      "#expressions-and-calls",
    ),
  );
  assert.deepEqual(plan.produced, [
    "grammar.md#ebnf-notation",
    "grammar.md#expressions-and-calls",
  ]);
});

test("a COLLAPSE writes one anchor where the duplicate was a citation-LIST element", () => {
  // The safe half: a parenthesised list of citations whose second element names the same section as
  // the first. Emitting both leaves `(#debug, #debug)`, which every gate accepts and every reader
  // calls wrong.
  const { plan, text } = convert(
    "// See (contract/grammar.md:14, contract/grammar.md:15) for it.\n",
  );
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.sites, 2, "both sites are still counted");
  assert.equal(plan.collapsed, 1, "and one of them collapsed");
  assert.deepEqual(plan.produced, ["grammar.md#debug"], "into ONE anchor");
  assert.equal(text, "// See (contract/grammar.md#debug) for it.\n");
  assert.doesNotMatch(text, /#debug.*#debug/, "never the same anchor twice");
});

test("a duplicate that is LOAD-BEARING in the sentence is written out, never deleted", () => {
  // The defect this suite exists for, and the one only a human could have caught: the first sweep
  // deleted bare references that were grammatical subjects of their clauses, leaving text that does
  // not parse while every anchor still resolved and every count still balanced. Verbose beats wrong,
  // so the anchor is repeated instead.
  const { plan, text } = convert(
    "// contract/grammar.md:14 states the first half, :15 the second.\n",
  );
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.collapsed, 0, "this is not a list element");
  assert.equal(
    text,
    "// contract/grammar.md#debug states the first half, contract/grammar.md#debug the second.\n",
  );
  assert.match(
    text,
    /states the first half, .+ the second\./,
    "the sentence must still parse",
  );

  // Three more shapes that each lost a word in the first sweep, now intact.
  assert.equal(
    convert("// the rule contract/grammar.md:14 and :15 now state it.\n").text,
    "// the rule contract/grammar.md#debug and contract/grammar.md#debug now state it.\n",
  );
  assert.equal(
    convert("// offers `x` (contract/grammar.md:14) and `y` (:15).\n").text,
    "// offers `x` (contract/grammar.md#debug) and `y` (contract/grammar.md#debug).\n",
  );
  assert.equal(
    convert("// `contract/grammar.md:14`/`contract/grammar.md:15`: one rule.\n")
      .text,
    "// `contract/grammar.md#debug`/`contract/grammar.md#debug`: one rule.\n",
  );
});

test("a collapse removes the punctuation that joined the duplicate to its neighbour", () => {
  // Two list shapes the corpus actually writes. Leaving the separator behind is the visible defect:
  // a dangling comma, or a pair of empty backticks.
  assert.equal(
    convert("// See (contract/grammar.md:14, contract/grammar.md:15).\n").text,
    "// See (contract/grammar.md#debug).\n",
  );
  assert.equal(
    convert("// See (`contract/grammar.md:14`, `contract/grammar.md:15`).\n")
      .text,
    "// See (`contract/grammar.md#debug`).\n",
  );
  assert.equal(
    convert("// See contract/grammar.md:14,15.\n").text,
    "// See contract/grammar.md#debug.\n",
  );
});

test("a collapse lands on an anchor ALREADY on the line, rather than repeating it", () => {
  // A line that already carries `#debug` and then cites a line inside that section ends up with one
  // anchor. This is why a plain mention seeds the emitted set even though it converts nothing
  // itself — and it still obeys the list-element rule.
  const { plan, text } = convert(
    "// See (`contract/grammar.md#debug`, contract/grammar.md:15).\n",
  );
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.produced, [], "nothing new was written");
  assert.equal(plan.collapsed, 1);
  assert.equal(text, "// See (`contract/grammar.md#debug`).\n");
});

test("a bare reference is converted using the document the GATE attributes to it", () => {
  // Attribution is deliberately borrowed rather than re-derived: a mis-attributed bare reference
  // converts to an anchor that RESOLVES, so the gate would pass it and the error would be permanent
  // and silent. A missed site is loud; a mis-attributed one is not.
  const { plan, text } = convert(
    "// contract/grammar.md:5 and later just :10 on its own.\n",
  );
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.sites, 2);
  assert.equal(
    text,
    "// contract/grammar.md#ebnf-notation and later just contract/grammar.md#expressions-and-calls on its own.\n",
  );
});

test("a bare reference abutting a comma gains the space the line form did not need", () => {
  // `:5,:10` is legible; running an anchor straight into the separator is not — the gate reads the
  // comma as part of the fragment and the citation stops resolving.
  const { text } = convert("// contract/grammar.md:5,:10 both matter.\n");
  assert.match(
    text,
    /#ebnf-notation, contract\/grammar\.md#expressions-and-calls/,
  );
  assert.doesNotMatch(text, /#ebnf-notation,contract/);
});

test("a #L line fragment is converted like the line claim it is", () => {
  const { plan, text } = convert(
    "See contract/grammar.md#L10 for it.\n",
    "a.md",
  );
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.sites, 1);
  assert.equal(text, "See contract/grammar.md#expressions-and-calls for it.\n");
  const ranged = convert("See contract/grammar.md#L5-L10 for it.\n", "a.md");
  assert.equal(
    ranged.text,
    "See contract/grammar.md#ebnf-notation, contract/grammar.md#expressions-and-calls for it.\n",
  );
});

test("a bare reference may name a RANGE, and the half already on the line is not repeated", () => {
  // The range spans two sections, but `#ebnf-notation` is already written earlier on this line, so
  // only the fresh half is emitted. Nothing is lost — both sections are named on the line — and no
  // word is deleted, which is the rule the collapse fix established.
  const { text } = convert(
    "// contract/grammar.md:5 and later :5-10 as well.\n",
  );
  assert.equal(
    text,
    "// contract/grammar.md#ebnf-notation and later contract/grammar.md#expressions-and-calls as well.\n",
  );
});

test("a citation that names no real text is REFUSED, not given an anchor it would keep forever", () => {
  // A stale or malformed citation: past end-of-file, before line 1, or a range that ends before it
  // starts. Converting one would invent an anchor that RESOLVES, so the breakage would become
  // permanent and invisible — exactly the trade this saga must not make by accident. The old gate
  // caught these; with the line form rejected outright it has no caller, so the converter carries it.
  assert.deepEqual(contentBounds({ start: 99 }, GRAMMAR_LINES), {
    start: 99,
    end: 99,
    allBlank: true,
  });
  for (const [citation, why] of [
    ["contract/grammar.md:99", "past end-of-file"],
    ["contract/grammar.md:5-99", "a range whose end is past end-of-file"],
    ["contract/grammar.md:10-5", "an inverted range"],
    ["contract/grammar.md:0", "before line 1"],
  ]) {
    const { plan, text } = convert(`// ${citation} is cited here.\n`);
    assert.equal(plan.problems.length, 1, why);
    assert.equal(plan.problems[0].kind, "unusable-range", why);
    assert.match(plan.problems[0].detail, /already broken/, why);
    assert.equal(text, `// ${citation} is cited here.\n`, why);
  }
});

test("a bare reference carrying a comma tail agrees with the gate, site for site", () => {
  // `collectCitations` records a bare reference and each comma-appended line in its tail as separate
  // citations. Counting the token once instead made every bare tail look like a disagreement, and
  // the cross-check then refused a file that was perfectly convertible — an enumeration guard
  // firing on its own arithmetic rather than on either sweep being blind.
  const { plan, text } = convert(
    "// contract/grammar.md and later :5,13 both matter.\n",
  );
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.sites, 2);
  assert.equal(
    text,
    "// contract/grammar.md and later contract/grammar.md#ebnf-notation, contract/grammar.md#debug both matter.\n",
  );
});

test("a mention with no line spec and no fragment is left exactly as written", () => {
  const { plan, text } = convert("// contract/grammar.md is the document.\n");
  assert.equal(plan.sites, 0);
  assert.deepEqual(plan.edits, []);
  assert.equal(text, "// contract/grammar.md is the document.\n");
});

// --- planFile: what it REFUSES -------------------------------------------------------------------

test("a citation hard-wrapped across a line break is REFUSED, not half-converted", () => {
  // Both instruments stop at the wrap, so the claim is already half-invisible — and converting only
  // the visible half strands the remainder against the new anchor. The converter refuses rather than
  // guessing: the hyphen form is one range split in two, the comma form is two separate claims, and
  // nothing on the line says which.
  for (const [dangling, second] of [
    ["-", " * 10`, issue #234)?"],
    [",", " * 10): the same word"],
  ]) {
    const { plan } = convert(
      [` * (\`contract/grammar.md:5${dangling}`, second, ""].join("\n"),
    );
    const wrapped = plan.problems.find(
      (problem) => problem.kind === "wrapped-citation",
    );
    assert.ok(
      wrapped !== undefined,
      `a dangling "${dangling}" must be refused`,
    );
    assert.match(wrapped.detail, /unwrap it onto one line/);
    assert.equal(wrapped.site, "a.ts:1");
    // Refusing mid-line leaves the converter's own count short of the gate's, and it says so rather
    // than rewriting a file the two instruments enumerated differently.
    assert.ok(
      plan.problems.some(
        (problem) => problem.kind === "enumeration-disagreement",
      ),
    );
    assert.deepEqual(plan.edits, [], "and nothing is rewritten");
  }
});

test("a trailing comma that is ordinary prose is NOT mistaken for a wrap", () => {
  // The far commoner shape: a comma ending a wrapped prose list, or a range followed by prose. The
  // next line must genuinely begin with a digit, or refusing these would stall a sweep on sites that
  // convert perfectly well.
  for (const second of [
    "// `bk`, `lt` and the rest are Heritage.",
    "// issue #99) covers the remainder.",
  ]) {
    const { plan, text } = convert(
      ["// see contract/grammar.md:5,", second, ""].join("\n"),
    );
    assert.deepEqual(plan.problems, [], second);
    assert.match(text, /#ebnf-notation/);
  }
  // And a citation on the LAST line of a file has no next line at all, which must read as "no
  // continuation" rather than throwing or guessing.
  const last = convert("// see contract/grammar.md:5,");
  assert.deepEqual(last.plan.problems, []);
  assert.match(last.text, /#ebnf-notation/);
});

test("a bare `#` names no fragment, so it seeds nothing and blocks no later anchor", () => {
  // A mention whose `#` carries no slug is unresolvable as written; it must not be entered into the
  // set of anchors already on the line, or it would suppress a perfectly good conversion beside it.
  const { plan, text } = convert(
    "// contract/grammar.md# and contract/grammar.md:14 here.\n",
  );
  assert.deepEqual(plan.problems, []);
  assert.equal(
    text,
    "// contract/grammar.md# and contract/grammar.md#debug here.\n",
  );
});

test("a bare reference the gate attributes to nothing is reported, never guessed at", () => {
  const { plan } = convert("// :77 comes before this file names anything.\n");
  assert.deepEqual(
    plan.problems.map((problem) => problem.kind),
    ["unattributed-bare"],
  );
  assert.match(plan.problems[0].detail, /the gate attributes no document/);
  assert.equal(
    plan.problems[0].context,
    "// :77 comes before this file names anything.",
  );
});

test("a citation of a document that does not exist is reported, because it publishes no headings", () => {
  const { plan, text } = convert("// contract/absent.md:5 names nothing.\n");
  assert.deepEqual(
    plan.problems.map((problem) => problem.kind),
    ["missing-document"],
  );
  assert.match(
    plan.problems[0].detail,
    /does not exist, so it publishes no headings/,
  );
  assert.equal(text, "// contract/absent.md:5 names nothing.\n");
});

test("a citation landing on a blank line ON A SECTION BOUNDARY is refused for a human", () => {
  // The span rule's escalation path. Line 7 of the fixture is the blank separator closing
  // #ebnf-notation, so the section above it and the text below it are equally defensible and both
  // anchors would RESOLVE. The converter refuses rather than picking one, because a wrong anchor
  // that resolves is permanent and silent — nothing downstream can catch it.
  const { plan, text } = convert("// contract/grammar.md:7 is cited here.\n");
  assert.deepEqual(
    plan.problems.map((problem) => problem.kind),
    ["blank-range"],
  );
  assert.match(
    plan.problems[0].detail,
    /is blank and sits on a section boundary, so the section above it and the text below it are equally defensible — decide by hand/,
  );
  assert.deepEqual(plan.edits, [], "and nothing is rewritten");
  assert.equal(text, "// contract/grammar.md:7 is cited here.\n");

  // A blank line INSIDE a section is not ambiguous, so it converts without a murmur.
  const inside = convert("// contract/grammar.md:13 is cited here.\n");
  assert.deepEqual(inside.plan.problems, []);
  assert.equal(inside.text, "// contract/grammar.md#debug is cited here.\n");
});

test("a line with no citable enclosing heading is reported rather than pointed at `#`", () => {
  const nameless = documentHeadings(["## ![alt](x.png)", "", "text"]);
  const plan = planFile(
    "a.ts",
    "// contract/nameless.md:3 is inside a heading that publishes no slug.\n",
    CONTRACT,
    () => nameless,
  );
  assert.deepEqual(
    plan.problems.map((problem) => problem.kind),
    ["no-usable-heading"],
  );
  assert.match(
    plan.problems[0].detail,
    /no enclosing heading that publishes a slug/,
  );
  assert.deepEqual(plan.edits, []);
});

test("the two enumerations are cross-checked BEFORE anything is rewritten", () => {
  // The safety that matters, because neither instrument can vouch for itself. They are shaped
  // differently on purpose — the gate sweeps the whole document with one pattern, this module works
  // per line — so a disagreement means one of them is blind, and rewriting a file the two had
  // enumerated differently would be exactly the instrument that reports success while measuring
  // something else.
  const agreeing = convert("// contract/grammar.md:5 and :10 both.\n").plan;
  assert.deepEqual(agreeing.problems, []);
  assert.equal(agreeing.sites, 2);
  assert.ok(agreeing.edits.length > 0);

  const disagreeing = convert(
    ["// contract/grammar.md:5,", "// 10 continues here", ""].join("\n"),
  ).plan;
  const mismatch = disagreeing.problems.find(
    (problem) => problem.kind === "enumeration-disagreement",
  );
  assert.ok(mismatch !== undefined);
  assert.match(
    mismatch.detail,
    /this module found \d+ site\(s\); the gate found \d+/,
  );
  assert.deepEqual(disagreeing.edits, []);
  assert.deepEqual(disagreeing.produced, []);
  assert.equal(disagreeing.collapsed, 0);
  assert.equal(disagreeing.spanning, 0);
});

test("a continuation the gate cannot see is converted and counted apart, so the check stays comparable", () => {
  // `/:301` is a line claim the gate's bare-reference lookbehind excludes. Ignoring it would strand a
  // stale line spec beside a freshly written anchor; counting it as a gate-visible site would make
  // the cross-check fire on every file that has one.
  const { plan, text } = convert("// contract/grammar.md:5/:10 both.\n");
  assert.deepEqual(plan.problems, [], "the cross-check must still agree");
  assert.equal(plan.sites, 1, "one site to the gate");
  assert.equal(plan.invisible, 1, "plus one it cannot see");
  assert.equal(
    text,
    "// contract/grammar.md#ebnf-notation, contract/grammar.md#expressions-and-calls both.\n",
  );
});

// --- convertTree: the whole-tree driver ----------------------------------------------------------

/** Run the converter over the temp tree. */
function runTree(options = {}) {
  return convertTree({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
    ...options,
  });
}

test("a dry run reports exactly what a sweep would do, and writes nothing", () => {
  write(`${CONTRACT}/grammar.md`, GRAMMAR);
  const source =
    "// See (contract/grammar.md:14, contract/grammar.md:15) for it.\n";
  write("cite.ts", source);
  const dry = runTree();
  assert.equal(dry.filesScanned, 1);
  assert.equal(dry.filesChanged, 1);
  assert.equal(dry.sites, 2);
  assert.equal(dry.anchors, 1, "the two collapse into one anchor");
  assert.equal(dry.collapsed, 1);
  assert.deepEqual(dry.problems, []);
  assert.equal(
    readFileSync(join(TEMP_DIR, "cite.ts"), "utf8"),
    source,
    "a dry run must not touch the tree",
  );

  // And the sweep that follows must reproduce those numbers exactly.
  const wet = runTree({ write: true });
  assert.equal(wet.sites, dry.sites);
  assert.equal(wet.anchors, dry.anchors);
  assert.deepEqual(wet.changed, dry.changed);
  assert.equal(
    readFileSync(join(TEMP_DIR, "cite.ts"), "utf8"),
    "// See (contract/grammar.md#debug) for it.\n",
  );
  // Re-running over a converted tree is a no-op, which is what "the sweep is finished" means.
  const again = runTree({ write: true });
  assert.equal(again.sites, 0);
  assert.equal(again.filesChanged, 0);
});

test("the tree walk skips what cannot carry a citation, and counts only what can", () => {
  write(`${CONTRACT}/grammar.md`, GRAMMAR);
  write("cited.ts", "// contract/grammar.md:5 is cited.\n");
  write("silent.ts", "// this file names no document at all\n");
  write(
    "mentions.ts",
    "// contract/grammar.md is mentioned but no line named\n",
  );
  writeFileSync(join(TEMP_DIR, "blob.bin"), Buffer.from([0x00, 0x01]));
  const report = runTree();
  assert.equal(report.filesScanned, 1, "only the file with sites is scanned");
  assert.equal(report.filesChanged, 1);
  assert.deepEqual(
    report.changed.map((path) => path.split("/").at(-1)),
    ["cited.ts"],
  );
});

test("a document that cannot be read publishes no headings, once, for the whole tree", () => {
  // The heading cache must also cache the FAILURE, or a missing document is re-read for every
  // citation of it — and the report has to name the problem rather than convert around it.
  write("one.ts", "// contract/absent.md:5 names nothing.\n");
  write("two.ts", "// contract/absent.md:6 names nothing either.\n");
  const report = runTree();
  assert.equal(report.problems.length, 2);
  assert.ok(
    report.problems.every((problem) => problem.kind === "missing-document"),
  );
  assert.equal(report.filesChanged, 0);
});

test("specRoot defaults to the directory citations name, which is the production configuration", () => {
  // Without an override the token a citation carries IS the directory the reader opens, so a tree
  // whose documents live elsewhere reports them missing rather than silently resolving something.
  write("cite.ts", "// contract/grammar.md:5 is cited.\n");
  const report = convertTree({ roots: [TEMP_DIR], specDirectory: CONTRACT });
  assert.deepEqual(
    report.problems.map((problem) => problem.kind),
    ["missing-document"],
  );
});

// Unit + regression tests for the spec-citation DoD gate (issue #934, rewritten for saga #1180).
// These import scripts/spec-citations-gate.mjs's logic directly (for 100% coverage) plus subprocess
// tests for the CLI shell (scripts/check-spec-citations.mjs), pointed at isolated temp fixtures via
// --root/--spec-dir/--spec-root rather than the real corpus.
//
// Fixtures name a `contract/` directory, never the real specification directory, and this file never
// writes that directory's name as a literal. That is deliberate twice over: the gate scans this file
// in CI, so a deliberately-broken fixture citation written with the real prefix would be
// indistinguishable from a real defect — and because the file never contains the real prefix, the
// gate skips it for citations entirely, so a bare colon-and-number inside a comment here can never be
// read as a citation either. Two sessions in this saga were bitten by exactly that.
//
// The MUTATION block near the end is the gate's own proof that it can go red — the same discipline as
// tests/conformance/_harness-selftest/, whose fixtures deliberately declare expect: "mismatch". A
// gate that passes on deliberately broken input asserts nothing, which #934 records as the single
// most repeated defect in this saga. Every way this gate is supposed to fail therefore has a test
// that corrupts a known-good citation and asserts it actually fails — including the hard case, where
// the mutation repoints a citation at a DIFFERENT section that still resolves.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { slug } from "github-slugger";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  SPEC_DIRECTORY,
  STATUS_CLAIM_EXEMPT_PREFIX,
  STATUS_CLAIM_PHRASES,
  auditRunQuotations,
  closestHeadingSlug,
  collectCitations,
  collectStatusClaims,
  decodeEntities,
  documentHeadings,
  editDistance,
  enclosingSlug,
  expandCommaTail,
  flattenProseRun,
  formatAnchor,
  formatCitation,
  isProseLine,
  lineLookup,
  linkDestinations,
  listCitationFiles,
  normalizeQuotation,
  parseArgs,
  proseRuns,
  quotationIsPresent,
  readTextFile,
  rejoinedFragment,
  resolveAnchor,
  runSpecCitationsGate,
  sectionRange,
  SLUG_CHARACTER,
  specDocuments,
  splitLines,
  suggestionDistance,
  toPosixPath,
  unambiguousSpecDocuments,
  unsupportedConstructs,
  walkFiles,
} from "./spec-citations-gate.mjs";

/** The directory name fixtures cite, chosen so it shares no substring with the real one. */
const CONTRACT = "contract";

let TEMP_DIR;

beforeEach(() => {
  TEMP_DIR = mkdtempSync(join(tmpdir(), "ol-citation-gate-"));
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

/** The repository-relative key a file written by {@link write} is reported under. */
function keyFor(name) {
  return `${toPosixPath(TEMP_DIR)}/${name}`;
}

/** Run the gate over the whole temp tree. */
function runOverTemp() {
  return runSpecCitationsGate({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
  });
}

/**
 * A small grammar document with two sibling sections, so one fixture serves both halves of the rule:
 * a line citation names a line inside a known section (and must be rejected naming that section),
 * and an anchor names the section itself (and must resolve).
 */
const GRAMMAR = [
  "# Grammar", // 1
  "", // 2
  "## EBNF notation", // 3
  "", // 4
  "```ebnf", // 5
  'colon-place         ::= ":" name { postfix }', // 6
  'postfix             ::= selector | "." identifier', // 7
  'selector            ::= "[" key-term "]"', // 8
  "```", // 9
  "", // 10
  "## Expressions and calls", // 11
  "", // 12
  "comparison          ::= additive { compare-op additive }", // 13
  "", // 14
  "Prose after the block.", // 15
].join("\n");

/** Write the grammar fixture and return its citable name. */
function writeGrammar() {
  write(`${CONTRACT}/syntax-rules.md`, GRAMMAR);
  return `${CONTRACT}/syntax-rules.md`;
}

test("toPosixPath, splitLines and formatCitation render the shapes a failure names", () => {
  assert.equal(toPosixPath(join("a", "b", "c.md")), "a/b/c.md");
  assert.deepEqual(splitLines("a\r\nb\nc"), ["a\r", "b", "c"]);
  // formatCitation survives the form's rejection because a rejection has to name the site precisely
  // enough for the author to find it. It renders the CANONICAL form from the parsed document and
  // line numbers, which is not always the source text: a bare token and a comma tail are rendered
  // rather than echoed, and a line number written with a leading zero comes back without it.
  assert.equal(
    formatCitation({ specDirectory: "s", file: "g.md", start: 4 }),
    "s/g.md:4",
  );
  assert.equal(
    formatCitation({ specDirectory: "s", file: "g.md", start: 4, end: 6 }),
    "s/g.md:4-6",
  );
  assert.equal(SPEC_DIRECTORY, "spec");
});

test("splitLines keeps a CRLF line's byte count, so offsets never drift", () => {
  // Splitting on /\r?\n/ and then measuring offsets against the original text loses one byte per
  // line, which silently reports every citation in a CRLF working tree on the wrong line.
  const text = "alpha\r\nbeta\r\ngamma";
  const lines = splitLines(text);
  const at = lineLookup(lines);
  assert.equal(at(0), 1);
  assert.equal(at(text.indexOf("beta")), 2);
  assert.equal(at(text.indexOf("gamma")), 3);
});

test("isProseLine admits comments in source, # in .logo, and everything in prose files", () => {
  assert.equal(isProseLine("a.ts", ""), false);
  assert.equal(isProseLine("a.ts", "   "), false);
  assert.equal(isProseLine("a.ts", "// a comment"), true);
  assert.equal(isProseLine("a.ts", " * a jsdoc body"), true);
  assert.equal(isProseLine("a.ts", "/* opener"), true);
  assert.equal(isProseLine("a.ts", "const ratio = x / y;"), false);
  // Pins the shape the module's note names: a template literal closing with a brace immediately
  // before a colon and a digit is live code, so it is never offered as a citation. Written as a
  // template literal with an escaped placeholder so the fixture holds the real characters.
  assert.equal(
    isProseLine("a.ts", `  return \`\${ratio.toFixed(2)}:1\`;`),
    false,
  );
  assert.equal(isProseLine("a.mjs", "// note"), true);
  assert.equal(isProseLine("f.logo", "# note"), true);
  assert.equal(isProseLine("f.logo", "forward 10"), false);
  assert.equal(isProseLine("f.md", "any prose"), true);
});

test("proseRuns groups contiguous prose and gives non-prose lines no run", () => {
  const lines = ["// one", "// two", "const x = 1;", "// three"];
  assert.deepEqual(proseRuns("a.ts", lines), [0, 1, 1, 0, 2]);
});

test("expandCommaTail enumerates the form neither an anchor nor a bare reference matches", () => {
  assert.deepEqual(expandCommaTail(undefined), []);
  assert.deepEqual(expandCommaTail(",139"), [{ start: 139, end: undefined }]);
  assert.deepEqual(expandCommaTail(",139,142-145"), [
    { start: 139, end: undefined },
    { start: 142, end: 145 },
  ]);
});

test("collectCitations still enumerates every line form, because rejecting one means finding it", () => {
  // Enumeration is unchanged by #1180 and must stay that way: the gate can only reject a form it can
  // see, so a sweep that quietly stopped finding comma tails or bare references would turn the
  // strictest possible rule into a green run over citations nobody looked at.
  const text = [
    "// see contract/syntax-rules.md:4-6,9 and also :5 for the postfix rule",
    "// and contract/other.md then :7 is listed against both of them",
  ].join("\n");
  const { citations } = collectCitations("a.ts", text, CONTRACT);
  assert.deepEqual(
    citations.map((citation) => `${citation.start}:${citation.form}`),
    ["4:explicit", "9:comma-tail", "5:bare", "7:bare"],
  );
});

test("a bare reference names the file's candidate documents, and does not choose between them", () => {
  // This replaced four rounds of attribution machinery — a back-reference map, a position-tested
  // prefix, a nearest-mention loop, and inferred citations promoted into back-reference sources.
  // Each fixed a real defect and introduced the next, and the measurement that ended it is that
  // NONE of them could change a verdict: a bare token in a file naming a spec document is rejected,
  // and so was one that could not be attributed. Attribution only chose the wording.
  //
  // So the gate no longer chooses. It reports every document the file names, which cannot be wrong
  // in the way picking one was.
  const text = [
    "// contract/syntax-rules.md:408 makes profile words built-in names.",
    "// Painting is contract/tooling.md:30's keyword row.",
    "// Issue #855 aligned the rest of the contract with the :408 ruling.",
  ].join("\n");
  const { citations } = collectCitations("a.ts", text, CONTRACT);
  const bare = citations.find((citation) => citation.form === "bare");
  assert.equal(bare.start, 408);
  assert.deepEqual(bare.candidates, ["syntax-rules.md", "tooling.md"]);
});

test("a file naming exactly one document still gets a fully specific rejection", () => {
  // A file naming exactly ONE specification document has nothing to choose between, so the message
  // loses nothing by not choosing.
  const text = [
    "// contract/syntax-rules.md:12 introduces the production.",
    "// The :12 ruling is what the reader implements.",
  ].join("\n");
  const { citations } = collectCitations("a.ts", text, CONTRACT);
  const bare = citations.find((citation) => citation.form === "bare");
  assert.deepEqual(bare.candidates, ["syntax-rules.md"]);
  assert.equal(bare.file, "syntax-rules.md");
});

test("a mixed-order file yields the same candidate set as any other ordering", () => {
  // This used to assert "a later mention never wins", which was a property of the nearest-mention
  // selection that no longer exists — and a reviewer showed the fixture passed only because `a.md`
  // sorts before `b.md`, so it would not have caught a position regression anyway. A test that
  // passes coincidentally is worse than no test.
  //
  // What it pins now is the surviving property, with names chosen so alphabetical and positional
  // order disagree: every document the file names is listed, whatever order they appear in.
  const mixed = collectCitations(
    `${CONTRACT}/current.md`,
    [
      `${CONTRACT}/zeta.md#old`,
      "mid.md#right",
      ":10",
      `${CONTRACT}/alpha.md#future`,
    ].join("\n"),
    CONTRACT,
    new Set(["alpha.md", "mid.md", "zeta.md"]),
  );
  const resolved = mixed.citations.find((citation) => citation.line === 3);
  assert.deepEqual(resolved.candidates, ["alpha.md", "mid.md", "zeta.md"]);
});

test("every attributable prefix-less form is a mention, whatever its disposition", () => {
  // Naming a document and being REPORTED for it are different things. A permitted sibling anchor is
  // not reported, an unprefixed anchor outside the directory is, and a line form is rejected — but
  // all three name a document, so all three belong in the candidate set a bare token is listed
  // against.
  //
  // (a) A prefix-less LINE citation puts its document in the set, so the bare token elsewhere in the
  // file is listed against it.
  const afterLine = collectCitations(
    `${CONTRACT}/current.md`,
    "a.md:7\n:10",
    CONTRACT,
    new Set(["a.md"]),
  );
  assert.deepEqual(
    afterLine.citations.map((citation) => `${citation.file}:${citation.start}`),
    ["a.md:7", "a.md:10"],
  );
  assert.deepEqual(afterLine.unprefixedAnchors, []);

  // (b) OUTSIDE the specification directory an unprefixed anchor is reported AND enters the set,
  // rather than being reported while the bare token elsewhere in the file vanishes from every
  // bucket.
  const outside = collectCitations(
    "packages/x.ts",
    "// a.md#heading\n// :10",
    CONTRACT,
    new Set(["a.md"]),
  );
  assert.equal(outside.unprefixedAnchors.length, 1);
  assert.deepEqual(
    outside.citations.map((citation) => `${citation.file}:${citation.start}`),
    ["a.md:10"],
  );
});

test("the candidate set is CANONICAL over the file: relative mention order cannot change it", () => {
  // Narrower than the name it replaced. "ORDER NO LONGER MATTERS" was too broad and a reviewer was
  // right to say so: `collectCitations` output still depends on position in other ways — a token
  // lexically inside a mention is a different form, and the quotation failure joins sections in
  // anchor order. A test name is an assertion like any other, and an overbroad one is a false claim
  // in the place people trust most.
  //
  // What IS true, and is what the deletion bought: relative mention order cannot affect a bare
  // token's candidate set or its verdict, because the candidates are a sorted Set over the whole
  // file and nothing downstream consults position.
  const before = collectCitations(
    "a.ts",
    [
      "// :77 appears first",
      `// ${CONTRACT}/syntax-rules.md:77 only later`,
    ].join("\n"),
    CONTRACT,
  );
  const after = collectCitations(
    "a.ts",
    [`// ${CONTRACT}/syntax-rules.md:77 first`, "// :77 appears later"].join(
      "\n",
    ),
    CONTRACT,
  );
  const bareOf = (result) =>
    result.citations.find((citation) => citation.form === "bare");
  assert.deepEqual(bareOf(before).candidates, ["syntax-rules.md"]);
  assert.deepEqual(bareOf(after).candidates, ["syntax-rules.md"]);
  // In a file that names a document, a bare token is always a citation — there is no longer a
  // second disposition for one that "nothing attributes".
  assert.equal(before.citations.length, after.citations.length);

  // And a file naming several documents lists them, in a stable order, wherever the token sits.
  // Asserted with names whose ALPHABETICAL order differs from their positional order, so the test
  // cannot pass by coincidence the way an `a.md`/`b.md` fixture would — a reviewer showed the
  // previous fixture would not have caught a position regression at all.
  const several = collectCitations(
    "a.ts",
    [
      `// ${CONTRACT}/zeta.md:10`,
      `// ${CONTRACT}/mid.md#context`,
      "// :10",
      `// ${CONTRACT}/alpha.md:10`,
    ].join("\n"),
    CONTRACT,
    new Set(["alpha.md", "mid.md", "zeta.md"]),
  );
  assert.deepEqual(bareOf(several).candidates, [
    "alpha.md",
    "mid.md",
    "zeta.md",
  ]);
});

test("THE RENDERED MESSAGE lists candidates, and never invents a citation the author did not write", () => {
  // The gap that hid a real defect for a whole round: every test asserted `bare.candidates` as an
  // internal field, and none asserted what a contributor actually reads. The enumerator stopped
  // choosing while the reporting layer went on choosing — ALPHABETICALLY — so the gate quoted back
  // `<dir>/<first>.md:4`, a citation nobody wrote, and pointed at that document's section. Wrong
  // remediation, not vague remediation. Three reviewers caught it independently.
  //
  // 100% coverage cannot catch this: `candidates` was assigned on a covered line and never read.
  // Dead DATA is invisible to an instrument that measures executed code.
  writeGrammar();
  write(`${CONTRACT}/zeta.md`, "# Zeta\n\n## Other section\n\ntext\n");
  write(
    "multi.ts",
    [
      `// ${CONTRACT}/zeta.md:4 establishes the ruling.`,
      `// ${CONTRACT}/syntax-rules.md#ebnf-notation discusses something else.`,
      "// The :4 ruling is the one above.",
    ].join("\n"),
  );
  const message = runOverTemp().lines.join("\n");
  // The subject keeps the bare SHAPE and names no document — it is rendered from the parsed line
  // number, not echoed, so it is not the source text either…
  assert.match(message, /multi\.ts:3: :4 names a LINE/);
  // …both documents listed, in a stable order…
  assert.match(
    message,
    /this file names contract\/syntax-rules\.md, contract\/zeta\.md/,
  );
  // …and NO section suggested, because choosing one would be inventing an answer. Keyed on any
  // anchor on the rejection line rather than one candidate's slug: three reviewers showed the
  // narrow form stayed green while a mutation appended the ALPHABETICALLY FIRST candidate's
  // section, which is the arbitrary choice the deleted machinery was deleted for.
  const multiLine = message
    .split("\n")
    .find((line) => line.includes("multi.ts:3:"));
  assert.doesNotMatch(multiLine, /\.md#/);
  // And the alphabetically-first document is not presented as the citation's own.
  assert.doesNotMatch(message, /multi\.ts:3: contract\/syntax-rules\.md:4/);
});

test("a bare token in a SINGLE-document file keeps its fully specific remediation", () => {
  // Listing costs a single-document file nothing: one candidate means the gate still names the
  // document and the exact section to write.
  writeGrammar();
  write(
    "single.ts",
    [
      `// ${CONTRACT}/syntax-rules.md:4 establishes the ruling.`,
      "// The :4 ruling is the one above.",
    ].join("\n"),
  );
  const message = runOverTemp().lines.join("\n");
  assert.match(
    message,
    /single\.ts:2: contract\/syntax-rules\.md:4 names a LINE/,
  );
  assert.match(
    message,
    /Cite the section instead — contract\/syntax-rules\.md#/,
  );
});

test("a permitted sibling anchor inside the spec directory still names a document", () => {
  // Inside the specification directory a relative anchor is the normal way one document links to
  // another, so it is not reported — but it still NAMES a document. The early return keyed on
  // prefixed mentions alone, so a bare line claim written under such a link was never scanned.
  const sibling = collectCitations(
    `${CONTRACT}/current.md`,
    "a.md#heading\n:10",
    CONTRACT,
    new Set(["a.md"]),
  );
  assert.deepEqual(
    sibling.citations.map((citation) => `${citation.file}:${citation.start}`),
    ["a.md:10"],
  );
  // …and the anchor itself is still not reported, because it is permitted there.
  assert.deepEqual(sibling.unprefixedAnchors, []);
});

test("a Markdown link destination does not suppress the line claim after it", () => {
  // A closing square bracket was once excluded by the bare lookbehind, on the assumption that an
  // index closer needed it. It was never load-bearing — every interpolated shape ends in a brace —
  // and it silently dropped a line claim written after a bracketed link destination.
  const bracketed = collectCitations(
    "a.md",
    `[${CONTRACT}/a.md#heading]:10`,
    CONTRACT,
    new Set(["a.md"]),
  );
  assert.deepEqual(
    bracketed.citations.map((citation) => `${citation.file}:${citation.start}`),
    ["a.md:10"],
  );
});

test("a bare reference is enumerated in live code, wherever it sits in the file", () => {
  // The prose guard is gone, and so is the `unattributed` bucket. In a file that names a
  // specification document, every bare colon-and-number is a citation and is rejected — there is no
  // longer a disposition where one is reported but not counted as a line claim, because both
  // dispositions always failed and the distinction only ever changed the wording.
  //
  // A ratio rendered with a trailing colon-and-digit therefore surfaces as a citation. That is the
  // honest outcome: it is why the one real site of that shape was reworded at the site rather than
  // excused in the enumerator, and there is no exceptions file to put an excuse in.
  const text = [
    "const label = formatRatio(value) + ':1 contrast';",
    "// :77 appears before this file names any document",
    "// contract/syntax-rules.md:4 is the first mention",
  ].join("\n");
  const { citations } = collectCitations("a.ts", text, CONTRACT);
  assert.deepEqual(
    citations.map((citation) => citation.start).sort((a, b) => a - b),
    [1, 4, 77],
  );
});

test("collectCitations returns nothing for a file that names no document", () => {
  const { citations } = collectCitations(
    "a.ts",
    "// nothing here, not even a bare :12",
    CONTRACT,
  );
  assert.deepEqual(citations, []);
});

test("enclosingSlug names the section a line sits in, and the boundary is exact", () => {
  // This is what a rejection tells the author to write instead, so its boundary is the difference
  // between a useful failure and one that sends them to the wrong section.
  const headings = documentHeadings(splitLines(GRAMMAR));
  assert.equal(enclosingSlug(headings, 1), "grammar");
  assert.equal(enclosingSlug(headings, 2), "grammar");
  // The line a heading is ON belongs to that heading; the line above it to the previous one.
  assert.equal(enclosingSlug(headings, 3), "ebnf-notation");
  assert.equal(enclosingSlug(headings, 10), "ebnf-notation");
  assert.equal(enclosingSlug(headings, 11), "expressions-and-calls");
  assert.equal(enclosingSlug(headings, 15), "expressions-and-calls");
  // A line before every heading has no enclosing section, and a heading publishing no slug cannot
  // be suggested — both report `null` so the caller falls back to a placeholder rather than
  // suggesting an anchor nobody can follow.
  assert.equal(enclosingSlug(documentHeadings(["text", "more"]), 1), null);
  assert.equal(enclosingSlug(documentHeadings(["## ![a](x.png)"]), 1), null);
});

test("sectionRange ends a section at the next heading of its own level or shallower", () => {
  const headings = documentHeadings(splitLines(GRAMMAR));
  // A section's EXTENT is what the quotation check measures against, so its end matters as much as
  // its start. `depth` went missing from documentHeadings once, which made every comparison here
  // `undefined <= undefined` and every section run silently to end-of-file — a check accepting a
  // production quoted anywhere BELOW the cited heading while reporting that it had checked the
  // section. Both ends are therefore pinned, and `depth` is asserted directly.
  assert.deepEqual(
    headings.map(({ slug, depth }) => `${slug}:${depth}`),
    ["grammar:1", "ebnf-notation:2", "expressions-and-calls:2"],
  );
  // Asserted directly as well, because the regression was silent: `depth` going missing made every
  // comparison below `undefined <= undefined`, which is false, so no range ever ended early.
  assert.ok(
    headings.every(({ depth }) => Number.isInteger(depth)),
    "every heading must carry its level",
  );
  // Depth 1 spans the whole document, including both depth-2 sections beneath it.
  assert.deepEqual(sectionRange(headings, "grammar", 15), {
    start: 1,
    end: 15,
  });
  // A depth-2 section stops at its depth-2 sibling, NOT at end-of-file.
  assert.deepEqual(sectionRange(headings, "ebnf-notation", 15), {
    start: 3,
    end: 10,
  });
  // The last section runs to the end because nothing follows it, which is the one case where
  // end-of-file is the right answer rather than the symptom of a missing depth.
  assert.deepEqual(sectionRange(headings, "expressions-and-calls", 15), {
    start: 11,
    end: 15,
  });
  assert.equal(sectionRange(headings, "not-a-heading", 15), null);
});

test("a section spans its NESTED subsections, which is what a reader means by a section", () => {
  // The other half of the rule, and the reason the comparison is `<=` rather than `<`: narrowing to
  // the next heading of ANY level would manufacture failures for accurate quotations sitting under
  // a sub-heading of the section cited.
  const nested = documentHeadings([
    "## Outer", // 1
    "", // 2
    "### Inner", // 3
    "", // 4
    "text", // 5
    "", // 6
    "## Sibling", // 7
  ]);
  assert.deepEqual(sectionRange(nested, "outer", 7), { start: 1, end: 6 });
  assert.deepEqual(sectionRange(nested, "inner", 7), { start: 3, end: 6 });
});

test("quotationIsPresent honours an author's ellipsis without consulting anything uncited", () => {
  assert.equal(quotationIsPresent("a b c", "x a b c y"), true);
  assert.equal(quotationIsPresent("a b c", "x a b y"), false);
  assert.equal(
    quotationIsPresent(
      "primary ::= … | fixed-call",
      "primary ::= x | fixed-call",
    ),
    true,
  );
  assert.equal(quotationIsPresent("... trailing", "and trailing"), true);
  assert.equal(quotationIsPresent("a … b", "b then a"), false);
  assert.equal(normalizeQuotation(" a  **b**  `c` "), "a b c");
});

test("flattenProseRun strips comment markers so a wrapped quotation reads as one line", () => {
  const { text, offsets } = flattenProseRun([
    { line: 7, text: " * contract/syntax-rules.md#ebnf-notation's" },
    { line: 8, text: ' * `selector ::= "[" key-term "]"` production.' },
  ]);
  assert.equal(
    text,
    'contract/syntax-rules.md#ebnf-notation\'s `selector ::= "[" key-term "]"` production.',
  );
  // The offset is the length of the first flattened line plus the joining space, so it moves with
  // the fixture document's name; it is asserted rather than computed to keep the test a check on
  // `flattenProseRun` and not a restatement of it.
  assert.deepEqual(offsets[1], { offset: 41, line: 8 });
});

test("auditRunQuotations finds EBNF productions and reports the line each was written on", () => {
  // It no longer binds a production to the nearest mention. That binding existed to pick a LINE
  // RANGE, ranges are gone, and a value nothing reads is an instrument producing a number nobody
  // consults — so nothing binds a quotation to one mention at all now: the caller checks it against
  // every section the run cites.
  const found = auditRunQuotations([
    { line: 7, text: " * contract/syntax-rules.md#ebnf-notation defines" },
    { line: 8, text: ' * `selector ::= "[" key-term "]"` and nothing else.' },
  ]);
  assert.deepEqual(found, [
    { quotation: 'selector ::= "[" key-term "]"', line: 8 },
  ]);
  assert.deepEqual(Object.keys(found[0]).sort(), ["line", "quotation"]);

  // A backticked span that is not a production is not a quotation, whatever sits beside it.
  assert.deepEqual(
    auditRunQuotations([{ line: 1, text: "// `repeat 0 [ print 1 ]` runs" }]),
    [],
  );
  // A JSON fixture escapes the quotes inside its prose; that is the file format speaking, not the
  // author, so it is unescaped on the citing side before comparison.
  assert.deepEqual(
    auditRunQuotations([{ line: 3, text: '`a ::= \\"end\\"` closes it' }]),
    [{ quotation: 'a ::= "end"', line: 3 }],
  );
});

test("collectStatusClaims reports only prose claims, and only untracked ones", () => {
  const lines = [
    "// this is not yet implemented",
    "",
    "// a later slice will do it,",
    "// tracked by #123",
    "const message = 'not yet implemented';",
  ];
  const claims = collectStatusClaims(lines, proseRuns("a.ts", lines));
  assert.deepEqual(claims, [
    { line: 1, phrase: "not yet implemented", tracked: false },
    // The issue sits on the NEXT line of the same comment block: a run is the unit of proximity, so
    // a claim and its tracking issue may be split by a line wrap.
    { line: 3, phrase: "a later slice will", tracked: true },
  ]);
  assert.deepEqual(
    collectStatusClaims(["// clean"], proseRuns("a.ts", ["// clean"])),
    [],
  );
  assert.ok(STATUS_CLAIM_PHRASES.includes("not yet implemented"));
});

test("nothing is excluded from the scan, and there is no mechanism to exclude anything", () => {
  // A gate that exempts itself from the rule it enforces asserts less than it appears to. The one
  // exclusion that ever existed was the exceptions manifest; saga #1180 deleted the manifest, which
  // left the mechanism without a caller — an option able to narrow a gate quietly — so the mechanism
  // went too. This is the behavioural form of that claim: the gate's own source and its own tests
  // are in the scanned set, and no option exists that could take them out.
  const tracked = listCitationFiles();
  assert.ok(tracked.includes("scripts/spec-citations-gate.mjs"));
  assert.ok(tracked.includes("scripts/spec-citations-gate.test.mjs"));
  assert.ok(tracked.includes("scripts/spec-citation-converter.mjs"));
  assert.deepEqual(
    Object.keys(parseArgs(["--exclusions=x", "--exceptions=y"])).sort(),
    ["roots", "specDirectory", "specRoot"],
  );
});

test("walkFiles sorts, descends, and skips build output and a root that is not there", () => {
  write("b.md", "b");
  write("a/inner.md", "inner");
  write("node_modules/pkg/index.js", "junk");
  const found = walkFiles([TEMP_DIR, join(TEMP_DIR, "missing")]);
  assert.deepEqual(found, [keyFor("a/inner.md"), keyFor("b.md")]);
});

test("listCitationFiles defaults to the tracked set and takes a walk when given roots", () => {
  assert.ok(listCitationFiles().includes("package.json"));
  write("only.md", "x");
  assert.deepEqual(listCitationFiles([TEMP_DIR]), [keyFor("only.md")]);
});

test("readTextFile returns text and refuses binary or unreadable paths", () => {
  write("text.md", "hello");
  assert.equal(readTextFile(join(TEMP_DIR, "text.md")), "hello");
  writeFileSync(join(TEMP_DIR, "blob.bin"), Buffer.from([0x01, 0x00, 0x02]));
  assert.equal(readTextFile(join(TEMP_DIR, "blob.bin")), null);
  // Tracked but unreadable — a sparse-checkout placeholder or a dangling symlink — must skip the
  // file rather than crash the whole scan.
  assert.equal(readTextFile(join(TEMP_DIR, "not-there.md")), null);
});

test("parseArgs reads every override and defaults the rest", () => {
  assert.deepEqual(parseArgs([]), {
    roots: undefined,
    specDirectory: undefined,
    specRoot: undefined,
  });
  assert.deepEqual(
    parseArgs([
      "--root=one",
      "--root=two",
      "--spec-dir=contract",
      "--spec-root=/tmp/contract",
      "--unrecognised",
    ]),
    {
      roots: ["one", "two"],
      specDirectory: "contract",
      specRoot: "/tmp/contract",
    },
  );
});

// --- The rule: a citation that names a line is REJECTED (saga #1180) ---------------------------

test("a tree of anchor citations passes, and the report states what it does not cover", () => {
  writeGrammar();
  write(
    "ok.ts",
    '// contract/syntax-rules.md#ebnf-notation\'s `selector ::= "[" key-term "]"` is the form.\n',
  );
  write("plain.md", "This mentions contract/ but cites nothing.\n");
  writeFileSync(join(TEMP_DIR, "blob.bin"), Buffer.from([0x00]));
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.failed, 0);
  assert.equal(result.counts.quotations, 1);
  const summary = result.lines.join("\n");
  // The headline claim, and the qualification it must always carry.
  assert.match(summary, /This gate REJECTS every citation that names a line/);
  assert.match(
    summary,
    /no exception manifest, no baseline and no\s+grandfathering/,
  );
  assert.match(
    summary,
    /rejection above is exhaustive over every spelling this gate can name/,
  );
  // And the bound is stated in both directions: a citation inside a string literal in live code is
  // the one shape the rule deliberately does not reach, so a green run must not be read as "no line
  // citation exists anywhere in the tree". That hole is now closed for the prefix-less LINE form.
  // Both halves are now reached in code as well as prose, so the statement must claim exhaustive
  // coverage over the spellings it can name — and must not go on advertising a hole that is closed.
  assert.match(
    summary,
    /BOTH are counted ANYWHERE, including\s+inside a string literal in live code/,
  );
  assert.match(summary, /there is no prose carve-out left/);
  assert.match(
    summary,
    /exhaustive over every spelling this gate can name, in prose\s+and in code alike/,
  );
  assert.doesNotMatch(summary, /one shape it deliberately does/);
  // An ambiguous basename is left alone rather than attributed to the specification.
  assert.match(summary, /an ambiguous one such as a README is left alone/);
  assert.match(summary, /does NOT prove the section supports the claim/);
  assert.match(summary, /wrong-passage and misstating-prose modes/);
  assert.match(summary, /names a heading that exists in the file it cites/);
  assert.doesNotMatch(summary, /passes unseen/);
  assert.doesNotMatch(summary, /not checked either/);
  // The canary's own limit is printed, not just commented. Since ADR-0035 the parser supplies block
  // structure and rendered text, so the statement names what it rests on rather than claiming an
  // incompleteness that no longer exists.
  assert.match(
    summary,
    /Headings come from a GFM parse and slugs from github-slugger/,
  );
  assert.doesNotMatch(summary, /INCOMPLETE for nested block structure/);
  // Nor may it overclaim in the other direction. Resolution proves a slug is CLAIMED, never that the
  // section the citation meant still claims it, and the statement has to say so — otherwise the green
  // signal certifies more than it checks, which is the failure this saga exists to reduce.
  assert.doesNotMatch(summary, /only the section anchor is durable/);
  assert.match(summary, /proves only that SOME heading claims that\s+slug/);
  assert.match(summary, /promotes a later one into\s+the slug it vacated/);
  assert.match(
    summary,
    /fails loudly only when the rename leaves its slug unclaimed/,
  );
  // And it must name ALL FOUR surviving refusals, not just the one. A coverage statement that
  // under-reports what the gate declines to answer is exactly the kind of unenforced assertion this
  // gate exists to stop.
  assert.match(
    summary,
    /an\s+entity reference outside the escaping set, raw inline HTML, an emoji shortcode shape, or a\s+numeric reference whose digit count CommonMark and GitHub's renderer disagree about/,
  );
  // And it must not claim those refusals are exact. Two of the four key on SHAPE, so a heading
  // GitHub would publish literally is refused as well — erring toward refusing loudly rather than
  // inventing a slug.
  assert.match(
    summary,
    /recognised by shape, so a construct GitHub would publish literally is\s+refused too/,
  );
  // The status-claim SCOPE is printed too. It is the one carve-out-shaped thing that survives, so a
  // run that did not say so would be quietly narrower than it reads.
  assert.match(
    summary,
    new RegExp(`does NOT apply under ${STATUS_CLAIM_EXEMPT_PREFIX}`),
  );
});

test("the coverage statement's account of a bare token matches what the gate renders", () => {
  // The coverage statement is printed on EVERY run and executed by every test, so 100% coverage
  // says nothing whatever about whether it is TRUE. It went stale exactly that way: for five review
  // rounds it described the attribution machinery that had been deleted, and five consecutive
  // reviewers each found a different subset of the stale sentences. The repair could have gone
  // stale again just as silently, because only an unchanged PREFIX of the statement was matched by
  // any assertion — the sentences that actually describe the rule were pinned by nothing.
  //
  // So this asserts the sentences AND the behaviour they describe, in one test, against fixtures
  // that render both dispositions. A future change to how a bare token is rejected now breaks a
  // test here rather than quietly making the printed self-description false.
  writeGrammar();
  write(`${CONTRACT}/zeta.md`, "# Zeta\n\n## Other section\n\ntext\n");

  // (a) A file naming SEVERAL documents: the bare token as its own subject, both listed, and NO
  // section suggested at all.
  write(
    "several.ts",
    [
      `// ${CONTRACT}/zeta.md:4 establishes the ruling.`,
      `// ${CONTRACT}/syntax-rules.md#ebnf-notation discusses something else.`,
      "// The :4 ruling is the one above.",
    ].join("\n"),
  );
  const several = runOverTemp();
  const severalReport = several.lines.join("\n");
  assert.match(severalReport, /several\.ts:3: :4 names a LINE/);
  assert.match(
    severalReport,
    /this file names contract\/syntax-rules\.md, contract\/zeta\.md/,
  );
  assert.match(
    severalReport,
    /write the full citation, naming the document AND its section/,
  );
  // "Suggests no section" means NO section, not "not that one document's section". Three reviewers
  // independently showed the narrower guard: keyed on one candidate's slug, it stayed green while a
  // mutation appended a section derived from the ALPHABETICALLY FIRST candidate — which is exactly
  // the arbitrary choice the deleted machinery was deleted for. So the guard is now any anchor at
  // all, on the rejection line itself: the whole report legitimately contains anchors elsewhere,
  // and matching on a bare `#` would hit the saga number the message ends with.
  const severalLine = severalReport
    .split("\n")
    .find((line) => line.includes("several.ts:3:"));
  assert.doesNotMatch(severalLine, /\.md#/);

  // (b) A file naming exactly ONE: rendered in full, with the section to write. The sole candidate
  // is deliberately the document that sorts LAST of the two the fixture tree publishes, so a rule
  // keyed on a candidate's IDENTITY rather than on the set's cardinality cannot pass here — a
  // reviewer made a member select the branch and watched an earlier version of this test stay
  // green, because its sole candidate happened to sort first.
  rmSync(join(TEMP_DIR, "several.ts"));
  write(
    "sole.ts",
    [
      `// ${CONTRACT}/zeta.md:4 establishes the ruling.`,
      "// The :4 ruling is the one above.",
    ].join("\n"),
  );
  const sole = runOverTemp();
  const soleReport = sole.lines.join("\n");
  assert.match(soleReport, /sole\.ts:2: contract\/zeta\.md:4 names a LINE/);
  assert.match(
    soleReport,
    /sole\.ts:2:.*Cite the section instead — contract\/zeta\.md#other-section/,
  );

  // (c) The statement says a bare token is a citation "before or after the mention". Both fixtures
  // above put it after, which is the one arrangement where a whole-file rule and a position rule
  // agree — so a reviewer reintroduced position-dependence and watched this test stay green. The
  // property is pinned by two other tests, but a test asserting that clause must exercise it.
  rmSync(join(TEMP_DIR, "sole.ts"));
  write(
    "above.ts",
    [
      "// The :4 ruling is the one below.",
      `// ${CONTRACT}/zeta.md:4 establishes the ruling.`,
      `// ${CONTRACT}/syntax-rules.md#ebnf-notation discusses something else.`,
    ].join("\n"),
  );
  const above = runOverTemp();
  const aboveReport = above.lines.join("\n");
  assert.match(aboveReport, /above\.ts:1: :4 names a LINE/);
  assert.match(
    aboveReport,
    /above\.ts:1:.*this file names contract\/syntax-rules\.md, contract\/zeta\.md/,
  );

  // (d) And the subject is RENDERED, never echoed — the one claim two reviewers reached from
  // opposite ends. A zero-padded line number written bare in a multi-document file keeps the bare
  // shape and loses the padding, and a comma continuation becomes a second site whose subject
  // carries a colon where the source wrote a comma. Padding is what makes this measurable: without
  // it the rendered form and the source text coincide and the test would assert nothing. The
  // padded RANGE is here because the sentence claims BOTH ends lose their padding, and that clause
  // reached three review rounds with nothing holding it — a mutation keeping the end's padding
  // stayed green while the start's was pinned.
  rmSync(join(TEMP_DIR, "above.ts"));
  write(
    "padded.ts",
    [
      `// ${CONTRACT}/zeta.md#other-section establishes the ruling.`,
      `// ${CONTRACT}/syntax-rules.md#ebnf-notation discusses something else.`,
      "// The :04,08 ruling is the one above.",
      "// The :04-09 range is the one above too.",
    ].join("\n"),
  );
  const padded = runOverTemp();
  const paddedReport = padded.lines.join("\n");
  assert.match(paddedReport, /padded\.ts:3: :4 names a LINE/);
  assert.match(paddedReport, /padded\.ts:3: :8 names a LINE/);
  assert.match(paddedReport, /padded\.ts:4: :4-9 names a LINE/);
  assert.doesNotMatch(paddedReport, /:04/);
  assert.doesNotMatch(paddedReport, /,08/);
  assert.doesNotMatch(paddedReport, /-09/);

  // And now the printed statement, which must describe exactly those renderings. The statement is
  // the last line of every report, green or red; take it from every run so none can drift.
  for (const statement of [
    several.lines.at(-1),
    sole.lines.at(-1),
    above.lines.at(-1),
    padded.lines.at(-1),
  ]) {
    assert.match(statement, /NO document is ever selected for it/);
    assert.match(
      statement,
      /it is listed against every document the file names/,
    );
    assert.match(
      statement,
      /The CARDINALITY of that list selects which rejection is rendered/,
    );
    assert.match(
      statement,
      /With SEVERAL, the subject names no document, every candidate is listed and NO section is suggested/,
    );
    assert.match(
      statement,
      /With EXACTLY ONE there is nothing to choose between, so the rejection renders the citation in full and names the section to write/,
    );
    // Cardinality picks the branch, but the members are not inert: they supply the listed names,
    // and a sole member also picks the document the suggested section is derived from. A reviewer
    // showed the earlier "members only supply the names" wording was false for exactly that reason.
    assert.match(
      statement,
      /Cardinality picks the branch; the members then supply the names listed in it, and a sole member also identifies the document whose headings that section comes from/,
    );
    // And it must not go back to describing the deleted machinery, in either of the two shapes that
    // survived a review round each: a document "attributed to" a bare token, and an unconditional
    // claim that the rejection lists rather than choosing.
    assert.doesNotMatch(statement, /attributed to a document/);
    assert.doesNotMatch(
      statement,
      /rejection LISTS every document the file names rather than choosing one/,
    );
  }
});

test("an explicit line citation is REJECTED, and the failure names the enclosing heading", () => {
  writeGrammar();
  write(
    "bad.ts",
    "// contract/syntax-rules.md:8 is where the selector production sits.\n",
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  const report = result.lines.join("\n");
  assert.match(report, /bad\.ts:1: contract\/syntax-rules\.md:8 names a LINE/);
  // The remedy is not generic advice: line 8 is inside the EBNF notation section, and that is the
  // anchor the author is told to write. A message naming `#a-heading` here would be useless exactly
  // when the gate has the answer.
  assert.match(
    report,
    /Cite the section instead — contract\/syntax-rules\.md#ebnf-notation \(ADR-0034\)/,
  );
  assert.match(
    report,
    /A heading does not move when text is inserted above it/,
  );
  assert.equal(result.counts.citations, 1);
  assert.equal(result.counts.explicit, 1);
  // Resolution is not consulted at all any more: line 8 holds real text and is still rejected.
  assert.doesNotMatch(report, /does not resolve/);
});

test("the enclosing heading a rejection names tracks the line, section by section", () => {
  writeGrammar();
  for (const [line, section] of [
    [1, "grammar"],
    [8, "ebnf-notation"],
    [13, "expressions-and-calls"],
  ]) {
    write("bad.ts", `// contract/syntax-rules.md:${line} is cited here.\n`);
    assert.match(
      runOverTemp().lines.join("\n"),
      new RegExp(
        `Cite the section instead — contract/syntax-rules\\.md#${section}`,
      ),
      `line ${line} belongs to #${section}`,
    );
  }
});

test("a rejection falls back to a placeholder when no heading can be named", () => {
  writeGrammar();
  // The document does not exist, so it publishes no headings and there is nothing to suggest.
  write(
    "gone.ts",
    "// contract/absent.md:3 names a document nothing provides.\n",
  );
  assert.match(
    runOverTemp().lines.join("\n"),
    /Cite the section instead — contract\/absent\.md#a-heading/,
  );
  // And a line above every heading in a document that does exist.
  write(
    `${CONTRACT}/preamble.md`,
    ["text before any heading", "", "# Later"].join("\n"),
  );
  write("gone.ts", "// contract/preamble.md:1 is above every heading.\n");
  assert.match(
    runOverTemp().lines.join("\n"),
    /Cite the section instead — contract\/preamble\.md#a-heading/,
  );
});

test("every line form is rejected and counted on its own counter — none is quietly tolerated", () => {
  // The four forms the coverage statement claims to reject, in one tree, so the claim is measured
  // rather than asserted. An enumeration that stopped seeing one of them would turn the strictest
  // possible rule into a green run.
  writeGrammar();
  write("explicit.ts", "// contract/syntax-rules.md:6 is explicit.\n");
  write("tail.ts", "// contract/syntax-rules.md:6,8 appends a tail.\n");
  write(
    "bare.ts",
    "// contract/syntax-rules.md:6 then later just :8 on its own.\n",
  );
  write("fragment.md", "See contract/syntax-rules.md#L6 for the line.\n");
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.equal(result.counts.explicit, 3);
  assert.equal(result.counts.tails, 1);
  assert.equal(result.counts.bare, 1);
  assert.equal(result.counts.citations, 5);
  assert.equal(result.counts.lineFragments, 1);
  assert.equal(result.counts.failed, 6);
  assert.equal(result.counts.sectionAnchors, 0);
  assert.equal(
    result.findings.filter((finding) => finding.observed === "line-form")
      .length,
    5,
  );
  assert.equal(
    result.findings.filter((finding) => finding.observed === "line-fragment")
      .length,
    1,
  );
});

test("a #L line fragment is rejected on sight, not resolved against the file's length", () => {
  // It used to be resolved like any other line claim, so `#L6` passed while `#L9999` failed. Under
  // the anchor-only rule whether the lines still hold text is beside the point: naming lines at all
  // is the defect, so both fail and both fail the same way.
  writeGrammar();
  write(
    "bad.md",
    `See ${CONTRACT}/syntax-rules.md#L6 and ${CONTRACT}/syntax-rules.md#L3-L9.\n`,
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  const report = result.lines.join("\n");
  assert.match(
    report,
    /contract\/syntax-rules\.md#L6 names LINES, not a section/,
  );
  assert.match(
    report,
    /contract\/syntax-rules\.md#L3-L9 names LINES, not a section/,
  );
  assert.match(
    report,
    /GitHub's line fragment drifts exactly as a line number does/,
  );
  assert.match(
    report,
    /Cite the heading that encloses those lines: contract\/syntax-rules\.md#a-heading \(ADR-0034\)/,
  );
  assert.equal(result.counts.lineFragments, 2);
  assert.equal(result.counts.sectionAnchors, 0);
  // A fragment naming lines past end-of-file is the same defect, reported the same way — the old
  // "conformance.md has 11 line(s)" wording would be an answer to a question no longer asked.
  write("bad.md", `See ${CONTRACT}/syntax-rules.md#L9999.\n`);
  assert.doesNotMatch(runOverTemp().lines.join("\n"), /line\(s\)/);
});

test("uppercase L is what separates a line fragment from a heading, and it is decidable", () => {
  // A heading slug is lowercased by construction, so it can never begin with an uppercase `L`
  // followed by digits. That is the whole separability argument, and here is the case that would
  // break if it were ever weakened: a document whose heading really is "L9".
  write(`${CONTRACT}/liney.md`, ["## L9", "", "text"].join("\n"));
  assert.deepEqual(
    documentHeadings(["## L9"]).map(({ slug }) => slug),
    ["l9"],
  );
  write("ok.md", `The heading is ${CONTRACT}/liney.md#l9.\n`);
  const passing = runOverTemp();
  assert.equal(passing.ok, true);
  assert.equal(passing.counts.sectionAnchors, 1);
  assert.equal(passing.counts.lineFragments, 0);

  write("ok.md", `The line is ${CONTRACT}/liney.md#L9.\n`);
  const failing = runOverTemp();
  assert.equal(failing.ok, false);
  assert.match(failing.lines.join("\n"), /names LINES, not a section/);
  assert.equal(failing.counts.sectionAnchors, 0);
  assert.equal(failing.counts.lineFragments, 1);
});

test("a bare reference in a file that names a document is rejected as a line claim", () => {
  // It used to matter whether a mention preceded the token: one that did produced a line-claim
  // rejection, one that did not produced an "unattributed" rejection. Both failed, so the
  // distinction only ever changed the wording — and choosing between them is what four rounds of
  // regressions lived inside. Now the file names a document, so the token is a citation.
  writeGrammar();
  write(
    "loose.ts",
    "// :77 comes first\n// then contract/syntax-rules.md#ebnf-notation\n",
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /names a LINE/);
  assert.match(result.lines.join("\n"), /syntax-rules\.md/);
});

test("an untracked forward-looking claim fails; naming its issue is enough", () => {
  writeGrammar();
  write("claim.md", "This is not yet implemented.\n");
  assert.equal(runOverTemp().ok, false);
  assert.match(
    runOverTemp().lines.join("\n"),
    /claim about this repository's own state/,
  );
  write("claim.md", "This is not yet implemented; see #123.\n");
  assert.equal(runOverTemp().ok, true);
});

test("a quoted OpenLogo snippet beside a correct anchor is NOT treated as a quotation", () => {
  // The rule this pins, verified against the real tree: tests/conformance/.../repeat-zero-times
  // correctly cites the `repeat` entry AND contains the span `repeat 0 [ print 1 ]`, which is
  // OpenLogo source the author wrote to illustrate the rule — it appears nowhere in the contract and
  // never should. A naive "every backticked span must appear in the cited section" would fail that
  // correct citation, and because this gate forbids tolerance the false positive would be fatal
  // rather than noisy. Only an EBNF production (`::=`) is checkable, because `::=` is not OpenLogo
  // syntax and so cannot be an illustration the author invented.
  write(
    `${CONTRACT}/commands.md`,
    [
      "# Commands",
      "",
      "## Repeat",
      "",
      "`repeat 0` runs the body zero times.",
      "",
    ].join("\n"),
  );
  write(
    "repeat-zero-times.expected.json",
    JSON.stringify({
      description:
        "`repeat 0 [ print 1 ]` runs the body zero times (contract/commands.md#repeat).",
    }),
  );
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.quotations, 0);
});

test("a quotation is checked against EVERY section its run cites, not one of them", () => {
  // A run routinely cites several sections, and binding a quotation to a single arbitrary one
  // manufactures failures for accurate quotations — which is what a first cut of this did across the
  // design notes. So the production need only be inside one of the sections the run names.
  writeGrammar();
  write(
    "many.ts",
    [
      "// contract/syntax-rules.md#expressions-and-calls and contract/syntax-rules.md#ebnf-notation",
      '// together define `selector ::= "[" key-term "]"`.',
    ].join("\n"),
  );
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.quotations, 1);
});

test("a production quoted beside a section that does not contain it FAILS", () => {
  // This is the re-pointed quotation check doing the job it was re-pointed for. With no line ranges
  // left it had no input at all, and a check with no input reports success while measuring nothing —
  // the defect this saga has caught repeatedly. It now measures against the SECTION an anchor names.
  writeGrammar();
  write(
    "wrong.ts",
    '// contract/syntax-rules.md#expressions-and-calls gives `selector ::= "[" key-term "]"`.\n',
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  const report = result.lines.join("\n");
  assert.match(
    report,
    /the production `selector ::= "\[" key-term "\]"` is quoted here but is not in contract\/syntax-rules\.md#expressions-and-calls/,
  );
  assert.match(
    report,
    /the anchor resolves and still points at the wrong section/,
  );
});

test("a section STOPS at its sibling, end to end — the shape the `depth` regression let through", () => {
  // The direction the other quotation mutations cannot reach. They cite the LATER section and quote
  // from an earlier one, which fails either way: when `depth` went missing every section ran to
  // end-of-file, and an end-of-file extension only ever admits text BELOW the cited heading.
  //
  // So this cites the EARLIER section and quotes a production that lives only in its sibling below.
  // Under the regression `#ebnf-notation` covered lines 3-15 and this passed; with `depth` restored
  // it covers 3-10 and this is red. A unit test on `sectionRange` alone would not have caught a
  // caller that went on using the whole suffix.
  writeGrammar();
  write(
    "below.ts",
    "// contract/syntax-rules.md#ebnf-notation gives `comparison ::= additive { compare-op additive }`.\n",
  );
  const result = runOverTemp();
  assert.equal(
    result.ok,
    false,
    "a section must not reach into the sibling below it",
  );
  assert.match(
    result.lines.join("\n"),
    /is quoted here but is not in contract\/syntax-rules\.md#ebnf-notation/,
  );

  // And the control: cited correctly, the same production passes, so the failure above is the
  // boundary being enforced rather than the quotation never matching anything.
  write(
    "below.ts",
    "// contract/syntax-rules.md#expressions-and-calls gives `comparison ::= additive { compare-op additive }`.\n",
  );
  assert.equal(runOverTemp().ok, true);
});

test("a section spans its subsections, so quoting from one is inside the parent", () => {
  writeGrammar();
  write(
    "parent.ts",
    '// contract/syntax-rules.md#grammar contains `selector ::= "[" key-term "]"`.\n',
  );
  assert.equal(runOverTemp().ok, true);
});

test("a quotation beside an anchor that already failed to resolve is not reported twice", () => {
  writeGrammar();
  write(
    "both.ts",
    '// contract/syntax-rules.md#nope has `selector ::= "[" key-term "]"`.\n',
  );
  const result = runOverTemp();
  assert.equal(result.counts.failed, 1);
  assert.match(result.lines.join("\n"), /does not resolve/);
});

test("without a specRoot override the gate reads the real specification directory", () => {
  // The production configuration: the token citations carry IS the directory they are read from.
  // Built from SPEC_DIRECTORY rather than written out, so this file — which the gate scans in CI —
  // carries no real citation of its own.
  write(
    "real.md",
    `The profile is ${SPEC_DIRECTORY}/conformance.md#heritage.\n`,
  );
  const result = runSpecCitationsGate({
    roots: [TEMP_DIR],
    specDirectory: SPEC_DIRECTORY,
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.sectionAnchors, 1);
});

// --- Scoping: a narrowed run must not check less than it reports (item 5) ------------------------

test("a ROOTED run still rejects a line citation inside its scope", () => {
  // The standing question for every check in this saga: does this instrument still measure what it
  // says when invoked unusually? The superseded ratchet had `--root=.` scan the whole repository,
  // exit 0, and print a number compared against nothing. The shape — an option that quietly narrows
  // what a gate checks while its report still reads as authoritative — is what matters, and this
  // gate has the same option surface. So the rule is exercised THROUGH the option rather than
  // assumed to survive it.
  writeGrammar();
  write("nested/deep/bad.ts", "// contract/syntax-rules.md:8 is cited here.\n");
  const scoped = runSpecCitationsGate({
    roots: [join(TEMP_DIR, "nested", "deep")],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
  });
  assert.equal(
    scoped.ok,
    false,
    "a rooted run must still reject a line citation",
  );
  assert.equal(scoped.counts.citations, 1);
  assert.match(
    scoped.lines.join("\n"),
    /Cite the section instead — contract\/syntax-rules\.md#ebnf-notation/,
  );
});

test("a scoped run SAYS it is scoped, so its numbers cannot read as the repository's result", () => {
  writeGrammar();
  write("ok.ts", "// contract/syntax-rules.md#ebnf-notation is cited here.\n");
  const scoped = runOverTemp();
  assert.equal(scoped.ok, true);
  const banner = scoped.lines.find((line) => line.includes("SCOPED RUN"));
  assert.ok(banner !== undefined, "a run given overrides must announce them");
  assert.match(banner, /did NOT use the production configuration/);
  assert.match(banner, /are not this repository's Definition-of-Done result/);
  // Every override actually in effect is named, so the banner describes this run rather than
  // restating a fixed sentence.
  assert.match(banner, /roots=\[/);
  assert.match(banner, new RegExp(`spec-dir=${CONTRACT}`));
  assert.match(banner, /spec-root=/);
  // This run DID narrow the file set, and says so.
  assert.match(banner, /narrowed to those roots rather than the tracked set/);
  // And it repeats that the RULE is not what narrowed.
  assert.match(
    banner,
    /a citation naming a line fails inside a scope exactly as it does outside/,
  );
});

test("the banner distinguishes a narrowed FILE SET from an overridden contract", () => {
  // A banner that misreports the instrument's scope is the very defect the banner exists to
  // prevent. `roots` is the only override that changes WHICH FILES are read; `--spec-dir` changes
  // which citation token is recognised and `--spec-root` where documents are resolved, and under
  // both the tracked set is still scanned in full.
  const tokenOverride = runSpecCitationsGate({
    specDirectory: "no-such-directory",
  });
  const banner = tokenOverride.lines.find((line) =>
    line.includes("SCOPED RUN"),
  );
  assert.match(banner, /the tracked set was still scanned/);
  assert.doesNotMatch(banner, /narrowed to those roots/);
});

test("the default run is the authoritative one, and carries no scope banner", () => {
  // The other half of the claim: the banner must be absent exactly when the gate did scan the
  // tracked set, or it becomes noise nobody reads and stops distinguishing anything.
  const authoritative = runSpecCitationsGate();
  assert.ok(
    !authoritative.lines.some((line) => line.includes("SCOPED RUN")),
    "an unscoped run must not claim to be scoped",
  );
  assert.match(authoritative.lines[0], /^spec citations: /);
  // A spec-dir override alone is enough to scope a run — it is the narrowing with no filesystem
  // trace, and the easiest to invoke by accident. It also empties the document oracle, which is now
  // a FAILURE rather than a quiet green: the banner says the run was scoped, and the failure says
  // the prefix-less rule could not fire at all.
  const narrowed = runSpecCitationsGate({ specDirectory: "no-such-directory" });
  assert.equal(narrowed.counts.files, 0);
  assert.equal(narrowed.ok, false);
  assert.match(
    narrowed.lines.join("\n"),
    /the rule was switched off, not that the tree is clean/,
  );
  const banner = narrowed.lines.find((line) => line.includes("SCOPED RUN"));
  assert.ok(
    banner !== undefined,
    "a run that looked at nothing must say what it looked at",
  );
  assert.match(banner, /spec-dir=no-such-directory/);
});

test("a scope narrows what is LOOKED AT, and the summary reports that scope honestly", () => {
  writeGrammar();
  write("inside/bad.ts", "// contract/syntax-rules.md:8 is cited here.\n");
  write(
    "outside/also-bad.ts",
    "// contract/syntax-rules.md:13 is cited here too.\n",
  );
  const whole = runOverTemp();
  assert.equal(whole.counts.citations, 2);
  const half = runSpecCitationsGate({
    roots: [join(TEMP_DIR, "inside")],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
  });
  // The narrowed run finds one, says it scanned one citing file, and fails on it. What it must never
  // do is report the smaller number as though it had looked at everything.
  assert.equal(half.counts.citations, 1);
  assert.equal(half.counts.files, 1);
  assert.equal(half.ok, false);
  const summary = half.lines.find((line) => line.startsWith("spec citations:"));
  assert.match(
    summary,
    /1 line-form citation\(s\) REJECTED across 1 citing file\(s\)/,
  );
  assert.ok(half.lines.some((line) => line.includes("SCOPED RUN")));
});

test("the ADR status-claim scope is repository-relative, so a rooted run is never more permissive", () => {
  // An honest asymmetry, pinned rather than discovered later. STATUS_CLAIM_EXEMPT_PREFIX is matched
  // against a repository-relative path, so a root outside the repository never matches it: the same
  // ADR text is exempt under the tracked-set run and reported under a rooted one. That direction is
  // safe — a scope can make this gate stricter, never laxer — and saying so is the point.
  write(
    `${STATUS_CLAIM_EXEMPT_PREFIX}0001-example.md`,
    "A later slice will do it.\n",
  );
  const rooted = runOverTemp();
  assert.equal(
    rooted.ok,
    false,
    "a rooted scan does not honour the repo-relative scope",
  );
  assert.match(rooted.lines.join("\n"), /names\s+no tracking issue/);
  // The tracked-set run is where the scope applies, and the live corpus proves it: docs/adr holds
  // forward-looking phrases and the authoritative run is green on them. Asserted as an empty
  // findings list rather than a filtered count, because a predicate over an empty array is a test
  // that cannot fail — the vacuous-pass shape this saga keeps finding.
  const authoritative = runSpecCitationsGate();
  assert.deepEqual(authoritative.findings, []);
  assert.equal(authoritative.ok, true);
});

// --- Section anchors, headings and slugs (issue #1181, ADR-0035) --------------------------------

test("the hand-verified literals now cross-check TWO independent implementations", () => {
  // These were verified by hand against github-slugger's published removal class during rounds 1-8,
  // when the gate reimplemented the rule. The reimplementation is gone, so they are no longer a
  // restatement of our own logic — they are agreement between what this gate computes and what
  // GitHub's own slugger does. A disagreement here is a finding, not a test to adjust.
  const slugOf = (heading) =>
    documentHeadings([`## ${heading}`]).map(({ slug }) => slug);
  assert.deepEqual(slugOf("`set_xy`"), ["set_xy"], "`_` survives");
  assert.deepEqual(slugOf("`clear_screen`"), ["clear_screen"]);
  assert.deepEqual(slugOf("Names use `snake_case`"), ["names-use-snake_case"]);
  // Runs of hyphens are never collapsed: `&` is deleted and the spaces on either side each become
  // one. Both live conformance headings.
  assert.deepEqual(slugOf("Turtle & Rendering"), ["turtle--rendering"]);
  assert.deepEqual(slugOf("Interaction & Events"), ["interaction--events"]);
  assert.deepEqual(slugOf("Tutor (AI)"), ["tutor-ai"]);
  assert.deepEqual(slugOf("Keywords, primitives, and built-in names"), [
    "keywords-primitives-and-built-in-names",
  ]);
  assert.deepEqual(slugOf("`<place> = <value>`"), ["place--value"]);
  assert.deepEqual(slugOf("`is_a?`"), ["is_a"]);
  // A code span containing link syntax is literal text, so it slugs as written — the case that
  // proved unwrapping links was itself a defect.
  assert.deepEqual(slugOf("`[text](target)`"), ["texttarget"]);
  // A trailing deleted character leaves a trailing hyphen, because the trim happens BEFORE the
  // deletion. Both implementations agree; only an early prose sketch of the rule did not.
  assert.deepEqual(slugOf("`if … [else …]`"), ["if--else-"]);
  assert.deepEqual(slugOf("`set … to`"), ["set--to"]);
});

test("slugs are computed from RENDERED text, which is what a source-slugging reader got wrong", () => {
  // Every one of these was a quiet false pass while the gate slugged markdown source: the reader
  // invented a fragment GitHub does not publish, so citing the invented one resolved here and 404'd
  // there. No amount of block parsing would have touched them — this is the inline half.
  const slugOf = (heading) =>
    documentHeadings([`## ${heading}`]).map(({ slug }) => slug);
  assert.deepEqual(
    slugOf("[Text](target)"),
    ["text"],
    "a link slugs its LABEL",
  );
  assert.deepEqual(slugOf("See [a [b]](target)"), ["see-a-b"]);
  assert.deepEqual(
    slugOf("_Text_"),
    ["text"],
    "emphasis is resolved, not kept",
  );
  assert.deepEqual(slugOf("__Bold__"), ["bold"]);
  assert.deepEqual(slugOf("A &amp; B"), ["a--b"], "entities are decoded");
  assert.deepEqual(slugOf("A &#x26; B"), ["a--b"], "including the hex form");
  assert.deepEqual(slugOf("A <br> B"), ["a--b"], "inline HTML is dropped");
  assert.deepEqual(slugOf("` foo `"), ["foo"], "a code span is TRIMMED");
  assert.deepEqual(slugOf("Area in m²"), ["area-in-m"]);
  assert.deepEqual(slugOf("Area in `m²`"), ["area-in-m"]);
  assert.deepEqual(slugOf("Half ½ done"), ["half--done"]);

  // Rendered text is checked through the public path, because that is the only place a REFERENCE
  // link has been resolved against the document's link definitions.
  const headingOf = (source) => documentHeadings(source.split("\n"))[0].heading;
  assert.equal(headingOf("## [Text](target)"), "Text");
  assert.equal(headingOf("## A &amp; B"), "A & B");
  assert.equal(
    decodeEntities(
      "a &lt;b&gt; &#65; &#x42; &nope; &quot; &#1114112; &#99999999;",
    ),
    'a <b> A B &nope; " \uFFFD &#99999999;',
  );

  // A REFERENCE link resolves against the document's definitions. Re-parsing the heading's raw
  // source in isolation produced `textref` — an anchor GitHub never publishes — because the
  // definition was not in scope. All three reference forms are pinned.
  assert.deepEqual(
    documentHeadings(
      ["## [Text][ref]", "", "[ref]: https://example.com"]
        .join("\n")
        .split("\n"),
    ).map(({ slug }) => slug),
    ["text"],
    "full reference link",
  );
  assert.deepEqual(
    documentHeadings(["## [Text][]", "", "[Text]: https://example.com"]).map(
      ({ slug }) => slug,
    ),
    ["text"],
    "collapsed reference link",
  );
  assert.deepEqual(
    documentHeadings(["## [Text]", "", "[Text]: https://example.com"]).map(
      ({ slug }) => slug,
    ),
    ["text"],
    "shortcut reference link",
  );

  // A numeric reference with no character to produce is U+FFFD, which the slug rule then deletes —
  // CommonMark's rule, and GitHub's. Left as written, `&#xD800;` slugged as a bare surrogate and
  // `&#x110000;` as the literal `x110000`: two anchors GitHub does not publish, neither refused.
  assert.deepEqual(slugOf("A &#xD800; B"), ["a--b"], "a lone surrogate");
  assert.deepEqual(
    slugOf("A &#x110000; B"),
    ["a--b"],
    "past the last code point",
  );
  assert.deepEqual(slugOf("A &#0; B"), ["a--b"], "a null");
  assert.deepEqual(
    slugOf("A &#x41; B"),
    ["a-a-b"],
    "a representable one still decodes",
  );

  // An escape is its own token, so decoding PER TOKEN cannot re-decode what the author escaped.
  assert.equal(headingOf("## A \\&amp; B"), "A &amp; B");

  // A SETEXT heading spans lines, so it can carry a HARD BREAK — the one shape that makes the `br`
  // branch reachable. A `<br>` contributes no text content, so GitHub slugs `titlemore`; the
  // slugger agrees by a second route, deleting the newline of "Title\nmore" to the same slug. A
  // space would have produced `title-more`, agreeing with neither.
  assert.deepEqual(
    documentHeadings(["Title  ", "more", "====="]).map(({ slug }) => slug),
    ["titlemore"],
  );
  assert.deepEqual(
    documentHeadings(["Title\\", "more", "====="]).map(({ slug }) => slug),
    ["titlemore"],
    "the backslash spelling of the same break",
  );

  // An IMAGE carries its alt text in an attribute, so it reaches no anchor — the same reasoning as
  // the hard break, and pinned against two real GitHub anchors. Descending into the alt tokens gave
  // `mou-icon` and `headphones-logo-headphones`: anchors that resolve here and 404 on GitHub.
  assert.deepEqual(
    documentHeadings(["## ![Mou icon](x.gif)"]).map(({ slug }) => slug),
    [""],
    "an image-only heading publishes an EMPTY anchor",
  );
  assert.deepEqual(
    documentHeadings(["## ![Headphones Logo](x.png) Headphones"]).map(
      ({ slug }) => slug,
    ),
    ["-headphones"],
    "and the space it leaves behind keeps its leading hyphen",
  );
  assert.deepEqual(
    documentHeadings(["## [![alt](i.png)](t)"]).map(({ slug }) => slug),
    [""],
    "including an image nested in a link",
  );

  // The two numeric grammars are kept apart. Written as one `#[xX]?[0-9a-fA-F]+` the `x` is optional
  // over a HEX digit class, so a malformed decimal was read as a number: `&#12A;` decoded as 12 and
  // slugged `a--b` where GitHub publishes `a-12a-b`, and `&#AB;` reached fromCodePoint(NaN) and
  // CRASHED the gate. Neither is a reference, so both are left exactly as GitHub leaves them.
  assert.deepEqual(slugOf("A &#12A; B"), ["a-12a-b"], "a malformed decimal");
  assert.deepEqual(
    slugOf("A &#AB; B"),
    ["a-ab-b"],
    "and one that used to throw",
  );
  assert.deepEqual(
    slugOf("A &#x1F; B"),
    ["a--b"],
    "a real hex form still decodes",
  );
  assert.deepEqual(slugOf("A &#65; B"), ["a-a-b"], "as does a real decimal");

  // LENGTH is part of the grammar too, and leaving it unbounded was the same defect one step out.
  // CommonMark admits 1-7 decimal digits or 1-6 hex digits, so an overlong run is not a reference:
  // decoding `&#0000000000000065;` to `A` published `a-a-b` where GitHub publishes the literal.
  assert.deepEqual(
    slugOf("A &#0000065; B"),
    ["a-a-b"],
    "seven decimal digits is a reference",
  );
  assert.deepEqual(slugOf("A &#00000065; B"), ["a-00000065-b"], "eight is not");
  assert.deepEqual(
    slugOf("A &#x000041; B"),
    ["a-a-b"],
    "six hex digits is a reference",
  );
  assert.deepEqual(slugOf("A &#x0000041; B"), ["a-x0000041-b"], "seven is not");
  assert.deepEqual(
    slugOf("A &#0000000000000065; B"),
    ["a-0000000000000065-b"],
    "and the reviewer's reproduction",
  );

  // The boundary shapes that are not references at all. None of them may throw.
  assert.deepEqual(slugOf("A &#; B"), ["a--b"]);
  assert.deepEqual(slugOf("A &#x; B"), ["a-x-b"]);
  assert.deepEqual(
    slugOf("A &#1114112; B"),
    ["a--b"],
    "in the grammar, past the last code point",
  );
});

test("block structure comes from the parser — every shape that defeated the flat reader", () => {
  const slugs = (lines) => documentHeadings(lines).map(({ slug }) => slug);
  // A `#` inside a fence is an OpenLogo comment, not a heading; the grammar document relies on this.
  assert.deepEqual(slugs(["```logo", "# primary line comment", "```"]), []);
  // A closing fence must be at least as long as its opener.
  assert.deepEqual(slugs(["````text", "```", "## Ghost", "````"]), []);
  // A container marker INSIDE a fence is code, not a closer.
  assert.deepEqual(slugs(["```logo", "- ```", "# Ghost", "```"]), []);
  assert.deepEqual(slugs(["```markdown", "> ```", "## Ghost", "```"]), []);
  // Setext headings are published, and were invisible to the flat reader.
  assert.deepEqual(slugs(["Title", "====="]), ["title"]);
  // An HTML block hides nothing here, because the parser knows where it ends.
  assert.deepEqual(slugs(["<!-- x -->", "## Ghost"]), ["ghost"]);
  // GitHub publishes headings nested in containers; the flat reader could not see them.
  assert.deepEqual(slugs(["> ## Notes"]), ["notes"]);
  assert.deepEqual(slugs(["- ## Notes"]), ["notes"]);
  assert.deepEqual(slugs(["> 1. # Nested"]), ["nested"]);
  // THE ESCALATION CASE. A fence opened on a list-item continuation line is scoped to the item, so
  // it closes when the item ends and `# Real` IS a heading. Reasoning line-by-line got this wrong in
  // both directions across three rounds, and the execution-model document uses exactly this shape.
  assert.deepEqual(
    slugs(["- item", "  ```logo", "  # comment", "", "# Real"]),
    ["real"],
  );
  // And the compound form, where the next top-level fence was mistaken for the first one's closer.
  assert.deepEqual(
    slugs([
      "- item",
      "  ```md",
      "  # code",
      "# Real",
      "```",
      "## Ghost",
      "```",
    ]),
    ["real"],
  );
});

test("duplicate slugs are numbered positionally, by github-slugger's own occupancy tracking", () => {
  const slugs = (lines) => documentHeadings(lines).map(({ slug }) => slug);
  assert.deepEqual(slugs(["## Notes", "", "## Notes", "", "## Notes"]), [
    "notes",
    "notes-1",
    "notes-2",
  ]);
  // The case a naive occurrence count gets wrong: it hands `foo-1` to two different sections.
  assert.deepEqual(slugs(["## Foo-1", "", "## Foo", "", "## Foo"]), [
    "foo-1",
    "foo",
    "foo-2",
  ]);
  assert.deepEqual(slugs(["## Foo", "", "## Foo-1", "", "## Foo"]), [
    "foo",
    "foo-1",
    "foo-2",
  ]);
});

test("the duplicate-slug rule is exercised by the LIVE corpus, not only by fixtures", () => {
  // The commands document's operator headings are punctuation only, so they all slug to the empty
  // string and are reachable at positional suffixes alone. This is why the module note says the
  // anchor form cannot express a stable citation for that block.
  //
  // The document is named through SPEC_DIRECTORY rather than written out, for the reason this
  // file's header gives: a literal mention here would be a real one.
  const headings = documentHeadings(
    splitLines(readFileSync(join(SPEC_DIRECTORY, "commands.md"), "utf8")),
  );
  const positional = headings.filter(({ slug }) => /^-\d+$/.test(slug));
  assert.ok(
    positional.length > 0,
    "the operator headings must still collide on the empty slug",
  );
  assert.deepEqual(
    positional.map(({ slug }) => slug),
    positional.map((_, index) => `-${index + 1}`),
    "positional suffixes must run consecutively from -1",
  );
});

test("editDistance and closestHeadingSlug find the nearest heading, or none at all", () => {
  assert.equal(editDistance("", "abc"), 3);
  assert.equal(editDistance("abc", ""), 3);
  assert.equal(editDistance("abc", "abc"), 0);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(closestHeadingSlug("anything", []), null);
  assert.deepEqual(
    closestHeadingSlug("heritag", [{ slug: "sprites" }, { slug: "heritage" }]),
    { slug: "heritage", distance: 1 },
  );
});

test("resolveAnchor accepts a real heading and describes every way one is not", () => {
  const headings = [{ slug: "heritage" }, { slug: "optional-profiles" }];
  const anchor = (fragment, extra = {}) => ({
    specDirectory: CONTRACT,
    file: "conformance.md",
    fragment,
    ...extra,
  });
  assert.equal(resolveAnchor(anchor("heritage"), headings), null);
  assert.deepEqual(resolveAnchor(anchor("heritage"), null), {
    status: "missing-file",
    detail: `${CONTRACT}/conformance.md does not exist`,
  });

  const near = resolveAnchor(anchor("heritag"), headings);
  assert.equal(near.status, "missing-heading");
  assert.match(near.detail, /did you mean "#heritage"\?/);

  // A far miss is NOT dressed up as a suggestion. The nearest slug in a document is always some
  // string, and naming it would invite a "fix" that resolves at the wrong passage — the gate
  // manufacturing the defect it exists to catch.
  const far = resolveAnchor(anchor("collections-"), headings);
  assert.equal(far.status, "missing-heading");
  assert.doesNotMatch(far.detail, /did you mean/);
  assert.match(
    far.detail,
    /none of its 2 headings is close enough to guess at/,
  );

  const barren = resolveAnchor(anchor("anything"), []);
  assert.match(barren.detail, /no headings at all/);

  // A bare `#` is reported as naming nothing rather than looked up: a document CAN hold a heading
  // whose slug is empty, and resolving `#` against one would accept a citation no reader can follow.
  const empty = resolveAnchor(anchor(""), [{ slug: "" }]);
  assert.equal(empty.status, "empty-fragment");
  assert.match(empty.detail, /names no heading/);

  const malformed = resolveAnchor(
    anchor("heritage", { malformed: true }),
    headings,
  );
  assert.equal(malformed.status, "malformed-fragment");
  assert.match(malformed.detail, /no heading slug can contain/);
});

test("suggestionDistance is a stated policy, pinned on both sides of its boundary", () => {
  // It governs the WORDING of a failure only — every non-exact fragment fails either way — so this
  // pins the threshold, never a pass/fail outcome.
  assert.equal(suggestionDistance("abc"), 2);
  assert.equal(suggestionDistance("123456789"), 3);
  const headings = [{ slug: "aaaaaaaaa" }];
  const at = resolveAnchor(
    { specDirectory: CONTRACT, file: "d.md", fragment: "aaaaaabbb" },
    headings,
  );
  assert.match(
    at.detail,
    /did you mean/,
    "three edits on nine characters is the boundary",
  );
  const beyond = resolveAnchor(
    { specDirectory: CONTRACT, file: "d.md", fragment: "aaaaabbbb" },
    headings,
  );
  assert.doesNotMatch(beyond.detail, /did you mean/, "four edits is past it");
});

test("a fragment truncated by a character no slug can hold is malformed, not a valid prefix", () => {
  // Tolerance smuggled in through the tokenizer: `#real-heading.extra` collected as `real-heading`
  // and PASSED, because the fragment class simply stopped at the `.`. Prose punctuation still has to
  // be tolerated, so the test is whether the token ENDS — punctuation then whitespace is prose,
  // punctuation then more text is a fragment this gate cannot resolve.
  const malformedFor = (suffix) => {
    const { anchors } = collectCitations(
      "a.md",
      `see ${CONTRACT}/doc.md#real-heading${suffix} tail`,
      CONTRACT,
    );
    return anchors[0].malformed;
  };
  for (const suffix of [".extra", "%2Dtypo", "/typo"]) {
    assert.equal(malformedFor(suffix), true, `${suffix} must be malformed`);
  }
  for (const suffix of ["", ": prose", ". Prose", "`)", " and", '"']) {
    assert.equal(malformedFor(suffix), false, `${suffix} must be accepted`);
  }
  // #1180 converted thousands of line citations to anchors, and prose emphasises citations. A bolded
  // anchor is correct writing and must not read as a defect.
  for (const suffix of ["**", "*", "~~", "…", " — dash"]) {
    assert.equal(malformedFor(suffix), false, `${suffix} must be accepted`);
  }
  // A trailing delimiter closes the token directly; trailing PUNCTUATION counts only when whitespace
  // or end-of-line follows it. That asymmetry is what makes a link destination work without parsing
  // one: in `[bad](x.md#a-heading.)` the `.` is followed by `)`, so it belongs to the fragment.
  const malformedIn = (text) =>
    collectCitations("a.md", text, CONTRACT).anchors[0].malformed;
  assert.equal(malformedIn(`[bad](${CONTRACT}/d.md#real-heading.)`), true);
  assert.equal(malformedIn(`[good](${CONTRACT}/d.md#real-heading)`), false);
  // Two shapes that defeated an earlier destination-PARSING version of this rule: a space after the
  // `](`, and a balanced `(foo)` inside the destination. The asymmetric rule has no destination to
  // get wrong, so both fail correctly.
  assert.equal(malformedIn(`[bad]( ${CONTRACT}/d.md#real-heading.)`), true);
  assert.equal(
    malformedIn(`[bad](pre(foo)/${CONTRACT}/d.md#real-heading.)`),
    true,
  );
  // And an angle-bracket destination is valid markdown with a correct anchor: it must NOT fail.
  assert.equal(malformedIn(`[good](<${CONTRACT}/d.md#real-heading>)`), false);

  // The class must hold everything a SLUG can hold, or it manufactures the very defect it exists to
  // catch. github-slugger PRESERVES combining marks, so a decomposed heading publishes a slug whose
  // final code point is U+0301 — and without `\p{M}` the citation to it truncated to `cafe` and was
  // reported malformed: a false failure invented by the tokenizer, not found in the document.
  const decomposed = "caf\u0065\u0301";
  assert.deepEqual(
    documentHeadings([`## Caf\u0065\u0301`]).map(({ slug }) => slug),
    [decomposed],
    "the slugger keeps the combining mark",
  );
  const { anchors } = collectCitations(
    "a.md",
    `see ${CONTRACT}/d.md#${decomposed} tail`,
    CONTRACT,
  );
  assert.equal(
    anchors[0].fragment,
    decomposed,
    "and the citation keeps it too",
  );
  assert.equal(anchors[0].malformed, false);
});

test("SLUG_CHARACTER holds every character the SHIPPED slugger preserves", () => {
  // The oracle is the library, not a restatement of the class. A hand-written class was wrong twice
  // in a row here — first missing combining marks, then missing connector punctuation and other
  // symbols — and both times it MANUFACTURED a failure: GitHub publishes real anchors containing
  // U+203F, and the citation to one truncated mid-slug and was reported malformed. So this sweeps
  // every Unicode code point through `slug()` itself and asserts nothing it preserves falls outside.
  //
  // "Preserves" here means SURVIVES, not round-trips: a character the slugger keeps but case-folds
  // counts, because its output still has to be citable. Under the narrower exact-round-trip reading
  // the old class missed 113 characters rather than 139; the 26 circled capitals U+24B6-U+24CF are
  // the difference. The class must cover both readings, so the looser one is the one swept.
  const preservedOutside = (admissible, last = 0x10ffff) => {
    const missed = [];
    for (let codePoint = 0; codePoint <= last; codePoint++) {
      const surrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
      const character = surrogate ? "" : String.fromCodePoint(codePoint);
      // A space is preserved as text but becomes `-`, so it is never IN a slug.
      const preserved =
        !surrogate &&
        character !== " " &&
        slug(character) === character.toLowerCase();
      if (preserved && !admissible.test(character)) {
        missed.push(`U+${codePoint.toString(16).toUpperCase()}`);
      }
    }
    return missed;
  };
  assert.deepEqual(
    preservedOutside(new RegExp(SLUG_CHARACTER, "u")),
    [],
    "every preserved character must be citable",
  );

  // A sweep that can only ever report nothing asserts nothing, so the oracle gets a positive
  // control: the class as it was written BEFORE this fix must be caught, and caught at the very
  // character GitHub publishes a live anchor with.
  assert.ok(
    preservedOutside(/[\p{L}\p{N}\p{M}_-]/u, 0x2100).includes("U+203F"),
    "the sweep must detect a class that is too narrow",
  );

  // Being a SUPERSET is deliberate and safe: resolution compares the whole fragment against a real
  // slug, so a symbol the slugger would have dropped fails to match rather than being tolerated.
  // What the class must NOT admit is the delimiters the boundary rule depends on.
  const admissible = new RegExp(SLUG_CHARACTER, "u");
  for (const delimiter of [
    "#",
    ")",
    "]",
    "`",
    '"',
    "'",
    ".",
    "*",
    "…",
    "%",
    "/",
    "|",
    "—",
  ]) {
    assert.equal(
      admissible.test(delimiter),
      false,
      `${delimiter} must stay outside the fragment`,
    );
  }

  // The two classes the hand-written version missed, end to end. `Ⓐ` also proves the case-folding
  // reading matters: the slugger emits `ⓐ`, so the citable character is not the authored one.
  for (const [heading, fragment] of [
    ["## \u203F", "\u203F"],
    ["## \u24B6", "\u24D0"],
  ]) {
    assert.deepEqual(
      documentHeadings([heading]).map((found) => found.slug),
      [fragment],
      heading,
    );
    const cited = collectCitations(
      "a.md",
      `see ${CONTRACT}/d.md#${fragment} tail`,
      CONTRACT,
    ).anchors[0];
    assert.equal(cited.fragment, fragment, heading);
    assert.equal(cited.malformed, false, heading);
  }
});

test("the canary is now four constructs, because the parser obsoleted the rest", () => {
  // It used to carry permit-lists over heading characters and code-span contents, plus refusals for
  // HTML blocks, setext rules, nested headings and container fences. All of that is DELETED — the
  // parser handles it. What survives is where marked and GitHub GENUINELY differ, or where
  // recovering text from the parse would otherwise be hand-rolled again.
  const constructs = (lines) =>
    unsupportedConstructs(lines).map(({ construct }) => construct);

  // 1. A GFM emoji shortcode: GitHub renders it, marked does not implement it.
  assert.match(constructs(["## Good :+1: work"])[0], /emoji shortcode/);
  assert.equal(constructs(["## Nice :smile: work"]).length, 1);

  // 2. An entity reference the decoder does not handle. CommonMark resolves ~2,000 of them and
  // GitHub slugs the character; marked leaves them in the token text. The decoder handles what a
  // renderer EMITS when escaping, and deliberately does not grow a hand-maintained table of the
  // rest — a partial hand-rolled table is the defect the parse was adopted to end.
  for (const entity of [
    "&copy;",
    "&mdash;",
    "&hellip;",
    "&times;",
    "&frac12;",
  ]) {
    assert.match(
      constructs([`## A ${entity} B`])[0],
      /the entity reference/,
      `${entity} must be refused`,
    );
  }
  // The ones the decoder genuinely handles are accepted, and slug correctly.
  for (const entity of ["&amp;", "&lt;", "&gt;", "&quot;", "&#x26;", "&#65;"]) {
    assert.deepEqual(constructs([`## A ${entity} B`]), [], entity);
  }

  // 3. Raw inline HTML, where recovering text by pattern breaks on a `>` inside an attribute or a
  // comment — `## <img alt="a>b"> Title` slugged `b-title` here against GitHub's `-title`.
  assert.match(constructs(['## A <img alt="a>b"> B'])[0], /raw inline HTML/);
  assert.match(constructs(["## A <!-- a > b --> C"])[0], /raw inline HTML/);
  assert.match(constructs(["## A <b>x</b> B"])[0], /raw inline HTML/);
  // Deduplicated per heading: `<b>` and `</b>` are two tokens but one hazard of that kind.
  assert.equal(constructs(["## A <b>x</b> B"]).length, 1);
  // Two DIFFERENT entities remain two findings — dedupe must not collapse distinct causes.
  assert.equal(constructs(["## A &copy; B &mdash; C"]).length, 2);

  // A code span's contents are literal text and are skipped, so the live angle-bracket headings are
  // not mistaken for HTML.
  assert.deepEqual(constructs(["### `<place> = <value>`"]), []);
  assert.deepEqual(constructs(["### `&copy;`"]), []);
  assert.deepEqual(constructs(["### `:+1:`"]), []);
  // An IMAGE is skipped for the same reason renderedText skips it — its alt text reaches no anchor,
  // so a shortcode there cannot refuse a document it does not affect.
  assert.deepEqual(constructs(["## ![:+1:](x.png) Title"]), []);
  assert.deepEqual(constructs(["## ![&copy;](x.png) Title"]), []);

  // TWO of the four key on SHAPE, not on a table of real entities or real emoji names, and that is
  // deliberate — telling them apart needs exactly the hand-maintained tables the parse was adopted
  // to end. So a heading GitHub would publish LITERALLY is refused as well. This is the gate erring
  // toward refusing loudly (the message names the construct and the remedy) rather than inventing a
  // slug, and it is pinned so nobody later "fixes" it into a silent pass.
  assert.match(
    constructs(["## A &definitelynotarealentity; B"])[0],
    /the entity reference/,
    "a lookalike entity is refused too",
  );
  assert.match(
    constructs(["## A :definitely_not_an_emoji_abcxyz: B"])[0],
    /an emoji shortcode shape/,
    "a lookalike shortcode is refused too",
  );

  // 4. A numeric reference of DISPUTED length. CommonMark and both reference implementations say 8
  // decimal or 7-8 hex digits is not a reference; GitHub's own Markdown API decodes it. The gate has
  // no right to a slug its oracles disagree on, so it declines rather than picking a side.
  for (const disputed of [
    "&#00000065;",
    "&#99999999;",
    "&#x0000041;",
    "&#x00000041;",
  ]) {
    assert.match(
      constructs([`## A ${disputed} B`])[0],
      /digit count CommonMark and GitHub's renderer disagree about/,
      `${disputed} must be refused`,
    );
  }
  // Undisputed on both sides of the span: inside it decodes, past it every oracle says literal.
  for (const settled of [
    "&#0000065;",
    "&#x000041;",
    "&#1114112;",
    "&#000000065;",
    "&#x000000041;",
  ]) {
    assert.deepEqual(constructs([`## A ${settled} B`]), [], settled);
  }

  // Everything the old canary refused is now simply READ CORRECTLY, so refusing it would be a false
  // failure. These are the round 3-8 reproductions, inverted: they must all be accepted now.
  for (const lines of [
    ["## [Text](target)"],
    ["## _Text_"],
    ["## A &#x26; B"],
    ["## Area in `m²`"],
    ["## ` foo `"],
    ["Title", "====="],
    ["</div>", "## Ghost"],
    ["<![CDATA[", "## Ghost", "]]>"],
    ["> ## Notes"],
    ["- ## Notes"],
    ["> 1. # Nested"],
    ["- ```markdown", "  # Inside", "  ```"],
    ["- item", "  ```logo", "  # comment", "", "# Real"],
    ["## Turtle & Rendering"],
    ["## ``<b>``"],
    ["   \t- ## Notes"],
  ]) {
    assert.deepEqual(
      constructs(lines),
      [],
      `must no longer be refused: ${JSON.stringify(lines)}`,
    );
  }
});

test("the LIVE corpus is clean for the canary, and the canary still reports when it should", () => {
  // Kept measured rather than asserted. If an edit ever introduces a heading the reader refuses,
  // this fails here and the gate fails in CI.
  const scan = (name, lines) =>
    unsupportedConstructs(lines).map(
      (found) => `${name}:${found.line} ${found.construct}`,
    );
  const offenders = [
    ...readdirSync(SPEC_DIRECTORY)
      .filter((file) => file.endsWith(".md"))
      .flatMap((file) =>
        scan(
          file,
          splitLines(readFileSync(join(SPEC_DIRECTORY, file), "utf8")),
        ),
      ),
    // A canary for the canary: a detector that silently stopped reporting would make the corpus look
    // clean and this assertion pass, so one document that MUST be reported is scanned alongside it.
    ...scan("synthetic.md", ["## Good :+1: work"]),
  ];
  assert.deepEqual(offenders, [
    "synthetic.md:1 an emoji shortcode shape in a heading, which this reader does not resolve and GitHub replaces whenever it names a known emoji",
  ]);
});

test("the LIVE execution-model document parses, which is what the parser had to buy", () => {
  // The acceptance test for the whole decision. Its fenced blocks sit on list-item continuation
  // lines — the shape that defeated the flat reader in both directions — and many live anchors point
  // into it. The document is named through SPEC_DIRECTORY so this comment carries no real citation.
  const headings = documentHeadings(
    splitLines(
      readFileSync(join(SPEC_DIRECTORY, "execution-model.md"), "utf8"),
    ),
  );
  const slugs = new Set(headings.map(({ slug }) => slug));
  for (const anchor of [
    "execution-safety",
    "trace-and-event-registry",
    "assignable-places-and-mutation",
    "turtle-and-canvas-state",
    "tutor-output-educational-profile",
    "equality-and-ordering",
  ]) {
    assert.ok(slugs.has(anchor), `#${anchor} must resolve`);
  }
  // No phantom heading from inside those fenced blocks.
  assert.ok(
    !headings.some(({ heading }) => heading.startsWith("define ")),
    "no heading may come from inside a fenced code sample",
  );
});

test("a duplicate slug is positional, so a citation can silently RETARGET — both directions", () => {
  // The bound relayed from #1182: resolution proves some heading claims the slug, never that the
  // section the citation meant still claims it. This is inherent to SLUGS, not to any reader, so
  // replacing the hand-rolled reader with a parser did not touch it.
  const slugsOf = (lines) => documentHeadings(lines).map(({ slug }) => slug);
  const headingFor = (lines, wanted) =>
    documentHeadings(lines).findIndex((entry) => entry.slug === wanted);

  // DEMOTION — a colliding heading inserted AHEAD of the cited one takes the bare slug.
  assert.equal(headingFor(["## Alpha", "", "## Notes"], "notes"), 1);
  const afterInsert = ["## Alpha", "", "## Notes", "", "## Notes"];
  assert.equal(headingFor(afterInsert, "notes"), 1);
  assert.equal(headingFor(afterInsert, "notes-1"), 2);

  // PROMOTION — the one that will actually happen: an earlier duplicate is renamed, and the later
  // one inherits the slug it vacated. `#notes` still resolves, to a different section.
  const twoNotes = ["## Notes", "", "## Notes"];
  assert.deepEqual(slugsOf(twoNotes), ["notes", "notes-1"]);
  const renamedFirst = ["## Notes on scope", "", "## Notes"];
  assert.deepEqual(slugsOf(renamedFirst), ["notes-on-scope", "notes"]);
  assert.equal(
    headingFor(twoNotes, "notes"),
    0,
    "#notes named the FIRST section",
  );
  assert.equal(
    headingFor(renamedFirst, "notes"),
    1,
    "and names the SECOND after the rename — silently, gate still green",
  );

  // And the gate really is green across that edit, which is the claim being bounded.
  write(`${CONTRACT}/notes.md`, twoNotes.join("\n"));
  write("cite.md", `See ${CONTRACT}/notes.md#notes.\n`);
  assert.equal(runOverTemp().ok, true);
  write(`${CONTRACT}/notes.md`, renamedFirst.join("\n"));
  assert.equal(
    runOverTemp().ok,
    true,
    "the citation now names a different section and the gate cannot tell",
  );
});

test("an anchor into a document the canary refuses fails rather than being answered", () => {
  // An HTML comment no longer refuses anything — the parser reads it correctly, so `#ghost` is a
  // real heading now. Four refusals survive, and each must refuse END TO END, not merely in
  // unsupportedConstructs: a detector that reports a hazard the gate then answers anyway would be
  // the "automatic tolerance" #893's reviewers deleted.
  for (const [name, heading, pattern] of [
    ["emoji", "## Good :+1: work", /an emoji shortcode shape in a heading/],
    [
      "entity",
      "## Good &copy; work",
      /the entity reference &copy; in a heading/,
    ],
    ["rawhtml", '## Good <img alt="a>b"> work', /raw inline HTML in a heading/],
    [
      "disputed",
      "## Good &#00000065; work",
      /digit count CommonMark and GitHub's renderer disagree about/,
    ],
  ]) {
    write(
      `${CONTRACT}/${name}.md`,
      ["# Title", "", heading, "", "text"].join("\n"),
    );
    write(
      "cite.md",
      `See ${CONTRACT}/${name}.md#good-1-work and ${CONTRACT}/${name}.md#title.\n`,
    );
    const result = runOverTemp();
    assert.equal(result.ok, false, name);
    const report = result.lines.join("\n");
    assert.match(report, pattern);
    // The remedy a maintainer can actually apply is named — and it is the ONLY one. The message
    // used to offer "or cite this document by line instead", which is advice the gate itself now
    // rejects: an author who followed it produced a citation the rule forbids.
    assert.match(
      report,
      /Remove the construct from the heading; there is no second option/,
    );
    assert.doesNotMatch(report, /cite this document by line/);
    // Once per document, not once per anchor: two anchors, one report. Counted over the canary
    // sentence rather than the bare construct, because the coverage statement names the refusals too
    // — matching the construct alone would count the statement and pass for the wrong reason.
    assert.equal(
      report.match(/this document contains /g).length,
      1,
      `${name}: canary must report once per document`,
    );
    rmSync(join(TEMP_DIR, CONTRACT, `${name}.md`));
  }
});

test("formatAnchor renders the citable form back", () => {
  assert.equal(
    formatAnchor({ specDirectory: "s", file: "g.md", fragment: "a-heading" }),
    "s/g.md#a-heading",
  );
});

test("rejoinedFragment identifies a slug hard-wrapped across a line break, and nothing else", () => {
  const headings = [{ slug: "collections-records-and-comprehensions" }];
  assert.equal(
    rejoinedFragment(
      "collections-",
      "records-and-comprehensions`), not a lambda",
      headings,
    ),
    "collections-records-and-comprehensions",
  );
  assert.equal(
    rejoinedFragment(
      "collections-",
      " * records-and-comprehensions`)",
      headings,
    ),
    "collections-records-and-comprehensions",
  );
  // Only an EXACT match is reported, so this is a finding rather than a guess.
  assert.equal(
    rejoinedFragment("collections-", "something else entirely", headings),
    null,
  );
  assert.equal(rejoinedFragment("collections-", "", headings), null);
  assert.equal(rejoinedFragment("collections-", undefined, headings), null);
});

test("collectCitations returns section anchors beside citations, from one pass", () => {
  const text = [
    "// contract/conformance.md#heritage names a section, contract/syntax-rules.md:4 a line.",
    "// A trailing colon is prose, not part of the slug: contract/conformance.md#sprites:",
  ].join("\n");
  const { citations, anchors } = collectCitations("a.ts", text, CONTRACT);
  assert.deepEqual(
    anchors.map((anchor) => `${anchor.line}:${formatAnchor(anchor)}`),
    [
      `1:${CONTRACT}/conformance.md#heritage`,
      `2:${CONTRACT}/conformance.md#sprites`,
    ],
  );
  // The line form is still ENUMERATED — it has to be, or it could not be rejected.
  assert.deepEqual(
    citations.map(
      (citation) => `${citation.file}:${citation.start}:${citation.form}`,
    ),
    ["syntax-rules.md:4:explicit"],
  );
});

/** A document with headings worth citing, plus a `#` line hidden inside a fence. */
const SECTIONS = [
  "# Conformance", // 1
  "", // 2
  "## Heritage", // 3
  "", // 4
  "```logo", // 5
  "# Sprites", // 6
  "```", // 7
  "", // 8
  "## Turtle & Rendering", // 9
  "", // 10
  "Prose.", // 11
].join("\n");

/** Write the sections fixture and return its citable name. */
function writeSections() {
  write(`${CONTRACT}/conformance.md`, SECTIONS);
  return `${CONTRACT}/conformance.md`;
}

test("THE PREFIX-LESS FORMS are rejected, and the relative anchor inside spec/ is not", () => {
  // The hole saga #1180 would otherwise have left open. A `<file>.md:12` written without the
  // directory prefix is a line claim like any other, and until it was enumerated the gate could
  // report zero line citations while 60 of them sat in the tree — an instrument reporting success
  // over a corpus it could not see.
  writeGrammar();
  write("bare.md", `See syntax-rules.md:8 for the selector production.\n`);
  const rejected = runOverTemp();
  assert.equal(rejected.ok, false);
  const report = rejected.lines.join("\n");
  assert.match(
    report,
    /syntax-rules\.md:8 names a LINE, and omits the contract\/ prefix/,
  );
  // The remedy names BOTH corrections — the section AND the prefix — because fixing only the form
  // would leave an anchor that nothing checks.
  assert.match(
    report,
    /Cite the section, WITH the prefix — contract\/syntax-rules\.md#ebnf-notation/,
  );
  assert.equal(rejected.counts.prefixLess, 1);
  assert.match(report, /0 bare, 1 prefix-less/);

  // The ANCHOR half, OUTSIDE the specification directory: not a line claim, so it does not drift —
  // but nothing resolves it either, and ADR-0036 admits exactly one form.
  write(
    "bare.md",
    `See syntax-rules.md#ebnf-notation for the selector production.\n`,
  );
  const unprefixed = runOverTemp();
  assert.equal(
    unprefixed.ok,
    false,
    "an unprefixed anchor outside spec/ is checked by nothing, so it is rejected",
  );
  assert.equal(unprefixed.counts.unprefixedAnchors, 1);
  assert.match(
    unprefixed.lines.join("\n"),
    /omits the contract\/ prefix, so nothing resolves it — write contract\/syntax-rules\.md#ebnf-notation/,
  );

  // INSIDE the specification directory the same anchor is the normal way one document links to a
  // sibling, and 71 such links exist. Rejecting it there would break every one of them to fix none.
  rmSync(join(TEMP_DIR, "bare.md"));
  write(
    `${CONTRACT}/sibling.md`,
    "# Sibling\n\nSee syntax-rules.md#ebnf-notation for the rule.\n",
  );
  const inside = runOverTemp();
  assert.equal(
    inside.ok,
    true,
    "a relative anchor inside the specification directory must keep working",
  );
  assert.equal(inside.counts.unprefixedAnchors, 0);
});

test("an AMBIGUOUS basename is never attributed to the specification", () => {
  // A README exists at the repository root and in most packages, so citing one bare almost
  // certainly means a neighbour. Attributing it to the specification would be the gate inventing a
  // citation the author did not write — a false positive, which is fatal in a gate with no
  // tolerance. The exclusion is a property of the tree, recomputed every run, not a maintained list.
  writeGrammar();
  write(`${CONTRACT}/README.md`, "# Readme\n\n## Overview\n\ntext\n");
  write("README.md", "# Repository readme\n\n## Overview\n");
  write("cites.md", "See README.md:3 and README.md#overview here.\n");
  const result = runOverTemp();
  assert.equal(result.ok, true, "an ambiguous basename must be left alone");
  assert.equal(result.counts.prefixLess, 0);
  assert.equal(result.counts.unprefixedAnchors, 0);

  // The unambiguous document beside it is still caught, so the guard narrows rather than disabling.
  write("cites.md", "See README.md#overview and syntax-rules.md:8 here.\n");
  assert.equal(runOverTemp().counts.prefixLess, 1);

  assert.deepEqual(
    [
      ...unambiguousSpecDocuments(join(TEMP_DIR, CONTRACT), [
        join(TEMP_DIR, CONTRACT, "syntax-rules.md"),
        join(TEMP_DIR, CONTRACT, "README.md"),
        join(TEMP_DIR, "README.md"),
      ]),
    ],
    ["syntax-rules.md"],
  );
});

test("a DOUBLED directory prefix is rejected, not read as the valid citation inside it", () => {
  // `<dir>/<dir>/x.md#y` names nothing. Without the lookbehind the scan fails at the first prefix,
  // resumes one character later, and enumerates the inner substring as a perfectly good citation —
  // so a path resolving nowhere passed the gate. A blanket search-and-replace produced exactly that
  // shape in shipped source, and the gate could not see what the replace had done.
  writeSections();
  write(
    "doubled.md",
    `See ${CONTRACT}/${CONTRACT}/conformance.md#heritage here.\n`,
  );
  const doubled = runOverTemp();
  assert.equal(doubled.ok, false, "a doubled prefix must not resolve");
  assert.equal(
    doubled.counts.sectionAnchors,
    0,
    "and must not be counted as a good anchor",
  );

  // A RELATIVE path carrying the directory segment is a different shape and stays matched, because
  // it names a real document and resolving it beats ignoring it.
  write("doubled.md", `See ../../${CONTRACT}/conformance.md#heritage here.\n`);
  const relative = runOverTemp();
  assert.equal(relative.ok, true);
  assert.equal(relative.counts.sectionAnchors, 1);
});

test("the prefix-less rule is structural, and the LINE form has no code carve-out", () => {
  // The document-identity guard is a rule rather than a list, which is what the no-exemptions
  // instruction requires.
  writeGrammar();

  // (a) A document the specification directory does not publish is not adopted.
  write("other.md", `See changelog.md:8 and notes.md:3 for context.\n`);
  assert.equal(runOverTemp().ok, true, "an unknown document is not a citation");

  // (b) The LINE form is rejected WHEREVER it appears, including inside a string literal in live
  // code. An earlier version of this gate required a prose line here, which meant a real citation
  // written in a `test(...)` title was invisible to the very gate that bans it — two such citations
  // had already been found and hand-converted, and disclosing the hole in the coverage statement is
  // not the same as closing it. The cost is named rather than hidden: test data that mirrors this
  // gate's own `document:line:form` output now trips it if the document is one the specification
  // publishes. The remedy is to name fixtures after documents the specification does NOT publish —
  // which this suite now does, and which is better practice anyway, because a fixture sharing a
  // real document's name is one rename away from being mistaken for it.
  write(
    "assertions.mjs",
    [
      "const expected = [",
      '  "syntax-rules.md:4:explicit",',
      '  "syntax-rules.md:9:comma-tail",',
      "];",
      "",
    ].join("\n"),
  );
  assert.equal(
    runOverTemp().ok,
    false,
    "the line form is rejected in code exactly as it is in prose",
  );

  // And the same characters in a comment are rejected identically — the point being that there is
  // no longer any difference between the two, which is what "no carve-out" means.
  write("assertions.mjs", "// syntax-rules.md:4 is the selector production.\n");
  assert.equal(runOverTemp().ok, false);
  assert.match(runOverTemp().lines.join("\n"), /omits the contract\/ prefix/);
});

test("the unprefixed ANCHOR form is rejected in code as well as prose", () => {
  // An earlier round kept a prose guard here, arguing an anchor-shaped token in code "is not a
  // citation anybody wrote". A reviewer refuted that with a test title naming a document and a
  // heading fragment — plainly a citation. What actually separates a citation from an incidental
  // token is DOCUMENT IDENTITY: the document must be one the specification publishes and its
  // basename must be unambiguous repo-wide. That rule does the work, in code and in prose alike.
  writeGrammar();
  write("code.mjs", 'expect(link).toBe("syntax-rules.md#ebnf-notation");\n');
  assert.equal(
    runOverTemp().ok,
    false,
    "an anchor naming a published document is a citation wherever it is written",
  );
  // An AMBIGUOUS basename is still left alone, which is what keeps this a rule and not a dragnet.
  write("code.mjs", 'expect(link).toBe("README.md#overview");\n');
  assert.equal(runOverTemp().ok, true);
});

test("each line form keeps its own identity, whatever else sits on the line", () => {
  // Three forms on one line — prefixed, prefix-less, and bare — must each be enumerated under their
  // own form so the summary counters cannot silently merge them. This used to also pin an ordering
  // property ("a prefix-less reference never consumes a bare attribution"), which no longer exists:
  // there is no attribution queue to consume from.
  writeGrammar();
  const { citations } = collectCitations(
    "mixed.ts",
    "// contract/syntax-rules.md:6 and syntax-rules.md:13 and later :8 as well.\n",
    CONTRACT,
    new Set(["syntax-rules.md"]),
  );
  assert.deepEqual(
    citations.map(
      (citation) => `${citation.file}:${citation.start}:${citation.form}`,
    ),
    [
      "syntax-rules.md:6:explicit",
      "syntax-rules.md:13:prefix-less",
      "syntax-rules.md:8:bare",
    ],
  );
});

test("a fragment may be closed by punctuation before a QUOTE, but not before a bracket", () => {
  // A sentence inside a JSON string ends `…#a-heading."`, where the `.` is prose and the `"` closes
  // the string — nothing inside a URL can follow a quote. A markdown link destination runs to its
  // `)`, so there the `.` really does belong to the fragment. That asymmetry is what lets the gate
  // accept the first without ever parsing a link destination, and it is pinned in both directions
  // because conversion produced six of the first shape.
  const malformedIn = (text) =>
    collectCitations("a.md", text, CONTRACT).anchors[0].malformed;
  assert.equal(
    malformedIn(`{"d": "see ${CONTRACT}/d.md#real-heading."}`),
    false,
  );
  assert.equal(malformedIn(`'see ${CONTRACT}/d.md#real-heading.'`), false);
  assert.equal(malformedIn(`[bad](${CONTRACT}/d.md#real-heading.)`), true);
  assert.equal(malformedIn(`[bad](${CONTRACT}/d.md#real-heading.]`), true);

  // THE TITLE SHAPE, now rejected rather than accepted as a stated limit. A markdown link title
  // puts a quote where a closing string quote would sit, so the rule looks one character further:
  // the quote must itself be followed by end-of-input, whitespace, or a token closer. A letter
  // after it means the quote opened something rather than closing it.
  assert.equal(
    malformedIn(`[t](${CONTRACT}/d.md#real-heading."Title")`),
    true,
    "a link title must not read as a closing string quote",
  );
  assert.equal(
    malformedIn(`[t](${CONTRACT}/d.md#real-heading. "Title")`),
    false,
    "the SPACED title spelling is accepted — it is indistinguishable from the cite-then-quote idiom",
  );
  // Which is the reason: that shape is live, correct prose in this corpus, and failing it would be
  // a false positive — fatal in a gate with no tolerance.
  assert.equal(
    malformedIn(
      `see ${CONTRACT}/d.md#real-heading: "OpenLogo never exposes NaN or Infinity"`,
    ),
    false,
  );
  assert.equal(
    malformedIn(
      `see ${CONTRACT}/d.md#real-heading, "alternate spellings only"`,
    ),
    false,
  );
  // And the JSON shapes the widening exists to admit still pass, in every terminator.
  assert.equal(
    malformedIn(`{"d": "see ${CONTRACT}/d.md#real-heading.",`),
    false,
  );
  assert.equal(malformedIn(`see ${CONTRACT}/d.md#real-heading."`), false);
  // A BACKTICK opens a code span, never a link title, so ordinary prose that follows a citation with
  // one stays accepted.
  assert.equal(
    malformedIn("see " + CONTRACT + "/d.md#real-heading: `#` starts a comment"),
    false,
  );
});

test("specDocuments reads the directory, and an EMPTY oracle FAILS the gate", () => {
  // Shared with the converter rather than written twice: the two modules keep their deliberately
  // different site-finding, but disagreeing about which documents EXIST would let one enumerate a
  // citation the other could not see.
  write(`${CONTRACT}/syntax-rules.md`, "# Grammar\n");
  write(`${CONTRACT}/commands.md`, "# Commands\n");
  write(`${CONTRACT}/README.md`, "# Readme\n");
  write(`${CONTRACT}/notes.txt`, "not markdown\n");
  assert.deepEqual([...specDocuments(join(TEMP_DIR, CONTRACT))].sort(), [
    "README.md",
    "commands.md",
    "syntax-rules.md",
  ]);
  // The helper itself stays total — a caller may legitimately point at a tree with no specification
  // directory — so the loudness lives where the consequence does.
  assert.deepEqual([...specDocuments(join(TEMP_DIR, "absent"))], []);

  // An empty oracle disables the prefix-less rule AND the file-skip test then hides every file that
  // carries no prefixed mention — so a misconfigured run reports zero line citations over a corpus
  // full of them. Disclosure was not enough: a report can be read past, an exit code cannot.
  const misconfigured = runSpecCitationsGate({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, "absent"),
  });
  assert.equal(misconfigured.ok, false);
  assert.match(
    misconfigured.lines.join("\n"),
    /a green run here would mean the rule was switched off, not that the tree is clean/,
  );

  // And an ABSOLUTE spec root must not defeat the uniqueness oracle. Comparing an absolute root
  // against git's repository-relative paths made every document look like a collision, emptying the
  // oracle under a perfectly valid configuration.
  const absolute = runSpecCitationsGate({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: resolve(join(TEMP_DIR, CONTRACT)),
  });
  assert.ok(
    !absolute.lines.join("\n").includes("publishes no .md document"),
    "an absolute spec root must still populate the oracle",
  );
});

test("an UPPERCASE document is a document, so a citation of it is enumerated", () => {
  // The oracle publishes every `.md` in the directory, `README.md` included. A filename class that
  // could not match an initial capital was a blind spot shared by BOTH instruments — and because
  // they shared it, their cross-check could never have exposed it.
  write(`${CONTRACT}/README.md`, ["# Readme", "", "Prose here."].join("\n"));
  write("cites.md", "See README.md:3 for the overview.\n");
  const result = runOverTemp();
  assert.equal(
    result.ok,
    false,
    "an uppercase document must not be a blind spot",
  );
  assert.equal(result.counts.prefixLess, 1);
  assert.match(
    result.lines.join("\n"),
    /README\.md:3 names a LINE, and omits the contract\/ prefix/,
  );
});

test("a file carrying ONLY prefix-less references is still scanned, and its citations ordered", () => {
  // The skip test used to key on the `<dir>/` prefix alone, so a file with no prefixed mention was
  // never opened — which is precisely how 60 prefix-less references stayed invisible while the gate
  // reported zero line citations. Two references, so the ordering of the early-return path is
  // exercised rather than assumed.
  writeGrammar();
  write(
    "only-bare.md",
    [
      "Later prose cites syntax-rules.md:13.",
      "",
      "Earlier prose cites syntax-rules.md:5.",
    ].join("\n"),
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.equal(result.counts.prefixLess, 2);
  assert.equal(result.counts.files, 1);
  const report = result.lines.join("\n");
  // Reported in FILE order, so a maintainer reads them the way the file reads.
  assert.ok(
    report.indexOf("only-bare.md:1") < report.indexOf("only-bare.md:3"),
    "findings must follow the order of the file",
  );
  assert.match(report, /only-bare\.md:1: syntax-rules\.md:13 names a LINE/);
  assert.match(report, /only-bare\.md:3: syntax-rules\.md:5 names a LINE/);
});

test("a link DESTINATION is judged by the parser, so a title cannot disguise a broken href", () => {
  // The shape prose trimming cannot see. A markdown link may carry a title after its destination, so
  // `[t](x.md#frag. "Title")` puts a quote exactly where a closing string quote sits — and the real
  // href is `x.md#frag.`, with the full stop inside it. Telling that from the corpus's ordinary
  // cite-then-quote idiom needs to know whether the citation sits in a destination, which is what
  // two earlier reviewers deleted a HAND-ROLLED parser for. `marked` already parses these documents
  // for headings, so the hrefs come from the same parse.
  writeGrammar();
  const run = (body) => {
    write("probe.md", body);
    return runOverTemp();
  };
  assert.equal(
    run(`[t](${CONTRACT}/syntax-rules.md#ebnf-notation. "Title")\n`).ok,
    false,
    "a spaced title must not disguise an href ending in punctuation",
  );
  assert.equal(
    run(`[t](${CONTRACT}/syntax-rules.md#ebnf-notation."Title")\n`).ok,
    false,
    "nor the unspaced spelling",
  );
  // And the shapes that must keep passing — a clean link, and the prose idiom that made rejecting
  // punctuation-space-quote by pattern a false positive in four live places.
  assert.equal(
    run(`[t](${CONTRACT}/syntax-rules.md#ebnf-notation)\n`).ok,
    true,
  );
  assert.equal(
    run(`see ${CONTRACT}/syntax-rules.md#ebnf-notation: "quoted spec text"\n`)
      .ok,
    true,
  );
  assert.equal(
    run(`see ${CONTRACT}/syntax-rules.md#ebnf-notation.\n`).ok,
    true,
  );

  // The destination reader itself, pinned on the hrefs marked actually reports.
  assert.deepEqual(
    [
      ...linkDestinations(
        `[t](${CONTRACT}/syntax-rules.md#ebnf-notation. "T")\n`,
      ),
    ],
    [`${CONTRACT}/syntax-rules.md#ebnf-notation.`],
  );
  // A table cell and a list item are walked too, so a link cannot hide in one.
  assert.deepEqual(
    [...linkDestinations("| a |\n|---|\n| [t](x.md#y) |\n")],
    ["x.md#y"],
  );
  assert.deepEqual([...linkDestinations("- [t](z.md#w)\n")], ["z.md#w"]);
});

test("an anchor naming a real heading passes and is counted on its own counter", () => {
  writeSections();
  write("ok.md", `See ${CONTRACT}/conformance.md#heritage for the profile.\n`);
  write("also.md", `And ${CONTRACT}/conformance.md#turtle--rendering.\n`);
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.sectionAnchors, 2);
  // The line-form counters stay at zero, which is the whole point of the sweep.
  assert.equal(result.counts.citations, 0);
  assert.equal(result.counts.explicit, 0);
  assert.equal(result.counts.files, 2);
  assert.match(
    result.lines.join("\n"),
    /2 section anchor\(s\), 0 line fragment\(s\)/,
  );
});

test("an anchor naming a heading that does not exist FAILS, naming file, anchor and site", () => {
  writeSections();
  write(
    "bad.md",
    `See ${CONTRACT}/conformance.md#educational for the profile.\n`,
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  const report = result.lines.join("\n");
  assert.match(
    report,
    /bad\.md:1: contract\/conformance\.md#educational does not resolve/,
  );
  assert.match(report, /no heading in conformance\.md slugs to "educational"/);
  // There is nowhere to record that it may fail, and the report must not offer one.
  assert.doesNotMatch(report, /exceptions/);
  assert.doesNotMatch(report, /UNRESOLVED/);
});

test("a `#` line inside a fenced block is not a heading an anchor can reach", () => {
  // The false-pass this guards: `# Sprites` is an OpenLogo comment in a code sample, so GitHub
  // renders no heading and #sprites resolves nowhere.
  writeSections();
  write("bad.md", `See ${CONTRACT}/conformance.md#sprites.\n`);
  assert.equal(runOverTemp().ok, false);
});

test("an anchor naming a document that does not exist fails, and says so", () => {
  writeSections();
  write("gone.md", `See ${CONTRACT}/absent.md#heritage.\n`);
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /contract\/absent\.md does not exist/);
});

test("duplicate headings are both reachable — #dup and #dup-1 each resolve", () => {
  write(
    `${CONTRACT}/dupes.md`,
    ["## Notes", "", "text", "", "## Notes", "", "more"].join("\n"),
  );
  write(
    "ok.md",
    `Both ${CONTRACT}/dupes.md#notes and ${CONTRACT}/dupes.md#notes-1 resolve.\n`,
  );
  assert.equal(runOverTemp().ok, true);

  write("bad.md", `But ${CONTRACT}/dupes.md#notes-2 does not.\n`);
  assert.equal(runOverTemp().ok, false);
});

test("an anchor broken by a line break says so, instead of reading as a misspelling", () => {
  // The live instance this comes from: a design note wrapped a long slug across a line break, so the
  // gate saw `#collections-`. Named as a wrap, the failure explains itself; left as a near-miss it
  // sends the author hunting for a heading that was never wrong.
  write(
    `${CONTRACT}/syntax-rules.md`,
    [
      "# Grammar",
      "",
      "## Collections, records, and comprehensions",
      "",
      "text",
    ].join("\n"),
  );
  write(
    "note.md",
    [
      `are recognized by their leading keyword (\`${CONTRACT}/syntax-rules.md#collections-`,
      "records-and-comprehensions`), not a lambda argument.",
    ].join("\n"),
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  const report = result.lines.join("\n");
  assert.match(report, /hard-wrapped across a line break/);
  assert.match(report, /reads "#collections-records-and-comprehensions"/);
});

test("a malformed or dangling fragment fails at the gate, and a wrap says so", () => {
  writeSections();
  // Truncated by a character no slug can hold: the prefix must NOT be accepted.
  write("bad.md", `See ${CONTRACT}/conformance.md#heritage.extra for it.\n`);
  const malformed = runOverTemp();
  assert.equal(malformed.ok, false);
  assert.match(malformed.lines.join("\n"), /no heading slug can contain/);
  assert.equal(malformed.counts.sectionAnchors, 1);

  // A `#` with the slug hard-wrapped onto the next line. This shape was previously not enumerated at
  // all — the fragment class required one character, so the `#` fell through as a plain file mention
  // and one genuinely broken live citation sat green under a gate that claimed to check anchors.
  write(
    "bad.md",
    [
      `// no new semantics (${CONTRACT}/conformance.md#`,
      "// heritage), so these aliases are Core.",
    ].join("\n"),
  );
  const dangling = runOverTemp();
  assert.equal(dangling.ok, false);
  const report = dangling.lines.join("\n");
  assert.match(report, /the "#" names no heading/);
  assert.match(report, /hard-wrapped across a line break/);
  assert.match(report, /reads "#heritage"/);
});

// --- MUTATION: the gate's own proof that it can go red ------------------------------------------

test("MUTATION: converting a line citation to its enclosing anchor turns the gate green", () => {
  // The sweep's central claim in miniature, run in both directions. A gate that only ever showed
  // green would prove nothing, and one that only ever showed red would be unusable — so the same
  // site is written both ways and the gate must disagree about them.
  writeGrammar();
  const line = "// contract/syntax-rules.md:8 defines the selector.\n";
  write("site.ts", line);
  const rejected = runOverTemp();
  assert.equal(rejected.ok, false, "the line form must be rejected");
  assert.equal(rejected.counts.citations, 1);
  assert.equal(rejected.counts.sectionAnchors, 0);

  // Exactly the anchor the failure told the author to write.
  write(
    "site.ts",
    "// contract/syntax-rules.md#ebnf-notation defines the selector.\n",
  );
  const accepted = runOverTemp();
  assert.equal(accepted.ok, true, "the anchor the gate suggested must pass");
  assert.equal(accepted.counts.citations, 0);
  assert.equal(accepted.counts.sectionAnchors, 1);

  // And going back must go red again, so the green above is not an artefact of ordering.
  write("site.ts", line);
  assert.equal(runOverTemp().ok, false);
});

test("MUTATION: repointing an anchor at a DIFFERENT section that still resolves fails", () => {
  // The hard case, and the one a resolution-only gate cannot see: #expressions-and-calls is a real
  // heading — it is simply not where `selector` is defined. This is issue #934's instance 4 at the
  // granularity citations now have, and it is what the quotation check was re-pointed to catch.
  writeGrammar();
  const good =
    '// contract/syntax-rules.md#ebnf-notation, `selector ::= "[" key-term "]"`, is the form.\n';
  write("site.ts", good);
  assert.equal(runOverTemp().ok, true);

  write("site.ts", good.replace("#ebnf-notation", "#expressions-and-calls"));
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(
    result.lines.join("\n"),
    /is quoted here but is not in contract\/syntax-rules\.md#expressions-and-calls/,
  );
  assert.match(result.lines.join("\n"), /still points at the wrong section/);

  write("site.ts", good);
  assert.equal(runOverTemp().ok, true);
});

test("MUTATION: a quotation whose wording drifts from the production fails", () => {
  // #933's mode-2 case: a production quoted with a name elided, where the elided word was the point.
  writeGrammar();
  write(
    "site.ts",
    '// contract/syntax-rules.md#ebnf-notation, `selector ::= "[" term "]"`, is the form.\n',
  );
  assert.equal(runOverTemp().ok, false);
});

test("MUTATION: a real heading from the LIVE corpus resolves; one corrupted character goes red", () => {
  // The headline proof for issue #1181, and the discipline #934 records as most often skipped: a
  // gate that passes on deliberately broken input asserts nothing.
  //
  // **The baseline is NOT computed by the code under test.** Deriving the expected slug from
  // `documentHeadings()` and then checking it with a gate built on `documentHeadings()` makes both
  // sides agree under any systematic slug error — the review that found this also found several such
  // errors, every one of which had survived a green suite. So the heading and its fragment are
  // written out as literals, hand-verified against GitHub's rule, and the heading's existence is
  // confirmed by a raw line scan: a differently-shaped instrument from the one under test. Renaming
  // that heading now fails this test loudly instead of silently moving the goalposts.
  //
  // The citing fixture names `contract/`, but `specRoot` points the READER at the real
  // specification directory, so the document is the one that ships while this test file — which the
  // gate scans in CI — carries no real citation of its own.
  const document = "conformance.md";
  const heading = "### Heritage";
  const known = "heritage";
  assert.ok(
    splitLines(readFileSync(join(SPEC_DIRECTORY, document), "utf8")).some(
      (line) => line.trimEnd() === heading,
    ),
    `${document} must still contain the exact heading line "${heading}"`,
  );

  const runAgainstRealCorpus = () =>
    runSpecCitationsGate({
      roots: [TEMP_DIR],
      specDirectory: CONTRACT,
      specRoot: SPEC_DIRECTORY,
    });
  const cite = (fragment) =>
    write("site.md", `The profile is ${CONTRACT}/${document}#${fragment}.\n`);

  cite(known);
  const before = runAgainstRealCorpus();
  assert.equal(before.ok, true, "the known-good anchor must pass first");
  assert.equal(before.counts.sectionAnchors, 1);

  // One character, so the result is a plausible typo rather than an obvious wreck — the shape a
  // renamed or mistyped heading actually takes.
  const corrupted = "heritagf";
  assert.notEqual(corrupted, known);
  cite(corrupted);
  const mutated = runAgainstRealCorpus();
  assert.equal(mutated.ok, false, "one corrupted character must go red");
  assert.match(mutated.lines.join("\n"), /does not resolve/);
  // A near miss is described and STILL fails. Suggesting is not accepting.
  assert.match(
    mutated.lines.join("\n"),
    new RegExp(`did you mean "#${known}"`),
  );

  cite(known);
  assert.equal(
    runAgainstRealCorpus().ok,
    true,
    "restoring must return the gate to green",
  );
});

// --- CLI shell (subprocess; outside the loaded-module coverage set per ADR-0009) ----------------

/** Run the CLI over the temp tree (or a narrower root), returning its exit status and output. */
function runCli(root = TEMP_DIR) {
  const result = spawnSync(
    process.execPath,
    [
      join("scripts", "check-spec-citations.mjs"),
      `--root=${root}`,
      `--spec-dir=${CONTRACT}`,
      `--spec-root=${join(TEMP_DIR, CONTRACT)}`,
    ],
    { encoding: "utf8" },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("the CLI exits 0 and prints the report when every citation is an anchor", () => {
  writeGrammar();
  write("ok.ts", "// contract/syntax-rules.md#ebnf-notation is fine.\n");
  const { status, output } = runCli();
  assert.equal(status, 0);
  assert.match(output, /spec citations: 0 line-form citation\(s\) REJECTED/);
  // Even a green CLI run says it was scoped, so a passing line from a narrowed invocation can never
  // be quoted as the repository's result.
  assert.match(output, /SCOPED RUN/);
});

test("the CLI exits non-zero on a line citation, including from a narrowed root", () => {
  writeGrammar();
  write("nested/bad.ts", "// contract/syntax-rules.md:8 names a line.\n");
  const whole = runCli();
  assert.equal(whole.status, 1);
  assert.match(whole.output, /FAIL/);
  assert.match(whole.output, /names a LINE/);
  // Narrowing the root to the offending directory must not narrow the RULE. This is the shape the
  // superseded ratchet got wrong, exercised end to end through the actual entry point CI runs.
  const narrowed = runCli(join(TEMP_DIR, "nested"));
  assert.equal(narrowed.status, 1);
  assert.match(narrowed.output, /names a LINE/);
  assert.match(
    narrowed.output,
    /Cite the section instead — contract\/syntax-rules\.md#ebnf-notation/,
  );
});

// Unit + regression tests for the spec-citation DoD gate (issue #934). These import
// scripts/spec-citations-gate.mjs's logic directly (for 100% coverage) plus subprocess tests for the
// CLI shell (scripts/check-spec-citations.mjs), pointed at isolated temp fixtures via
// --root/--spec-dir/--spec-root/--exceptions rather than the real corpus.
//
// Fixtures name a `contract/` directory, never the real specification directory. That is deliberate:
// this file is itself scanned by the gate in CI, so a deliberately-broken fixture citation written
// with the real prefix would be indistinguishable from a real defect in the tree.
//
// The MUTATION block at the end is the gate's own proof that it can go red — the same discipline as
// tests/conformance/_harness-selftest/, whose fixtures deliberately declare expect: "mismatch". A
// gate that passes on deliberately broken input asserts nothing, which #934 records as the single
// most repeated defect in this saga. Every way this gate is supposed to fail therefore has a test
// that corrupts a known-good citation and asserts it actually fails — including the hard case, where
// the mutation repoints a citation at a DIFFERENT section that still resolves to non-blank text.

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
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  EXCEPTIONS_PATH,
  EXCEPTION_KINDS,
  SCAN_EXCLUSIONS,
  SPEC_DIRECTORY,
  STATUS_CLAIM_PHRASES,
  auditRunQuotations,
  closestHeadingSlug,
  collectCitations,
  collectStatusClaims,
  decodeEntities,
  documentHeadings,
  editDistance,
  expandCommaTail,
  flattenProseRun,
  formatAnchor,
  formatCitation,
  isProseLine,
  lineLookup,
  listCitationFiles,
  loadExceptions,
  normalizeQuotation,
  parseArgs,
  proseRuns,
  quotationIsPresent,
  readTextFile,
  rejoinedFragment,
  resolveAnchor,
  resolveCitation,
  runSpecCitationsGate,
  siteFingerprint,
  SLUG_CHARACTER,
  splitLines,
  suggestException,
  suggestionDistance,
  toPosixPath,
  unsupportedConstructs,
  validateExceptionEntry,
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

/** The manifest key a file written by {@link write} gets. */
function keyFor(name) {
  return `${toPosixPath(TEMP_DIR)}/${name}`;
}

/** Run the gate over the temp tree with an inline (already-parsed) exceptions manifest. */
function runOverTemp(exceptions = {}) {
  return runSpecCitationsGate({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
    exceptions,
  });
}

/** A small grammar document whose productions sit at known lines. */
const GRAMMAR = [
  "# Grammar", // 1
  "", // 2
  "```ebnf", // 3
  'colon-place         ::= ":" name { postfix }', // 4
  'postfix             ::= selector | "." identifier', // 5
  'selector            ::= "[" key-term "]"', // 6
  "```", // 7
  "", // 8
  "Prose after the block.", // 9
].join("\n");

/** Write the grammar fixture and return its citable name. */
function writeGrammar() {
  write(`${CONTRACT}/grammar.md`, GRAMMAR);
  return `${CONTRACT}/grammar.md`;
}

test("toPosixPath, splitLines and formatCitation render the shapes the manifest keys on", () => {
  assert.equal(toPosixPath(join("a", "b", "c.md")), "a/b/c.md");
  assert.deepEqual(splitLines("a\r\nb\nc"), ["a\r", "b", "c"]);
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
  // line, which silently mis-attributes every citation in a CRLF working tree.
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

test("collectCitations enumerates explicit citations, comma tails and bare references together", () => {
  const text = [
    "// see contract/grammar.md:4-6,9 and also :5 for the postfix rule",
    "// and contract/other.md then :7 belongs to that one",
  ].join("\n");
  const { citations } = collectCitations("a.ts", text, CONTRACT);
  assert.deepEqual(
    citations.map(
      (citation) => `${citation.file}:${citation.start}:${citation.form}`,
    ),
    [
      "grammar.md:4:explicit",
      "grammar.md:9:comma-tail",
      "grammar.md:5:context-reference",
      "other.md:7:context-reference",
    ],
  );
});

test("a bare reference resolves to the document an earlier anchor gave it, not the nearest mention", () => {
  // The real case: packages/parser/src/keywords.ts names a `:408` ruling four lines after mentioning
  // a different document, and only the earlier full anchor says which document `:408` belongs to.
  const text = [
    "// contract/grammar.md:408 makes profile words built-in names.",
    "// Painting is contract/tooling.md:30's keyword row.",
    "// Issue #855 aligned the rest of the spec with the :408 ruling.",
  ].join("\n");
  const { citations } = collectCitations("a.ts", text, CONTRACT);
  const back = citations.find((citation) => citation.form === "back-reference");
  assert.equal(back.file, "grammar.md");
  assert.equal(back.start, 408);
});

test("a line spec two documents both anchor is ambiguous, so it falls back to context", () => {
  const text = [
    "// contract/grammar.md:12 and contract/tooling.md:12 both matter.",
    "// Later, contract/other.md says :12 again.",
  ].join("\n");
  const { citations } = collectCitations("a.ts", text, CONTRACT);
  const last = citations.at(-1);
  assert.equal(last.form, "context-reference");
  assert.equal(last.file, "other.md");
});

test("a bare reference in live code is not a citation, and one before any mention is reported", () => {
  const text = [
    "const label = formatRatio(value) + ':1 contrast';",
    "// :77 appears before this file names any document",
    "// contract/grammar.md:4 is the first mention",
  ].join("\n");
  const { citations, unattributed } = collectCitations("a.ts", text, CONTRACT);
  assert.deepEqual(
    citations.map((citation) => citation.start),
    [4],
  );
  assert.deepEqual(unattributed, [{ line: 2, text: ":77" }]);
});

test("collectCitations returns nothing for a file that names no document", () => {
  const { citations, unattributed } = collectCitations(
    "a.ts",
    "// nothing here, not even a bare :12",
    CONTRACT,
  );
  assert.deepEqual(citations, []);
  assert.deepEqual(unattributed, []);
});

test("resolveCitation names exactly how a citation fails, and accepts one that lands on text", () => {
  const lines = ["alpha", "", "gamma"];
  assert.equal(resolveCitation({ start: 1 }, lines), null);
  assert.equal(resolveCitation({ start: 2, end: 3 }, lines), null);
  assert.equal(
    resolveCitation({ specDirectory: "s", file: "g.md", start: 1 }, null)
      .status,
    "missing-file",
  );
  assert.equal(
    resolveCitation({ start: 3, end: 2 }, lines).status,
    "inverted-range",
  );
  assert.equal(resolveCitation({ start: 0 }, lines).status, "past-eof");
  assert.equal(resolveCitation({ start: 9 }, lines).status, "past-eof");
  assert.equal(resolveCitation({ start: 2 }, lines).status, "blank-region");
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
    { line: 7, text: " * contract/grammar.md:6's" },
    { line: 8, text: ' * `selector ::= "[" key-term "]"` production.' },
  ]);
  assert.equal(
    text,
    'contract/grammar.md:6\'s `selector ::= "[" key-term "]"` production.',
  );
  assert.deepEqual(offsets[1], { offset: 24, line: 8 });
});

test("a quotation binds to the nearest mention, and a mention with no line claims nothing", () => {
  const nearest = auditRunQuotations(
    [
      {
        line: 1,
        text: '// contract/grammar.md:4, `selector ::= "[" key-term "]"`',
      },
    ],
    CONTRACT,
  );
  assert.equal(nearest[0].mention.start, 4);
  assert.equal(nearest[0].line, 1);

  const after = auditRunQuotations(
    [
      {
        line: 3,
        text: '// `selector ::= "[" key-term "]"` (contract/grammar.md:6)',
      },
    ],
    CONTRACT,
  );
  assert.equal(after[0].mention.start, 6);

  const loose = auditRunQuotations(
    [
      {
        line: 1,
        text: '// contract/grammar.md\'s `add-statement ::= "add" expression`',
      },
    ],
    CONTRACT,
  );
  assert.equal(loose[0].mention, null);

  const uncited = auditRunQuotations(
    [
      {
        line: 1,
        text: "// `selector ::= x` with nothing cited and `plain code` beside it",
      },
    ],
    CONTRACT,
  );
  assert.equal(uncited.length, 1);
  assert.equal(uncited[0].mention, null);
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

test("validateExceptionEntry rejects every way an entry could excuse something unreviewably", () => {
  const sound = {
    subject: "contract/grammar.md:4",
    observed: "blank-region",
    kind: "stale-citation",
    issue: "#948",
    why: "deferred",
    fingerprint: "abc",
  };
  assert.deepEqual(validateExceptionEntry(sound, "a.ts", 0), []);
  const problems = validateExceptionEntry(
    {
      subject: "",
      observed: "",
      kind: "nope",
      issue: "948",
      why: "  ",
      fingerprint: "",
    },
    "a.ts",
    0,
  );
  assert.equal(problems.length, 6);
  assert.ok(problems.every((problem) => problem.startsWith("a.ts entry 0")));
  assert.ok(Object.keys(EXCEPTION_KINDS).includes("misquoted-production"));
});

test("loadExceptions drops the manifest's own underscore-prefixed documentation", () => {
  const path = join(TEMP_DIR, "exceptions.json");
  writeFileSync(path, JSON.stringify({ _note: "docs", "a.ts": [] }), "utf8");
  assert.deepEqual(loadExceptions(path), { "a.ts": [] });
  assert.equal(loadExceptions(path)._note, undefined);
  assert.ok(!Object.hasOwn(loadExceptions(), "_"));
  assert.equal(
    toPosixPath(EXCEPTIONS_PATH),
    "scripts/spec-citations-exceptions.json",
  );
});

test("the scan carve-out is exactly the manifest, so it cannot quietly grow", () => {
  // A gate that exempts itself from the rule it enforces asserts less than it appears to. The
  // manifest is the only unavoidable exclusion: every entry quotes the citation it excuses.
  assert.deepEqual([...SCAN_EXCLUSIONS], [EXCEPTIONS_PATH]);
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

test("siteFingerprint changes when the line, subject, rationale, or tracking issue changes", () => {
  const base = siteFingerprint("context", "subject", "why", "#1");
  assert.equal(base.length, 16);
  assert.equal(siteFingerprint("  context  ", "subject", "why", "#1"), base);
  assert.notEqual(siteFingerprint("other", "subject", "why", "#1"), base);
  assert.notEqual(siteFingerprint("context", "other", "why", "#1"), base);
  // The point of the design: rewriting a rationale invalidates the entry, so wrong prose in the
  // manifest cannot survive unreviewed the way a non-emptiness check would let it. The tracking
  // issue is in for the same reason — an entry asserts who will fix this, so retargeting it at a
  // different issue changes the assertion and must be re-triaged.
  assert.notEqual(siteFingerprint("context", "subject", "other", "#1"), base);
  assert.notEqual(siteFingerprint("context", "subject", "why", "#2"), base);
});

test("parseArgs reads every override and defaults the rest", () => {
  assert.deepEqual(parseArgs([]), {
    roots: undefined,
    specDirectory: undefined,
    specRoot: undefined,
    exceptionsPath: undefined,
  });
  assert.deepEqual(
    parseArgs([
      "--root=one",
      "--root=two",
      "--spec-dir=contract",
      "--spec-root=/tmp/contract",
      "--exceptions=e.json",
      "--unrecognised",
    ]),
    {
      roots: ["one", "two"],
      specDirectory: "contract",
      specRoot: "/tmp/contract",
      exceptionsPath: "e.json",
    },
  );
});

test("a tree of correct citations passes, and the report states what it does not cover", () => {
  writeGrammar();
  write(
    "ok.ts",
    '// contract/grammar.md:6\'s `selector ::= "[" key-term "]"` is the form.\n',
  );
  write("plain.md", "This mentions contract/ but cites no line.\n");
  writeFileSync(join(TEMP_DIR, "blob.bin"), Buffer.from([0x00]));
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.failed, 0);
  assert.equal(result.counts.quotations, 1);
  const summary = result.lines.join("\n");
  assert.match(summary, /does NOT prove the section supports the claim/);
  assert.match(summary, /wrong-passage and misstating-prose modes/);
  // The blind-spot sentence this replaced claimed anchors "pass unseen". Issue #1181 resolves them,
  // so the statement must no longer say they are unchecked — a coverage statement that understates
  // the gate is as wrong as one that overstates it.
  assert.match(summary, /names a heading that exists in the file it cites/);
  assert.doesNotMatch(summary, /passes unseen/);
  assert.doesNotMatch(summary, /not checked either/);
  // The canary's own limit is printed, not just commented: a green run must not read as a complete
  // block-structure check when it is knowingly incomplete for nested documents. Since ADR-0035 the
  // parser supplies block structure and rendered text, so the statement names what it now rests on
  // rather than claiming an incompleteness that no longer exists.
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
  // And it must name ALL THREE surviving refusals, not just the one. The statement used to say only
  // the emoji shortcode was refused while the code also refused entities and raw inline HTML — a
  // coverage statement that under-reports what the gate declines to answer is exactly the kind of
  // unenforced assertion this gate exists to stop.
  assert.match(summary, /a GFM\s+parse and slugs from github-slugger/);
  assert.match(
    summary,
    /an\s+entity reference outside the escaping set, raw inline HTML, or an emoji shortcode shape/,
  );
  // And it must not claim those refusals are exact. Two of the three key on SHAPE, so a heading
  // GitHub would publish literally is refused as well — erring toward refusing loudly rather than
  // inventing a slug. A statement that reads as "only genuine divergences are refused" overclaims.
  assert.match(
    summary,
    /recognised by shape, so a construct GitHub would publish literally is\s+refused too/,
  );
});

test("an unresolvable citation fails, naming the citing site, and suggests a manifest entry", () => {
  writeGrammar();
  write(
    "bad.ts",
    "// contract/grammar.md:8 is the blank line inside the document.\n",
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  const report = result.lines.join("\n");
  assert.match(report, /bad\.ts:1: contract\/grammar\.md:8 does not resolve/);
  assert.match(report, /hold no text/);
  assert.match(report, /add to .*spec-citations-exceptions\.json/);
});

test("an exception excuses a finding, prints UNRESOLVED, and is counted", () => {
  writeGrammar();
  const context =
    "// contract/grammar.md:8 is the blank line inside the document.";
  write("bad.ts", `${context}\n`);
  const why = "Deferred to the corpus sweep.";
  const result = runOverTemp({
    [keyFor("bad.ts")]: [
      {
        subject: "contract/grammar.md:8",
        observed: "blank-region",
        kind: "stale-citation",
        issue: "#948",
        why,
        fingerprint: siteFingerprint(
          context,
          "contract/grammar.md:8",
          why,
          "#948",
        ),
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.excused, 1);
  const report = result.lines.join("\n");
  assert.match(report, /UNRESOLVED .*#948.*Deferred to the corpus sweep/s);
  assert.match(report, /expected to fall to zero/);
});

test("an exception whose rationale was rewritten goes stale and reports the fingerprint it needs", () => {
  writeGrammar();
  const context =
    "// contract/grammar.md:8 is the blank line inside the document.";
  write("bad.ts", `${context}\n`);
  const result = runOverTemp({
    [keyFor("bad.ts")]: [
      {
        subject: "contract/grammar.md:8",
        observed: "blank-region",
        kind: "stale-citation",
        issue: "#948",
        why: "a rewritten rationale nobody re-reviewed",
        fingerprint: siteFingerprint(
          context,
          "contract/grammar.md:8",
          "the original rationale",
          "#948",
        ),
      },
    ],
  });
  assert.equal(result.ok, false);
  const report = result.lines.join("\n");
  assert.match(report, /no longer\s+matches/);
  assert.match(
    report,
    new RegExp(
      siteFingerprint(
        context,
        "contract/grammar.md:8",
        "a rewritten rationale nobody re-reviewed",
        "#948",
      ),
    ),
  );
});

test("an exception that mislabels, misdeclares, or misfiles what it excuses fails rather than excusing it", () => {
  writeGrammar();
  const context =
    "// contract/grammar.md:8 is the blank line inside the document.";
  write("bad.ts", `${context}\n`);
  const entry = (overrides) => ({
    subject: "contract/grammar.md:8",
    observed: "blank-region",
    kind: "stale-citation",
    issue: "#948",
    why: "w",
    ...overrides,
  });
  const mislabelled = entry({ subject: "contract/grammar.md:99" });
  mislabelled.fingerprint = siteFingerprint(
    context,
    "contract/grammar.md:8",
    "w",
    "#948",
  );
  assert.match(
    runOverTemp({ [keyFor("bad.ts")]: [mislabelled] }).lines.join("\n"),
    /is labelled "contract\/grammar\.md:99"/,
  );

  const misdeclared = entry({ observed: "past-eof" });
  misdeclared.fingerprint = siteFingerprint(
    context,
    "contract/grammar.md:8",
    "w",
    "#948",
  );
  assert.match(
    runOverTemp({ [keyFor("bad.ts")]: [misdeclared] }).lines.join("\n"),
    /declares "past-eof"/,
  );

  // `kind` is checked at match time rather than hashed, so an entry authored with the wrong defect
  // family from the start is caught too — not only one edited afterwards. Both reviewers of this
  // slice independently got this mutation past an earlier build.
  const misfiled = entry({ kind: "untracked-status-claim" });
  misfiled.fingerprint = siteFingerprint(
    context,
    "contract/grammar.md:8",
    "w",
    "#948",
  );
  assert.match(
    runOverTemp({ [keyFor("bad.ts")]: [misfiled] }).lines.join("\n"),
    /is filed as "untracked-status-claim" \(a status-claim defect\) but this is a resolution one/,
  );
});

test("a malformed entry fails the gate instead of silently disabling a check", () => {
  writeGrammar();
  write("ok.ts", "// contract/grammar.md:6 is fine.\n");
  const result = runOverTemp({ [keyFor("ok.ts")]: [{ why: "" }] });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /missing "fingerprint"/);
});

test("an exception that matches nothing is stale and must be deleted, never re-fingerprinted", () => {
  writeGrammar();
  write("ok.ts", "// contract/grammar.md:6 is fine.\n");
  const result = runOverTemp({
    [keyFor("ok.ts")]: [
      {
        subject: "contract/grammar.md:8",
        observed: "blank-region",
        kind: "stale-citation",
        issue: "#948",
        why: "w",
        fingerprint: "0000000000000000",
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(
    result.lines.join("\n"),
    /stale exception .* must shrink this manifest/,
  );
});

test("a bare reference nothing attributes fails, asking for the full citation", () => {
  writeGrammar();
  write("loose.ts", "// :77 comes first\n// then contract/grammar.md:4\n");
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(
    result.lines.join("\n"),
    /the bare reference `:77` follows no contract/,
  );
});

test("an untracked forward-looking claim fails; naming its issue is enough", () => {
  write("claim.md", "This is not yet implemented.\n");
  assert.equal(runOverTemp().ok, false);
  assert.match(
    runOverTemp().lines.join("\n"),
    /claim about this repository's own state/,
  );
  write("claim.md", "This is not yet implemented; see #123.\n");
  assert.equal(runOverTemp().ok, true);
});

test("the exclusion list is honoured, so the manifest itself is never scanned as a citing file", () => {
  writeGrammar();
  write("excused.ts", "// contract/grammar.md:8 is blank.\n");
  const result = runSpecCitationsGate({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
    exclusions: [join(TEMP_DIR, "excused.ts")],
    exceptions: {},
  });
  assert.equal(result.ok, true);
});

test("exceptions load from disk when none are passed in", () => {
  writeGrammar();
  write("ok.ts", "// contract/grammar.md:6 is fine.\n");
  const exceptionsPath = join(TEMP_DIR, "exceptions.json");
  writeFileSync(exceptionsPath, JSON.stringify({ _note: "docs" }), "utf8");
  const result = runSpecCitationsGate({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
    exceptionsPath,
  });
  assert.equal(result.ok, true);
});

test("suggestException produces a pasteable skeleton whose TODO invalidates its own fingerprint", () => {
  const line = suggestException(
    {
      file: "a.ts",
      context: "// ctx",
      subject: "contract/grammar.md:8",
      observed: "blank-region",
      kind: "stale-citation",
    },
    EXCEPTIONS_PATH,
  );
  const entry = JSON.parse(line.slice(line.indexOf("{")));
  assert.equal(entry.issue, "#000");
  assert.match(entry.why, /^TODO/);
  assert.equal(
    entry.fingerprint,
    siteFingerprint("// ctx", "contract/grammar.md:8", entry.why, entry.issue),
  );
});

test("a quoted OpenLogo snippet beside a correct citation is NOT treated as a quotation", () => {
  // The rule this pins, verified against the real tree: tests/conformance/.../repeat-zero-times
  // correctly cites the `repeat` entry AND contains the span `repeat 0 [ print 1 ]`, which is
  // OpenLogo source the author wrote to illustrate the rule — it appears nowhere in the contract and
  // never should. A naive "every backticked span must appear in the cited range" would fail that
  // freshly-corrected, correct citation, and because this gate forbids tolerance the false positive
  // would be fatal rather than noisy. Only an EBNF production (`::=`) is checkable, because `::=` is
  // not OpenLogo syntax and so cannot be an illustration the author invented.
  write(
    `${CONTRACT}/commands.md`,
    ["# Commands", "", "`repeat 0` runs the body zero times.", ""].join("\n"),
  );
  write(
    "repeat-zero-times.expected.json",
    JSON.stringify({
      description:
        "`repeat 0 [ print 1 ]` runs the body zero times (contract/commands.md:3).",
    }),
  );
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.quotations, 0);
});

test("a comma-appended tail is part of the range a quotation is checked against", () => {
  writeGrammar();
  write(
    "tail.ts",
    '// contract/grammar.md:4,6 gives `selector ::= "[" key-term "]"`.\n',
  );
  assert.equal(runOverTemp().ok, true);
});

test("a quotation beside a citation that already failed to resolve is not reported twice", () => {
  writeGrammar();
  write(
    "both.ts",
    '// contract/grammar.md:8 has `selector ::= "[" key-term "]"`.\n',
  );
  const result = runOverTemp();
  assert.equal(result.counts.failed, 1);
  assert.match(result.lines.join("\n"), /does not resolve/);
});

test("a citation naming a document that does not exist fails, and says so", () => {
  writeGrammar();
  write(
    "gone.ts",
    "// contract/absent.md:3 names a document nothing provides.\n",
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /contract\/absent\.md does not exist/);
});

test("without a specRoot override the gate reads the real specification directory", () => {
  // The production configuration: the token citations carry IS the directory they are read from.
  // Built from SPEC_DIRECTORY rather than written out, so this file — which the gate scans in CI —
  // carries no literal citation of its own.
  write(
    "real.ts",
    `// ${SPEC_DIRECTORY}/grammar.md:1 is that document's first line.\n`,
  );
  const result = runSpecCitationsGate({
    roots: [TEMP_DIR],
    specDirectory: SPEC_DIRECTORY,
    exceptions: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.citations, 1);
});

// --- Section anchors (issue #1181) ---------------------------------------------------------------

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
    decodeEntities("a &lt;b&gt; &#65; &#x42; &nope; &quot; &#99999999;"),
    'a <b> A B &nope; " \uFFFD',
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

test("the duplicate-slug rule is exercised by the LIVE spec, not only by fixtures", () => {
  // The commands document's operator headings are punctuation only, so they all slug to the empty
  // string and are reachable at positional suffixes alone. This is why the module note says the
  // anchor form cannot express a stable citation for that block.
  //
  // The document is named through SPEC_DIRECTORY rather than written out, for the reason this
  // file's header gives: a literal mention here is a real one, and it would switch on bare-reference
  // attribution for every `:N` written in a comment below it.
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
  // #1180 converts thousands of line citations to anchors, and prose emphasises citations. A bolded
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

  // The two classes the hand-written version missed, end to end.
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

test("the canary is now three constructs, because the parser obsoleted the rest", () => {
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

  // TWO of the three key on SHAPE, not on a table of real entities or real emoji names, and that is
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

test("the LIVE spec is clean for the canary, and the canary still reports when it should", () => {
  // Kept measured rather than asserted. If a spec edit ever introduces a heading the reader refuses,
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
  // lines — the shape that defeated the flat reader in both directions — and roughly forty live
  // anchors point into it. The document is named through SPEC_DIRECTORY so this comment carries no
  // real citation.
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
  // replacing the hand-rolled reader with a parser did not touch it — which is why these assertions
  // read exactly as they did before ADR-0035.
  const slugsOf = (lines) => documentHeadings(lines).map(({ slug }) => slug);
  const headingFor = (lines, slug) =>
    documentHeadings(lines).findIndex((entry) => entry.slug === slug);

  // DEMOTION — a colliding heading inserted AHEAD of the cited one takes the bare slug.
  assert.equal(headingFor(["## Alpha", "", "## Notes"], "notes"), 1);
  const afterInsert = ["## Alpha", "", "## Notes", "", "## Notes"];
  assert.equal(headingFor(afterInsert, "notes"), 1);
  assert.equal(headingFor(afterInsert, "notes-1"), 2);

  // PROMOTION — the one that will actually happen in spec/: an earlier duplicate is renamed, and the
  // later one inherits the slug it vacated. `#notes` still resolves, to a different section.
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
  // real heading now. Three refusals survive, and each must refuse END TO END, not merely in
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
    // The remedies a maintainer can actually apply are named.
    assert.match(
      report,
      /Remove the construct, or cite this document by line instead/,
    );
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
    "// contract/conformance.md#heritage names a section, contract/grammar.md:4 a line.",
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
  // The line form is untouched: an explicit line mention still yields exactly the citations it did.
  assert.deepEqual(
    citations.map(
      (citation) => `${citation.file}:${citation.start}:${citation.form}`,
    ),
    ["grammar.md:4:explicit"],
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

test("an anchor naming a real heading passes and is counted on its own counter", () => {
  writeSections();
  write("ok.md", `See ${CONTRACT}/conformance.md#heritage for the profile.\n`);
  write("also.md", `And ${CONTRACT}/conformance.md#turtle--rendering.\n`);
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.sectionAnchors, 2);
  // `explicit` is the line form and must not move; a file carrying only an anchor still counts as a
  // citing file, which it did not before — nothing else in the tally changes.
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
  assert.match(report, /add to .*spec-citations-exceptions\.json/);
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

test("a #L line fragment is resolved as the line claim it is, not hunted for among headings", () => {
  writeSections();
  write(
    "ok.md",
    `See ${CONTRACT}/conformance.md#L9 and ${CONTRACT}/conformance.md#L3-L9.\n`,
  );
  const passing = runOverTemp();
  assert.equal(passing.ok, true);
  assert.equal(passing.counts.lineFragments, 2);
  assert.equal(passing.counts.sectionAnchors, 0);

  write("bad.md", `See ${CONTRACT}/conformance.md#L9999.\n`);
  const failing = runOverTemp();
  assert.equal(failing.ok, false);
  assert.match(
    failing.lines.join("\n"),
    /#L9999 does not resolve — conformance\.md has 11 line\(s\)/,
  );
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
  assert.equal(runOverTemp().ok, true);

  // #L9 means line 9, and this document has three lines — so it fails as a line claim, which is
  // exactly what it is, rather than being reported as a heading that does not exist.
  write("ok.md", `The line is ${CONTRACT}/liney.md#L9.\n`);
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /liney\.md has 3 line\(s\)/);
  assert.equal(result.counts.sectionAnchors, 0);
  assert.equal(result.counts.lineFragments, 1);
});

test("an anchor broken by a line break says so, instead of reading as a misspelling", () => {
  // The live instance this comes from: a design note wrapped a long slug across a line break, so the
  // gate saw `#collections-`. Named as a wrap, the failure explains itself; left as a near-miss it
  // sends the author hunting for a heading that was never wrong.
  write(
    `${CONTRACT}/grammar.md`,
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
      `are recognized by their leading keyword (\`${CONTRACT}/grammar.md#collections-`,
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

test("an anchor finding is excused by a missing-anchor entry, and only by that kind", () => {
  writeSections();
  const context = `See ${CONTRACT}/conformance.md#educational for the profile.`;
  write("bad.md", `${context}\n`);
  const why = "Waiting on the section being written.";
  const issue = "#1181";
  const entry = {
    subject: `${CONTRACT}/conformance.md#educational`,
    observed: "missing-heading",
    kind: "missing-anchor",
    issue,
    why,
    fingerprint: siteFingerprint(
      context,
      `${CONTRACT}/conformance.md#educational`,
      why,
      issue,
    ),
  };
  const excused = runOverTemp({ [keyFor("bad.md")]: [entry] });
  assert.equal(excused.ok, true);
  assert.equal(excused.counts.excused, 1);
  assert.match(
    excused.lines.join("\n"),
    /UNRESOLVED .*#educational does not resolve/,
  );

  // An entry filed as the wrong family fails rather than excusing: the manifest's own totals are
  // read as an audit signal, so a misfiled entry corrupts them.
  const misfiled = runOverTemp({
    [keyFor("bad.md")]: [{ ...entry, kind: "stale-citation" }],
  });
  assert.equal(misfiled.ok, false);
  assert.match(
    misfiled.lines.join("\n"),
    /is filed as "stale-citation" .* but this is a heading one/s,
  );
  assert.equal(EXCEPTION_KINDS["missing-anchor"], "heading");
});

test("MUTATION mode 1: a citation moved past end-of-file fails; restoring it passes", () => {
  writeGrammar();
  const good =
    '// contract/grammar.md:6\'s `selector ::= "[" key-term "]"` is the form.\n';
  write("site.ts", good);
  assert.equal(
    runOverTemp().ok,
    true,
    "the known-good citation must pass first",
  );

  write("site.ts", good.replace(":6", ":9999"));
  const mutated = runOverTemp();
  assert.equal(mutated.ok, false);
  assert.match(mutated.lines.join("\n"), /grammar\.md has 9 line\(s\)/);

  write("site.ts", good);
  assert.equal(
    runOverTemp().ok,
    true,
    "restoring must return the gate to green",
  );
});

test("MUTATION mode 1: a citation moved onto blank space fails, with no nearby-line tolerance", () => {
  writeGrammar();
  const good = "// contract/grammar.md:6 defines the selector.\n";
  write("site.ts", good);
  assert.equal(runOverTemp().ok, true);

  // :8 is blank and sits two lines from the correct anchor. A gate that searched nearby lines would
  // pass this, which is exactly the tolerance #893's reviewers deleted.
  write("site.ts", good.replace(":6", ":8"));
  assert.equal(runOverTemp().ok, false);

  write("site.ts", good);
  assert.equal(runOverTemp().ok, true);
});

test("MUTATION mode 2: repointing at a DIFFERENT section that still resolves fails", () => {
  // The hard case, and the one a resolution-only gate cannot see: :4-5 is real, non-blank text — it
  // is simply not where `selector` is defined. This is issue #934's instance 4 in miniature, where
  // a range excluded the very line holding the production it quoted.
  writeGrammar();
  const good =
    '// contract/grammar.md:6, `selector ::= "[" key-term "]"`, is the form.\n';
  write("site.ts", good);
  assert.equal(runOverTemp().ok, true);

  const mutated = good.replace(":6", ":4-5");
  write("site.ts", mutated);
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(
    result.lines.join("\n"),
    /is quoted here but is not in contract\/grammar\.md:4-5/,
  );
  assert.match(result.lines.join("\n"), /still points at the wrong passage/);

  write("site.ts", good);
  assert.equal(runOverTemp().ok, true);
});

test("MUTATION: a quotation whose wording drifts from the production fails", () => {
  // #933's mode-2 case: a production quoted with a name elided, where the elided word was the point.
  writeGrammar();
  write(
    "site.ts",
    '// contract/grammar.md:6, `selector ::= "[" term "]"`, is the form.\n',
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
  // The citing fixture names `contract/`, but `specRoot` points the READER at the real specification
  // directory, so the document is the one that ships while this test file — which the gate scans in
  // CI — carries no real citation of its own.
  const document = "conformance.md";
  const heading = "### Heritage";
  const known = "heritage";
  assert.ok(
    splitLines(readFileSync(join(SPEC_DIRECTORY, document), "utf8")).some(
      (line) => line.trimEnd() === heading,
    ),
    `${document} must still contain the exact heading line "${heading}"`,
  );

  const runAgainstRealSpec = () =>
    runSpecCitationsGate({
      roots: [TEMP_DIR],
      specDirectory: CONTRACT,
      specRoot: SPEC_DIRECTORY,
      exceptions: {},
    });
  const cite = (fragment) =>
    write("site.md", `The profile is ${CONTRACT}/${document}#${fragment}.\n`);

  cite(known);
  const before = runAgainstRealSpec();
  assert.equal(before.ok, true, "the known-good anchor must pass first");
  assert.equal(before.counts.sectionAnchors, 1);

  // One character, so the result is a plausible typo rather than an obvious wreck — the shape a
  // renamed or mistyped heading actually takes.
  const corrupted = "heritagf";
  assert.notEqual(corrupted, known);
  cite(corrupted);
  const mutated = runAgainstRealSpec();
  assert.equal(mutated.ok, false, "one corrupted character must go red");
  assert.match(mutated.lines.join("\n"), /does not resolve/);
  // A near miss is described and STILL fails. Suggesting is not accepting.
  assert.match(
    mutated.lines.join("\n"),
    new RegExp(`did you mean "#${known}"`),
  );

  cite(known);
  assert.equal(
    runAgainstRealSpec().ok,
    true,
    "restoring must return the gate to green",
  );
});

// --- CLI shell (subprocess; outside the loaded-module coverage set per ADR-0009) ----------------

/** Run the CLI over the temp tree, returning its exit status and combined output. */
function runCli(exceptionsPath) {
  const result = spawnSync(
    process.execPath,
    [
      join("scripts", "check-spec-citations.mjs"),
      `--root=${TEMP_DIR}`,
      `--spec-dir=${CONTRACT}`,
      `--spec-root=${join(TEMP_DIR, CONTRACT)}`,
      `--exceptions=${exceptionsPath}`,
    ],
    { encoding: "utf8" },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("the CLI exits 0 and prints the report when every citation resolves", () => {
  writeGrammar();
  write("ok.ts", "// contract/grammar.md:6 is fine.\n");
  const exceptionsPath = join(TEMP_DIR, "exceptions.json");
  writeFileSync(exceptionsPath, "{}", "utf8");
  const { status, output } = runCli(exceptionsPath);
  assert.equal(status, 0);
  assert.match(output, /spec citations: \d+ checked/);
});

test("the CLI exits non-zero when a citation does not resolve", () => {
  writeGrammar();
  write("bad.ts", "// contract/grammar.md:8 is blank.\n");
  const exceptionsPath = join(TEMP_DIR, "exceptions.json");
  writeFileSync(exceptionsPath, "{}", "utf8");
  const { status, output } = runCli(exceptionsPath);
  assert.equal(status, 1);
  assert.match(output, /FAIL/);
});

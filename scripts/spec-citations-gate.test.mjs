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
  EXCEPTIONS_PATH,
  EXCEPTION_KINDS,
  SCAN_EXCLUSIONS,
  SPEC_DIRECTORY,
  STATUS_CLAIM_PHRASES,
  auditRunQuotations,
  closestHeadingSlug,
  collectCitations,
  collectStatusClaims,
  documentHeadings,
  editDistance,
  expandCommaTail,
  flattenProseRun,
  formatAnchor,
  formatCitation,
  headingSlug,
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
  splitLines,
  suggestException,
  toPosixPath,
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

test("headingSlug lowercases, drops punctuation, and turns spaces into hyphens", () => {
  assert.equal(
    headingSlug("Profile and source contract"),
    "profile-and-source-contract",
  );
  assert.equal(
    headingSlug("  Lexical form and encoding  "),
    "lexical-form-and-encoding",
  );
  assert.equal(
    headingSlug("Keywords, primitives, and built-in names"),
    "keywords-primitives-and-built-in-names",
  );
  assert.equal(headingSlug("Tutor (AI)"), "tutor-ai");
  assert.equal(headingSlug("`<place> = <value>`"), "place--value");
  assert.equal(headingSlug("`is_a?`"), "is_a");
});

test("headingSlug KEEPS an underscore — `set_xy` is reachable at #set_xy, not #set-xy", () => {
  // A live-corpus heading. `_` is one of the two characters GitHub's rule keeps and a reader would
  // expect it to normalise away; anyone "tidying" this into a hyphen breaks every anchor naming an
  // underscored command, of which the commands document has many.
  assert.equal(headingSlug("`set_xy`"), "set_xy");
  assert.equal(headingSlug("`clear_screen`"), "clear_screen");
  assert.equal(headingSlug("Names use `snake_case`"), "names-use-snake_case");
});

test("headingSlug NEVER collapses a run of hyphens — `Turtle & Rendering` is #turtle--rendering", () => {
  // Two live-corpus headings, both from the conformance document, and both with a DOUBLE hyphen: the
  // `&` is deleted and the spaces on either side of it each become a hyphen. Collapsing the run — the
  // obvious "clean-up" — silently breaks the 3 anchors in this tree that name these two sections.
  assert.equal(headingSlug("Turtle & Rendering"), "turtle--rendering");
  assert.equal(headingSlug("Interaction & Events"), "interaction--events");
});

test("headingSlug slugs a heading's rendered text, so an inline link contributes only its label", () => {
  assert.equal(headingSlug("See [the grammar](grammar.md)"), "see-the-grammar");
  assert.equal(headingSlug("See [the grammar][grammar]"), "see-the-grammar");
});

test("documentHeadings ignores a `#` line inside a fenced block", () => {
  // Load-bearing, not tidiness: this corpus writes OpenLogo comments inside fences, so `# primary
  // line comment` in the grammar document would otherwise be offered as a heading — and an anchor
  // naming it would resolve HERE while failing on GitHub, which is a false pass.
  const headings = documentHeadings([
    "# Grammar",
    "",
    "```logo",
    "# primary line comment",
    "```",
    "",
    "~~~text",
    "## not a heading either",
    "~~~",
    "## Real heading",
  ]);
  assert.deepEqual(
    headings.map(({ slug }) => slug),
    ["grammar", "real-heading"],
  );
});

test("documentHeadings closes a fence only on its own delimiter with nothing after it", () => {
  const headings = documentHeadings([
    "```ebnf",
    "~~~",
    "``` still inside, because this one carries an info string",
    "## hidden",
    "```",
    "## visible",
  ]);
  assert.deepEqual(
    headings.map(({ slug }) => slug),
    ["visible"],
  );
});

test("documentHeadings suffixes a repeated slug -1, -2 in document order", () => {
  // spec/ has no duplicate headings today, so this rule has no live example to lean on. That is
  // exactly why it is pinned on a fixture: an unpinned rule is one nobody notices breaking.
  const headings = documentHeadings([
    "## Notes",
    "### Notes",
    "## notes!",
    "## Other",
  ]);
  assert.deepEqual(
    headings.map(({ slug }) => slug),
    ["notes", "notes-1", "notes-2", "other"],
  );
  assert.deepEqual(
    headings.map(({ line }) => line),
    [1, 2, 3, 4],
  );
});

test("documentHeadings follows CommonMark on what is a heading at all", () => {
  const headings = documentHeadings([
    "   ### Three spaces is still a heading",
    "    #### Four spaces is an indented code block",
    "#NoSpaceAfterHash",
    "####### Seven hashes is not a heading",
    "## Closing sequence ##",
    "## Carriage return survives a CRLF checkout\r",
  ]);
  assert.deepEqual(
    headings.map(({ slug }) => slug),
    [
      "three-spaces-is-still-a-heading",
      "closing-sequence",
      "carriage-return-survives-a-crlf-checkout",
    ],
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
  const anchor = (fragment) => ({
    specDirectory: CONTRACT,
    file: "conformance.md",
    fragment,
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
  // The line form is untouched: an anchored mention still yields exactly the citations it did.
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
    /is filed as "stale-citation" .* but this is a anchor one/s,
  );
  assert.equal(EXCEPTION_KINDS["missing-anchor"], "anchor");
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
  // The citing fixture still names `contract/`, but `specRoot` points the READER at the real
  // specification directory — so the heading being cited is a live one, read from the file that
  // ships, while this test file (which the gate scans in CI) carries no real citation of its own.
  // The slug is computed at run time for the same reason: a literal would be one.
  const document = "conformance.md";
  const headings = documentHeadings(
    splitLines(readFileSync(join(SPEC_DIRECTORY, document), "utf8")),
  );
  const known = headings
    .map(({ slug }) => slug)
    .filter((slug) => /^[a-z]{8,}$/.test(slug))
    .at(0);
  assert.ok(known, `${document} must offer a single-word heading to cite`);

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

  // One character, advanced to the next letter, so the result is a plausible typo rather than an
  // obvious wreck — the shape a renamed or mistyped heading actually takes.
  const nextLetter = String.fromCharCode(
    ((known.at(-1).charCodeAt(0) - 97 + 1) % 26) + 97,
  );
  const corrupted = `${known.slice(0, -1)}${nextLetter}`;
  assert.ok(
    !headings.some(({ slug }) => slug === corrupted),
    "the corruption must not collide with another real heading",
  );
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

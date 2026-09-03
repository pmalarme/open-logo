// Unit + mutation tests for the ADR-numbering DoD gate (issue #1042). These import
// scripts/adr-numbering-gate.mjs's logic directly (for 100% coverage) plus subprocess tests for the
// CLI shell (scripts/check-adr-numbering.mjs), pointed at isolated temp fixtures via
// --root/--adr-dir/--adr-root/--link-base rather than the real corpus.
//
// Fixtures name a `contract/adr` directory and spell their labels through LABEL, never the literal
// `ADR-NNNN` and never a real `docs/adr/NNNN-….md` path. All three are deliberate: this file is
// itself inside the set the gate scans in CI, so a deliberately-broken fixture written with the
// real directory token — or with a real ADR label over a target that does not exist here — would be
// indistinguishable from a defect in the tree, and would turn CI red. Drafts of this file were
// caught by the gate for exactly that, once for a label and once for invented `docs/adr/…` paths in
// the path-arithmetic tests, which are directory-agnostic and had no need of the real token.
//
// The MUTATION block is the gate's own proof that it can go red — the same discipline as
// tests/conformance/_harness-selftest/, whose fixtures deliberately declare expect: "mismatch".
// Each in-process mutation is preceded by a CLEAN CONTROL asserting the unmutated fixture passes
// *and* that the counts it exercised are non-zero, and the isolated-repository case runs the CLI
// clean before adding its broken file: a mutation loop with no control cannot tell "every mutant
// caught" from "the loop never fired", which is what silently vacated 18 cases in
// .github/scripts/test-validate-meta.py.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  ADR_DIRECTORY,
  ADR_FILENAME_PATTERN,
  canonicalPath,
  codeSpans,
  collectReferences,
  escapeForRegExp,
  headingNumber,
  isInside,
  labelledNumber,
  lineNumberAt,
  listAdrDocuments,
  listScannedFiles,
  parseArgs,
  rawLines,
  readTextFile,
  resolveTarget,
  runAdrNumberingGate,
  splitLines,
  toPosixPath,
  walkFiles,
} from "./adr-numbering-gate.mjs";

/** The directory token fixtures reference, chosen so it shares no substring with the real one. */
const CONTRACT = "contract/adr";

/** The label token, spelled indirectly so this file never contains a live `ADR-NNNN` link. */
const LABEL = "ADR";

let TEMP_DIR;

beforeEach(() => {
  TEMP_DIR = mkdtempSync(join(tmpdir(), "ol-adr-gate-"));
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

/** Write an ADR whose heading number defaults to agreeing with its filename. */
function writeAdr(number, slug, heading = String(Number(number))) {
  return write(
    `${CONTRACT}/${number}-${slug}.md`,
    `# ${heading}. A decision\n\n- Status: Accepted\n`,
  );
}

/** The options that point the gate at the temp tree instead of the repository. */
function temporaryOptions() {
  return {
    roots: [TEMP_DIR],
    adrDirectory: CONTRACT,
    adrRoot: `${toPosixPath(TEMP_DIR)}/${CONTRACT}`,
    linkBase: toPosixPath(TEMP_DIR),
  };
}

/** Run the gate over the temp tree. */
function runOverTemp() {
  return runAdrNumberingGate(temporaryOptions());
}

/** A two-ADR corpus plus a document that references both, all of it correct. */
function writeCleanCorpus() {
  writeAdr("0001", "first");
  writeAdr("0002", "second");
  write(
    "guide.md",
    `See [${LABEL}-0001](${CONTRACT}/0001-first.md) and the note in ` +
      `${CONTRACT}/0002-second.md for detail.\n`,
  );
  write(
    `${CONTRACT}/0002-second.md`,
    `# 2. A decision\n\n- Related: refines [${LABEL}-0001](0001-first.md)\n`,
  );
}

/** Assert the corpus is green *and* that it actually exercised each check (no vacuous control). */
function assertCleanControl(result = runOverTemp()) {
  assert.deepEqual(
    result.lines.filter((line) => line.startsWith("FAIL")),
    [],
  );
  assert.equal(result.ok, true);
  assert.equal(result.counts.adrs, 2);
  assert.ok(result.counts.links > 0, "the control exercised no link check");
  assert.ok(
    result.counts.paths > 0,
    "the control exercised no bare-path check",
  );
  assert.ok(
    result.counts.comparisons > 0,
    "the control exercised no label/path number comparison",
  );
  return result;
}

/** The FAIL lines of a run, joined, for substring assertions. */
function failures(result) {
  return result.lines.filter((line) => line.startsWith("FAIL")).join("\n");
}

// --- Helpers ------------------------------------------------------------------------------------

test("toPosixPath rewrites native separators", () => {
  assert.equal(toPosixPath(join("a", "b", "c.md")), "a/b/c.md");
});

test("splitLines tolerates CRLF", () => {
  assert.deepEqual(splitLines("a\r\nb\nc"), ["a", "b", "c"]);
});

test("readTextFile returns null for binary and unreadable paths", () => {
  const path = join(TEMP_DIR, "binary.bin");
  writeFileSync(path, Buffer.from([0x41, 0x00, 0x42]));
  assert.equal(readTextFile(path), null);
  assert.equal(readTextFile(TEMP_DIR), null);
  assert.equal(readTextFile(write("plain.md", "text\n")), "text\n");
});

test("walkFiles is depth-first, sorted, and skips generated directories", () => {
  write("b.md", "b");
  write("nested/a.md", "a");
  write("node_modules/ignored.md", "x");
  const found = walkFiles([TEMP_DIR, join(TEMP_DIR, "absent")]);
  assert.deepEqual(found, [
    `${toPosixPath(TEMP_DIR)}/b.md`,
    `${toPosixPath(TEMP_DIR)}/nested/a.md`,
  ]);
});

test("listScannedFiles walks roots when given, and asks git otherwise", () => {
  write("only.md", "x");
  assert.deepEqual(listScannedFiles([TEMP_DIR]), [
    `${toPosixPath(TEMP_DIR)}/only.md`,
  ]);
  const tracked = listScannedFiles();
  assert.ok(tracked.includes("package.json"));
  assert.ok(tracked.includes("scripts/adr-numbering-gate.mjs"));
});

test("listAdrDocuments skips absent directories, non-markdown, and the index", () => {
  assert.deepEqual(listAdrDocuments(join(TEMP_DIR, CONTRACT)), []);
  writeAdr("0001", "first");
  write(`${CONTRACT}/README.md`, "# Index\n");
  write(`${CONTRACT}/notes.txt`, "x");
  write(`${CONTRACT}/sub/0002-nested.md`, "# 2. n\n");
  assert.deepEqual(listAdrDocuments(join(TEMP_DIR, CONTRACT)), [
    "0001-first.md",
  ]);
});

test("listAdrDocuments matches the extension case-insensitively, so an odd one is audited", () => {
  writeAdr("0001", "first");
  write(`${CONTRACT}/0002-SHOUTED.MD`, "# 2. A decision\n");
  write(`${CONTRACT}/README.MD`, "# Index\n");
  assert.deepEqual(listAdrDocuments(join(TEMP_DIR, CONTRACT)), [
    "0001-first.md",
    "0002-SHOUTED.MD",
  ]);
});

test("headingNumber reads the first level-1 heading only", () => {
  assert.deepEqual(headingNumber("preamble\n\n# 7. Title\n\n# 8. Later\n"), {
    heading: "# 7. Title",
    number: "7",
  });
  assert.deepEqual(headingNumber("# Untitled\n"), {
    heading: "# Untitled",
    number: null,
  });
  assert.equal(headingNumber("## Only a subheading\n"), null);
});

test("headingNumber ignores a heading inside a fenced block", () => {
  assert.deepEqual(
    headingNumber("```\n# 7. Not the heading\n```\n\n# 9. Real\n"),
    {
      heading: "# 9. Real",
      number: "9",
    },
  );
  assert.equal(headingNumber("~~~\n# 7. Fenced\n~~~\n"), null);
});

test("headingNumber tracks the fence character and length, so a short run does not close it", () => {
  // A three-backtick line inside a four-backtick block is content, not a closer. Toggling on any
  // fence line accepted the heading below it as the document's own.
  assert.equal(headingNumber("````\n```\n# 31. Fenced\n````\n\nprose\n"), null);
  assert.deepEqual(headingNumber("````\n```\n````\n\n# 31. Real\n"), {
    heading: "# 31. Real",
    number: "31",
  });
  // A tilde run does not close a backtick block.
  assert.equal(headingNumber("```md\n~~~\n# 5. Fenced\n```\n"), null);
});

test("codeSpans covers fences, inline spans, and an unterminated fence", () => {
  const text = "a `code` b\n```\nfenced\n```\ntail\n";
  const spans = codeSpans(text);
  assert.equal(spans.length, 2);
  assert.match(
    text.slice(spans[0][0], spans[0][1]),
    /^```\r?\nfenced\r?\n```\r?\n$/,
  );
  assert.equal(text.slice(spans[1][0], spans[1][1]), "`code`");
  const unterminated = codeSpans("```\nopen for ever\n");
  assert.deepEqual(unterminated, [[0, "```\nopen for ever\n".length]]);
});

test("codeSpans pairs equal-length backtick runs, across lines and under CRLF", () => {
  const wrapped = "a ``span\nthat wraps`` b";
  const [span] = codeSpans(wrapped);
  assert.equal(wrapped.slice(span[0], span[1]), "``span\nthat wraps``");
  // A one-backtick opener is not closed by a two-backtick run. Pairing them spanned text that
  // renders as a live link, so a mismatched label inside it went unaudited.
  assert.deepEqual(codeSpans("`text`` more"), []);
  const crlf = `${"filler\r\n".repeat(20)}a \`code\` b\r\n`;
  const [inCrlf] = codeSpans(crlf);
  assert.equal(crlf.slice(inCrlf[0], inCrlf[1]), "`code`");
});

test("an escaped backtick is a literal, so the link between escaped pairs stays audited", () => {
  const text = `\\\`[${LABEL}-0002](${CONTRACT}/0001-first.md)\\\`\n`;
  assert.deepEqual(codeSpans(text), []);
  const references = collectReferences("guide.md", text, {
    adrDirectory: CONTRACT,
    adrRoot: CONTRACT,
    linkBase: ".",
  });
  assert.deepEqual(
    references.map((reference) => [reference.form, reference.labelled]),
    [["link", "0002"]],
  );
});

test("an escaped backtick still CLOSES a span, because escapes do not apply inside one", () => {
  // CommonMark renders `code\` as a closed code span, and the link after it is live. Refusing the
  // escaped run as a closer made the span swallow that link.
  const text = `\`code\\\` [${LABEL}-0002](${CONTRACT}/0001-first.md) \`\n`;
  const spans = codeSpans(text);
  assert.equal(spans.length, 1);
  assert.equal(text.slice(spans[0][0], spans[0][1]), "`code\\`");
  const references = collectReferences("guide.md", text, {
    adrDirectory: CONTRACT,
    adrRoot: CONTRACT,
    linkBase: ".",
  });
  assert.deepEqual(
    references.map((reference) => [reference.form, reference.labelled]),
    [["link", "0002"]],
  );
});

test("an escape consumes ONE backtick, so the rest of the run still opens a span", () => {
  // `\`` + a second backtick is an escaped backtick followed by a one-backtick opener, which the
  // closing backtick then matches: the link between them is code, not a live link.
  const text = `\\\`\`[${LABEL}-0002](${CONTRACT}/9999-missing.md)\`\n`;
  const spans = codeSpans(text);
  assert.equal(spans.length, 1);
  assert.equal(text.slice(spans[0][0], spans[0][1] - 1).startsWith("`["), true);
  assert.deepEqual(
    collectReferences("guide.md", text, {
      adrDirectory: CONTRACT,
      adrRoot: CONTRACT,
      linkBase: ".",
    }),
    [],
  );
});

test("canonicalPath is the one spelling paths are compared in", () => {
  assert.equal(canonicalPath("docs/adr/"), "docs/adr");
  assert.equal(canonicalPath("docs/./adr//"), "docs/adr");
  assert.equal(canonicalPath(join("docs", "adr")), "docs/adr");
  assert.equal(canonicalPath(""), ".");
});

test("canonicalPath preserves a root instead of normalising it into a segment", () => {
  // Each of these was measured wrong before the root was held back from normalisation.
  assert.equal(canonicalPath("/"), "/");
  assert.equal(canonicalPath("/tmp/adr/"), "/tmp/adr");
  assert.equal(canonicalPath("C:/"), "C:/");
  assert.equal(canonicalPath("C:/../docs/adr"), "C:/docs/adr");
  assert.equal(canonicalPath("C:/Users/x/adr/"), "C:/Users/x/adr");
  assert.equal(canonicalPath("//server/share/adr/"), "//server/share/adr");
  assert.equal(canonicalPath("//./C:/x/"), "//./C:/x");
  // The device path's volume belongs to the root, or `..` eats it.
  assert.equal(canonicalPath("//?/C:/../docs/adr"), "//?/C:/docs/adr");
});

test("canonicalPath keeps a leading `..`, which is part of where the path points", () => {
  // Dropping it turned `--adr-root=../docs/adr`, run from a subdirectory, into `docs/adr`: no ADRs
  // found and every reference in the tree reported broken.
  assert.equal(canonicalPath("../docs/adr"), "../docs/adr");
  assert.equal(canonicalPath("../../docs/adr/"), "../../docs/adr");
  assert.equal(canonicalPath("./docs/./adr"), "docs/adr");
  // Drive-relative is not drive-rooted: `C:docs` names the drive's current directory, not its root.
  assert.equal(canonicalPath("C:docs/adr"), "C:docs/adr");
  assert.equal(canonicalPath("C:"), "C:");
});

test("the CLI works from a subdirectory with relative overrides", () => {
  writeCleanCorpus();
  mkdirSync(join(TEMP_DIR, "sub"), { recursive: true });
  const run = spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, "check-adr-numbering.mjs"),
      "--root=..",
      `--adr-dir=${CONTRACT}`,
      `--adr-root=../${CONTRACT}`,
      "--link-base=..",
    ],
    { cwd: join(TEMP_DIR, "sub"), encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /adr numbering: 2 ADR\(s\)/);
});

test("a four-space indented fence is not a fence, so the link inside it is audited", () => {
  writeCleanCorpus();
  assertCleanControl();
  // The discriminating shape is a TILDE fence: with backticks the two runs pair as a code span and
  // the link is skipped either way, so a backtick fixture would pin nothing. Loosening the fence
  // indent to ` *` makes this pass, which is the mutation this test exists to kill.
  write(
    "indented.md",
    `    ~~~\n[missing](${CONTRACT}/9999-missing.md)\n    ~~~\n`,
  );
  assert.match(
    failures(runOverTemp()),
    /9999-missing\.md, which does not exist/,
  );
});

test("the directory-name signal folds case even when the root is elsewhere", () => {
  // Only observable when --adr-dir and --adr-root differ, which is exactly the docs/design-notes
  // invocation: the resolved path is then outside the root, so `isInside` cannot classify it and
  // the lowercased directory-name signal is the only one left.
  const references = collectReferences(
    "guide.md",
    `[record](${CONTRACT.toUpperCase()}/0002-second.md)\n`,
    { adrDirectory: CONTRACT, adrRoot: "somewhere/else", linkBase: "." },
  );
  assert.deepEqual(
    references.map((reference) => reference.form),
    ["link"],
  );
});

test("a carriage return ends link text, so a CR line break cannot forge a link", () => {
  // Dropping `\r` from the label character class lets the pattern run across a lone-CR line break
  // and report a link nobody wrote — a false red on a CR-terminated document. The path inside is
  // still a genuine bare mention, so the discriminating assertion is on the LINK form only.
  const references = collectReferences(
    "guide.md",
    `[${LABEL}-0001\rstray](${CONTRACT}/0001-first.md)\r`,
    { adrDirectory: CONTRACT, adrRoot: CONTRACT, linkBase: "." },
  );
  assert.deepEqual(
    references.map((reference) => reference.form),
    ["path"],
  );
});

test("isInside is what catches a sibling link inside a wrong-cased directory", () => {
  // The directory-name signal cannot see this one: the target spells no directory at all. Only
  // `isInside`'s case folding classifies it, which is why a target-spelled fixture pins nothing.
  const references = collectReferences(
    `${CONTRACT.toUpperCase()}/0002-second.md`,
    "[sibling](0001-first.md)\n",
    { adrDirectory: CONTRACT, adrRoot: CONTRACT, linkBase: "." },
  );
  assert.deepEqual(
    references.map((reference) => reference.resolved),
    [`${CONTRACT.toUpperCase()}/0001-first.md`],
  );
});

test("a bare path is a reference only when its file part opens with four digits", () => {
  // The guard is what keeps documented placeholders out without an exceptions list. Dropping it
  // turns every `<adr-dir>/<anything>.md` mention into a reference — on the real corpus that is
  // immediately red, but no unit test noticed until this one.
  const references = collectReferences(
    "guide.md",
    `see ${CONTRACT}/NNNN-title.md and ${CONTRACT}/0001-first.md\n`,
    { adrDirectory: CONTRACT, adrRoot: CONTRACT, linkBase: "." },
  );
  assert.deepEqual(
    references.map((reference) => reference.source),
    [`${CONTRACT}/0001-first.md`],
  );
});

test("a wrong-case ADR directory is enumerated, so it fails where the filesystem is case-sensitive", () => {
  const references = collectReferences(
    "README.md",
    `[record](${CONTRACT.toUpperCase()}/0001-first.md)\n`,
    { adrDirectory: CONTRACT, adrRoot: CONTRACT, linkBase: "." },
  );
  assert.deepEqual(
    references.map((reference) => reference.resolved),
    [`${CONTRACT.toUpperCase()}/0001-first.md`],
  );
});

test("a trailing slash or a dot segment in --adr-root does not silently unclassify links", () => {
  writeCleanCorpus();
  write(
    `${CONTRACT}/0002-second.md`,
    "# 2. A decision\n\n[plain](9999-missing.md)\n",
  );
  for (const spelling of [
    `${toPosixPath(TEMP_DIR)}/${CONTRACT}/`,
    `${toPosixPath(TEMP_DIR)}/contract/./adr`,
  ]) {
    const result = runAdrNumberingGate({
      roots: [TEMP_DIR],
      adrDirectory: CONTRACT,
      adrRoot: spelling,
      linkBase: toPosixPath(TEMP_DIR),
    });
    assert.equal(result.ok, false, `${spelling} classified nothing`);
    assert.match(failures(result), /9999-missing\.md, which does not exist/);
  }
});

test("a tab-indented fence is an indented code block, not a fence", () => {
  // `\s{0,3}` accepted the tab as fence indentation and swallowed the heading below it.
  assert.deepEqual(headingNumber("\t```\n# 30. Real\n"), {
    heading: "# 30. Real",
    number: "30",
  });
});

test("lone-CR line endings are lines too", () => {
  assert.deepEqual(rawLines("a\rb\r"), ["a\r", "b\r"]);
  assert.deepEqual(splitLines("a\rb"), ["a", "b"]);
  assert.deepEqual(headingNumber("preamble\r# 30. Real\r"), {
    heading: "# 30. Real",
    number: "30",
  });
});

test("a URL keeps its meaning when wrapped in an autolink or parentheses", () => {
  const text = [
    `<https://example.com/${CONTRACT}/0098-remote.md>`,
    `(https://example.com/${CONTRACT}/0099-remote.md)`,
  ].join("\n");
  assert.deepEqual(
    collectReferences("guide.md", text, {
      adrDirectory: CONTRACT,
      adrRoot: CONTRACT,
      linkBase: ".",
    }),
    [],
  );
});

test("the filename pattern accepts the house shape and rejects the rest", () => {
  assert.ok(ADR_FILENAME_PATTERN.test("0022-documentation-example-gate.md"));
  assert.ok(!ADR_FILENAME_PATTERN.test("22-short-number.md"));
  assert.ok(!ADR_FILENAME_PATTERN.test("0022_underscored.md"));
  assert.ok(!ADR_FILENAME_PATTERN.test("0022-Capitalised.md"));
  assert.equal(ADR_DIRECTORY, "docs/adr");
});

test("resolveTarget resolves relatively, and from the base when rooted", () => {
  assert.equal(
    resolveTarget("a/b/c.md", `../../${CONTRACT}/0001-x.md`, "."),
    `${CONTRACT}/0001-x.md`,
  );
  assert.equal(
    resolveTarget("a/b/c.md", `/${CONTRACT}/0001-x.md`, "."),
    `${CONTRACT}/0001-x.md`,
  );
});

test("isInside is path arithmetic, not existence", () => {
  assert.equal(isInside(CONTRACT, CONTRACT), true);
  assert.equal(isInside(CONTRACT, `${CONTRACT}/0001-x.md`), true);
  assert.equal(isInside(CONTRACT, `${CONTRACT}s/0001-x.md`), false);
});

test("a directory name is matched as text, not as a pattern", () => {
  // `--adr-dir` reaches two constructed regexes; interpolating it raw is a regex injection (CodeQL
  // raised `js/regex-injection` on this file) and silently mismatches any name holding `.` or `+`.
  assert.equal(escapeForRegExp("docs/adr"), "docs/adr");
  assert.equal(escapeForRegExp("docs/a.d+r"), "docs/a\\.d\\+r");
  // A dot must match a dot, not any character: `docs/a.r` must not be found by the token `docs/aXr`.
  assert.equal(labelledNumber("see docs/aXr/0007-x.md", "docs/a.r"), null);
  assert.equal(labelledNumber("see docs/a.r/0007-x.md", "docs/a.r"), "0007");
  const references = collectReferences(
    "guide.md",
    "see docs/aXr/0007-x.md and docs/a.r/0008-y.md\n",
    {
      adrDirectory: "docs/a.r",
      adrRoot: "docs/a.r",
      linkBase: ".",
    },
  );
  // Both directions in one corpus: a negative-only assertion is satisfied by OVER-escaping too.
  // The logic reviewer demonstrated that on the committed version by double-escaping the bare-path
  // construction, which passed 70/70; the labelled site already had both directions and died.
  assert.deepEqual(
    references.map((reference) => reference.source),
    ["docs/a.r/0008-y.md"],
  );
});

test("labelledNumber reads a label or a spelled-out path, else null", () => {
  assert.equal(labelledNumber(`${LABEL}-0007 (a title)`, CONTRACT), "0007");
  assert.equal(
    labelledNumber(`\`${CONTRACT}/0009-slug.md\``, CONTRACT),
    "0009",
  );
  assert.equal(labelledNumber("the toolchain record", CONTRACT), null);
});

test("pathNumber is gone: identity comes from the audited ADR set, not a numeric basename", () => {
  writeCleanCorpus();
  assertCleanControl();
  // A sibling family's document whose basename also opens with four digits. Deciding identity from
  // the basename accepted this; deciding it from the audited set does not.
  write("other/0001-a-different-family.md", "# 1. Elsewhere\n");
  write("guide.md", `see [${LABEL}-0001](other/0001-a-different-family.md)\n`);
  assert.match(
    failures(runOverTemp()),
    /is labelled ADR-0001 but resolves to .*other\/0001-a-different-family\.md, which is not/,
  );
});

test("rawLines keeps terminators, so offsets survive CRLF", () => {
  assert.deepEqual(rawLines("a\r\nb\n"), ["a\r\n", "b\n"]);
  assert.deepEqual(rawLines("no terminator"), ["no terminator"]);
  assert.deepEqual(rawLines(""), []);
});

test("lineNumberAt counts from one", () => {
  const text = "first\nsecond\nthird";
  assert.equal(lineNumberAt(text, 0), 1);
  assert.equal(lineNumberAt(text, text.indexOf("third")), 3);
});

// --- Enumeration --------------------------------------------------------------------------------

test("collectReferences classifies by all three signals and ignores the rest", () => {
  const text = [
    `[named](../../${CONTRACT}/0001-first.md)`,
    "[sibling](0002-second.md)",
    `[${LABEL}-0003](../elsewhere/0003-third.md)`,
    `[external](https://example.com/${CONTRACT}/0009-remote.md)`,
    "[protocol relative](//example.com/0001-first.md)",
    "[same document](#a-heading)",
    "[unrelated](../guide.md)",
    `a bare ${CONTRACT}/0004-fourth.md path`,
  ].join("\n");
  const references = collectReferences(`${CONTRACT}/0002-second.md`, text, {
    adrDirectory: CONTRACT,
    adrRoot: CONTRACT,
    linkBase: ".",
  });
  // Line 1's spelled-out path and line 4's path inside an external URL are each inside a link span,
  // so neither is counted a second time as a bare path.
  assert.deepEqual(
    references.map((reference) => [reference.form, reference.line]),
    [
      ["link", 1],
      ["link", 2],
      ["link", 3],
      ["path", 8],
    ],
  );
  assert.deepEqual(references[2].labelled, "0003");
  assert.deepEqual(references[3].resolved, `${CONTRACT}/0004-fourth.md`);
});

test("collectReferences sees a link whose target wraps onto the next line", () => {
  const text = `per the review gate ([${LABEL}-0004](\n0004-review-gate.md))\n`;
  const references = collectReferences(`${CONTRACT}/0005-x.md`, text, {
    adrDirectory: CONTRACT,
    adrRoot: CONTRACT,
    linkBase: ".",
  });
  assert.equal(references.length, 1);
  assert.equal(references[0].line, 1);
  assert.equal(references[0].resolved, `${CONTRACT}/0004-review-gate.md`);
  assert.ok(!references[0].source.includes("\n"));
});

test("collectReferences reads angle-bracketed and titled destinations", () => {
  const text = [
    "[angled](<0004-review-gate.md>)",
    '[titled](0006-sixth.md "The sixth record")',
    "[single quoted](0007-seventh.md 'The seventh record')",
    "[parenthesised](0008-eighth.md (The eighth record))",
    "[escaped \\] bracket](0009-ninth.md)",
  ].join("\n");
  const references = collectReferences(`${CONTRACT}/0005-x.md`, text, {
    adrDirectory: CONTRACT,
    adrRoot: CONTRACT,
    linkBase: ".",
  });
  assert.deepEqual(
    references.map((reference) => reference.resolved),
    [
      `${CONTRACT}/0004-review-gate.md`,
      `${CONTRACT}/0006-sixth.md`,
      `${CONTRACT}/0007-seventh.md`,
      `${CONTRACT}/0008-eighth.md`,
      `${CONTRACT}/0009-ninth.md`,
    ],
  );
});

test("a labelled link that leaves the repository is recorded as off-repo, not silently dropped", () => {
  const text = [
    `[${LABEL}-0001](https://example.com/records/0001)`,
    `[${LABEL}-0002](#a-local-heading)`,
    "[unlabelled](https://example.com/anything)",
  ].join("\n");
  const references = collectReferences("guide.md", text, {
    adrDirectory: CONTRACT,
    adrRoot: CONTRACT,
    linkBase: ".",
  });
  assert.deepEqual(
    references.map((reference) => [reference.form, reference.labelled]),
    [
      ["off-repo", "0001"],
      ["off-repo", "0002"],
    ],
  );
});

test("a bare ADR path is a reference unless the token it sits in is a URL", () => {
  const text = [
    `see https://github.com/other/repo/blob/main/${CONTRACT}/0009-theirs.md for detail`,
    `and //example.com/${CONTRACT}/0010-also-theirs.md`,
    `${CONTRACT}/0011-ours.md`,
  ].join("\n");
  const references = collectReferences("guide.md", text, {
    adrDirectory: CONTRACT,
    adrRoot: CONTRACT,
    linkBase: ".",
  });
  // The third is flush-left on its own line: a newline delimits the token, so it is ours.
  assert.deepEqual(
    references.map((reference) => reference.resolved),
    [`${CONTRACT}/0011-ours.md`],
  );
});

test("in markdown, a fenced or code-span link is an example; a bare path is still a reference", () => {
  const text = [
    "```md",
    `[${LABEL}-0001](${CONTRACT}/0001-first.md)`,
    "```",
    `an inline \`[${LABEL}-0002](${CONTRACT}/0002-second.md)\` example`,
    `but \`${CONTRACT}/0003-third.md\` in backticks is a real reference`,
  ].join("\n");
  const references = collectReferences("guide.md", text, {
    adrDirectory: CONTRACT,
    adrRoot: CONTRACT,
    linkBase: ".",
  });
  assert.deepEqual(
    references.map((reference) => [reference.form, reference.line]),
    [["path", 5]],
  );
});

test("outside markdown there is no code-span exemption — a comment is where bare paths live", () => {
  const text = `// see \`[label](${CONTRACT}/0001-first.md)\` in the module note\n`;
  const references = collectReferences("scripts/probe.mjs", text, {
    adrDirectory: CONTRACT,
    adrRoot: CONTRACT,
    linkBase: ".",
  });
  assert.deepEqual(
    references.map((reference) => reference.resolved),
    [`scripts/${CONTRACT}/0001-first.md`],
  );
});

test("a bare ADR path inside a plain-text URL belongs to another host, not this gate", () => {
  const text = `see https://github.com/other/repo/blob/main/${CONTRACT}/0009-theirs.md for
  detail\n`;
  const references = collectReferences("guide.md", text, {
    adrDirectory: CONTRACT,
    adrRoot: CONTRACT,
    linkBase: ".",
  });
  assert.deepEqual(references, []);
});

// --- The clean control --------------------------------------------------------------------------

test("CONTROL: a correct corpus passes, having actually checked something", () => {
  writeCleanCorpus();
  const result = assertCleanControl();
  assert.match(result.lines.at(-3), /adr numbering: 2 ADR\(s\)/);
  assert.match(result.lines.at(-2), /a filesystem walk of/);
  assert.match(result.lines.at(-1), /It does NOT check/);
});

test("a root-relative link is resolved against linkBase, in whatever separators it arrived in", () => {
  writeCleanCorpus();
  write("guide.md", `see [${LABEL}-0001](/${CONTRACT}/0001-first.md)\n`);
  // `linkBase` is the one option only a root-relative target consults, and every other test hands it
  // an already-canonical value — so review deleted its canonicalisation and no test noticed. Passing
  // it in the platform's own separators is what makes that deletion visible (on Windows, where the
  // conversion is not a no-op; elsewhere this asserts the path is still resolved correctly).
  const result = runAdrNumberingGate({
    roots: [TEMP_DIR],
    adrDirectory: CONTRACT,
    adrRoot: `${toPosixPath(TEMP_DIR)}/${CONTRACT}`,
    linkBase: join(TEMP_DIR, "sub", ".."),
  });
  assert.deepEqual(
    result.lines.filter((line) => line.startsWith("FAIL")),
    [],
  );
  assert.ok(
    result.counts.comparisons > 0,
    "the labelled link was not compared",
  );
});

test("native paths are normalised, so a Windows --adr-root is not a false red", () => {
  writeCleanCorpus();
  // The same corpus, addressed with the platform's own separators rather than posix ones.
  const result = runAdrNumberingGate({
    roots: [TEMP_DIR],
    adrDirectory: CONTRACT,
    adrRoot: join(TEMP_DIR, "contract", "adr"),
    linkBase: TEMP_DIR,
  });
  assert.deepEqual(
    result.lines.filter((line) => line.startsWith("FAIL")),
    [],
  );
  assert.ok(result.counts.comparisons > 0, "no label was compared at all");
});

test("a labelled off-repo link is reported with its file and line, not just counted", () => {
  writeCleanCorpus();
  write("guide.md", `context [${LABEL}-0001](https://example.com/records/1)\n`);
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.offRepo, 1);
  assert.ok(
    result.lines.some((line) =>
      /^UNCHECKED .*guide\.md:1: .*labelled ADR-0001 but points off-repo/.test(
        line,
      ),
    ),
    "the skipped site is not named",
  );
});

test("CONTROL: the gate's own defaults enumerate a non-empty corpus", () => {
  const result = runAdrNumberingGate();
  assert.ok(result.counts.files > 0, "the default scan found no files at all");
  assert.ok(result.counts.adrs > 0, "the default scan found no ADRs at all");
  assert.match(result.lines.at(-2), /tracked files PLUS untracked/);
});

// --- MUTATIONS: every way this gate is supposed to fail ------------------------------------------

test("MUTATION AC1: two ADRs sharing a number fail, naming both files", () => {
  writeCleanCorpus();
  assertCleanControl();
  writeAdr("0002", "duplicate");
  const failed = failures(runOverTemp());
  assert.match(failed, /ADR number 0002 is used by 2 documents/);
  assert.match(failed, /0002-duplicate\.md/);
  assert.match(failed, /0002-second\.md/);
});

test("MUTATION AC2: a heading that disagrees with the filename fails, naming both numbers", () => {
  writeCleanCorpus();
  assertCleanControl();
  writeAdr("0002", "second", "1");
  const failed = failures(runOverTemp());
  assert.match(
    failed,
    /0002-second\.md: the filename says 2 but the heading says 1/,
  );
});

test("MUTATION AC2: a document with no numbered heading fails", () => {
  writeCleanCorpus();
  assertCleanControl();
  write(`${CONTRACT}/0002-second.md`, "# A decision\n");
  assert.match(failures(runOverTemp()), /no level-1 heading of the form/);
});

test("MUTATION AC1: a filename outside the house shape fails", () => {
  writeCleanCorpus();
  assertCleanControl();
  write(`${CONTRACT}/003-short.md`, "# 3. A decision\n");
  assert.match(
    failures(runOverTemp()),
    /003-short\.md: an ADR filename must be/,
  );
});

test("MUTATION: an unreadable ADR is reported rather than skipped", () => {
  writeCleanCorpus();
  assertCleanControl();
  writeFileSync(
    join(TEMP_DIR, CONTRACT, "0003-binary.md"),
    Buffer.from([0x23, 0x00, 0x33]),
  );
  assert.match(
    failures(runOverTemp()),
    /0003-binary\.md: could not be read as text/,
  );
});

test("MUTATION AC3: a link with the wrong number of `../` fails, naming what it resolved to", () => {
  writeCleanCorpus();
  assertCleanControl();
  write(
    "deep/nested/note.md",
    `see [${LABEL}-0001](../${CONTRACT}/0001-first.md)\n`,
  );
  const failed = failures(runOverTemp());
  assert.match(failed, /deep\/nested\/note\.md:1/);
  assert.match(
    failed,
    /deep\/contract\/adr\/0001-first\.md, which does not exist/,
  );
});

test("MUTATION AC3: a label that disagrees with the path it resolves to fails", () => {
  writeCleanCorpus();
  assertCleanControl();
  write("guide.md", `see [${LABEL}-0001](${CONTRACT}/0002-second.md)\n`);
  const failed = failures(runOverTemp());
  assert.match(
    failed,
    /is labelled ADR-0001 but resolves to .*0002-second\.md/,
  );
  assert.match(failed, /which is not .*0001-first\.md/);
  assert.match(failed, /the link works, so only the label is wrong/);
});

test("MUTATION AC3: a label naming a number no ADR carries fails, saying so", () => {
  writeCleanCorpus();
  assertCleanControl();
  write("notes.md", "context\n");
  write("guide.md", `see [${LABEL}-0009](notes.md)\n`);
  const failed = failures(runOverTemp());
  assert.match(
    failed,
    /is labelled ADR-0009 but resolves to .*notes\.md, which is not that record — no ADR carries the number 0009/,
  );
});

test("MUTATION AC3: an UNLABELLED wrong-depth link fails on the directory-name signal alone", () => {
  writeCleanCorpus();
  assertCleanControl();
  // No `ADR-NNNN` label, and the broken path resolves OUTSIDE the ADR root — so neither the label
  // signal nor the resolved-inside-root signal sees it. Only "the target names the ADR directory"
  // does. Review deleted that signal and every other test still passed.
  write(
    "deep/nested/note.md",
    `the [documentation example gate](../${CONTRACT}/0002-second.md)\n`,
  );
  const failed = failures(runOverTemp());
  assert.match(failed, /deep\/nested\/note\.md:1/);
  assert.match(
    failed,
    /deep\/contract\/adr\/0002-second\.md, which does not exist/,
  );
});

test("MUTATION AC3: a titled link's depth is checked, not hidden by the bare-path scan", () => {
  writeCleanCorpus();
  assertCleanControl();
  write(
    "deep/nested/note.md",
    `see [first](../${CONTRACT}/0001-first.md "The first record")\n`,
  );
  assert.match(
    failures(runOverTemp()),
    /deep\/nested\/note\.md:1: .*deep\/contract\/adr\/0001-first\.md, which does not exist/,
  );
});

test("MUTATION AC3: a bare path naming an ADR that does not exist fails", () => {
  writeCleanCorpus();
  assertCleanControl();
  write("guide.md", `renamed to ${CONTRACT}/0002-renamed.md now\n`);
  assert.match(
    failures(runOverTemp()),
    /0002-renamed\.md, which does not exist/,
  );
});

test("a missing target is reported as non-existence, not as a label mismatch", () => {
  writeCleanCorpus();
  write("prose.md", `background in [${LABEL}-0001](notes.md)\n`);
  const failed = failures(runOverTemp());
  assert.match(failed, /notes\.md, which does not exist/);
  assert.ok(!failed.includes("is not an ADR"), "one defect, one voice");
});

test("MUTATION AC2: a zero-padded heading number fails, because it is a different convention", () => {
  writeCleanCorpus();
  assertCleanControl();
  writeAdr("0002", "second", "0002");
  assert.match(
    failures(runOverTemp()),
    /0002-second\.md: the filename says 2 but the heading says 0002/,
  );
});

test("MUTATION AC2: a fenced heading is not the document's heading", () => {
  writeCleanCorpus();
  assertCleanControl();
  write(`${CONTRACT}/0002-second.md`, "```\n# 2. A decision\n```\n\nprose\n");
  assert.match(failures(runOverTemp()), /no level-1 heading of the form/);
});

test("MUTATION AC1: an odd-cased extension is audited rather than escaping the shape rule", () => {
  writeCleanCorpus();
  assertCleanControl();
  write(`${CONTRACT}/0003-Third.MD`, "# 3. A decision\n");
  assert.match(
    failures(runOverTemp()),
    /0003-Third\.MD: an ADR filename must be/,
  );
});

test("MUTATION: the scan reaches untracked files — pinned in an isolated repository", () => {
  const repository = join(TEMP_DIR, "repository");
  mkdirSync(join(repository, CONTRACT), { recursive: true });
  const git = (...args) =>
    spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "gate@example.invalid");
  git("config", "user.name", "gate");
  writeFileSync(
    join(repository, CONTRACT, "0001-first.md"),
    "# 1. A decision\n",
    "utf8",
  );
  git("add", "-A");
  git("commit", "-qm", "seed");

  const cli = (...extra) =>
    spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, "check-adr-numbering.mjs"),
        `--adr-dir=${CONTRACT}`,
        ...extra,
      ],
      { cwd: repository, encoding: "utf8" },
    );

  // CLEAN CONTROL: the committed repository passes, so the failure below is the untracked file and
  // not some accident of the fixture.
  const control = cli();
  assert.equal(control.status, 0, control.stdout + control.stderr);

  // Never `git add`ed — invisible to a tracked-only enumeration, which is how a gate comes to
  // report green over a corpus that excludes the very file under review.
  const note = "note.md";
  writeFileSync(
    join(repository, note),
    `see [${LABEL}-0001](${CONTRACT}/0001-renamed-away.md)\n`,
    "utf8",
  );
  assert.equal(
    git("ls-files", note).stdout,
    "",
    "the control file is untracked",
  );

  const run = cli();
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(
    run.stdout,
    /note\.md:1: .*0001-renamed-away\.md, which does not exist/,
  );
});

test("a binary file in the scanned set is skipped, not counted", () => {
  writeCleanCorpus();
  const before = assertCleanControl().counts.files;
  writeFileSync(join(TEMP_DIR, "logo.png"), Buffer.from([0x89, 0x00, 0x4e]));
  assert.equal(runOverTemp().counts.files, before);
});

// --- CLI shell -----------------------------------------------------------------------------------

/** Run the CLI shell over the temp tree, with any extra arguments appended. */
function runCli(...extra) {
  const options = temporaryOptions();
  return spawnSync(
    process.execPath,
    [
      "scripts/check-adr-numbering.mjs",
      `--root=${TEMP_DIR}`,
      `--adr-dir=${options.adrDirectory}`,
      `--adr-root=${options.adrRoot}`,
      `--link-base=${options.linkBase}`,
      ...extra,
    ],
    { encoding: "utf8" },
  );
}

test("parseArgs reads every option, and omits roots when none are given", () => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(
    parseArgs([
      "--root=one",
      "--root=two",
      "--adr-dir=contract/adr",
      "--adr-root=/tmp/contract/adr",
      "--link-base=/tmp",
      "--unknown=ignored",
    ]),
    {
      roots: ["one", "two"],
      adrDirectory: "contract/adr",
      adrRoot: "/tmp/contract/adr",
      linkBase: "/tmp",
    },
  );
});

test("the CLI exits 0 and prints its report on a clean corpus", () => {
  writeCleanCorpus();
  const run = runCli();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /adr numbering: 2 ADR\(s\)/);
});

test("the CLI exits 1 on a corpus the gate rejects", () => {
  writeCleanCorpus();
  writeAdr("0002", "duplicate");
  const run = runCli();
  assert.equal(run.status, 1);
  assert.match(run.stdout, /FAIL ADR number 0002 is used by 2 documents/);
});

// Unit tests for the wrong-anchor suspect scanner (saga #1180). These import
// scripts/spec-citation-suspects.mjs's logic directly for 100% coverage, plus a subprocess test for
// the CLI shell, pointed at isolated temp fixtures via --root/--spec-dir/--spec-root.
//
// Fixtures name a `contract/` directory and this file never writes the real specification
// directory's name as a literal, for the reason the gate's own suite gives: both files are scanned
// by the gate in CI.
//
// The point of this suite is narrower than "does the scorer work". A ranked heuristic cannot be
// pinned by asserting its output on real prose — that would be asserting today's behaviour. What is
// pinned instead is the set of properties the tool's own report CLAIMS: that a title can never win,
// that the self-check fails when the instrument breaks, that findings never fail a build, and that
// the queue is deduplicated. Those are the claims a reader would rely on.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";
import { splitLines } from "./spec-citations-gate.mjs";
import {
  anchorClaims,
  bodyScore,
  claimMass,
  claimNamesHeading,
  contentWords,
  DEFAULT_THRESHOLDS,
  inverseDocumentFrequency,
  relationOf,
  reportSuspects,
  scanSuspects,
  scoreClaim,
  sectionBodies,
  seededRandom,
  SELF_CHECK,
  subtreeOf,
} from "./spec-citation-suspects.mjs";

const CONTRACT = "contract";
let TEMP_DIR;

beforeEach(() => {
  TEMP_DIR = mkdtempSync(join(tmpdir(), "ol-suspects-"));
});

afterEach(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

function write(name, text) {
  const path = join(TEMP_DIR, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

/** A document whose title spans everything and whose sections are deliberately lopsided. */
const DOC = [
  "# Grammar", // 1
  "", // 2
  "## Lexical form", // 3
  "", // 4
  "Word literals use double quotes and escapes for quote and backslash.", // 5
  "", // 6
  "## Comprehensions", // 7
  "", // 8
  "A comprehension body binds an item and reduces an accumulator.", // 9
  "Duplicate binder names raise a duplicate-binder diagnostic.", // 10
  "", // 11
  "### Reduce", // 12
  "", // 13
  "Empty input returns the initial accumulator unchanged.", // 14
].join("\n");

function writeDoc() {
  write(`${CONTRACT}/grammar.md`, DOC);
}

function runOverTemp(extra = {}) {
  return scanSuspects({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
    ...extra,
  });
}

test("contentWords splits identifiers, drops jargon, and stems a trailing plural", () => {
  const words = contentWords(
    "bindElement binds snake_case levels per contract/x.md#y",
  );
  assert.ok(words.has("bind"));
  assert.ok(words.has("element"));
  assert.ok(words.has("snake"));
  assert.ok(words.has("case"));
  // `levels` stems to `level`, which is what makes the heading guard work on plural headings.
  assert.ok(words.has("level"));
  // Repo jargon separates nothing and is dropped, as is the citation token itself.
  assert.ok(!words.has("spec"));
  assert.ok(!words.has("per"));
  for (const word of words) {
    assert.ok(word.length > 3, `${word} is too short to carry signal`);
  }
});

test("sectionBodies gives every line exactly one body, so nothing is double-counted", () => {
  const bodies = sectionBodies(splitLines(DOC));
  assert.deepEqual(
    bodies.map((body) => `${body.slug}:${body.depth}`),
    ["grammar:1", "lexical-form:2", "comprehensions:2", "reduce:3"],
  );
  // The TITLE body holds only its own lines — not the whole document. That is the fix for the
  // artifact: a title used to contain every word and therefore beat every real answer.
  assert.ok(!bodies[0].words.has("accumulator"));
  assert.ok(!bodies[0].words.has("literal"));
  assert.ok(bodies[2].words.has("accumulator"));
  // `#reduce`'s content belongs to `#reduce`, not to its parent's body.
  assert.ok(!bodies[2].words.has("initial"));
  assert.ok(bodies[3].words.has("initial"));
});

test("subtreeOf spans a heading and its descendants, and stops at an equal depth", () => {
  const bodies = sectionBodies(splitLines(DOC));
  // The title's subtree is the whole document, which is exactly why nothing can out-score it.
  assert.deepEqual(subtreeOf(bodies, "grammar"), [0, 1, 2, 3]);
  assert.deepEqual(subtreeOf(bodies, "comprehensions"), [2, 3]);
  assert.deepEqual(subtreeOf(bodies, "reduce"), [3]);
  assert.deepEqual(subtreeOf(bodies, "not-a-heading"), []);
});

test("THE TITLE ARTIFACT cannot come back: a document title is never suggested", () => {
  // The first version of this scan reported that a third of the corpus should point at the document
  // TITLE, because a title's section spanned the whole file and contained every word. It was caught
  // by disbelieving a plausible number. The structure now makes it impossible rather than unlikely:
  // the title's subtree is the whole document, so its own score is the best score available and no
  // rival can beat it by any margin.
  writeDoc();
  write(
    "cites.md",
    "A comprehension body binds an item and reduces an accumulator, " +
      `and duplicate binder names raise a diagnostic (${CONTRACT}/grammar.md#grammar).\n`,
  );
  const result = runOverTemp();
  assert.deepEqual(result.sites, [], "a title citation must never be flagged");
});

test("a claim matching a sibling better than the cited section is ranked", () => {
  writeDoc();
  write(
    "cites.md",
    "A comprehension body binds an item and reduces an accumulator, and duplicate " +
      `binder names raise a duplicate-binder diagnostic (${CONTRACT}/grammar.md#lexical-form).\n`,
  );
  const result = runOverTemp();
  assert.equal(result.sites.length, 1);
  assert.equal(result.sites[0].cited, "lexical-form");
  assert.equal(result.sites[0].suggested, "comprehensions");
  assert.equal(result.sites[0].relation, "sibling");
  assert.ok(result.sites[0].delta > DEFAULT_THRESHOLDS.margin);
});

test("citing a PARENT whose content lives in a child is never flagged", () => {
  // The cited score is the best body inside the cited subtree, so a parent inherits its child's
  // match. Flagging it would report imprecision as error on every summary heading in the corpus.
  writeDoc();
  write(
    "cites.md",
    "Empty input returns the initial accumulator unchanged for a reduction " +
      `(${CONTRACT}/grammar.md#comprehensions).\n`,
  );
  assert.deepEqual(runOverTemp().sites, []);
});

test("a claim that names the cited heading is never flagged", () => {
  // Spelling out the heading is strong evidence the citation was deliberate. Without this guard a
  // small correct section loses to a large table that merely lists the same words.
  const bodies = sectionBodies(splitLines(DOC));
  assert.equal(
    claimNamesHeading(
      contentWords("the lexical form of a word literal"),
      "Lexical form",
    ),
    true,
  );
  assert.equal(
    claimNamesHeading(contentWords("something else entirely"), "Lexical form"),
    false,
  );
  // An empty heading names nothing, so it cannot vacuously guard everything.
  assert.equal(claimNamesHeading(contentWords("anything"), ""), false);
  assert.equal(bodies.length, 4);
});

test("IDF makes a rare word outweigh several common ones", () => {
  const bodies = sectionBodies(splitLines(DOC));
  const idf = inverseDocumentFrequency(bodies);
  // `accumulator` appears in two of four bodies; `comprehension` in one. The rarer word carries more.
  assert.ok(idf.get("comprehension") > idf.get("accumulator"));
  const rare = claimMass(new Set(["comprehension"]), idf);
  assert.ok(rare > 0);
  // A word the document never uses still carries a floor mass rather than zero, so an unknown term
  // does not silently make a claim weightless.
  assert.ok(claimMass(new Set(["unheardof"]), idf) > 0);
  // A claim with no mass scores zero rather than dividing by zero.
  assert.equal(bodyScore(new Set(), bodies[1], idf, 0), 0);
});

test("relationOf reports sibling against other, which is how imprecision is triaged", () => {
  const bodies = sectionBodies(splitLines(DOC));
  assert.equal(relationOf(bodies, "lexical-form", "comprehensions"), "sibling");
  assert.equal(relationOf(bodies, "comprehensions", "reduce"), "other");
  assert.equal(relationOf(bodies, "missing", "reduce"), "other");
  assert.equal(relationOf(bodies, "reduce", "missing"), "other");
});

test("the claim is the enclosing PROSE RUN, not the citing line", () => {
  // The line window leaves most of the corpus unscorable — a blind spot shaped like "citations
  // inside dense JSDoc" — and produces more noise, because a short claim reaches a high overlap
  // fraction by accident.
  const text = [
    "/**",
    " * A comprehension body binds an item and reduces an accumulator.",
    " * Duplicate binder names raise a duplicate-binder diagnostic",
    ` * (${CONTRACT}/grammar.md#lexical-form).`,
    " */",
    "",
  ].join("\n");
  const claims = anchorClaims("a.ts", text, CONTRACT);
  assert.equal(claims.length, 1);
  assert.ok(claims[0].prose.includes("accumulator"));
  assert.ok(claims[0].prose.includes("Duplicate binder"));
  // And a citation on a NON-prose line falls back to the line itself rather than being dropped.
  const live = anchorClaims(
    "a.ts",
    `const x = "${CONTRACT}/grammar.md#reduce";\n`,
    CONTRACT,
  );
  assert.equal(live.length, 1);
  assert.ok(live[0].prose.includes("grammar.md#reduce"));
});

test("scoreClaim returns null for a slug the document does not publish", () => {
  const bodies = sectionBodies(splitLines(DOC));
  const document = { bodies, idf: inverseDocumentFrequency(bodies) };
  assert.equal(
    scoreClaim(
      { slug: "not-a-heading", prose: "anything at all" },
      document,
      DEFAULT_THRESHOLDS,
    ),
    null,
  );
  // And for a claim too thin to be asserting anything.
  assert.equal(
    scoreClaim(
      { slug: "reduce", prose: "a b c" },
      document,
      DEFAULT_THRESHOLDS,
    ),
    null,
  );
});

test("the queue is DEDUPLICATED to one row per cited-to-suggested pair", () => {
  // A systematic false positive must cost one dismissal, not thirty. A queue whose first rows are
  // the same judgement repeated destroys a reviewer's trust in minutes.
  writeDoc();
  const claim =
    "A comprehension body binds an item and reduces an accumulator, and duplicate " +
    `binder names raise a duplicate-binder diagnostic (${CONTRACT}/grammar.md#lexical-form).`;
  write("one.md", `${claim}\n`);
  write("two.md", `${claim}\n`);
  write("three.md", `${claim}\n`);
  const result = runOverTemp();
  assert.equal(result.sites.length, 3, "every site is still counted");
  assert.equal(result.pairs.length, 1, "but the queue is one decision");
  assert.equal(result.pairs[0].occurrences, 3);
  assert.ok(result.pairs[0].example.endsWith(".md:1"));
});

test("seededRandom is deterministic, so the self-check samples the same sites every run", () => {
  const first = [...Array(5)].map(seededRandom(1180));
  const second = [...Array(5)].map(seededRandom(1180));
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, [...Array(5)].map(seededRandom(99)));
  for (const value of first) {
    assert.ok(value >= 0 && value < 1);
  }
});

test("FINDINGS never fail; the SELF-CHECK does — and an empty corpus fails loudest", () => {
  // The split the maintainer required: a heuristic that failed a build would be the same defect as
  // a gate that measures nothing. Only the tool's checks on ITSELF may fail.
  writeDoc();
  write(
    "cites.md",
    "A comprehension body binds an item and reduces an accumulator, and duplicate " +
      `binder names raise a duplicate-binder diagnostic (${CONTRACT}/grammar.md#lexical-form).\n`,
  );
  const withFinding = reportSuspects({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
  });
  assert.ok(
    withFinding.lines.some((line) => line.startsWith("RANKED ")),
    "the finding must be reported",
  );
  // A corpus this small cannot satisfy the mutation band, which is itself the point: the tool says
  // so rather than pretending the queue means something.
  assert.ok(
    withFinding.lines.some((line) => line.includes("self-check:")),
    "the self-check result is always printed",
  );

  // An empty corpus is the silent-failure shape: nothing scanned looks exactly like nothing wrong.
  rmSync(join(TEMP_DIR, "cites.md"));
  const empty = reportSuspects({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
  });
  assert.equal(empty.ok, false);
  assert.ok(
    empty.lines.some((line) => line.includes("no anchor was scanned at all")),
    "an empty scan must fail rather than read as clean",
  );
});

test("the coverage statement names every limit a reader would otherwise assume away", () => {
  writeDoc();
  write("cites.md", `See ${CONTRACT}/grammar.md#reduce for the empty case.\n`);
  const summary = reportSuspects({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
  }).lines.join("\n");
  assert.match(summary, /RANKED REPORT, not a gate/);
  assert.match(summary, /its silence proves nothing/);
  assert.match(summary, /property of THIS instrument/);
  assert.match(summary, /cannot tell a WRONG anchor from a LESS SPECIFIC one/);
  assert.match(summary, /never by re-pointing what the tool ranked/);
  assert.ok(SELF_CHECK.floor < SELF_CHECK.ceiling);
});

test("every skip path is exercised, so none can rot into a silent blind spot", () => {
  writeDoc();
  // A document the specification directory does not publish: unreadable, so nothing is scored.
  write("missing.md", `See ${CONTRACT}/absent.md#whatever here in prose.\n`);
  // A file that names no specification document at all.
  write("silent.md", "Nothing here cites anything.\n");
  // A binary file, which readTextFile refuses.
  writeFileSync(join(TEMP_DIR, "blob.bin"), Buffer.from([0x00, 0x01]));
  // A document that publishes NO heading at all yields no bodies and is skipped.
  write(`${CONTRACT}/headless.md`, "just prose, no headings at all\n");
  write("headless-cite.md", `See ${CONTRACT}/headless.md#nope for it.\n`);
  // An anchor naming a slug the document does not publish is not scorable.
  write("unknown.md", `See ${CONTRACT}/grammar.md#no-such-section for it.\n`);
  const result = runOverTemp();
  assert.deepEqual(result.sites, []);
  assert.ok(result.scanned >= 1, "the resolvable anchors are still scanned");

  // A file INSIDE the specification directory is never scanned: a document citing a sibling is the
  // gate's business, not this tool's.
  write(
    `${CONTRACT}/sibling.md`,
    `# S\n\nSee ${CONTRACT}/grammar.md#reduce.\n`,
  );
  assert.equal(
    runOverTemp().sites.length,
    0,
    "a spec-internal citation is out of scope",
  );
});

test("the representative site of a pair is the first in scan order, and reproducible", () => {
  // A reviewer opens one example per row, so it must be reproducible rather than whichever instance
  // happened to score highest on the day.
  writeDoc();
  const claim =
    "A comprehension body binds an item and reduces an accumulator, and duplicate " +
    `binder names raise a duplicate-binder diagnostic (${CONTRACT}/grammar.md#lexical-form).`;
  write("aaa.md", `${claim}\n`);
  write("zzz.md", `${claim}\n`);
  const first = runOverTemp();
  assert.equal(first.pairs.length, 1);
  assert.equal(first.pairs[0].occurrences, 2);
  assert.ok(first.pairs[0].example.includes("aaa.md"));
  // And the same tree gives the same representative every time.
  assert.equal(runOverTemp().pairs[0].example, first.pairs[0].example);
});

test("a document with a single body cannot mutate, so the self-check leaves it alone", () => {
  // The reslug hook has nowhere to go when a document publishes one section; returning the same slug
  // keeps the control honest rather than inventing a mutation that never happened.
  write(
    `${CONTRACT}/solo.md`,
    "# Solo\n\nOne section only, with several distinctive words.\n",
  );
  write(
    "cites.md",
    `One section only with several distinctive words (${CONTRACT}/solo.md#solo).\n`,
  );
  const mutated = runOverTemp({ reslug: () => "solo" });
  assert.deepEqual(mutated.sites, []);
});

test("over a corpus large enough to calibrate, the report exercises every check it prints", () => {
  // The self-check, the concentration warning and the pair ordering all need a
  // corpus with enough sites to sample. One purpose-built fixture drives them together, because
  // each in isolation would be asserting a branch rather than a behaviour.
  write(
    `${CONTRACT}/big.md`,
    [
      "# Big",
      "",
      "## Alpha section",
      "",
      "Alpha discusses turtles, headings, degrees, clockwise rotation and normalisation.",
      "",
      "## Beta section",
      "",
      "Beta enumerates diagnostics: unknown-field, duplicate-binder, range, type, and arity",
      "codes with params and spans and stages and severities and did-you-mean suggestions.",
      "",
      "## Gamma section",
      "",
      "Gamma describes comprehensions, accumulators, binders, reducers and iteration.",
    ].join("\n"),
  );
  // Many citations of Alpha whose prose is entirely about Beta's subject matter: a concentration
  // spike toward one attractor section, which is exactly what the printed warning is for.
  for (let index = 0; index < 40; index += 1) {
    write(
      `bulk/site-${index}.md`,
      "Diagnostics carry codes and params and spans and stages and severities " +
        `and did-you-mean suggestions (${CONTRACT}/big.md#alpha-section).\n`,
    );
  }
  // And a large set of clean citations, so the seeded control has a population to sample from.
  for (let index = 0; index < 60; index += 1) {
    write(
      `clean/site-${index}.md`,
      "Gamma describes comprehensions, accumulators, binders, reducers and iteration " +
        `in detail (${CONTRACT}/big.md#gamma-section).\n`,
    );
  }
  // A second attractor with a much smaller share, so the artifact warning is shown to discriminate
  // rather than to fire on whatever is first.
  for (let index = 0; index < 4; index += 1) {
    write(
      `bulk/other-${index}.md`,
      "Turtles carry headings in degrees and rotate clockwise with normalisation " +
        `applied (${CONTRACT}/big.md#gamma-section).\n`,
    );
  }
  // A file with no specification mention at all, so the control pass has something to skip.
  write(
    "bulk/unrelated.md",
    "This document mentions nothing normative whatsoever.\n",
  );
  const report = reportSuspects({
    roots: [TEMP_DIR],
    specDirectory: CONTRACT,
    specRoot: join(TEMP_DIR, CONTRACT),
  });
  const text = report.lines.join("\n");
  assert.match(text, /self-check: \d+\/\d+ seeded mutations detected/);
  assert.match(text, /attractor check: /);
  // One section absorbing most of the queue is an artifact of the scorer, and the report says so
  // rather than presenting it as forty discoveries.
  assert.match(text, /ARTIFACT, not a discovery/);
  // …and the section that absorbs only a few sites is reported without that warning, so the warning
  // discriminates rather than decorating whatever is listed first.
  const attractors = report.lines.filter((line) =>
    line.includes("attractor check:"),
  );
  assert.ok(attractors.length >= 2, "expected more than one attractor row");
  assert.ok(
    attractors.some((line) => !line.includes("ARTIFACT")),
    "a small attractor must not be labelled an artifact",
  );
  assert.match(text, /RANKED /);
  // The pairs are ordered by delta, strongest first, so a reviewer reads the best evidence first.
  const deltas = report.lines
    .filter((line) => line.startsWith("RANKED "))
    .map((line) => Number(/delta ([0-9.]+)/.exec(line)[1]));
  assert.deepEqual(
    deltas,
    [...deltas].sort((a, b) => b - a),
  );
});

test("with no --spec-root the documents are read relative to the working directory", () => {
  // The option exists for tests and for scoped runs; without it the tool must still resolve the
  // specification directory itself rather than silently reading nothing from somewhere else.
  writeDoc();
  write(
    "site.md",
    `Turtles rotate clockwise in degrees (${CONTRACT}/grammar.md#lexical-form).\n`,
  );
  const result = scanSuspects({ roots: [TEMP_DIR], specDirectory: CONTRACT });
  // `contract/` does not exist below the process working directory, so every document is unreadable
  // and nothing is scored — the tool reports that rather than pretending the corpus is clean.
  assert.equal(result.scorable, 0);
  assert.equal(result.sites.length, 0);
});

test("the CLI exits 0 on a healthy corpus and non-zero when its own checks fail", () => {
  // Both halves, because an instrument that can only succeed is the defect this saga keeps finding.
  const cli = fileURLToPath(
    new URL("./check-spec-citation-suspects.mjs", import.meta.url),
  );
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const healthy = spawnSync(process.execPath, [cli], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(
    healthy.status,
    0,
    `expected a clean run, got:\n${healthy.stdout}\n${healthy.stderr}`,
  );
  assert.match(healthy.stdout, /citation suspects: /);

  // An empty scope scores nothing, which must fail rather than read as a green queue.
  const empty = join(TEMP_DIR, "empty-scope");
  mkdirSync(empty, { recursive: true });
  const barren = spawnSync(process.execPath, [cli, `--root=${empty}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(barren.status, 1);
  assert.match(barren.stdout, /FAIL/);
});

test("the CLI never fails BECAUSE OF a finding — only the tool's checks on itself can fail", () => {
  writeDoc();
  write(
    "cites.md",
    "A comprehension body binds an item and reduces an accumulator, and duplicate " +
      `binder names raise a duplicate-binder diagnostic (${CONTRACT}/grammar.md#lexical-form).\n`,
  );
  const result = spawnSync(
    process.execPath,
    [
      join("scripts", "check-spec-citation-suspects.mjs"),
      `--root=${TEMP_DIR}`,
      `--spec-dir=${CONTRACT}`,
      `--spec-root=${join(TEMP_DIR, CONTRACT)}`,
    ],
    { encoding: "utf8" },
  );
  assert.match(result.stdout, /RANKED /, "the finding is reported");
  // A three-line fixture cannot satisfy the seeded mutation band, so this run does fail — and every
  // failing line must be the tool checking ITSELF. None may be a finding. That is the split the
  // maintainer required, asserted on the output rather than assumed from the code.
  for (const line of result.stdout
    .split("\n")
    .filter((l) => l.startsWith("FAIL"))) {
    assert.ok(
      /self-check|mutation control|control site|no anchor was scanned/.test(
        line,
      ),
      `a finding must never fail a build: ${line}`,
    );
  }
});

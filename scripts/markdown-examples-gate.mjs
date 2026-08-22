/**
 * Logic module for the **markdown fenced-block** half of the `examples` Definition-of-Done gate
 * (issue #850). Extracted so tests can import it directly for 100% coverage, keeping
 * `scripts/check-markdown-examples.mjs` a thin CLI shell — the same shape
 * `scripts/examples-gate.mjs` + `scripts/check-examples.mjs` and `scripts/harness/index.mjs` +
 * `scripts/conformance.mjs` already have. A CLI shell is exercised through a subprocess, so it
 * stays outside the loaded-module coverage set `docs/adr/0009-test-layout.md` defines.
 *
 * **Why this exists.** The Definition of Done says runnable `spec/examples/*.logo` **and doc
 * examples** still parse and run. Only the first half was enforced: `scripts/examples-gate.mjs`
 * runs the standalone files under `spec/examples/`, so every OpenLogo program embedded in spec or
 * docs prose was never parsed and never executed. That is how `set_shape "bee"` — a shape word no
 * conforming renderer accepts, raising `ol-type` — survived in `spec/turtles-and-sprites.md` into a
 * shipped 0.1.0 conformance claim, and was found by a human reading the prose rather than by CI.
 * The design rationale is `docs/adr/0021-documentation-example-gate.md`.
 *
 * **One rule, no exceptions:** every fenced block whose info string is `logo` in `spec/**.md` and
 * `docs/**.md` is parsed, statically checked, and executed ({@link analyzeBlock}); it must either
 * produce **no** error-severity `ol-*` diagnostic, or carry an entry in the expectations manifest
 * that declares **exactly** what it does produce. There is no automatic tolerance and no
 * "close enough" — a block the gate cannot fully account for fails.
 *
 * That matters because the interesting failures hide in the excusable-looking cases. Most prose
 * blocks are excerpts whose names live in the surrounding paragraph, so an earlier design
 * auto-excused `ol-undefined-var`/`ol-unknown-command`. But `forwad 100` and `forward :szie` are
 * *indistinguishable* from a legitimate excerpt by diagnostic code alone, so that tolerance would
 * have silently swallowed exactly the typo class this gate exists to catch. Listing each excerpt
 * (`kind: "prose-fragment"`) costs a manifest entry and buys an assertion.
 *
 * **What a listed excerpt does and does not prove.** Parsing and static checking always cover the
 * *whole* block, so a misspelled command, an undefined variable, a bad arity, a non-place
 * assignment target, or any syntax error is caught wherever it sits. **Execution, however, stops at
 * the first runtime error** — so in a block whose first statement already raises (typically
 * `ol-undefined-var`, because its value is assigned in the prose), the statements *below* that line
 * would be checked statically but never run, and a runtime-only defect down there — `ol-type`,
 * `ol-range`, `ol-unknown-key`, `ol-unknown-field` — would not be observed.
 *
 * Two things address that. An entry may carry a **`setup`** preamble: faithful context drawn from
 * the surrounding prose, prepended before the block runs, which lets the excerpt execute to
 * completion and assert a clean result instead of halting on line one. Where that is impossible —
 * a `forever` demo, a blocking `input`, or a block whose whole point is the error it stops on — the
 * limit is **made visible rather than claimed away**: the block is reported as `PARTIAL` with its
 * own count in the summary line, naming the line execution stopped at. Four of 315 blocks are
 * `PARTIAL` today. Do not read a green run as "every line of every block executed".
 *
 * **Determinism.** The instruction budget is fixed ({@link DOCUMENTATION_INSTRUCTION_BUDGET}) and
 * file order is a code-unit sort, so a run is reproducible. One exposure remains: blocks that call
 * `random` execute against `@openlogo/runtime`'s unseeded generator. No block's *diagnostics*
 * depend on the value today, but one that branched on it (`if (random 2) == 0 [ … ]`) could flake.
 * If `ExecuteOptions` ever gains a seed, pass a fixed one here.
 *
 * **The manifest lives outside the prose it describes.** `spec/` is maintainer-owned (AGENTS.md),
 * so this gate must never add tags, headers, or annotations to the documents it checks — the same
 * constraint that keeps `scripts/examples-profiles.json` out of `spec/examples/`.
 *
 * **Keys are content fingerprints, not line numbers** ({@link blockFingerprint}): prose edits above
 * a block must not churn the manifest, but editing the *block itself* must force a re-triage. A
 * fingerprint that matches no block in its file — or more than one — fails the gate.
 *
 * **Supported markdown subset.** {@link extractFencedBlocks} implements the CommonMark fence rules
 * this corpus actually uses, and **fails loudly** on the ones it does not (see
 * {@link UNSUPPORTED_FENCE_REASONS}) rather than guessing — so the gate is never silently wrong
 * about where a block starts or ends.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { isDiagnosticCode } from "@openlogo/core";
import { OL_CHECK_PROFILES, check, parse } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";
import { IMPLEMENTED_PROFILES, detectUsedProfiles } from "./examples-gate.mjs";

/** Directory roots scanned for markdown documents, relative to the repository root. */
export const MARKDOWN_ROOTS = ["spec", "docs"];

/** Location of the expectations manifest this gate asserts against. */
export const EXPECTATIONS_PATH = join(
  "scripts",
  "markdown-examples-expectations.json",
);

/**
 * Instruction budget for one documentation block. Far below `@openlogo/runtime`'s default
 * 1,000,000 so the whole corpus stays a few seconds, and far above anything a teaching example
 * needs — a block that reaches it is demonstrating `forever` or a blocking `input`, and is listed
 * as `non-terminating`. Fixed (never derived from the machine) so the gate is deterministic.
 */
export const DOCUMENTATION_INSTRUCTION_BUDGET = 100_000;

/**
 * The `kind` values an expectation entry may declare, mapped to the manifest field each asserts.
 * `kind` is documentation for the human reading the manifest; the assertion is what makes an entry
 * a check rather than a mute button.
 *
 * A `prose-fragment` may also carry a `setup` preamble — faithful context drawn from the
 * surrounding prose — which lets the excerpt run to completion and assert a clean result instead of
 * halting at its first undefined name. Any entry may carry an `issue`; `known-broken` must.
 */
export const EXPECTATION_KINDS = new Map([
  /** An excerpt whose names are defined in the surrounding prose, not in the block. */
  ["prose-fragment", "codes"],
  /** The prose teaches this exact diagnostic; the block MUST keep producing it. */
  ["deliberate-error", "codes"],
  /** The fence says `logo` but holds EBNF/reserved-word text, not OpenLogo source. */
  ["not-openlogo", "codes"],
  /** Demonstrates `forever` or a blocking `input`, so it reaches the instruction budget. */
  ["non-terminating", "codes"],
  /** Uses a profile with no implementation yet, so it cannot be executed at all. */
  ["profile-not-implemented", "profiles"],
  /** A genuine defect in the prose, recorded and reported until its owner fixes it. */
  ["known-broken", "codes"],
]);

/**
 * True when `code` is a real entry in the `ol-*` registry `@openlogo/core` owns — not merely
 * `ol-`-shaped. Checking the shape alone would let an invented `ol-not-real` into the manifest and
 * make an expectation permanently unmatchable, so the registry itself is the authority.
 */
function isDeclarableCode(code) {
  return typeof code === "string" && isDiagnosticCode(code);
}

/**
 * Markdown fence constructs {@link extractFencedBlocks} deliberately refuses to guess at. None
 * occur in `spec/` or `docs/` today; if one appears, the gate fails and names it rather than
 * mis-reading where the block begins or ends. See
 * `docs/adr/0021-documentation-example-gate.md` for why this is a guard rather than a CommonMark
 * dependency.
 */
export const UNSUPPORTED_FENCE_REASONS = Object.freeze({
  BLOCKQUOTE: "a fence inside a blockquote (`>`)",
  LIST_MARKER: "a fence sharing its line with a list marker",
  DEEP_INDENT:
    "a fence indented four or more columns, which CommonMark may read as indented code",
  BACKTICK_IN_INFO:
    "a backtick fence whose info string contains a backtick, which CommonMark does not read as a fence at all",
  UNCLOSED:
    "a fence that is never closed — the rest of the file is swallowed into it",
});

/** Convert a native path to the `/`-separated form used as a manifest key on every platform. */
export function toPosixPath(path) {
  return path.split(sep).join("/");
}

/**
 * Every `.md` file under `roots`, depth-first and sorted, as `/`-separated repository-relative
 * paths. A root that does not exist contributes nothing (the caller decides whether that matters).
 */
export function findMarkdownFiles(roots = MARKDOWN_ROOTS) {
  const found = [];
  const visit = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => (left.name < right.name ? -1 : 1),
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.name.endsWith(".md")) {
        found.push(toPosixPath(path));
      }
    }
  };
  for (const root of roots) {
    if (existsSync(root)) {
      visit(root);
    }
  }
  return found.sort();
}

const FENCE_OPENER = /^([ \t]*)(`{3,}|~{3,})[ \t]*(\S*)/;
const BLOCKQUOTED_FENCE = /^[ \t]*(?:>[ \t]*)+(?:`{3,}|~{3,})/;
const LIST_MARKER_FENCE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:`{3,}|~{3,})/;

/**
 * Which {@link UNSUPPORTED_FENCE_REASONS} entry (if any) applies to a line that opens a fence.
 * Checked before {@link FENCE_OPENER}, because a blockquoted or list-prefixed fence does not match
 * that pattern at all — silently ignoring such a line would drop a real block on the floor.
 */
function unsupportedFenceReason(line) {
  if (BLOCKQUOTED_FENCE.test(line)) {
    return UNSUPPORTED_FENCE_REASONS.BLOCKQUOTE;
  }
  if (LIST_MARKER_FENCE.test(line)) {
    return UNSUPPORTED_FENCE_REASONS.LIST_MARKER;
  }
  const opener = FENCE_OPENER.exec(line);
  if (opener === null) {
    return null;
  }
  const [, indent, fence, info] = opener;
  // A tab is worth four columns, so any tab in the indent already reaches the indented-code
  // threshold. Everything this corpus uses sits at zero to three spaces.
  if (indent.includes("\t") || indent.length >= 4) {
    return UNSUPPORTED_FENCE_REASONS.DEEP_INDENT;
  }
  // CommonMark: a backtick fence's info string may not contain a backtick, so such a line is not a
  // fence at all. Rather than quietly consuming it as one, say so.
  if (fence[0] === "`" && info.includes("`")) {
    return UNSUPPORTED_FENCE_REASONS.BACKTICK_IN_INFO;
  }
  return null;
}

/** Remove up to `width` leading spaces, the way CommonMark strips a fence's own indentation. */
function stripIndent(line, width) {
  let removed = 0;
  while (removed < width && line[removed] === " ") {
    removed += 1;
  }
  return line.slice(removed);
}

/**
 * Extract every fenced code block from `text`.
 *
 * Implements the CommonMark rules this corpus relies on: a fence is three or more backticks or
 * tildes, closed by at least as many of the *same* character alone on a line; the opener's
 * indentation is stripped from each body line (so a block nested in a list item yields its true
 * source); the info string's first word is the language. A fence character that differs from the
 * opener's — or a shorter run of it — is body text, which is what lets a ` ```logo ` block quote a
 * `~~~` fence and vice versa.
 *
 * @returns `{ blocks, problems }` — `blocks` carry `{ language, source, startLine }` with
 *   `startLine` the 1-based line of the opening fence; `problems` are `{ line, reason }` for
 *   fences the extractor refuses to guess at ({@link UNSUPPORTED_FENCE_REASONS}).
 */
export function extractFencedBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  const problems = [];
  let index = 0;
  while (index < lines.length) {
    const unsupported = unsupportedFenceReason(lines[index]);
    if (unsupported !== null) {
      problems.push({ line: index + 1, reason: unsupported });
      index += 1;
      continue;
    }
    const opener = FENCE_OPENER.exec(lines[index]);
    if (opener === null) {
      index += 1;
      continue;
    }
    const [, indent, fence, info] = opener;
    const startLine = index + 1;

    const closer = new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`);
    const body = [];
    let cursor = index + 1;
    let closed = false;
    while (cursor < lines.length) {
      if (closer.test(lines[cursor])) {
        closed = true;
        break;
      }
      body.push(stripIndent(lines[cursor], indent.length));
      cursor += 1;
    }
    if (!closed) {
      problems.push({
        line: startLine,
        reason: UNSUPPORTED_FENCE_REASONS.UNCLOSED,
      });
    }
    blocks.push({
      language: info.toLowerCase(),
      source: body.join("\n"),
      startLine,
    });
    index = cursor + 1;
  }
  return { blocks, problems };
}

/**
 * Stable content fingerprint for a block: the first 16 hex digits of the SHA-256 of its source.
 * Truncated because it keys a hand-reviewed manifest, not a security boundary — 64 bits is far
 * beyond collision range for a few hundred blocks while staying readable in review.
 */
export function blockFingerprint(source) {
  return createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16);
}

/**
 * The 1-based line, within `source`, of the last line carrying something the runtime would execute
 * (ignoring blank lines and whole-line `#` comments), or `0` when there is none. Used to tell
 * "execution stopped early" from "execution reached the end and the last statement happened to
 * raise". Exported so its edge cases are testable directly: {@link analyzeBlock} only reaches it
 * once a runtime error exists, which a block with no executable line can never produce.
 */
export function lastExecutableLine(source) {
  const lines = source.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const text = lines[index].trim();
    if (text !== "" && !text.startsWith("#")) {
      return index + 1;
    }
  }
  return 0;
}

/**
 * Parse, statically check, and execute one block.
 *
 * When `gateUnimplementedProfiles` is true (the default), a block using a profile with no
 * implementation yet — Modules, Localization, Educational, Tutor (AI) — returns early with those
 * profiles and no codes: its `alias`/`import`/`challenge` spellings are not in the grammar yet, so
 * every diagnostic it raised would be noise. The caller passes `false` when an expectation already
 * declares what the block produces, so a *listed* block is analyzed for real rather than waved
 * through by an incidental profile mention. `check()` runs with the full profile set so an
 * inactive-profile name never masquerades as an unknown command.
 *
 * `setup` is optional OpenLogo source prepended to the block before analysis, so an excerpt whose
 * context lives in the prose can be given that context and run to completion instead of halting on
 * its first undefined name. Reported line numbers stay anchored to the real file: the preamble's
 * own lines are subtracted. The setup must itself be clean — a diagnostic landing inside it is
 * reported as `setupError` and never folded into the block's codes, because a broken preamble would
 * otherwise read as a defect in the documentation.
 *
 * @returns `{ unimplementedProfiles, codes, details, internalError, setupError, partialFrom }`.
 *   `codes` is the sorted, de-duplicated set of error-severity `ol-*` codes across all three stages
 *   (empty when the block is clean); `details` are `line: code — message` strings whose line numbers
 *   are absolute in the containing file; `internalError` is a message when the gate itself threw;
 *   `partialFrom` is the absolute line execution stopped at when it stopped **before** the block's
 *   last executable line, and `null` otherwise — see this module's header for why that is surfaced
 *   rather than claimed away.
 */
export function analyzeBlock(
  source,
  label,
  { startLine = 0, gateUnimplementedProfiles = true, setup } = {},
) {
  const preambleLines = setup === undefined ? 0 : setup.split("\n").length;
  const analyzed = setup === undefined ? source : `${setup}\n${source}`;
  // Diagnostics are reported against `analyzed`; subtracting the preamble keeps every line number
  // anchored to the block as it appears in the file.
  const offset = startLine - preambleLines;
  const empty = {
    unimplementedProfiles: [],
    codes: [],
    details: [],
    internalError: null,
    setupError: null,
    partialFrom: null,
  };
  let unimplementedProfiles = [];
  let diagnostics;
  let runtimeErrorLines = [];
  try {
    unimplementedProfiles = detectUsedProfiles(analyzed).filter(
      (profile) => !IMPLEMENTED_PROFILES.includes(profile),
    );
    if (gateUnimplementedProfiles && unimplementedProfiles.length > 0) {
      return { ...empty, unimplementedProfiles };
    }

    const parsed = parse(analyzed, label);
    const executed = execute(analyzed, label, {
      instructionBudget: DOCUMENTATION_INSTRUCTION_BUDGET,
    });
    // Only a *runtime*-stage error halts execution. `execute()` also returns the parse-stage
    // diagnostics it collected on the way in; counting those as a halt would mislabel a block that
    // never ran at all as one whose later lines were skipped.
    runtimeErrorLines = executed.diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.severity === "error" && diagnostic.stage === "runtime",
      )
      .map((diagnostic) => diagnostic.source_span.start[0]);
    diagnostics = [
      ...parsed.diagnostics,
      ...check(parsed.ast, { profiles: OL_CHECK_PROFILES, source: analyzed })
        .diagnostics,
      ...executed.diagnostics,
    ];
  } catch (error) {
    // A gate must never itself crash on an unexpected internal error — but it must never call one
    // a diagnostic either, so this is its own state rather than a pseudo `ol-*` code.
    return { ...empty, unimplementedProfiles, internalError: error.message };
  }

  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const inPreamble = errors.filter(
    (diagnostic) => diagnostic.source_span.start[0] <= preambleLines,
  );
  if (inPreamble.length > 0) {
    return {
      ...empty,
      unimplementedProfiles,
      setupError: inPreamble
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("; "),
    };
  }

  const haltLine = runtimeErrorLines.length === 0 ? null : runtimeErrorLines[0];
  return {
    unimplementedProfiles,
    codes: [...new Set(errors.map((diagnostic) => diagnostic.code))].sort(),
    details: errors.map(
      (diagnostic) =>
        `${offset + diagnostic.source_span.start[0]}: ${diagnostic.code} — ${diagnostic.message}`,
    ),
    internalError: null,
    setupError: null,
    partialFrom:
      haltLine !== null && haltLine < lastExecutableLine(analyzed)
        ? offset + haltLine
        : null,
  };
}

/** True when two sorted string lists hold the same entries. */
function sameList(left, right) {
  return (
    left.length === right.length &&
    left.every((entry, position) => entry === right[position])
  );
}

/**
 * Format the manifest entry a human should paste into the expectations manifest after triaging a
 * newly-failing block, so the fix path is explicit rather than guessed. Deliberately not written
 * automatically: an auto-updating golden file would rubber-stamp exactly the regression this gate
 * exists to catch.
 */
export function suggestExpectation(block, codes, expectationsPath) {
  const excerpt = block.source.split("\n").find((line) => line.trim() !== "");
  const entry = {
    fingerprint: blockFingerprint(block.source),
    excerpt: excerpt ?? "",
    kind: "deliberate-error",
    why: "TODO: explain why this block cannot be clean",
    codes,
  };
  return `      add to ${toPosixPath(expectationsPath)}: ${JSON.stringify(entry)}`;
}

/**
 * Validate one manifest entry's shape. Returns an array of human-readable problems (empty when the
 * entry is well-formed), so a typo'd `kind`, a missing rationale, an untracked `known-broken`
 * defect, or a declared code that is not in `@openlogo/core`'s `ol-*` registry fails the gate
 * rather than silently disabling a check.
 *
 * `issue` is optional on every kind and validated whenever it is present, so any entry that records
 * a defect can carry its tracking issue; it is *required* only for `known-broken`, the one kind
 * whose whole meaning is "this document is wrong and someone must fix it".
 */
export function validateExpectationEntry(entry, file, position) {
  const where = `${file} entry ${position}`;
  const problems = [];
  if (typeof entry.fingerprint !== "string" || entry.fingerprint === "") {
    problems.push(`${where}: missing "fingerprint"`);
  }
  if (typeof entry.why !== "string" || entry.why.trim() === "") {
    problems.push(
      `${where}: missing "why" — every exception states its rationale`,
    );
  }
  if (entry.setup !== undefined && typeof entry.setup !== "string") {
    problems.push(`${where}: "setup" must be a string of OpenLogo source`);
  }
  const asserts = EXPECTATION_KINDS.get(entry.kind);
  if (asserts === undefined) {
    problems.push(
      `${where}: "kind" must be one of ${[...EXPECTATION_KINDS.keys()].join(", ")} (got ${JSON.stringify(entry.kind)})`,
    );
    return problems;
  }
  const issueRequired = entry.kind === "known-broken";
  if (
    (issueRequired || entry.issue !== undefined) &&
    !/^#\d+$/.test(entry.issue ?? "")
  ) {
    problems.push(
      issueRequired
        ? `${where}: a "known-broken" entry records a real defect, so it must carry its tracking "issue" (e.g. "#123")`
        : `${where}: "issue" must look like "#123"`,
    );
  }
  const declared = entry[asserts];
  if (!Array.isArray(declared)) {
    problems.push(
      `${where}: a "${entry.kind}" entry must list the ${asserts} it asserts`,
    );
    return problems;
  }
  // An empty `codes` is meaningful only alongside a `setup` preamble: it asserts "given this
  // context, the block runs clean". Without one it would assert nothing at all.
  if (declared.length === 0 && entry.setup === undefined) {
    problems.push(
      `${where}: a "${entry.kind}" entry must list the ${asserts} it asserts`,
    );
    return problems;
  }
  if (asserts === "codes") {
    const invalid = declared.filter((code) => !isDeclarableCode(code));
    if (invalid.length > 0) {
      problems.push(
        `${where}: "codes" must be codes from @openlogo/core's ol-* registry (got ${invalid.join(", ")})`,
      );
    }
  }
  return problems;
}

/**
 * Load the file -> expectation-entry[] manifest from `expectationsPath`.
 *
 * JSON has no comments, so keys beginning with an underscore carry the manifest's own
 * documentation and are dropped here — no markdown path can start with one, so the convention
 * cannot collide with a real entry.
 */
export function loadExpectations(expectationsPath = EXPECTATIONS_PATH) {
  const parsed = JSON.parse(readFileSync(expectationsPath, "utf8"));
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => !key.startsWith("_")),
  );
}

/**
 * Compare one block's analysis against its expectation entry.
 *
 * @returns `null` when the block matches, or a human-readable description of the mismatch.
 */
export function describeExpectationMismatch(expectation, analysis) {
  if (analysis.internalError !== null) {
    return `the gate itself threw (${analysis.internalError}), which no expectation may declare`;
  }
  if (analysis.setupError !== null) {
    return `this entry's own "setup" preamble is broken (${analysis.setupError}) — fix the preamble, it is not documentation`;
  }
  if (expectation.kind === "profile-not-implemented") {
    const declared = [...expectation.profiles].sort();
    if (sameList(analysis.unimplementedProfiles, declared)) {
      return null;
    }
    return `expected it to need ${declared.join(", ")} but it needs ${
      analysis.unimplementedProfiles.length === 0
        ? "no unimplemented profile — it can run now"
        : analysis.unimplementedProfiles.join(", ")
    }`;
  }
  const declared = [...expectation.codes].sort();
  if (sameList(analysis.codes, declared)) {
    return null;
  }
  return `expected ${declared.join(", ")} but got ${
    analysis.codes.length === 0 ? "a clean run" : analysis.codes.join(", ")
  }`;
}

/**
 * Run the gate over every ` ```logo ` block in every markdown file under `roots`.
 *
 * Never calls `process.exit` — the CLI shell (`check-markdown-examples.mjs`) does that from the
 * returned `ok` flag.
 *
 * @returns `{ ok, counts, lines }` where `counts` is
 *   `{ total, clean, expected, knownBroken, failed }` and `lines` is the printable report.
 */
export function runMarkdownExamplesGate({
  roots = MARKDOWN_ROOTS,
  expectationsPath = EXPECTATIONS_PATH,
  expectations,
} = {}) {
  const lines = [];
  const counts = {
    total: 0,
    clean: 0,
    expected: 0,
    knownBroken: 0,
    partial: 0,
    failed: 0,
  };
  const fail = (line) => {
    counts.failed += 1;
    lines.push(`FAIL ${line}`);
  };

  const resolvedExpectations =
    expectations ?? loadExpectations(expectationsPath);
  const files = findMarkdownFiles(roots);

  if (files.length === 0) {
    lines.push(
      `markdown examples: no .md files found under ${roots.join(", ")}`,
    );
    return { ok: false, counts, lines };
  }

  // Every entry starts unmatched; a block that matches one removes it. Whatever is left over
  // described a block that no longer exists (or has been edited), which is itself a failure.
  const unmatched = new Map();
  for (const [file, entries] of Object.entries(resolvedExpectations)) {
    for (const [position, entry] of entries.entries()) {
      for (const problem of validateExpectationEntry(entry, file, position)) {
        fail(problem);
      }
      const key = `${file}#${entry.fingerprint}`;
      if (unmatched.has(key)) {
        fail(
          `${file} entry ${position}: duplicate fingerprint ${entry.fingerprint} — one of the two entries is dead`,
        );
        continue;
      }
      unmatched.set(key, `${file} entry ${position} (${entry.excerpt ?? ""})`);
    }
  }

  for (const file of files) {
    const { blocks, problems } = extractFencedBlocks(
      readFileSync(file, "utf8"),
    );
    for (const problem of problems) {
      fail(`${file}:${problem.line}: ${problem.reason}`);
    }

    const fileExpectations = resolvedExpectations[file] ?? [];
    const alreadyMatched = new Set();
    for (const block of blocks) {
      if (block.language !== "logo") {
        continue;
      }
      counts.total += 1;
      const label = `${file}:${block.startLine}`;
      const fingerprint = blockFingerprint(block.source);
      const expectation = fileExpectations.find(
        (entry) => entry.fingerprint === fingerprint,
      );
      const analysis = analyzeBlock(block.source, label, {
        startLine: block.startLine,
        // A listed block is analyzed for real: its expectation already says what it produces, so
        // an incidental unimplemented-profile mention must not wave it through unchecked.
        gateUnimplementedProfiles:
          expectation === undefined ||
          expectation.kind === "profile-not-implemented",
        setup: expectation?.setup,
      });

      if (expectation !== undefined) {
        unmatched.delete(`${file}#${fingerprint}`);
        if (alreadyMatched.has(fingerprint)) {
          fail(
            `${label}: a second block in this file has the same content as the expectation pinned by ` +
              `${fingerprint} — one entry must not excuse two blocks; make them differ, or fix the duplicated prose`,
          );
          continue;
        }
        alreadyMatched.add(fingerprint);

        const mismatch = describeExpectationMismatch(expectation, analysis);
        if (mismatch === null) {
          counts.expected += 1;
          if (expectation.kind === "known-broken") {
            counts.knownBroken += 1;
            lines.push(
              `KNOWN-BROKEN ${label} (${expectation.issue}): ${expectation.why}`,
            );
          }
          if (analysis.partialFrom !== null) {
            counts.partial += 1;
            lines.push(
              `PARTIAL ${label}: execution stopped at line ${analysis.partialFrom}`,
            );
          }
          continue;
        }
        fail(
          `${label}: ${mismatch} (${expectation.kind}: ${expectation.why}) — ` +
            `re-triage this block and update ${toPosixPath(expectationsPath)}`,
        );
        for (const detail of analysis.details) {
          lines.push(`      ${file}:${detail}`);
        }
        continue;
      }

      if (analysis.internalError !== null) {
        fail(`${label}: the gate threw — ${analysis.internalError}`);
        continue;
      }
      if (analysis.unimplementedProfiles.length > 0) {
        fail(
          `${label}: needs ${analysis.unimplementedProfiles.join(", ")}, which no implementation ` +
            `provides yet — list it in ${toPosixPath(expectationsPath)} as "profile-not-implemented" ` +
            `so the skip is recorded rather than silent`,
        );
        continue;
      }
      if (analysis.codes.length === 0) {
        counts.clean += 1;
        continue;
      }
      // Lead with the offending line rather than the fence, so skimming a CI log lands on the
      // defect; the block's own location follows for anyone hunting for its expectation entry.
      fail(
        `${file}:${analysis.details[0].split(":")[0]}: ${analysis.codes.join(", ")} ` +
          `(in the logo block opening at ${label})`,
      );
      for (const detail of analysis.details) {
        lines.push(`      ${file}:${detail}`);
      }
      lines.push(suggestExpectation(block, analysis.codes, expectationsPath));
    }
  }

  for (const [, description] of unmatched) {
    fail(
      `stale expectation — ${description} matches no logo block; delete it or re-fingerprint the block it described`,
    );
  }

  lines.push(
    `markdown examples: ${counts.total} logo block(s) — ${counts.clean} clean, ` +
      `${counts.expected} asserted expectation(s) of which ${counts.knownBroken} known-broken ` +
      `and ${counts.partial} only partially executed, ${counts.failed} failed`,
  );
  if (counts.partial > 0) {
    lines.push(
      "  PARTIAL means the runtime stopped at that block's first error, so the lines below it were parsed and " +
        "statically checked but never run: a runtime-only defect there (ol-type, ol-range, ol-unknown-key, " +
        "ol-unknown-field) would not be observed. Do not read a green run as 'every line of every block executed'.",
    );
  }

  return { ok: counts.failed === 0, counts, lines };
}

/**
 * Parse CLI arguments: `--root=<path>` (repeatable) and `--expectations=<path>` override the
 * defaults (used by the subprocess regression test to point the CLI at isolated temp fixtures
 * instead of the real `spec/` + `docs/` corpus).
 */
export function parseArgs(argv) {
  const roots = [];
  let expectationsPath;
  for (const arg of argv) {
    if (arg.startsWith("--root=")) {
      roots.push(arg.slice("--root=".length));
    } else if (arg.startsWith("--expectations=")) {
      expectationsPath = arg.slice("--expectations=".length);
    }
  }
  return {
    roots: roots.length > 0 ? roots : undefined,
    expectationsPath,
  };
}

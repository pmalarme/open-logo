/**
 * Logic module for the **markdown fenced-block** half of the `examples` Definition-of-Done gate
 * (issue #850). Extracted so tests can import it directly for 100% coverage, keeping
 * `scripts/check-markdown-examples.mjs` a thin CLI shell — the same split
 * `scripts/examples-gate.mjs` + `scripts/check-examples.mjs` uses (docs/adr/0009).
 *
 * **Why this exists.** The Definition of Done says runnable `spec/examples/*.logo` **and doc
 * examples** still parse and run. Only the first half was enforced: `scripts/examples-gate.mjs`
 * runs the standalone files under `spec/examples/`, so every OpenLogo program embedded in spec or
 * docs prose was never parsed and never executed. That is how `set_shape "bee"` — a shape word no
 * conforming renderer accepts, raising `ol-type` — survived in `spec/turtles-and-sprites.md` into a
 * shipped 0.1.0 conformance claim, and was found by a human reading the prose rather than by CI.
 *
 * **What it checks.** Every fenced block whose info string is `logo` in `spec/**.md` and
 * `docs/**.md` is parsed ({@link analyzeBlock}), statically checked, and executed under a bounded
 * instruction budget. A block passes when it produces **no** error-severity `ol-*` diagnostic.
 *
 * **The three traps a naive "execute everything" gate falls into**, and how each is handled
 * *without* requiring an annotation inside `spec/` (which is maintainer-owned — AGENTS.md — so
 * this gate must never add tags or headers to the prose it checks):
 *
 * 1. **Blocks that are not OpenLogo at all.** `spec/grammar.md` fences EBNF production rules as
 *    ` ```logo `. Nothing can infer that, so those blocks are listed in the expectations manifest
 *    (`kind: "not-openlogo"`) — still *asserted*, so a mislabeled block cannot silently change.
 * 2. **Fragments.** Most prose blocks are excerpts whose variables and procedures are defined in
 *    the surrounding text, so they legitimately raise `ol-undefined-var`/`ol-unknown-command`.
 *    Those are auto-tolerated by {@link isContextFragment} — deliberately WITHOUT an annotation,
 *    so an unannotated block is never silently unchecked, only *narrowly* excused. Tolerance is
 *    limited to that closed code set (see {@link CONTEXT_TOLERATED_CODES}): the moment a fragment
 *    also raises anything else — `ol-type`, `ol-range`, `ol-unknown-key`, … — the gate fails.
 * 3. **Deliberately invalid programs.** `spec/error-model.md` and `spec/tooling.md` show code that
 *    MUST raise a specific `ol-*` code. These are the most valuable blocks to check, so they are
 *    listed with their exact expected codes and **asserted**: the gate fails both when the codes
 *    change *and* when a listed block becomes clean (a stale expectation), exactly like the
 *    `tests/conformance/_harness-selftest/` fixtures that declare `expect: "mismatch"`.
 *
 * **Manifest keys are content fingerprints, not line numbers** ({@link blockFingerprint}): prose
 * edits above a block must not churn the manifest, but editing the *block itself* must force a
 * re-triage. A fingerprint that matches no block in its file fails the gate as a stale entry.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
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
 * needs — a block that reaches it is demonstrating `forever`/blocking `input` and is listed as
 * `non-terminating`. Fixed (never derived from the machine) so the gate is deterministic.
 */
export const DOCUMENTATION_INSTRUCTION_BUDGET = 100_000;

/**
 * The closed set of `ol-*` codes that mean "this block is an excerpt whose context lives in the
 * surrounding prose" rather than "this block is wrong": a name it references is defined in an
 * earlier block or in the paragraph around it.
 *
 * `ol-bad-token` is deliberately NOT in this set even though an unknown callee makes the parser
 * mis-arity the call (`polygon 5 100` parses `polygon` as a zero-input command and reports its
 * inputs as stray tokens). It is tolerated only *alongside* `ol-unknown-command` — see
 * {@link isContextFragment} — so a genuine lexical error such as a comma-separated list
 * (`:x = [1, 2, 3]`) still fails on its own.
 */
export const CONTEXT_TOLERATED_CODES = new Set([
  "ol-undefined-var",
  "ol-unknown-command",
]);

/** The closed set of `kind` values an expectation entry may declare. */
export const EXPECTATION_KINDS = new Set([
  /** The prose teaches this exact diagnostic; the block MUST keep producing it. */
  "deliberate-error",
  /** The fence is mislabeled `logo` but holds EBNF/reserved-word text, not OpenLogo source. */
  "not-openlogo",
  /** Demonstrates `forever` or a blocking `input`, so it reaches the instruction budget. */
  "non-terminating",
  /** A genuine defect in the prose, recorded (and reported) until its owner fixes it. */
  "known-broken",
]);

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

/**
 * Extract every fenced code block from `text`.
 *
 * Follows the CommonMark rules this repository's markdown actually relies on: a fence is three or
 * more backticks or tildes, it is closed by at least as many of the *same* character alone on a
 * line, the opener's indentation is stripped from each body line (so a block nested in a list item
 * yields its true source), and the info string's first word is the language. A fence character
 * that differs from the opener's — or a shorter run of it — is body text, which is what lets a
 * ` ```logo ` block quote a `~~~` fence and vice versa.
 *
 * @returns `{ blocks, unterminated }` — `blocks` carry `{ language, source, startLine }` with
 *   `startLine` the 1-based line of the opening fence; `unterminated` lists the 1-based opener
 *   lines of fences never closed before end of file (malformed markdown, since such a fence
 *   swallows every block after it).
 */
export function extractFencedBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  const unterminated = [];
  let index = 0;
  while (index < lines.length) {
    const opener = FENCE_OPENER.exec(lines[index]);
    if (opener === null) {
      index += 1;
      continue;
    }
    const [, indent, fence, info] = opener;
    const closer = new RegExp(
      `^[ \\t]*\\${fence[0]}{${fence.length},}[ \\t]*$`,
    );
    const startLine = index + 1;
    const body = [];
    let cursor = index + 1;
    let closed = false;
    while (cursor < lines.length) {
      if (closer.test(lines[cursor])) {
        closed = true;
        break;
      }
      const line = lines[cursor];
      body.push(line.startsWith(indent) ? line.slice(indent.length) : line);
      cursor += 1;
    }
    if (!closed) {
      unterminated.push(startLine);
    }
    blocks.push({
      language: info.toLowerCase(),
      source: body.join("\n"),
      startLine,
    });
    index = cursor + 1;
  }
  return { blocks, unterminated };
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
 * Parse, statically check, and execute one block.
 *
 * Profile gating runs first and mirrors `scripts/examples-gate.mjs`: a block using a profile with
 * no implementation yet (Modules, Localization, Educational, Tutor (AI)) is reported as skipped
 * with a visible notice rather than failed — its `alias`/`import` spellings are not in the grammar
 * yet, so every diagnostic it raises would be noise. `check()` runs with the full profile set so
 * an inactive-profile name never masquerades as an unknown command.
 *
 * @returns `{ unimplementedProfiles, codes, details }` — `codes` is the sorted, de-duplicated set
 *   of error-severity `ol-*` codes across all three stages (empty when the block is clean), and
 *   `details` are human-readable `line: code — message` strings for the report.
 */
export function analyzeBlock(source, label, startLine = 0) {
  let unimplementedProfiles = [];
  let diagnostics;
  try {
    unimplementedProfiles = detectUsedProfiles(source).filter(
      (profile) => !IMPLEMENTED_PROFILES.includes(profile),
    );
    if (unimplementedProfiles.length > 0) {
      return { unimplementedProfiles, codes: [], details: [] };
    }

    const parsed = parse(source, label);
    diagnostics = [
      ...parsed.diagnostics,
      ...check(parsed.ast, { profiles: OL_CHECK_PROFILES, source }).diagnostics,
      ...execute(source, label, {
        instructionBudget: DOCUMENTATION_INSTRUCTION_BUDGET,
      }).diagnostics,
    ];
  } catch (error) {
    // A gate must never itself crash on an unexpected internal error: report it as a finding.
    return {
      unimplementedProfiles,
      codes: ["gate-threw"],
      details: [`${startLine}: gate-threw — ${error.message}`],
    };
  }

  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const details = errors.map((diagnostic) => {
    const line = startLine + diagnostic.source_span.start[0];
    return `${line}: ${diagnostic.code} — ${diagnostic.message}`;
  });
  return {
    unimplementedProfiles,
    codes: [...new Set(errors.map((diagnostic) => diagnostic.code))].sort(),
    details,
  };
}

/**
 * True when every code in `codes` is explained by context the block does not carry — i.e. a name
 * defined in the surrounding prose. `ol-bad-token` counts only when `ol-unknown-command` is also
 * present, because that pairing is exactly the parser mis-arity-ing a call to a procedure defined
 * elsewhere; on its own `ol-bad-token` is a real lexical error and must fail.
 *
 * An empty `codes` is not a fragment — a clean block is simply clean, and the caller distinguishes
 * the two so the report can count them separately.
 */
export function isContextFragment(codes) {
  if (codes.length === 0) {
    return false;
  }
  const present = new Set(codes);
  return codes.every(
    (code) =>
      CONTEXT_TOLERATED_CODES.has(code) ||
      (code === "ol-bad-token" && present.has("ol-unknown-command")),
  );
}

/** True when two sorted code lists hold the same codes. */
function sameCodes(left, right) {
  return (
    left.length === right.length &&
    left.every((code, position) => code === right[position])
  );
}

/**
 * Format the manifest entry a human should paste into
 * `scripts/markdown-examples-expectations.json` after triaging a newly-failing block, so the fix
 * path is explicit rather than guessed. Deliberately not written automatically: an auto-updating
 * golden file would rubber-stamp exactly the regression this gate exists to catch.
 */
export function suggestExpectation(block, codes) {
  const excerpt = block.source.split("\n").find((line) => line.trim() !== "");
  const entry = {
    fingerprint: blockFingerprint(block.source),
    excerpt: excerpt ?? "",
    kind: "deliberate-error",
    why: "TODO: explain why this block cannot be clean",
    codes,
  };
  return `      add to ${toPosixPath(EXPECTATIONS_PATH)}: ${JSON.stringify(entry)}`;
}

/**
 * Validate one manifest entry's shape. Returns an array of human-readable problems (empty when the
 * entry is well-formed), so a typo'd `kind` or a missing rationale fails the gate rather than
 * silently disabling a check.
 */
export function validateExpectationEntry(entry, file, position) {
  const where = `${file} entry ${position}`;
  const problems = [];
  if (typeof entry.fingerprint !== "string" || entry.fingerprint === "") {
    problems.push(`${where}: missing "fingerprint"`);
  }
  if (!EXPECTATION_KINDS.has(entry.kind)) {
    problems.push(
      `${where}: "kind" must be one of ${[...EXPECTATION_KINDS].join(", ")} (got ${JSON.stringify(entry.kind)})`,
    );
  }
  if (typeof entry.why !== "string" || entry.why.trim() === "") {
    problems.push(
      `${where}: missing "why" — every exception states its rationale`,
    );
  }
  if (!Array.isArray(entry.codes) || entry.codes.length === 0) {
    problems.push(
      `${where}: "codes" must list the ol-* code(s) the block produces`,
    );
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
 * Run the gate over every ` ```logo ` block in every markdown file under `roots`.
 *
 * Never calls `process.exit` — the CLI shell (`check-markdown-examples.mjs`) does that from the
 * returned `ok` flag.
 *
 * @returns `{ ok, counts, lines }` where `counts` is
 *   `{ total, clean, fragment, skipped, expected, failed }` and `lines` is the printable report.
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
    fragment: 0,
    skipped: 0,
    expected: 0,
    failed: 0,
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

  const unusedFingerprints = new Map();
  for (const [file, entries] of Object.entries(resolvedExpectations)) {
    for (const [position, entry] of entries.entries()) {
      for (const problem of validateExpectationEntry(entry, file, position)) {
        counts.failed += 1;
        lines.push(`FAIL ${problem}`);
      }
      const key = `${file}#${entry.fingerprint}`;
      if (unusedFingerprints.has(key)) {
        counts.failed += 1;
        lines.push(
          `FAIL ${file} entry ${position}: duplicate fingerprint ${entry.fingerprint} — one of the two entries is dead`,
        );
        continue;
      }
      unusedFingerprints.set(
        key,
        `${file} entry ${position} (${entry.excerpt ?? ""})`,
      );
    }
  }

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const { blocks, unterminated } = extractFencedBlocks(text);
    for (const line of unterminated) {
      counts.failed += 1;
      lines.push(
        `FAIL ${file}:${line}: fence opened here is never closed — the rest of the file is swallowed into it`,
      );
    }

    const fileExpectations = resolvedExpectations[file] ?? [];
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
      const { unimplementedProfiles, codes, details } = analyzeBlock(
        block.source,
        label,
        block.startLine,
      );

      if (expectation !== undefined) {
        unusedFingerprints.delete(`${file}#${fingerprint}`);
        const declared = [...expectation.codes].sort();
        if (sameCodes(codes, declared)) {
          counts.expected += 1;
          continue;
        }
        const got =
          unimplementedProfiles.length > 0
            ? `nothing — the block was skipped because it needs ${unimplementedProfiles.join(", ")}`
            : codes.length === 0
              ? "a clean run"
              : codes.join(", ");
        counts.failed += 1;
        lines.push(
          `FAIL ${label}: expected ${declared.join(", ")} (${expectation.kind}: ${expectation.why}) ` +
            `but got ${got} — re-triage this block and update ${toPosixPath(expectationsPath)}`,
        );
        for (const detail of details) {
          lines.push(`      ${file}:${detail}`);
        }
        continue;
      }

      if (unimplementedProfiles.length > 0) {
        counts.skipped += 1;
        lines.push(
          `SKIP ${label} (requires ${unimplementedProfiles.join(", ")} — not yet implemented)`,
        );
        continue;
      }
      if (codes.length === 0) {
        counts.clean += 1;
        continue;
      }
      if (isContextFragment(codes)) {
        counts.fragment += 1;
        continue;
      }
      counts.failed += 1;
      lines.push(`FAIL ${label}: ${codes.join(", ")}`);
      for (const detail of details) {
        lines.push(`      ${file}:${detail}`);
      }
      lines.push(suggestExpectation(block, codes));
    }
  }

  for (const [, description] of unusedFingerprints) {
    counts.failed += 1;
    lines.push(
      `FAIL stale expectation — ${description} matches no logo block; delete it or re-fingerprint the block it described`,
    );
  }

  lines.push(
    `markdown examples: ${counts.total} logo block(s) — ${counts.clean} clean, ` +
      `${counts.fragment} prose fragment(s), ${counts.expected} expected-diagnostic, ` +
      `${counts.skipped} skipped, ${counts.failed} failed`,
  );

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

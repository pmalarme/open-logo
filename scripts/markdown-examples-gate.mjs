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
 * The design rationale is `docs/adr/0022-documentation-example-gate.md`.
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
 * completion and assert a clean result instead of halting on line one. (`inputs` does the same for
 * a blocking `input` read, scripting the answer the learner would have typed.) Where that is
 * impossible — a block whose whole point is the error it stops on — the limit is **made visible
 * rather than claimed away**: the block is reported as `PARTIAL` with its own count in the summary
 * line, naming the line execution stopped at. The gate prints the live totals on every run, so no
 * number is quoted here to go stale. Do not read a green run as "every line of every block
 * executed".
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
import {
  OL_CHECK_PROFILES,
  check,
  corePrimitiveArity,
  dataPrimitiveArity,
  educationalPrimitiveArity,
  geometryPrimitiveArity,
  heritageSurfaceSpellings,
  interactionPrimitiveArity,
  parse,
  soundPrimitiveArity,
  spritesPrimitiveArity,
  turtlePrimitiveArity,
  tutorPrimitiveArity,
  walk,
} from "@openlogo/parser";
import { execute } from "@openlogo/runtime";
import { IMPLEMENTED_PROFILES } from "./examples-gate.mjs";
import { detectUsedProfiles } from "./profile-detection.mjs";

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
  /**
   * The spec is **right** and the implementation has not caught up: a ruling landed in `spec/`
   * ahead of the code slice that implements it, so a conforming program still raises. Distinct
   * from `known-broken`, which says the *document* is wrong — here the document is correct and the
   * runtime is behind. Requires the issue tracking the implementing slice, and the entry is
   * deleted when that slice lands. Every staged spec-then-code ruling opens this window.
   */
  ["implementation-behind", "codes"],
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
 * `docs/adr/0022-documentation-example-gate.md` for why this is a guard rather than a CommonMark
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
    const entries = readdirSync(directory, { withFileTypes: true });
    // Branch-free comparator: `(a > b) - (a < b)` sorts by code unit without a conditional, so the
    // sort's own coverage cannot depend on the order the filesystem happens to hand entries back —
    // which differs between platforms.
    entries.sort(
      (left, right) =>
        Number(left.name > right.name) - Number(left.name < right.name),
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

const FENCE_OPENER = /^([ \t]*)(`{3,}|~{3,})[ \t]*(.*)$/;
const BLOCKQUOTED_FENCE = /^[ \t]*(?:>[ \t]*)+(?:`{3,}|~{3,})/;
const LIST_MARKER_FENCE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:`{3,}|~{3,})/;

/**
 * Which {@link UNSUPPORTED_FENCE_REASONS} entry (if any) applies to a line that opens a fence.
 * Checked before the opener is accepted, because a blockquoted or list-prefixed fence does not match
 * {@link FENCE_OPENER} at all — silently ignoring such a line would drop a real block on the floor.
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
  // CommonMark: a backtick fence's info string may not contain a backtick ANYWHERE — not just in
  // its first word — so such a line is not a fence at all. Rather than quietly consuming it as one,
  // say so.
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
      // The info string's FIRST WORD is the language; the rest is attributes CommonMark leaves to
      // the renderer. Validation above already saw the whole string.
      language: info
        .trim()
        .split(/[ \t]+/)[0]
        .toLowerCase(),
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
 * Names that OpenLogo itself provides — **every** profile's primitives plus every Heritage surface
 * spelling. A `setup` preamble supplies *context*; it must never redefine the language, because a
 * preamble that shadows a provided name can make a real defect vanish: `define set_shape :s end`
 * would turn the canonical `set_shape "bee"` regression green, and `define fd :n end` would do the
 * same for `fd "x"`'s `ol-type`. `heritageSurfaceSpellings()` is the parser's own enumeration
 * (issue #852), so the alias list cannot drift from it here.
 *
 * **"Every profile" has to mean every profile.** A missing table is a silent hole rather than a
 * loud one: the guard simply stops recognising that profile's names, and a setup shadowing one
 * sails through. Tutor's `challenge` was exactly that hole until issue #838 gave the profile a
 * registry (`tutorPrimitiveArity`) and wired it in here — before that there was no table to
 * consult, so a preamble could redefine `challenge` and no gate would say a word.
 */
function isPrimitiveName(name) {
  // OpenLogo identifiers are case-insensitive, so `define FD :n end` shadows `fd` just as surely
  // as the lowercase spelling does. Compare on the canonical lowercase form throughout — the same
  // normalisation `scripts/examples-gate.mjs`'s own shadow guard uses.
  const canonical = name.toLowerCase();
  if (heritageSurfaceSpellings().includes(canonical)) {
    return true;
  }
  return [
    corePrimitiveArity,
    turtlePrimitiveArity,
    dataPrimitiveArity,
    educationalPrimitiveArity,
    geometryPrimitiveArity,
    interactionPrimitiveArity,
    soundPrimitiveArity,
    spritesPrimitiveArity,
    tutorPrimitiveArity,
  ].some((arityOf) => arityOf(canonical) !== undefined);
}

/**
 * Every name a program defines, at any depth, in OpenLogo's canonical lowercase form — procedures
 * and struct types alike. Used both to catch a preamble shadowing a provided name and to catch a
 * preamble and its block defining the same name, which would let the block change what the
 * preamble means.
 */
function definedNames(program) {
  const found = new Set();
  walk(program, (node) => {
    if (node.kind === "ProcedureDef" || node.kind === "StructDef") {
      found.add(node.name.name.toLowerCase());
    }
  });
  return found;
}

/**
 * The 1-based start line, within `source`, of the last **top-level statement** — the closest thing
 * to a program counter available without replaying the trace. A diagnostic's span points at the
 * construct that raised, not at where execution stopped, so comparing a halt against the last
 * statement's start is what distinguishes "a later statement never began" from "the final statement
 * ran and raised part-way through".
 *
 * The granularity is deliberate and is the measure's known limit: `PARTIAL` means *a later
 * top-level statement never began*. A halt **inside** the final statement — `if :done [ print "x" ]`
 * stopping on the condition, so the `print` never runs — is not reported, because nothing after
 * that statement was skipped. Give such a block a `setup` if you want its body executed. Returns
 * `0` for a block with no statements. Exported so its edge cases are testable directly.
 */
export function lastStatementLine(program) {
  const statements = program.body;
  return statements.length === 0
    ? 0
    : statements[statements.length - 1].source_span.start[0];
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
 * own lines are subtracted. The preamble must **parse, check and execute cleanly on its own**, must
 * not define a name the block also defines, and must not redefine anything OpenLogo provides at any
 * depth — so it can only supply context, never absorb the block's malformed structure, lean on the
 * block it supports, or shadow away a real defect. Anything that still raises **inside** the
 * preamble once the block runs it (a deferred `define` body, which standalone validation cannot
 * see) is reported as `setupError`: unsuppressible, never an ordinary block code, because such a
 * diagnostic would otherwise halt the run *and* satisfy an expectation that declared it, hiding
 * whatever the block's own later lines would have raised. `inputs` scripts the answers a blocking
 * `input` read consumes, so an interaction example can run instead of being cancelled.
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
  { startLine = 0, gateUnimplementedProfiles = true, setup, inputs } = {},
) {
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
  let offset = startLine;
  let lastStatement = 0;
  try {
    // Everything that can throw lives inside the try, including the preamble arithmetic: a
    // malformed manifest entry must reach the reported `internalError`, never a raw stack trace.
    const preambleLines = setup === undefined ? 0 : setup.split("\n").length;
    const analyzed = setup === undefined ? source : `${setup}\n${source}`;
    // Diagnostics are reported against `analyzed`; subtracting the preamble keeps every line
    // number anchored to the block as it appears in the file.
    offset = startLine - preambleLines;

    if (setup !== undefined) {
      // The preamble must stand on its own — parsed, statically checked, AND executed — with zero
      // errors. Parsing alone is not enough: `setup: "helper"` plus a block that defines `helper`
      // would satisfy each other, so the preamble would be leaning on the block it is supposed to
      // be supporting. It must also not absorb the block's malformed structure (`setup: "repeat 1"`
      // plus a block ending `end repeat`), which standalone parsing is what catches.
      const preamble = parse(setup, `${label} (setup)`);
      const malformed = preamble.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      );
      if (malformed.length > 0) {
        return {
          ...empty,
          setupError: malformed
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join("; "),
        };
      }
      // A preamble supplies context; it must not redefine the language. Shadowing a provided name
      // would let a setup silence a real defect rather than reveal it — at any nesting depth, and
      // for Heritage spellings as much as Core primitives.
      //
      // This runs BEFORE the semantic/runtime validation below, and did not have to before issue
      // #838: `define set_shape :s end` used to check clean, so this guard was the only thing that
      // caught it. Now the checker rejects it too, with the deliberately category-free
      // "set_shape is already part of OpenLogo. choose another name." — true, but addressed to a
      // learner, and it would replace the advice a docs author actually needs here. Order decides
      // which message a contributor sees, so the specific one goes first.
      const preambleDefines = definedNames(preamble.ast);
      const shadowed = [...preambleDefines]
        .filter((name) => isPrimitiveName(name))
        .sort();
      if (shadowed.length > 0) {
        return {
          ...empty,
          setupError: `it redefines the built-in ${shadowed.join(", ")} — a setup supplies context, it must not shadow a primitive`,
        };
      }
      const broken = [
        ...check(preamble.ast, {
          profiles: OL_CHECK_PROFILES,
          source: setup,
        }).diagnostics,
        ...execute(setup, `${label} (setup)`, {
          instructionBudget: DOCUMENTATION_INSTRUCTION_BUDGET,
        }).diagnostics,
      ].filter((diagnostic) => diagnostic.severity === "error");
      if (broken.length > 0) {
        return {
          ...empty,
          setupError: broken
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join("; "),
        };
      }
      // Procedure resolution is whole-program, so a block that redefines a name the preamble also
      // defines changes what the preamble MEANS — the preamble is no longer the standalone-clean
      // program that was validated above.
      const collisions = [...definedNames(parse(source, label).ast)]
        .filter((name) => preambleDefines.has(name))
        .sort();
      if (collisions.length > 0) {
        return {
          ...empty,
          setupError: `both it and the block define ${collisions.join(", ")} — the block would change what the preamble means, so the preamble is no longer the program that was validated`,
        };
      }
    }

    unimplementedProfiles = detectUsedProfiles(analyzed).filter(
      (profile) => !IMPLEMENTED_PROFILES.includes(profile),
    );
    if (gateUnimplementedProfiles && unimplementedProfiles.length > 0) {
      return { ...empty, unimplementedProfiles };
    }

    const parsed = parse(analyzed, label);
    lastStatement = lastStatementLine(parsed.ast);
    const executed = execute(analyzed, label, {
      instructionBudget: DOCUMENTATION_INSTRUCTION_BUDGET,
      ...(inputs === undefined ? {} : { hostInput: { responses: inputs } }),
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

    const errors = diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    );
    // A `define` in the preamble defers its body, so standalone validation says nothing about what
    // is inside it — the block calling that procedure can raise from a preamble line. Such a
    // diagnostic must NOT become an ordinary block code: it would halt the run before the block's
    // own later lines executed, while satisfying an expectation that declares it, so a real defect
    // below could never be seen. It becomes an unsuppressible `setupError` instead — worded to
    // attribute it correctly (the block called into the setup; the setup is not "broken prose")
    // and never printing a line above the block's own opening fence.
    const fromSetup = errors.filter(
      (diagnostic) => diagnostic.source_span.start[0] <= preambleLines,
    );
    if (fromSetup.length > 0) {
      return {
        ...empty,
        unimplementedProfiles,
        setupError:
          `the block raised inside this entry's setup-supplied code — ` +
          fromSetup
            .map(
              (diagnostic) =>
                `${diagnostic.code} at preamble line ${diagnostic.source_span.start[0]} (${diagnostic.message})`,
            )
            .join("; ") +
          ` — a setup must be context the block can use, not code that fails when the block calls it`,
      };
    }

    const haltLine =
      runtimeErrorLines.length === 0 ? null : runtimeErrorLines[0];
    return {
      unimplementedProfiles,
      codes: [...new Set(errors.map((diagnostic) => diagnostic.code))].sort(),
      details: errors.map(
        (diagnostic) =>
          `${offset + diagnostic.source_span.start[0]}: ${diagnostic.code} — ${diagnostic.message}`,
      ),
      internalError: null,
      setupError: null,
      // Partial only when a later top-level statement never began. A diagnostic's span points at
      // the construct that raised, not at where execution stopped, so a multi-line final statement
      // that raises on its own head line has still run everything there was to run.
      partialFrom:
        haltLine !== null && haltLine < lastStatement
          ? offset + haltLine
          : null,
    };
  } catch (error) {
    // A gate must never itself crash on an unexpected internal error — but it must never call one
    // a diagnostic either, so this is its own state rather than a pseudo `ol-*` code.
    return { ...empty, unimplementedProfiles, internalError: error.message };
  }
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
  if (
    entry.inputs !== undefined &&
    (!Array.isArray(entry.inputs) ||
      entry.inputs.length === 0 ||
      entry.inputs.some((answer) => typeof answer !== "string"))
  ) {
    problems.push(
      `${where}: "inputs" must be a non-empty array of the answers a blocking \`input\` read consumes`,
    );
  }
  const asserts = EXPECTATION_KINDS.get(entry.kind);
  if (asserts === undefined) {
    problems.push(
      `${where}: "kind" must be one of ${[...EXPECTATION_KINDS.keys()].join(", ")} (got ${JSON.stringify(entry.kind)})`,
    );
    return problems;
  }
  // `setup`/`inputs` supply context a block is missing. They make no sense on a
  // `profile-not-implemented` entry, which asserts that the block cannot run at all.
  for (const field of ["setup", "inputs"]) {
    if (
      entry[field] !== undefined &&
      entry.kind === "profile-not-implemented"
    ) {
      problems.push(
        `${where}: "${field}" cannot apply to a "profile-not-implemented" entry — it asserts the block cannot run at all`,
      );
    }
  }
  const issueRequired =
    entry.kind === "known-broken" || entry.kind === "implementation-behind";
  if (
    (issueRequired || entry.issue !== undefined) &&
    !/^#\d+$/.test(entry.issue ?? "")
  ) {
    problems.push(
      issueRequired
        ? `${where}: a "${entry.kind}" entry records work someone must finish, so it must carry its tracking "issue" (e.g. "#123")`
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
  // An empty `codes` is meaningful only for a prose excerpt that was given context: it asserts
  // "with this setup/inputs, the block runs clean". Every other kind must name what it produces, so
  // an empty list can never quietly assert nothing at all.
  const hasContext = entry.setup !== undefined || entry.inputs !== undefined;
  if (
    declared.length === 0 &&
    !(entry.kind === "prose-fragment" && hasContext)
  ) {
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
    return `this entry's "setup" preamble is not usable as written (${analysis.setupError}) — fix the preamble in the expectations manifest; it is not documentation prose`;
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
    implementationBehind: 0,
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
  // An entry that failed validation has already been reported; its block is not analysed with it,
  // because a malformed entry cannot be trusted to describe anything.
  const invalid = new Set();
  for (const [file, entries] of Object.entries(resolvedExpectations)) {
    for (const [position, entry] of entries.entries()) {
      const problems = validateExpectationEntry(entry, file, position);
      for (const problem of problems) {
        fail(problem);
      }
      const key = `${file}#${entry.fingerprint}`;
      if (problems.length > 0) {
        invalid.add(key);
      }
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
      const key = `${file}#${fingerprint}`;
      const expectation = fileExpectations.find(
        (entry) => entry.fingerprint === fingerprint,
      );
      if (invalid.has(key)) {
        // Its problems were already reported; analysing the block with a malformed entry would
        // only produce a second, confusing failure for the same cause.
        unmatched.delete(key);
        continue;
      }
      const analysis = analyzeBlock(block.source, label, {
        startLine: block.startLine,
        // A listed block is analyzed for real: its expectation already says what it produces, so
        // an incidental unimplemented-profile mention must not wave it through unchecked.
        gateUnimplementedProfiles:
          expectation === undefined ||
          expectation.kind === "profile-not-implemented",
        setup: expectation?.setup,
        inputs: expectation?.inputs,
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
          if (expectation.kind === "implementation-behind") {
            counts.implementationBehind += 1;
            lines.push(
              `SPEC-AHEAD ${label} (${expectation.issue}): ${expectation.why}`,
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
      `${counts.expected} asserted expectation(s) of which ${counts.knownBroken} known-broken, ` +
      `${counts.implementationBehind} spec-ahead-of-implementation ` +
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

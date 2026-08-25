/**
 * Logic module for the **spec-citation** Definition-of-Done gate (issue #934). Extracted so tests
 * can import it directly for 100% coverage, keeping `scripts/check-spec-citations.mjs` a thin CLI
 * shell — the same shape `scripts/markdown-examples-gate.mjs` + `scripts/check-markdown-examples.mjs`
 * and `scripts/harness/index.mjs` + `scripts/conformance.mjs` already have. A CLI shell is exercised
 * through a subprocess, so it stays outside the loaded-module coverage set
 * `docs/adr/0009-test-layout.md` defines.
 *
 * **Why this exists.** Over two thousand `<spec-dir>/<file>.md:<line>` citations are hand-written
 * into code comments, tests, fixture prose, and docs. They are the mechanism binding the
 * implementation to the normative contract — and until this gate, **nothing in the repository
 * checked a single one**. When a spec file gains or loses a line, every citation below it silently
 * becomes wrong; issue #846 shifted 665 of them in one edit, and #885 merged green carrying ten
 * citations that pointed at the wrong lines.
 *
 * ## What this gate does and does not cover — read this before trusting a green run
 *
 * A stale citation fails in four distinguishable ways, and only two of them are mechanically
 * detectable without understanding the prose:
 *
 * 1. **It does not resolve** — the file is missing, the line is past end-of-file, the range is
 *    inverted, or the cited region holds no text at all. **COVERED** ({@link resolveCitation}).
 * 2. **It resolves, but points at the wrong passage, and the prose paraphrases rather than quotes.**
 *    **NOT COVERED**, except in the one shape that is mechanically checkable: a citing site that
 *    **quotes an EBNF production** must cite a region containing it ({@link collectQuotations}).
 *    Paraphrase is invisible here — deciding whether a range that resolves supports "a step of `0`
 *    never reaches `end`" requires reading both, which no offline gate can do.
 * 3. **The line is right and the prose beside it misstates what that line says.** **NOT COVERED.**
 * 4. **A stale implementation-status claim** — "not yet implemented", "a later slice will…". This is
 *    not a claim about the spec at all; it is a claim about the repository's own state, which rots
 *    when the state changes. **PARTIALLY COVERED** ({@link collectStatusClaims}): every such claim
 *    must name a tracking issue, so it is at least re-checkable. Whether that issue is still open is
 *    deliberately not consulted — a DoD gate must run offline and deterministically.
 *
 * The gate prints this coverage statement on **every run**, and the exceptions manifest repeats it,
 * because a green gate that is quietly narrower than it looks is the exact defect epic #901 exists
 * to remove — and it would be this gate committing it.
 *
 * ## Enumeration is exhaustive, not separator-driven
 *
 * Citations are not written in one shape. They are joined by commas, by line wraps, by slashes, and
 * by whole clauses of prose; a separator regex would miss a form and quietly under-report. Three
 * separately-written tokenizers gave three different counts of the same corpus before hand-derivation
 * settled it (PRs #942 and #949). **A separator regex is not a completeness argument**, so
 * {@link collectCitations} instead enumerates **every** bare `:N` in a citing file and accounts for
 * each one in exactly three buckets:
 *
 * - a **back-reference**, when the same line spec appears earlier in the file as a full anchor;
 * - a **context reference**, attributed to the nearest preceding spec-file mention (which need not
 *   carry a line number of its own);
 * - **unattributed**, when no spec file is named before it — reported, never silently dropped.
 *
 * The back-reference rule comes first because nearest-preceding attribution demonstrably gets it
 * wrong: `packages/parser/src/keywords.ts` refers back to a line-408 ruling four lines after
 * mentioning a *different* spec document, and only the earlier full anchor says which document that
 * bare reference belongs to.
 *
 * In JavaScript and TypeScript sources a bare `:N` counts only inside a comment line. That is a
 * structural rule, not a tolerance: a formatted contrast ratio, whose template literal ends with a
 * closing brace immediately before a colon and a digit, is live code, and no citation is ever written
 * in an expression. {@link isProseLine}'s tests pin that shape by asserting on that exact literal.
 *
 * ## No automatic tolerance
 *
 * The gate never searches nearby lines and passes. Issue #893's reviewers deleted exactly that,
 * because tolerance is indistinguishable from the defect a gate exists to catch — and here the wrong
 * passage is usually *adjacent* to the right one, so proximity is evidence of nothing.
 *
 * A citation the gate cannot resolve either **fails**, or carries an entry in the exceptions
 * manifest that declares — and therefore **asserts** — the exact state it is in. The manifest is
 * expected to **shrink**: entries are deleted when the citation is fixed, never re-fingerprinted, and
 * the live total is printed on every run so a number that stops falling is visible.
 *
 * ## The manifest's own prose is fingerprinted
 *
 * `scripts/markdown-examples-gate.mjs` hashes a block's source only and validates its `why` for
 * non-emptiness alone, so wrong rationale prose there can never fail a gate. This gate does not
 * inherit that: {@link siteFingerprint} hashes the citing line, the subject, the entry's own `why`,
 * **and the issue it is tracked by**. An entry therefore goes stale — and must be re-triaged — when
 * the prose it describes changes, when its rationale is edited, or when it is retargeted at a
 * different issue. No gate can decide whether a rationale is *true*; this one guarantees it cannot
 * drift away from the text it describes unnoticed.
 *
 * ## Known blind spots, stated rather than hidden
 *
 * A **section anchor** (`<file>.md#a-heading`) carries no line number, so it is enumerated as a
 * mention but never resolved: a renamed or misspelled heading passes unseen. That form is the one
 * issue #934 *recommends* adopting precisely because it cannot drift when lines shift, so checking it
 * is the obvious next increment. The printed coverage statement says so on every run.
 *
 * The scanned set is the **tracked** set ({@link listCitationFiles} shells out to `git ls-files`), and
 * that has a consequence worth stating as a general rule, because it is not specific to this gate:
 * **a tool that enumerates the repository through git cannot see an untracked file, so a green run
 * over unstaged work certifies a tree that does not contain the work.** This gate's own first review
 * round failed on exactly that — the final verification ran before `git add`, so the gate had never
 * once scanned its own source. Stage before you verify. It is the same family as `tsc -b` skipping a
 * rebuild on an unchanged mtime: the instrument is silently measuring something other than what you
 * think it is.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

/** Directory holding the normative specification, relative to the repository root. */
export const SPEC_DIRECTORY = "spec";

/** Location of the exceptions manifest this gate asserts against. */
export const EXCEPTIONS_PATH = join(
  "scripts",
  "spec-citations-exceptions.json",
);

/**
 * Files the scan skips.
 *
 * The manifest is the only one, and it is unavoidable: every entry quotes the citation it excuses,
 * so scanning it would make the gate re-discover — and demand entries for — its own exception list.
 * Nothing else is excluded, including this module and its tests: a gate that exempts itself from the
 * rule it enforces is asserting less than it appears to. Test fixtures therefore name a `contract/`
 * directory rather than `spec/`, so a deliberately-broken fixture citation cannot masquerade as a
 * real one.
 */
export const SCAN_EXCLUSIONS = Object.freeze([EXCEPTIONS_PATH]);

/** Directory names the filesystem walk never descends into. */
const UNWALKED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
]);

/** Extensions whose bare `:N` only counts inside a comment line (see the module note). */
const COMMENT_ONLY_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/**
 * Forward-looking implementation-status phrases (failure mode 4, issue #934). Each occurrence must
 * name a tracking issue in the same prose run, so a claim about the repository's own state stays
 * re-checkable instead of rotting invisibly — this saga hit that three times, including a comment
 * citing an already-closed issue as future work.
 *
 * The vocabulary is deliberately narrow, favouring precision over recall, because a false positive is
 * fatal in a gate with no tolerance. A bare `TODO` is excluded: it appears in generated config and in
 * suggestion templates, where it is a placeholder rather than a claim. Anchoring a slice phrase to a
 * forward-looking verb serves the same end — bare "later slice" also matches prose *about* how
 * slices work ("later slices cite them as settled fact"), which claims nothing about pending work,
 * and the cost is recall: "a later slice adds…" is missed. **Not every entry below is anchored**, so
 * the list still fires on a counterfactual — prose that claims nothing pending. Issue #961 re-worded
 * the two **untracked** sites that hit the bare `"future slice"` entry that way — the `grid :spacing`
 * overload in `execute-internal.ts` and the registry canary in
 * `checker-profile-word-position.test.mjs`, both conditionals about work nobody has planned. Adding
 * a manifest exception, not a reword, is what those two would otherwise have needed. Quoting such a
 * phrase here is itself an occurrence, tracked by the `#961` named just above — which is the
 * mechanism working, not an exemption.
 *
 * **A phrase split across a line wrap is invisible.** {@link collectStatusClaims} matches per line
 * while resolving the tracking issue over the flattened run, so "does not exist\n * yet" is
 * unreachable although the identical unwrapped sentence fails. Measured before issue #961's sweep:
 * **4** such claims, **2** of them untracked (counting the vocabulary quotation in `AGENTS.md`);
 * both untracked ones were fixed by hand there, so at this commit the untracked count is **0**.
 * Making the matcher wrap-safe is mechanically straightforward — flatten every prose run with the
 * same array-then-join technique used below, which is linear — but it changes what the gate reports
 * (a claim's line must be mapped back from a run offset) and needs its own tests against the 100%
 * coverage gate, so it is routed as its own change rather than bolted on here.
 * Mode 4 coverage is partial, and the gate says so on every run.
 */
export const STATUS_CLAIM_PHRASES = Object.freeze([
  "not yet implemented",
  "not implemented yet",
  "does not exist yet",
  "a later slice will",
  "a future slice will",
  "future slice",
  "will be implemented",
  "will be added",
]);

/** The `kind` values an exception entry may declare, mapped to the finding kind each excuses. */
export const EXCEPTION_KINDS = Object.freeze({
  /** The citation does not resolve: missing file, past EOF, inverted, or a region with no text. */
  "stale-citation": "resolution",
  /** The citing site quotes an EBNF production the cited region does not contain. */
  "misquoted-production": "quotation",
  /** A bare `:N` no spec-file mention precedes, which is therefore not attributable. */
  "unattributed-reference": "attribution",
  /** A forward-looking status claim that genuinely has no tracking issue to name. */
  "untracked-status-claim": "status-claim",
});

/** Convert a native path to the `/`-separated form used as a manifest key on every platform. */
export function toPosixPath(path) {
  return path.split(sep).join("/");
}

/**
 * Split `text` into lines on `\n` alone.
 *
 * A `\r` left by a CRLF checkout stays on the end of the line, where it is whitespace and cannot
 * change a blank-line test — whereas splitting on `/\r?\n/` and then measuring byte offsets against
 * the original text drifts one byte per line, which silently mis-attributes every citation in a CRLF
 * working tree. This repository sets `core.autocrlf=true` on Windows, so that is not hypothetical.
 */
export function splitLines(text) {
  return text.split("\n");
}

/**
 * The 1-based line number each byte offset in `text` falls on, as a lookup built once per file.
 * Returns a function so a file with thousands of citations does not rescan the text for each one.
 */
export function lineLookup(lines) {
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return (index) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= index) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  };
}

/**
 * Group `lines` into **prose runs** — maximal stretches of contiguous {@link isProseLine} lines —
 * returning the run identifier for each 1-based line (`0` for a line that belongs to no run).
 *
 * A run is the unit of "the same paragraph" on every file type this corpus uses at once: a JSDoc
 * block, a run of `//` comments, a markdown paragraph, a `#`-comment header in a `.logo` fixture,
 * and a one-line JSON `description` are all contiguous prose stretches. Using one structural notion
 * everywhere keeps the gate from needing a parser per language.
 */
export function proseRuns(path, lines) {
  const runOf = [0];
  let run = 0;
  let afterBreak = true;
  for (const line of lines) {
    if (!isProseLine(path, line)) {
      runOf.push(0);
      afterBreak = true;
      continue;
    }
    if (afterBreak) {
      run += 1;
    }
    afterBreak = false;
    runOf.push(run);
  }
  return runOf;
}

/**
 * Whether `line` in a file named `path` is **prose** — the only place a citation is ever written.
 *
 * This is a structural rule, not a tolerance. In JavaScript and TypeScript a citation lives in a
 * comment, so a formatted contrast ratio — a template literal closing with a brace immediately before
 * a colon and a digit — is never offered as one; in a `.logo` fixture a citation lives in a `#`
 * header. Everywhere else — markdown, JSON fixture prose, YAML — every line counts.
 *
 * It is also what makes a **prose run** meaningful in a source file: grouping merely contiguous
 * non-blank lines would swallow a whole blank-line-free function body, pairing a production quoted in
 * one comment with a citation written in another twenty lines away.
 */
export function isProseLine(path, line) {
  const trimmed = line.trim();
  if (trimmed === "") {
    return false;
  }
  if (COMMENT_ONLY_EXTENSIONS.some((extension) => path.endsWith(extension))) {
    return (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    );
  }
  if (path.endsWith(".logo")) {
    return trimmed.startsWith("#");
  }
  return true;
}

/** Build the regex matching `<specDirectory>/<file>.md` with an optional line spec. */
function mentionPattern(specDirectory) {
  return new RegExp(
    `${specDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/([A-Za-z0-9._-]+\\.md)(?::(\\d+)(?:-(\\d+))?((?:,\\d+(?:-\\d+)?)+)?)?`,
    "g",
  );
}

/**
 * A bare `:N`, `:N-M`, or either followed by a comma-appended list of further lines and ranges.
 *
 * The lookbehind is what makes the sweep safe on source code without knowing the language: `{a:1}`,
 * `x?1:2`, and `http://host:80` are all preceded by a word character, a digit, or a `/`, so none of
 * them is ever offered as a citation in the first place.
 */
const BARE_REFERENCE =
  /(?<![A-Za-z0-9._\-/]):(\d+)(?:-(\d+))?((?:,\d+(?:-\d+)?)+)?/g;

/**
 * The extra line specs in a comma-appended tail such as the `,139` of `grammar.md:119-129,139`.
 *
 * This form is neither an anchor nor a bare `:N`, and a sweep built from either pattern alone misses
 * it silently — 118 components in this corpus. It is exactly the kind of shape that makes a
 * separator regex a bad completeness argument, so it is enumerated explicitly.
 */
export function expandCommaTail(tail) {
  if (tail === undefined) {
    return [];
  }
  return tail
    .split(",")
    .filter((part) => part !== "")
    .map((part) => {
      const [start, end] = part.split("-");
      return {
        start: Number(start),
        end: end === undefined ? undefined : Number(end),
      };
    });
}

/** Which summary counter each {@link collectCitations} form increments. */
const CITATION_FORM_COUNTS = Object.freeze({
  anchor: "anchors",
  "comma-tail": "tails",
  "back-reference": "bare",
  "context-reference": "bare",
});

/** Render a citation back into the canonical `<spec-dir>/<file>.md:<start>[-<end>]` form. */
export function formatCitation(citation) {
  const range = citation.end === undefined ? "" : `-${citation.end}`;
  return `${citation.specDirectory}/${citation.file}:${citation.start}${range}`;
}

/**
 * Enumerate every citation in one file's `text`, plus every bare `:N` that could not be attributed.
 *
 * Anchors (`<spec-dir>/<file>.md:<line>`) are unambiguous. A bare `:<line>` is attributed by the two
 * rules the module note explains — back-reference first, then nearest preceding mention — and, when
 * neither applies, reported so that nothing is dropped without a trace.
 *
 * @returns `{ citations, unattributed }`.
 */
export function collectCitations(path, text, specDirectory = SPEC_DIRECTORY) {
  const lines = splitLines(text);
  const lineAt = lineLookup(lines);
  const citations = [];
  const unattributed = [];

  const mentions = [];
  const pattern = mentionPattern(specDirectory);
  let match = pattern.exec(text);
  while (match !== null) {
    const mention = {
      index: match.index,
      end: match.index + match[0].length,
      file: match[1],
      start: match[2] === undefined ? undefined : Number(match[2]),
      stop: match[3] === undefined ? undefined : Number(match[3]),
    };
    mentions.push(mention);
    if (mention.start !== undefined) {
      const line = lineAt(mention.index);
      citations.push({
        specDirectory,
        file: mention.file,
        start: mention.start,
        end: mention.stop,
        line,
        form: "anchor",
      });
      for (const extra of expandCommaTail(match[4])) {
        citations.push({
          specDirectory,
          file: mention.file,
          start: extra.start,
          end: extra.end,
          line,
          form: "comma-tail",
        });
      }
    }
    match = pattern.exec(text);
  }
  if (mentions.length === 0) {
    return { citations, unattributed };
  }

  // Which file an earlier full anchor gave each exact line spec, so a bare back-reference sitting
  // four lines below a mention of a *different* document still resolves to the one that introduced it.
  const backReferences = new Map();
  for (const citation of citations) {
    const key = `${citation.start}-${citation.end ?? ""}`;
    const known = backReferences.get(key);
    // Two documents anchored at the same line spec make a later bare reference genuinely ambiguous;
    // `null` records that so it falls through to nearest-preceding attribution rather than guessing.
    backReferences.set(
      key,
      known === undefined || known === citation.file ? citation.file : null,
    );
  }

  BARE_REFERENCE.lastIndex = 0;
  let bare = BARE_REFERENCE.exec(text);
  while (bare !== null) {
    const index = bare.index;
    const inside = mentions.some(
      (mention) => index >= mention.index && index < mention.end,
    );
    const line = lineAt(index);
    if (inside || !isProseLine(path, lines[line - 1])) {
      bare = BARE_REFERENCE.exec(text);
      continue;
    }
    const start = Number(bare[1]);
    const end = bare[2] === undefined ? undefined : Number(bare[2]);
    const viaBackReference = backReferences.get(`${start}-${end ?? ""}`);
    let file = viaBackReference ?? null;
    let form = "back-reference";
    if (file === null) {
      let nearest = null;
      for (const mention of mentions) {
        if (mention.end > index) {
          break;
        }
        nearest = mention;
      }
      file = nearest === null ? null : nearest.file;
      form = "context-reference";
    }
    if (file === null) {
      unattributed.push({
        line,
        text: `:${start}${end === undefined ? "" : `-${end}`}`,
      });
      bare = BARE_REFERENCE.exec(text);
      continue;
    }
    citations.push({ specDirectory, file, start, end, line, form });
    for (const extra of expandCommaTail(bare[3])) {
      citations.push({
        specDirectory,
        file,
        start: extra.start,
        end: extra.end,
        line,
        form: "comma-tail",
      });
    }
    bare = BARE_REFERENCE.exec(text);
  }
  citations.sort((left, right) => left.line - right.line);
  return { citations, unattributed };
}

/**
 * Resolve one citation against the spec document it names.
 *
 * @returns `null` when the citation points at real text, or `{ status, detail }` describing exactly
 *   how it fails to. There is no third outcome: the gate never accepts "close enough".
 */
export function resolveCitation(citation, specLines) {
  if (specLines === null) {
    return {
      status: "missing-file",
      detail: `${citation.specDirectory}/${citation.file} does not exist`,
    };
  }
  const end = citation.end ?? citation.start;
  if (end < citation.start) {
    return {
      status: "inverted-range",
      detail: `the range ends at ${end}, before it starts at ${citation.start}`,
    };
  }
  if (citation.start < 1 || end > specLines.length) {
    return {
      status: "past-eof",
      detail: `${citation.file} has ${specLines.length} line(s)`,
    };
  }
  const region = specLines.slice(citation.start - 1, end);
  if (region.every((line) => line.trim() === "")) {
    return {
      status: "blank-region",
      detail: "the cited line(s) hold no text",
    };
  }
  return null;
}

/** Collapse whitespace and drop markdown emphasis so a quotation matches the text it came from. */
export function normalizeQuotation(text) {
  return text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Whether every segment of `quotation` appears, in order, inside `available`.
 *
 * An author who quotes a long production usually elides its middle — `primary ::= … | fixed-call | …`
 * — and a literal comparison would then fail on a perfectly correct citation. An ellipsis is an
 * explicit "text omitted here" marker written by the author, so it is honoured as one: the segments
 * around it must all be present and in order, which still pins the production to the cited range
 * while asserting nothing about what the author chose not to quote. This is not proximity tolerance;
 * nothing outside the cited range is ever consulted.
 */
export function quotationIsPresent(quotation, available) {
  let cursor = 0;
  for (const segment of quotation.split(/…|\.\.\./)) {
    const trimmed = segment.trim();
    if (trimmed === "") {
      continue;
    }
    const found = available.indexOf(trimmed, cursor);
    if (found === -1) {
      return false;
    }
    cursor = found + trimmed.length;
  }
  return true;
}

/**
 * The **checkable quotations** in a prose run: backticked spans that contain `::=`, i.e. EBNF
 * productions copied out of the grammar.
 *
 * **This is the whole definition, and the narrowness is deliberate.** The tempting rule — "every
 * backticked span must appear in the cited range" — false-positives on *correct* citations, and
 * because this gate forbids tolerance a false positive is fatal rather than noisy. The proof case is
 * in the tree: `tests/conformance/core-language/control/repeat-zero-times` correctly cites the
 * `repeat` entry and contains the span `` `repeat 0 [ print 1 ]` ``, which is OpenLogo source the
 * citing author wrote to illustrate the rule — it appears nowhere in the spec, and never should.
 *
 * An EBNF production is the one backticked shape that cannot be illustrative: `::=` is not OpenLogo
 * syntax, so a span containing it was copied out of the grammar and must be findable there. Quoted
 * spec *prose* is excluded for the same reason as OpenLogo code — nothing distinguishes it from a
 * paraphrase the author wrote themselves.
 */
/**
 * Flatten one prose run into a single line of readable text, stripping each line's comment marker,
 * plus the offset at which each source line starts.
 *
 * Quotations wrap. `spec/grammar.md`'s `dict-entry ::= dict-key ":" expression` is written across two
 * lines of a JSDoc block, so a span pattern that stops at a newline never sees it — and a citation
 * the gate cannot see is a citation it silently certifies. Flattening first means a wrapped
 * production, a wrapped citation, and their relative order all read exactly as they do to a human.
 */
export function flattenProseRun(runLines) {
  const offsets = [];
  const parts = [];
  let offset = 0;
  for (const { line, text } of runLines) {
    const stripped = text.trim().replace(/^(?:\/\/+|\*+|#+)[ \t]?/, "");
    offsets.push({ offset, line });
    parts.push(stripped);
    offset += stripped.length + 1;
  }
  return { text: parts.join(" "), offsets };
}

/**
 * Pair every quoted EBNF production in a flattened run with the spec mention a reader would bind it
 * to: the **nearest** one, before or after, preferring the one before on a tie.
 *
 * This is the same attribution philosophy {@link collectCitations} already uses for a bare `:N`, and
 * it is what keeps the check honest in both directions. A mention carrying **no** line number —
 * ``spec/grammar.md`'s `add-statement ::= …` `` — makes no line claim at all, so there is nothing to
 * falsify and the production is reported with a `null` citation rather than checked against some
 * unrelated line cited elsewhere in the same comment.
 *
 * @returns `[{ quotation, line, mention }]`, `mention` being `null` when nothing is claimed.
 */
export function auditRunQuotations(runLines, specDirectory) {
  const { text, offsets } = flattenProseRun(runLines);
  const mentions = [];
  const pattern = mentionPattern(specDirectory);
  let mention = pattern.exec(text);
  while (mention !== null) {
    mentions.push({
      index: mention.index,
      end: mention.index + mention[0].length,
      file: mention[1],
      start: mention[2] === undefined ? undefined : Number(mention[2]),
      stop: mention[3] === undefined ? undefined : Number(mention[3]),
      tail: mention[4],
    });
    mention = pattern.exec(text);
  }

  const found = [];
  const span = /`([^`]+)`/g;
  let quoted = span.exec(text);
  while (quoted !== null) {
    // A production quoted inside a JSON fixture's prose arrives with its quotes escaped (`\"end\"`),
    // which is the file format speaking, not the author. Unescaping here — on the citing side only —
    // keeps a correct citation from failing over a backslash.
    if (quoted[1].includes("::=")) {
      const at = quoted.index;
      let nearest = null;
      for (const candidate of mentions) {
        const distance =
          candidate.end <= at ? at - candidate.end : candidate.index - at;
        if (nearest === null || distance < nearest.distance) {
          nearest = { ...candidate, distance };
        }
      }
      const source = offsets.filter((entry) => entry.offset <= at).at(-1);
      found.push({
        quotation: normalizeQuotation(quoted[1].replace(/\\(["\\])/g, "$1")),
        line: source.line,
        mention:
          nearest === null || nearest.start === undefined ? null : nearest,
      });
    }
    quoted = span.exec(text);
  }
  return found;
}

/**
 * Forward-looking status claims in `text` that name no tracking issue in their own prose run
 * (failure mode 4). Matching is case-insensitive and phrase-based; the run is the unit of proximity,
 * so a claim and its `#123` may sit on different wrapped lines of the same paragraph.
 */
export function collectStatusClaims(lines, runOf) {
  const claims = [];
  const hits = [];
  for (const [index, line] of lines.entries()) {
    // Prose only. A phrase inside live code is data, not a claim about the repository — this
    // module's own STATUS_CLAIM_PHRASES vocabulary is the clearest example — and a non-prose line
    // belongs to no run, so there would be no paragraph in which to look for its tracking issue.
    if (runOf[index + 1] === 0) {
      continue;
    }
    const lowered = line.toLowerCase();
    for (const phrase of STATUS_CLAIM_PHRASES) {
      if (lowered.includes(phrase)) {
        // One claim per line. A line that trips two phrases is making one statement, and reporting
        // it twice would demand two manifest entries to excuse a single site.
        hits.push({ line: index + 1, phrase });
        break;
      }
    }
  }
  if (hits.length === 0) {
    return claims;
  }
  // Only the runs that actually hold a claim are assembled, and each is joined once rather than
  // concatenated line by line — a lockfile is one unbroken run of tens of thousands of lines, where
  // incremental concatenation is quadratic.
  const wanted = new Set(hits.map((hit) => runOf[hit.line]));
  const runText = new Map();
  for (const [index, line] of lines.entries()) {
    const run = runOf[index + 1];
    if (!wanted.has(run)) {
      continue;
    }
    const bucket = runText.get(run);
    if (bucket === undefined) {
      runText.set(run, [line]);
      continue;
    }
    bucket.push(line);
  }
  const tracked = new Map();
  for (const [run, text] of runText) {
    tracked.set(run, /#\d+/.test(text.join("\n")));
  }
  for (const hit of hits) {
    claims.push({ ...hit, tracked: tracked.get(runOf[hit.line]) });
  }
  return claims;
}

/**
 * Stable fingerprint for one manifest entry: the citing line, the thing being excused, the entry's
 * **own rationale**, and the issue it is tracked by, hashed together.
 *
 * Hashing `why` is the point. An entry whose rationale is edited no longer matches, so the exception
 * must be re-triaged rather than quietly re-labelled — closing the hole in
 * `scripts/markdown-examples-gate.mjs`, whose `why` is checked for non-emptiness alone and can
 * therefore say anything at all. `issue` is included for the same reason: an entry asserts *who* will
 * fix this, and silently retargeting it at a different (or closed) issue changes that assertion.
 * Truncated to 16 hex digits because this keys a hand-reviewed manifest, not a security boundary.
 */
export function siteFingerprint(context, subject, why, issue) {
  return createHash("sha256")
    .update(
      `${context.trim()}\u0000${subject}\u0000${why}\u0000${issue}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * A manifest-entry skeleton for a finding the gate could not excuse, ready to paste and edit.
 *
 * The fingerprint is computed for the placeholder rationale, so replacing the `why` invalidates it
 * on purpose — the gate then reports the fingerprint that rationale actually needs. That round trip
 * is the mechanism keeping a manifest entry's prose pinned to the text it describes.
 */
export function suggestException(finding, exceptionsPath) {
  const why = "TODO: explain why this cannot be fixed now, and who will";
  const issue = "#000";
  const entry = {
    subject: finding.subject,
    observed: finding.observed,
    kind: finding.kind,
    issue,
    why,
    fingerprint: siteFingerprint(finding.context, finding.subject, why, issue),
  };
  return `      add to ${toPosixPath(exceptionsPath)} under "${finding.file}": ${JSON.stringify(entry)}`;
}

/**
 * Validate one manifest entry's shape, returning human-readable problems (empty when well-formed).
 * A malformed entry fails the gate rather than silently excusing something.
 */
export function validateExceptionEntry(entry, file, position) {
  const where = `${file} entry ${position}`;
  const problems = [];
  if (typeof entry.subject !== "string" || entry.subject === "") {
    problems.push(
      `${where}: missing "subject" — the citation or claim being excused`,
    );
  }
  if (typeof entry.fingerprint !== "string" || entry.fingerprint === "") {
    problems.push(`${where}: missing "fingerprint"`);
  }
  if (typeof entry.why !== "string" || entry.why.trim() === "") {
    problems.push(
      `${where}: missing "why" — every exception states its rationale`,
    );
  }
  if (!/^#\d+$/.test(entry.issue ?? "")) {
    problems.push(
      `${where}: an exception records work someone must finish, so it must carry its tracking "issue" (e.g. "#948")`,
    );
  }
  if (EXCEPTION_KINDS[entry.kind] === undefined) {
    problems.push(
      `${where}: "kind" must be one of ${Object.keys(EXCEPTION_KINDS).join(", ")} (got ${JSON.stringify(entry.kind)})`,
    );
  }
  if (typeof entry.observed !== "string" || entry.observed === "") {
    problems.push(
      `${where}: missing "observed" — an entry must declare the exact state it excuses, so it cannot outlive it`,
    );
  }
  return problems;
}

/**
 * Load the citing-file -> exception-entry[] manifest.
 *
 * JSON has no comments, so keys beginning with an underscore carry the manifest's own documentation
 * and are dropped here — no repository path starts with one, so the convention cannot collide.
 */
export function loadExceptions(exceptionsPath = EXCEPTIONS_PATH) {
  const parsed = JSON.parse(readFileSync(exceptionsPath, "utf8"));
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => !key.startsWith("_")),
  );
}

/** Every file under `roots`, depth-first and sorted, as `/`-separated repository-relative paths. */
export function walkFiles(roots) {
  const found = [];
  const visit = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true });
    entries.sort(
      (left, right) =>
        Number(left.name > right.name) - Number(left.name < right.name),
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!UNWALKED_DIRECTORIES.has(entry.name)) {
          visit(path);
        }
        continue;
      }
      found.push(toPosixPath(path));
    }
  };
  for (const root of roots) {
    if (existsSync(root)) {
      visit(root);
    }
  }
  return found.sort();
}

/**
 * The files the gate scans: every **tracked** file, so a contributor's untracked scratch notes can
 * never turn CI red and the scanned set matches exactly what review sees. `roots` overrides this
 * with a plain filesystem walk, which is how the tests point the gate at isolated temp fixtures.
 */
export function listCitationFiles(roots) {
  if (roots !== undefined) {
    return walkFiles(roots);
  }
  return execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((path) => path !== "")
    .sort();
}

/**
 * Read a file as text, or `null` when it is binary (a NUL byte) or cannot be read.
 *
 * A path can be tracked yet unreadable — a dangling symlink, a sparse-checkout or `skip-worktree`
 * placeholder, a file deleted from the worktree but still in the index. None occur in this repository
 * today and CI takes a full checkout, but throwing there would crash the gate mid-scan instead of
 * skipping one file, so it degrades the same way a binary file does.
 */
export function readTextFile(path) {
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    return null;
  }
  if (buffer.includes(0)) {
    return null;
  }
  return buffer.toString("utf8");
}

/**
 * Run the gate over every tracked file.
 *
 * Never calls `process.exit` — the CLI shell (`check-spec-citations.mjs`) does that from `ok`.
 *
 * @param specDirectory the token citations are written with (`spec`), used to build the scan pattern.
 * @param specRoot where those documents are read from; defaults to `specDirectory`. Split apart so a
 *   test can point the reader at a temp fixture tree without changing the token fixtures cite.
 * @returns `{ ok, counts, lines, findings }` where `lines` is the printable report and `findings`
 *   lists every site the gate could not accept on its own (each either excused or failed).
 */
export function runSpecCitationsGate({
  roots,
  specDirectory = SPEC_DIRECTORY,
  specRoot,
  exclusions = SCAN_EXCLUSIONS,
  exceptionsPath = EXCEPTIONS_PATH,
  exceptions,
} = {}) {
  const lines = [];
  const findings = [];
  const counts = {
    files: 0,
    citations: 0,
    anchors: 0,
    tails: 0,
    bare: 0,
    excused: 0,
    quotations: 0,
    statusClaims: 0,
    failed: 0,
  };
  const fail = (line) => {
    counts.failed += 1;
    lines.push(`FAIL ${line}`);
  };

  const resolvedExceptions = exceptions ?? loadExceptions(exceptionsPath);
  const entries = [];
  for (const [file, fileEntries] of Object.entries(resolvedExceptions)) {
    for (const [position, entry] of fileEntries.entries()) {
      const problems = validateExceptionEntry(entry, file, position);
      for (const problem of problems) {
        fail(problem);
      }
      if (problems.length === 0) {
        entries.push({ ...entry, file, position, consumed: false });
      }
    }
  }

  /**
   * Consume the exception excusing one finding, or report it.
   *
   * An entry matches only when its recorded fingerprint equals the hash of the live citing line, the
   * subject, and the entry's **own** rationale — so an exception cannot survive an edit to the prose
   * it describes, nor a quiet rewrite of the reason it exists. An entry that names the same subject
   * but no longer hashes to the same value is reported as exactly that, with the fingerprint its
   * current rationale needs, rather than as an unexplained failure.
   */
  const excuse = (finding) => {
    const { file, context, subject, observed, kind, describe } = finding;
    findings.push(finding);
    const match = entries.find(
      (entry) =>
        !entry.consumed &&
        entry.file === file &&
        entry.fingerprint ===
          siteFingerprint(context, subject, entry.why, entry.issue),
    );
    if (match === undefined) {
      const stale = entries.find(
        (entry) =>
          !entry.consumed && entry.file === file && entry.subject === subject,
      );
      if (stale === undefined) {
        fail(describe);
        lines.push(suggestException(finding, exceptionsPath));
        return;
      }
      stale.consumed = true;
      fail(
        `${describe} — its exception in ${toPosixPath(exceptionsPath)} (entry ${stale.position}) no longer ` +
          "matches: the citing line, the entry's own rationale, or the issue it is tracked by has changed " +
          "since it was written, so it must be re-triaged. As written, this site fingerprints as " +
          `${siteFingerprint(context, subject, stale.why, stale.issue)}`,
      );
      return;
    }
    match.consumed = true;
    if (match.subject !== subject) {
      fail(
        `${describe} — its exception in ${toPosixPath(exceptionsPath)} is labelled "${match.subject}", ` +
          "which is not what is there; an entry that mislabels what it excuses cannot be reviewed",
      );
      return;
    }
    if (match.observed !== observed) {
      fail(
        `${describe} — its exception in ${toPosixPath(exceptionsPath)} declares "${match.observed}", ` +
          "so the exception no longer describes what is there; re-triage it",
      );
      return;
    }
    // `kind` is the entry's own account of which defect family this is, and it is checked here
    // rather than hashed: hashing would only catch an entry EDITED after the fact, while an entry
    // authored with the wrong kind from the start would still pass. Both reviewers of this slice
    // independently constructed that mutation, and both got it past an earlier build — a manifest
    // whose self-reported class can disagree with the finding it excuses corrupts the very audit
    // counts the UNRESOLVED total is read through.
    if (match.kind !== kind) {
      fail(
        `${describe} — its exception in ${toPosixPath(exceptionsPath)} is filed as "${match.kind}" ` +
          `(a ${EXCEPTION_KINDS[match.kind]} defect) but this is a ${EXCEPTION_KINDS[kind]} one; ` +
          "an entry that misfiles what it excuses makes the manifest's own totals wrong",
      );
      return;
    }
    counts.excused += 1;
    lines.push(`UNRESOLVED ${describe} (${match.issue}): ${match.why}`);
  };

  const specCache = new Map();
  const specLinesFor = (file) => {
    if (!specCache.has(file)) {
      const path = join(specRoot ?? specDirectory, file);
      specCache.set(
        file,
        existsSync(path) ? splitLines(readFileSync(path, "utf8")) : null,
      );
    }
    return specCache.get(file);
  };

  const excluded = new Set(exclusions.map(toPosixPath));
  for (const file of listCitationFiles(roots)) {
    if (excluded.has(file)) {
      continue;
    }
    const text = readTextFile(file);
    if (text === null) {
      continue;
    }
    const fileLines = splitLines(text);
    const runOf = proseRuns(file, fileLines);
    // A status claim is a statement about the repository, not about the spec, so mode 4 sweeps every
    // tracked file rather than only the ones that carry citations.
    for (const claim of collectStatusClaims(fileLines, runOf)) {
      counts.statusClaims += 1;
      if (claim.tracked) {
        continue;
      }
      excuse({
        file,
        context: fileLines[claim.line - 1],
        subject: claim.phrase,
        observed: "untracked",
        kind: "untracked-status-claim",
        describe:
          `${file}:${claim.line}: "${claim.phrase}" is a claim about this repository's own state that names ` +
          "no tracking issue, so nothing will ever re-check it — name the issue it waits on",
      });
    }
    if (!text.includes(`${specDirectory}/`)) {
      continue;
    }
    const { citations, unattributed } = collectCitations(
      file,
      text,
      specDirectory,
    );
    if (citations.length === 0 && unattributed.length === 0) {
      continue;
    }
    counts.files += 1;

    for (const reference of unattributed) {
      excuse({
        file,
        context: fileLines[reference.line - 1],
        subject: reference.text,
        observed: "unattributed",
        kind: "unattributed-reference",
        describe:
          `${file}:${reference.line}: the bare reference \`${reference.text}\` follows no ${specDirectory}/<file>.md ` +
          "mention in this file, so nothing says which document it means — write the full citation",
      });
    }

    const citedByRun = new Map();
    for (const citation of citations) {
      counts.citations += 1;
      counts[CITATION_FORM_COUNTS[citation.form]] += 1;
      const context = fileLines[citation.line - 1];
      const subject = formatCitation(citation);
      const failure = resolveCitation(citation, specLinesFor(citation.file));
      const run = runOf[citation.line];
      if (failure === null) {
        citedByRun.set(run, true);
        continue;
      }
      excuse({
        file,
        context,
        subject,
        observed: failure.status,
        kind: "stale-citation",
        describe: `${file}:${citation.line}: ${subject} does not resolve — ${failure.detail}`,
      });
    }

    for (const run of citedByRun.keys()) {
      const runLines = fileLines
        .map((text, index) => ({ line: index + 1, text }))
        .filter((entry) => runOf[entry.line] === run);
      for (const quoted of auditRunQuotations(runLines, specDirectory)) {
        counts.quotations += 1;
        if (quoted.mention === null) {
          continue;
        }
        const citation = {
          specDirectory,
          file: quoted.mention.file,
          start: quoted.mention.start,
          end: quoted.mention.stop,
        };
        const specLines = specLinesFor(citation.file);
        // A citation that does not resolve was already reported once; checking a quotation against
        // an empty region would only restate the same defect in a second, more confusing voice.
        if (resolveCitation(citation, specLines) !== null) {
          continue;
        }
        const region = [
          { start: citation.start, end: citation.end ?? citation.start },
          ...expandCommaTail(quoted.mention.tail).map((extra) => ({
            start: extra.start,
            end: extra.end ?? extra.start,
          })),
        ];
        const available = region
          .map((part) =>
            normalizeQuotation(
              specLines.slice(part.start - 1, part.end).join(" "),
            ),
          )
          .join(" \u0000 ");
        if (quotationIsPresent(quoted.quotation, available)) {
          continue;
        }
        const subject = `${formatCitation(citation)}${quoted.mention.tail ?? ""}`;
        excuse({
          file,
          context: fileLines[quoted.line - 1],
          subject: quoted.quotation,
          observed: "missing-production",
          kind: "misquoted-production",
          describe:
            `${file}:${quoted.line}: the production \`${quoted.quotation}\` is quoted here but is not in ` +
            `${subject} — the citation resolves and still points at the wrong passage`,
        });
      }
    }
  }

  for (const entry of entries) {
    if (!entry.consumed) {
      fail(
        `stale exception — ${entry.file} entry ${entry.position} (${entry.subject}) matches nothing the gate found; ` +
          "delete it, because a fixed citation must shrink this manifest rather than be re-fingerprinted",
      );
    }
  }

  lines.push(
    `spec citations: ${counts.citations} checked across ${counts.files} file(s) ` +
      `(${counts.anchors} anchored, ${counts.tails} comma-appended, ${counts.bare} bare), ` +
      `${counts.quotations} quoted production(s), ` +
      `${counts.statusClaims} status claim(s) — UNRESOLVED ${counts.excused}, ${counts.failed} failed`,
  );
  lines.push(
    "  This gate checks that a citation RESOLVES to text, that a quoted EBNF production is in the range " +
      "cited, and that a forward-looking status claim names a tracking issue. It does NOT check that a " +
      "resolving citation supports the claim beside it when that claim paraphrases, nor that prose beside " +
      "a correct line describes it correctly — the wrong-passage and misstating-prose modes of issue #934. " +
      "A section anchor (<file>.md#a-heading) carries no line, so it is not checked either: a renamed or " +
      "misspelled heading passes unseen. Do not read a green run as 'every citation is right'.",
  );
  if (counts.excused > 0) {
    lines.push(
      `  UNRESOLVED counts citations that do not resolve and are recorded in ${toPosixPath(exceptionsPath)} ` +
        "against a tracking issue. Fixing one DELETES its entry; the number is expected to fall to zero.",
    );
  }

  return { ok: counts.failed === 0, counts, lines, findings };
}

/**
 * Parse CLI arguments: `--root=<path>` (repeatable), `--spec-dir=<token>`, `--spec-root=<path>`, and
 * `--exceptions=<path>` override the defaults, which is how the subprocess regression tests point the
 * CLI at isolated temp fixtures instead of the real corpus.
 */
export function parseArgs(argv) {
  const roots = [];
  let specDirectory;
  let specRoot;
  let exceptionsPath;
  for (const arg of argv) {
    if (arg.startsWith("--root=")) {
      roots.push(arg.slice("--root=".length));
    } else if (arg.startsWith("--spec-dir=")) {
      specDirectory = arg.slice("--spec-dir=".length);
    } else if (arg.startsWith("--spec-root=")) {
      specRoot = arg.slice("--spec-root=".length);
    } else if (arg.startsWith("--exceptions=")) {
      exceptionsPath = arg.slice("--exceptions=".length);
    }
  }
  return {
    roots: roots.length > 0 ? roots : undefined,
    specDirectory,
    specRoot,
    exceptionsPath,
  };
}

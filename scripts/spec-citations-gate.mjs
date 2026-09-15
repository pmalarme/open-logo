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
 *    inverted, or the cited region holds no text at all. **COVERED** ({@link resolveCitation}); a
 *    section anchor is covered by {@link resolveAnchor}, which is the same claim in the heading
 *    dimension: the heading it names must exist.
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
 * - a **back-reference**, when the same line spec appears earlier in the file as an explicit citation;
 * - a **context reference**, attributed to the nearest preceding spec-file mention (which need not
 *   carry a line number of its own);
 * - **unattributed**, when no spec file is named before it — reported, never silently dropped.
 *
 * The back-reference rule comes first because nearest-preceding attribution demonstrably gets it
 * wrong: `packages/parser/src/keywords.ts` refers back to a line-408 ruling four lines after
 * mentioning a *different* spec document, and only the earlier explicit citation says which document
 * that bare reference belongs to.
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
 * ## Section anchors, and the slug rule written down
 *
 * A **section anchor** (`<file>.md#a-heading`) names a heading rather than a line, so ordinary edits
 * above it do not move it — which is why saga #1180 makes it the preferred form. It was previously
 * enumerated as a mention and never resolved, so a renamed or misspelled heading passed unseen; an
 * unchecked *preferred* form is worse than the fragile one it replaces, so issue #1181 resolves it:
 * {@link resolveAnchor} requires some heading in the cited file to slugify to the fragment, and there
 * is **no automatic tolerance** — a near miss is reported as a did-you-mean suggestion and **still
 * fails**, because a suggestion the gate acted on would be the same indistinguishable-from-the-defect
 * tolerance #893's reviewers deleted.
 *
 * **Preferred is not invariant, and the difference matters.** Resolving an anchor proves that *some*
 * heading claims that slug — never that the section the citation meant still claims it. Duplicates
 * are numbered **positionally**, which gives that gap two shapes, both silent and both green:
 *
 * - **Demotion.** A new heading with the same text inserted *ahead* of the cited one takes the bare
 *   slug, pushing the original to `-1`.
 * - **Promotion.** An earlier duplicate renamed or removed *vacates* its slug, and the next one
 *   inherits it.
 *
 * So a rename fails **loudly** only when it leaves the slug unclaimed; when something else claims it,
 * the citation quietly points somewhere new. This is the anchor form's version of the wrong-passage
 * class, not an escape from it — and it is **inherent to slugs, not to any reader**, so replacing the
 * reader with a parser did not touch it. `spec/commands.md` is where the positional numbering is live
 * rather than theoretical: its operator headings are punctuation only, so they collide on the empty
 * slug and are reached positionally — the first of them slugs to the empty string, which is not a
 * citable fragment at all. For that block the anchor form cannot express a stable citation.
 *
 * **Headings come from a real GFM parse, and the slug from `github-slugger`** ({@link
 * documentHeadings}, ADR-0035). The gate previously reimplemented both, and nine review rounds
 * established that it could not: a line-by-line reader was defeated in turn by HTML blocks, `_`
 * emphasis, `²`, code-span contents, container markers inside fences, and finally by a fence opened
 * on a list-item continuation line — the shape `spec/execution-model.md` actually uses. Every fix was
 * correct and every one left another door open, because the missing information was **structural**:
 * which lines a fenced block covers is inherited block state, not a property of the line.
 *
 * The parse buys two things, and one without the other would not have been worth a dependency.
 * **Block structure** — fences inside containers, HTML blocks, indented code, setext headings, and
 * headings nested in blockquotes and list items, which GitHub publishes. And **rendered text** —
 * `github-slugger` expects what a reader *sees*, so `## [Text](target)` publishes `#text` rather than
 * `#texttarget`, `## A &amp; B` publishes `#a--b`, and `` ## ` foo ` `` publishes `#foo` because a
 * code span is trimmed. Slugging the markdown *source* gets all three wrong, and no amount of block
 * parsing would have touched them.
 *
 * What the parse obsoleted is **deleted**, not kept in reserve: the hand-rolled slug rule, the
 * character permit-lists over headings and code-span contents, the fence and container scanners, the
 * refusals for HTML blocks, setext rules, nested headings and container fences, and the tag-stripping
 * pattern that a `>` inside an attribute value defeated. A dependency that only adds has not paid for
 * itself. What survives in {@link unsupportedConstructs} is three **conservative refusals** — an
 * entity reference this reader does not decode, raw inline HTML, and an emoji shortcode shape — and
 * the live-corpus test keeps the cited documents' freedom from all three measured rather than
 * asserted.
 *
 * A fragment of the form `#L30` or `#L28-L84` is GitHub's **line fragment**, not a heading: it names
 * lines, so it is resolved against the file's length by {@link resolveCitation} like any other line
 * claim, and it inherits exactly the drift #1180 exists to remove. A heading slug is lowercased at
 * step 1 and so can never begin with an uppercase `L`, which is what makes the two forms
 * distinguishable without guessing.
 *
 * ## Known blind spots, stated rather than hidden
 *
 * Every citation — line form and anchor alike — is found by the literal `<spec-dir>/` prefix, so a
 * **relatively-written** reference is invisible to this gate. `docs/adr/0029-…md` already records
 * that for the line form; the anchor form inherits it, which matters more now that #1180 makes the
 * anchor *preferred*. Such anchors exist today, nearly all of them inside `spec/` itself, and nothing
 * checks any of them. Write the prefix.
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
import GithubSlugger from "github-slugger";
import { marked } from "marked";

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
 * unreachable although the identical unwrapped sentence fails. Measured before issue #961's sweep
 * with the eight phrases below: **2** untracked wrap-only claims, both fixed by hand there, so at
 * this commit the untracked count is **0**. (A tree-wide *total* is instrument-dependent — sweeps of
 * different shapes also see this vocabulary's own quotation in `AGENTS.md` and a `#208`/`#209` claim
 * in `turtle-clear.test.mjs`, both tracked.) Making the matcher wrap-safe is mechanically straightforward — flatten
 * every prose run with the same array-then-join technique used below, which is linear — but it
 * changes what the gate reports
 * (a claim's line must be mapped back from a run offset) and needs its own tests against the 100%
 * coverage gate, so it is not attempted here; it is routed to `@orchestrator` for saga #987.
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
  /** A section anchor names a heading (or a file) that does not exist. */
  "missing-anchor": "heading",
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

/**
 * Build the regex matching `<specDirectory>/<file>.md` with an optional line spec and an optional
 * `#fragment`.
 *
 * The fragment is captured as group 5 — appended rather than inserted — so the line-spec groups keep
 * the numbers they had before issue #1181 and every existing reader of this pattern is unaffected.
 *
 * The fragment class matches what a slug can **contain** (letters, digits, combining marks, `-`,
 * `_`), not merely ASCII, so a heading with an accented word cannot be truncated mid-slug into a
 * confusing "no heading slugs to `caf`". Combining marks are in the class because `github-slugger`
 * preserves them: a decomposed `## Café` publishes a slug whose final code point is U+0301, and
 * without `\p{M}` the citation to it truncates to `cafe` and is reported malformed — a false failure
 * manufactured by the tokenizer rather than found in the document. It is `*` rather than `+` on
 * purpose: a `#` with nothing after it is enumerated as an **empty** fragment and fails, instead of
 * falling through as a plain file mention. That shape is a real defect — an anchor hard-wrapped
 * immediately after its `#` — and matching `+` made the one live instance in this tree invisible to
 * the very check meant to catch it.
 */
function mentionPattern(specDirectory) {
  return new RegExp(
    `${specDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/([A-Za-z0-9._-]+\\.md)(?::(\\d+)(?:-(\\d+))?((?:,\\d+(?:-\\d+)?)+)?)?(?:#([\\p{L}\\p{N}\\p{M}_-]*))?`,
    "gu",
  );
}

/**
 * What may legally follow a `#fragment`.
 *
 * This is the boundary check that keeps the fragment class from **truncating** a malformed anchor
 * into a valid prefix: without it `#a-heading.extra`, `#a-heading%2Dtypo` and `#a-heading/typo` all
 * collect as `a-heading` and **pass**, which is tolerance smuggled in through the tokenizer rather
 * than through a near-miss rule.
 *
 * There are exactly two ways a fragment may end, and the asymmetry between them is the whole rule:
 *
 * - a **delimiter** closes the token directly — whitespace, end of input, a quote, or a bracket;
 * - **trailing punctuation** (a sentence full stop, a comma, a closing `**`) counts only when
 *   whitespace or end-of-line follows it.
 *
 * Punctuation followed by anything else is part of a fragment this gate cannot resolve. That single
 * asymmetry is what makes `[bad](x.md#a-heading.)` fail — the `.` sits inside a link destination
 * where `)` closes the URL, so it belongs to the fragment — **without parsing link destinations at
 * all**. Two reviewers defeated a destination-parsing version of this rule in two different ways (a
 * space after `](`, then a balanced `(foo)` inside the destination); the asymmetric rule has no
 * destination to get wrong, which is why it replaced it.
 *
 * One stated limit: `_` is a legal slug character, so `_x.md#a-heading_` cannot be told from a
 * fragment genuinely ending in `_`. Underscore emphasis around a citation therefore fails — loudly,
 * and this corpus emphasises with `*`. The cited side has no such ambiguity any more: the parser
 * resolves emphasis before the slug is computed, so `## _Text_` correctly publishes `#text`.
 */
const FRAGMENT_BOUNDARY = /^(?:[\s`'"“”‘’)\]}>|]|$)|^[.,:;!?*~+=…—–]+(?:\s|$)/u;

/**
 * GitHub's **line fragment** (`#L30`, `#L28-L84`), which names lines rather than a heading.
 *
 * A heading slug is lowercased by `github-slugger`, so it can never begin with an uppercase
 * `L` followed by digits. That is what lets the two fragment forms be told apart structurally instead
 * of guessed at, and it is why this pattern is anchored and case-sensitive.
 */
const LINE_FRAGMENT = /^L(\d+)(?:-L(\d+))?$/;

/**
 * Every heading a markdown document publishes, in order, with the fragment each is reachable at.
 *
 * **This is a real GFM parse, and that is the whole point.** Nine review rounds established that a
 * line-by-line reader cannot decide which lines a heading occupies: which lines a fenced block covers
 * is inherited block state, not a property of the line, and the hand-rolled version was defeated in
 * turn by HTML blocks, `_` emphasis, `²`, code-span contents, container markers inside fences, and
 * finally by a fence opened on a list-item continuation line — the shape `spec/` actually uses. Each
 * fix was correct and each left another door open, because the missing information was structural.
 * `marked` supplies the block structure; `github-slugger` is what GitHub's anchors are built from.
 *
 * Two things had to come from the parser, and a parse that bought only one would not have been worth
 * the dependency:
 *
 * 1. **Block structure** — fences (including inside containers), HTML blocks, indented code, setext
 *    headings, and headings nested in blockquotes and list items, which GitHub publishes and a flat
 *    reader cannot see.
 * 2. **Rendered text** — `github-slugger` expects a heading's *rendered* text, not its markdown
 *    source. `## [Text](target)` publishes `#text`, not `#texttarget`; `## A &amp; B` publishes
 *    `#a--b`; `` ## ` foo ` `` publishes `#foo`, because a code span is trimmed. Slugging the source
 *    gets all three wrong, and no amount of block parsing would have touched them.
 *
 * Duplicate suffixing comes from `github-slugger`'s own occupancy tracking, one instance per
 * document — which is how GitHub numbers them, and why the retargeting bound in the module note
 * survives this change unaltered: a promoted or demoted duplicate still silently moves a resolving
 * anchor to a different section.
 *
 * `line` is best-effort: the parser reports structure, not offsets, so each heading is located by
 * scanning forward for the line its source came from, tolerating container prefixes. It is used for
 * reporting only — resolution keys on `slug` alone.
 */
export function documentHeadings(lines) {
  const slugger = new GithubSlugger();
  const found = [];
  let cursor = 0;
  const locate = (raw) => {
    const needle = raw.split("\n")[0].trim();
    // `findIndex` returns -1 when the source line cannot be recovered, and `Math.max` folds that
    // into "wherever we had got to" without a branch — the reader must never fail over a line
    // number, which is reporting detail; resolution keys on `slug` alone.
    const at = lines.findIndex(
      (line, index) =>
        index >= cursor &&
        line
          .replace(/\r$/, "")
          .replace(/^[ \t]*(?:>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)*/, "")
          .trim() === needle,
    );
    cursor = Math.max(at + 1, cursor + 1);
    return cursor;
  };
  const walk = (tokens) => {
    for (const token of tokens) {
      if (token.type === "heading") {
        const heading = renderedText(token.tokens);
        found.push({
          line: locate(token.raw),
          heading,
          slug: slugger.slug(heading),
          hazards: headingHazards(token.tokens),
        });
        continue;
      }
      // Blockquotes and list items publish the headings inside them, so the walk descends. Fenced
      // and indented code, and HTML blocks, are leaf tokens with no `tokens` to descend into, which
      // is exactly why their contents can no longer be mistaken for headings.
      if (token.type === "list") {
        walk(token.items);
        continue;
      }
      if (token.type === "blockquote" || token.type === "list_item") {
        walk(token.tokens);
      }
    }
  };
  walk(marked.lexer(lines.join("\n"), { gfm: true }));
  return found;
}

/**
 * A heading's **rendered** text — what `github-slugger` expects, and what GitHub slugs.
 *
 * It walks the **lexer's own inline token tree**, not the heading's raw source. That distinction is
 * load-bearing rather than stylistic: the tree is the only place a *reference* link has been resolved
 * against the document's link definitions. Re-parsing `[Text][ref]` in isolation produces `textref`,
 * an anchor GitHub never publishes, while its token carries the child text `Text`.
 *
 * Walking the tree also means there is no HTML to strip, so the tag-stripping pattern this used to
 * need — defeated by a `>` inside an attribute value or a comment — is gone rather than hardened.
 * Raw inline HTML is a leaf token, and {@link headingHazards} refuses the document outright.
 */
export function renderedText(tokens) {
  let text = "";
  for (const token of tokens) {
    if (token.type === "codespan") {
      // Already the trimmed literal: `` ` foo ` `` arrives as `foo`, and its contents are never
      // inline markup, so nothing inside it is decoded or descended into.
      text += token.text;
      continue;
    }
    if (token.type === "image") {
      // An `<img>` carries its alt text in an ATTRIBUTE, so it contributes nothing to the heading's
      // text content and nothing to the anchor. GitHub publishes an EMPTY anchor for
      // `## ![Mou icon](x.gif)`, and `#-headphones` for `## ![Headphones Logo](x.png) Headphones` —
      // note the leading hyphen, from the space the image leaves behind. Descending into the alt
      // tokens produced `mou-icon` and `headphones-logo-headphones`: anchors that resolve here and
      // 404 on GitHub, which is the silent direction.
      continue;
    }
    if (Array.isArray(token.tokens)) {
      // A link, emphasis or strikethrough renders as its own content. Descending is what makes a
      // REFERENCE link work: the lexer resolved `[Text][ref]` against the document's link
      // definitions, so its child token is `Text`. Re-parsing the heading's raw source instead —
      // which this used to do — has no definitions in scope and yields `textref`, an anchor GitHub
      // never publishes.
      text += renderedText(token.tokens);
      continue;
    }
    if (token.type === "br" || token.type === "html") {
      // Neither contributes text content. A `<br>` is reachable — a SETEXT heading spans lines, so
      // `Title··\nmore\n=====` lexes as text/br/text — and GitHub slugs a heading's rendered text
      // content, in which a `<br>` element contributes nothing: `titlemore`, not `title-more`.
      // `github-slugger` agrees by a second route, deleting the newline of `"Title\nmore"` to reach
      // the same slug; emitting a space was the only variant that disagreed with both. Raw HTML is
      // likewise a leaf with no recoverable text, and its document is refused by
      // {@link headingHazards} regardless, so its slug never resolves anything.
      continue;
    }
    // Entities are decoded PER TOKEN rather than over the joined string, which is the more faithful
    // order: `## A \&amp; B` lexes as an escape (`&`) followed by the text `amp; B`, so nothing
    // re-decodes what the author escaped, and GitHub's literal `&amp;` is preserved.
    text += decodeEntities(token.text);
  }
  return text;
}

/** The named entities markdown rendering can emit, plus numeric forms. */
const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
});

/**
 * The two numeric-reference grammars, kept apart.
 *
 * Writing them as one `#[xX]?[0-9a-fA-F]+` makes the `x` optional over a hex digit class, so a
 * malformed *decimal* reference carrying `A`-`F` is accepted as a number: `&#12A;` decoded as 12 and
 * slugged `a--b` where GitHub renders it literally and publishes `a-12a-b`, and `&#AB;` reached
 * `String.fromCodePoint(NaN)` and **crashed the gate**. They are built from one place because the
 * grammar is used three times and drift between the copies is what makes that kind of hole reappear.
 */
const NUMERIC_REFERENCE = "#(?:[0-9]+|[xX][0-9a-fA-F]+)";

/** A named entity reference, whatever it names. */
const NAMED_REFERENCE = "[a-zA-Z][a-zA-Z0-9]*";

/**
 * Decode the HTML entities a renderer emits, so the slug sees the character a reader sees.
 *
 * Numeric references follow CommonMark's replacement rule, which is what GitHub's renderer applies:
 * a null, a lone surrogate, or a value past the last code point has **no character to produce**, and
 * is replaced by U+FFFD rather than left as written. Getting this wrong is silent, not loud —
 * `&#xD800;` slugged as a bare surrogate and `&#x110000;` as the literal text `x110000`, both of
 * them anchors GitHub does not publish, and neither was refused.
 *
 * Anything that is not one of the two grammars is left exactly as written, which is what GitHub does
 * with it too.
 */
export function decodeEntities(text) {
  return text.replace(
    new RegExp(`&(${NUMERIC_REFERENCE}|${NAMED_REFERENCE});`, "g"),
    (whole, body) => {
      if (body[0] !== "#") {
        return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
      }
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(
        hex ? body.slice(2) : body.slice(1),
        hex ? 16 : 10,
      );
      const unrepresentable =
        code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff);
      return unrepresentable ? "\uFFFD" : String.fromCodePoint(code);
    },
  );
}

/** The entities {@link decodeEntities} can resolve: what a renderer emits when escaping, plus numeric. */
const DECODABLE_ENTITY = new RegExp(
  `^&(?:amp|lt|gt|quot|apos|nbsp|${NUMERIC_REFERENCE});$`,
);

/** Any entity reference a heading's source may contain. */
const ANY_ENTITY = new RegExp(
  `&(?:${NAMED_REFERENCE}|${NUMERIC_REFERENCE});`,
  "g",
);

/** A GFM emoji shortcode, which GitHub replaces with a character the slug rule then deletes. */
const EMOJI_SHORTCODE = /:[a-z0-9+_-]+:/;

/**
 * The constructs in a heading's **inline** tokens that this reader cannot reproduce.
 *
 * It walks the parser's own inline tree rather than the heading's raw source, which is what makes it
 * precise enough to be narrow: a `codespan` is literal text and is skipped entirely, so the live
 * `` ### `<place> = <value>` `` heading is not mistaken for inline HTML. An `image` is skipped for
 * the same reason {@link renderedText} skips it — its alt text is an attribute and reaches no
 * anchor — so a shortcode or entity appearing only there cannot refuse a document it does not affect.
 *
 * Three things survive the parse. All three are **conservative refusals**, and the distinction
 * matters: two of them are recognised by *shape*, so a heading whose `&notanentity;` or
 * `:not_an_emoji:` GitHub would publish literally is refused as well. That errs loudly — a refused
 * document names the construct and the remedy — rather than inventing a slug, which is the only
 * direction this gate is allowed to be wrong in. Telling the real ones apart would need exactly the
 * hand-maintained tables the parse was adopted to end.
 *
 * - **An entity reference this reader does not decode.** CommonMark resolves every valid HTML5
 *   entity and GitHub slugs the character; `marked` leaves them in the token text, so `## A &copy; B`
 *   would slug `a-copy-b` here against GitHub's `a--b`. {@link decodeEntities} handles what a
 *   renderer *emits* when escaping — six names and the numeric forms — and deliberately does not grow
 *   a hand-maintained table of the other two thousand.
 * - **Raw inline HTML.** It is a leaf token with no text to recover, and recovering it by pattern is
 *   what broke on a `>` inside a comment or an attribute value.
 * - **An emoji shortcode shape**, which GitHub replaces with a character the slug rule then deletes
 *   and `marked` does not implement at all.
 *
 * All three are refused rather than guessed at, which keeps ADR-0035's claim true: where `marked` and
 * GitHub can differ, the gate declines to answer. The cited corpus contains no instance of any.
 */
function headingHazards(tokens) {
  const hazards = [];
  const walk = (inline) => {
    for (const token of inline) {
      if (token.type === "codespan" || token.type === "image") {
        continue;
      }
      if (token.type === "html") {
        hazards.push(
          "raw inline HTML in a heading, whose text this reader cannot recover",
        );
        continue;
      }
      if (Array.isArray(token.tokens)) {
        walk(token.tokens);
        continue;
      }
      // Every inline token `marked` emits carries `raw` — measured across all 1,235 headings in the
      // tracked corpus plus each hazard shape below. There is deliberately no fallback: if a future
      // version emits one without it, this throws and the gate goes loud, rather than silently
      // skipping the token and reporting a heading it never actually read.
      const source = token.raw;
      for (const entity of source.match(ANY_ENTITY) ?? []) {
        if (!DECODABLE_ENTITY.test(entity)) {
          hazards.push(
            `the entity reference ${entity} in a heading, which this reader does not decode and ` +
              "GitHub resolves whenever it names a valid HTML5 entity",
          );
        }
      }
      if (EMOJI_SHORTCODE.test(source)) {
        hazards.push(
          "an emoji shortcode shape in a heading, which this reader does not resolve and GitHub " +
            "replaces whenever it names a known emoji",
        );
      }
    }
  };
  walk(tokens);
  // Deduplicated per heading: two raw-HTML tokens in one heading are one hazard of that kind, not
  // two findings. Distinct strings survive, so `## A &copy; B &mdash; C` still names both entities.
  return [...new Set(hazards)];
}

/**
 * The heading slug in `headings` closest to `fragment`, with its edit distance — for a did-you-mean.
 *
 * This is reported and **never acted on**. The gate fails on a near miss exactly as it fails on a
 * wild one; a suggestion is help for the author, not evidence for the gate.
 */
export function closestHeadingSlug(fragment, headings) {
  let best = null;
  for (const { slug } of headings) {
    const distance = editDistance(fragment, slug);
    if (best === null || distance < best.distance) {
      best = { slug, distance };
    }
  }
  return best;
}

/** Levenshtein distance between two short strings, over a single rolling row. */
export function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution =
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
      current.push(
        Math.min(substitution, previous[column] + 1, current[column - 1] + 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/**
 * How far a candidate may sit from the fragment and still be offered as a did-you-mean: two edits,
 * or a third of the fragment's length for a long one.
 *
 * The threshold governs the **wording of a failure only** — every non-exact fragment fails either
 * way, so no value here can turn a miss into a pass. It exists because the nearest slug in a document
 * is always *some* string: naming it unconditionally dresses an unrelated heading up as the fix, and
 * an author who takes that advice writes a citation that resolves and is wrong — the wrong-passage
 * mode, manufactured by the tool meant to catch it. `#collections-` reads as nearest to
 * `#ebnf-notation`, eleven edits away, which is not what its author meant by any reading. Both sides
 * of the boundary are pinned by tests.
 */
export function suggestionDistance(fragment) {
  return Math.max(2, Math.floor(fragment.length / 3));
}

/**
 * Markdown in a document that this reader still cannot reproduce — what remains of the **canary**.
 *
 * It used to carry the whole weight of the gate's honesty: permit-lists over heading characters and
 * code-span contents, refusals for HTML blocks, setext rules, nested headings and container fences.
 * **The parser obsoleted all of it**, and it is deleted rather than kept "just in case" — a
 * dependency that only adds has not paid for itself.
 *
 * What survives is {@link headingHazards}: the constructs where `marked` and GitHub genuinely differ
 * rather than where this reader merely approximated. A cited document containing one is refused, so
 * the gate declines to answer instead of inventing a slug. `spec/` has none, and the live-corpus
 * test keeps that measured rather than asserted.
 */
export function unsupportedConstructs(lines) {
  return documentHeadings(lines).flatMap(({ line, hazards }) =>
    hazards.map((construct) => ({ line, construct })),
  );
}
/**
 * Resolve one section anchor against the headings of the document it names.
 *
 * @returns `null` when some heading slugs to the fragment, or `{ status, detail }` describing how it
 *   does not. As everywhere else in this gate there is no third outcome: a near miss is described,
 *   not accepted.
 */
export function resolveAnchor(anchor, headings) {
  if (headings === null) {
    return {
      status: "missing-file",
      detail: `${anchor.specDirectory}/${anchor.file} does not exist`,
    };
  }
  // A bare `#` names no section. It is reported as its own state rather than looked up, because a
  // document CAN hold a heading whose slug is empty — `spec/commands.md`'s operator headings are
  // punctuation only — and resolving `#` against one would accept a citation no reader can follow.
  if (anchor.fragment === "") {
    return {
      status: "empty-fragment",
      detail: 'the "#" names no heading, so this citation points at nothing',
    };
  }
  if (anchor.malformed === true) {
    return {
      status: "malformed-fragment",
      detail:
        "the fragment continues with a character no heading slug can contain, so what is written " +
        `here is not "#${anchor.fragment}" and cannot be resolved`,
    };
  }
  if (headings.some(({ slug }) => slug === anchor.fragment)) {
    return null;
  }
  const closest = closestHeadingSlug(anchor.fragment, headings);
  const near =
    closest !== null && closest.distance <= suggestionDistance(anchor.fragment);
  return {
    status: "missing-heading",
    detail:
      `no heading in ${anchor.file} slugs to "${anchor.fragment}"` +
      (closest === null
        ? " — it has no headings at all"
        : near
          ? ` — did you mean "#${closest.slug}"?`
          : ` — and none of its ${headings.length} headings is close enough to guess at`),
  };
}

/** Render an anchor back into the canonical `<spec-dir>/<file>.md#<fragment>` form. */
export function formatAnchor(anchor) {
  return `${anchor.specDirectory}/${anchor.file}#${anchor.fragment}`;
}

/**
 * The fragment `nextLine` completes, when `fragment` is one slug **hard-wrapped across a line break**
 * and the two halves joined back up name a real heading — otherwise `null`.
 *
 * This is diagnosis, never tolerance: the caller has already failed the anchor and only uses this to
 * say *why* in a way the author can act on. A wrap is a hazard the anchor form brings with it, and it
 * does not look like one from the failure alone — the live instance, in a design note citing
 * `grammar.md`'s comprehension section, reads as `#collections-` and is indistinguishable from a
 * misspelling until you see the next line. The suggestion is only offered when the rejoined fragment
 * matches a heading **exactly**, so it is a finding rather than a guess.
 */
export function rejoinedFragment(fragment, nextLine, headings) {
  if (nextLine === undefined) {
    return null;
  }
  const continuation = /^(?:\/\/+|\*+|#+)?[ \t]*([\p{L}\p{N}_-]+)/u.exec(
    nextLine.trim(),
  );
  if (continuation === null) {
    return null;
  }
  const joined = `${fragment}${continuation[1]}`;
  return headings.some(({ slug }) => slug === joined) ? joined : null;
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
 * This form is neither an explicit citation nor a bare `:N`, and a sweep built from either pattern
 * alone misses it silently — the summary's `comma-appended` counter is how many there are, rather
 * than a number restated here that nothing keeps true. It is exactly the kind of shape that makes a
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
  explicit: "explicit",
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
 * Enumerate every citation in one file's `text`, every section anchor, plus every bare `:N` that
 * could not be attributed.
 *
 * An **explicit** citation (`<spec-dir>/<file>.md:<line>`) is unambiguous. A bare `:<line>` is
 * attributed by the two rules the module note explains — back-reference first, then nearest preceding
 * mention — and, when neither applies, reported so that nothing is dropped without a trace.
 *
 * A `#fragment` is collected from the same single pass over mentions rather than by a second sweep,
 * so the two forms can never disagree about what the file says.
 *
 * @returns `{ citations, anchors, unattributed }`.
 */
export function collectCitations(path, text, specDirectory = SPEC_DIRECTORY) {
  const lines = splitLines(text);
  const lineAt = lineLookup(lines);
  const citations = [];
  const anchors = [];
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
    const line = lineAt(mention.index);
    if (match[5] !== undefined) {
      anchors.push({
        specDirectory,
        file: mention.file,
        fragment: match[5],
        line,
        // Whether the fragment class stopped short of where the written token actually ends. The
        // anchor is still collected — dropping it would be the silent tolerance this gate forbids —
        // and carries the flag so {@link resolveAnchor} fails it as unresolvable rather than
        // resolving the prefix that happened to survive truncation.
        malformed: !FRAGMENT_BOUNDARY.test(text.slice(mention.end)),
      });
    }
    if (mention.start !== undefined) {
      citations.push({
        specDirectory,
        file: mention.file,
        start: mention.start,
        end: mention.stop,
        line,
        form: "explicit",
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
    return { citations, anchors, unattributed };
  }

  // Which file an earlier explicit citation gave each exact line spec, so a bare back-reference
  // sitting four lines below a mention of a *different* document still resolves to the one that
  // introduced it.
  const backReferences = new Map();
  for (const citation of citations) {
    const key = `${citation.start}-${citation.end ?? ""}`;
    const known = backReferences.get(key);
    // Two documents cited at the same line spec make a later bare reference genuinely ambiguous;
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
  return { citations, anchors, unattributed };
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
    explicit: 0,
    tails: 0,
    bare: 0,
    sectionAnchors: 0,
    lineFragments: 0,
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

  const headingCache = new Map();
  const specHeadingsFor = (file) => {
    if (!headingCache.has(file)) {
      const specLines = specLinesFor(file);
      headingCache.set(
        file,
        specLines === null ? null : documentHeadings(specLines),
      );
    }
    return headingCache.get(file);
  };

  // The canary fires once per cited document, not once per anchor: a construct this reader cannot
  // follow is a property of the document, and repeating it for every citation of one section would
  // bury the one fact a maintainer needs. It is a bare failure rather than an excusable finding on
  // purpose — an exception entry is fingerprinted over the CITING line, so it could only ever excuse
  // one of many identical exposures, and folding an instrument-capability failure into UNRESOLVED
  // would make that audit count mean two different things.
  const canaried = new Set();
  const canaryFor = (file) => {
    if (canaried.has(file)) {
      return;
    }
    canaried.add(file);
    const specLines = specLinesFor(file);
    if (specLines === null) {
      return;
    }
    for (const { line, construct } of unsupportedConstructs(specLines)) {
      fail(
        `${specDirectory}/${file}:${line}: this document contains ${construct} — so an anchor into ` +
          "it could name a heading GitHub never publishes, or miss one it does. Remove the construct, " +
          "or cite this document by line instead. (The line here is located by scanning and may be " +
          "approximate; the construct is what the parser found.)",
      );
    }
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
    const { citations, anchors, unattributed } = collectCitations(
      file,
      text,
      specDirectory,
    );
    if (
      citations.length === 0 &&
      anchors.length === 0 &&
      unattributed.length === 0
    ) {
      continue;
    }
    counts.files += 1;

    for (const anchor of anchors) {
      const subject = formatAnchor(anchor);
      const context = fileLines[anchor.line - 1];
      // A fragment that is empty, or truncated by a character no slug can hold, is neither a heading
      // nor a line claim: it is unresolvable as written, and is reported that way rather than being
      // matched on the prefix that survived.
      const wellFormed = anchor.fragment !== "" && anchor.malformed !== true;
      const fragment = wellFormed ? LINE_FRAGMENT.exec(anchor.fragment) : null;
      if (fragment !== null) {
        // A line fragment names lines, so it is checked as the line claim it is rather than hunted
        // for among the headings, where it could only ever be reported as a heading that does not
        // exist.
        counts.lineFragments += 1;
        const failure = resolveCitation(
          {
            specDirectory,
            file: anchor.file,
            start: Number(fragment[1]),
            end: fragment[2] === undefined ? undefined : Number(fragment[2]),
          },
          specLinesFor(anchor.file),
        );
        if (failure !== null) {
          excuse({
            file,
            context,
            subject,
            observed: failure.status,
            kind: "stale-citation",
            describe: `${file}:${anchor.line}: ${subject} does not resolve — ${failure.detail}`,
          });
        }
        continue;
      }
      counts.sectionAnchors += 1;
      canaryFor(anchor.file);
      const headings = specHeadingsFor(anchor.file);
      const failure = resolveAnchor(anchor, headings);
      if (failure === null) {
        continue;
      }
      const wrapped =
        headings === null
          ? null
          : rejoinedFragment(anchor.fragment, fileLines[anchor.line], headings);
      excuse({
        file,
        context,
        subject,
        observed: failure.status,
        kind: "missing-anchor",
        describe:
          `${file}:${anchor.line}: ${subject} does not resolve — ${failure.detail}` +
          (wrapped === null
            ? ""
            : ". It continues on the next line: this anchor is one slug hard-wrapped across a line " +
              `break, and joined back up it reads "#${wrapped}" — keep an anchor on one line`),
      });
    }

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
    `spec citations: ${counts.citations} checked across ${counts.files} citing file(s) ` +
      `(${counts.explicit} explicit, ${counts.tails} comma-appended, ${counts.bare} bare), ` +
      `${counts.sectionAnchors} section anchor(s), ${counts.lineFragments} line fragment(s), ` +
      `${counts.quotations} quoted production(s), ` +
      `${counts.statusClaims} status claim(s) — UNRESOLVED ${counts.excused}, ${counts.failed} failed`,
  );
  lines.push(
    "  This gate checks that a citation RESOLVES to text, that a section anchor (<file>.md#a-heading) names " +
      "a heading that exists in the file it cites, that a quoted EBNF production is in the range cited, and " +
      "that a forward-looking status claim names a tracking issue. Resolving an anchor proves A HEADING " +
      "EXISTS and nothing further: it does NOT prove the section supports the claim written beside it. The " +
      "wrong-passage and misstating-prose modes of issue #934 survive an anchor exactly as they survive a " +
      "line number — a citation that resolves may still paraphrase a passage that does not support it, and " +
      "prose beside a correct heading may still misstate what that section says. The explicit, " +
      "comma-appended and bare counts above, and the line fragment (<file>.md#L30), all name lines and " +
      "so still drift whenever the spec is edited above them. Ordinary non-heading edits above a " +
      "section anchor do not move it — but resolving one proves only that SOME heading claims that " +
      "slug, never that the section the citation meant still claims it. Duplicate headings are " +
      "numbered positionally, so inserting a colliding heading promotes it into the bare slug and " +
      "demotes the original, and removing or renaming an earlier duplicate promotes a later one into " +
      "the slug it vacated; both retarget a citation silently and both leave this gate green. A " +
      "renamed heading therefore fails loudly only when the rename leaves its slug unclaimed. A " +
      "citation written without the spec-directory prefix is not seen at all. Headings come from a " +
      "GFM parse and slugs from github-slugger (ADR-0035), so block structure and rendered text are " +
      "no longer approximated; where GitHub can still resolve something this reader does not — an " +
      "entity reference outside the escaping set, raw inline HTML, or an emoji shortcode shape — the " +
      "cited document is refused rather than answered on a slug computed differently from GitHub's. " +
      "Two of those three are recognised by shape, so a construct GitHub would publish literally is " +
      "refused too: this gate errs toward refusing loudly, never toward inventing a slug. Do not read " +
      "a green run as 'every citation is right'.",
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

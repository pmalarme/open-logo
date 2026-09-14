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
 * heading claims that slug — never that the section the citation meant still claims it. Step 4 below
 * numbers duplicates **positionally**, which gives that gap two shapes, both silent and both green:
 *
 * - **Demotion.** A new heading with the same text inserted *ahead* of the cited one takes the bare
 *   slug, pushing the original to `-1`.
 * - **Promotion.** An earlier duplicate renamed or removed *vacates* its slug, and the next one
 *   inherits it.
 *
 * So a rename fails **loudly** only when it leaves the slug unclaimed; when something else claims it,
 * the citation quietly points somewhere new. This is the anchor form's version of the wrong-passage
 * class, not an escape from it. `spec/commands.md` is where the positional numbering is live rather
 * than theoretical: its operator headings are punctuation only, so they collide on the empty slug and
 * are reached positionally — the first of them slugs to the empty string, which is not a citable
 * fragment at all. For that block the anchor form cannot express a stable citation.
 *
 * **The slug rule is a choice, not an obvious fact, so it is stated here and pinned by tests.** It
 * reimplements GitHub's (`github-slugger`), which is what actually resolves these fragments when a
 * reader clicks one:
 *
 * 1. Lowercase, then trim.
 * 2. Delete every character that is not a letter, a digit, a space, `-`, or `_`. **`_` survives**, so
 *    `` `set_xy` `` slugs to `set_xy`; `&` does not, so `Turtle & Rendering` slugs to
 *    `turtle--rendering` — **runs of hyphens are never collapsed**.
 * 3. Replace each space with `-`.
 * 4. Within one document, a slug already taken is suffixed — and the suffix **probes upward until it
 *    finds one nothing has claimed**, rather than trusting an occurrence count. The difference is
 *    observable: for headings `Foo`, `Foo-1`, `Foo`, counting alone hands `foo-1` to two sections, so
 *    one anchor silently resolves to the wrong one.
 *
 * Headings are read with {@link documentHeadings}, which is **fence-aware**: `spec/` holds lines that
 * begin with `#` inside fenced blocks — OpenLogo comments such as `# primary line comment` in
 * `spec/grammar.md` — and counting those as headings would make anchors resolve that GitHub cannot.
 *
 * **Where this reader is not a markdown renderer, and what stops that mattering.** The slug rule
 * works on a heading's markdown **source**. That equals its rendered text for the constructs this
 * corpus uses — code spans, emphasis, `&`, parentheses, `<` and `>` inside code — but not for a
 * markdown **link**, an HTML **entity**, or inline **HTML**; an **HTML block** can hide an ATX line
 * GitHub never makes a heading; a **setext** heading is not collected at all; and a heading nested in
 * a blockquote or list item is published by GitHub and invisible here.
 *
 * Each cuts both ways, and only one direction is dangerous. The anchor a reader would actually
 * write — GitHub's — **fails** here, which is loud and safe. But the slug this reader *invents* is
 * citable too, and citing it **passes here and 404s there**. That quiet direction is the one a gate
 * must never have, and stating a known false pass is not the same as not having one.
 *
 * So {@link unsupportedConstructs} refuses to answer: a cited document containing any such construct
 * fails outright, naming it and its line, rather than being resolved against a slug this reader is
 * not entitled to compute. **It is a permit-list, not an enumeration** — earlier enumerating attempts
 * were each defeated by constructs they did not list, most tellingly `_` emphasis, which slips
 * through *because* the slug rule keeps `_` so that `` `set_xy` `` is right. A heading may therefore
 * contain only characters proven to survive rendering unchanged; everything else is refused. `spec/`
 * is clean today, kept so by the canary itself rather than by an assertion here. Issue #1190 decides
 * whether to replace the whole reader with a CommonMark parse; until it does, `spec/` cannot adopt a
 * `<details>` block, a linked or emphasised heading, or a setext heading without turning the gate
 * red, which is a deliberate trade and not an accident.
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
 * The fragment class matches what {@link headingSlug} can **produce** (letters, digits, `-`, `_`),
 * not merely ASCII, so a heading with an accented word cannot be truncated mid-slug into a confusing
 * "no heading slugs to `caf`". It is `*` rather than `+` on purpose: a `#` with nothing after it is
 * enumerated as an **empty** fragment and fails, instead of falling through as a plain file mention.
 * That shape is a real defect — an anchor hard-wrapped immediately after its `#` — and matching `+`
 * made the one live instance in this tree invisible to the very check meant to catch it.
 */
function mentionPattern(specDirectory) {
  return new RegExp(
    `${specDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/([A-Za-z0-9._-]+\\.md)(?::(\\d+)(?:-(\\d+))?((?:,\\d+(?:-\\d+)?)+)?)?(?:#([\\p{L}\\p{N}_-]*))?`,
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
 * One stated limit, and it is the same character that forces the heading permit-list: `_` is a legal
 * slug character, so `_x.md#a-heading_` cannot be told from a fragment genuinely ending in `_`.
 * Underscore emphasis around a citation therefore fails — loudly, and this corpus emphasises with
 * `*`. See {@link HEADING_PERMITTED} for the same ambiguity on the cited side, where it is a false
 * *pass* rather than a false failure and is refused outright.
 */
const FRAGMENT_BOUNDARY = /^(?:[\s`'"“”‘’)\]}>|]|$)|^[.,:;!?*~+=…—–]+(?:\s|$)/u;

/**
 * GitHub's **line fragment** (`#L30`, `#L28-L84`), which names lines rather than a heading.
 *
 * A heading slug is lowercased ({@link headingSlug} step 1), so it can never begin with an uppercase
 * `L` followed by digits. That is what lets the two fragment forms be told apart structurally instead
 * of guessed at, and it is why this pattern is anchored and case-sensitive.
 */
const LINE_FRAGMENT = /^L(\d+)(?:-L(\d+))?$/;

/**
 * The fragment one markdown heading is reachable at, by GitHub's slug rule — reimplemented here, and
 * spelled out step by step in the module note because it is a *choice* rather than an obvious fact.
 *
 * It operates on the heading's **source** text. `github-slugger` expects *rendered* text and is not
 * a markdown parser, and neither is this: every inline construct in this corpus — code spans,
 * emphasis, `&`, parentheses, `<` and `>` inside code — is punctuation that step 2 deletes, so the
 * two agree. A heading built from a construct whose rendered text differs from its source — a
 * markdown **link**, an HTML **entity**, inline **HTML** — diverges, and deliberately nothing is
 * unwrapped to paper over that. Unwrapping `[text](target)` was itself a false pass: it made
 * `` `[text](target)` `` — a code span whose rendered text is the whole literal, so GitHub slugs it
 * `texttarget` — come out as `text`. Without the unwrapping that code span is **right**, while a bare
 * `[text](target)` heading comes out `texttarget` where GitHub gives `text`. Neither direction is
 * left to luck: {@link unsupportedConstructs} fails the gate on any document whose headings use one
 * of those constructs, so the slug is never computed for a heading this function cannot read.
 *
 * Duplicate suffixing is **not** applied here: it is a property of a heading's position in a
 * document, not of its text, so {@link documentHeadings} owns it.
 */
export function headingSlug(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Every ATX heading in a markdown document, in order, with the fragment each is reachable at.
 *
 * **Fenced blocks are skipped**, which is load-bearing rather than tidy: this corpus writes OpenLogo
 * comments inside fences, so `# primary line comment` would otherwise be offered as a heading and an
 * anchor naming it would resolve here while failing on GitHub — a false pass, the one outcome a gate
 * must never produce. Closing a fence follows CommonMark on **both** axes: the same delimiter
 * character, and **at least as many of them** as the opener, with nothing but whitespace after. The
 * length half matters — a three-backtick line inside a four-backtick block is content, and treating
 * it as the close exposes every `#` line below it as a heading. A backtick opener whose info string
 * contains a backtick is not a fence at all.
 *
 * Indentation follows CommonMark: four spaces makes an indented code block, so both the fence and the
 * heading patterns admit at most three.
 *
 * Two limits, both currently without an instance in `spec/` and both stated in the module note: a
 * **setext** heading (underlined with `===`/`---`) is not collected, and an ATX-looking line inside a
 * **raw-HTML block** is. The first fails loudly; the second is the false-pass direction, which is why
 * it is written down rather than left to be discovered.
 *
 * @returns `[{ line, heading, slug }]`, `slug` carrying the `-1`/`-2` duplicate suffix where one is
 *   needed.
 */
export function documentHeadings(lines) {
  const headings = [];
  // `github-slugger` probes upward from the count until it finds a slug nothing has taken, rather
  // than trusting the count alone. The difference is observable: for headings `Foo`, `Foo-1`, `Foo`
  // a count-only rule hands `foo-1` to two different sections, so one anchor silently resolves to
  // the wrong one. `taken` is therefore consulted as well as incremented.
  const occurrences = new Map();
  const taken = new Set();
  let fence = null;
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, "");
    // Fence state is tracked by the shared scanner, which takes the RAW line and decides for itself
    // whether a container marker is syntax or code. Headings are still matched on the raw line, so
    // one nested in a container stays uncollected — the canary refuses those documents outright.
    const transition = advanceFence(fence, line);
    if (transition !== null) {
      fence = transition.fence;
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const heading = /^ {0,3}#{1,6}[ \t]+(.*)$/.exec(line);
    if (heading === null) {
      continue;
    }
    const text = heading[1].replace(/[ \t]+#+[ \t]*$/, "").trim();
    const base = headingSlug(text);
    let count = occurrences.get(base) ?? 0;
    let slug = base;
    while (taken.has(slug)) {
      count += 1;
      slug = `${base}-${count}`;
    }
    occurrences.set(base, count);
    taken.add(slug);
    headings.push({ line: index + 1, heading: text, slug });
  }
  return headings;
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
 * The inline code spans in one line, paired the way CommonMark does: a span is delimited by two runs
 * of **exactly equal length**, and an unmatched run is literal text.
 *
 * A regex cannot express that. `/(`+)[\s\S]*?\1/` lets a two-backtick run close a one-backtick
 * opener, so `` ## `[Text](target)`` `` — which CommonMark reads as literal backticks around a real
 * link — came out stripped, hiding the `[` from {@link unsupportedConstructs} and restoring exactly
 * the quiet false pass the canary exists to prevent.
 *
 * Offsets are UTF-16, matching `match.index`, because indexing a code-point array instead drifts by
 * one element for every astral character earlier in the line.
 */
function codeSpans(text) {
  const runs = [...text.matchAll(/`+/g)];
  const spans = [];
  let open = 0;
  while (open < runs.length) {
    let close = open + 1;
    while (
      close < runs.length &&
      runs[close][0].length !== runs[open][0].length
    ) {
      close += 1;
    }
    if (close >= runs.length) {
      open += 1;
      continue;
    }
    spans.push({
      start: runs[open].index,
      end: runs[close].index + runs[close][0].length,
      content: text.slice(
        runs[open].index + runs[open][0].length,
        runs[close].index,
      ),
    });
    open = close + 1;
  }
  return spans;
}

/**
 * Blank out every inline code span, leaving an **unmatched** run in place so the heading rule still
 * sees what it surrounds.
 */
export function stripCodeSpans(text) {
  const units = text.split("");
  for (const span of codeSpans(text)) {
    for (let at = span.start; at < span.end; at += 1) {
      units[at] = " ";
    }
  }
  return units.join("");
}

/**
 * Whether any code span in `text` is one CommonMark **normalizes**: content with a space at both
 * ends, and something other than spaces between them, loses one space from each end.
 *
 * A code span is otherwise the one construct this reader may treat as literal, which is what makes
 * this exception worth naming: `` ## ` foo ` `` renders as `<code>foo</code>`, so GitHub publishes
 * `#foo` while slugging the source yields `#-foo-`. That is the same source-versus-rendered
 * divergence as a link or an entity, hiding inside the construct the canary trusts — and
 * {@link stripCodeSpans} would make it invisible — so it is refused explicitly.
 *
 * It is computed from the paired spans rather than by a pattern over the whole line. A pattern
 * cannot tell a padded span from the ordinary prose *between* two spans: `` `area` and `perimeter` ``
 * reads as a backtick, a space, `and`, a space and a backtick, and two live `spec/` headings were
 * refused that way.
 */
function hasPaddedCodeSpan(text) {
  return codeSpans(text).some(
    ({ content }) =>
      content.startsWith(" ") && content.endsWith(" ") && !/^ +$/.test(content),
  );
}

/**
 * The characters a heading may contain outside a code span.
 *
 * **This is the permit-list, and the whole point is that it is closed.** Blacklisting the constructs
 * that render differently from their source loses one construct at a time — `_` emphasis was the
 * fourth to get through, after links, entities and inline HTML, and it gets through precisely
 * *because* {@link headingSlug} keeps `_` so that `` `set_xy` `` slugs correctly.
 *
 * **It is deliberately ASCII, and that is a correction rather than a simplification.** An earlier
 * version permitted `\p{L}\p{N}` — the very classes {@link headingSlug} keeps — so it validated the
 * slug rule against itself and could never refuse a character that rule preserved. `²` is category
 * `No`, so `\p{N}` kept it while `github-slugger` deletes it: `## Area in m²` slugs to `area-in-m²`
 * here and `area-in-m` there, so `#area-in-m²` passes here and 404s on GitHub. A verifier built from
 * the subject's own classes is a second opinion in name only, so this list is written independently
 * and admits only what is *proven*: ASCII letters and digits, space and tab, and punctuation checked
 * one by one against the real slugger class. Non-ASCII letters are refused — loudly — rather than
 * assumed, because that class is generated against an older Unicode than the `\p{L}` Node applies.
 *
 * `*` and `~` are permitted because rendering **and** the slug rule both delete them, so they cannot
 * disagree. `&` and `:` are permitted for `Turtle & Rendering` and ordinary prose, and policed
 * separately as an entity and an emoji shortcode. Everything absent — `_`, `[`, `]`, `<`, `>`, `|`,
 * `\`, `{`, `}`, a stray backtick, `²`, `×`, an emoji — is refused **outside a code span**; inside
 * one, {@link CODE_SPAN_PERMITTED} applies instead, because there the content is literal. Measured
 * across every `spec/` heading both lists cost the corpus nothing. Some refusals are harmless —
 * `## Time 10:30:00` trips the shortcode rule though both readers slug it identically — though that
 * same rule catches `:+1:`, which is *not* harmless — and that is the deliberate price of lists the
 * next construct cannot defeat.
 */
const HEADING_PERMITTED = /[A-Za-z0-9 \t\-,.;:!?'"()/+=%@$#*~^&—–…]/;

/**
 * The characters a **code span's content** may contain.
 *
 * A span's content is literal, so the markdown ambiguities that force `_`, `[` and `<` out of
 * {@link HEADING_PERMITTED} do not apply — `` `set_xy` `` must keep working. What *does* still apply
 * is the character-class difference between {@link headingSlug} and `github-slugger`, and checking
 * only outside spans left it wide open: `` ## Area in `m²` `` slugged to `area-in-m²` here and
 * `area-in-m` there, so `#area-in-m²` passed and 404'd — the same `²` the permit-list was written to
 * catch, one backtick away. `spec/` headings are *predominantly* code spans, so that exemption
 * covered the dominant shape.
 *
 * Every **ASCII** character agrees inside a span: both sides keep letters, digits, `-`, `_` and
 * space, and both delete all other ASCII punctuation. So this admits ASCII plus the three non-ASCII
 * punctuation marks checked against the real slugger class — which is what keeps the live
 * `` `set … to` ``-shaped headings in `spec/commands.md` green.
 */
const CODE_SPAN_PERMITTED = /[\x20-\x7E\t—–…]/;

/** A complete HTML entity, which renders as one character this reader would spell out. */
const HTML_ENTITY = /&(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9A-Fa-f]+);/;

/** A GFM emoji shortcode, which GitHub replaces with a character the slug rule then deletes. */
const EMOJI_SHORTCODE = /:[a-z0-9+_-]+:/;

/**
 * Strip every leading blockquote and list-item marker, returning the content inside them, or `null`
 * when the line opens no container.
 *
 * Containers nest arbitrarily — `> 1. # Nested` and `- 1. # Nested` are both an `<h1>` on GitHub —
 * so this loops rather than encoding one marker in one position, which is how a pattern that handled
 * `> ## X` and `- ## X` still missed both of those, and a blockquoted setext rule as well.
 */
export function containerContent(line) {
  let rest = line;
  let stripped = false;
  for (;;) {
    // The FIRST marker may be indented at most three spaces. Four is an indented code block, and
    // stripping through it let `    > ``` ` — code, on GitHub — be read as a fence opener, which then
    // swallowed a real heading below it.
    const marker = (
      stripped
        ? /^[ \t]*(?:>|[-*+][ \t]+|\d+[.)][ \t]+)/
        : /^ {0,3}(?:>|[-*+][ \t]+|\d+[.)][ \t]+)/
    ).exec(rest);
    if (marker === null) {
      break;
    }
    rest = rest.slice(marker[0].length);
    stripped = true;
  }
  return stripped ? rest : null;
}

/**
 * Advance fenced-block state across one **raw** line, or `null` when the line is not a fence
 * delimiter at all.
 *
 * **One scanner, two callers, and the container decision lives here.** {@link documentHeadings} and
 * {@link unsupportedConstructs} both need this, and when each kept its own copy they drifted the
 * moment one was fixed. Letting the callers pre-strip containers was the same mistake one level up:
 * whether a container marker is syntax or code depends on the fence state, which only this function
 * knows, so it takes the raw line and decides.
 *
 * The rule is that **inside a fence, content is literal**. `> ``` ` on a line of a top-level fenced
 * block is code, not a closer; stripping the `>` first turned it into one and published a heading
 * from the code below it. Outside a fence, a container's own opener is found by stripping the
 * container — and such a fence is reported by the canary, because neither reader can follow where a
 * container-scoped block ends.
 *
 * That this is the third rule to be extracted here — after the mention pattern's group numbering and
 * code-span pairing — is the reason for the standing rule in the module note: **any rule both readers
 * consult belongs in a single function.**
 */
function advanceFence(fence, line) {
  const inside = containerContent(line);
  const content = fence === null ? (inside ?? line) : line;
  const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
  if (delimiter === null) {
    return null;
  }
  const marker = delimiter[1][0];
  if (fence === null) {
    // A backtick opener may not carry a backtick in its info string; a tilde opener may.
    const opens = marker === "~" || !delimiter[2].includes("`");
    return {
      fence: opens ? { marker, length: delimiter[1].length } : null,
      openedInContainer: opens && inside !== null,
    };
  }
  const closes =
    marker === fence.marker &&
    delimiter[1].length >= fence.length &&
    delimiter[2].trim() === "";
  return { fence: closes ? null : fence, openedInContainer: false };
}

/**
 * Markdown in a document that this reader cannot prove it reproduces — the **canary**.
 *
 * It is what lets the gate claim an anchor proves a heading exists. The slug rule works on a
 * heading's markdown source; that equals its rendered text for the constructs this corpus uses, but
 * a markdown **link**, an HTML **entity** and inline **HTML** render differently, an HTML **block**
 * can hide an ATX line GitHub never publishes, a **setext** heading is not collected at all, and a
 * heading nested in a blockquote or list item is published by GitHub and invisible here. Each is a
 * **quiet** divergence: the reader invents a slug GitHub does not publish, and an anchor naming the
 * invented slug **passes here and 404s there**.
 *
 * **It is a permit-list, and that is the whole design.** Earlier attempts enumerated the
 * *unsupported* constructs, and reviewers defeated each of them — `</div>` and `<![CDATA[` and
 * `<?xml` open HTML blocks that `<!--`-and-`<letter` never matched; `&#x26;` is an entity that
 * `&#\d+;` never matched; `## See [a [b]](target)` is a link whose label the link pattern never
 * matched; `_` emphasis carries no flagged character at all. Enumerating an open-ended grammar loses
 * by one construct at a time, and each miss is a false pass. So this asks the opposite question —
 * *is every part of this document drawn from the small subset I can prove I slug identically?* — and
 * refuses everything else. Over-refusing is loud and costs a spec edit; under-refusing is silent and
 * costs a wrong citation.
 *
 * The cost is real and worth stating: until issue #1190 replaces this reader with a CommonMark parse,
 * `spec/` cannot adopt a `<details>` block, a linked or emphasised heading, a setext heading, or a
 * fenced block inside a list item without turning the gate red. `spec/**` is CODEOWNERS-gated and the
 * failure message names the alternatives, so that trade is deliberate rather than an accident.
 */
export function unsupportedConstructs(lines) {
  const found = [];
  let fence = null;
  let previousWasBlank = true;
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, "");
    // Container stripping comes FIRST, so a fence inside a blockquote or list item is recognised as
    // a fence. Detecting fences on the raw line left `> ```markdown` untracked, and then reported
    // the perfectly safe heading inside it as a nested one.
    const inside = containerContent(line);
    const content = inside ?? line;
    const transition = advanceFence(fence, line);
    if (transition !== null) {
      // Neither reader can follow where a container-scoped fenced block ends: CommonMark closes it
      // when the container does, and both readers here track one flat fence state. So the document
      // is refused rather than answered — `spec/` has none, so it costs nothing today.
      if (transition.openedInContainer) {
        found.push({
          line: index + 1,
          construct: "a fenced block opened inside a blockquote or list item",
        });
      }
      fence = transition.fence;
      previousWasBlank = false;
      continue;
    }
    if (fence !== null) {
      previousWasBlank = false;
      continue;
    }
    const report = (construct) => found.push({ line: index + 1, construct });

    // Any line opening with `<` — a tag, a closing tag, a comment, a declaration, a processing
    // instruction, CDATA, even an autolink. Deciding which of those starts an HTML block is the
    // enumeration this design refuses to attempt. There is no inline-context exemption, so a
    // paragraph *beginning* with a bare `<place>` is refused where `` `<place>` `` is not.
    if (/^ {0,3}</.test(content)) {
      report("a line starting with `<`, which may open a raw-HTML block");
    }
    // A `===`/`---` rule is a setext heading unless a blank line makes it a thematic break. Anything
    // else — after a paragraph, a list item, a table row, an indented code block — is refused rather
    // than classified, because classifying it is the same open-ended parse.
    if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(content) && !previousWasBlank) {
      report("a `=`/`-` rule that may be a setext heading");
    }
    const heading = /^ {0,3}#{1,6}[ \t]+(.*)$/.exec(content);
    // GitHub publishes a heading nested in a blockquote or list item; this reader cannot see it, so
    // every later duplicate suffix in the document shifts.
    if (heading !== null && inside !== null) {
      report("a heading nested in a blockquote or list item");
    }
    // The same thing where `containerContent` deliberately stops: an indent of four spaces OR a tab
    // is either an indented code block or a nested list and this reader cannot tell which, so a
    // heading reachable through it is refused rather than guessed at. The tab half matters because
    // markdown is outside `format:check` entirely (`.prettierignore` excludes `spec/`, `docs/`,
    // `.github/` and `*.md`), so nothing else in CI would ever normalise it away.
    if (/^(?: {4,}|\t)[ \t>*+\-\d.)]*#{1,6}[ \t]/.test(line)) {
      report("an indented line that may be a heading inside a nested list");
    }
    if (heading !== null && inside === null) {
      // A padded code span is checked on the RAW heading, before stripping makes it invisible.
      if (hasPaddedCodeSpan(heading[1])) {
        report(
          "a code span CommonMark trims, which this reader slugs with the padding still on",
        );
      }
      // A span's content is literal, so it gets the in-span list; everything else gets the
      // markdown-aware one. Checking only outside spans left `` `m²` `` — the very character the
      // permit-list exists for — passing, and `spec/` headings are mostly code spans.
      const offendingInSpan = codeSpans(heading[1])
        .flatMap(({ content: span }) => [...span])
        .find((character) => !CODE_SPAN_PERMITTED.test(character));
      if (offendingInSpan !== undefined) {
        report(
          "a code-span character this reader cannot prove it slugs the way GitHub does " +
            `(${JSON.stringify(offendingInSpan)})`,
        );
      }
      const bare = stripCodeSpans(heading[1]);
      const offender = [...bare].find(
        (character) => !HEADING_PERMITTED.test(character),
      );
      if (offender !== undefined) {
        report(
          "a heading character this reader cannot prove it slugs the way GitHub does " +
            `(${JSON.stringify(offender)})`,
        );
      }
      if (HTML_ENTITY.test(bare)) {
        report("an HTML entity in a heading");
      }
      if (EMOJI_SHORTCODE.test(bare)) {
        report("an emoji shortcode in a heading");
      }
    }
    previousWasBlank = content.trim() === "";
  }
  return found;
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
        `${specDirectory}/${file}:${line}: this document contains ${construct}, which this gate's heading ` +
          "reader cannot follow — so an anchor into it could name a heading GitHub never publishes, or " +
          "miss one it does. Remove the construct, or cite this document by line instead; issue #1190 " +
          "tracks replacing the reader with a CommonMark parse",
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
      "citation written without the spec-directory prefix is not seen at all, and a cited document " +
      "using markdown this reader cannot follow fails rather than being answered on a slug it is not " +
      "entitled to compute. Do not read a green run as 'every citation is right'.",
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

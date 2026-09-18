/**
 * Logic module for the **spec-citation** Definition-of-Done gate (issue #934). Extracted so tests
 * can import it directly for 100% coverage, keeping `scripts/check-spec-citations.mjs` a thin CLI
 * shell — the same shape `scripts/markdown-examples-gate.mjs` + `scripts/check-markdown-examples.mjs`
 * and `scripts/harness/index.mjs` + `scripts/conformance.mjs` already have. A CLI shell is exercised
 * through a subprocess, so it stays outside the loaded-module coverage set
 * `docs/adr/0009-test-layout.md` defines.
 *
 * **Why this exists.** Over two thousand `<spec-dir>/<file>.md:<line>` citations were hand-written
 * into code comments, tests, fixture prose, and docs. They are the mechanism binding the
 * implementation to the normative contract — and until this gate, **nothing in the repository
 * checked a single one**. When a spec file gained or lost a line, every citation below it silently
 * became wrong; issue #846 shifted 113 of them across 68 files in one edit, and #885 merged green
 * carrying ten citations that pointed at the wrong lines. Saga #1180 removed the form itself: a
 * citation now names a **section**, and this gate rejects one that names a line.
 *
 * ## What this gate does and does not cover — read this before trusting a green run
 *
 * A stale citation fails in four distinguishable ways, and only two of them are mechanically
 * detectable without understanding the prose:
 *
 * 1. **It does not resolve** — the file is missing, or nothing in it publishes the heading named.
 *    **COVERED** ({@link resolveAnchor}). The line form's version of this question — is the cited
 *    line still inside the file, and does it still hold text — is **gone rather than covered**:
 *    naming a line is now the defect, so the gate rejects the citation instead of resolving it.
 * 2. **It resolves, but points at the wrong passage, and the prose paraphrases rather than quotes.**
 *    **NOT COVERED**, except in the one shape that is mechanically checkable: a citing site that
 *    **quotes an EBNF production** must cite a section containing it ({@link auditRunQuotations}).
 *    Paraphrase is invisible here — deciding whether a section that resolves supports "a step of `0`
 *    never reaches `end`" requires reading both, which no offline gate can do.
 * 3. **The section is right and the prose beside it misstates what that section says.** **NOT COVERED.**
 * 4. **A stale implementation-status claim** — "not yet implemented", "a later slice will…". This is
 *    not a claim about the spec at all; it is a claim about the repository's own state, which rots
 *    when the state changes. **PARTIALLY COVERED** ({@link collectStatusClaims}): every such claim
 *    must name a tracking issue, so it is at least re-checkable. Whether that issue is still open is
 *    deliberately not consulted — a DoD gate must run offline and deterministically.
 *
 * The gate prints this coverage statement on **every run**, because a green gate that is quietly
 * narrower than it looks is the exact defect epic #901 exists to remove — and it would be this gate
 * committing it.
 *
 * ## Enumeration is exhaustive, not separator-driven
 *
 * Citations are not written in one shape. They are joined by commas, by line wraps, by slashes, and
 * by whole clauses of prose; a separator regex would miss a form and quietly under-report. Three
 * separately-written tokenizers gave three different counts of the same corpus before hand-derivation
 * settled it (PRs #942 and #949). **A separator regex is not a completeness argument**, so
 * {@link collectCitations} instead enumerates **every** bare `:N` in a citing file, and there is
 * exactly one disposition for it:
 *
 * - **bare** — a colon-and-number in a file that names a specification document is a citation and is
 *   rejected. No document is ever **selected** for it: it carries the sorted set of every document
 *   its file names, and only the *size* of that set decides how the rejection reads. Naming several,
 *   the rejection quotes the token back with **no document name on it**, **lists them all** and
 *   suggests no section, because picking one would invent an answer. Naming exactly one, there is
 *   nothing to pick between: the rejection renders the citation in the canonical
 *   `<spec-dir>/<file>.md:<line>` form and names the section to write instead, which is the same
 *   fully specific remediation an explicit citation receives.
 *
 * It used to choose, through a back-reference map and a nearest-preceding-mention fallback, and
 * report a separate `unattributed` failure when both missed. Four consecutive review rounds each
 * fixed a real defect in that machinery and introduced the next; the measurement that ended it is
 * that **none of it could change a verdict** — both dispositions always failed, so attribution only
 * ever selected the wording. It is deleted, and with it every ordering question that produced those
 * regressions.
 *
 * In JavaScript and TypeScript sources a bare `:N` is enumerated **wherever it appears**, including
 * inside a string literal. What keeps that safe without knowing the language is not position but two
 * structural rules: {@link BARE_REFERENCE}'s lookbehind, which excludes a colon preceded by a word
 * character, a digit, a `/`, or the closer of a template substitution — so an object literal, a
 * tight ternary, a URL port and every interpolated form are never offered as citations — and the
 * requirement that the file **name a specification document at all**, since a file naming none
 * contains numbers rather than citations. An earlier version required a comment line as well, and
 * that hid four real citations inside template strings. Read {@link BARE_REFERENCE}'s own note for
 * what the lookbehind does NOT exclude: the list there is illustrative, and an index closer is
 * deliberately not among the exclusions.
 *
 * ## No automatic tolerance, and nowhere to record an exception
 *
 * The gate never searches nearby lines and passes. Issue #893's reviewers deleted exactly that,
 * because tolerance is indistinguishable from the defect a gate exists to catch — and here the wrong
 * passage is usually *adjacent* to the right one, so proximity is evidence of nothing.
 *
 * A citation this gate cannot accept **fails**. There is no second disposition: saga #1180 deleted
 * the exceptions manifest, its fingerprinting, and the `UNRESOLVED` counter that let a green run
 * carry a list of known-wrong citations, along with the 84 entries it held. A manifest is a list that
 * must grow to stay useful, and a growing list of excused sites is an exemption — the one shape this
 * saga set out to remove. The only thing resembling a carve-out that survives is a **scope**
 * ({@link STATUS_CLAIM_EXEMPT_PREFIX}), which names a principle rather than a set of sites, needs no
 * maintenance, and is printed in the coverage statement on every run.
 *
 * ## Section anchors, and the slug rule written down
 *
 * A **section anchor** (`<file>.md#a-heading`) names a heading rather than a line, so ordinary edits
 * above it do not move it — which is why saga #1180 makes it the **only** accepted form. It was
 * previously enumerated as a mention and never resolved, so a renamed or misspelled heading passed
 * unseen; an unchecked *mandatory* form is worse than the fragile one it replaces, so issue #1181
 * resolves it:
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
 * itself. What survives in {@link unsupportedConstructs} is four **conservative refusals** — an
 * entity reference this reader does not decode, raw inline HTML, an emoji shortcode shape, and a
 * numeric reference whose digit count CommonMark and GitHub's renderer disagree about — and the
 * live-corpus test keeps the cited documents' freedom from all four measured rather than asserted.
 *
 * A fragment of the form `#L30` or `#L28-L84` is GitHub's **line fragment**, not a heading: it names
 * lines, so under the anchor-only rule it is rejected on sight rather than resolved against the
 * file's length. Whether the lines it names still hold text is beside the point — naming lines at
 * all is the drift #1180 removed. A heading slug is lowercased at step 1 and so can never begin with
 * an uppercase `L`, which is what makes the two forms distinguishable without guessing.
 *
 * ## Known blind spots, stated rather than hidden
 *
 * Every citation is found by the literal `<spec-dir>/` prefix **except** the prefix-less forms, which
 * {@link PREFIX_LESS_REFERENCE} enumerates — the line form rejected like any other line claim, the
 * anchor form reported as unresolvable — both wherever they appear, in prose and in code alike. A
 * relative path carrying no `<spec-dir>/` segment at all is still invisible: `docs/adr/0029-…md`
 * records that blind spot. Inside the specification directory a relative anchor is the normal way
 * one document links to a sibling, so it is deliberately left alone rather than adjudicated by a
 * gate that must never edit a maintainer-owned directory. Write the prefix anyway: outside `spec/`,
 * an unprefixed anchor is checked by nothing at all.
 *
 * `roots` narrows the scan to a filesystem walk instead of the tracked set, and narrowing what an
 * instrument looks at while its report still reads as authoritative is the recurring defect of this
 * saga. It does **not** narrow what the gate rejects: the rule is applied per citation, not per
 * scope, so a line citation inside a rooted scan fails exactly as it does in CI. That is pinned by
 * tests rather than assumed, because "the stricter rule obviously cannot be bypassed" is precisely
 * the assumption that produced the earlier `--root=.` defect. One asymmetry is worth knowing:
 * {@link STATUS_CLAIM_EXEMPT_PREFIX} is repository-relative, so a root outside the repository never
 * matches it and a rooted run is **stricter** there, never more permissive.
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
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import GithubSlugger from "github-slugger";
import { marked } from "marked";

/** Directory holding the normative specification, relative to the repository root. */
export const SPEC_DIRECTORY = "spec";

/**
 * Files the scan skips — **none**, and there is no mechanism by which that could change.
 *
 * The exceptions manifest used to be skipped here, because every entry quoted the citation it
 * excused and scanning it made the gate re-discover its own exception list. Saga #1180 deleted the
 * manifest, which left this list empty and the parameter that applied it without a caller — an
 * option that can quietly narrow what a gate checks while its report still reads as authoritative,
 * which is this saga's most repeated defect. So the option is gone too, and "nothing is excluded" is
 * now asserted by the absence of any way to exclude something rather than by an empty list somebody
 * could fill in.
 *
 * Nothing is excluded **including this module and its own tests** — a gate that exempts itself from
 * the rule it enforces asserts less than it appears to. Test fixtures therefore name a `contract/`
 * directory rather than `spec/`, so a deliberately-broken fixture citation cannot masquerade as a
 * real one.
 */

/**
 * Where a forward-looking status claim is **not** required to name a tracking issue.
 *
 * An Accepted ADR is immutable except for its cross-link and status lines (ADR-0000), so a claim
 * inside one cannot be edited to name an issue — and a gate must never require the impossible. The
 * deeper reason is that the demand does not apply: an ADR is a frozen record of a decision, so a
 * forward-looking phrase in one describes the world *at the time of that decision* rather than
 * pending work, and it cannot rot the way a live claim does.
 *
 * This is a **scoping rule, not an exemption**: it names a principle rather than a list of sites, it
 * needs no maintenance, and it self-applies to every ADR written from here on. The distinction is
 * the one the exceptions manifest failed — a list that must grow is an exemption. The scope is
 * printed in the coverage statement on every run, because a gate quietly narrower than it appears is
 * the defect this saga exists to remove.
 */
export const STATUS_CLAIM_EXEMPT_PREFIX = "docs/adr/";

/** Directory names the filesystem walk never descends into. */
const UNWALKED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
]);

/** Extensions whose lines are treated as prose only when they are comments (see {@link isProseLine}). */
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

/**
 * Every `.md` document the specification directory publishes, or an empty set when that directory is
 * not there.
 *
 * This is what makes the prefix-less form enumerable as a **rule** rather than a list: a bare
 * `<file>.md:213` is a citation because that document is a real one, and a bare `notes.md:4` is not
 * because no such document exists. Read from the filesystem, so it needs no maintenance and cannot
 * drift from the corpus it describes.
 *
 * Exported and shared with the converter rather than written twice. The two modules keep their
 * deliberately different **site-finding** — the gate sweeps a document, the converter works per
 * line, and that independence has caught real defects — but which documents exist is not a
 * judgement either of them should make separately, because disagreeing about it would make one
 * sweep enumerate a citation the other could not see.
 */
export function specDocuments(root) {
  return new Set(
    existsSync(root)
      ? readdirSync(root).filter((entry) => entry.endsWith(".md"))
      : [],
  );
}

/**
 * The specification documents whose **basename is unique in the repository**, which is the set a
 * prefix-less reference may safely be attributed to.
 *
 * A document published only under the specification directory can only mean that document when cited bare.
 * A `README` exists at the repository root and in most packages, so citing one bare is
 * far more likely to mean a neighbour than `spec/README.md` — and attributing it to the
 * specification would be the gate inventing a citation the author did not write. Rejecting an
 * ambiguous basename is not a carve-out list: it is a property of the tree, recomputed on every run,
 * and it shrinks by itself if a colliding file is deleted.
 *
 * This is what makes it safe to reject the relative form outside `spec/` at all. Without it, closing
 * that blind spot would have meant failing every `README.md#…` cross-link in the instruction files.
 */
export function unambiguousSpecDocuments(root, trackedFiles) {
  const published = specDocuments(root);
  const elsewhere = new Set();
  // Compared through the FILESYSTEM's own idea of identity, not string equality. `root` may be
  // absolute (a `--spec-root` override) while `git ls-files` reports repository-relative paths, and
  // on Windows the same directory can be spelled with a lowercase drive letter, a different-cased
  // segment, or reached through a junction. Any of those made every specification document look
  // like a collision, which emptied the oracle and switched the whole prefix-less rule off under a
  // perfectly valid configuration.
  const canonical = (path) => {
    try {
      return realpathSync.native(path).toLowerCase();
    } catch {
      return resolve(path).toLowerCase();
    }
  };
  const specRootPath = canonical(root);
  for (const file of trackedFiles) {
    const path = toPosixPath(file);
    const basename = path.slice(path.lastIndexOf("/") + 1);
    if (!published.has(basename)) {
      continue;
    }
    const directory = canonical(resolve(file, ".."));
    if (directory !== specRootPath) {
      elsewhere.add(basename);
    }
  }
  return new Set([...published].filter((name) => !elsewhere.has(name)));
}

/** Convert a native path to the `/`-separated form used on every platform. */
export function toPosixPath(path) {
  return path.split(sep).join("/");
}

/**
 * Split `text` into lines on `\n` alone.
 *
 * A `\r` left by a CRLF checkout stays on the end of the line, where it is whitespace and cannot
 * change a blank-line test — whereas splitting on `/\r?\n/` and then measuring byte offsets against
 * the original text drifts one byte per line, which silently reports every citation in a CRLF
 * working tree on the wrong line. This repository sets `core.autocrlf=true` on Windows, so that is
 * not hypothetical.
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
 * Whether `line` in a file named `path` is **prose**.
 *
 * This no longer gates whether a citation is enumerated — every form is now found in code as well as
 * prose. What it still does is bound a **prose run**: grouping merely contiguous non-blank lines in
 * a source file would swallow a whole blank-line-free function body, pairing a production quoted in
 * one comment with a citation written in another twenty lines away. So it defines where a *claim*
 * begins and ends, not where a citation may be written.
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
 * One character a heading slug may contain — exported so a test can sweep it against the slugger.
 *
 * `-` is last so it is a literal rather than a range. `\p{Pc}` already contains `_`.
 */
export const SLUG_CHARACTER = "[\\p{L}\\p{N}\\p{M}\\p{Pc}\\p{So}-]";

/**
 * Build the regex matching `<specDirectory>/<file>.md` with an optional line spec and an optional
 * `#fragment`.
 *
 * The fragment is captured as group 5 — appended rather than inserted — so the line-spec groups keep
 * the numbers they had before issue #1181 and every existing reader of this pattern is unaffected.
 *
 * The fragment class matches what a slug can **contain**, and that set is not obvious: besides letters,
 * digits and `-`, `github-slugger` preserves **combining marks** (`\p{M}`), **connector punctuation**
 * (`\p{Pc}`, which is where `_` itself lives) and **other symbols** (`\p{So}` — circled letters,
 * emoji). Leaving any of them out does not merely narrow the gate, it **manufactures failures**: a
 * decomposed `## Café` publishes a slug ending in U+0301, and GitHub really does publish anchors
 * containing U+203F, so the citation to one truncated mid-slug and was reported malformed — a defect
 * invented by the tokenizer rather than found in the document. The class is an exhaustively verified
 * **superset**: a test sweeps every Unicode code point through the shipped slugger and asserts that
 * none it preserves falls outside, which is an oracle the library owns rather than a rule restated
 * here. Being a superset is safe in the direction that matters: resolution compares the whole fragment
 * against a real slug, so a symbol the slugger would have dropped simply fails to match — loudly, as
 * everything here does. It is not free, though, and the cost is worth naming: a `\p{So}` character
 * **abutting** a citation in prose is absorbed into the fragment rather than terminating it, so
 * `…#a-heading© 2026` yields `a-heading©` and fails. That is a manufactured failure of the same kind,
 * arriving from the opposite side — accepted deliberately, because it is loud, no instance exists in
 * the corpus, and every ordinary delimiter (whitespace, `.` `,` `;` `:` `)` `]` `"` `'` `|` `—` `…`
 * `/` `%`) is outside the class and still ends a fragment.
 *
 * It is `*` rather than `+` on purpose: a `#` with nothing after it is enumerated as an **empty**
 * fragment and fails, instead of falling through as a plain file mention. That shape is a real defect
 * — an anchor hard-wrapped immediately after its `#` — and matching `+` made the one live instance in
 * this tree invisible to the very check meant to catch it.
 */
/**
 * A **prefix-less** reference to a specification document — `<file>.md:213`, written without the
 * `<spec-dir>/` prefix that every other form in this module carries.
 *
 * This form was invisible to the gate until saga #1180 finished, and invisibility is the whole
 * problem: the rejection of the line form could be honestly described as exhaustive only over the
 * shapes the gate enumerated, so a prefix-less line number was a hole the corpus would refill.
 * Measured before it was closed, the two prefix-less forms were distributed **oppositely** — every
 * prefix-less *line* reference sat outside `spec/`, while prefix-less *anchors* sat almost entirely
 * inside it, where one specification document referring to a sibling relatively is the normal and
 * correct way to write a link.
 *
 * So this pattern matches **both** forms, and what differs is the disposition. A prefix-less LINE
 * reference is rejected wherever it appears. A prefix-less ANCHOR is rejected **outside** the
 * specification directory, where nothing would otherwise resolve it, and **inside** it is left
 * unreported — but still recorded as a mention, because it names a document, and a bare line claim
 * anywhere in the file is listed against every document the file names.
 *
 * Two guards keep it from firing on text that is not a citation, and both are rules rather than
 * lists. The document must **actually exist** in the specification directory, so `readme.md:10` or a
 * stray `notes.md:4` is not silently adopted — and the filename class admits an initial capital,
 * because `spec/README.md` is a real document the oracle publishes and a class that could not match
 * it would be a blind spot shared by both instruments.
 *
 * **The LINE form is counted wherever it appears, including inside a string literal in live code.**
 * It used to require a prose line, on the argument that dropping the guard would catch fixture data
 * along with real citations. That argument was wrong in the way that matters: the form is banned
 * outright, two real citations had already been written in `test(…)` titles where the gate could not
 * see them, and a hole disclosed in a coverage statement is still a hole. The cost is real and is
 * named rather than hidden — test data mirroring this gate's own `document:line:form` output trips
 * it when the document is one the specification publishes. The remedy is to name fixtures after
 * documents the specification does **not** publish, which this gate's own suite now does.
 *
 * The unprefixed **anchor** half carries no prose guard either. Both halves are governed by the
 * document-identity rule above — the name must be one the specification publishes, and its basename
 * must be unambiguous repository-wide — never by where the token sits.
 *
 * **The fragment class is `SLUG_CHARACTER`, the same contract the prefixed pattern uses, and `*`
 * rather than `+`.** It was hand-written as a narrower class and a `+`, which meant a fragment using
 * a symbol outside that narrower class was invisible unprefixed while the prefixed spelling caught
 * it, and an empty fragment was invisible here while the prefixed pattern already collected it — so
 * the same citation was enforced or ignored depending on how it was written. Deriving both from one
 * exported constant is what stops the two spellings drifting apart again; it is the same reason the
 * slug alphabet is exported at all.
 */
const PREFIX_LESS_REFERENCE = new RegExp(
  `(?<![A-Za-z0-9._/#-])([A-Za-z][A-Za-z0-9-]*\\.md)(?::(\\d+)(?:-(\\d+))?((?:,\\d+(?:-\\d+)?)+)?|#(${SLUG_CHARACTER}*))`,
  "gu",
);

function mentionPattern(specDirectory) {
  const token = specDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    // The lookbehind rejects a DOUBLED prefix. Without it `<dir>/<dir>/x.md#y` fails to match at the
    // first `spec/`, the scan resumes one character later, and the inner `<dir>/x.md#y` is enumerated
    // as a perfectly good citation — so a path that resolves nowhere passed the gate. A blanket
    // search-and-replace produced exactly that, and the gate could not see what the replace had
    // done. A RELATIVE path (`../../<dir>/x.md`) is deliberately still matched: it names a real
    // document and resolving it is better than ignoring it.
    `(?<!${token}\\/)${token}\\/([A-Za-z0-9._-]+\\.md)(?::(\\d+)(?:-(\\d+))?((?:,\\d+(?:-\\d+)?)+)?)?(?:#(${SLUG_CHARACTER}*))?`,
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
 *
 * Punctuation may also be closed by a **quote**, but only where the quote genuinely ends a string:
 * `"… see <dir>/<file>.md#a-heading."` is a sentence inside a JSON string, and the `.` is prose. A
 * markdown link **title** puts a quote in the same position without ending anything —
 * `[t](x.md#frag."Title")` — so the rule looks one character further: the quote must itself be
 * followed by end-of-input, whitespace, or a token closer. `."}`, `.",` and `."` at end of line are
 * accepted; `."Title")` is not, because a letter follows the quote.
 *
 * The **spaced** title spelling `[t](x.md#frag. "Title")` is NOT rejected, and that is a measured
 * decision rather than an oversight. Punctuation, a space and then a quote is also the corpus's
 * ordinary cite-then-quote idiom — `…#numbers-and-math: "OpenLogo never exposes NaN…"` — which
 * occurs in live prose and is perfectly correct. Rejecting the spelling would fail those sites, and
 * a false positive is fatal in a gate with no tolerance, so the rarer malformed shape is the one
 * left through. Telling them apart needs to know whether the citation sits in a link destination,
 * which is the destination parsing two reviewers deleted after defeating it twice.
 *
 * A closing **bracket** is never admitted after punctuation, because a markdown link destination
 * runs to its `)` and the `.` really does belong to the fragment; that is the asymmetry which makes
 * `[bad](x.md#a-heading.)` fail without this module ever parsing a link destination.
 */
const FRAGMENT_BOUNDARY =
  /^(?:[\s`'"“”‘’)\]}>|]|$)|^[.,:;!?*~+=…—–]+(?:\s|["'](?:[\s)\]},;]|$)|$)/u;

/**
 * GitHub's **line fragment** (`#L30`, `#L28-L84`), which names lines rather than a heading.
 *
 * A heading slug is lowercased by `github-slugger`, so it can never begin with an uppercase
 * `L` followed by digits. That is what lets the two fragment forms be told apart structurally instead
 * of guessed at, and it is why this pattern is anchored and case-sensitive.
 */
const LINE_FRAGMENT = /^L(\d+)(?:-L(\d+))?$/;

/**
 * The slug of the heading enclosing `line` — the last one at or above it — or `null` when the line
 * precedes every heading in the document.
 *
 * Used only to tell an author what to write instead of the line citation they wrote. That is worth
 * saying plainly: this is a **suggestion in a failure message**, never a repair. A gate that quietly
 * accepted the line it could have converted would be the tolerance issue #893's reviewers deleted.
 */
export function enclosingSlug(headings, line) {
  let found = null;
  for (const heading of headings) {
    if (heading.line > line) {
      break;
    }
    found = heading;
  }
  return found === null || found.slug === "" ? null : found.slug;
}

/**
 * The 1-based inclusive line range one section covers: from its heading to the line before the next
 * heading, or to the end of the document for the last section.
 *
 * This is what the quotation check measures against now that citations name sections rather than
 * line ranges. It deliberately spans *nested* subsections too — a quotation inside a sub-heading of
 * the cited section is inside the section as a reader understands it, and narrowing to the next
 * heading of any level would manufacture failures for accurate quotations.
 */
export function sectionRange(headings, slug, lineCount) {
  const index = headings.findIndex((heading) => heading.slug === slug);
  if (index === -1) {
    return null;
  }
  const depth = headings[index].depth;
  let end = lineCount;
  for (const heading of headings.slice(index + 1)) {
    if (heading.depth <= depth) {
      end = heading.line - 1;
      break;
    }
  }
  return { start: headings[index].line, end };
}

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
          // The `#` level, which is what makes a section's extent decidable: a section runs until
          // the next heading at its own level or shallower. Omitting it did not fail loudly — it
          // made every comparison in {@link sectionRange} `undefined <= undefined`, so every section
          // silently ran to end-of-file and the quotation check accepted a production quoted
          // anywhere BELOW the cited heading. An instrument reporting less than it claims, found by
          // the first test that pinned a range's end rather than only its start.
          depth: token.depth,
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
 *
 * Internal: it is exercised through {@link documentHeadings}, which is the only thing a slug may be
 * computed from. Exporting it would invite a caller to slug a heading the hazard check never saw.
 */
function renderedText(tokens) {
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
 * The two numeric-reference grammars, kept apart and **bounded**.
 *
 * Writing them as one `#[xX]?[0-9a-fA-F]+` makes the `x` optional over a hex digit class, so a
 * malformed *decimal* reference carrying `A`-`F` is accepted as a number: `&#12A;` decoded as 12 and
 * slugged `a--b` where GitHub renders it literally and publishes `a-12a-b`, and `&#AB;` reached
 * `String.fromCodePoint(NaN)` and **crashed the gate**.
 *
 * Length is part of the grammar too, and leaving it unbounded was the same defect one step further
 * out: CommonMark admits **1-7 decimal digits** or **1-6 hexadecimal digits**, so
 * `&#0000000000000065;` is not a reference at all. Decoding it to `A` published `a-a-b` where GitHub
 * publishes `a-0000000000000065-b`. That bound is CommonMark's, and both reference implementations
 * follow it — but **GitHub's renderer does not**, which is what {@link DISPUTED_REFERENCE} exists for.
 *
 * They are built from one place because the grammar is used three times and drift between the copies
 * is what makes that kind of hole reappear. This is a **source string**, not a shared `RegExp`, so no
 * call site can inherit another's `lastIndex`.
 */
const NUMERIC_REFERENCE = "#(?:[0-9]{1,7}|[xX][0-9a-fA-F]{1,6})";

/**
 * Numeric references whose length falls where this reader's oracles **disagree**, so it refuses.
 *
 * CommonMark 0.31.2 states 1-7 decimal or 1-6 hexadecimal digits, and both reference implementations
 * agree: `marked` escapes a longer run, and the `commonmark` package leaves it literal. But GitHub's
 * own Markdown API — measured independently by two reviewers on 2026-09-16 — decodes up to **8**
 * digits in *both* forms, rendering 9 or more literally. GitHub's renderer is what publishes the
 * anchor this gate has to predict, so the two answers differ on exactly two spans: **8 decimal
 * digits**, and **7 or 8 hexadecimal digits**. Nine or more is literal under every oracle.
 *
 * A gate cannot be right about a slug its oracles disagree on, so it declines to answer, exactly as
 * it does for the other three divergences. That keeps the alternative — silently publishing one
 * oracle's slug and 404ing under the other — off the table. No heading in the corpus contains one.
 * Issue #1193 tracks establishing the bound from cmark-gfm's own digit cap: the date above is on a
 * live service, so it records what was observed rather than what is guaranteed.
 */
const DISPUTED_REFERENCE = /&#(?:[0-9]{8}|[xX][0-9a-fA-F]{7,8});/;

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
 * Anything that is not one of the two grammars is left exactly as written. GitHub agrees for most of
 * it, but **not for {@link DISPUTED_REFERENCE}** — the digit lengths it decodes and CommonMark does
 * not. Those never reach a slug that could be trusted: {@link headingHazards} refuses the document
 * first, which is the only reason this function may leave them alone without being wrong.
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

/** A GFM emoji shortcode **shape**, which GitHub replaces whenever it names a known emoji. */
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
 * Four things survive the parse. All four are **conservative refusals**, and the distinction
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
 * - **An emoji shortcode shape**, which GitHub replaces whenever it names a known emoji and which
 *   `marked` does not implement at all.
 * - **A numeric reference of disputed length** — see {@link DISPUTED_REFERENCE}. CommonMark and both
 *   reference implementations say 8 decimal or 7-8 hexadecimal digits is not a reference; GitHub's
 *   own renderer decodes it. Refusing is the only answer that is not one oracle's guess.
 *
 * All four are refused rather than guessed at, which keeps ADR-0035's claim true: where `marked` and
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
      if (DISPUTED_REFERENCE.test(source)) {
        hazards.push(
          "a numeric character reference in a heading whose digit count CommonMark and GitHub's " +
            "renderer disagree about, so no slug this reader computes would be right under both",
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
 * The lookbehind excludes a colon preceded by a word character, a digit, a `/`, or the closer of a
 * template substitution. That covers an object literal, a tight ternary, a URL port, and — the case
 * that was measured the hard way — every interpolated form, where a substitution's closing brace
 * sits immediately before the colon.
 *
 * **This is a bound, not a proof of exhaustiveness, and any list of shapes here is illustrative.**
 * Two reviewers swept the character space and found an earlier version of this sentence generalised
 * past its evidence. Still admitted, and therefore enumerated: a double or single quote, a backtick,
 * a closing parenthesis, a percent sign, an asterisk, and a space. So a minified JSON key inside a
 * string, a call expression written tight against the colon, and a ternary spaced on the left but
 * not the right are all offered as citations. Nothing in the tree hits those today, and Prettier
 * inserts the space that neutralises the live-code spellings — but it does not reformat string
 * contents, so serialized JSON inside a string literal in a spec-citing file is the live residue,
 * remediable only by rewording at the site.
 *
 * **A space is deliberately NOT excluded**, and cannot be: the four genuine citations this branch
 * recovered were written inside message strings with a space before the colon. Excluding it would
 * re-open the hole that hid them.
 *
 * **A closing square bracket is deliberately not excluded either.** It was added alongside the brace
 * on the assumption that an index closer needed it, and a reviewer showed it created a Markdown
 * bypass: a link whose destination is bracketed, followed by a colon and a line number, silently
 * dropped the line claim. Re-measuring showed every interpolated shape ends in a brace, including an
 * indexed one — so the bracket was never load-bearing. It was a speculative exclusion that cost a
 * real rejection. **Add nothing to this class without a measured shape that needs it.**
 *
 * The failure direction is safe by construction: an admitted shape produces a **loud rejection**,
 * never a silently accepted wrong citation. That is why the residue above is recorded rather than
 * chased with more exclusions — each one risks the bypass the bracket produced.
 */
const BARE_REFERENCE =
  /(?<![A-Za-z0-9._\-/}]):(\d+)(?:-(\d+))?((?:,\d+(?:-\d+)?)+)?/g;

/**
 * The extra line specs in a comma-appended tail such as the `,139` of a `<file>.md:119-129,139`
 * citation.
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
  // One `bare` form, not two. `back-reference` and `context-reference` were distinct only in HOW a
  // document was chosen for the message, and that choice is gone — both always counted here anyway.
  bare: "bare",
  "prefix-less": "prefixLess",
});

/**
 * Render a citation back into the canonical `<spec-dir>/<file>.md:<start>[-<end>]` form.
 *
 * Kept although the form is rejected: a rejection has to quote back exactly what the author wrote,
 * or the failure names a site the author cannot find.
 */
export function formatCitation(citation) {
  const range = citation.end === undefined ? "" : `-${citation.end}`;
  return `${citation.specDirectory}/${citation.file}:${citation.start}${range}`;
}

/**
 * Enumerate every citation in one file's `text`, every section anchor, and every prefix-less
 * anchor the gate reports.
 *
 * An **explicit** citation (`<spec-dir>/<file>.md:<line>`) is unambiguous. A bare `:<line>` names no
 * document, so no document is selected for it: it carries the sorted set of every document the file
 * mentions, and the caller renders that set according to its size — several are listed, exactly one
 * is named. Deciding WHICH document produced four consecutive regressions and never changed a
 * verdict, so the decision is no longer made.
 *
 * A `#fragment` is collected from the same single pass over mentions rather than by a second sweep,
 * so the two forms can never disagree about what the file says.
 *
 * @returns `{ citations, anchors, unprefixedAnchors }`.
 */
export function collectCitations(
  path,
  text,
  specDirectory = SPEC_DIRECTORY,
  knownDocuments = new Set(),
) {
  const lines = splitLines(text);
  const lineAt = lineLookup(lines);
  const citations = [];
  const anchors = [];
  const unprefixedAnchors = [];

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
        // Where the citation sits. Nothing selects a document by position any more: the rule that
        // read this was deleted with the rest of the attribution machinery.
        index: mention.index,
        form: "explicit",
      });
      for (const extra of expandCommaTail(match[4])) {
        citations.push({
          specDirectory,
          file: mention.file,
          start: extra.start,
          end: extra.end,
          line,
          index: mention.index,
          form: "comma-tail",
        });
      }
    }
    match = pattern.exec(text);
  }

  // The prefix-less forms, enumerated from the same pass so the two can never disagree about what
  // the file says. Collected BEFORE the early return below, because a file may carry a prefix-less
  // reference and no prefixed mention at all — which is precisely how 60 line references stayed
  // invisible while the gate reported zero line citations.
  //
  // The ANCHOR half is REPORTED only outside the specification directory. Inside it, one document
  // linking to a sibling relatively is the normal and correct way to write that link; outside it, an
  // unprefixed anchor is checked by nothing at all, which is the blind spot ADR-0036's "only
  // accepted form" sentence forbids. Reporting and enumeration are different things: both are
  // enumerated, and every attributable prefix-less form — reported or not — is recorded as a mention,
  // because it names a document that any bare token in the file is listed against. Ambiguous
  // basenames never reach here — {@link unambiguousSpecDocuments} has already dropped `README.md`
  // and anything else the tree publishes twice — so rejecting the form cannot collide with a link to
  // a neighbour.
  // Whether the CITING file lives inside the specification directory. Tested as a path segment
  // rather than a prefix, because a rooted run reports absolute paths — the production scan yields
  // repo-relative ones, so a prefix test passed in CI and silently failed everywhere else, which is
  // the environment-dependent blindness this gate keeps having to root out.
  const citingPath = toPosixPath(path);
  const insideSpecDirectory =
    citingPath.startsWith(`${specDirectory}/`) ||
    citingPath.includes(`/${specDirectory}/`);
  PREFIX_LESS_REFERENCE.lastIndex = 0;
  let bareDocument = PREFIX_LESS_REFERENCE.exec(text);
  while (bareDocument !== null) {
    const index = bareDocument.index;
    const line = lineAt(index);
    const inside = mentions.some(
      (mention) => index >= mention.index && index < mention.end,
    );
    const attributable = !inside && knownDocuments.has(bareDocument[1]);
    // Neither half carries a prose guard any longer. The LINE form is a banned construct and the
    // ANCHOR form is a citation however it is written — a reviewer demonstrated that a test title
    // naming a document and a heading fragment is plainly a citation, so calling it "not a citation
    // anybody wrote" was false. What keeps both honest is the document-identity rule above: the
    // document must be one the specification publishes AND its basename must be unambiguous
    // repo-wide, so an incidental README fragment is still left alone.
    // Every attributable prefix-less form is recorded as a MENTION, whatever its reporting
    // disposition. Naming a document and being reported for it are different things: a permitted
    // sibling anchor is not reported, an unprefixed anchor outside the directory is, and a line form
    // is rejected — but all three name a document, so all three belong in the candidate set every
    // bare token in the file is listed against. A reviewer showed that omitting the forms that are
    // not reported shrank that set, which under the deleted machinery made a bare token name the
    // wrong document or vanish entirely; the set is what survives, so it must still be complete.
    if (attributable) {
      mentions.push({
        index: bareDocument.index,
        end: bareDocument.index + bareDocument[0].length,
        file: bareDocument[1],
        line,
      });
    }
    if (attributable && bareDocument[5] !== undefined) {
      // A relative sibling anchor inside the specification directory is the normal way one document
      // links to another, so it is not reported — only recorded above.
      if (!insideSpecDirectory) {
        unprefixedAnchors.push({
          specDirectory,
          file: bareDocument[1],
          fragment: bareDocument[5],
          line,
          written: bareDocument[0],
        });
      }
    } else if (attributable) {
      citations.push({
        specDirectory,
        file: bareDocument[1],
        start: Number(bareDocument[2]),
        end:
          bareDocument[3] === undefined ? undefined : Number(bareDocument[3]),
        line,
        index,
        form: "prefix-less",
        // The written token, kept so a rejection can quote back exactly what the author typed
        // rather than a reconstruction carrying a prefix they never wrote.
        written: bareDocument[0],
      });
      for (const extra of expandCommaTail(bareDocument[4])) {
        citations.push({
          specDirectory,
          file: bareDocument[1],
          start: extra.start,
          end: extra.end,
          line,
          index,
          form: "comma-tail",
        });
      }
    }
    bareDocument = PREFIX_LESS_REFERENCE.exec(text);
  }

  // The bare scan runs whenever ANY citation was collected, not only when a prefixed mention was.
  // A reviewer found that this early return keyed on `mentions` alone, so inside the specification
  // directory — where a relative sibling anchor is permitted and therefore records no mention — a
  // bare line claim in such a file was never scanned at all. The guard is a SCOPE test: does this
  // file name a specification document at all, since a file naming none contains numbers rather than
  // citations. A prefix-less citation names one exactly as a prefixed mention does.
  if (mentions.length === 0 && citations.length === 0) {
    // Nothing to sort: this branch is reached only when no citation was collected at all.
    return { citations, anchors, unprefixedAnchors };
  }

  // A bare token is listed against every document the file names, and no document is selected.
  //
  // This used to precompute one map from every citation in the file. A reviewer showed two ways that
  // was wrong. First, a citation written BELOW a bare token could attribute it, so the gate named a
  // document that had not yet appeared when the author wrote the colon. Fixing that with a position
  // test was still not enough: the map also recorded AMBIGUITY across the whole file, so a later
  // conflicting citation could poison an earlier, perfectly unambiguous one and push the bare token
  // onto nearest-mention fallback. Both are the same mistake — a decision about what the author could
  // see, made from text the author had not written yet.
  //
  // **There is no attribution machinery here any more, and that is the fix.** The candidate set is
  // computed ONCE for the whole file, just below, and every bare token carries that same set — no
  // lookup runs per token, and where a mention sits relative to a token changes nothing. The one
  // per-token cost left is the containment scan in the loop, asking whether a token sits inside a
  // mention's own span: O(mentions) per bare token, and free on a tree that holds no bare token.
  //
  // Four consecutive rounds each corrected a real defect introduced by the previous round's
  // correction, always in this one area: a back-reference map built from the whole file, then from a
  // position-tested prefix, then a nearest-mention loop that depended on insertion order, then
  // inferred citations promoted into back-reference sources because they carry no position. Every
  // one was a decision about *what the author could see*, and every one was wrong in a new way.
  //
  // The decisive measurement is that none of it could ever change a verdict. Under ADR-0036 a bare
  // colon-and-number in a file that names a specification document was **rejected**, and so was one
  // that could not be attributed — both dispositions were loud failures. Attribution selected only
  // which document appeared in the rejection text. So the machinery that produced four regressions
  // was answering a question the gate does not ask.
  //
  // What remains is the part that IS verdict-affecting: whether the file names an attributable
  // specification document at all. A file that names none has no citations, only numbers.
  //
  // The message keeps most of its value without any selection. A file naming exactly ONE document
  // still receives fully specific remediation, since there is nothing to choose between; the rest
  // name a handful, and listing them is both honest and actionable. Naming candidates cannot be
  // wrong in the way picking one was. No share is quoted here: one was, and independently written
  // measurements of the same tree disagreed about it — a figure in a comment is an unenforced
  // assertion. It also inverted under `packages/`, where the MAJORITY of citing files name more
  // than one document, so the figure pointed the opposite way in the code that carries the rule.
  const candidates = [
    ...new Set(mentions.map((mention) => mention.file)),
  ].sort();

  BARE_REFERENCE.lastIndex = 0;
  let bare = BARE_REFERENCE.exec(text);
  while (bare !== null) {
    const index = bare.index;
    const inside = mentions.some(
      (mention) => index >= mention.index && index < mention.end,
    );
    const line = lineAt(index);
    // No prose guard. A bare colon-and-number is enumerated wherever it appears, and what keeps that
    // safe is not position but two structural rules: this file must name a specification document,
    // and {@link BARE_REFERENCE}'s lookbehind excludes a value interpolated into a string. Requiring
    // a comment line as well hid four live citations inside template strings — the same "documented
    // therefore acceptable" hole the prefix-less form had.
    if (inside) {
      bare = BARE_REFERENCE.exec(text);
      continue;
    }
    const start = Number(bare[1]);
    const end = bare[2] === undefined ? undefined : Number(bare[2]);
    citations.push({
      specDirectory,
      file: candidates[0],
      candidates,
      start,
      end,
      line,
      form: "bare",
    });
    for (const extra of expandCommaTail(bare[3])) {
      citations.push({
        specDirectory,
        file: candidates[0],
        candidates,
        start: extra.start,
        end: extra.end,
        line,
        form: "comma-tail",
      });
    }
    bare = BARE_REFERENCE.exec(text);
  }
  citations.sort((left, right) => left.line - right.line);
  return { citations, anchors, unprefixedAnchors };
}

/**
 * Every link destination a markdown document contains, taken from the **parser** rather than by
 * pattern.
 *
 * A markdown link may carry a title after its destination, so `[t](x.md#frag. "Title")` puts a quote
 * exactly where a closing string quote sits — and the real href is `x.md#frag.`, with the full stop
 * inside it. Prose punctuation trimming cannot tell that from the corpus's ordinary cite-then-quote
 * idiom (`…#anchor: "quoted spec text"`), and two earlier reviewers defeated a hand-rolled
 * destination parser twice. `marked` already parses these documents for headings, so the hrefs come
 * from the same parse: inside a destination there is no prose to trim, and an anchor that ends in a
 * character no slug can hold is simply malformed.
 */
export function linkDestinations(text) {
  const found = new Set();
  const walk = (tokens) => {
    if (!Array.isArray(tokens)) {
      return;
    }
    for (const token of tokens) {
      if (token.type === "link" && typeof token.href === "string") {
        found.add(token.href);
      }
      walk(token.tokens);
      walk(token.items);
      walk(token.header);
      for (const row of Array.isArray(token.rows) ? token.rows : []) {
        for (const cell of row) {
          walk(cell.tokens);
        }
      }
    }
  };
  walk(marked.lexer(text, { gfm: true }));
  return found;
}

/**
 * Whether `anchor` sits inside a markdown link destination that ends in a character no heading slug
 * can hold — the shape prose trimming reads as a clean fragment and a markdown reader does not.
 */
function insideMalformedDestination(destinations, specDirectory, anchor) {
  const prefix = `${specDirectory}/${anchor.file}#${anchor.fragment}`;
  for (const href of destinations) {
    if (href.endsWith(prefix)) {
      continue;
    }
    const at = href.indexOf(prefix);
    if (at !== -1 && at + prefix.length < href.length) {
      return true;
    }
  }
  return false;
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
 * Every quoted EBNF production in a flattened run, with the source line it was written on.
 *
 * It used to also bind each production to the nearest spec **mention**, because the check measured a
 * quotation against the line range that mention named. Anchors carry no range, so the gate now
 * measures against every section the run cites and the binding has no reader — computing it anyway
 * would be an instrument producing a number nothing consults, which is the defect this saga keeps
 * finding. Nothing binds a production to one mention any more, here or anywhere: the caller holds
 * the cited sections and checks each quotation against **all** of them, failing only when none
 * contains it.
 *
 * @returns `[{ quotation, line }]`.
 */
export function auditRunQuotations(runLines) {
  const { text, offsets } = flattenProseRun(runLines);
  const found = [];
  const span = /`([^`]+)`/g;
  let quoted = span.exec(text);
  while (quoted !== null) {
    // A production quoted inside a JSON fixture's prose arrives with its quotes escaped (`\"end\"`),
    // which is the file format speaking, not the author. Unescaping here — on the citing side only —
    // keeps a correct citation from failing over a backslash.
    if (quoted[1].includes("::=")) {
      const at = quoted.index;
      const source = offsets.filter((entry) => entry.offset <= at).at(-1);
      found.push({
        quotation: normalizeQuotation(quoted[1].replace(/\\(["\\])/g, "$1")),
        line: source.line,
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
        // it twice would name one site twice in the report a maintainer has to work through.
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
 * @param roots narrows the scanned set to a filesystem walk of these paths instead of the tracked
 *   set. It narrows **what is looked at**, never what is rejected — every rule below is applied per
 *   citation, not per scope.
 * @returns `{ ok, counts, lines, findings }` where `lines` is the printable report and `findings`
 *   lists every site the gate could not accept. There is one disposition: each of them failed.
 */
export function runSpecCitationsGate({
  roots,
  specDirectory = SPEC_DIRECTORY,
  specRoot,
} = {}) {
  const lines = [];
  const findings = [];
  const counts = {
    files: 0,
    citations: 0,
    explicit: 0,
    tails: 0,
    bare: 0,
    prefixLess: 0,
    unprefixedAnchors: 0,
    sectionAnchors: 0,
    lineFragments: 0,
    quotations: 0,
    statusClaims: 0,
    failed: 0,
  };
  const fail = (line) => {
    counts.failed += 1;
    lines.push(`FAIL ${line}`);
  };

  /**
   * Report one site the gate cannot accept.
   *
   * There is no second disposition any more. A finding used to be matched against a fingerprinted
   * manifest entry and, when one matched, downgraded to `UNRESOLVED` — a green run carrying a list of
   * known-wrong citations. Saga #1180 removed both the manifest and the idea: a citation that does
   * not resolve fails, and there is nowhere to record that it is allowed not to. `findings` is kept
   * so a caller can still enumerate what failed without parsing the report.
   */
  const report = (finding) => {
    findings.push(finding);
    fail(finding.describe);
  };
  const specCache = new Map();

  const scannedFiles = listCitationFiles(roots);
  const knownDocuments = unambiguousSpecDocuments(
    specRoot ?? specDirectory,
    scannedFiles,
  );

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
  // bury the one fact a maintainer needs.
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
          "it could name a heading GitHub never publishes, or miss one it does. Remove the construct " +
          "from the heading; there is no second option, because the line form this remedy used to " +
          "offer is itself rejected now (ADR-0036). (The line here is located by scanning and may be " +
          "approximate; the construct is what the parser found.)",
      );
    }
  };

  for (const file of scannedFiles) {
    const text = readTextFile(file);
    if (text === null) {
      continue;
    }
    const fileLines = splitLines(text);
    // A DOUBLED directory prefix names nothing, and neither pattern can see it: the mention pattern
    // is stopped by the lookbehind and the prefix-less one by its own `/` guard, so the path is
    // silently ignored rather than wrongly resolved. Silence is not good enough for a path that
    // resolves nowhere — a blanket search-and-replace produced exactly this shape in shipped source
    // and nothing noticed. Detected literally, because there is nothing subtle about it.
    const doubled = `${specDirectory}/${specDirectory}/`;
    if (text.includes(doubled)) {
      for (const [index, line] of fileLines.entries()) {
        if (line.includes(doubled)) {
          fail(
            `${file}:${index + 1}: \`${doubled}\` is a doubled directory prefix — it names no ` +
              "document, and no citation pattern can see it, so it would otherwise be ignored in " +
              "silence. Write the prefix once.",
          );
        }
      }
    }
    const runOf = proseRuns(file, fileLines);
    // A status claim is a statement about the repository, not about the spec, so mode 4 sweeps every
    // tracked file rather than only the ones that carry citations.
    // An Accepted ADR is immutable, so a claim inside one cannot be edited to name an issue — and a
    // frozen record describes the world at the time of its decision rather than pending work. This
    // is a scope, printed in the coverage statement, not a list of excused sites.
    const immutableRecord = toPosixPath(file).startsWith(
      STATUS_CLAIM_EXEMPT_PREFIX,
    );
    for (const claim of collectStatusClaims(fileLines, runOf)) {
      counts.statusClaims += 1;
      if (claim.tracked || immutableRecord) {
        continue;
      }
      report({
        file,
        context: fileLines[claim.line - 1],
        subject: claim.phrase,
        observed: "untracked",
        describe:
          `${file}:${claim.line}: "${claim.phrase}" is a claim about this repository's own state that names ` +
          "no tracking issue, so nothing will ever re-check it — name the issue it waits on",
      });
    }
    // A file carrying NO prefixed mention may still carry a prefix-less line reference, and skipping
    // it on the prefix alone is how 60 of them stayed invisible while the gate reported zero line
    // citations. The cheap prefix test is kept as a fast path and widened to name any specification
    // document, so the scan still skips the overwhelming majority of files without reading them
    // twice.
    if (
      !text.includes(`${specDirectory}/`) &&
      ![...knownDocuments].some((document) => text.includes(document))
    ) {
      continue;
    }
    const { citations, anchors, unprefixedAnchors } = collectCitations(
      file,
      text,
      specDirectory,
      knownDocuments,
    );
    if (
      citations.length === 0 &&
      anchors.length === 0 &&
      unprefixedAnchors.length === 0
    ) {
      continue;
    }
    counts.files += 1;
    // Link destinations come from the PARSER, and only for markdown — in a `.ts` or `.json` file
    // there is no markdown link to mis-read, and lexing one would be answering a question nobody
    // asked.
    const destinations = file.endsWith(".md")
      ? linkDestinations(text)
      : new Set();
    // Which prose runs carry a RESOLVING anchor, and which section each names — the input the
    // quotation check reads now that no citation carries a line range.
    const anchoredByRun = new Map();

    for (const anchor of anchors) {
      // An anchor sitting inside a link destination that ends in a character no slug can hold is
      // malformed however clean the prose trimming made it look. Marked on the anchor itself, so
      // `resolveAnchor` reports it the same way as any other truncated fragment.
      if (insideMalformedDestination(destinations, specDirectory, anchor)) {
        anchor.malformed = true;
      }
      const subject = formatAnchor(anchor);
      const context = fileLines[anchor.line - 1];
      // A fragment that is empty, or truncated by a character no slug can hold, is neither a heading
      // nor a line claim: it is unresolvable as written, and is reported that way rather than being
      // matched on the prefix that survived.
      const wellFormed = anchor.fragment !== "" && anchor.malformed !== true;
      const fragment = wellFormed ? LINE_FRAGMENT.exec(anchor.fragment) : null;
      if (fragment !== null) {
        // A line fragment is a line claim in an anchor's clothing — `#L` plus a number names a
        // position, not a section, and drifts exactly as a line number does. Under the anchor-only
        // rule it is rejected on sight rather than resolved against the file's length: whether the
        // lines it names still hold text is beside the point, because naming lines at all is the
        // defect.
        counts.lineFragments += 1;
        report({
          file,
          context,
          subject,
          observed: "line-fragment",
          describe:
            `${file}:${anchor.line}: ${subject} names LINES, not a section — GitHub's line fragment ` +
            "drifts exactly as a line number does. Cite the heading that encloses those lines: " +
            `${specDirectory}/${anchor.file}#a-heading (ADR-0034)`,
        });
        continue;
      }
      counts.sectionAnchors += 1;
      canaryFor(anchor.file);
      const headings = specHeadingsFor(anchor.file);
      const failure = resolveAnchor(anchor, headings);
      if (failure === null) {
        const anchoredRun = runOf[anchor.line];
        if (!anchoredByRun.has(anchoredRun)) {
          anchoredByRun.set(anchoredRun, []);
        }
        anchoredByRun.get(anchoredRun).push({
          file: anchor.file,
          slug: anchor.fragment,
        });
        continue;
      }
      const wrapped =
        headings === null
          ? null
          : rejoinedFragment(anchor.fragment, fileLines[anchor.line], headings);
      report({
        file,
        context,
        subject,
        observed: failure.status,
        describe:
          `${file}:${anchor.line}: ${subject} does not resolve — ${failure.detail}` +
          (wrapped === null
            ? ""
            : ". It continues on the next line: this anchor is one slug hard-wrapped across a line " +
              `break, and joined back up it reads "#${wrapped}" — keep an anchor on one line`),
      });
    }

    // An anchor written without the directory prefix, outside the specification directory. It is
    // not a line claim, so it does not drift — but nothing resolves it either, and ADR-0036 admits
    // exactly one form. Inside `spec/` the relative form is normal and is never reported.
    for (const anchor of unprefixedAnchors) {
      counts.unprefixedAnchors += 1;
      report({
        file,
        context: fileLines[anchor.line - 1],
        subject: anchor.written,
        observed: "unprefixed-anchor",
        describe:
          `${file}:${anchor.line}: ${anchor.written} omits the ${specDirectory}/ prefix, so nothing ` +
          `resolves it — write ${specDirectory}/${anchor.file}#${anchor.fragment} (ADR-0036 admits ` +
          "one form, and an unprefixed anchor outside the specification directory is checked by nothing)",
      });
    }

    for (const citation of citations) {
      counts.citations += 1;
      counts[CITATION_FORM_COUNTS[citation.form]] += 1;
      const context = fileLines[citation.line - 1];
      // A bare token names no document, so the rejection must not pretend it does. Reconstructing
      // `<dir>/<first-candidate>.md:4` quotes back a citation the author never wrote, and deriving a
      // heading from that document sends them to a section chosen — after the attribution machinery
      // was deleted — by ALPHABETICAL ORDER. Three reviewers measured that independently: it is
      // strictly more arbitrary than the rule it replaced, and it is wrong remediation rather than
      // vague remediation. So a bare token whose document is NOT determined is quoted back AS
      // WRITTEN and the file's documents are LISTED. With exactly one candidate the document IS
      // determined, so the rejection names it in the canonical form and points at the section to
      // write — still a fully specific instruction; with several, listing is honest and the author
      // picks.
      // One measured limit on "as written", worth stating rather than leaving as an overclaim: a
      // comma tail is always RECONSTRUCTED from the line number it names, never copied from the
      // source. A citation whose tail appends a second line number is rejected as two separate
      // sites, and the tail's subject is rendered with a colon where the source wrote a comma; a
      // tail hanging off a prefix-less citation renders with the very prefix its head was rejected
      // for omitting. Both still name the right file and line, so the site is findable; only the
      // head of a citation is ever quoted character-for-character.
      // Only a bare-derived citation carries `candidates`; a comma tail hanging off an explicit or
      // prefix-less citation names its own document and is quoted back normally.
      const ambiguous =
        Array.isArray(citation.candidates) && citation.candidates.length !== 1;
      const subject = ambiguous
        ? `:${citation.start}${citation.end === undefined ? "" : `-${citation.end}`}`
        : (citation.written ?? formatCitation(citation));
      // The rule, in one place: a citation that names a line is rejected, whether or not it
      // currently resolves. Resolution was the old question — does this line still hold text — and
      // the answer stopped mattering when the line form stopped being allowed. What the author is
      // told instead is what to write, since the enclosing heading is always derivable from the
      // line they meant — EXCEPT when the document itself is not determined, which is the one case
      // where naming a heading would be inventing an answer.
      const heading =
        specHeadingsFor(citation.file) === null
          ? null
          : enclosingSlug(specHeadingsFor(citation.file), citation.start);
      const remedy = ambiguous
        ? `this file names ${citation.candidates.map((name) => `${specDirectory}/${name}`).join(", ")} — ` +
          "write the full citation, naming the document AND its section"
        : heading === null
          ? `${specDirectory}/${citation.file}#a-heading`
          : `${specDirectory}/${citation.file}#${heading}`;
      report({
        file,
        context,
        subject,
        observed: citation.form === "prefix-less" ? "prefix-less" : "line-form",
        describe:
          `${file}:${citation.line}: ${subject} names a LINE` +
          (citation.form === "prefix-less"
            ? `, and omits the ${specDirectory}/ prefix. Cite the section, WITH the prefix — `
            : ". Cite the section instead — ") +
          remedy +
          " (ADR-0034). A heading does not move when text is inserted above it; a line number does, " +
          "which is the drift saga #1180 removed.",
      });
    }

    for (const [run, anchored] of anchoredByRun) {
      const runLines = fileLines
        .map((text, index) => ({ line: index + 1, text }))
        .filter((entry) => runOf[entry.line] === run);
      for (const quoted of auditRunQuotations(runLines)) {
        counts.quotations += 1;
        // The quotation check used to measure a production against the LINE RANGE a citation named.
        // With no line ranges left it had no input at all, and a check with no input reports success
        // while measuring nothing — the defect this saga has caught three times. So it now measures
        // against the SECTION an anchor names, which is the same claim at the granularity citations
        // now have: the words you quote must be inside the section you cite.
        //
        // Against EVERY section the prose run cites, not one of them. A run routinely cites several,
        // and binding a quotation to a single arbitrary one manufactures failures for accurate
        // quotations — which is exactly what a first cut of this did across the design notes.
        const sections = [];
        for (const anchor of anchored) {
          const specLines = specLinesFor(anchor.file);
          const headings = specHeadingsFor(anchor.file);
          if (specLines === null || headings === null) {
            continue;
          }
          const region = sectionRange(headings, anchor.slug, specLines.length);
          if (region === null) {
            continue;
          }
          sections.push({
            subject: `${specDirectory}/${anchor.file}#${anchor.slug}`,
            text: normalizeQuotation(
              specLines.slice(region.start - 1, region.end).join(" "),
            ),
          });
        }
        if (
          sections.length === 0 ||
          sections.some((section) =>
            quotationIsPresent(quoted.quotation, section.text),
          )
        ) {
          continue;
        }
        const subject = sections.map((section) => section.subject).join(", ");
        report({
          file,
          context: fileLines[quoted.line - 1],
          subject: quoted.quotation,
          observed: "missing-production",
          describe:
            `${file}:${quoted.line}: the production \`${quoted.quotation}\` is quoted here but is not in ` +
            `${subject} — the anchor resolves and still points at the wrong section`,
        });
      }
    }
  }

  lines.push(
    `spec citations: ${counts.citations} line-form citation(s) REJECTED across ${counts.files} citing file(s) ` +
      `(${counts.explicit} explicit, ${counts.tails} comma-appended, ${counts.bare} bare, ` +
      `${counts.prefixLess} prefix-less), ` +
      `${counts.sectionAnchors} section anchor(s), ${counts.lineFragments} line fragment(s) rejected, ` +
      `${counts.unprefixedAnchors} unprefixed anchor(s) rejected, ` +
      `${counts.quotations} quoted production(s), ` +
      `${counts.statusClaims} status claim(s) — ${counts.failed} failed`,
  );
  // A run given any scope override did NOT scan the tracked set, so its numbers describe a subset
  // and must not read as the repository's result. This is the shape that has bitten this saga
  // repeatedly — an option quietly narrowing what an instrument looks at while its report still
  // reads as authoritative — and the superseded `--root=.` defect was one instance of it. The rule
  // itself is unaffected: every check below is applied per citation, never per scope, so a line
  // citation inside a narrowed scan fails exactly as it does in CI. What the banner removes is the
  // other half, where a green line is mistaken for a claim about the whole repository.
  const scanNarrowed = roots !== undefined;
  const overrides = [
    roots === undefined ? null : `roots=[${roots.join(", ")}]`,
    specDirectory === SPEC_DIRECTORY ? null : `spec-dir=${specDirectory}`,
    specRoot === undefined ? null : `spec-root=${specRoot}`,
  ].filter((part) => part !== null);
  // An empty document oracle disables the prefix-less rule entirely, and the file-skip test above
  // then hides every file that carries no prefixed mention — so a misconfigured run reports zero
  // line citations over a corpus full of them. Disclosure alone was not enough: a report can be read
  // past, an exit code cannot. This FAILS.
  if (knownDocuments.size === 0) {
    fail(
      `${specRoot ?? specDirectory} publishes no .md document whose name is unique in the scanned ` +
        "set, so no document is known and the prefix-less line form cannot be recognised at all — " +
        "a green run here would mean the rule was switched off, not that the tree is clean",
    );
  }
  if (overrides.length > 0) {
    lines.push(
      `  SCOPED RUN (${overrides.join(", ")}) — this did NOT use the production configuration, so the ` +
        "numbers above are not this repository's Definition-of-Done result" +
        (scanNarrowed
          ? ", and the set of files scanned was narrowed to those roots rather than the tracked set"
          : "; the tracked set was still scanned, but which citations are recognised, or where they are resolved, was overridden") +
        ". The rule is unchanged: a citation naming a line fails inside a scope exactly as it does outside " +
        "one.",
    );
  }
  lines.push(
    "  This gate REJECTS every citation that names a line — a `<file>.md` carrying a line number, a " +
      "comma-appended tail, a bare colon-and-number in a file that names a specification document, " +
      "GitHub's `#L` line fragment, and a prefix-less `<file>.md:12` naming a document the " +
      "specification directory publishes. The only accepted form is the " +
      "section anchor `<file>.md#a-heading`, and there is no exception manifest, no baseline and no " +
      "grandfathering: a line citation fails, and nowhere records that it may. Beyond that it checks that an " +
      "anchor names a heading that exists in the file it cites, that a quoted EBNF production is inside the " +
      "section cited, and that a forward-looking status claim names a tracking issue. Resolving an anchor " +
      "proves A HEADING EXISTS and nothing further: it does NOT prove the section supports the claim written " +
      "beside it. The wrong-passage and misstating-prose modes of issue #934 survive an anchor exactly as " +
      "they survived a line number — a citation that resolves may still paraphrase a passage that does not " +
      "support it, and prose beside a correct heading may still misstate what that section says. Ordinary " +
      "non-heading edits above a section anchor do not move it — but resolving one proves only that SOME " +
      "heading claims that slug, never that the section the citation meant still claims it. Duplicate " +
      "headings are numbered positionally, so inserting a colliding heading promotes it into the bare slug " +
      "and demotes the original, and removing or renaming an earlier duplicate promotes a later one into " +
      "the slug it vacated; both retarget a citation silently and both leave this gate green. A renamed " +
      "heading therefore fails loudly only when the rename leaves its slug unclaimed. A citation written " +
      "without the spec-directory prefix is now enumerated too: the LINE form anywhere, and the " +
      "ANCHOR form outside the specification directory. BOTH are counted ANYWHERE, including " +
      "inside a string literal in live code: there is no prose carve-out left, because what " +
      "separates a citation from an incidental colon-and-digit is whether THE FILE NAMES A " +
      "SPECIFICATION DOCUMENT at all, not where the characters sit. A bare colon-and-number in such " +
      "a file is a citation wherever it appears — before or after the mention, in a comment or in a " +
      "string — and NO document is ever selected for it: it is listed against every document the " +
      "file names, because choosing was wrong often enough to be deleted and never affected this " +
      "verdict. Only the SIZE of that list changes the message. Naming several documents, the " +
      "rejection quotes the token back with no document name on it, LISTS them and suggests no " +
      "section. Naming exactly one, there is nothing to choose between, so the rejection renders " +
      "the citation in full and names the section to write — the same remediation an explicit " +
      "citation gets. A " +
      "prefix-less form counts only when it names a document " +
      "whose basename is unique in the repository — an ambiguous one such as a README is left alone, " +
      "because attributing it to the specification would invent a citation nobody wrote. Inside the " +
      "specification directory the relative anchor is the normal way one document links to a sibling " +
      "and is never reported. A relative path that still carries the spec-directory segment " +
      "(`../../<dir>/<file>.md#y`) IS matched and resolved; one with no such segment is not seen at " +
      "all. So the rejection above is exhaustive over every spelling this gate can name, in prose " +
      "and in code alike — but a citation ASSEMBLED at runtime, such as joining a document name and " +
      "a line number into one string, is not a spelling it can name, and a reviewer demonstrated " +
      "that bypass in-tree. There is no exception manifest, and that is not the same as there " +
      "being no way round the rule. " +
      "Headings come from a GFM " +
      "parse and slugs from github-slugger (ADR-0035), so block structure and rendered text are no longer " +
      "approximated; where GitHub can still resolve something this reader does not — an entity reference " +
      "outside the escaping set, raw inline HTML, an emoji shortcode shape, or a numeric reference whose " +
      "digit count CommonMark and GitHub's renderer disagree about — the cited document is refused rather " +
      "than answered on a slug computed differently from GitHub's. Two of those four are recognised by " +
      "shape, so a construct GitHub would publish literally is refused too: this gate errs toward refusing " +
      "loudly, never toward inventing a slug. The status-claim check does NOT apply under " +
      `${STATUS_CLAIM_EXEMPT_PREFIX} — an Accepted ADR is immutable, so a claim inside one cannot be edited ` +
      "to name an issue, and being a frozen record it describes the world at the time of the decision " +
      "rather than pending work. That is a scope, not an exemption list: it names a principle, needs no " +
      "maintenance, and self-applies to every ADR. Do not read a green run as 'every citation is right'.",
  );

  return { ok: counts.failed === 0, counts, lines, findings };
}

/**
 * Parse CLI arguments: `--root=<path>` (repeatable), `--spec-dir=<token>` and `--spec-root=<path>`
 * override the defaults, which is how the subprocess regression tests point the CLI at isolated temp
 * fixtures instead of the real corpus.
 */
export function parseArgs(argv) {
  const roots = [];
  let specDirectory;
  let specRoot;
  for (const arg of argv) {
    if (arg.startsWith("--root=")) {
      roots.push(arg.slice("--root=".length));
    } else if (arg.startsWith("--spec-dir=")) {
      specDirectory = arg.slice("--spec-dir=".length);
    } else if (arg.startsWith("--spec-root=")) {
      specRoot = arg.slice("--spec-root=".length);
    }
  }
  return {
    roots: roots.length > 0 ? roots : undefined,
    specDirectory,
    specRoot,
  };
}

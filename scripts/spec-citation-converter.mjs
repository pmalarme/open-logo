/**
 * Convert every line-form `<spec-dir>/<file>.md:<line>` citation in the tree to the section anchor
 * of the heading that encloses it (saga #1180). Logic module; `scripts/convert-spec-citations.mjs`
 * is the thin CLI shell, per `docs/adr/0009-test-layout.md`.
 *
 * ## Why a converter can be trusted with a corpus nobody can read
 *
 * Nobody can review thousands of conversions by reading them, so the safety has to come from
 * somewhere else. It comes from three places, and the third is the one that matters. The totals
 * are deliberately **not** written down here: they move whenever a rule changes — the span,
 * collapse and prefix-less changes all moved them — and a figure in a comment is an unenforced
 * assertion that nothing keeps true. The CLI prints every one of them on each run.
 *
 * 1. **The anchor is not invented.** It is read from {@link documentHeadings} — the same real GFM
 *    parse plus `github-slugger` the gate resolves against (ADR-0035). Agreeing with the gate about
 *    what anchor a document publishes is the goal, not a shared blind spot: the gate is the
 *    authority on that question, and a converter with a heading reader of its own would be the
 *    defect rather than the check.
 * 2. **Site finding is shaped differently from the gate's.** The gate sweeps the whole document with
 *    one global pattern; this module works **per line**, because a line is the unit a collapse
 *    happens on. Two differently-shaped enumerators over the same corpus catch each other's misses,
 *    and {@link planFile} asserts the two agree site-for-site before it rewrites anything.
 * 3. **The result is re-measured by an instrument this module does not own.** After the sweep the
 *    gate must report **zero** line-form citations, and a section-anchor count risen by the number
 *    this converter predicted. A converter that silently skipped a file fails the first. One that
 *    wrote an anchor no heading publishes fails the gate's **anchor resolution** — not the count,
 *    which cannot see it: the gate increments its anchor total before resolving, so an unpublished
 *    anchor still counts. Two separate checks, and it is worth keeping them distinct, because
 *    "the count reconciles" is a statement about how many citations moved and nothing whatever
 *    about whether they landed anywhere real. The count reconciles **exactly** only
 *    across a single sweep commit: later commits add and correct citations by hand, so comparing a
 *    branch's endpoints to one dry run is arithmetic about two different trees.
 *
 * ## What is *not* checked, stated rather than hidden
 *
 * Conversion preserves a citation's **error**. A citation that pointed at the wrong passage still
 * points at the wrong section afterwards — at coarser granularity, and no longer silently rotting,
 * but no more correct than it was. This module moves citations; it does not audit them.
 *
 * Conversion also preserves a citation's **adjacency**, and that is a second, sharper limit. This
 * module substitutes at the citation's own extent, which is correct for the citation and can be
 * wrong for the sentence around it. Two shapes in the swept tree show it, both with a correct anchor
 * and a green gate:
 *
 * - A citation whose readable phrasing already named the document, hard-wrapped so the name sat on
 *   the previous line, becomes the document named twice — `(<file>.md <spec-dir>/<file>.md#a-heading)`.
 * - A bare citation written flush against an inline code span becomes the citation glued to that
 *   span with no separator — ``` `forward`<spec-dir>/commands.md#forward ``` — which renders as
 *   mangled prose.
 *
 * Neither is detectable by resolution or by counting, because neither is a defect in the citation:
 * both are defects in the prose the citation was embedded in. They are named here because a reader
 * auditing this module will otherwise assume adjacency was considered. It was not, and the sweep is
 * complete, so the remedy is to read the surrounding sentence at the sites where it matters rather
 * than to add a rule to a converter that has no corpus left to convert.
 *
 * ## Attribution is borrowed, deliberately
 *
 * Deciding *which document* a bare `:<line>` means is the one judgement this module does **not**
 * make for itself. The gate's rule — an earlier explicit citation of the same line spec first, then
 * the nearest preceding mention — exists because nearest-preceding demonstrably gets it wrong, and a
 * mis-attributed bare reference converts to an anchor that **resolves**, so the gate would pass it
 * and the error would be permanent and silent. A missed site is loud; a mis-attributed one is not.
 * So {@link collectCitations} supplies attribution, and this module supplies only the spans to edit.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SPEC_DIRECTORY,
  collectCitations,
  documentHeadings,
  isProseLine,
  listCitationFiles,
  readTextFile,
  specDocuments,
  splitLines,
} from "./spec-citations-gate.mjs";

/**
 * A mention token: `<spec-dir>/<file>.md` with an optional line spec and optional `#fragment`.
 *
 * The continuation group is wider than the gate's, and deliberately so. Besides the comma-appended
 * tail the gate enumerates (`,139`), this corpus joins a further line spec with
 * `/:301` — a form the gate's own sweep cannot see, because its bare-reference lookbehind excludes a
 * preceding `/`. It is a line claim all the
 * same, so a converter that ignored it would leave a `/:301` stranded beside a freshly written
 * anchor, which is how the first sweep produced two unresolvable fragments. It is counted
 * separately from the gate-visible sites, so the enumeration cross-check still compares like with
 * like rather than reporting a disagreement every time this module is the more thorough of the two.
 */
const MENTION =
  /(?<directory>[A-Za-z0-9_.-]+)\/(?<file>[A-Za-z0-9._-]+\.md)(?::(?<start>\d+)(?:-(?<end>\d+))?(?<tail>(?:,\d+(?:-\d+)?|\/:\d+(?:-\d+)?)+)?)?(?:#(?<fragment>[^\s`'"()[\]|]*))?/g;

/** A bare `:<line>` reference, with the same lookbehind guard the gate's sweep uses. */
const BARE = /(?<![A-Za-z0-9._\-/]):(\d+)(?:-(\d+))?((?:,\d+(?:-\d+)?)+)?/g;

/** GitHub's line fragment, which names lines and so is a line claim like any other. */
const LINE_FRAGMENT = /^L(\d+)(?:-L(\d+))?$/;

/**
 * Expand a continuation tail into the extra line specs it names, each flagged with whether the
 * gate's own sweep can see it — `,139` is enumerated there, `,:85` and `/:301` are not.
 */
export function expandTail(tail) {
  if (tail === undefined || tail === "") {
    return [];
  }
  return [...tail.matchAll(/([,/]):?(\d+)(?:-(\d+))?/g)].map((part) => ({
    start: Number(part[2]),
    end: part[3] === undefined ? undefined : Number(part[3]),
    gateVisible: part[1] === "," && !part[0].includes(":"),
  }));
}

/**
 * The heading enclosing `line` — the last one at or above it — or `null` when the line precedes
 * every heading in the document.
 *
 * The boundary is deliberate and tested on both sides: the line a heading is *on* belongs to that
 * heading, and the line above it belongs to the previous one. A citation landing on a blank line
 * still has an enclosing heading, which is why a landing in the blank space between sections
 * dissolves rather than needing a decision.
 */
export function enclosingHeading(headings, line) {
  let found = null;
  for (const heading of headings) {
    if (heading.line > line) {
      break;
    }
    found = heading;
  }
  return found;
}

/**
 * Every anchor one line spec becomes: one for the section its content starts in, and a second when
 * that content ends in a different section.
 *
 * **The span rule, stated because it decides thousands of anchors.** A range's anchors come from the
 * sections its **non-blank content** occupies, not from its raw endpoints. Blank lines are trimmed
 * off both ends first. Without that, a range whose first line is the blank separator closing the
 * previous section yields an anchor to a section the claim never relied on — and because that
 * section exists, the anchor **resolves** and the gate stays green. Anchor resolution catches an
 * anchor that names no heading; it never catches one that names the wrong heading, so this rule is
 * the only thing standing between a range and a confidently wrong anchor.
 *
 * A range that is blank from end to end names no content at all. There is nothing to trim towards,
 * so it keeps its enclosing section and is reported by {@link planFile} when that landing sits on a
 * section boundary, rather than being silently attributed.
 *
 * **Every section crossed, not just the two ends.** An inclusive line range claims every line
 * between its endpoints, so a range crossing three sections claims all three. Emitting only the
 * first and last dropped the middle one — and the middle is often the section the claim actually
 * rests on, which is the same silent-wrong-anchor failure one step further in. A range spanning
 * several sections is not unexpressible: it is several citations the line form let an author write
 * as one, because line numbers are terse. How often it happens is counted and printed by the CLI
 * rather than written down here.
 */
export function anchorsForSpec(headings, spec, lines = null) {
  const bounds = contentBounds(spec, lines);
  const head = enclosingHeading(headings, bounds.start);
  if (head === null) {
    return null;
  }
  const slugs = [head.slug];
  for (const heading of headings) {
    // Every heading that OPENS inside the content is a section the range crosses. Headings are in
    // document order, so this walks them once and keeps that order in the output.
    if (
      heading.line > bounds.start &&
      heading.line <= bounds.end &&
      !slugs.includes(heading.slug)
    ) {
      slugs.push(heading.slug);
    }
  }
  return slugs.every((slug) => slug !== "") ? slugs : null;
}

/**
 * The first and last lines of `spec` that hold text, or the raw endpoints when `lines` is unknown or
 * the whole range is blank.
 *
 * @returns `{ start, end, allBlank }`.
 */
export function contentBounds(spec, lines) {
  const last = spec.end ?? spec.start;
  if (lines === null) {
    return { start: spec.start, end: last, allBlank: false };
  }
  const holdsText = (line) => (lines[line - 1] ?? "").trim() !== "";
  let start = spec.start;
  while (start <= last && !holdsText(start)) {
    start += 1;
  }
  if (start > last) {
    return { start: spec.start, end: last, allBlank: true };
  }
  let end = last;
  while (end > start && !holdsText(end)) {
    end -= 1;
  }
  return { start, end, allBlank: false };
}

/**
 * Whether a citation that lands entirely on blank lines is **ambiguous** — that is, whether the
 * blank space it names sits on a section boundary.
 *
 * Most blank landings are harmless: a blank line between two paragraphs of one section has that
 * section either side of it, so the enclosing heading is the section the author meant whichever way
 * you reason about it. The dangerous one is the blank **separator closing a section**, where the
 * enclosing heading is the section *above* while the text the claim relies on begins below. Both
 * anchors exist, so both resolve, and nothing downstream can tell the difference — which is why this
 * one case is refused for a human rather than guessed at.
 */
export function blankLandingIsAmbiguous(spec, lines, headings) {
  const last = spec.end ?? spec.start;
  let next = last + 1;
  // Walk past the whole run of blank lines: a document that separates sections with several blank
  // lines would otherwise compare the section with itself and call every such landing unambiguous.
  while (next <= lines.length && lines[next - 1].trim() === "") {
    next += 1;
  }
  const above = enclosingHeading(headings, spec.start);
  const below = enclosingHeading(headings, Math.min(next, lines.length));
  const slugOf = (heading) => (heading === null ? null : heading.slug);
  return slugOf(above) !== slugOf(below);
}

/** Render `slugs` of `file` as the citation text that replaces a line spec. */
export function renderAnchors(specDirectory, file, slugs) {
  return slugs.map((slug) => `${specDirectory}/${file}#${slug}`).join(", ");
}

/**
 * The span a redundant token occupies **including** the punctuation that joined it to its neighbour.
 *
 * Without this a collapse leaves `(#debug, #debug)` — the same anchor written twice because two line
 * specs on one line named two lines of one section. The separator therefore has to come out with the
 * token: a wrapping pair of backticks first, then the whitespace and single comma in front of it.
 *
 * How often this shape occurs is **reported, not asserted**: `convertTree` counts every collapse and
 * the CLI prints the total, because a figure written into a comment is an unenforced assertion that
 * nothing keeps true. On the #1180 sweep the tool printed **106**.
 */
export function redundantSpan(text, start, end) {
  let from = start;
  let to = end;
  if (text[from - 1] === "`" && text[to] === "`") {
    from -= 1;
    to += 1;
  }
  let scan = from;
  while (scan > 0 && (text[scan - 1] === " " || text[scan - 1] === "\t")) {
    scan -= 1;
  }
  let absorbedComma = false;
  if (scan > 0 && text[scan - 1] === ",") {
    from = scan - 1;
    absorbedComma = true;
  }
  return { from, to, absorbedComma };
}

/**
 * Whether removing `span` is safe — that is, whether the duplicate was an element of a **citation
 * list** rather than a word of a sentence.
 *
 * This is the one judgement a converter can get wrong in a way no gate will ever see. A collapse
 * that deletes `` `:31` `` from ``(`…:30-31` — `:30` states the active half, `:31` the inactive
 * one)`` leaves text that does not parse as English, while the anchors that remain all resolve and
 * every count still balances. Tidiness is not worth that: a repeated anchor is verbose, a deleted
 * word is wrong, so the rule is deliberately conservative and the fallback is to write the anchor in
 * full.
 *
 * A list element has **both** properties. Its separator was a comma the span absorbed — so removing
 * it cannot weld two words together — and what follows it immediately **closes a bracketed list**: a
 * closing bracket, or a further comma inside one. Sentence punctuation is deliberately NOT enough:
 * `contract/x.md:3 states it; for the counterexample, contract/x.md:4.` is comma-separated and ends
 * in a period, yet deleting the second reference removes the object of "for the counterexample".
 * When in doubt the anchor is repeated, because a repeated anchor is verbose and a deleted word is
 * wrong.
 *
 * **The visible consequence is a repeated anchor on one line, and it is deliberate.** A reviewer
 * noted that this rule still emits `` `…#debug states the first half, …#debug the second` `` and
 * that no gate can see it. That is the intended trade, not an escaped defect: the alternative
 * deletes "the second"'s referent. It is a different thing from the pure duplicates that were
 * removed from `packages/` by hand — those repeated an anchor with **no** referring expression
 * between them, so nothing was load-bearing and the repetition carried no meaning. The test for
 * "may this duplicate go?" is whether the words between the two citations still mean anything
 * without the second, and only a human can answer it.
 */
export function isListElement(text, span) {
  if (!span.absorbedComma) {
    return false;
  }
  return /^[)\]},]/.test(text.slice(span.to));
}

/** Apply non-overlapping `edits` (each `{ from, to, text }`) to `text`, last first. */
export function applyEdits(text, edits) {
  let result = text;
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
  }
  return result;
}

/**
 * A **prefix-less** reference to a specification document, the one line-form spelling written
 * without the `<spec-dir>/` prefix.
 *
 * **This no longer mirrors the gate's enumeration, and that is deliberate.** The gate now finds this
 * form wherever it appears, including inside a string literal in live code; this module still
 * restricts itself to prose lines. The asymmetry is safe only because the sweep is **complete** —
 * there is no corpus left for this module to convert, so the strictly narrower set it would enumerate
 * is empty in practice, and {@link planFile}'s cross-check runs over files that contain no line form
 * at all. If this converter is ever pointed at a fresh corpus, align it with the gate first: a
 * converter that silently declines what the gate rejects would leave exactly the sites a human then
 * has to find by hand.
 */
const PREFIX_LESS =
  /(?<![A-Za-z0-9._/#-])([A-Za-z][A-Za-z0-9-]*\.md):(\d+)(?:-(\d+))?((?:,\d+(?:-\d+)?)+)?/g;

/**
 * Every token on one line that names a document, in the order they are written.
 *
 * Mentions are found anywhere on the line; a bare `:<line>` and a prefix-less `<file>.md:<line>`
 * count only on a prose line, which is the same structural rule the gate applies — a formatted ratio
 * in live code is not a citation, and neither is a `file:line:form` assertion string.
 */
export function lineTokens(
  path,
  lineText,
  specDirectory,
  knownDocuments = new Set(),
) {
  const tokens = [];
  MENTION.lastIndex = 0;
  let match = MENTION.exec(lineText);
  while (match !== null) {
    if (match.groups.directory === specDirectory) {
      tokens.push({
        kind: "mention",
        from: match.index,
        to: match.index + match[0].length,
        file: match.groups.file,
        start:
          match.groups.start === undefined
            ? undefined
            : Number(match.groups.start),
        end:
          match.groups.end === undefined ? undefined : Number(match.groups.end),
        tail: match.groups.tail,
        fragment: match.groups.fragment,
      });
    }
    match = MENTION.exec(lineText);
  }
  if (isProseLine(path, lineText)) {
    PREFIX_LESS.lastIndex = 0;
    let bareDocument = PREFIX_LESS.exec(lineText);
    while (bareDocument !== null) {
      const inside = tokens.some(
        (token) =>
          bareDocument.index >= token.from && bareDocument.index < token.to,
      );
      if (!inside && knownDocuments.has(bareDocument[1])) {
        tokens.push({
          kind: "prefix-less",
          from: bareDocument.index,
          to: bareDocument.index + bareDocument[0].length,
          file: bareDocument[1],
          start: Number(bareDocument[2]),
          end:
            bareDocument[3] === undefined ? undefined : Number(bareDocument[3]),
          tail: bareDocument[4],
        });
      }
      bareDocument = PREFIX_LESS.exec(lineText);
    }
    BARE.lastIndex = 0;
    let bare = BARE.exec(lineText);
    while (bare !== null) {
      const inside = tokens.some(
        (token) => bare.index >= token.from && bare.index < token.to,
      );
      if (!inside) {
        tokens.push({
          kind: "bare",
          from: bare.index,
          to: bare.index + bare[0].length,
          start: Number(bare[1]),
          end: bare[2] === undefined ? undefined : Number(bare[2]),
          tail: bare[3],
        });
      }
      bare = BARE.exec(lineText);
    }
  }
  return tokens.sort((left, right) => left.from - right.from);
}

/**
 * Plan one file's conversion: the edits to apply, and the sites that cannot be converted.
 *
 * Before planning anything it **cross-checks its own enumeration against the gate's**, per line and
 * per form. The two sweeps are shaped differently on purpose — this one is line-oriented, the gate's
 * is document-oriented — so a disagreement means one of them is blind, and a converter that rewrote
 * a file it had enumerated differently from the verifier would be exactly the instrument that
 * reports success while measuring something else.
 */
export function planFile(
  path,
  text,
  specDirectory,
  headingsFor,
  linesFor = () => null,
  knownDocuments = new Set(),
) {
  const collected = collectCitations(path, text, specDirectory, knownDocuments);
  const bareByLine = new Map();
  let expectedSites = 0;
  for (const citation of collected.citations) {
    expectedSites += 1;
    // Only a BARE reference needs attribution from the gate. An explicit citation, a comma tail and
    // a prefix-less reference all name their own document, so putting them in this queue would make
    // the next bare token shift the wrong entry off it.
    if (
      citation.form === "explicit" ||
      citation.form === "comma-tail" ||
      citation.form === "prefix-less"
    ) {
      continue;
    }
    if (!bareByLine.has(citation.line)) {
      bareByLine.set(citation.line, []);
    }
    bareByLine.get(citation.line).push(citation);
  }
  // A line fragment is a line claim the gate counts on its own counter rather than as a citation,
  // so it has to be added here for the two enumerations to be comparable. Leaving it out made the
  // cross-check fire on `packages/parser/README.md` — the counter-arithmetic differing, not either
  // sweep being blind, which is precisely the distinction a disagreement has to be read carefully
  // enough to draw.
  for (const anchor of collected.anchors) {
    if (LINE_FRAGMENT.test(anchor.fragment)) {
      expectedSites += 1;
    }
  }

  const lines = splitLines(text);
  const edits = [];
  const problems = [];
  const produced = [];
  let offset = 0;
  let seenSites = 0;
  let invisible = 0;
  let collapsed = 0;
  let spanning = 0;

  for (const [index, lineText] of lines.entries()) {
    const number = index + 1;
    const tokens = lineTokens(path, lineText, specDirectory, knownDocuments);
    const pending = [...(bareByLine.get(number) ?? [])];
    const emitted = new Set();

    for (const token of tokens) {
      const absolute = (position) => offset + position;
      // A citation hard-wrapped across a line break: the token ends the line on a dangling `-` or
      // `,` whose continuation digits sit on the next line. Both instruments stop at the wrap, so
      // the claim is already half-invisible — and converting only the visible half strands the
      // remainder against the new anchor, which is how `#print-` reached the gate on the first
      // sweep. This module refuses rather than guessing which half the author meant: the hyphen
      // form is one range split in two, the comma form is two separate claims, and nothing on the
      // line says which. Unwrap it by hand onto one line first; a citation belongs on one line
      // anyway, which is the same rule #1181 already enforces for a wrapped anchor.
      //
      // The next line must genuinely begin with a digit. Without that test this fires on the far
      // commoner shape of a comma ending a wrapped prose list — `` `bk`→`back`:1212, `` continuing
      // with another alias, or a range followed by `issue #99)` — and refusing those would stall a
      // sweep on five sites that convert perfectly well.
      const trailing = lineText.slice(token.to).trimEnd();
      const continuation = (lines[index + 1] ?? "")
        .trimStart()
        .replace(/^(?:\/\/+|\*|#)\s*/, "");
      if (
        token.start !== undefined &&
        (trailing === "-" || trailing === ",") &&
        /^\d/.test(continuation)
      ) {
        problems.push({
          kind: "wrapped-citation",
          site: `${path}:${number}`,
          detail: `the line spec continues on the next line after a dangling "${trailing}" — unwrap it onto one line`,
          context: lineText.trim(),
        });
        continue;
      }
      // The same claim, continued on the SAME line by a dash the range pattern does not recognise:
      // `<file>.md:193–194` written with an en dash rather than a hyphen. Converting the visible
      // half strands the remainder against the new anchor — `#style-linter-codes–194`, an anchor
      // that resolves nowhere — so the site is refused for a human instead. Only one such site
      // existed in this corpus, and it is exactly the shape that produced a broken anchor before
      // this guard was added.
      if (
        token.start !== undefined &&
        /^[\u2013\u2014]\d/.test(lineText.slice(token.to))
      ) {
        problems.push({
          kind: "dash-range",
          site: `${path}:${number}`,
          detail:
            "the line spec continues after an en or em dash, which is not the range separator this " +
            "module reads — rewrite the range with a plain hyphen, or cite both sections by hand",
          context: lineText.trim(),
        });
        continue;
      }
      let file = token.file;
      let specs = [];
      if (token.kind === "bare") {
        const attributed = pending.shift();
        if (attributed === undefined) {
          problems.push({
            kind: "unattributed-bare",
            site: `${path}:${number}`,
            detail: `the gate attributes no document to \`:${token.start}\` here`,
            context: lineText.trim(),
          });
          continue;
        }
        file = attributed.file;
        specs = [
          { start: token.start, end: token.end, gateVisible: true },
          ...expandTail(token.tail),
        ];
        // Counted per gate-visible SPEC, not per token: `collectCitations` records a bare reference
        // and each comma-appended line in its tail as separate citations, so counting the token once
        // made every bare tail disagree with the gate and refuse a file that was perfectly
        // convertible.
        seenSites += specs.filter((spec) => spec.gateVisible).length;
        invisible +=
          specs.length - specs.filter((spec) => spec.gateVisible).length;
      } else if (token.kind === "prefix-less") {
        // A prefix-less reference is converted to the FULL prefixed anchor, never to a prefix-less
        // one: outside the specification directory an unprefixed anchor is checked by nothing, so
        // converting one form the gate can see into another it cannot would trade a loud defect for
        // a silent one.
        specs = [
          { start: token.start, end: token.end, gateVisible: true },
          ...expandTail(token.tail),
        ];
        seenSites += specs.filter((spec) => spec.gateVisible).length;
        invisible +=
          specs.length - specs.filter((spec) => spec.gateVisible).length;
      } else if (token.start !== undefined) {
        specs = [
          { start: token.start, end: token.end, gateVisible: true },
          ...expandTail(token.tail),
        ];
        seenSites += specs.filter((spec) => spec.gateVisible).length;
        invisible +=
          specs.length - specs.filter((spec) => spec.gateVisible).length;
      } else if (
        token.fragment !== undefined &&
        LINE_FRAGMENT.test(token.fragment)
      ) {
        const fragment = LINE_FRAGMENT.exec(token.fragment);
        specs = [
          {
            start: Number(fragment[1]),
            end: fragment[2] === undefined ? undefined : Number(fragment[2]),
            gateVisible: true,
          },
        ];
        seenSites += 1;
      } else {
        // A plain mention, or one already carrying a section anchor. It names no line, so there is
        // nothing to convert — but an existing anchor still occupies this line, so a later bare
        // reference that lands in the same section collapses onto it rather than repeating it.
        if (token.fragment !== undefined && token.fragment !== "") {
          emitted.add(`${token.file}#${token.fragment}`);
        }
        continue;
      }

      const headings = headingsFor(file);
      if (headings === null) {
        problems.push({
          kind: "missing-document",
          site: `${path}:${number}`,
          detail: `${specDirectory}/${file} does not exist, so it publishes no headings`,
          context: lineText.trim(),
        });
        continue;
      }
      const documentLines = linesFor(file);
      const slugs = [];
      let blocked = null;
      let blankRange = false;
      let unusableRange = false;
      for (const spec of specs) {
        // A line spec that cannot name real text at all: before line 1, past end-of-file, or a range
        // that ends before it starts. Converting one would invent an anchor for a citation that is
        // already broken — and the anchor would RESOLVE, making the breakage permanent and
        // invisible. The old gate caught these as `past-eof`/`inverted-range`; with the line form
        // rejected outright that check has no caller, so the converter has to carry it.
        const lastLine = spec.end ?? spec.start;
        if (
          documentLines !== null &&
          (spec.start < 1 ||
            lastLine < spec.start ||
            lastLine > documentLines.length)
        ) {
          blocked = spec;
          unusableRange = true;
          break;
        }
        // A range that holds no text anywhere names no content, so there is nothing for the span
        // rule to trim towards and its anchor would rest on the raw endpoint alone. That is reported
        // rather than quietly attributed: it is the shape most likely to name a section the claim
        // never relied on, and the anchor would resolve either way.
        if (
          documentLines !== null &&
          contentBounds(spec, documentLines).allBlank &&
          blankLandingIsAmbiguous(spec, documentLines, headings)
        ) {
          blocked = spec;
          blankRange = true;
          break;
        }
        const resolved = anchorsForSpec(headings, spec, documentLines);
        if (resolved === null) {
          blocked = spec;
          break;
        }
        if (resolved.length > 1) {
          spanning += 1;
        }
        for (const slug of resolved) {
          if (!slugs.includes(slug)) {
            slugs.push(slug);
          }
        }
      }
      if (blocked !== null) {
        const detail = unusableRange
          ? `${specDirectory}/${file}:${blocked.start}${blocked.end === undefined ? "" : `-${blocked.end}`} names no real text — it starts before line 1, ends before it starts, or runs past end-of-file, so this citation was already broken`
          : blankRange
            ? `${specDirectory}/${file}:${blocked.start} is blank and sits on a section boundary, so the section above it and the text below it are equally defensible — decide by hand`
            : `${specDirectory}/${file}:${blocked.start} has no enclosing heading that publishes a slug`;
        problems.push({
          kind: unusableRange
            ? "unusable-range"
            : blankRange
              ? "blank-range"
              : "no-usable-heading",
          site: `${path}:${number}`,
          detail,
          context: lineText.trim(),
        });
        continue;
      }

      const fresh = slugs.filter((slug) => !emitted.has(`${file}#${slug}`));
      for (const slug of slugs) {
        emitted.add(`${file}#${slug}`);
      }
      if (fresh.length === 0) {
        // Every anchor this token would write is already on the line. Removing it is only safe when
        // it was an element of a citation LIST; when it is a referring expression inside a sentence,
        // deleting it leaves text that does not parse while every anchor still resolves and every
        // count still balances. So the anchor is written out in full instead. Verbose beats wrong.
        const span = redundantSpan(lineText, token.from, token.to);
        if (isListElement(lineText, span)) {
          collapsed += 1;
          edits.push({
            from: absolute(span.from),
            to: absolute(span.to),
            text: "",
          });
          continue;
        }
      }
      const written = fresh.length === 0 ? slugs : fresh;
      produced.push(...written.map((slug) => `${file}#${slug}`));
      // A replacement abutting a preceding comma needs the space the line form did not: `:39,:85`
      // is legible, `#turtle-creation,spec/…#addressing-model` runs the anchor into the separator
      // and the gate reads the comma as part of the fragment, so the citation stops resolving.
      const separated =
        token.kind === "bare" && lineText[token.from - 1] === "," ? " " : "";
      edits.push({
        from: absolute(token.from),
        to: absolute(token.to),
        text: separated + renderAnchors(specDirectory, file, written),
      });
    }
    offset += lineText.length + 1;
  }

  if (seenSites !== expectedSites) {
    problems.push({
      kind: "enumeration-disagreement",
      site: path,
      detail: `this module found ${seenSites} site(s); the gate found ${expectedSites}`,
      context: "",
    });
    return {
      edits: [],
      problems,
      produced: [],
      sites: expectedSites,
      invisible,
      collapsed: 0,
      spanning: 0,
    };
  }
  return {
    edits,
    problems,
    produced,
    sites: expectedSites,
    invisible,
    collapsed,
    spanning,
  };
}

/**
 * Convert every citing file under `roots` (the tracked set by default).
 *
 * `write` is opt-in so a dry run can report exactly what a sweep would do — the numbers in the PR
 * body come from a dry run, and the sweep that follows must reproduce them.
 */
export function convertTree({
  roots,
  specDirectory = SPEC_DIRECTORY,
  specRoot,
  write = false,
}) {
  const cache = new Map();
  const linesCache = new Map();
  const knownDocuments = specDocuments(specRoot ?? specDirectory);
  const linesFor = (file) => {
    if (!linesCache.has(file)) {
      let documentLines = null;
      try {
        documentLines = splitLines(
          readFileSync(join(specRoot ?? specDirectory, file), "utf8"),
        );
      } catch {
        documentLines = null;
      }
      linesCache.set(file, documentLines);
    }
    return linesCache.get(file);
  };
  const headingsFor = (file) => {
    if (!cache.has(file)) {
      const documentLines = linesFor(file);
      cache.set(
        file,
        documentLines === null ? null : documentHeadings(documentLines),
      );
    }
    return cache.get(file);
  };

  const report = {
    filesScanned: 0,
    filesChanged: 0,
    sites: 0,
    anchors: 0,
    invisible: 0,
    collapsed: 0,
    spanning: 0,
    problems: [],
    changed: [],
  };
  for (const path of listCitationFiles(roots)) {
    const text = readTextFile(path);
    // A file carrying no prefixed mention may still carry a prefix-less reference, so the cheap
    // skip test has to name every specification document rather than the prefix alone.
    if (
      text === null ||
      (!text.includes(`${specDirectory}/`) &&
        ![...knownDocuments].some((document) => text.includes(document)))
    ) {
      continue;
    }
    const plan = planFile(
      path,
      text,
      specDirectory,
      headingsFor,
      linesFor,
      knownDocuments,
    );
    if (plan.sites === 0) {
      continue;
    }
    report.filesScanned += 1;
    report.sites += plan.sites;
    report.anchors += plan.produced.length;
    report.invisible += plan.invisible;
    report.collapsed += plan.collapsed;
    report.spanning += plan.spanning;
    report.problems.push(...plan.problems);
    if (plan.edits.length === 0) {
      continue;
    }
    report.filesChanged += 1;
    report.changed.push(path);
    if (write) {
      writeFileSync(path, applyEdits(text, plan.edits), "utf8");
    }
  }
  return report;
}

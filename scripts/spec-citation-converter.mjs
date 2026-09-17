/**
 * Convert every line-form `<spec-dir>/<file>.md:<line>` citation in the tree to the section anchor
 * of the heading that encloses it (saga #1180). Logic module; `scripts/convert-spec-citations.mjs`
 * is the thin CLI shell, per `docs/adr/0009-test-layout.md`.
 *
 * ## Why a converter can be trusted with 777 files
 *
 * Nobody can review 2,861 conversions by reading them, so the safety has to come from somewhere
 * else. It comes from three places, and the third is the one that matters:
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
 *    gate must report **zero** line-form citations and a section-anchor count risen by exactly the
 *    number this converter predicted. A converter that silently skipped a file fails the first; one
 *    that wrote an anchor no heading publishes fails the second.
 *
 * ## What is *not* checked, stated rather than hidden
 *
 * Conversion preserves a citation's **error**. A citation that pointed at the wrong passage still
 * points at the wrong section afterwards — at coarser granularity, and no longer silently rotting,
 * but no more correct than it was. This module moves citations; it does not audit them.
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
  EXCEPTIONS_PATH,
  SPEC_DIRECTORY,
  collectCitations,
  documentHeadings,
  isProseLine,
  listCitationFiles,
  readTextFile,
  splitLines,
  toPosixPath,
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
 * still has an enclosing heading, which is why all 83 blank-region landings in this corpus dissolve
 * rather than needing a decision.
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
 * Every anchor one line spec becomes: one for the section it starts in, and a second when its range
 * ends in a different section.
 *
 * A range spanning two sections is not unexpressible — it is two citations that the line form let an
 * author write as one, because line numbers are terse. Anchors are not obliged to inherit that
 * terseness, so the range becomes both anchors rather than losing half its claim.
 */
export function anchorsForSpec(headings, spec) {
  const slugs = [];
  const head = enclosingHeading(headings, spec.start);
  if (head === null) {
    return null;
  }
  slugs.push(head.slug);
  const tail = enclosingHeading(headings, spec.end ?? spec.start);
  if (tail !== null && tail.slug !== head.slug) {
    slugs.push(tail.slug);
  }
  return slugs.every((slug) => slug !== "") ? slugs : null;
}

/** Render `slugs` of `file` as the citation text that replaces a line spec. */
export function renderAnchors(specDirectory, file, slugs) {
  return slugs.map((slug) => `${specDirectory}/${file}#${slug}`).join(", ");
}

/**
 * The span a redundant token occupies **including** the punctuation that joined it to its neighbour.
 *
 * Without this a collapse leaves `(#debug, #debug)` — the same anchor written twice because two line
 * specs on one line named two lines of one section. 172 sites in this corpus are that shape, so the
 * separator has to come out with the token: a wrapping pair of backticks first, then the whitespace
 * and single comma in front of it.
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
  if (scan > 0 && text[scan - 1] === ",") {
    from = scan - 1;
  }
  return { from, to };
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
 * Every token on one line that names a document, in the order they are written.
 *
 * Mentions are found anywhere on the line; a bare `:<line>` counts only on a prose line, which is
 * the same structural rule the gate applies — a formatted ratio in live code is not a citation.
 */
export function lineTokens(path, lineText, specDirectory) {
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
export function planFile(path, text, specDirectory, headingsFor) {
  const collected = collectCitations(path, text, specDirectory);
  const bareByLine = new Map();
  let expectedSites = 0;
  for (const citation of collected.citations) {
    expectedSites += 1;
    if (citation.form === "explicit" || citation.form === "comma-tail") {
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

  for (const [index, lineText] of lines.entries()) {
    const number = index + 1;
    const tokens = lineTokens(path, lineText, specDirectory);
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
        // One bare token is one site to the gate however many line specs it carries.
        seenSites += 1;
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
      const slugs = [];
      let blocked = null;
      for (const spec of specs) {
        const resolved = anchorsForSpec(headings, spec);
        if (resolved === null) {
          blocked = spec;
          break;
        }
        for (const slug of resolved) {
          if (!slugs.includes(slug)) {
            slugs.push(slug);
          }
        }
      }
      if (blocked !== null) {
        problems.push({
          kind: "no-usable-heading",
          site: `${path}:${number}`,
          detail: `${specDirectory}/${file}:${blocked.start} has no enclosing heading that publishes a slug`,
          context: lineText.trim(),
        });
        continue;
      }

      const fresh = slugs.filter((slug) => !emitted.has(`${file}#${slug}`));
      for (const slug of slugs) {
        emitted.add(`${file}#${slug}`);
      }
      if (fresh.length === 0) {
        const span = redundantSpan(lineText, token.from, token.to);
        edits.push({
          from: absolute(span.from),
          to: absolute(span.to),
          text: "",
        });
        continue;
      }
      produced.push(...fresh.map((slug) => `${file}#${slug}`));
      // A replacement abutting a preceding comma needs the space the line form did not: `:39,:85`
      // is legible, `#turtle-creation,spec/…#addressing-model` runs the anchor into the separator
      // and the gate reads the comma as part of the fragment, so the citation stops resolving.
      const separated =
        token.kind === "bare" && lineText[token.from - 1] === "," ? " " : "";
      edits.push({
        from: absolute(token.from),
        to: absolute(token.to),
        text: separated + renderAnchors(specDirectory, file, fresh),
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
    };
  }
  return { edits, problems, produced, sites: expectedSites, invisible };
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
} = {}) {
  const cache = new Map();
  const headingsFor = (file) => {
    if (!cache.has(file)) {
      let headings = null;
      try {
        headings = documentHeadings(
          splitLines(
            readFileSync(join(specRoot ?? specDirectory, file), "utf8"),
          ),
        );
      } catch {
        headings = null;
      }
      cache.set(file, headings);
    }
    return cache.get(file);
  };

  const report = {
    filesScanned: 0,
    filesChanged: 0,
    sites: 0,
    anchors: 0,
    invisible: 0,
    problems: [],
    changed: [],
  };
  for (const path of listCitationFiles(roots)) {
    // Compared through toPosixPath because git ls-files reports / on every platform while
    // join yields \ on Windows: the mismatched form silently scanned the manifest, whose 83
    // entries quote the citations they excuse, and the cross-check caught it as 83 phantom sites.
    if (toPosixPath(path) === toPosixPath(EXCEPTIONS_PATH)) {
      continue;
    }
    const text = readTextFile(path);
    if (text === null || !text.includes(`${specDirectory}/`)) {
      continue;
    }
    const plan = planFile(path, text, specDirectory, headingsFor);
    if (plan.sites === 0) {
      continue;
    }
    report.filesScanned += 1;
    report.sites += plan.sites;
    report.anchors += plan.produced.length;
    report.invisible += plan.invisible;
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

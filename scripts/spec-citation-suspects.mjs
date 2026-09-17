/**
 * Logic module for the **wrong-anchor suspect scanner** (saga #1180). Extracted so tests can import
 * it directly for 100% coverage, keeping `scripts/check-spec-citation-suspects.mjs` a thin CLI shell
 * — the same shape `scripts/spec-citations-gate.mjs` + `scripts/check-spec-citations.mjs` already
 * have, per `docs/adr/0009-test-layout.md`.
 *
 * ## What this is, and what it is emphatically not
 *
 * `scripts/spec-citations-gate.mjs` proves an anchor names a heading that **exists**. It cannot tell
 * whether that heading is the **right** one, and saying so is the standing qualification on every
 * coverage statement in this repository. This module is the first instrument that looks at the
 * question — by scoring the prose around a citation against every section of the document it cites,
 * and reporting where a different section matches the claim better.
 *
 * **It is a ranked report for a human, never a gate verdict**, and that is not modesty. It is
 * measured. Two facts decide it:
 *
 * 1. **Recall is roughly 25%.** Repointing known-good anchors to a random other section of the same
 *    document and re-scoring catches about a quarter of them. Three of four *deliberately broken*
 *    anchors score clean. A detector that misses three quarters of known-wrong inputs cannot gate
 *    anything, because its silence carries almost no information.
 * 2. **The flag rate is a property of the instrument, not of the corpus.** Two implementations
 *    written from the same prose description — differing only in tokenizer and stop-list — produced
 *    rates 2.3× apart on the same tree. So this module never publishes a rate as a measurement of
 *    how many anchors are wrong. It publishes a queue, and any rate quoted anywhere must be quoted
 *    with the instrument pinned beside it.
 *
 * The only part that may **fail** is {@link selfCheck}, which is not a topical judgement at all: it
 * asserts the instrument still detects mutations we introduced ourselves, which is provable. The
 * findings never fail a build, and the CLI exits 0 whatever it finds.
 *
 * ## The title artifact, recorded so nobody re-derives it wrong
 *
 * The first version of this scan reported that **34.7%** of anchors had a better-matching section.
 * That number was an artifact and it is worth the paragraph. A document's depth-1 **title** heading
 * spans the whole file, so its section contains every word of every claim and out-scored the real
 * target almost everywhere — on a third of the corpus the tool was "discovering" that a citation
 * should point at the document title. It was caught only by reading the output and disbelieving it,
 * because every top-ranked hit implausibly named the title.
 *
 * Excluding titles by a depth-and-span rule made the number look sane, and that was the wrong fix:
 * it patched the symptom with two arbitrary constants while the pathology — large sections beating
 * small correct ones — survived underneath. {@link sectionBodies} replaces it with a rule that has
 * no constants and cannot have the artifact: score **leaf bodies**, and let a cited heading claim
 * the best score inside its own subtree. A title's subtree is the whole document, so nothing can
 * beat it, and the artifact disappears by construction rather than by threshold. Large but
 * legitimate targets stay eligible.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  documentHeadings,
  listCitationFiles,
  proseRuns,
  readTextFile,
  SPEC_DIRECTORY,
  splitLines,
} from "./spec-citations-gate.mjs";

/**
 * Words carrying no topical signal: ordinary English function words plus this repository's own
 * jargon, which appears in every claim and every section alike and therefore separates nothing.
 */
const STOP_WORDS = new Set(
  (
    "the a an and or of to in is are was were be been being for that this these those it its as " +
    "by on at from with not no any per see which when then than each both only also same other " +
    "some such if but into over under after before while because whose what where how who why " +
    "spec issue issues profile profiles section sections line lines anchor anchors citation " +
    "citations cite cites cited must may can never always one two three four five openlogo " +
    "core data note notes here there they them their we our you your has have had does did done " +
    "would could should will shall about above below between through during against within"
  ).split(" "),
);

/** A citation token, so the prose around a citation is scored rather than the citation itself. */
const CITATION_TOKEN = /[A-Za-z0-9._/-]*\.md#[\p{L}\p{N}\p{M}\p{Pc}-]*/gu;

/**
 * The content words of `text`, lower-cased and lightly stemmed.
 *
 * `camelCase` and `snake_case` identifiers are split, because a claim that says `bindElement` and a
 * section that says "bind" and "element" are talking about the same thing. A trailing `s` is dropped
 * so `levels`/`level` match — measured as necessary for the heading guard, which otherwise misses on
 * every plural heading.
 */
export function contentWords(text) {
  const words = new Set();
  const stripped = text.replace(CITATION_TOKEN, " ");
  for (const raw of stripped
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9_?]+/)) {
    for (const part of raw.split("_")) {
      const word =
        part.length > 3 && part.endsWith("s") ? part.slice(0, -1) : part;
      if (word.length > 3 && !STOP_WORDS.has(word)) {
        words.add(word);
      }
    }
  }
  return words;
}

/**
 * Every **leaf body** of a document: a heading and the lines up to the next heading of *any* depth,
 * so each line belongs to exactly one body.
 *
 * Scoring bodies rather than subtrees is what removes the title artifact without a single constant.
 * See the module note.
 */
export function sectionBodies(lines) {
  const headings = documentHeadings(lines).filter(({ slug }) => slug !== "");
  return headings.map((heading, index) => {
    const end =
      index + 1 < headings.length ? headings[index + 1].line - 1 : lines.length;
    return {
      slug: heading.slug,
      depth: heading.depth,
      line: heading.line,
      heading: heading.heading,
      words: contentWords(lines.slice(heading.line - 1, end).join(" ")),
    };
  });
}

/**
 * The indices of the bodies inside `slug`'s **subtree** — itself, plus every following body until
 * one of equal or shallower depth.
 */
export function subtreeOf(bodies, slug) {
  const start = bodies.findIndex((body) => body.slug === slug);
  if (start === -1) {
    return [];
  }
  const indices = [start];
  for (let index = start + 1; index < bodies.length; index += 1) {
    if (bodies[index].depth <= bodies[start].depth) {
      break;
    }
    indices.push(index);
  }
  return indices;
}

/**
 * Inverse document frequency of each word over a document's bodies.
 *
 * Weighting the claim by IDF is what stops a small, correct section losing to a large lookup table
 * that merely contains the same common words. Without it, a one-entry command section scores 0.36
 * against its own claim while the big predicate table scores 1.00.
 */
export function inverseDocumentFrequency(bodies) {
  const frequency = new Map();
  for (const body of bodies) {
    for (const word of body.words) {
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
  }
  const idf = new Map();
  for (const [word, count] of frequency) {
    idf.set(word, Math.log(1 + bodies.length / (1 + count)));
  }
  return idf;
}

/** The total IDF mass of `claim` — how much the claim is actually asserting. */
export function claimMass(claim, idf) {
  let mass = 0;
  for (const word of claim) {
    mass += idf.get(word) ?? Math.log(1 + 1 / 1);
  }
  return mass;
}

/** Whether `path` lives inside the specification directory, tested as a path segment. */
function insideSpecDirectory(path, specDirectory) {
  return (
    path.startsWith(`${specDirectory}/`) || path.includes(`/${specDirectory}/`)
  );
}

/** The share of a claim's IDF mass that `body` contains. */
export function bodyScore(claim, body, idf, mass) {
  if (mass === 0) {
    return 0;
  }
  let matched = 0;
  for (const word of claim) {
    if (body.words.has(word)) {
      // Every word a body holds is in the map by construction, so there is no missing case here.
      matched += idf.get(word);
    }
  }
  return matched / mass;
}

/**
 * Whether the claim names the cited section's own heading.
 *
 * A claim that spells out the heading it cites is strong evidence the citation was deliberate, and
 * flagging it is noise. Measured at a 13% reduction in findings, removing an entire class where a
 * one-entry section loses to the table that lists it.
 */
export function claimNamesHeading(claim, heading) {
  const tokens = contentWords(heading);
  if (tokens.size === 0) {
    return false;
  }
  for (const token of tokens) {
    if (!claim.has(token)) {
      return false;
    }
  }
  return true;
}

/**
 * How a suggested section relates structurally to the cited one.
 *
 * A **sibling** suggestion is very often "a more precise anchor exists" rather than "this anchor is
 * wrong" — `spec/educational-model.md` carries a levels overview and the individual levels as
 * siblings, so citing the overview from a level's own file gets suggested toward the specific
 * section although the overview is a legitimate normative target. The instrument cannot separate
 * *wrong* from *less specific*, so it reports the relationship and lets a human triage on it.
 */
export function relationOf(bodies, citedSlug, suggestedSlug) {
  const cited = bodies.find((body) => body.slug === citedSlug);
  const suggested = bodies.find((body) => body.slug === suggestedSlug);
  if (cited === undefined || suggested === undefined) {
    return "other";
  }
  return cited.depth === suggested.depth ? "sibling" : "other";
}

/** Thresholds, named so the report can print them and a caller can vary them in a measurement. */
export const DEFAULT_THRESHOLDS = Object.freeze({
  /** Minimum IDF mass before a claim says enough to be scored at all. */
  claimMass: 6,
  /** How far a rival must beat the cited section. */
  margin: 0.25,
  /** How well a rival must score on its own before it is a rival rather than the least-bad. */
  floor: 0.35,
});

/** Every anchor citation in one file, with the prose run that surrounds it. */
export function anchorClaims(path, text, specDirectory) {
  const lines = splitLines(text);
  const runs = proseRuns(path, lines);
  const runText = new Map();
  for (const [index, line] of lines.entries()) {
    const run = runs[index + 1];
    if (run === 0) {
      continue;
    }
    runText.set(run, `${runText.get(run) ?? ""} ${line}`);
  }
  const pattern = new RegExp(
    `${specDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/([A-Za-z0-9._-]+\\.md)#([\\p{L}\\p{N}\\p{M}\\p{Pc}-]+)`,
    "gu",
  );
  const claims = [];
  for (const [index, line] of lines.entries()) {
    pattern.lastIndex = 0;
    let match = pattern.exec(line);
    while (match !== null) {
      const run = runs[index + 1];
      claims.push({
        file: match[1],
        slug: match[2],
        line: index + 1,
        // A citation on a non-prose line has no surrounding claim, so the line itself is used. That
        // is rare and it biases toward silence, which is the safe direction for a report.
        prose: run === 0 ? line : runText.get(run),
      });
      match = pattern.exec(line);
    }
  }
  return claims;
}

/**
 * Score one claim against a document, returning the suspect or `null`.
 *
 * The cited score is the **best body inside the cited heading's subtree**, so citing a parent whose
 * content lives in its children is never flagged. The rival is the best body outside that subtree.
 */
export function scoreClaim(claim, document, thresholds) {
  const { bodies, idf } = document;
  const cited = bodies.find((body) => body.slug === claim.slug);
  if (cited === undefined) {
    return null;
  }
  const words = contentWords(claim.prose);
  const mass = claimMass(words, idf);
  if (mass < thresholds.claimMass) {
    return null;
  }
  if (claimNamesHeading(words, cited.heading)) {
    return null;
  }
  const inside = new Set(subtreeOf(bodies, claim.slug));
  let citedScore = 0;
  let best = null;
  for (const [index, body] of bodies.entries()) {
    const score = bodyScore(words, body, idf, mass);
    if (inside.has(index)) {
      citedScore = Math.max(citedScore, score);
      continue;
    }
    if (best === null || score > best.score) {
      best = { slug: body.slug, score };
    }
  }
  if (
    best === null ||
    best.score < thresholds.floor ||
    best.score - citedScore <= thresholds.margin
  ) {
    return null;
  }
  return {
    cited: claim.slug,
    suggested: best.slug,
    citedScore,
    suggestedScore: best.score,
    delta: best.score - citedScore,
    relation: relationOf(bodies, claim.slug, best.slug),
  };
}

/**
 * Score every anchor citation under `roots` and return the ranked suspects, deduplicated.
 *
 * Findings cluster hard: one `(cited → suggested)` pair can account for dozens of sites, and a queue
 * whose first thirty rows are the same dismissal destroys a reviewer's trust in minutes. So the
 * queue is emitted **one row per pair**, with an occurrence count and a representative site. A
 * systematic false positive then costs one dismissal instead of thirty.
 *
 * @returns `{ scanned, scorable, sites, pairs, documents }`.
 */
export function scanSuspects({
  roots,
  specDirectory = SPEC_DIRECTORY,
  specRoot,
  thresholds = DEFAULT_THRESHOLDS,
  reslug,
} = {}) {
  const cache = new Map();
  const documentOf = (file) => {
    if (!cache.has(file)) {
      let entry = null;
      try {
        const lines = splitLines(
          readFileSync(join(specRoot ?? specDirectory, file), "utf8"),
        );
        const bodies = sectionBodies(lines);
        entry =
          bodies.length === 0
            ? null
            : { bodies, idf: inverseDocumentFrequency(bodies) };
      } catch {
        entry = null;
      }
      cache.set(file, entry);
    }
    return cache.get(file);
  };

  let scanned = 0;
  let scorable = 0;
  const sites = [];
  const repointableSites = [];
  const documents = new Set();

  for (const path of listCitationFiles(roots)) {
    if (insideSpecDirectory(path, specDirectory)) {
      continue;
    }
    const text = readTextFile(path);
    if (text === null || !text.includes(`${specDirectory}/`)) {
      continue;
    }
    for (const claim of anchorClaims(path, text, specDirectory)) {
      const document = documentOf(claim.file);
      if (document === null) {
        continue;
      }
      scanned += 1;
      documents.add(claim.file);
      if (document.bodies.length >= 2) {
        // Only a citation of a multi-section document can be repointed, so only these are sites the
        // self-check can plant an answer in. Recording them here — rather than re-walking the corpus
        // in `selfCheck` — keeps the control population defined by the scan that produces it.
        repointableSites.push(`${path}:${claim.line}`);
      }
      // `reslug` is the self-check's hook: it repoints a claim at a different real section so the
      // instrument can be scored against mutations we introduced ourselves.
      const scored = {
        ...claim,
        slug: reslug?.(claim, document) ?? claim.slug,
      };
      if (!document.bodies.some((body) => body.slug === scored.slug)) {
        continue;
      }
      scorable += 1;
      const suspect = scoreClaim(scored, document, thresholds);
      if (suspect !== null) {
        sites.push({
          ...suspect,
          site: `${path}:${claim.line}`,
          file: claim.file,
        });
      }
    }
  }

  const byPair = new Map();
  for (const site of sites) {
    const key = `${site.file}#${site.cited} -> #${site.suggested}`;
    const seen = byPair.get(key);
    if (seen === undefined) {
      // The representative is the FIRST site in scan order, which is deterministic because
      // `listCitationFiles` sorts. Picking the largest-delta instance instead would be marginally
      // more useful and materially harder to reproduce, and a queue a reviewer cannot reproduce is
      // worse than one whose example is merely the first.
      byPair.set(key, { ...site, occurrences: 1, example: site.site });
      continue;
    }
    seen.occurrences += 1;
    seen.delta = Math.max(seen.delta, site.delta);
  }
  const pairs = [...byPair.values()].sort(
    (left, right) => right.delta - left.delta,
  );
  return {
    scanned,
    scorable,
    sites,
    repointableSites,
    pairs,
    documents: [...documents].sort(),
  };
}

/** A deterministic PRNG, so the self-check samples the same sites on every run. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The band the seeded mutation control must land inside, and the sample size.
 *
 * **Calibrated to THIS scorer, and that is the point.** The design prototype measured ~25% recall
 * with a citing-line claim window; this implementation uses the enclosing prose run, IDF weighting
 * and leaf bodies, and measures ~55% on the same corpus. A band inherited from the prototype would
 * have failed every run of the shipped tool — so the band is re-measured whenever the scorer
 * changes, and the measured value is printed on every run rather than merely compared.
 *
 * Both bounds carry information. Falling through the floor means the instrument has stopped
 * detecting and a green queue would mean nothing. Punching through the ceiling means it has become
 * indiscriminate, which shows up as a queue explosion too but is cheaper to catch here.
 */
export const SELF_CHECK = Object.freeze({
  sample: 200,
  seed: 1180,
  floor: 0.3,
  ceiling: 0.8,
});

/**
 * Score the instrument against mutations **we** introduced, so a scan that has silently stopped
 * working cannot look like a clean corpus.
 *
 * A fixture canary rots; this one is generated from the live corpus every run. It repoints a seeded
 * sample of currently-clean citations at a different real section of the same document and asserts
 * the detection rate lands inside a two-sided band. **Both bounds carry information.** Falling
 * through the floor means the instrument broke — a tokenizer change, a heading-parse regression,
 * `proseRuns` returning nothing — which is exactly the silent failure being guarded against.
 * Punching through the ceiling means it became indiscriminate.
 *
 * The specificity question — "has it just become a thing that flags everything?" — is carried by the
 * ceiling and by `sampled > 0` together, not by a separate check. An earlier draft here also
 * compared the sample against the baseline's flagged set and called that a specificity half; it was
 * tautological, because the sample is drawn FROM the unflagged sites, so it could only ever report
 * zero. It was removed rather than covered. That is the eighth instrument-measuring-nothing defect
 * found in this saga, and the first one written by the session hunting the other seven — which is
 * the argument for the band being two-sided and generated from the live corpus rather than for
 * anybody's carefulness.
 *
 * This is the one part of this module that MAY fail a build, and it is not a topical judgement — it
 * is the tool asserting it still works on inputs whose answer we know.
 */
export function selfCheck(options = {}) {
  const random = seededRandom(SELF_CHECK.seed);
  const baseline = scanSuspects(options);
  const flagged = new Set(baseline.sites.map((site) => site.site));
  const clean = baseline.repointableSites.filter((site) => !flagged.has(site));
  const chosen = new Set();
  for (let index = 0; index < clean.length; index += 1) {
    if (chosen.size >= SELF_CHECK.sample) {
      break;
    }
    if (random() < SELF_CHECK.sample / Math.max(clean.length, 1)) {
      chosen.add(clean[index]);
    }
  }

  const mutated = scanSuspects({
    ...options,
    reslug: (claim, document) => {
      const others = document.bodies.filter((body) => body.slug !== claim.slug);
      return others[Math.floor(random() * others.length) % others.length].slug;
    },
  });
  const caughtSites = new Set(mutated.sites.map((site) => site.site));
  let sampled = 0;
  let caught = 0;
  for (const site of chosen) {
    sampled += 1;
    if (caughtSites.has(site)) {
      caught += 1;
    }
  }
  const detection = sampled === 0 ? 0 : caught / sampled;
  return {
    sampled,
    caught,
    detection,
    inBand:
      sampled > 0 &&
      detection >= SELF_CHECK.floor &&
      detection <= SELF_CHECK.ceiling,
    baseline,
  };
}

/**
 * Render the scan as a report.
 *
 * @returns `{ ok, lines }`. `ok` reflects the SELF-CHECK and the corpus invariants only; findings
 *   never make it false, because a heuristic that failed a build would be the same defect as a gate
 *   that measures nothing.
 */
export function reportSuspects(options = {}) {
  const check = selfCheck(options);
  const { scanned, scorable, sites, pairs, documents } = check.baseline;
  const lines = [];
  let ok = true;

  // Concentration is printed because it is how an attractor artifact becomes visible. A large
  // enumeration — a code registry, an output catalogue, a names list — contains every rare term in
  // its domain, so it wins against prose sections that merely STATE the rule. When one section
  // absorbs a large share of the queue that is a property of the scorer, not a discovery.
  const concentration = new Map();
  for (const pair of pairs) {
    const key = `${pair.file}#${pair.suggested}`;
    concentration.set(key, (concentration.get(key) ?? 0) + pair.occurrences);
  }
  const ranked = [...concentration.entries()].sort((a, b) => b[1] - a[1]);
  const total = sites.length;

  lines.push(
    `citation suspects: ${pairs.length} ranked pair(s) over ${total} site(s), from ${scorable} ` +
      `scorable of ${scanned} anchor(s) across ${documents.length} cited document(s)`,
  );
  lines.push(
    `  self-check: ${check.caught}/${check.sampled} seeded mutations detected ` +
      `(${(check.detection * 100).toFixed(1)}%, band ${(SELF_CHECK.floor * 100).toFixed(0)}-${(SELF_CHECK.ceiling * 100).toFixed(0)}%)` +
      `${check.inBand ? "" : " — OUT OF BAND"}`,
  );
  if (!check.inBand) {
    ok = false;
    lines.push(
      "FAIL the seeded mutation control is out of band. Below the floor the instrument has stopped " +
        "detecting and a green queue would mean nothing; above the ceiling it has become " +
        "indiscriminate. This is the one thing here that can fail, because it is the tool checking " +
        "itself against answers we planted.",
    );
  }
  if (scanned === 0) {
    ok = false;
    lines.push(
      "FAIL no anchor was scanned at all — the scan is measuring nothing, which is indistinguishable " +
        "from a clean corpus in every other respect",
    );
  }
  for (const [section, count] of ranked.slice(0, 3)) {
    // `ranked` is non-empty only when `pairs` is, which requires sites, so `total` is never zero here.
    const share = count / total;
    lines.push(
      `  attractor check: ${section} absorbs ${count} site(s) (${(share * 100).toFixed(0)}%)` +
        `${share > 0.25 ? " — ARTIFACT, not a discovery: a large enumeration wins on vocabulary alone" : ""}`,
    );
  }

  for (const pair of pairs) {
    lines.push(
      `RANKED ${pair.file}#${pair.cited} -> #${pair.suggested} ` +
        `(${pair.occurrences} site(s), delta ${pair.delta.toFixed(2)}, ${pair.relation}) ` +
        `e.g. ${pair.example}`,
    );
  }

  lines.push(
    "  This is a RANKED REPORT, not a gate. It scores the prose around a citation against every " +
      "section of the document it cites and lists where another section matches better. It NEVER " +
      "fails on a finding, and its silence proves nothing: measured recall against seeded mutations " +
      "is roughly a quarter, so three of four deliberately broken anchors score clean. The flag " +
      "count is a property of THIS instrument — two implementations written from the same " +
      "description differed by 2.3x on the same tree — so it is a queue to read, never a measurement " +
      "of how many citations are wrong. It cannot tell a WRONG anchor from a LESS SPECIFIC one, " +
      "which is why each row reports whether the suggestion is a sibling of the cited section: " +
      "sibling rows are usually imprecision, distant rows more often error. A row is resolved by " +
      "reading the claim and the section and deciding — never by re-pointing what the tool ranked. " +
      "The only failing paths above are the seeded self-check and the corpus invariants, which are " +
      "the tool checking itself rather than judging a citation.",
  );
  return { ok, lines };
}

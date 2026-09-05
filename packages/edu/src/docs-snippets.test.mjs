// Doc-snippet execution test (issue #398). The `.logo` snippets in the learner-facing docs
// (`docs/educational-commands.md`, `docs/curriculum-overview.md`) are hand-authored prose
// examples, not extracted from the runtime, so they can silently drift from real behavior. This
// harness extracts every fenced OpenLogo block and runs it through `@openlogo/runtime`, asserting
// each snippet still matches its documented behavior: run cleanly, or — for a snippet that
// deliberately demonstrates a diagnostic — raise exactly that `ol-*` code.
//
// There are currently no fenced *hint fragments* to mark parse-only: the progressive-hint
// examples in educational-commands.md are prose plus inline code, never fenced ```logo blocks, so
// every fenced block here is a complete program. If a future doc adds a deliberately-partial
// fenced fragment, extend `EXPECTED_DIAGNOSTIC` (or add a parse-only class) rather than letting it
// fail as an unexpected error.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as OL from "@openlogo/edu";
import { execute } from "@openlogo/runtime";

// This test lives at packages/edu/src/, so the repo root is three levels up.
const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/** The learner-facing docs whose fenced OpenLogo snippets must stay executable. */
const DOC_FILES = [
  "docs/educational-commands.md",
  "docs/curriculum-overview.md",
];

/**
 * Snippets that intentionally demonstrate a diagnostic instead of running cleanly, keyed by their
 * leading `# why:` comment (unique and stable per snippet). Everything else must execute with no
 * diagnostics. The `debug` example shows a word flowing into `forward`, which the doc documents as
 * producing `ol-type` — this asserts that claim stays true.
 */
const EXPECTED_DIAGNOSTIC = new Map([
  [
    "# why: debug can show that :size is a word when forward needs a number",
    "ol-type",
  ],
]);

/** Matches a fenced OpenLogo block, capturing its inner source (line endings already normalized). */
const FENCE = /```logo\n([\s\S]*?)```/g;

/**
 * How many ` ```logo ` blocks and how many "prints `…`" claims `docs/curriculum-overview.md`
 * carries. Pinned so the harness cannot silently enumerate a narrower set than the document —
 * a deleted block or a re-worded claim must be an explicit, deliberate edit here.
 */
const CURRICULUM_LOGO_BLOCK_COUNT = 10;
const CURRICULUM_PRINT_CLAIM_COUNT = 4;

/** Extract every fenced OpenLogo snippet from `relativePath`, normalizing CRLF so keys are stable. */
function extractSnippets(relativePath) {
  const text = readFileSync(join(repoRoot, relativePath), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  const snippets = [];
  let match = FENCE.exec(text);
  while (match !== null) {
    snippets.push(match[1]);
    match = FENCE.exec(text);
  }
  return snippets;
}

// Round 2 (@testing finding 3): every `logo` block in `docs/curriculum-overview.md` is currently
// byte-identical to a lesson worked example or reference solution, and that identity is load
// bearing. The doc states derived numbers beside its blocks ("That prints `1 1 1 1`", "prints
// `42` then `5`"), but neither gate that reads the doc asserts a value: `check-markdown-examples`
// only requires a block to run clean, and the per-snippet test above only requires no diagnostics
// plus at least one event. The VALUES are asserted in `lessons/level-*.test.mjs` — against the
// LESSON sources. So if a doc block and its lesson source ever drift apart, the doc's numbers
// silently stop being measured by anything while every gate stays green. Pinning the identity is
// what keeps the doc's prose covered by the lesson tests.
test("every curriculum-overview logo block is byte-identical to a lesson source", () => {
  const curriculumSnippets = extractSnippets("docs/curriculum-overview.md");
  // Round 2 (@testing finding 3, second half): `> 0` guards against a totally-vacuous match but
  // not against losing one block. The count is pinned so a deleted or re-labelled fence fails
  // here rather than quietly reducing what is measured.
  assert.equal(
    curriculumSnippets.length,
    CURRICULUM_LOGO_BLOCK_COUNT,
    "docs/curriculum-overview.md gained or lost a ```logo block; update the count deliberately",
  );

  const lessonSources = new Set([
    ...OL.LESSONS.flatMap((lesson) =>
      lesson.workedExamples.map((example) => example.source),
    ),
    ...OL.EXERCISES.map((exercise) => exercise.referenceSolution.source),
  ]);
  assert.ok(lessonSources.size > 0);

  for (const [index, snippet] of curriculumSnippets.entries()) {
    // Fenced blocks carry a trailing newline the authored `source` strings do not.
    assert.equal(
      lessonSources.has(snippet.replace(/\n$/, "")),
      true,
      `docs/curriculum-overview.md block #${index} matches no lesson source, so the numbers stated beside it are measured by nothing:\n${snippet}`,
    );
  }
});

// Round 2 (rubber-duck, blocking): byte-identity between a doc block and a lesson source does
// NOT pin the numbers the doc states *beside* the block. Mutation-confirmed by the reviewer:
// changing a documented output from `1 1 1 1` to `2 2 2 2` left all 16 snippet tests green,
// because the block itself still ran clean and still matched a lesson source. The prose claim is
// the thing a learner reads, so it is executed here: every "prints `…`" sentence following a
// block is compared against what that block actually prints.
test("every 'prints ...' claim in curriculum-overview matches what the block above it prints", () => {
  const text = readFileSync(
    join(repoRoot, "docs/curriculum-overview.md"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  // Split on fences so each block is paired with the prose around it.
  const parts = text.split(/```logo\n([\s\S]*?)```/);
  const claims = [];

  /**
   * The last sentence of `prose`, which is where a lead-in claim ending in ":" lives. `split`
   * always yields at least one element, so no empty fallback is needed (and an unreachable one
   * would be an uncovered branch under the 100% gate).
   */
  const lastSentence = (prose) => {
    const paragraphs = prose.trim().split(/\n\s*\n/);
    const sentences = paragraphs[paragraphs.length - 1].split(/(?<=\.)\s+/);
    return sentences[sentences.length - 1];
  };

  /** The first sentence of `prose`, which is where a trailing claim lives. */
  const firstSentence = (prose) => prose.trim().split(/(?<=\.)\s+/)[0];

  // A claim names the block it is adjacent to, so it must be in the sentence touching the fence
  // — not merely somewhere in the paragraph. "That prints `1 1 1 1`. Move the one line above the
  // loop and the same body counts up:" precedes the SECOND block, and its claim belongs to the
  // first; sentence scoping is what keeps that from being mis-attributed.
  const CLAIM = /\bprints\s+(`[^`]+`(?:\s+(?:then|and)\s+`[^`]+`)*)/;

  // parts = [prose, block, prose, block, ..., prose] — `split` with one capture group always
  // brackets every block with prose, so parts[index - 1] and parts[index + 1] both exist.
  for (let index = 1; index < parts.length; index += 2) {
    const source = parts[index];
    for (const sentence of [
      lastSentence(parts[index - 1]),
      firstSentence(parts[index + 1]),
    ]) {
      const claim = sentence.match(CLAIM);
      // "prints nothing at all" carries no backticks and is a statement about a different,
      // counterfactual program, so it deliberately does not match.
      if (claim === null) {
        continue;
      }
      const spans = [...claim[1].matchAll(/`([^`]+)`/g)].map((match) =>
        match[1].trim(),
      );
      const expected = spans.flatMap((span) => span.split(/\s+/).map(Number));
      claims.push({ source, expected, spans, sentence: claim[0] });
    }
  }

  // The instrument must not silently enumerate nothing: the doc makes exactly these claims today.
  assert.equal(
    claims.length,
    CURRICULUM_PRINT_CLAIM_COUNT,
    "the number of 'prints ...' claims in curriculum-overview.md changed; update the count deliberately",
  );

  // Round 3 (@testing finding 1): the count above pins how many claims the sentence-scoped walk
  // FOUND, which is not the same number as how many the document CONTAINS. A reviewer added a
  // false claim as a second sentence — "It also prints `9 9 9 9`." — where `firstSentence` never
  // looks, and every gate stayed green. So the walk is cross-checked against a document-wide
  // oracle of a different shape: a plain count of "prints `…`" occurrences anywhere in the file.
  // If the two disagree, a claim exists that nothing is measuring, and that fails here rather
  // than shipping a number no test has ever run.
  const everyClaimInDocument = [...text.matchAll(new RegExp(CLAIM, "g"))];
  assert.equal(
    everyClaimInDocument.length,
    claims.length,
    `docs/curriculum-overview.md contains ${everyClaimInDocument.length} "prints ..." claim(s) but only ${claims.length} sit in a sentence touching a code block, so the rest are measured by nothing: ${JSON.stringify(everyClaimInDocument.map((match) => match[0]))}`,
  );

  // Round 4 (@testing finding 2): that oracle shares `CLAIM` with the walk, so it is a second
  // opinion in name only — a reviewer defeated both with one extra word, "prints **the value**
  // `9 9 9 9`", which is natural English and matches neither. This third check keys on the VALUE
  // SHAPE instead of the verb, so it shares no vocabulary with `CLAIM`: every numeric inline-code
  // span in the doc's prose must be a value some accounted-for claim actually printed. Its own
  // blind spot is a non-numeric printed value, which is stated rather than chased.
  const prose = text.split(/```[\s\S]*?```/).join("\n");
  const numericSpans = [...prose.matchAll(/`([0-9]+(?:\s+[0-9]+)*)`/g)].map(
    (match) => match[1].trim(),
  );
  const accountedFor = new Set(claims.flatMap(({ spans }) => spans));
  for (const span of numericSpans) {
    assert.ok(
      accountedFor.has(span),
      `docs/curriculum-overview.md states \`${span}\` in prose, but no measured "prints ..." claim produces it — a printed value stated in words that the claim extractor does not recognise is measured by nothing`,
    );
  }

  for (const { source, expected, sentence } of claims) {
    const result = execute(source, "curriculum-overview-claim.logo");
    assert.deepEqual(result.diagnostics, []);
    const printed = result.events
      .filter((event) => event.kind === "print")
      .flatMap((event) => event.payload.values);
    assert.deepEqual(
      printed,
      expected,
      `the doc says "${sentence}" but the block above it prints ${JSON.stringify(printed)}`,
    );
  }
});

// Round 2 (@testing finding 2): the doc quotes the `ol-var-not-visible` message in a ```text
// block, which neither markdown gate executes and neither identity test reaches — so if the
// runtime's wording changed, `level-5.ts`'s copy would be caught (level-5.test.mjs pins it) and
// the doc's copy would silently drift. The doc's copy is hard-wrapped, so it is compared with
// whitespace normalized rather than byte for byte.
test("the diagnostic quoted in curriculum-overview is the message the runtime actually produces", () => {
  const text = readFileSync(
    join(repoRoot, "docs/curriculum-overview.md"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const quoted = [...text.matchAll(/```text\n([\s\S]*?)```/g)].map((match) =>
    match[1].trim().replace(/\s+/g, " "),
  );
  assert.equal(
    quoted.length,
    1,
    "expected exactly one quoted diagnostic block",
  );

  const broken = [
    ":count = 0",
    "define bump",
    "  :count = :count + 1",
    "end",
    "",
    "bump",
    "print :count",
  ].join("\n");
  const result = execute(broken, "curriculum-overview-diagnostic.logo");
  const boundary = result.diagnostics.find(
    (diagnostic) => diagnostic.code === "ol-var-not-visible",
  );
  assert.ok(boundary, "expected the program to raise ol-var-not-visible");
  assert.equal(quoted[0], boundary.message.replace(/\s+/g, " "));
});

for (const relativePath of DOC_FILES) {
  const snippets = extractSnippets(relativePath);

  test(`${relativePath} contains at least one fenced OpenLogo snippet`, () => {
    assert.ok(
      snippets.length > 0,
      `no fenced OpenLogo snippets found in ${relativePath}`,
    );
  });

  snippets.forEach((source, index) => {
    const firstLine = source.split("\n")[0];
    const expectedDiagnostic = EXPECTED_DIAGNOSTIC.get(firstLine);

    test(`${relativePath} snippet #${index} matches its documented runtime behavior`, () => {
      const result = execute(source, `${relativePath}#${index}`);

      if (expectedDiagnostic === undefined) {
        assert.deepEqual(
          result.diagnostics,
          [],
          `snippet #${index} raised diagnostics: ${JSON.stringify(result.diagnostics)}`,
        );
        assert.ok(
          result.events.length > 0,
          `snippet #${index} produced no events`,
        );
      } else {
        assert.ok(
          result.diagnostics.some((d) => d.code === expectedDiagnostic),
          `snippet #${index} expected an ${expectedDiagnostic} diagnostic, got ${JSON.stringify(result.diagnostics)}`,
        );
      }
    });
  });
}

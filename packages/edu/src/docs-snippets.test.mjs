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

// Round 1 (@testing finding 3): every `logo` block in `docs/curriculum-overview.md` is currently
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
  assert.ok(curriculumSnippets.length > 0);

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

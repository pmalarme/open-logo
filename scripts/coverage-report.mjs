// OpenLogo language coverage report — discovers conformance fixtures and reports which are present.
// This is LANGUAGE coverage (every grammar production/variant is proven by a fixture), distinct
// from LINE coverage (every TS line is hit by a test).
//
// Usage: node scripts/coverage-report.mjs
// Exits 0 (report only, no enforcement yet). As S3-S22 stories land, fixtures will declare their
// story/row metadata and this report will compute coverage from discovered fixtures.

import { existsSync, readdirSync } from "node:fs";
import { basename, sep } from "node:path";

const ROOT = "tests/conformance";
const EXPECTED_SUFFIX = ".expected.json";

/** Discover fixture stems under tests/conformance/, excluding _harness-selftest/. */
function discoverFixtures() {
  if (!existsSync(ROOT)) {
    return [];
  }
  const stems = new Set();
  for (const entry of readdirSync(ROOT, { recursive: true }).map(String)) {
    if (!entry.endsWith(EXPECTED_SUFFIX)) {
      continue;
    }
    // Skip harness self-tests
    if (entry.startsWith("_harness-selftest")) {
      continue;
    }
    // Group by profile directory (e.g., "core-language")
    const parts = entry.split(sep);
    const profile = parts[0];
    const stem = basename(entry).slice(0, -EXPECTED_SUFFIX.length);
    stems.add(`${profile}/${stem}`);
  }
  return Array.from(stems).sort();
}

function main() {
  const fixtures = discoverFixtures();

  console.log("Language Coverage Report");
  console.log("========================\n");
  console.log(`Discovered ${fixtures.length} conformance fixture(s):\n`);

  if (fixtures.length === 0) {
    console.log("  (none)\n");
  } else {
    for (const fixture of fixtures) {
      console.log(`  ✓ ${fixture}`);
    }
    console.log("");
  }

  console.log(
    "Note: As S3-S22 production stories land, fixtures will declare story/row metadata",
  );
  console.log(
    "and this report will compute grammar coverage. For M1 (harness infra only),",
  );
  console.log("we report fixtures present without mapping to production rows.");

  return 0;
}

process.exit(main());
      "parenthesized-expression",
      "negative:unmatched-bracket",
      "negative:unmatched-paren",
    ],
    owner: "@interpreter",
  },
  S5: {
    name: "Variable Reads and Simple Places",
    rows: ["variable-read-colon", "simple-colon-place", "simple-bare-place"],
    owner: "@interpreter",
  },
  S6: {
    name: "Nested Places and Postfix Selectors",
    rows: [
      "field-access",
      "selector-numeric-index",
      "selector-var-key",
      "selector-string-key",
      "selector-expr-key",
      "deeply-nested-field",
      "mixed-postfixes",
      "negative:invalid-place-assignment",
    ],
    owner: "@interpreter",
  },
  S7: {
    name: "Arithmetic Operators and Precedence",
    rows: [
      "addition-subtraction",
      "negative-literal-distinction",
      "multiplication-division-modulo",
      "prefix-not",
      "precedence-nesting",
      "complex-precedence",
    ],
    owner: "@interpreter",
  },
  S8: {
    name: "Comparison Operators (Simple)",
    rows: [
      "equality-double-equals",
      "inequality-not-equals",
      "less-greater-le-ge",
    ],
    owner: "@interpreter",
  },
  S9: {
    name: "Chained Comparisons with Single-Evaluation Semantics",
    rows: ["chained-comparison-two-ops", "three-way-chain"],
    owner: "@interpreter",
  },
  S10: {
    name: "Worded `is`-Predicates",
    rows: [
      "is-empty",
      "is-member-of",
      "is-a-type",
      "is-between",
      "is-strictly-between",
      "contextual-keywords-not-reserved",
    ],
    owner: "@interpreter",
  },
  S11: {
    name: "Logical Operators and Variadic Forms",
    rows: ["and-infix", "or-infix", "variadic-and-paren", "variadic-or-paren"],
    owner: "@interpreter",
  },
  S12: {
    name: "Assignment",
    rows: [
      "assignment-equals-form",
      "assignment-set-to-form",
      "assignment-nested-place",
    ],
    owner: "@interpreter",
  },
  S13: {
    name: "Local Variables",
    rows: ["local-single", "local-multi-paren"],
    owner: "@interpreter",
  },
  S14: {
    name: "Control Forms — Short Bodies",
    rows: [
      "if-bracket-no-else",
      "if-bracket-with-else",
      "while-bracket",
      "repeat-bracket",
      "forever-bracket",
    ],
    owner: "@interpreter",
  },
  S15: {
    name: "Control Forms — Long Bodies with `end` Labels",
    rows: [
      "if-end",
      "if-else-end",
      "while-end",
      "repeat-end",
      "forever-end",
      "negative:missing-end",
      "negative:mismatched-end",
    ],
    owner: "@interpreter",
  },
  S16: {
    name: "`for` Loops and Binders",
    rows: [
      "for-in-simple-binder",
      "for-in-destructuring",
      "for-in-long-form",
      "for-range-no-by",
      "for-range-with-by",
      "for-range-long-form",
    ],
    owner: "@interpreter",
  },
  S17: {
    name: "Procedures",
    rows: [
      "define-no-params",
      "define-required-params",
      "define-optional-params",
      "define-mixed-params",
      "return",
      "stop",
      "throw",
      "negative:return-outside-proc",
      "negative:stop-outside-proc",
    ],
    owner: "@interpreter",
  },
  S18: {
    name: "Comprehensions",
    rows: [
      "map",
      "filter",
      "reduce",
      "comprehension-destructuring-binder",
      "negative:return-in-comprehension",
    ],
    owner: "@interpreter",
  },
  S19: {
    name: "Blocks, Terminators, and Statement Separation",
    rows: [
      "bracketed-block-multi-stmt",
      "long-block-end",
      "top-level-separator",
      "consecutive-newlines",
      "optional-final-newline",
      "expression-block",
    ],
    owner: "@interpreter",
  },
  S20: {
    name: "Calls and Arity",
    rows: [
      "fixed-arity-call",
      "parenthesized-call",
      "nested-reporters",
      "callee-span-accuracy",
    ],
    owner: "@interpreter",
  },
  S21: {
    name: "Comments",
    rows: [
      "line-comment-hash",
      "line-comment-slash",
      "block-comment",
      "comment-inside-string",
      "negative:unclosed-block-comment",
    ],
    owner: "@interpreter",
  },
  S22: {
    name: "Reserved Words and Negative Diagnostics",
    rows: [
      "reserved-word-collision",
      "contextual-keywords-not-reserved",
      "negative:bad-token-comma",
      "negative:unknown-command-did-you-mean",
    ],
    owner: "@interpreter",
  },
};

/** Discover fixture stems under tests/conformance/. Exclude _harness-selftest/. */
function discoverFixtures() {
  if (!existsSync(ROOT)) {
    return [];
  }
  const stems = [];
  for (const entry of readdirSync(ROOT, { recursive: true }).map(String)) {
    if (!entry.endsWith(EXPECTED_SUFFIX)) {
      continue;
    }
    // Skip harness self-tests
    if (entry.startsWith("_harness-selftest")) {
      continue;
    }
    const stem = basename(entry).slice(0, -EXPECTED_SUFFIX.length);
    stems.push(stem);
  }
  return stems;
}

/** Map fixture stems to their story/row, or null if no match. Very basic heuristic: a fixture
 * matches a row if the row slug appears as a substring in the fixture stem. This is fragile but
 * sufficient for M1; refine if needed. */
function matchRow(fixtureStem, row) {
  return fixtureStem.includes(row);
}

function main() {
  const fixtures = discoverFixtures();

  console.log("OpenLogo Core Language Coverage Report");
  console.log("=====================================\n");
  console.log(
    `Fixtures discovered: ${fixtures.length} under ${ROOT}/ (excluding _harness-selftest/)\n`,
  );

  let totalRows = 0;
  let coveredRows = 0;
  const storyCoverage = [];

  for (const [storyId, story] of Object.entries(CONFORMANCE_MATRIX)) {
    if (story.rows.length === 0) {
      // S1 and S2 have no production rows
      console.log(`${storyId}: ${story.name} (no production rows)`);
      continue;
    }

    const covered = [];
    const missing = [];
    for (const row of story.rows) {
      const match = fixtures.some((stem) => matchRow(stem, row));
      if (match) {
        covered.push(row);
      } else {
        missing.push(row);
      }
    }

    totalRows += story.rows.length;
    coveredRows += covered.length;
    const pct = ((covered.length / story.rows.length) * 100).toFixed(0);

    console.log(
      `${storyId}: ${story.name} — ${covered.length}/${story.rows.length} rows covered (${pct}%)`,
    );
    if (missing.length > 0 && missing.length <= 10) {
      console.log(`  Missing: ${missing.join(", ")}`);
    } else if (missing.length > 10) {
      console.log(
        `  Missing: ${missing.slice(0, 10).join(", ")} … (${missing.length - 10} more)`,
      );
    }

    storyCoverage.push({
      storyId,
      covered: covered.length,
      total: story.rows.length,
    });
  }

  const overallPct =
    totalRows === 0 ? 100 : ((coveredRows / totalRows) * 100).toFixed(1);
  console.log(
    `\nOverall: ${coveredRows}/${totalRows} rows covered (${overallPct}%)`,
  );

  if (overallPct < 100) {
    console.log(
      "\nNote: This is LANGUAGE coverage (grammar productions proven by fixtures), distinct from LINE coverage.",
    );
    console.log("As S3-S22 stories land, this report will approach 100%.");
  }

  process.exit(0);
}

main();

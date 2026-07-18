// OpenLogo language coverage report — compares present conformance fixtures against the Core
// Language conformance matrix (S1-S22 stories from conformance-matrix-v2.md) and reports which
// production rows are covered. This is LANGUAGE coverage (every grammar production/variant is
// proven by a fixture), distinct from LINE coverage (every TS line is hit by a test).
//
// Usage: node scripts/coverage-report.mjs
// Exits 0 (report only, no enforcement yet); when S3-S22 land, this becomes a gate.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, sep } from "node:path";

const ROOT = "tests/conformance";
const EXPECTED_SUFFIX = ".expected.json";

// Core Language conformance matrix from conformance-matrix-v2.md. This is the authoritative
// enumeration of Core productions we must prove via fixtures. S1 (INFRA) has no production rows;
// S2 (ADR-0009) is docs only. S3-S22 are grammar/semantic productions (20 production stories).
const CONFORMANCE_MATRIX = {
  S1: {
    name: "INFRA — Conformance Harness + Fixture Format",
    rows: [],
    owner: "@testing",
  },
  S2: {
    name: "ADR-0009 Test Layout Convention",
    rows: [],
    owner: "@testing",
  },
  S3: {
    name: "Literals — Numbers, Words, Booleans",
    rows: [
      "integer-literal",
      "negative-integer",
      "decimal-literal",
      "scientific-notation",
      "single-line-string",
      "multi-line-string",
      "string-escapes",
      "boolean-true-false",
      "negative:unclosed-single-line-string",
      "negative:unclosed-multi-line-string",
    ],
    owner: "@interpreter",
  },
  S4: {
    name: "List Literals and Parenthesized Expressions",
    rows: [
      "empty-list",
      "non-empty-list",
      "nested-lists",
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

// Unit tests for the coverage-gate classifier (issue #417). These import the classifier module
// directly (per ADR-0009) and exercise every branch to 100%. Report fixtures mirror the real
// `node --test --experimental-test-coverage` table format captured from a live run.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Outcome,
  countTestFailures,
  parseCoverageReport,
  classifyCoverageOutcome,
  describeShortfall,
  parseMaxAttempts,
} from "./classify.mjs";

/**
 * Build a coverage-report block. `fileRows` are `[name, line, branch, funcs, uncovered]` tuples
 * (strings); `aggregate` is the `all files` row as `[line, branch, funcs]`. When `aggregate` is
 * null the `all files` row is omitted. `trailingPipe: false` drops the final `|` on file rows so
 * the uncovered column is absent (exercises the default-parameter path).
 */
function makeReport(
  fileRows,
  aggregate,
  { trailingPipe = true, withAllFiles = true } = {},
) {
  const lines = [
    "# start of coverage report",
    "# ------------------------------------------------------",
    "# file       | line % | branch % | funcs % | uncovered lines",
    "# ------------------------------------------------------",
    "# packages   |        |          |         | ",
    "#  core      |        |          |         | ",
    "#   dist     |        |          |         | ",
  ];
  for (const [name, line, branch, funcs, uncovered = ""] of fileRows) {
    const tail = trailingPipe ? ` | ${uncovered}` : "";
    lines.push(`#    ${name} | ${line} | ${branch} | ${funcs}${tail}`);
  }
  if (withAllFiles && aggregate !== null) {
    const [line, branch, funcs] = aggregate;
    lines.push(`# all files | ${line} | ${branch} | ${funcs} | `);
  }
  lines.push("# end of coverage report");
  return lines.join("\n");
}

// --- countTestFailures -----------------------------------------------------------------------

test("countTestFailures returns 0 when no summary is present", () => {
  assert.equal(countTestFailures("no tap summary here"), 0);
});

test("countTestFailures reads the fail count", () => {
  assert.equal(countTestFailures("# pass 10\n# fail 3\n"), 3);
});

test("countTestFailures takes the last summary occurrence", () => {
  assert.equal(countTestFailures("# fail 5\n# fail 0\n"), 0);
});

// --- parseCoverageReport ---------------------------------------------------------------------

test("parseCoverageReport reports absent when no report block", () => {
  const result = parseCoverageReport("just some logs\n# pass 1\n");
  assert.equal(result.present, false);
  assert.deepEqual(result.rows, []);
  assert.equal(result.allFiles, null);
});

test("parseCoverageReport reports absent when end precedes start", () => {
  const scrambled = "# end of coverage report\n# start of coverage report\n";
  assert.equal(parseCoverageReport(scrambled).present, false);
});

test("parseCoverageReport skips header, separators, and directory rows", () => {
  const report = makeReport(
    [["values.js", "100.00", "100.00", "100.00", ""]],
    ["100.00", "100.00", "100.00"],
  );
  const result = parseCoverageReport(report);
  assert.equal(result.present, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].name, "values.js");
  assert.equal(result.rows[0].branch, 100);
  assert.equal(result.allFiles.branch, 100);
});

test("parseCoverageReport handles a row without an uncovered column", () => {
  const report = makeReport(
    [["values.js", "100.00", "100.00", "100.00"]],
    ["100.00", "100.00", "100.00"],
    { trailingPipe: false },
  );
  const result = parseCoverageReport(report);
  assert.equal(result.rows[0].uncovered, "");
});

test("parseCoverageReport returns present with null aggregate when all-files row missing", () => {
  const report = makeReport(
    [["values.js", "100.00", "100.00", "100.00", ""]],
    null,
    { withAllFiles: false },
  );
  const result = parseCoverageReport(report);
  assert.equal(result.present, true);
  assert.equal(result.allFiles, null);
});

// --- classifyCoverageOutcome -----------------------------------------------------------------

test("classify: exit 0 is a pass regardless of output", () => {
  assert.equal(
    classifyCoverageOutcome({ output: "", exitCode: 0 }),
    Outcome.PASS,
  );
});

test("classify: a real test failure fails fast", () => {
  const report = makeReport(
    [["values.js", "100.00", "100.00", "100.00", ""]],
    ["100.00", "99.99", "100.00"],
  );
  const output = `# fail 2\n${report}`;
  assert.equal(classifyCoverageOutcome({ output, exitCode: 1 }), Outcome.FAIL);
});

test("classify: unparseable report fails fast", () => {
  assert.equal(
    classifyCoverageOutcome({ output: "boom, no report", exitCode: 1 }),
    Outcome.FAIL,
  );
});

test("classify: report present but no aggregate fails fast", () => {
  const report = makeReport(
    [["values.js", "100.00", "100.00", "100.00", ""]],
    null,
    { withAllFiles: false },
  );
  assert.equal(
    classifyCoverageOutcome({ output: report, exitCode: 1 }),
    Outcome.FAIL,
  );
});

test("classify: non-zero exit with a fully-100 aggregate fails fast", () => {
  const report = makeReport(
    [["values.js", "100.00", "100.00", "100.00", ""]],
    ["100.00", "100.00", "100.00"],
  );
  assert.equal(
    classifyCoverageOutcome({ output: report, exitCode: 1 }),
    Outcome.FAIL,
  );
});

test("classify: a larger aggregate dip (regression #417 run 9: 99.87 line / 99.96 func) is retried", () => {
  // @testing observed this exact shape exit 1 with the old magnitude gate classifying it FAIL on the
  // first attempt (retry never engaged). The artifact is not magnitude-bounded, so it must RETRY; a
  // genuine gap of this size would be deterministic and still fail after every retry.
  const report = makeReport(
    [["evaluate.js", "99.87", "100.00", "99.96", "1490-1493"]],
    ["99.87", "100.00", "99.96"],
  );
  assert.equal(
    classifyCoverageOutcome({ output: report, exitCode: 1 }),
    Outcome.RETRY,
  );
});

test("classify: a single file dipping well below the aggregate (regression #417 run 8) is retried", () => {
  // Aggregate stays high (99.92) while one file transiently drops far under load. The old per-file
  // floor mis-classified this as a real gap and failed fast; it is the stochastic artifact → RETRY.
  const report = makeReport(
    [
      ["values.js", "100.00", "100.00", "100.00", ""],
      ["evaluate.js", "90.00", "90.00", "100.00", "1450-1493"],
    ],
    ["99.92", "100.00", "100.00"],
  );
  assert.equal(
    classifyCoverageOutcome({ output: report, exitCode: 1 }),
    Outcome.RETRY,
  );
});

test("classify: real merge artifact — evaluate.js file row fractionally short — is retried", () => {
  // Captured shape of the #417 flake: the dip localizes to one file row (evaluate.js) that lists a
  // line or two as uncovered, with the aggregate a hundredth of a percent short. This must RETRY.
  const report = makeReport(
    [
      ["values.js", "100.00", "100.00", "100.00", ""],
      ["evaluate.js", "99.94", "99.90", "100.00", "1545-1546"],
    ],
    ["100.00", "99.99", "100.00"],
  );
  assert.equal(
    classifyCoverageOutcome({ output: report, exitCode: 1 }),
    Outcome.RETRY,
  );
});

test("classify: aggregate-only dip (all file rows 100) is retried", () => {
  const report = makeReport(
    [
      ["values.js", "100.00", "100.00", "100.00", ""],
      ["evaluate.js", "100.00", "100.00", "100.00", ""],
    ],
    ["100.00", "99.99", "100.00"],
  );
  assert.equal(
    classifyCoverageOutcome({ output: report, exitCode: 1 }),
    Outcome.RETRY,
  );
});

test("classify: shortfall with no file rows (aggregate-only) is retried", () => {
  const report = makeReport([], ["100.00", "99.99", "100.00"]);
  assert.equal(
    classifyCoverageOutcome({ output: report, exitCode: 1 }),
    Outcome.RETRY,
  );
});

// --- describeShortfall -----------------------------------------------------------------------

test("describeShortfall returns '' when there is no report", () => {
  assert.equal(describeShortfall({ output: "no report here" }), "");
});

test("describeShortfall lists short file rows (with and without uncovered lines) and aggregate", () => {
  const report = makeReport(
    [
      ["values.js", "100.00", "100.00", "100.00", ""],
      ["evaluate.js", "99.94", "99.90", "100.00", "1545-1546"],
      ["reader.js", "99.80", "100.00", "100.00", ""],
    ],
    ["100.00", "99.99", "100.00"],
  );
  const summary = describeShortfall({ output: report });
  assert.match(
    summary,
    /evaluate\.js \(99\.94 line \/ 99\.9 branch \/ 100 func, uncovered 1545-1546\)/,
  );
  assert.match(summary, /reader\.js \(99\.8 line \/ 100 branch \/ 100 func\)/);
  assert.match(summary, /aggregate \(100 line \/ 99\.99 branch \/ 100 func\)/);
  assert.doesNotMatch(summary, /values\.js/);
});

test("describeShortfall returns '' when every row and the aggregate are fully covered", () => {
  const report = makeReport(
    [["values.js", "100.00", "100.00", "100.00", ""]],
    ["100.00", "100.00", "100.00"],
  );
  assert.equal(describeShortfall({ output: report }), "");
});

test("describeShortfall omits the aggregate when the all-files row is absent", () => {
  const report = makeReport(
    [["evaluate.js", "99.94", "99.90", "100.00", "1545-1546"]],
    null,
    { withAllFiles: false },
  );
  const summary = describeShortfall({ output: report });
  assert.match(summary, /evaluate\.js/);
  assert.doesNotMatch(summary, /aggregate/);
});

// --- parseMaxAttempts ------------------------------------------------------------------------

test("parseMaxAttempts accepts a positive integer string", () => {
  assert.equal(parseMaxAttempts("5"), 5);
});

test("parseMaxAttempts falls back for empty, zero, negative, fractional, or non-numeric input", () => {
  assert.equal(parseMaxAttempts(undefined), 5);
  assert.equal(parseMaxAttempts(""), 5);
  assert.equal(parseMaxAttempts("0"), 5);
  assert.equal(parseMaxAttempts("-2"), 5);
  assert.equal(parseMaxAttempts("2.5"), 5);
  assert.equal(parseMaxAttempts("abc"), 5);
});

test("parseMaxAttempts honours a custom fallback", () => {
  assert.equal(parseMaxAttempts("nope", 1), 1);
});

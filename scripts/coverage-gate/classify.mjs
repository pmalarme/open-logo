// Deterministic-gate logic for `npm run coverage` (issue #417).
//
// Root cause: Node's parallel `--experimental-test-coverage` merges per-process V8 block-coverage
// ranges across worker/child processes. For a hot, recursive function (`printedForm` in
// `@openlogo/runtime`'s `evaluate.js`) V8 emits *optimization-dependent* range boundaries —
// interpreted vs. tier-up JIT produce slightly different range trees. Merging those inconsistent
// trees occasionally leaves one or two source lines unattributed, so a single file (and therefore
// the whole-repo aggregate) dips by a hundredth of a percent — e.g. `evaluate.js` at 99.90% branch
// with a couple of "uncovered" lines listed, aggregate 99.99% — and the 100% gate exits 1, even
// though the code is genuinely fully covered. Re-running clears it. It is a stochastic cross-process
// merge artifact, not a coverage gap:
//   * `--test-concurrency=1` reduces but does NOT eliminate it (isolated child processes still
//     merge across sequential runs);
//   * `--test-isolation=none` avoids the merge but genuinely changes which branches execute
//     (per-file module init runs once), lowering the true surface — not a drop-in.
//
// The artifact's magnitude is *not* bounded: usually it drops the aggregate by a hundredth of a
// percent, but under load it can transiently leave a whole file row several points below 100% while
// the aggregate stays high (observed live: file rows dipping while the aggregate held at 99.87–99.92).
// So a single report snapshot cannot be told apart from a genuine gap by its shape or magnitude — the
// *only* distinguishing property is stochasticity: the artifact clears on a re-run, a genuine gap is
// deterministic and reproduces on every attempt. The safe, robust way to make the gate deterministic
// is therefore a bounded retry of *any* coverage-threshold shortfall: a genuine gap still fails after
// every attempt (never masked — it is deterministic), and only the stochastic artifact clears. This
// module decides whether a non-zero exit is a bounded-retryable coverage shortfall or a genuine
// failure that must fail fast: only a real *test* failure, an unreadable report, or an anomalous
// non-zero exit with a fully-100 aggregate fail fast — those are cases a re-run cannot legitimately
// fix. Magnitude is deliberately not used as a discriminator, because the artifact can be large.

/** Classification outcomes for a coverage run. */
export const Outcome = Object.freeze({
  /** The run passed (exit 0). */
  PASS: "pass",
  /** A coverage shortfall with no test failure — retry a bounded number of times (clears if it is the artifact). */
  RETRY: "retry",
  /** A genuine failure (test failure, unreadable report, or anomalous fully-100 exit) — never retried. */
  FAIL: "fail",
});

/**
 * Count reported test failures from a `node --test` TAP summary (`# fail <n>`), taking the last
 * occurrence (the run's own summary, after any nested/self-test summaries). Returns 0 when absent.
 */
export function countTestFailures(output) {
  let failures = 0;
  const pattern = /^#\s*fail\s+(\d+)\s*$/gm;
  let match = pattern.exec(output);
  while (match !== null) {
    failures = Number(match[1]);
    match = pattern.exec(output);
  }
  return failures;
}

/**
 * Parse the `--experimental-test-coverage` report table into structured rows.
 *
 * Returns `{ present, rows, allFiles }` where `present` is whether a coverage report block was
 * found, `rows` is the list of *file* rows (`{ name, line, branch, funcs, uncovered }` — directory
 * grouping rows carry no metrics and are skipped), and `allFiles` is the aggregate row (or null).
 * Percentages are parsed as numbers; `uncovered` is the trimmed uncovered-lines column (empty when
 * the file is fully covered).
 */
export function parseCoverageReport(output) {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    line.includes("start of coverage report"),
  );
  const end = lines.findIndex((line) =>
    line.includes("end of coverage report"),
  );
  if (start === -1 || end === -1 || end <= start) {
    return { present: false, rows: [], allFiles: null };
  }

  const rows = [];
  let allFiles = null;
  for (let index = start + 1; index < end; index += 1) {
    const raw = lines[index];
    if (!raw.includes("|")) {
      // Separator (`# -----`) or non-table noise.
      continue;
    }
    // Strip the leading `# ` comment marker, then split the pipe-delimited columns.
    const body = raw.replace(/^#\s?/, "");
    const columns = body.split("|").map((column) => column.trim());
    const [name, lineCell, branchCell, funcsCell, uncovered = ""] = columns;

    // Header row (`file | line % | branch % | funcs % | uncovered lines`).
    if (lineCell === "line %") {
      continue;
    }
    // Directory grouping rows carry empty metric cells — not file rows.
    if (lineCell === "" && branchCell === "" && funcsCell === "") {
      continue;
    }

    const metrics = {
      name,
      line: Number(lineCell),
      branch: Number(branchCell),
      funcs: Number(funcsCell),
      uncovered,
    };
    if (name === "all files") {
      allFiles = metrics;
    } else {
      rows.push(metrics);
    }
  }

  return { present: true, rows, allFiles };
}

/** The lowest of a row's three coverage percentages. */
function worstMetric(row) {
  return Math.min(row.line, row.branch, row.funcs);
}

/**
 * Classify a finished coverage run.
 *
 * A non-zero exit with no failing tests is a coverage-threshold shortfall. We retry it (bounded),
 * because the distinguishing property of the stochastic merge artifact is *not* its magnitude — the
 * artifact can transiently drop a whole file several points — but that it clears on a re-run. A
 * genuine coverage gap is deterministic: it reproduces on every attempt, so it survives all of the
 * shell's bounded retries and the gate still fails (never masked). We fail fast only for the cases a
 * re-run cannot legitimately fix:
 *   - a real test failure (never a coverage merge artifact);
 *   - an unreadable report / missing aggregate (nothing to reason about);
 *   - a non-zero exit whose report nonetheless shows a fully-100 aggregate (anomalous — looping would
 *     not change it).
 * Every other shortfall is retried.
 *
 * @param {object} params
 * @param {string} params.output    Combined stdout+stderr of the coverage command.
 * @param {number} params.exitCode  The command's exit code.
 * @returns {Outcome[keyof Outcome]}
 */
export function classifyCoverageOutcome({ output, exitCode }) {
  if (exitCode === 0) {
    return Outcome.PASS;
  }
  // A real test failure is never a coverage merge artifact.
  if (countTestFailures(output) > 0) {
    return Outcome.FAIL;
  }
  const { present, allFiles } = parseCoverageReport(output);
  // No parseable report/aggregate → can't confirm a coverage flake; don't retry blindly.
  if (!present || allFiles === null) {
    return Outcome.FAIL;
  }
  // Non-zero exit yet the aggregate is fully covered → anomalous; fail rather than loop.
  if (worstMetric(allFiles) >= 100) {
    return Outcome.FAIL;
  }
  // A coverage shortfall with no failing test: retry. If it is a genuine gap it is deterministic and
  // will still fail after every retry; only the stochastic cross-process merge artifact clears.
  return Outcome.RETRY;
}

/**
 * Human-readable description of every file (and the aggregate) that fell short of 100%, for the
 * retry notice — so a shortfall outside the expected `evaluate.js` locus is visible and can be
 * investigated rather than silently smoothed. Returns "" when nothing is short or no report exists.
 *
 * @param {object} params
 * @param {string} params.output  Combined stdout+stderr of the coverage command.
 * @returns {string}
 */
export function describeShortfall({ output }) {
  const { present, rows, allFiles } = parseCoverageReport(output);
  if (!present) {
    return "";
  }
  const parts = [];
  for (const row of rows) {
    if (worstMetric(row) < 100) {
      const uncovered = row.uncovered ? `, uncovered ${row.uncovered}` : "";
      parts.push(
        `${row.name} (${row.line} line / ${row.branch} branch / ${row.funcs} func${uncovered})`,
      );
    }
  }
  if (allFiles !== null && worstMetric(allFiles) < 100) {
    parts.push(
      `aggregate (${allFiles.line} line / ${allFiles.branch} branch / ${allFiles.funcs} func)`,
    );
  }
  return parts.join("; ");
}

/**
 * Parse a bounded retry count from an environment-variable string, falling back to `fallback` for
 * anything that is not a positive integer (empty, zero, negative, fractional, or non-numeric) so a
 * malformed override can never silently disable the gate by making the run loop execute zero times.
 *
 * @param {string|undefined} raw
 * @param {number} [fallback=5]
 * @returns {number}
 */
export function parseMaxAttempts(raw, fallback = 5) {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

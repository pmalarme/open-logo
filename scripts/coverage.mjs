// `npm run coverage` entry point — a deterministic wrapper around Node's
// `--experimental-test-coverage` 100% gate (issue #417).
//
// Node's parallel coverage collection intermittently under-reports coverage due to a cross-process
// V8 block-coverage merge artifact, even when the code is genuinely 100% covered — the dip can
// surface on the whole-repo aggregate or on a single hot file's row (`evaluate.js`), usually by a
// hundredth of a percent but under load by several points on one file, and re-running clears it. This
// wrapper runs the same gate and, on a non-zero exit, asks `classifyCoverageOutcome` whether the
// failure is a coverage shortfall with no failing test (retry) or a genuine failure (real test
// failure, unreadable report, or anomalous fully-100 exit — fail fast). A genuine coverage gap is
// deterministic, so it still fails after every retry — a real regression can never be masked; only
// the stochastic artifact clears on a re-run, making the gate deterministic.
//
// This shell stays deliberately thin: all decision logic lives in the fully unit-tested
// `./coverage-gate/classify.mjs`. It runs in a parent process without `--experimental-test-coverage`,
// so it is not itself part of the measured surface.
//
// The coverage command explicitly selects the TAP reporter: the report parser in `classify.mjs`
// keys on TAP's `# `-prefixed table, and `node --test`'s *default* reporter is TTY-dependent
// (`tap` when piped, `spec` when interactive) and has drifted across Node majors — pinning `tap`
// makes the parse robust regardless of Node version or whether stdout is a terminal.

import { spawn } from "node:child_process";
import {
  Outcome,
  classifyCoverageOutcome,
  describeShortfall,
  parseMaxAttempts,
} from "./coverage-gate/classify.mjs";

const COVERAGE_ARGS = [
  "--test",
  "--experimental-test-coverage",
  "--test-reporter=tap",
  "--test-reporter-destination=stdout",
  "--test-coverage-lines=100",
  "--test-coverage-branches=100",
  "--test-coverage-functions=100",
];

const MAX_ATTEMPTS = parseMaxAttempts(process.env.OL_COVERAGE_MAX_ATTEMPTS);

/** Run the coverage command once, teeing output to the terminal and capturing it for analysis. */
function runCoverage() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, COVERAGE_ARGS, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let captured = "";
    const tee = (source, sink) => {
      source.setEncoding("utf8");
      source.on("data", (chunk) => {
        captured += chunk;
        sink.write(chunk);
      });
    };
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 0, output: captured });
    });
  });
}

async function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { exitCode, output } = await runCoverage();
    const outcome = classifyCoverageOutcome({ output, exitCode });

    if (outcome === Outcome.PASS) {
      return 0;
    }
    if (outcome === Outcome.FAIL) {
      return exitCode === 0 ? 1 : exitCode;
    }
    // outcome === RETRY: the known cross-process coverage-merge artifact (issue #417).
    const detail =
      describeShortfall({ output }) || "aggregate fractionally short";
    if (attempt < MAX_ATTEMPTS) {
      process.stderr.write(
        `\n[coverage] Detected a coverage shortfall with no failing test, consistent with the known ` +
          `cross-process coverage-merge artifact (issue #417): ${detail}. Retrying ` +
          `(attempt ${attempt + 1}/${MAX_ATTEMPTS})…\n`,
      );
    } else {
      process.stderr.write(
        `\n[coverage] The coverage shortfall (${detail}) persisted across ${MAX_ATTEMPTS} attempts; ` +
          `failing so it is investigated rather than masked.\n`,
      );
      return 1;
    }
  }
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(
      `\n[coverage] Failed to run the coverage command: ${error.message}\n`,
    );
    process.exitCode = 1;
  });

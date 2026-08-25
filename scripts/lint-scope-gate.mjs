// Logic module for the **lint scope** half of the `npm run lint` Definition-of-Done gate
// (issue #978, epic #901). Extracted so tests can import it directly for 100% coverage, keeping
// `scripts/check-lint-scope.mjs` a thin CLI shell — the same shape `scripts/built-in-names-gate.mjs`
// and `scripts/spec-citations-gate.mjs` already have, and outside the loaded-module coverage set
// [ADR-0009](../docs/adr/0009-test-layout.md) defines.
//
// Line comments rather than a block comment throughout: every glob this module has to quote
// contains `**/`, and `*/` closes a block comment. The first draft of this file was written as a
// JSDoc block and Biome parsed its own rationale as code — the same trap `classify.mjs` avoids the
// same way.
//
// ## Why this exists
//
// `biome.json`'s `files.includes` decides what `npm run lint` looks at, and **nothing re-derived
// it**. It read `["packages/**/src/**/*.ts", "scripts/**/*.mjs"]`, so 191 tracked `*.mjs` files
// under `packages/*/src/` — the entire unit-test corpus — were reported by Biome as *explicitly
// ignored*, while `npm run coverage` held those same files to 100% line/branch/function coverage.
// The repository demanded total coverage of a corpus it linted none of.
//
// The exclusion was an accident of the glob rather than a decision, and the proof is that it was
// inconsistent: `scripts/**/*.mjs` **was** linted including its `*.test.mjs` files, so an
// identically-named file was linted in one directory and ignored in the other, with no rationale
// recorded anywhere. `npm run lint` printed `Checked 123 files` and passed, which a maintainer
// reasonably reads as "the repository is linted".
//
// That is this epic's subject exactly: **a green signal certifying materially less than its name
// implies**, and **a count nothing re-derives is an unenforced assertion** (issue #934). So this
// module turns the count into an assertion.
//
// ## The oracle is independent of the thing it checks
//
// The corpus is derived from **git**, never from `biome.json` — deriving it from the config would
// make the gate agree with itself and assert nothing, which is the failure #940 recorded when a
// gate's "two directions" turned out to read the same Map.
//
// The rule is uniform and needs no directory allowlist: **every source file git knows about is
// linted.** Build output (`dist/`, `web-dist/`) is gitignored, so it is never in the corpus and
// never needs excluding from it — and because the corpus comes from git, the count is identical
// whether or not the tree has been built (verified: 105 emitted `.d.ts` files under `dist/` do not
// move it). A directory allowlist would have to be *extended* for a new top-level directory and
// would silently pass while that directory went unlinted; enumerating git's own view cannot.
//
// ## Both directions, because one of them is the one that drifted
//
// **A — corpus is a subset of checked:** every source file git knows about is one Biome actually
// checks. This is the direction that was missing, and the one that fails if `files.includes` is
// ever narrowed again.
//
// **B — checked is a subset of corpus plus `biome.json`:** Biome checks nothing beyond the corpus
// except its own configuration file, which it always processes regardless of `files.includes`. That
// `+1` is the discrepancy issue #978 recorded and could not identify ("my enumeration sums to 122
// against the 123 Biome reports"); it is `biome.json`, and this gate probes it rather than assuming
// it, so the reconciliation is measured on every run instead of asserted in prose.
//
// Together they give set equality: A proves nothing is missing, B proves nothing unexplained was
// added.
//
// ## Fail closed
//
// An unparseable Biome summary or an empty corpus is a **finding**, never a silent skip. A gate that
// quietly checks nothing is worse than no gate, because it also removes the human who was checking.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

/**
 * The extensions Biome can lint that this repository ships: the JavaScript/TypeScript family.
 * `.json` and `.css` are deliberately absent — the linter is disabled for them here, and including
 * them would make direction B fail on every JSON file in the tree.
 */
export const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Biome always processes its own configuration file, whatever `files.includes` says. It is the
 * entire difference between the corpus size and Biome's reported total, so the gate names it
 * instead of tolerating an unexplained `+1`.
 */
export const CONFIG_FILE = "biome.json";

/** Keeps each argv comfortably under the ~32 KB Windows command-line limit. */
export const PATHS_PER_INVOCATION = 120;

/** Whether a repository path is a source file this repository expects to be linted. */
export function isSourcePath(path) {
  return SOURCE_EXTENSION_PATTERN.test(path);
}

/**
 * Split `items` into runs of at most `size`. An empty input yields no chunks, so a caller that
 * chunks an empty corpus makes no subprocess calls at all — which is why an empty corpus is
 * rejected before we get here rather than passing vacuously.
 */
export function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Read the file count out of a Biome summary (`Checked 325 files in 2s.`, `Checked 1 file in 96ms.`).
 * Returns `null` when no count is present, which the caller treats as a failure rather than a zero —
 * "Biome said nothing we understood" and "Biome checked nothing" are different states, and only one
 * of them is safe to report as a count.
 */
export function parseCheckedCount(output) {
  const pattern = /Checked\s+(\d+)\s+files?\b/g;
  let count = null;
  let match = pattern.exec(output);
  while (match !== null) {
    count = Number(match[1]);
    match = pattern.exec(output);
  }
  return count;
}

/** Resolve Biome's platform-independent JS entry point, so it runs under `process.execPath`. */
export function resolveBiomeEntry() {
  return createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
}

/** Spawn Biome, letting a non-zero exit throw so {@link runBiome} can read the output off it. */
export function spawnBiome(args) {
  return execFileSync(process.execPath, [resolveBiomeEntry(), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Run Biome and return its combined output, **without throwing on a non-zero exit**. Biome exits
 * non-zero whenever it reports a diagnostic, and this gate only ever asks it *how many files it
 * looked at* — treating a diagnostic as an error here would conflate "the tree has a lint finding"
 * with "the lint scope is wrong". A failure that produced no output at all yields `""`, which
 * {@link parseCheckedCount} turns into `null` and the gate reports as a finding.
 */
export function runBiome(args, spawn = spawnBiome) {
  try {
    return spawn(args);
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

/**
 * The corpus: every source file **git knows about** — tracked, plus untracked-but-not-ignored so a
 * contributor's new file is expected to be linted the moment it exists rather than only once it is
 * committed.
 *
 * Including untracked files is deliberate, and is this gate's answer to the `git ls-files` blind
 * spot recorded in `scripts/spec-citations-gate.mjs`: a tool that enumerates the repository through
 * git cannot see an untracked file, so a green run over unstaged work certifies a tree that does not
 * contain the work. Here the blind spot would be worse than usual — a brand-new source file is
 * exactly the case where "is it linted?" has never been answered.
 */
export function listSourceFiles() {
  const enumerate = (args) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\0")
      .filter((path) => path !== "");
  const tracked = enumerate(["ls-files", "-z"]);
  const untracked = enumerate([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  return [...new Set([...tracked, ...untracked])].filter(isSourcePath).sort();
}

/** How many unchecked files the failure report names before it stops probing. */
export const UNCHECKED_REPORT_LIMIT = 20;

/**
 * Name the corpus files Biome does not check, one probe per file, stopping at `limit`. Only reached
 * once direction A has already failed: it turns "200 files are missing" into "these files are
 * missing", which is the difference between a gate a maintainer can act on and one that merely says
 * no. The cap keeps a badly-narrowed glob from spending minutes in subprocesses to restate a point
 * the first few names already make.
 */
export function findUncheckedFiles(
  corpus,
  biome,
  limit = UNCHECKED_REPORT_LIMIT,
) {
  const unchecked = [];
  for (const path of corpus) {
    if (unchecked.length === limit) {
      break;
    }
    if (parseCheckedCount(biome(["lint", "--reporter=summary", path])) !== 1) {
      unchecked.push(path);
    }
  }
  return unchecked;
}

/**
 * Run the gate. Dependencies are injected so the tests can drive every branch deterministically
 * without a subprocess; the defaults are the real git and the real Biome, and are covered by tests
 * that call them for real against this repository.
 */
export function runLintScopeGate({
  listFiles = listSourceFiles,
  biome = runBiome,
  chunkSize = PATHS_PER_INVOCATION,
} = {}) {
  const lines = [];
  const failures = [];

  const corpus = listFiles();
  if (corpus.length === 0) {
    return {
      ok: false,
      lines: [
        "LINT SCOPE GATE FAILED:",
        "  - the source corpus is empty; git listed no source files, so this gate would certify " +
          "nothing. Refusing to pass.",
      ],
    };
  }

  // Direction A — every source file git knows about is one Biome checks.
  let corpusChecked = 0;
  let unparseable = false;
  for (const paths of chunk(corpus, chunkSize)) {
    const count = parseCheckedCount(
      biome(["lint", "--reporter=summary", ...paths]),
    );
    if (count === null) {
      unparseable = true;
      break;
    }
    corpusChecked += count;
  }

  if (unparseable) {
    failures.push(
      "Biome produced no parseable `Checked <n> files` summary for a corpus chunk; the gate " +
        "cannot tell what was checked, so it fails rather than guessing.",
    );
  } else if (corpusChecked !== corpus.length) {
    const missing = corpus.length - corpusChecked;
    const unchecked = findUncheckedFiles(corpus, biome);
    failures.push(
      `${missing} of ${corpus.length} source file(s) git knows about are NOT linted — ` +
        "biome.json's `files.includes` does not cover them" +
        (missing > unchecked.length
          ? ` (first ${unchecked.length} shown)`
          : "") +
        ":",
    );
    for (const path of unchecked) {
      failures.push(`  ${path}`);
    }
    failures.push(
      "Fix `files.includes` to cover them. Never re-narrow the globs to hide a finding: disable " +
        "the specific rule by name, with a written reason.",
    );
  }

  // Direction B — Biome checks nothing beyond the corpus except its own configuration file.
  const repoChecked = parseCheckedCount(
    biome(["lint", "--reporter=summary", "."]),
  );
  const configChecked = parseCheckedCount(
    biome(["lint", "--reporter=summary", CONFIG_FILE]),
  );

  if (repoChecked === null || configChecked === null) {
    failures.push(
      "Biome produced no parseable `Checked <n> files` summary for the whole-repository or " +
        `${CONFIG_FILE} probe; the gate cannot reconcile its count, so it fails rather than guessing.`,
    );
  } else if (repoChecked !== corpus.length + configChecked) {
    failures.push(
      `Biome checked ${repoChecked} file(s) over the whole repository, but the corpus is ` +
        `${corpus.length} source file(s) plus ${configChecked} always-processed configuration ` +
        `file(s) (${CONFIG_FILE}) = ${corpus.length + configChecked}. An unexplained difference ` +
        "means the lint scope is not what this gate models — reconcile it, do not adjust the number.",
    );
  } else {
    lines.push(
      `lint scope: ${corpus.length} source file(s) git knows about, all linted; Biome checked ` +
        `${repoChecked} = ${corpus.length} + ${configChecked} (${CONFIG_FILE}, always processed).`,
    );
  }

  if (failures.length > 0) {
    return {
      ok: false,
      lines: ["LINT SCOPE GATE FAILED:", ...failures.map((f) => `  - ${f}`)],
    };
  }
  return { ok: true, lines };
}

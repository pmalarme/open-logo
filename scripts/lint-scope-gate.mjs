// Logic module for the **lint scope** half of the `npm run lint` Definition-of-Done gate
// (issue #978, epic #901). Extracted so tests can import it directly for 100% coverage, keeping
// `scripts/check-lint-scope.mjs` a thin CLI shell — the same shape `scripts/built-in-names-gate.mjs`
// and `scripts/spec-citations-gate.mjs` already have. Unlike those, this CLI shell **is**
// subprocess-tested (see `lint-scope-gate.test.mjs`), because a gate whose only kill switch is one
// unexercised `process.exit` line can be neutered without a single test going red.
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
// implies**, and **a count nothing re-derives is an unenforced assertion** (issue #934).
//
// ## Sets, not counts
//
// This gate compares the **set** of files Biome processed against the **set** git knows about.
// An earlier draft compared cardinalities, and review killed it: a discovery omission offset by an
// unexpected extra file passes a count check while the two sets differ. `biome lint --verbose`
// prints every path it processed, so the comparison is exact and both differences are named.
//
// The reported `Checked <n> files` total is still parsed, and must equal the length of that list.
// That is not a second opinion about scope — it is the guard that makes the list trustworthy: if
// Biome ever truncates or paginates the verbose output, the gate fails instead of quietly
// comparing against a partial list.
//
// Comparing sets also removed the failure path's cost. The count-based draft named the offending
// files by probing them one at a time, which took over seven minutes for the cheapest and most
// likely drift — a single unlinted file. The set difference is already the answer.
//
// ## The oracle is independent of the thing it checks
//
// The corpus is derived from **git**, never from `biome.json` — deriving it from the config would
// make the gate agree with itself and assert nothing, which is the failure #940 recorded when a
// gate's "two directions" turned out to read the same Map.
//
// The rule is uniform and needs no directory allowlist: **every source file git knows about is
// linted.** Build output (`dist/`, `web-dist/`) is gitignored, so it is never in the corpus and
// never needs excluding from it — and because the corpus comes from git, the result is identical
// whether or not the tree has been built (verified: 105 emitted `.d.ts` files under `dist/` do not
// move it). A directory allowlist would have to be *extended* for a new top-level directory and
// would silently pass while that directory went unlinted; enumerating git's own view cannot.
//
// ## What this gate does NOT check, stated rather than implied
//
// It checks **scope**, not **rule coverage**. `files.includes` is not the only way to stop linting
// a file: a configuration can keep a file in scope — still counted, still "Checked" — while
// switching its rules off, reproducing #978's effect through a door a scope check does not watch.
// `findBulkLinterDisables` closes that door at both levels (the root block and every `overrides`
// entry) and in all three spellings (`linter.enabled: false`, `rules.recommended: false`,
// `rules.preset: "none"`), including per-rule-**group** disables such as
// `rules.suspicious.preset: "none"`. Review found an earlier version catching only the override
// level, so a root-level or group-level bulk disable passed.
//
// Disabling a **named** rule is deliberately still allowed: issue #978's acceptance criterion is
// that a rule inappropriate for a glob is disabled *by name with a written reason*, so the point is
// to force that spelling, not to forbid it. A named-rule disable with no reason is a review
// question, and this gate does not pretend to answer it.
//
// It also does not read Biome's *other* inputs directly. Two of them matter, and review disproved
// an earlier version of this paragraph, so what follows is measured rather than reasoned:
//
//   * a **nested** `biome.json` (`"root": false`) deeper in the tree can disable rules for a whole
//     package, and the affected files **stay in the processed list** — direction A does NOT catch
//     it. Verified: a `packages/core/biome.json` with `rules.preset: "none"` left the gate green
//     while `packages/core` went unlinted. Every tracked configuration file is therefore
//     enumerated and audited, not just the root one.
//   * `.gitignore` via `vcs.useIgnoreFile` removes files from the processed list, so direction A
//     does catch that shape — and, because the corpus oracle is `git ls-files`, an ignored file
//     leaves the corpus at the same time, which is the consistent answer rather than a false alarm.
//
// The remaining door this gate does not watch is a `// biome-ignore-all lint: <reason>` comment at
// the top of a file, which suppresses the whole file from inside it. It is out of scope here
// because it is *already* the spelling #978 asks for — an explicit, in-file, reason-carrying
// suppression that shows up in review — but it is named so nobody mistakes silence for coverage.
// `git grep -n 'biome-ignore-all'` is the review check.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * The extensions Biome can lint that this repository ships: the JavaScript/TypeScript family.
 * `.json` and `.css` are deliberately absent — the linter is disabled for them here, and including
 * them would make the "nothing beyond the corpus" direction fail on every JSON file in the tree.
 */
export const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Biome always processes its own configuration file, whatever `files.includes` says. It is the
 * entire difference between the corpus and the processed set, so the gate names it rather than
 * tolerating an unexplained extra. This is the `+1` issue #978 recorded and could not identify
 * ("my enumeration sums to 122 against the 123 Biome reports").
 */
export const CONFIG_FILE = "biome.json";

/** Whether a repository path is a source file this repository expects to be linted. */
export function isSourcePath(path) {
  return SOURCE_EXTENSION_PATTERN.test(path);
}

/** Normalise a path Biome printed (Windows separators) to the forward-slash form git reports. */
export function toPosixPath(path) {
  return path.replaceAll("\\", "/");
}

/**
 * Read the file count out of a Biome summary (`Checked 328 files in 2s.`, `Checked 1 file in 96ms.`).
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

/**
 * Read the `Files processed:` list out of `biome lint --verbose` output, normalised to POSIX paths.
 * Returns `null` when the section is absent — the gate then fails rather than comparing against an
 * empty set, which would report every source file as unlinted for the wrong reason.
 *
 * Only the `Files processed:` block is read. Biome prints a `Files fixed:` block from the same
 * template, and a run that applied fixes would otherwise contribute its paths to the comparison.
 */
export function parseProcessedFiles(output) {
  const lines = output.split(/\r?\n/);
  // Biome prefixes the heading with its info marker: `  i Files processed:`.
  const start = lines.findIndex((line) =>
    /(?:^|\s)Files processed:\s*$/.test(line),
  );
  if (start === -1) {
    return null;
  }
  const processed = [];
  for (const line of lines.slice(start + 1)) {
    const entry = /^\s*-\s+(\S.*?)\s*$/.exec(line);
    if (entry !== null) {
      processed.push(toPosixPath(entry[1]));
      continue;
    }
    // Blank lines pad the block; anything else ends it.
    if (line.trim() !== "") {
      break;
    }
  }
  return processed;
}

/** Resolve Biome's platform-independent JS entry point, so it runs under `process.execPath`. */
export function resolveBiomeEntry() {
  return createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
}

/** Spawn Biome, letting a non-zero exit throw so {@link runBiome} can read the output off it. */
export function spawnBiome(args, cwd) {
  return execFileSync(process.execPath, [resolveBiomeEntry(), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Run Biome and return its combined output, **without throwing on a non-zero exit**. Biome exits
 * non-zero whenever it reports a diagnostic, and this gate only ever asks it *which files it looked
 * at* — treating a diagnostic as an error here would conflate "the tree has a lint finding" with
 * "the lint scope is wrong". A failure that produced no output at all yields `""`, which
 * {@link parseProcessedFiles} turns into `null` and the gate reports as a finding.
 */
export function runBiome(args, cwd, spawn = spawnBiome) {
  try {
    return spawn(args, cwd);
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
export function listSourceFiles(cwd) {
  const enumerate = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
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

/**
 * Name every way a configuration block switches the linter off **wholesale** for a set of files,
 * which keeps them "Checked" while unlinting them. Applied to a configuration's top-level `linter`
 * block and to each `overrides` entry, because the same shapes are legal in both.
 *
 * Bulk disabling has three spellings and two levels, and review found the first version of this
 * function caught only some of them: `linter.enabled: false`, `linter.rules.recommended: false` and
 * `linter.rules.preset: "none"` at the top of the block, plus the last two again inside any rule
 * **group** (`rules.suspicious.preset: "none"`). Groups are enumerated rather than listed, so a
 * group Biome adds later is covered without an edit here.
 *
 * See this module's header for why a **named**-rule disable is deliberately not a finding.
 */
export function findBulkLinterDisables(linter, where) {
  const findings = [];
  const bulk = (rules) =>
    rules?.recommended === false || rules?.preset === "none";

  if (linter?.enabled === false) {
    findings.push(
      `${where} sets \`linter.enabled: false\`, unlinting those files while they stay in scope.`,
    );
  }
  const rules = linter?.rules;
  if (bulk(rules)) {
    findings.push(
      `${where} switches off the recommended preset for every rule group, unlinting those files ` +
        "while they stay in scope. Disable the specific rule by name instead, with a written " +
        "reason (issue #978).",
    );
  }
  for (const [group, value] of Object.entries(rules ?? {})) {
    // `recommended`/`preset` are the block's own keys, handled above; every other object is a group.
    if (typeof value === "object" && value !== null && bulk(value)) {
      findings.push(
        `${where} switches off the \`${group}\` rule group wholesale, unlinting those rules while ` +
          "the files stay in scope. Disable the specific rule by name instead, with a written " +
          "reason (issue #978).",
      );
    }
  }
  return findings;
}

/**
 * Audit the whole configuration — root block and every `overrides` entry — for bulk linter
 * disables. `null` (an unreadable or unparseable configuration) is the caller's problem, not a
 * silent empty result: see {@link runLintScopeGate}, which fails on it.
 */
export function findDisabledLinterOverrides(config) {
  const findings = [
    ...findBulkLinterDisables(config?.linter, "its top-level `linter` block"),
  ];
  const overrides = Array.isArray(config?.overrides) ? config.overrides : [];
  overrides.forEach((override, index) => {
    const where = `overrides[${index}]${
      override?.includes ? ` (${JSON.stringify(override.includes)})` : ""
    }`;
    findings.push(...findBulkLinterDisables(override?.linter, where));
  });
  return findings;
}

/** Read and parse a Biome configuration file, or return `null` when it cannot be read or parsed. */
export function readConfig(path = CONFIG_FILE) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Every tracked Biome configuration file, root first. A **nested** config (`"root": false`) can
 * disable rules for a whole package while its files stay in the processed list, so auditing only
 * the root one leaves a door open that direction A cannot see — measured, not assumed: a
 * `packages/core/biome.json` with `rules.preset: "none"` left an earlier version of this gate green
 * while `packages/core` went unlinted.
 *
 * Enumerated through git for the same reason the corpus is: it is the view that cannot be edited by
 * the thing being checked.
 */
export function listConfigFiles(cwd) {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((path) => /(?:^|\/)biome\.jsonc?$/.test(path));
  return [...new Set([CONFIG_FILE, ...tracked])].sort();
}

/**
 * Run the gate. Dependencies are injected so the tests can drive every branch deterministically;
 * the defaults are the real git and the real Biome, and are covered by tests that run them for real
 * against this repository and against throwaway git repositories built for the purpose.
 */
export function runLintScopeGate({
  cwd,
  listFiles = listSourceFiles,
  listConfigs = listConfigFiles,
  biome = runBiome,
  config = readConfig,
} = {}) {
  const fail = (...messages) => ({
    ok: false,
    lines: [
      "LINT SCOPE GATE FAILED:",
      ...messages.map((message) => `  - ${message}`),
    ],
  });

  const corpus = listFiles(cwd);
  if (corpus.length === 0) {
    return fail(
      "the source corpus is empty; git listed no source files, so this gate would certify nothing. " +
        "Refusing to pass.",
    );
  }

  const output = biome(["lint", "--verbose", "--reporter=summary", "."], cwd);
  const processed = parseProcessedFiles(output);
  if (processed === null) {
    return fail(
      "Biome printed no `Files processed:` list, so the gate cannot tell what was linted. " +
        "Refusing to guess.",
    );
  }

  const reported = parseCheckedCount(output);
  if (reported !== processed.length) {
    return fail(
      `Biome reported \`Checked ${reported} files\` but listed ${processed.length} processed ` +
        "path(s). The list this gate compares against is not the whole truth — refusing to pass on " +
        "a partial list.",
    );
  }

  const failures = [];
  const linted = new Set(processed);
  const expected = new Set([...corpus, CONFIG_FILE]);

  // Every configuration must be readable BEFORE anything else is judged. An unreadable or
  // unparseable config used to make the override audit silently empty — the gate would then pass
  // while checking one of its two doors, which is the exact failure this epic is about. And a
  // NESTED config is audited too: it can unlint a whole package while its files stay in the
  // processed list, so direction A never sees it.
  const configurations = [];
  for (const relative of listConfigs(cwd)) {
    const path = cwd === undefined ? relative : join(cwd, relative);
    const parsed = config(path);
    if (parsed === null) {
      return fail(
        `\`${relative}\` could not be read or parsed, so the gate cannot tell whether the linter is ` +
          "switched off for any glob. Refusing to certify a scope it cannot see.",
      );
    }
    configurations.push([relative, parsed]);
  }

  // Direction A — every source file git knows about is one Biome linted.
  const unlinted = corpus.filter((path) => !linted.has(path));
  if (unlinted.length > 0) {
    failures.push(
      `${unlinted.length} of ${corpus.length} source file(s) git knows about are NOT linted — ` +
        "biome.json's `files.includes` does not cover them:",
      ...unlinted.map((path) => `  ${path}`),
      "Fix `files.includes` to cover them. Never re-narrow the globs to hide a finding: disable " +
        "the specific rule by name, with a written reason.",
    );
  }

  // The configuration file is the one path this gate expects Biome to process beyond the corpus,
  // and it is the whole explanation for the `+1`. Assert it rather than assume it: without this,
  // a run in which Biome never reached biome.json still reconciled, and the success line reported
  // the impossible `n = n + 1`.
  if (!linted.has(CONFIG_FILE)) {
    failures.push(
      `Biome did not process \`${CONFIG_FILE}\`, which this gate models as always processed. The ` +
        "reconciliation below would be arithmetic about a file that was never read — refusing to " +
        "pass on it.",
    );
  }

  // Direction B — Biome linted nothing beyond the corpus except its own configuration file.
  const unexpected = processed.filter((path) => !expected.has(path));
  if (unexpected.length > 0) {
    failures.push(
      `Biome linted ${unexpected.length} path(s) that git does not report as source files. The ` +
        "lint scope is not what this gate models — reconcile it, do not adjust the expectation:",
      ...unexpected.map((path) => `  ${path}`),
    );
  }

  // The other door: in scope, but unlinted by a bulk disable at any level, in any configuration.
  for (const [relative, parsed] of configurations) {
    failures.push(
      ...findDisabledLinterOverrides(parsed).map(
        (finding) => `${relative}: ${finding}`,
      ),
    );
  }

  if (failures.length > 0) {
    return fail(...failures);
  }
  // Every term is measured: the sets have just been proven equal in both directions, and the
  // difference is derived rather than written as a literal `1` — a hardcoded term in a
  // reconciliation is the same unenforced assertion this gate exists to remove.
  return {
    ok: true,
    lines: [
      `lint scope: ${corpus.length} source file(s) git knows about, all linted; Biome processed ` +
        `${processed.length} = ${corpus.length} + ${processed.length - corpus.length} ` +
        `(${CONFIG_FILE}, always processed); ${configurations.length} Biome configuration(s) audited.`,
    ],
  };
}

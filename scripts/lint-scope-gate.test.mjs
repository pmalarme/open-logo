// Tests for the lint-scope gate (issue #978, epic #901).
//
// Every `INJECTED DRIFT:` title below names one drift this gate detects, and the test either fires
// or it does not — the convention `scripts/built-in-names-gate.test.mjs` established, for the reason
// it records: a capability claim written in prose is a claim nothing recomputes, which is the very
// defect epic #901 exists to close.
//
// Two kinds of test here are deliberate answers to review findings on the first round:
//
//   * The mutations run against the **real Biome binary** in **throwaway git repositories**, not
//     against a fake. A fake proves the comparison logic; only a real run proves the gate is wired
//     to the tool whose behaviour it is asserting.
//   * `check-lint-scope.mjs` is **spawned as a subprocess** and both its exit codes are asserted.
//     Its `process.exit(result.ok ? 0 : 1)` is the gate's entire kill switch, and the first round
//     had nothing exercising it: replacing it with a constant `0` left every test green while
//     `npm run lint` passed on a tree with 200 unlinted files.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONFIG_FILE,
  countNamedNonFailingRules,
  extendsTargets,
  findBulkLinterDisables,
  findDisabledLinterOverrides,
  isSourcePath,
  listConfigFiles,
  listSourceFiles,
  parseCheckedCount,
  parseProcessedFiles,
  readConfig,
  resolveBiomeEntry,
  runBiome,
  runLintScopeGate,
  spawnBiome,
  toPosixPath,
} from "./lint-scope-gate.mjs";

/** One of the 191 test files the pre-fix `files.includes` left unlinted — issue #978's subject. */
const A_PREVIOUSLY_UNLINTED_FILE =
  "packages/parser/src/value-of-key-newline.test.mjs";

/** The pre-fix globs, reused verbatim as the mutation this gate exists to catch. */
const PRE_FIX_INCLUDES = ["packages/**/src/**/*.ts", "scripts/**/*.mjs"];

const CHECK_LINT_SCOPE = fileURLToPath(
  new URL("./check-lint-scope.mjs", import.meta.url),
);

/** A Biome summary line for `count` files, in Biome's own singular/plural wording. */
function summary(count) {
  return `Checked ${count} file${count === 1 ? "" : "s"} in 12ms. No fixes applied.`;
}

/** Biome's `--verbose` shape: a `Files processed:` block, then an unrelated `Files fixed:` block. */
function verbose(processed, fixed = []) {
  const block = (title, paths) =>
    `  i ${title}\n  \n${paths.map((path) => `  - ${path}`).join("\n")}\n  \n`;
  return `${block("Files processed:", processed)}${block("Files fixed:", fixed)}${summary(processed.length)}`;
}

/**
 * Build a throwaway git repository with its own `biome.json`, so a mutation can be applied to a real
 * Biome run without ever touching this repository's configuration. `nestedConfigs` maps a directory
 * to a config object written there, which is how the nested-config door is exercised for real.
 */
function makeRepo({
  includes,
  tracked = [],
  untracked = [],
  overrides,
  nestedConfigs = {},
}) {
  const directory = mkdtempSync(join(tmpdir(), "openlogo-lint-scope-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, stdio: "ignore" });
  git("init");
  git("config", "user.email", "gate@example.invalid");
  git("config", "user.name", "gate");

  const write = (relative, contents) => {
    const target = join(directory, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };

  const config = {
    files: { includes },
    linter: { enabled: true, rules: { preset: "recommended" } },
    formatter: { enabled: false },
    assist: { enabled: false },
  };
  if (overrides !== undefined) {
    config.overrides = overrides;
  }
  write(CONFIG_FILE, JSON.stringify(config));

  const nestedPaths = [];
  for (const [where, nested] of Object.entries(nestedConfigs)) {
    const relative = `${where}/${CONFIG_FILE}`;
    write(relative, JSON.stringify(nested));
    nestedPaths.push(relative);
  }

  for (const name of [...tracked, ...untracked]) {
    write(name, "export const value = 1;\n");
  }
  const toStage = [...tracked, ...nestedPaths];
  if (toStage.length > 0) {
    git("add", ...toStage);
  }
  return directory;
}

test("isSourcePath accepts the JavaScript/TypeScript family and nothing else", () => {
  for (const path of [
    "a.ts",
    "a.tsx",
    "a.mts",
    "a.cts",
    "a.js",
    "a.jsx",
    "a.mjs",
    "a.cjs",
  ]) {
    assert.equal(isSourcePath(path), true, `${path} must be treated as source`);
  }
  for (const path of [
    "biome.json",
    "README.md",
    "a.png",
    "a.css",
    "a.mjs.bak",
  ]) {
    assert.equal(
      isSourcePath(path),
      false,
      `${path} must not be treated as source`,
    );
  }
});

test("toPosixPath normalises the separators Biome prints on Windows", () => {
  assert.equal(
    toPosixPath("packages\\core\\src\\a.ts"),
    "packages/core/src/a.ts",
  );
  assert.equal(toPosixPath("packages/core/src/a.ts"), "packages/core/src/a.ts");
});

test("parseCheckedCount reads Biome's singular and plural summaries, and the last one", () => {
  assert.equal(parseCheckedCount(summary(1)), 1);
  assert.equal(parseCheckedCount(summary(328)), 328);
  assert.equal(parseCheckedCount(`${summary(4)}\n${summary(9)}`), 9);
});

test("parseCheckedCount returns null — not zero — when there is no summary to read", () => {
  // "Biome said nothing we understood" and "Biome checked nothing" are different states; only one
  // of them is safe to report as a count, so the gate must be able to tell them apart.
  assert.equal(parseCheckedCount(""), null);
  assert.equal(parseCheckedCount("error: could not load configuration"), null);
});

test("parseProcessedFiles reads only the processed block, not the fixed block", () => {
  const output = verbose(
    ["biome.json", "packages\\core\\src\\a.ts"],
    ["scripts/other.mjs"],
  );
  assert.deepEqual(parseProcessedFiles(output), [
    "biome.json",
    "packages/core/src/a.ts",
  ]);
});

test("parseProcessedFiles returns null when Biome printed no list at all", () => {
  assert.equal(parseProcessedFiles(summary(3)), null);
  assert.equal(parseProcessedFiles(""), null);
});

test("findBulkLinterDisables catches all three spellings, at block level and per rule group", () => {
  // Review found the first version watching only the overrides level: a root-level or a
  // per-group bulk disable unlinted files while the gate stayed green.
  assert.deepEqual(
    findBulkLinterDisables(
      { enabled: true, rules: { preset: "recommended" } },
      "x",
    ),
    [],
  );
  assert.match(
    findBulkLinterDisables({ enabled: false }, "x")[0],
    /linter\.enabled: false/,
  );
  assert.match(
    findBulkLinterDisables({ rules: { recommended: false } }, "x")[0],
    /every rule group/,
  );
  assert.match(
    findBulkLinterDisables({ rules: { preset: "none" } }, "x")[0],
    /every rule group/,
  );
  assert.match(
    findBulkLinterDisables(
      { rules: { suspicious: { preset: "none" } } },
      "x",
    )[0],
    /`suspicious` rule group/,
  );
  // INJECTED DRIFT: a group disabled as the bare string, which Biome accepts and an audit that only
  // walked object-valued groups let straight through.
  assert.match(
    findBulkLinterDisables({ rules: { suspicious: "off" } }, "x")[0],
    /`suspicious` rule group/,
  );
  // INJECTED DRIFT: a severity downgrade is the same wholesale operation in a softer word — every
  // rule in the group drops below the level that fails a build.
  for (const severity of ["warn", "info"]) {
    assert.match(
      findBulkLinterDisables({ rules: { suspicious: severity } }, "x")[0],
      /`suspicious` rule group/,
      `a group set to "${severity}" must be a finding`,
    );
  }
  // INJECTED DRIFT: a domain switched off drops the rules that domain contributes.
  assert.match(
    findBulkLinterDisables({ domains: { test: "none" } }, "x")[0],
    /`test` linter domain/,
  );
  assert.deepEqual(
    findBulkLinterDisables({ domains: { test: "all" } }, "x"),
    [],
  );
  assert.match(
    findBulkLinterDisables(
      { rules: { correctness: { recommended: false } } },
      "x",
    )[0],
    /`correctness` rule group/,
  );
  // A named-rule disable is deliberately allowed — #978 asks for that spelling, not for its ban.
  assert.deepEqual(
    findBulkLinterDisables(
      { rules: { suspicious: { noSelfCompare: "off" } } },
      "x",
    ),
    [],
  );
  assert.deepEqual(findBulkLinterDisables(undefined, "x"), []);
});

test("findDisabledLinterOverrides audits the root block and every override", () => {
  assert.deepEqual(
    findDisabledLinterOverrides({ linter: { enabled: true }, overrides: [] }),
    [],
  );
  assert.match(
    findDisabledLinterOverrides({ linter: { enabled: false } })[0],
    /top-level `linter` block/,
  );
  // INJECTED DRIFT: the root-level bulk disable the earlier version missed entirely.
  assert.match(
    findDisabledLinterOverrides({ linter: { rules: { preset: "none" } } })[0],
    /top-level `linter` block.*every rule group/s,
  );
  assert.match(
    findDisabledLinterOverrides({
      linter: { rules: { style: { preset: "none" } } },
    })[0],
    /top-level `linter` block.*`style` rule group/s,
  );
  assert.match(
    findDisabledLinterOverrides({
      overrides: [
        { includes: ["packages/**/*.mjs"], linter: { enabled: false } },
      ],
    })[0],
    /linter\.enabled: false/,
  );
  assert.match(
    findDisabledLinterOverrides({
      overrides: [
        {
          includes: ["packages/**/*.mjs"],
          linter: { rules: { recommended: false } },
        },
      ],
    })[0],
    /every rule group/,
  );
  assert.match(
    findDisabledLinterOverrides({
      overrides: [{ linter: { rules: { preset: "none" } } }],
    })[0],
    /every rule group/,
  );
  assert.deepEqual(findDisabledLinterOverrides(null), []);
});

test("INJECTED DRIFT: an unreadable configuration fails closed instead of skipping the audit", () => {
  // readConfig returns null for an unparseable biome.json. That used to make the override audit
  // silently empty, so the gate passed having checked only one of its two doors.
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    biome: () => verbose(["a.ts", CONFIG_FILE]),
    config: () => null,
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /could not be read or parsed/);
});

test("INJECTED DRIFT: a run in which Biome never processed biome.json fails closed", () => {
  // Without this the reconciliation was arithmetic about a file that was never read, and the
  // success line could report the impossible `1 = 1 + 1`.
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    biome: () => verbose(["a.ts"]),
    config: () => ({ linter: { enabled: true } }),
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /did not process `biome\.json`/);
});

test("the success line derives its own arithmetic rather than asserting a literal", () => {
  const result = runLintScopeGate({
    listFiles: () => ["a.ts", "b.mjs"],
    biome: () => verbose(["a.ts", "b.mjs", CONFIG_FILE]),
    config: () => ({ linter: { enabled: true } }),
  });
  assert.equal(result.ok, true, result.lines.join("\n"));
  assert.match(
    result.lines.join("\n"),
    /Biome processed 3 = 2 \+ 1 \(biome\.json/,
  );
});

test("extendsTargets reads both the string and array spellings, ignoring non-strings", () => {
  assert.deepEqual(extendsTargets({ extends: "./a.json" }), ["./a.json"]);
  assert.deepEqual(extendsTargets({ extends: ["./a.json", "./b.json"] }), [
    "./a.json",
    "./b.json",
  ]);
  assert.deepEqual(extendsTargets({ extends: [1, null] }), []);
  assert.deepEqual(extendsTargets({}), []);
});

test("INJECTED DRIFT: a disable hidden in an extended file, under any filename", () => {
  // listConfigFiles matches on filename, so an `extends` target called anything else bypassed it
  // entirely. The audit now follows the chain.
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    listConfigs: () => [CONFIG_FILE],
    biome: () => verbose(["a.ts", CONFIG_FILE]),
    config: (path) =>
      path.includes("disabled")
        ? { linter: { rules: { preset: "none" } } }
        : { extends: ["./disabled.json"], linter: { enabled: true } },
  });
  const report = result.lines.join("\n");
  assert.equal(result.ok, false, report);
  assert.match(report, /disabled\.json/);
  assert.match(report, /every rule group/);
});

test("INJECTED DRIFT: an extends target outside the tracked tree is reported, not followed", () => {
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    listConfigs: () => [CONFIG_FILE],
    biome: () => verbose(["a.ts", CONFIG_FILE]),
    config: () => ({
      extends: ["@scope/biome-config"],
      linter: { enabled: true },
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /outside the tracked tree/);
});

test("an extends cycle terminates instead of looping forever", () => {
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    listConfigs: () => [CONFIG_FILE],
    biome: () => verbose(["a.ts", CONFIG_FILE]),
    config: (path) =>
      path.includes("other")
        ? { extends: ["./biome.json"], linter: { enabled: true } }
        : { extends: ["./other.json"], linter: { enabled: true } },
  });
  assert.equal(result.ok, true, result.lines.join("\n"));
});

test("countNamedNonFailingRules counts every non-failing named setting, never a bulk one", () => {
  assert.equal(countNamedNonFailingRules(undefined), 0);
  assert.equal(
    countNamedNonFailingRules({
      rules: {
        suspicious: { noSelfCompare: "off", noDebugger: { level: "off" } },
      },
    }),
    2,
  );
  // INJECTED DRIFT: a downgrade is a suppression. A single `noDebugger: {level: "warn"}` let a
  // planted `debugger;` through `npm run lint` while an earlier version of this counter said 0.
  for (const level of ["warn", "info"]) {
    assert.equal(
      countNamedNonFailingRules({
        rules: { suspicious: { noDebugger: level } },
      }),
      1,
      `a rule set to the bare string "${level}" must be counted`,
    );
    assert.equal(
      countNamedNonFailingRules({
        rules: { suspicious: { noDebugger: { level } } },
      }),
      1,
      `a rule set to {level: "${level}"} must be counted`,
    );
  }
  // A rule left failing, and the group's own keys, are not suppressions.
  assert.equal(
    countNamedNonFailingRules({
      rules: {
        recommended: false,
        style: { recommended: false, useConst: "error" },
      },
    }),
    0,
  );
  // A bulk group disable is a finding, not a named setting, so it must not inflate this count.
  assert.equal(countNamedNonFailingRules({ rules: { suspicious: "off" } }), 0);
});

test("INJECTED DRIFT: an extends target that climbs out of the repository is reported", () => {
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    listConfigs: () => [CONFIG_FILE],
    biome: () => verbose(["a.ts", CONFIG_FILE]),
    config: () => ({ extends: ["../outside.json"], linter: { enabled: true } }),
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /outside the repository/);
});

test("the gate is actually wired into `npm run lint`, as a conjunction", () => {
  // The gate's own wiring is a claim nothing re-derived, and the first attempt at this test was
  // itself hollow: it matched the filename anywhere in the script, so flipping `&&` to `||` — which
  // makes `npm run lint` exit 0 on a real Biome diagnostic — kept every test green. Presence is not
  // the property that matters; sequencing is.
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const script = manifest.scripts.lint;

  assert.doesNotMatch(
    script,
    /\|\||;/,
    "the lint script must not swallow a failure with || or ;",
  );
  const stages = script.split("&&").map((stage) => stage.trim());
  assert.equal(
    stages.length,
    2,
    `expected exactly two &&-chained stages, got: ${script}`,
  );
  assert.match(stages[0], /^biome lint\b/, "Biome must run first");
  assert.match(
    stages[1],
    /check-lint-scope\.mjs$/,
    "the scope gate must run second",
  );
});

test("readConfig parses this repository's configuration, and yields null for an unreadable one", () => {
  assert.ok(Array.isArray(readConfig().files.includes));
  assert.equal(
    readConfig(join(tmpdir(), "openlogo-no-such-config.json")),
    null,
  );
});

test("resolveBiomeEntry resolves the installed Biome entry point", () => {
  assert.match(
    toPosixPath(resolveBiomeEntry()),
    /@biomejs\/biome\/bin\/biome$/,
  );
});

test("runBiome returns output rather than throwing when Biome exits non-zero", () => {
  // spawnBiome is the throwing half; runBiome's contract is that a diagnostic exit is still a
  // readable answer, because this gate only ever asks Biome which files it looked at.
  assert.throws(() => spawnBiome(["lint", "--definitely-not-a-real-flag"]));
  assert.notEqual(runBiome(["lint", "--definitely-not-a-real-flag"]), "");
});

test("runBiome concatenates stdout and stderr off a thrown error", () => {
  const thrown = Object.assign(new Error("boom"), {
    stdout: "out-",
    stderr: "err",
  });
  assert.equal(
    runBiome(["lint"], undefined, () => {
      throw thrown;
    }),
    "out-err",
  );
});

test("runBiome yields an empty string when a failure carried no output at all", () => {
  // Which parseProcessedFiles turns into null, and the gate reports as a finding — never as "no
  // files were processed".
  const output = runBiome(["lint"], undefined, () => {
    throw new Error("boom");
  });
  assert.equal(output, "");
  assert.equal(parseProcessedFiles(output), null);
});

test("listSourceFiles enumerates source files git knows about, and only those", () => {
  const files = listSourceFiles();
  assert.ok(
    files.includes("scripts/lint-scope-gate.test.mjs"),
    "this test file must be in the corpus",
  );
  assert.ok(
    files.includes(A_PREVIOUSLY_UNLINTED_FILE),
    "the test corpus issue #978 found unlinted must be in the corpus",
  );
  assert.ok(
    files.every(isSourcePath),
    "no non-source path may reach the corpus",
  );
  assert.deepEqual(
    [...files].sort(),
    files,
    "the corpus must be sorted for a stable report",
  );
});

test("listSourceFiles sees an untracked file, not just the tracked set", () => {
  // The `git ls-files` blind spot, asserted rather than described: a tool that enumerates the
  // repository through git cannot see an untracked file, so a green run over unstaged work
  // certifies a tree that does not contain the work. This half of listSourceFiles was previously
  // covered but unasserted — neutering it left every test green.
  const directory = makeRepo({
    includes: ["**/*.mjs"],
    tracked: ["committed.mjs"],
    untracked: ["brand-new.mjs"],
  });
  assert.deepEqual(listSourceFiles(directory), [
    "brand-new.mjs",
    "committed.mjs",
  ]);
});

test("the gate passes when every source file git knows about is linted", () => {
  const directory = makeRepo({
    includes: ["**/*.mjs"],
    tracked: ["committed.mjs"],
    untracked: ["brand-new.mjs"],
  });
  const result = runLintScopeGate({ cwd: directory });
  assert.equal(result.ok, true, result.lines.join("\n"));
  assert.match(
    result.lines.join("\n"),
    /2 source file\(s\) git knows about, all linted/,
  );
  assert.match(
    result.lines.join("\n"),
    /Biome processed 3 = 2 \+ 1 \(biome\.json/,
  );
});

test("INJECTED DRIFT: biome.json's includes narrowed back to the pre-fix globs", () => {
  // The headline mutation. An earlier version of this test pointed the real binary at a temp
  // config via `--config-path`, and review proved it vacuous: Biome treats that directory as the
  // project root, so it processed ZERO files and the assertion fired for any globs at all —
  // substituting the CORRECT globs left it green. It is now built the honest way, in a throwaway
  // repository laid out like this one, so the pre-fix globs are genuinely exercised: a `.ts` file
  // under packages/*/src and a scripts/*.mjs stay linted, while the `.test.mjs` corpus — the 191
  // files issue #978 is about — does not.
  const directory = makeRepo({
    includes: PRE_FIX_INCLUDES,
    tracked: [
      "packages/parser/src/reader.ts",
      "packages/parser/src/reader.test.mjs",
      "packages/core/src/values.test.mjs",
      "scripts/tool.mjs",
    ],
  });

  const result = runLintScopeGate({ cwd: directory });
  const report = result.lines.join("\n");
  assert.equal(
    result.ok,
    false,
    `the narrowed configuration must fail the gate:\n${report}`,
  );
  assert.match(
    report,
    /2 of 4 source file\(s\) git knows about are NOT linted/,
    report,
  );
  for (const path of [
    "packages/parser/src/reader.test.mjs",
    "packages/core/src/values.test.mjs",
  ]) {
    assert.ok(report.includes(path), `${path} must be named as unlinted`);
  }
  // And the two the pre-fix globs DID cover must not be reported — otherwise this would pass for
  // the wrong reason, which is exactly how the previous version failed.
  for (const path of ["packages/parser/src/reader.ts", "scripts/tool.mjs"]) {
    assert.ok(
      !report.includes(path),
      `${path} was linted and must not be named`,
    );
  }
});

test("INJECTED DRIFT: a nested biome.json unlints a package while its files stay in scope", () => {
  // The door direction A cannot see, and the one whose absence review demonstrated against the
  // real binary: the affected files remain in Biome's processed list, so only reading every
  // tracked configuration catches it.
  const directory = makeRepo({
    includes: ["**/*.mjs"],
    tracked: ["packages/core/src/values.test.mjs", "root.mjs"],
    nestedConfigs: {
      "packages/core": {
        root: false,
        linter: { enabled: true, rules: { preset: "none" } },
      },
    },
  });
  const result = runLintScopeGate({ cwd: directory });
  const report = result.lines.join("\n");
  assert.equal(result.ok, false, report);
  assert.match(report, /packages\/core\/biome\.json/);
  assert.match(report, /every rule group/);
});

test("listConfigFiles finds nested configurations, with the root one always first in the set", () => {
  const directory = makeRepo({
    includes: ["**/*.mjs"],
    tracked: ["root.mjs"],
    nestedConfigs: { "packages/core": { root: false } },
  });
  assert.deepEqual(listConfigFiles(directory), [
    "biome.json",
    "packages/core/biome.json",
  ]);
  // In a repository with no nested configuration, the root one is still audited.
  assert.deepEqual(listConfigFiles(makeRepo({ includes: ["**/*.mjs"] })), [
    "biome.json",
  ]);
});

test("INJECTED DRIFT: an unreadable NESTED configuration fails closed", () => {
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    listConfigs: () => [CONFIG_FILE, "packages/core/biome.json"],
    biome: () => verbose(["a.ts", CONFIG_FILE]),
    config: (path) =>
      path.includes("core") ? null : { linter: { enabled: true } },
  });
  assert.equal(result.ok, false);
  assert.match(
    result.lines.join("\n"),
    /packages\/core\/biome\.json.*could not be read/s,
  );
});

test("INJECTED DRIFT: a source file dropped from includes is named as unlinted", () => {
  const directory = makeRepo({
    includes: ["kept.mjs"],
    tracked: ["kept.mjs", "dropped.mjs"],
  });
  const result = runLintScopeGate({ cwd: directory });
  const report = result.lines.join("\n");
  assert.equal(result.ok, false, report);
  assert.match(
    report,
    /1 of 2 source file\(s\) git knows about are NOT linted/,
  );
  assert.match(report, /dropped\.mjs/);
});

test("INJECTED DRIFT: an override that switches the linter off keeps files in scope but unlinted", () => {
  // The door a scope check does not watch: `files.includes` still covers the file, Biome still
  // counts it as Checked, and #978's effect is reproduced anyway.
  const directory = makeRepo({
    includes: ["**/*.mjs"],
    tracked: ["a.mjs"],
    overrides: [
      { includes: ["**/*.mjs"], linter: { rules: { recommended: false } } },
    ],
  });
  const result = runLintScopeGate({ cwd: directory });
  assert.equal(result.ok, false, result.lines.join("\n"));
  assert.match(result.lines.join("\n"), /switches off the recommended preset/);
});

test("INJECTED DRIFT: an empty corpus fails closed instead of passing vacuously", () => {
  const result = runLintScopeGate({ listFiles: () => [] });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /corpus is empty/);
});

test("INJECTED DRIFT: Biome printing no processed list fails closed", () => {
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    biome: () => summary(1),
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /no `Files processed:` list/);
});

test("INJECTED DRIFT: a processed list shorter than the reported total fails closed", () => {
  // Guards the list itself: if Biome ever truncates or paginates the verbose output, the gate must
  // refuse rather than compare against a partial list and report the remainder as unlinted.
  const truncated = `${verbose(["a.ts"])}\n${summary(99)}`;
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    biome: () => truncated,
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /listed 1 processed path\(s\)/);
});

test("INJECTED DRIFT: Biome linting a path git does not know about fails the gate and names it", () => {
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    biome: () => verbose(["a.ts", CONFIG_FILE, "vendor/surprise.ts"]),
    config: () => ({ linter: { enabled: true } }),
  });
  const report = result.lines.join("\n");
  assert.equal(result.ok, false);
  assert.match(report, /1 path\(s\) that git does not report as source files/);
  assert.match(report, /vendor\/surprise\.ts/);
});

test("ACCEPTANCE #978: Biome checks a packages/*/src test file, rather than ignoring it", () => {
  // The acceptance criterion verbatim: `Checked 1 file`, not `Checked 0 files`.
  assert.equal(
    parseCheckedCount(
      runBiome(["lint", "--reporter=summary", A_PREVIOUSLY_UNLINTED_FILE]),
    ),
    1,
  );
});

test("the CLI exits 0 and reports the reconciliation when the scope is right", () => {
  const directory = makeRepo({ includes: ["**/*.mjs"], tracked: ["a.mjs"] });
  const output = execFileSync(process.execPath, [CHECK_LINT_SCOPE], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.match(
    output,
    /lint scope: 1 source file\(s\) git knows about, all linted/,
  );
});

test("INJECTED DRIFT: the CLI exits non-zero when the scope is wrong", () => {
  // The gate's kill switch. Mutating `process.exit(result.ok ? 0 : 1)` to a constant 0 must break
  // this test — nothing else in the suite would notice, and `npm run lint` would go green on a tree
  // with unlinted files.
  const directory = makeRepo({
    includes: ["kept.mjs"],
    tracked: ["kept.mjs", "dropped.mjs"],
  });
  let status = 0;
  let output = "";
  try {
    output = execFileSync(process.execPath, [CHECK_LINT_SCOPE], {
      cwd: directory,
      encoding: "utf8",
    });
  } catch (error) {
    status = error.status;
    output = `${error.stdout}`;
  }
  assert.equal(
    status,
    1,
    `the CLI must exit 1 on a failing gate, got ${status}:\n${output}`,
  );
  assert.match(output, /LINT SCOPE GATE FAILED/);
  assert.match(output, /dropped\.mjs/);
});

test("the gate reconciles this repository's real lint scope end to end", () => {
  // Exercises the real git enumeration, the real Biome binary and the real biome.json together —
  // the same reconciliation `npm run lint` performs, asserted here so a break shows up as a failing
  // test and not only as a red pipeline.
  const result = runLintScopeGate();
  assert.equal(result.ok, true, result.lines.join("\n"));
});

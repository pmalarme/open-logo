/**
 * Logic module for the `examples` Definition-of-Done gate (issue #283). Extracted so tests can
 * import it directly for 100% coverage, keeping `scripts/check-examples.mjs` a thin CLI shell —
 * the same split `scripts/harness/index.mjs` + `scripts/conformance.mjs` uses (docs/adr/0009).
 *
 * Earlier, this gate only checked that each `spec/examples/*.logo` file was present and
 * non-empty — it never parsed or ran them, so a file that fails to parse (e.g. the Heritage
 * `to … end` form, which is not yet implemented) was silently reported as passing.
 *
 * This module actually PARSES and EXECUTES each example through `@openlogo/parser` +
 * `@openlogo/runtime`'s public `execute()` — the same entry point the conformance harness uses
 * (`scripts/harness/index.mjs`). An example whose every required profile is already implemented
 * (see {@link IMPLEMENTED_PROFILES}) must produce zero error-severity `ol-*` diagnostics and must
 * not throw, or the gate fails. An example that needs a profile not yet implemented is SKIPPED
 * with a visible notice — it is never silently counted as a pass.
 *
 * **Profile under-declaration (issue #519, finding G8):** the SKIP path above is necessary
 * (a not-yet-implemented profile cannot be executed), but it must never become a way for an
 * example's manifest entry to *under*-declare a profile it actually depends on. A source file
 * that needs, say, Data (e.g. `:list[i]` list-index) but also declares an unrelated
 * not-yet-implemented profile (e.g. Sound) would previously be skipped in its entirety before
 * `data` was ever checked — silently masking the missing declaration.
 * `scripts/profile-detection.mjs`'s `detectUsedProfiles` statically scans the parsed AST (plus the
 * parser's own diagnostics, for the handful of reserved words with no AST production at all) for
 * the constructs `spec/conformance.md` classifies as normatively belonging to an optional profile —
 * see that module for the full per-profile audit — and {@link runExamplesGate} compares that
 * detected set against the manifest's declared profiles (expanded to their full dependency closure
 * via `scripts/harness/index.mjs`'s `PROFILE_DEPS`) for **every** example — before the SKIP
 * decision, so an under-declaration FAILS the gate loudly (naming the example and the missing
 * profile) even when the file would otherwise be skipped for an unrelated reason.
 *
 * **Host input (issue #955):** executing every example with an *empty* host made this gate
 * structurally blind to every host-dependent feature the language has. `spec/examples/10-game.logo`
 * states its own contract in prose — "expected output: each click prints the updated `:score`" —
 * and with no host delivering a click that output is unreachable, so the gate certified the file
 * green while asserting nothing about its interaction. Be exact about the scope of that failure:
 * this gate drives `@openlogo/runtime`'s `execute()`, so it could never have caught #952 (a
 * *studio* host-forwarding defect, asserted by `packages/studio`'s own tests). What it failed to
 * assert is the **language-level** contract that would have made the file's own stated output
 * testable at all. An example that registers a handler needing host delivery MUST therefore declare
 * a deterministic **host-input schedule** plus the output it expects, in
 * `scripts/examples-host-input.json` ({@link HOST_INPUT_PATH}) — the same declarative
 * `{ tick, kind }` shape a conformance fixture's `executeOptions.hostInput` uses, validated by the
 * harness's own {@link validateExecuteOptions}. {@link classifyExample} then runs the example with
 * that schedule and asserts the declared prints and event counts. Examples with no such handler keep
 * running exactly as before, and the summary line reports how many ran **with** input versus with
 * an empty host, so the blind fraction is visible rather than assumed.
 *
 * The profile manifest (`scripts/examples-profiles.json`) and the host-input manifest
 * (`scripts/examples-host-input.json`) are owned here, not under `spec/` — `spec/` is
 * maintainer-owned (AGENTS.md), so this gate must never add tags/headers to the `.logo` files
 * themselves.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { OL_EVENT_KINDS } from "@openlogo/core";
import { parse, walk } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";
import { closureOf, validateExecuteOptions } from "./harness/index.mjs";
import { detectUsedProfiles } from "./profile-detection.mjs";

export const EXAMPLES_DIR = join("spec", "examples");
export const MANIFEST_PATH = join("scripts", "examples-profiles.json");
export const HOST_INPUT_PATH = join("scripts", "examples-host-input.json");

/**
 * Profiles with real conformance fixtures today (`tests/conformance/<profile>/`) — i.e. the
 * spec's profile DAG (`spec/conformance.md`) nodes that are actually implemented, not just
 * planned. Update this list only alongside a saga that lands a new profile's conformance
 * fixtures (see `tests/conformance/README.md`); keeping it in lockstep is what lets this gate
 * SKIP (rather than wrongly fail or wrongly pass) an example that needs a profile not yet built.
 */
export const IMPLEMENTED_PROFILES = [
  "core-language",
  "turtle-rendering",
  "data",
  "geometry",
  "sound",
  "sprites",
  "heritage",
  "interaction-events",
];

/** Load the filename -> required-profile-id[] manifest from `manifestPath`. */
export function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

/**
 * Load the filename -> host-input entry manifest from `hostInputPath` (issue #955), stripping the
 * leading `_comment` key the JSON file carries in place of a comment syntax it does not have.
 */
export function loadHostInputManifest(hostInputPath = HOST_INPUT_PATH) {
  const { _comment, ...entries } = JSON.parse(
    readFileSync(hostInputPath, "utf8"),
  );
  return entries;
}

/**
 * Validate one `scripts/examples-host-input.json` entry (issue #955). Returns `null` when valid, or
 * an error string.
 *
 * Validated as strictly as the conformance harness validates a fixture's `executeOptions` — via the
 * very same {@link validateExecuteOptions} — for the same reason: an entry is what turns this gate
 * from "runs the program" into "asserts the program's stated output", so a typo'd key that loaded
 * clean and was silently ignored would leave a file that LOOKS driven while still running blind.
 * That is exactly the failure this issue exists to close, one level up.
 *
 * An entry declares:
 *   - `description` — optional prose, mirroring a conformance fixture's `description`: why this
 *     schedule and why these assertions are the decisive ones. JSON has no comment syntax, so
 *     without it an entry's rationale would have nowhere to live.
 *   - `executeOptions` — required, and it must carry a **non-empty** `hostInput.events`. An entry
 *     without deliveries would be counted as "ran with a host input schedule" while scheduling
 *     nothing, which is the original defect wearing this mechanism's clothes.
 *   - `expect.prints` — the ordered `print` event payloads the run must produce, compared exactly.
 *   - `expect.eventCounts` — exact totals for the named event kinds, for contracts a print cannot
 *     express (a key handler that only moves the turtle, say). Kinds are validated against
 *     `@openlogo/core`'s registry and counts must be non-negative integers, so a misspelled kind
 *     cannot quietly assert `0` — an assertion that holds for every kind that does not exist is not
 *     an assertion.
 * At least one of the two `expect` fields must be present, and `expect.prints` must not be an empty
 * array when it is the only assertion: an entry that schedules input but asserts nothing would
 * reintroduce the blindness in a form that merely looks busier.
 */
export function validateHostInputEntry(file, entry) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return `${file}: host-input entry must be an object`;
  }
  const ALLOWED_KEYS = new Set(["description", "executeOptions", "expect"]);
  for (const key of Object.keys(entry)) {
    if (!ALLOWED_KEYS.has(key)) {
      return `${file}: "${key}" is not a known host-input entry key (known keys: ${[...ALLOWED_KEYS].join(", ")})`;
    }
  }
  if (entry.executeOptions === undefined) {
    return `${file}: host-input entry must declare "executeOptions"`;
  }
  const optionsError = validateExecuteOptions(entry.executeOptions);
  if (optionsError !== null) {
    return `${file}: ${optionsError}`;
  }
  const events = entry.executeOptions.hostInput?.events;
  if (events === undefined || events.length === 0) {
    return `${file}: "executeOptions.hostInput.events" must deliver at least one event — an entry that schedules nothing would still be counted as running with a host input schedule (issue #955)`;
  }
  const expect = entry.expect;
  if (typeof expect !== "object" || expect === null || Array.isArray(expect)) {
    return `${file}: host-input entry must declare an "expect" object`;
  }
  const ALLOWED_EXPECT_KEYS = new Set(["prints", "eventCounts"]);
  for (const key of Object.keys(expect)) {
    if (!ALLOWED_EXPECT_KEYS.has(key)) {
      return `${file}: "expect.${key}" is not a known key (known keys: ${[...ALLOWED_EXPECT_KEYS].join(", ")})`;
    }
  }
  if (expect.prints !== undefined && !Array.isArray(expect.prints)) {
    return `${file}: "expect.prints" must be an array when present`;
  }
  if (
    expect.eventCounts !== undefined &&
    (typeof expect.eventCounts !== "object" ||
      expect.eventCounts === null ||
      Array.isArray(expect.eventCounts))
  ) {
    return `${file}: "expect.eventCounts" must be an object when present`;
  }
  for (const [kind, count] of Object.entries(expect.eventCounts ?? {})) {
    if (!OL_EVENT_KINDS.includes(kind)) {
      return `${file}: "expect.eventCounts.${kind}" is not an event kind in the @openlogo/core registry — a misspelled kind would assert 0 forever`;
    }
    if (!Number.isInteger(count) || count < 0) {
      return `${file}: "expect.eventCounts.${kind}" must be a non-negative integer`;
    }
  }
  const asserts =
    (expect.prints?.length ?? 0) + Object.keys(expect.eventCounts ?? {}).length;
  if (asserts === 0) {
    return `${file}: "expect" must assert something — declare a non-empty "prints" and/or "eventCounts"; an entry that delivers host input but asserts nothing leaves the example as unasserted as an empty host would (issue #955)`;
  }
  return null;
}

/**
 * Does `source` register a handler that **cannot fire unless a host delivers something** — an
 * `on_key`/`on_click` block head, or a `when` for any event other than `"start"`
 * (`spec/interaction-events.md`)?
 *
 * This is what makes the host-input requirement structural rather than a matter of remembering
 * (issue #955, review round 1). Without it, deleting or misspelling an example's entry in
 * `scripts/examples-host-input.json` would leave `npm run examples` green while the example silently
 * went back to running with an empty host — the manifest would be the only thing asserting that the
 * example is asserted, which is the recursion this whole issue is about. With it, the corpus itself
 * decides: any example that registers such a handler MUST carry a schedule, so a missing entry fails
 * the gate rather than quietly relaxing it.
 *
 * **The boundary is "needs delivery", not "is an interaction form"** — measured, because two review
 * rounds got it wrong in opposite directions. Each row below is a direct `execute()` run:
 *
 * | source (plus a clock-advancing `wait`) | prints under an EMPTY host | needs a schedule |
 * | --- | --- | --- |
 * | `on_click [ print 1 ]` | 0 | **yes** |
 * | `on_key "a" [ print 1 ]` | 0 | **yes** |
 * | `when "stop" [ print 1 ]` | 0 (1 when the host delivers `stop`) | **yes** |
 * | `when "start" [ print 1 ]` | 1 | no |
 * | `every 10 [ print 1 ]` | 10 | no |
 *
 * - `every` fires from the runtime's own **tick clock** (round 2: requiring a schedule for it would
 *   force a meaningless entry onto a correct timer-only example). Note the `wait`: with no
 *   clock-advancing statement the same program prints 0, so quoting `every 10 [ print 1 ]` alone as
 *   "prints 10" is wrong.
 * - `when "start"` is delivered internally — `packages/runtime/src/interaction.ts`: in a headless
 *   run "only `"start"` is *delivered*: the run has already started, so a `when "start"` handler
 *   fires immediately on registration".
 * - Every **other** `when` event, `"stop"` included, needs the host (round 3: excluding all of `when`
 *   reopened exactly the hole this predicate exists to close — an example advertising a `when "stop"`
 *   behaviour could pass with that behaviour unreachable).
 *
 * A `when` whose event word is **not a literal** (`when :chosen [ … ]`) cannot be classified
 * statically, so it is treated as needing a schedule. That is the conservative direction for a gate
 * whose purpose is to stop handlers going unasserted, and it is a stated residual rather than a
 * silent one: no example in the corpus uses a dynamic event word today.
 *
 * **The set is congruent with what a schedule can actually deliver**, which is the structural reason
 * behind the behavioural table. `HostInputEvent`
 * (`packages/runtime/src/interaction.ts:459-462`) has exactly three variants — `{kind:"key"}`,
 * `{kind:"click"}`, and `{kind:"event", event}` — and those are precisely `on_key`, `on_click`, and
 * `when`. So every head this predicate requires a schedule for is one a schedule can drive: measured,
 * `when "stop"` and even a vendor `when "acme.shake"` both fire when the entry delivers
 * `{tick, kind:"event", event}`. If that union ever gains or loses a variant, this set must be
 * revisited — state it here rather than leaving the congruence to be rediscovered.
 *
 * **`input` is excluded for a different reason, and it is worth naming** (review round 3): it *is*
 * host-dependent, but it is safe because the runtime **fails closed** rather than because it needs no
 * host. With an empty host an `input` read blocks until the execution budget trips, so
 * `execute()` reports `ol-limit` and {@link classifyExample} fails the example loudly — it cannot run
 * blind and pass. That safety comes from the budget, not from this gate: if `input` were ever changed
 * to yield an empty word instead of blocking, an `input`-using example would run blind and pass, and
 * this predicate would need to cover it. No example uses `input` today.
 *
 * Keyed on the `ProfileStatement` node the reader builds for a profile block head (issue #664).
 */
export function registersHostHandlers(source) {
  const ALWAYS_HOST_DRIVEN = new Set(["on_key", "on_click"]);
  const { ast } = parse(source);
  let found = false;
  walk(ast, (node) => {
    if (node.kind !== "ProfileStatement") {
      return;
    }
    const head = node.keyword.name.toLowerCase();
    if (ALWAYS_HOST_DRIVEN.has(head)) {
      found = true;
      return;
    }
    if (head !== "when") {
      return;
    }
    const event = node.args[0];
    const isStart =
      event !== undefined &&
      event.kind === "WordLit" &&
      event.value.toLowerCase() === "start";
    found ||= !isStart;
  });
  return found;
}

/** True when every profile in `requiredProfiles` is already implemented. */
export function isRunnable(requiredProfiles, implementedProfiles) {
  return requiredProfiles.every((profile) =>
    implementedProfiles.includes(profile),
  );
}

/**
 * Compare an executed run's observable output against a host-input entry's `expect` block
 * (issue #955), returning an array of human-readable mismatch reasons (empty when it all holds).
 */
function expectationFailures(events, expect) {
  const failures = [];
  if (expect.prints !== undefined) {
    const actual = events
      .filter((event) => event.kind === "print")
      .map((event) => event.payload);
    if (JSON.stringify(actual) !== JSON.stringify(expect.prints)) {
      failures.push(
        `expected prints ${JSON.stringify(expect.prints)} but got ${JSON.stringify(actual)}`,
      );
    }
  }
  if (expect.eventCounts !== undefined) {
    for (const [kind, expected] of Object.entries(expect.eventCounts)) {
      const actual = events.filter((event) => event.kind === kind).length;
      if (actual !== expected) {
        failures.push(
          `expected ${expected} "${kind}" event(s) but got ${actual}`,
        );
      }
    }
  }
  return failures;
}

/**
 * Parse+execute `source` (document label `name`) via `@openlogo/runtime`'s `execute()` and
 * classify the result. `execute()` is not expected to throw for a well-formed program, but a gate
 * must never itself crash on an unexpected internal error — an unexpected throw is reported as a
 * failure rather than propagated.
 *
 * With no `hostInputEntry` this is the historical behaviour: run with an empty host and require
 * zero error-severity diagnostics. With one (issue #955), the run is driven by the entry's
 * `executeOptions` and additionally has to satisfy the entry's `expect` block — so an example whose
 * contract is interactive has that contract actually asserted, instead of merely parsing and
 * executing while every handler stays unreachable.
 *
 * @returns `{ status: "pass" }`, or `{ status: "fail", reason }` when execution produced one or
 *   more error-severity diagnostics (joined into `reason`), failed an expectation, or threw.
 */
export function classifyExample(source, name, hostInputEntry = undefined) {
  let result;
  try {
    result = execute(source, name, hostInputEntry?.executeOptions);
  } catch (err) {
    return { status: "fail", reason: `threw: ${err.message}` };
  }
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    return {
      status: "fail",
      reason: errors.map((d) => `${d.code}: ${d.message}`).join("; "),
    };
  }
  if (hostInputEntry === undefined) {
    return { status: "pass" };
  }
  const failures = expectationFailures(result.events, hostInputEntry.expect);
  if (failures.length > 0) {
    return { status: "fail", reason: failures.join("; ") };
  }
  return { status: "pass" };
}

/**
 * Run the full examples gate over every `.logo` file in `dir`, using `manifest` (default: read
 * from `manifestPath`) to determine each file's required profiles. Never calls `process.exit` —
 * the CLI shell (`check-examples.mjs`) does that from the returned `ok` flag.
 *
 * For every example with a manifest entry, this also runs the profile under-declaration check
 * (issue #519, finding G8, see `scripts/profile-detection.mjs`) BEFORE deciding whether to run or
 * skip it: an example whose source uses a construct outside its declared profiles' dependency
 * closure FAILS loudly, naming the example and the missing profile(s), regardless of whether the
 * example would otherwise have run, passed, or been skipped for an unrelated not-yet-implemented
 * profile.
 *
 * An example named in `hostInputManifest` (default: read from `hostInputPath`) is executed with
 * that entry's host-input schedule and must satisfy its declared expectations (issue #955); an
 * example that registers a handler that needs host delivery and is NOT named there FAILS, so
 * the requirement comes from the corpus rather than from the manifest and a deleted entry cannot
 * quietly relax it. `every` and `when "start"` are excluded because they fire without host input — see
 * {@link registersHostHandlers}. Every other
 * example runs with an empty host exactly as before. The summary line reports both counts, so the
 * fraction of the corpus running blind is visible rather than assumed.
 *
 * @returns `{ ok, ran, ranWithInput, skipped, failed, lines }` — `lines` is the printable report
 *   (one `PASS`/`FAIL`/`SKIP` line per example plus a trailing summary line); `ok` is `false` when
 *   any example failed or the manifest/directory itself is invalid.
 */
export function runExamplesGate({
  dir = EXAMPLES_DIR,
  manifestPath = MANIFEST_PATH,
  manifest,
  hostInputPath = HOST_INPUT_PATH,
  hostInputManifest,
  implementedProfiles = IMPLEMENTED_PROFILES,
} = {}) {
  const lines = [];
  const empty = { ok: false, ran: 0, ranWithInput: 0, skipped: 0, failed: 0 };

  if (!existsSync(dir)) {
    lines.push(`examples: directory ${dir} does not exist`);
    return { ...empty, lines };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".logo"))
    .sort();

  if (files.length === 0) {
    lines.push(`examples: no .logo files found in ${dir}`);
    return { ...empty, lines };
  }

  const resolvedManifest = manifest ?? loadManifest(manifestPath);
  const resolvedHostInput =
    hostInputManifest ?? loadHostInputManifest(hostInputPath);

  let ran = 0;
  let ranWithInput = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const requiredProfiles = resolvedManifest[file];
    if (requiredProfiles === undefined) {
      failed += 1;
      lines.push(
        `FAIL ${file}: no entry in the profile manifest (${manifestPath}) — every example must declare its required profile(s)`,
      );
      continue;
    }

    const source = readFileSync(join(dir, file), "utf8");

    // Profile under-declaration check (issue #519, finding G8) runs for EVERY example, before
    // the SKIP decision below — so it can never be masked by an unrelated not-yet-implemented
    // profile. `requiredProfiles` is expanded to its full dependency closure (declaring
    // "geometry" already implies "data", for example) before comparing against what the source
    // actually uses.
    const declaredClosure = new Set(
      requiredProfiles.flatMap((profile) => [...closureOf(profile)]),
    );
    const usedProfiles = detectUsedProfiles(source);
    const underDeclared = usedProfiles.filter(
      (profile) => !declaredClosure.has(profile),
    );
    if (underDeclared.length > 0) {
      failed += 1;
      lines.push(
        `FAIL ${file}: under-declared profile(s) ${underDeclared.join(", ")} — ` +
          `the source uses a construct that requires ${underDeclared.length === 1 ? "profile" : "profiles"} ` +
          `${underDeclared.join(", ")} but ${manifestPath}'s entry (${requiredProfiles.join(", ")}) does not cover ` +
          `${underDeclared.length === 1 ? "it" : "them"}`,
      );
      continue;
    }

    const hostInputEntry = resolvedHostInput[file];
    // These two checks run BEFORE the SKIP decision below, for the same reason the profile
    // under-declaration check above does (issue #519's masking class): a malformed or missing entry
    // attached to an example that happens to need a not-yet-implemented profile would otherwise
    // load clean and go unreported until that profile lands.
    if (hostInputEntry === undefined) {
      // An example that registers such a handler and has NO entry would run with an empty
      // host and report PASS while every such handler in it stayed unreachable — exactly the state issue #955
      // exists to end. Requiring the schedule from the SOURCE rather than from the manifest is what
      // makes a deleted or misspelled entry fail rather than silently relax the gate.
      if (registersHostHandlers(source)) {
        failed += 1;
        lines.push(
          `FAIL ${file}: registers a handler that needs host delivery (on_key/on_click, or a "when" for any event but "start") but has no entry in ${hostInputPath} — ` +
            `it would run with an empty host, so none of them could fire and the gate would assert nothing about them (issue #955)`,
        );
        continue;
      }
    } else {
      const entryError = validateHostInputEntry(file, hostInputEntry);
      if (entryError !== null) {
        failed += 1;
        lines.push(`FAIL ${entryError} (${hostInputPath})`);
        continue;
      }
    }

    if (!isRunnable(requiredProfiles, implementedProfiles)) {
      const missing = requiredProfiles.filter(
        (profile) => !implementedProfiles.includes(profile),
      );
      skipped += 1;
      lines.push(
        `SKIP ${file} (requires ${missing.join(", ")} — not yet implemented)`,
      );
      continue;
    }

    ran += 1;
    if (hostInputEntry !== undefined) {
      ranWithInput += 1;
    }
    const outcome = classifyExample(source, file, hostInputEntry);
    if (outcome.status === "pass") {
      lines.push(
        hostInputEntry === undefined
          ? `PASS ${file}`
          : `PASS ${file} (with host input)`,
      );
    } else {
      failed += 1;
      lines.push(`FAIL ${file}: ${outcome.reason}`);
    }
  }

  lines.push(
    `examples: ran ${ran} (${ranWithInput} with a host input schedule, ${ran - ranWithInput} with an empty host), skipped ${skipped}, failed ${failed} (of ${files.length} total)`,
  );

  return { ok: failed === 0, ran, ranWithInput, skipped, failed, lines };
}

/** Parse CLI arguments: `--dir=<path>`, `--manifest=<path>` and `--host-input=<path>` override the
 * defaults (used by the subprocess regression test to point the CLI at isolated temp fixtures
 * instead of the real `spec/examples/` corpus). */
export function parseArgs(argv) {
  let dir;
  let manifestPath;
  let hostInputPath;
  for (const arg of argv) {
    if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (arg.startsWith("--manifest=")) {
      manifestPath = arg.slice("--manifest=".length);
    } else if (arg.startsWith("--host-input=")) {
      hostInputPath = arg.slice("--host-input=".length);
    }
  }
  return { dir, manifestPath, hostInputPath };
}

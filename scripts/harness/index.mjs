/**
 * Conformance harness logic module. Extracted per ADR-0009 to enable 100% test coverage via
 * direct imports, while keeping the CLI shell thin and subprocess-tested. See
 * docs/adr/0007-conformance-harness.md for the fixture contract.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import {
  OL_DIAGNOSTIC_CODES,
  OL_EVENT_KINDS,
  OL_STYLE_DIAGNOSTIC_CODES,
  OLDict,
  OLRecord,
} from "@openlogo/core";
import { check, parse } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";
import { detectUsedProfiles } from "../profile-detection.mjs";

export const ROOT = "tests/conformance";
export const EXPECTED_SUFFIX = ".expected.json";

/**
 * The fixture-name prefix that marks a harness self-test — a fixture whose job is to make the
 * harness report a failure, so it declares `expect: "mismatch"` and its *pass* is that detection.
 * Defined once because two places **in this file** must agree on it: {@link runHarness}, which
 * requires the polarity and never profile-filters these, and {@link MESSAGE_MISMATCH_SELF_TEST}.
 * (`scripts/coverage-report.mjs` keeps its own slash-less literal deliberately: it filters raw
 * `readdir` entries joined with the OS `sep`, not the POSIX fixture names this constant describes.)
 * Fixture names are POSIX-joined by {@link discoverFixtures}, so the separator is `/` everywhere.
 */
export const SELF_TEST_PREFIX = "_harness-selftest/";

/**
 * The ONE fixture allowed to combine `"compareMessages": true` with `expect: "mismatch"` — the
 * self-test that exists to prove the message comparison bites, and which can only demonstrate a
 * detection by expecting it (issue #1028).
 *
 * This is a complete fixture name compared by EQUALITY, not a prefix: a directory-prefix test would
 * let any additional fixture sited beside that self-test bypass the guard, which is not what "one
 * fixture" means. Narrowed to a single fixture rather than to {@link SELF_TEST_PREFIX} as a whole,
 * because `tests/conformance/README.md` already states the rule that way for fixture authors —
 * "**Do not combine `expect: "mismatch"` with a `message` anywhere else**: a self-test that exists
 * to prove some *other* mismatch is detected would then be able to pass on prose while its real
 * subject regresses". Exempting the whole tree would have enforced something looser than the
 * documented rule, and would have re-opened the hole for the other three self-tests.
 */
export const MESSAGE_MISMATCH_SELF_TEST = `${SELF_TEST_PREFIX}detects-message-mismatch/detects-message-mismatch${EXPECTED_SUFFIX}`;

// Profile dependency closure from spec/conformance.md's DAG.
export const PROFILE_DEPS = {
  "core-language": [],
  "turtle-rendering": ["core-language"],
  geometry: ["turtle-rendering", "data"],
  sprites: ["turtle-rendering"],
  data: ["core-language"],
  heritage: ["core-language", "data", "turtle-rendering"],
  "interaction-events": ["core-language"],
  sound: ["core-language"],
  modules: ["core-language"],
  localization: ["modules"],
  educational: ["core-language"],
  "tutor-ai": ["educational"],
};

const EVENT_KINDS = new Set(OL_EVENT_KINDS);
const DIAGNOSTIC_CODES = new Set([
  ...OL_DIAGNOSTIC_CODES,
  ...OL_STYLE_DIAGNOSTIC_CODES,
]);

/** Expand a profile to itself plus every transitive dependency; throws on an unknown profile. */
export function closureOf(profile) {
  const seen = new Set();
  const stack = [profile];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    const deps = PROFILE_DEPS[current];
    if (deps === undefined) {
      throw new Error(`unknown profile "${current}" (not in the spec DAG)`);
    }
    for (const dep of deps) {
      stack.push(dep);
    }
  }
  return seen;
}

/** Discover every `*.expected.json` fixture under tests/conformance/, sorted by path.
 * Validates that each .logo file has a .expected.json sibling and vice versa (no orphans).
 */
export function discoverFixtures(root = ROOT) {
  if (!existsSync(root)) {
    return [];
  }

  const expectedFiles = new Set();
  const logoFiles = new Set();

  // Scan directory for both file types
  for (const entry of readdirSync(root, { recursive: true }).map(String)) {
    if (entry.endsWith(EXPECTED_SUFFIX)) {
      expectedFiles.add(entry.slice(0, -EXPECTED_SUFFIX.length));
    } else if (entry.endsWith(".logo")) {
      logoFiles.add(entry.slice(0, -".logo".length));
    }
  }

  // Check for orphans
  const orphanExpected = [...expectedFiles].filter(
    (stem) => !logoFiles.has(stem),
  );
  const orphanLogo = [...logoFiles].filter((stem) => !expectedFiles.has(stem));

  if (orphanExpected.length > 0) {
    throw new Error(
      `Orphan .expected.json file(s) without .logo sibling:\n  ${orphanExpected.map((s) => s + EXPECTED_SUFFIX).join("\n  ")}`,
    );
  }
  if (orphanLogo.length > 0) {
    throw new Error(
      `Orphan .logo file(s) without .expected.json sibling:\n  ${orphanLogo.map((s) => `${s}.logo`).join("\n  ")}`,
    );
  }

  const fixtures = [];
  for (const stem of expectedFiles) {
    const entry = stem + EXPECTED_SUFFIX;
    const expectedPath = join(root, entry);
    fixtures.push({
      name: entry.split(sep).join("/"),
      expectedPath,
      logoPath: join(dirname(expectedPath), `${basename(stem)}.logo`),
    });
  }

  fixtures.sort((a, b) => a.name.localeCompare(b.name));
  return fixtures;
}

/**
 * Validate `ExecuteOptions.hostInput` (issue #686, slice I7; extended by #681, slice I2): the host
 * side of a headless run. It carries two independent fields, each optional:
 *
 *   - `events` — a tick-scheduled list of the key presses, clicks, and named events a host would
 *     deliver, so a fixture can prove handlers fire in the normative same-tick order.
 *   - `responses` — the scripted answers this run's `input` reads consume in order
 *     ({@link validateHostResponses}).
 *
 * Returns `null` when valid, or an
 * error string naming the first offending entry/field. Validated as strictly as `signal` so a
 * malformed schedule is rejected here rather than silently ignored by `execute()` (the durable-false-
 * claim hole the harness closes elsewhere). Each `events` entry must be a plain object with a
 * numeric `tick` and a discriminated `kind`:
 *   - `{ tick, kind: "key",   key }`   — `key` a string (the pressed key word)
 *   - `{ tick, kind: "click" }`        — no further field
 *   - `{ tick, kind: "event", event }` — `event` a string (the delivered named event)
 * No key beyond those is permitted on an entry, and unknown `kind`s are rejected, so a typo in a
 * per-entry field cannot mask a delivery that never happens.
 */
function validateHostInput(hostInput) {
  // `hostInput` is an OBJECT (issue #686, slice I7 — mirrors `ExecuteOptions.hostInput`), not the
  // bare `events` array, so issue #681's scripted `input` `responses` sit beside `events` without
  // reshaping this seam or migrating any fixture, per the maintainer's #657 ruling. Reject unknown
  // keys inside it — naming the allowed keys — so a typo'd sub-key (`event`, `evetns`, `response`)
  // cannot mask a delivery or an answer that never happens.
  if (
    typeof hostInput !== "object" ||
    hostInput === null ||
    Array.isArray(hostInput)
  ) {
    return `"executeOptions.hostInput" must be an object when present`;
  }
  // `read` (issue #681's live host reader) is deliberately NOT in this list. Like `tutorTemplates`
  // on `executeOptions` itself it is a FUNCTION, so no JSON fixture can supply one — a fixture
  // naming it is a mistake and is correctly rejected here, which is also what keeps `responses` the
  // single fixture convention the #657 ruling fixed.
  const ALLOWED_HOST_INPUT_KEYS = new Set(["events", "responses"]);
  for (const key of Object.keys(hostInput)) {
    if (!ALLOWED_HOST_INPUT_KEYS.has(key)) {
      return `"executeOptions.hostInput.${key}" is not a known hostInput key (known keys: ${[...ALLOWED_HOST_INPUT_KEYS].join(", ")})`;
    }
  }
  const responsesError = validateHostResponses(hostInput.responses);
  if (responsesError !== null) {
    return responsesError;
  }
  if (hostInput.events === undefined) {
    return null;
  }
  const events = hostInput.events;
  if (!Array.isArray(events)) {
    return `"executeOptions.hostInput.events" must be an array when present`;
  }
  const ALLOWED_KEYS = {
    key: new Set(["tick", "kind", "key"]),
    click: new Set(["tick", "kind"]),
    event: new Set(["tick", "kind", "event"]),
  };
  for (let index = 0; index < events.length; index += 1) {
    const entry = events[index];
    const at = `"executeOptions.hostInput.events[${index}]"`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return `${at} must be an object`;
    }
    if (typeof entry.tick !== "number" || !Number.isFinite(entry.tick)) {
      return `${at}.tick must be a finite number`;
    }
    if (
      entry.kind !== "key" &&
      entry.kind !== "click" &&
      entry.kind !== "event"
    ) {
      return `${at}.kind must be "key", "click", or "event"`;
    }
    if (entry.kind === "key" && typeof entry.key !== "string") {
      return `${at}.key must be a string when kind is "key"`;
    }
    if (entry.kind === "event" && typeof entry.event !== "string") {
      return `${at}.event must be a string when kind is "event"`;
    }
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_KEYS[entry.kind].has(key)) {
        return `${at} has an unexpected field "${key}" for kind "${entry.kind}"`;
      }
    }
  }
  return null;
}

/**
 * Validate `ExecuteOptions.hostInput.responses` (issue #681, slice I2): the scripted answers a
 * fixture's `input` reads consume, in order, so a headless conformance fixture can prove the
 * blocking reader's number-vs-word rule and its after-effects without a real input device — the
 * maintainer's #657 ruling that `input` is tested by **mocking the answer**, with no new event kind.
 * Returns `null` when valid (including when absent), or an error string naming the first offending
 * entry.
 *
 * Each entry MUST be a **string**: it is the raw text a learner would have typed, and `input`
 * classifies it as a number or a word by parsing it (`spec/interaction-events.md:188-189`). A
 * fixture writing the bare JSON number `42` instead of `"42"` is therefore rejected here rather than
 * silently reaching `execute()` — it would look like proof of the number branch while actually
 * skipping the very parse that branch is about. Validated as strictly as `events` above, for the
 * same durable-false-claim reason.
 */
function validateHostResponses(responses) {
  if (responses === undefined) {
    return null;
  }
  if (!Array.isArray(responses)) {
    return `"executeOptions.hostInput.responses" must be an array when present`;
  }
  for (let index = 0; index < responses.length; index += 1) {
    if (typeof responses[index] !== "string") {
      return `"executeOptions.hostInput.responses[${index}]" must be a string (the raw text the learner typed — write "42", not 42)`;
    }
  }
  return null;
}

/**
 * The five fields a fixture's expected diagnostic must always carry — its **identity** under
 * `spec/error-model.md:256-261` ("diagnostic identity is `code` plus `params`; prose is
 * presentation"), plus the span, stage and severity, because a fixture asserts *where* and *when*
 * too.
 */
const REQUIRED_DIAGNOSTIC_KEYS = [
  "code",
  "source_span",
  "params",
  "stage",
  "severity",
];

/**
 * Every key an expected diagnostic may carry: the five required ones plus the optional `message`,
 * which is only meaningful when the fixture sets `"compareMessages": true` (see
 * {@link loadFixture}). Anything else is rejected by name rather than dropped.
 */
const ALLOWED_DIAGNOSTIC_KEYS = new Set([
  ...REQUIRED_DIAGNOSTIC_KEYS,
  "message",
]);

/** Parse and normalise a fixture; returns `{ error }` on malformed JSON or missing source. */
export function loadFixture(fixture) {
  // Validate that both .logo and .expected.json exist
  if (!existsSync(fixture.logoPath)) {
    return { error: `missing source file ${fixture.logoPath}` };
  }
  if (!existsSync(fixture.expectedPath)) {
    return { error: `missing expected file ${fixture.expectedPath}` };
  }

  let spec;
  try {
    spec = JSON.parse(readFileSync(fixture.expectedPath, "utf8"));
  } catch (err) {
    return { error: `invalid JSON: ${err.message}` };
  }
  // Validate fixture schema (per spec/error-model.md - reject malformed JSON)
  if (!Array.isArray(spec.profiles)) {
    return { error: `"profiles" must be an array` };
  }
  if (!Array.isArray(spec.events)) {
    return { error: `"events" must be an array` };
  }
  if (!Array.isArray(spec.diagnostics)) {
    return { error: `"diagnostics" must be an array` };
  }

  // Validate each diagnostic has required fields per spec/error-model.md:28-38, and reject any key
  // outside the contract. Rejecting unknown keys is what stops a misspelled `mesage`/`Message`/`msg`
  // from loading clean and asserting nothing (`@testing` F1 on issue #1025) — the same
  // typo-masking hole {@link validateExecuteOptions} and ALLOWED_HOST_INPUT_KEYS already close
  // elsewhere in this file, and one that matters more now that `message` is load-bearing.
  for (let i = 0; i < spec.diagnostics.length; i++) {
    const diag = spec.diagnostics[i];
    for (const field of REQUIRED_DIAGNOSTIC_KEYS) {
      if (!diag[field]) {
        return { error: `diagnostic[${i}] missing required field "${field}"` };
      }
    }
    for (const key of Object.keys(diag)) {
      if (!ALLOWED_DIAGNOSTIC_KEYS.has(key)) {
        return {
          error: `diagnostic[${i}] has unknown key "${key}" (allowed: ${[...ALLOWED_DIAGNOSTIC_KEYS].join(", ")}) — an unrecognized key would be silently dropped and assert nothing`,
        };
      }
    }
    // `message` is optional, but when present it must be the non-empty string it will be compared
    // against. `Object.hasOwn` is what decides the per-diagnostic opt-in below, so `"message": null`
    // would otherwise opt in and then fail at compare time instead of here (`@testing` R2-F3). `""`
    // is rejected for the same reason and not a different one (R3-F2): `validateDiagnostics` makes
    // every *produced* message truthy, so an empty expectation can never match either — and the
    // point of checking here is to name the fixture's own mistake rather than hand back a diff.
    if (
      Object.hasOwn(diag, "message") &&
      (typeof diag.message !== "string" || diag.message === "")
    ) {
      return {
        error: `diagnostic[${i}] has a non-string or empty "message" (${JSON.stringify(diag.message)})`,
      };
    }
  }

  // "execute" is an opt-in flag (default false): only fixtures that opt in get their AST
  // executed via @openlogo/runtime; every other fixture stays parse-only (per issue #90 — the
  // parse-focused corpus is not all execution-valid, so execution must never run by default).
  if (spec.execute !== undefined && typeof spec.execute !== "boolean") {
    return { error: `"execute" must be a boolean when present` };
  }

  // "check" is an opt-in flag (default false), mirroring "execute": only fixtures that opt in
  // get their AST run through @openlogo/parser's check() semantic checker (per issue #116);
  // every other fixture stays parse-only (or execute-only), since the parse-focused corpus is
  // not all semantic-check-valid.
  if (spec.check !== undefined && typeof spec.check !== "boolean") {
    return { error: `"check" must be a boolean when present` };
  }

  // "style" is an opt-in flag (default false), mirroring "check": only fixtures that opt in
  // (alongside "check": true) get check()'s Layer-3 style lints enabled via { style: true }
  // (per issue #115); every other check:true fixture stays Layer-2-only, since the existing
  // check corpus never opted into style warnings and must not regress when they are added.
  if (spec.style !== undefined && typeof spec.style !== "boolean") {
    return { error: `"style" must be a boolean when present` };
  }

  // "executeOptions" (issue #195) is an opt-in object, valid only alongside "execute": true (and
  // NOT alongside "check": true), that is passed straight through to @openlogo/runtime's
  // execute() third argument. Its shape — the allow-listed JSON-expressible keys and their types —
  // is validated by {@link validateExecuteOptions}, which the examples gate shares so there is only
  // one definition of "an ExecuteOptions a JSON file may express". Only the fixture-specific
  // precondition lives here.
  // Requiring "execute": true (and rejecting "check": true) stops a fixture from setting
  // executeOptions where it would be silently ignored: produce() short-circuits on "check": true
  // BEFORE it ever reaches the "execute": true branch (see produce() below), so a
  // check:true+execute:true+executeOptions fixture would run check-mode only and never call
  // execute() — the same typo-masking hole as omitting "execute": true altogether.
  if (spec.executeOptions !== undefined) {
    if (spec.execute !== true || spec.check === true) {
      return {
        error: `"executeOptions" requires "execute": true and "check" to not be true (it configures @openlogo/runtime's execute(), which never runs when check:true short-circuits produce() first, or when execute isn't true at all)`,
      };
    }
    const executeOptionsError = validateExecuteOptions(spec.executeOptions);
    if (executeOptionsError !== null) {
      return { error: executeOptionsError };
    }
  }

  // "compareMessages" (issue #1025) is the per-fixture opt-in that makes a fixture's expected
  // diagnostic `message` load-bearing. It is DELIBERATELY explicit rather than inferred from the
  // presence of a `message` key, and the validations below are the point of the design.
  //
  // The default stays what `spec/error-model.md:256-261` asks for — "Tests and editor tools SHOULD
  // assert codes and params, not English text" — and that is not a formality: `:263-265` positively
  // permits a template author to "reorder, inflect, or soften prose", so most learner wording is
  // presentation a conforming implementation may change. Opt in only where the spec fixes the words
  // themselves; `ol-reserved-word` (`:125`) is the case this was built for, since it prescribes the
  // sentence AND makes *keyword*/*primitive*/*alias* a MUST NOT inside it — a MUST NOT no harness
  // can enforce without reading the text.
  //
  // Inferring the opt-in from a `message` key was tried first and rejected in review: the corpus
  // carried 306 of them written while the documented behaviour was "message is not compared", so
  // reading them as consent would have retroactively frozen ~275 English sentences the spec allows
  // an implementation to reword. Consent cannot be retroactive.
  //
  // Every way of leaving a `message` unable to assert what it claims is an error, so nothing can be
  // present-but-ignored again — which is AC-A3 turned from a one-time cleanup into a structural
  // property. Two of the three are checked here; the third (`expect: "mismatch"`, issue #1028)
  // follows immediately after, because it needs the fixture's name to exempt the self-test:
  //   - a `message` without the flag would be silently dropped, the exact defect #1025 exists to kill;
  //   - the flag without any `message` asserts nothing, the same way `executeOptions` without
  //     `"execute": true` does, and is a fixture-author mistake rather than a no-op.
  // (The third is different in kind: it does not drop the message, it removes the *guarantee* that
  // the message is what the fixture's verdict rests on. See the comment below it.)
  if (spec.compareMessages !== undefined) {
    if (typeof spec.compareMessages !== "boolean") {
      return { error: `"compareMessages" must be a boolean when present` };
    }
    if (
      spec.compareMessages === true &&
      !spec.diagnostics.some((diag) => Object.hasOwn(diag, "message"))
    ) {
      return {
        error: `"compareMessages": true but no expected diagnostic carries a "message" — the opt-in asserts nothing`,
      };
    }
  }
  if (spec.compareMessages !== true) {
    const withMessage = spec.diagnostics.findIndex((diag) =>
      Object.hasOwn(diag, "message"),
    );
    if (withMessage !== -1) {
      return {
        error: `diagnostic[${withMessage}] carries a "message" but the fixture does not set "compareMessages": true — it would be compared against nothing (issue #1025). Either opt in, or delete the message.`,
      };
    }
  }

  // The third way a `message` stops being guaranteed to assert what it claims, and the one the two
  // directions above left open (issue #1028): `expect: "mismatch"` INVERTS the harness verdict, so
  // an opted-in fixture that also expects a mismatch is satisfied by ANY disagreement — an event, a
  // diagnostic identity, or the prose. Which one it was is not knowable here, and that is exactly
  // the problem: the opt-in stops being *guaranteed* to assert anything, because the fixture can
  // pass on a difference that has nothing to do with the message it opted in to pin. Measured on
  // `4ad13363`: a fixture identical to what `check()` produces except for one wrong sentence
  // reported `1 passed, 0 failed`, while the twin differing only in polarity failed on that
  // sentence.
  //
  // The exemption is {@link MESSAGE_MISMATCH_SELF_TEST} alone — one complete fixture name, compared
  // by equality — NOT the whole self-test tree and not its directory: being a self-test does not
  // imply needing this combination, and a self-test that proves some *other* mismatch would be able
  // to pass on prose while its real subject regressed. A fixture object carrying no `name`
  // stringifies to something that is not that name, so the guard fails closed rather than open —
  // deliberately more defensive than `runHarness`'s bare `fixture.name`, because `loadFixture` is
  // exported and called directly, while `runHarness` only ever sees {@link discoverFixtures} output.
  //
  // Two orderings are deliberate. `expect` is validated below and defaults to `"match"`, so an
  // absent, mis-cased, or invalid value simply is not `"mismatch"` and falls through to its own
  // error rather than being reported as this one. And a fixture that sets the flag with NO
  // `message` at all is already rejected above as an opt-in that asserts nothing, so it is reported
  // as that mistake rather than this one — the combination is still refused either way.
  if (
    spec.compareMessages === true &&
    spec.expect === "mismatch" &&
    String(fixture.name) !== MESSAGE_MISMATCH_SELF_TEST
  ) {
    return {
      error: `"compareMessages": true with "expect": "mismatch" — the inverted verdict is satisfied by ANY disagreement (an event, a diagnostic identity, or the message), so the opt-in is not guaranteed to assert anything (issue #1028). Only ${MESSAGE_MISMATCH_SELF_TEST} may combine the two fields.`,
    };
  }

  const expected = {
    description: spec.description ?? "",
    profiles: spec.profiles,
    expect: spec.expect ?? "match",
    execute: spec.execute ?? false,
    check: spec.check ?? false,
    style: spec.style ?? false,
    compareMessages: spec.compareMessages ?? false,
    executeOptions: spec.executeOptions,
    events: spec.events,
    diagnostics: spec.diagnostics,
  };

  // Validate expect field
  if (expected.expect !== "match" && expected.expect !== "mismatch") {
    return {
      error: `invalid expect field: "${expected.expect}" (must be "match" or "mismatch")`,
    };
  }

  const source = readFileSync(fixture.logoPath, "utf8");
  return { expected, source };
}

/**
 * Validate an `ExecuteOptions` object supplied declaratively as JSON — a conformance fixture's
 * `executeOptions` (issue #195) or an examples-gate host-input entry's (issue #955). Returns `null`
 * when valid, or an error string naming the first offending key.
 *
 * Shared by both gates so there is exactly one definition of "an `ExecuteOptions` a JSON file may
 * express": a second, gate-local copy would drift, and the whole point of validating here is that a
 * typo'd key must not load clean, be silently ignored by `execute()`, and let a file that LOOKS
 * like proof pass while proving nothing. The fixture-only precondition — `executeOptions` requires
 * `"execute": true` and rejects `"check": true` — stays in {@link loadFixture}, since it is about
 * the fixture format rather than about `ExecuteOptions`.
 *
 * Every unknown key is rejected outright (issue #686, slice I7). The field is passed to `execute()`
 * verbatim, so a typo'd or unrecognized key (`hostinput`, `hostInputs`, a stray `budget`) would
 * otherwise be silently ignored — the exact durable-false-claim / typo-masking hole this harness
 * already closes for `execute`/`check`. Allow-listing the JSON-expressible `ExecuteOptions` keys
 * closes it for every future key at once, not just the ones enumerated below. `tutorTemplates` is
 * deliberately NOT in the list: it is a function (issue #332), so no JSON file can supply it — a
 * file naming it is a mistake and is correctly rejected here.
 */
export function validateExecuteOptions(executeOptions) {
  if (
    typeof executeOptions !== "object" ||
    executeOptions === null ||
    Array.isArray(executeOptions)
  ) {
    return `"executeOptions" must be an object when present`;
  }
  const KNOWN_EXECUTE_OPTION_KEYS = new Set([
    "instructionBudget",
    "recursionDepthLimit",
    "signal",
    "learnerLevel",
    "hostInput",
    "randomSeed",
  ]);
  for (const key of Object.keys(executeOptions)) {
    if (!KNOWN_EXECUTE_OPTION_KEYS.has(key)) {
      return `"executeOptions.${key}" is not a JSON-expressible ExecuteOptions key (known keys: ${[...KNOWN_EXECUTE_OPTION_KEYS].join(", ")})`;
    }
  }
  const {
    instructionBudget,
    recursionDepthLimit,
    signal,
    learnerLevel,
    hostInput,
    randomSeed,
  } = executeOptions;
  if (
    instructionBudget !== undefined &&
    typeof instructionBudget !== "number"
  ) {
    return `"executeOptions.instructionBudget" must be a number`;
  }
  if (
    recursionDepthLimit !== undefined &&
    typeof recursionDepthLimit !== "number"
  ) {
    return `"executeOptions.recursionDepthLimit" must be a number`;
  }
  // `signal`, when present, must be a plain `{ aborted: boolean }` object — the only shape JSON can
  // express and the only shape execute() actually needs (it just reads `signal.aborted`); JSON
  // cannot express a signal that flips mid-run, so only the "already cancelled" case is expressible.
  if (
    signal !== undefined &&
    (typeof signal !== "object" ||
      signal === null ||
      typeof signal.aborted !== "boolean")
  ) {
    return `"executeOptions.signal" must be an object with a boolean "aborted"`;
  }
  // "learnerLevel" (issue #332) — the learner's active curriculum level, a plain string
  // (`spec/educational-model.md`'s level table). execute() maps an unknown value to its default,
  // so only its type is checked here (a non-string is a mistake, rejected rather than silently
  // forwarded).
  if (learnerLevel !== undefined && typeof learnerLevel !== "string") {
    return `"executeOptions.learnerLevel" must be a string`;
  }
  // "hostInput" (issue #686, slice I7 — ExecuteOptions.hostInput) is a tick-scheduled list of key
  // presses, clicks, and named events a host would have delivered, so on_key/on_click/when
  // handlers can be proven to fire headlessly. Each entry MUST be a plain object with a numeric
  // `tick` and a discriminated `kind`: "key" (with a string `key`), "click", or "event" (with a
  // string `event`). Validated exactly as strictly as `signal` — a malformed entry is rejected here
  // rather than silently ignored by execute(), so an ordering fixture cannot "pass" while
  // delivering nothing. Like `signal`, JSON can only express a STATIC schedule fixed before the run
  // (it cannot depend on what the program does), so a declarative file proves ordering for a
  // pre-planned tick→deliveries schedule; input that reacts to program state stays a unit-test
  // concern.
  if (hostInput !== undefined) {
    const hostInputError = validateHostInput(hostInput);
    if (hostInputError !== null) {
      return hostInputError;
    }
  }
  // "randomSeed" (issue #865 — ExecuteOptions.randomSeed) pins the seed the run's shared
  // `random`/`randomize` generator starts from, so a file can express "this program, WITH this
  // randomness" instead of being unable to use `random` at all. Type-checked exactly like the two
  // numeric limits above: a non-number is a mistake, rejected here rather than forwarded and
  // silently folded to a state by `>>> 0`. Note what a single fixture still cannot express — the
  // property #865 creates is that two runs sharing a seed AGREE, and the fixture format is one
  // source to one expected event stream, so cross-run determinism stays a unit-test concern
  // (`packages/runtime/src/random-randomize.test.mjs`). What this does buy is a program that uses
  // `random` at all having a stable, reproducible expected stream.
  if (randomSeed !== undefined && typeof randomSeed !== "number") {
    return `"executeOptions.randomSeed" must be a number`;
  }
  return null;
}

/**
 * Gate an **executed** fixture on its declared `profiles` (issue #790).
 *
 * A fixture's `profiles` array used to *select* the fixture — {@link runHarness} intersects it with
 * the `--profile` closure to decide whether to run it — without ever *gating* it. For an
 * `"execute": true` fixture the array never reached `execute()` at all (`@openlogo/runtime` is
 * profile-blind by design, `spec/tooling.md:175-177` puts profile visibility in the Layer-2
 * checker), so a fixture whose source used Sprites forms passed with `"sprites"` deleted from its
 * array. The declaration was documentation, not enforcement — while `spec/conformance.md` makes
 * "this program requires exactly these profiles" a normative, independently-claimable property.
 *
 * This closes that hole statically, with `scripts/profile-detection.mjs`'s `detectUsedProfiles` —
 * the same detector the examples gate already uses for `spec/examples/*.logo` (issue #519). The
 * fixture's declared set is expanded to its full dependency closure ({@link closureOf}) first, so
 * declaring `"geometry"` already covers the `"data"` it depends on.
 *
 * **It applies to `"execute": true` fixtures only, and that scope is the point rather than a
 * convenience.** The other two modes are already correct without it, and gating them would be
 * wrong:
 *
 * - **check-mode** fixtures already get *real* profile gating: {@link produce} passes `profiles`
 *   into `check()`, which resolves primitives through the active set
 *   (`activeProfilePrimitiveArityRange`). Those fixtures deliberately name a profile's forms while
 *   that profile is INACTIVE — that is exactly what `heritage/check/heritage-forms-rejected-in-core`
 *   and its 30 siblings exist to prove — so a static under-declaration gate would fail the corpus's
 *   correct negative fixtures.
 * - **parse-only** fixtures have no profile semantics to gate: `spec/conformance.md:120` states the
 *   postfix-read grammar a list index uses "is unconditional Core syntax", so a Core-only fixture
 *   that merely *parses* `:nums[2]` is right as written.
 *
 * Execution is the case the spec ties to the profile: `spec/conformance.md:269` — "only
 * Data-claiming implementations execute the list case".
 *
 * Precondition: every entry of `expected.profiles` is a known profile. {@link runHarness} calls
 * this only after {@link fixtureErrors} has reported none, so {@link closureOf} cannot throw here.
 *
 * @returns an array of error strings (empty when the fixture is in order), in the same shape
 *   {@link fixtureErrors} returns so {@link runHarness} reports both the same way.
 */
export function profileGateErrors(expected, source) {
  if (expected.execute !== true || expected.check === true) {
    return [];
  }
  const declared = new Set(
    expected.profiles.flatMap((profile) => [...closureOf(profile)]),
  );
  const undeclared = detectUsedProfiles(source).filter(
    (profile) => !declared.has(profile),
  );
  if (undeclared.length === 0) {
    return [];
  }
  return [
    `source uses ${undeclared.length === 1 ? "profile" : "profiles"} ${undeclared.join(", ")}, which "profiles" (${expected.profiles.join(", ")}) does not declare — an executed fixture must declare every profile its source needs (issue #790)`,
  ];
}

/** Static checks that a fixture references only registered profiles, event kinds, and codes. */
export function fixtureErrors(expected) {
  const errors = [];
  for (const profile of expected.profiles) {
    if (!(profile in PROFILE_DEPS)) {
      errors.push(`profile "${profile}" is not a known OpenLogo profile`);
    }
  }
  for (const event of expected.events) {
    if (!EVENT_KINDS.has(event.kind)) {
      errors.push(
        `event kind "${event.kind}" is not in the @openlogo/core registry`,
      );
    }
  }
  for (const diagnostic of expected.diagnostics) {
    if (!DIAGNOSTIC_CODES.has(diagnostic.code)) {
      errors.push(
        `diagnostic code "${diagnostic.code}" is not in the @openlogo/core registry`,
      );
    }
  }
  return errors;
}

/**
 * Validate that diagnostics conform to the spec shape.
 * Per spec/error-model.md:28-38, every diagnostic must have a message field.
 * @param {Array} diagnostics - The diagnostics to validate.
 * @throws {Error} If any diagnostic is missing the message field.
 */
export function validateDiagnostics(diagnostics) {
  for (let i = 0; i < diagnostics.length; i++) {
    const diag = diagnostics[i];
    if (!diag.message) {
      throw new Error(
        `produce(): actual diagnostic[${i}] missing required "message" field (spec/error-model.md:28-38)`,
      );
    }
  }
}

/**
 * Parse (and, if opted in, execute or check) source and collect the output.
 *
 * When both `shouldExecute` and `shouldCheck` are false (the default), this is parse-only: it
 * calls the parser and collects parse diagnostics, returning an empty event stream — the
 * behavior every existing parse-focused fixture in the corpus relies on.
 *
 * When `shouldCheck` is true (a fixture opted in via `"check": true`), it calls `parse()` and,
 * if parsing produced no diagnostic, feeds the resulting AST to `@openlogo/parser`'s `check()`
 * (issue #116) along with the fixture's active `profiles` and, when `shouldStyle` also opted in
 * (`"style": true`, issue #115), `{ style: true }` to additionally enable the Layer-3 style
 * lints — returning the semantic/style diagnostics `check()` found (an empty list is a clean
 * pass). If parsing itself failed, the document is not check-valid, so the parse diagnostics are
 * returned unchanged and `check()` never runs — mirroring how `shouldExecute` already treats a
 * parse failure as terminal. Because this `shouldCheck` branch returns before the `shouldExecute`
 * branch below is ever reached, a fixture with both `"check": true` and `"execute": true` runs
 * check-mode only — `execute()` (and any `executeOptions`) never runs. `loadFixture()` rejects
 * `executeOptions` set alongside `"check": true` for exactly this reason.
 *
 * Otherwise, when `shouldExecute` is true (a fixture opted in via `"execute": true`), it calls
 * `@openlogo/runtime`'s `execute()` instead, which parses internally and also returns the
 * trace/event stream produced by walking the AST.
 *
 * Wire shape: parse diagnostics, runtime events/diagnostics, and check() diagnostics all already
 * use `source_span` (underscore) — the one field-name convention this harness uses throughout,
 * for both events and diagnostics (see tests/conformance/README.md). There is no separate wire
 * conversion step.
 *
 * @param {string} source - The OpenLogo source code to parse (and, if opted in, execute/check).
 * @param {string} document - The document identifier (fixture path) for diagnostic source_span.
 * @param {boolean} shouldExecute - Whether this fixture opted into execution (default false).
 * @param {boolean} shouldCheck - Whether this fixture opted into semantic checking (default false).
 * @param {string[]} profiles - The fixture's active profile set, passed to check() (default []).
 * @param {boolean} shouldStyle - Whether this fixture opted into style lints too (default false).
 * @param {object} [executeOptions] - Opt-in `ExecuteOptions` (issue #195) forwarded verbatim to
 *   @openlogo/runtime's `execute()` third argument when `shouldExecute` is true, letting a
 *   fixture deterministically trigger `ol-limit` with a small instructionBudget/
 *   recursionDepthLimit/pre-aborted signal instead of the large production defaults. Ignored when
 *   `shouldExecute` is false.
 */
export function produce(
  source,
  document,
  shouldExecute = false,
  shouldCheck = false,
  profiles = [],
  shouldStyle = false,
  executeOptions = undefined,
) {
  if (shouldCheck) {
    const { ast: program, diagnostics: parseDiagnostics } = parse(
      source,
      document,
    );
    const diagnostics =
      parseDiagnostics.length > 0
        ? parseDiagnostics
        : check(program, { profiles, source, style: shouldStyle }).diagnostics;
    validateDiagnostics(diagnostics);
    return { events: [], diagnostics };
  }

  const { events, diagnostics } = shouldExecute
    ? execute(source, document, executeOptions)
    : { events: [], ...parse(source, document) };

  // Validate actual diagnostics conform to spec (spec/error-model.md:28-38 requires message).
  validateDiagnostics(diagnostics);

  return { events, diagnostics };
}

/**
 * Unwrap an {@link OLDict} or {@link OLRecord} runtime value into the plain key→value object the
 * comparator already knows how to deep-compare, so a fixture's exact dict/record CONTENTS are
 * genuinely compared instead of the harness treating the instance as an opaque, always-unequal
 * reference. Every other value (primitive, array, plain object) passes through unchanged. Dict
 * keys are rendered via `String()` — a JSON object key is always a string anyway, so a fixture's
 * expected side already writes a numeric key the same way; record fields use their declared
 * spelling ({@link OLRecord.fields}). Only the immediate level is unwrapped: a nested dict/record
 * held by a value is unwrapped in turn the next time the comparator recurses into it.
 *
 * This deliberately does NOT fold the record's struct type name (`OLRecord.type`) into the
 * unwrapped shape — {@link checkRecordType} handles that separately, as an opt-in check, so the
 * plain field-object this returns stays exactly what the README documents a fixture writes for a
 * record's expected shape (`{"x": 1, "y": 2}`, no type marker) by default.
 */
function unwrapDataValue(value) {
  if (value instanceof OLDict) {
    const entries = {};
    for (const key of value.keys()) {
      entries[String(key)] = value.get(key);
    }
    return entries;
  }
  if (value instanceof OLRecord) {
    const entries = {};
    for (const field of value.fields()) {
      entries[field] = value.get(field);
    }
    return entries;
  }
  return value;
}

// Reserved expected-side key an `OLRecord` comparison may opt into (see `checkRecordType` below):
// a fixture that cares WHICH struct type an actual record is (not just its field contents) adds
// `"__type": "<struct name>"` alongside the record's usual field keys in its expected shape.
const RECORD_TYPE_KEY = "__type";

/**
 * Two records of different struct types can have identical declared field names/values (e.g.
 * `struct point [ x y ]` and `struct vector [ x y ]` both constructed with `3 4`) — since
 * {@link unwrapDataValue} unwraps an `OLRecord` to ONLY its field contents, such records are
 * otherwise indistinguishable to `deepEqual`/`graphEqual`: both would match the very same
 * type-less expected shape `{"x": 3, "y": 4}`. This verifies the struct type name BEFORE the
 * field-by-field comparison proceeds, whenever a fixture opts in by including the reserved
 * {@link RECORD_TYPE_KEY} in its expected shape (mirroring the `$id`/`$ref` graph markers'
 * additive, opt-in convention: existing fixtures that never mention `__type` are unaffected).
 *
 * Returns `true`/`false` when `actual` is an `OLRecord` and `expected` opted in (a verdict the
 * caller must respect before comparing anything else), or `undefined` when there is nothing to
 * check (`actual` isn't a record, or `expected` didn't ask) — the caller then falls through to
 * the ordinary structural comparison unchanged.
 */
function checkRecordType(expected, actual) {
  if (
    !(actual instanceof OLRecord) ||
    expected === null ||
    typeof expected !== "object" ||
    Array.isArray(expected) ||
    !Object.hasOwn(expected, RECORD_TYPE_KEY)
  ) {
    return undefined;
  }
  return expected[RECORD_TYPE_KEY] === actual.type;
}

/**
 * The keys of an expected object to structurally compare against an unwrapped record's fields:
 * the reserved {@link RECORD_TYPE_KEY} (when present) was already verified by
 * {@link checkRecordType}, so it must be excluded here — `unwrapDataValue`'s output never
 * contains it, and leaving it in would make every opted-in record fixture fail on a spurious
 * key-count mismatch.
 */
function comparableKeys(expected, typeChecked) {
  const keys = Object.keys(expected);
  return typeChecked === undefined
    ? keys
    : keys.filter((key) => key !== RECORD_TYPE_KEY);
}

/** Order-insensitive structural equality for the plain JSON values in a fixture. */
export function deepEqual(a, b) {
  const typeChecked = checkRecordType(a, b);
  if (typeChecked === false) {
    return false;
  }
  const actual = unwrapDataValue(b);
  if (a === actual) {
    return true;
  }
  if (
    a === null ||
    actual === null ||
    typeof a !== "object" ||
    typeof actual !== "object"
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(actual)) {
    if (
      !Array.isArray(a) ||
      !Array.isArray(actual) ||
      a.length !== actual.length
    ) {
      return false;
    }
    return a.every((value, index) => deepEqual(value, actual[index]));
  }
  const keys = comparableKeys(a, typeChecked);
  if (keys.length !== Object.keys(actual).length) {
    return false;
  }
  return keys.every(
    (key) => Object.hasOwn(actual, key) && deepEqual(a[key], actual[key]),
  );
}

// --- Graph fixtures: $id/$ref reference-identity extension -----------------------------------
//
// Per tests/conformance/README.md's "Graph fixtures" section (issue #495's fixture-format
// follow-up): a plain fixture asserts exact JSON deep-equality, which cannot express "this node
// is the same reference as that earlier node" or "this structure contains itself" — JSON is
// acyclic by construction and has no identity concept. A fixture opts into reference-identity
// assertions by wrapping any expected node once as `{"$id": "<label>", "$value": <node>}` (its
// first occurrence) and every later occurrence of that SAME reference as `{"$ref": "<label>"}`.
// Every other expected value stays plain JSON and is compared exactly as before — this
// extension is purely additive, so no existing fixture's meaning changes.

const GRAPH_ID_KEY = "$id";
const GRAPH_VALUE_KEY = "$value";
const GRAPH_REF_KEY = "$ref";

function isPlainObject(node) {
  return node !== null && typeof node === "object" && !Array.isArray(node);
}

/** Whether `node` is a `{"$id": "...", "$value": ...}` reference-definition wrapper. */
function isGraphIdNode(node) {
  return isPlainObject(node) && Object.hasOwn(node, GRAPH_ID_KEY);
}

/** Whether `node` is a `{"$ref": "..."}` back-reference to an earlier `$id`. */
function isGraphRefNode(node) {
  return isPlainObject(node) && Object.hasOwn(node, GRAPH_REF_KEY);
}

/**
 * Whether `value` (an expected fixture value) contains a `$id`/`$ref` graph marker anywhere,
 * so the harness only pays for identity-aware comparison on fixtures that opt in — every
 * pre-existing fixture (no markers) keeps using the plain {@link deepEqual} path unchanged.
 */
export function hasGraphMarkers(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (isGraphIdNode(value) || isGraphRefNode(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasGraphMarkers);
  }
  return Object.values(value).some(hasGraphMarkers);
}

/**
 * Identity-aware structural comparison for one expected/actual pair, understanding the
 * `$id`/`$value`/`$ref` graph-fixture convention (see above). Returns `{ matched, reason? }`.
 *
 * `ctx.idToActual` accumulates label → actual-reference bindings as `$id` nodes are visited,
 * registered *before* recursing into `$value` — so a `$ref` nested inside its own `$value`
 * (a genuine cycle, e.g. a self-referential list built via `add :l to :l`) resolves to the
 * correct, still-being-compared reference instead of recursing forever. This mirrors the
 * whole-capture/whole-render memo discipline `spec/execution-model.md` requires of a real
 * snapshot or a real render (issue #495). `ctx` is scoped to exactly ONE event's (or one
 * diagnostic's) payload comparison — per `spec/execution-model.md`'s effect-event snapshot rule,
 * every event is an independently captured, sealed snapshot, so the spec makes no identity
 * guarantee ACROSS two different events. A `$ref` may therefore only resolve to an `$id` declared
 * earlier within the SAME event; one declared in a different event is an undefined reference (a
 * clean mismatch, not a silent cross-event resolution) — see {@link diffStream}, which creates a
 * fresh `ctx` per stream item for exactly this reason.
 *
 * `ctx.actualToId` is the reverse binding. It also catches the opposite fixture bug: an actual
 * reference already bound to one label reappearing at a position the fixture left untagged (or
 * tagged with a different, unrelated `$id`) — an aliasing the fixture did not declare.
 */
export function graphEqual(
  expected,
  actual,
  ctx = { idToActual: new Map(), actualToId: new Map() },
  skipAliasCheckOnce = false,
) {
  if (isGraphRefNode(expected)) {
    const id = expected[GRAPH_REF_KEY];
    if (!ctx.idToActual.has(id)) {
      return {
        matched: false,
        reason: `$ref "${id}" has no earlier $id in this fixture`,
      };
    }
    const bound = ctx.idToActual.get(id);
    if (actual !== bound) {
      return {
        matched: false,
        reason: `$ref "${id}" expected the same reference $id "${id}" captured, but actual holds a different reference (or an equal-but-distinct copy)`,
      };
    }
    return { matched: true };
  }

  if (isGraphIdNode(expected)) {
    const id = expected[GRAPH_ID_KEY];
    // A primitive (number/word/boolean) is compared by value in JS, so reference identity is
    // moot for it — `$id` still asserts the wrapped value matches, but does not register (or
    // require) any alias binding. This keeps `$id`/`$ref` usable to label a primitive purely for
    // readability without the harness demanding a reference type it can never be.
    if (actual === null || typeof actual !== "object") {
      return graphEqual(expected[GRAPH_VALUE_KEY], actual, ctx, false);
    }
    const existingActual = ctx.idToActual.get(id);
    if (existingActual !== undefined) {
      return {
        matched: false,
        reason:
          existingActual === actual
            ? `$id "${id}" is declared more than once — a repeat occurrence of the same reference must use $ref "${id}" instead of redeclaring $id`
            : `$id "${id}" is declared more than once for different references — each $id label must be unique within a fixture`,
      };
    }
    const boundId = ctx.actualToId.get(actual);
    if (boundId !== undefined && boundId !== id) {
      return {
        matched: false,
        reason: `actual reference is already bound to $id "${boundId}" but reappears where the fixture declared a distinct $id "${id}" (unexpected aliasing)`,
      };
    }
    ctx.idToActual.set(id, actual);
    ctx.actualToId.set(actual, id);
    // `skipAliasCheckOnce`: the immediate recursion into this same $id's own `$value` compares
    // `actual` against itself/its own contents — the binding just registered above must not be
    // mistaken for a second, unrelated encounter of that reference by the generic check below.
    return graphEqual(expected[GRAPH_VALUE_KEY], actual, ctx, true);
  }

  if (
    !skipAliasCheckOnce &&
    actual !== null &&
    typeof actual === "object" &&
    ctx.actualToId.has(actual)
  ) {
    return {
      matched: false,
      reason: `actual reference is already bound to $id "${ctx.actualToId.get(actual)}" but reappears at a position the fixture did not tag with a matching $ref (unexpected aliasing)`,
    };
  }

  if (expected === actual) {
    return { matched: true };
  }
  // Same struct-type opt-in as `deepEqual` (see `checkRecordType`'s doc comment): when `expected`
  // includes the reserved `__type` key, a mismatching actual record's struct type is rejected
  // BEFORE the field-by-field shape comparison below — otherwise two differently-typed records
  // with identical field contents would be indistinguishable from the same expected shape.
  const typeChecked = checkRecordType(expected, actual);
  if (typeChecked === false) {
    return {
      matched: false,
      reason: `record type mismatch: expected "${expected[RECORD_TYPE_KEY]}" but actual is "${actual.type}"`,
    };
  }
  // An OLDict/OLRecord actual isn't a plain array/object, so unwrap it into the equivalent
  // key/value shape for the structural comparison below. Reference-identity tracking above
  // (isGraphIdNode/isGraphRefNode and the alias check) already used the original `actual`
  // reference, so this unwrap cannot affect aliasing/cycle detection — only structural content.
  const actualShape = unwrapDataValue(actual);
  if (
    expected === null ||
    actualShape === null ||
    typeof expected !== "object" ||
    typeof actualShape !== "object"
  ) {
    return { matched: false, reason: "value mismatch" };
  }
  if (Array.isArray(expected) || Array.isArray(actualShape)) {
    if (
      !Array.isArray(expected) ||
      !Array.isArray(actualShape) ||
      expected.length !== actualShape.length
    ) {
      return { matched: false, reason: "array shape mismatch" };
    }
    for (let i = 0; i < expected.length; i++) {
      const result = graphEqual(expected[i], actualShape[i], ctx);
      if (!result.matched) {
        return result;
      }
    }
    return { matched: true };
  }
  const keys = comparableKeys(expected, typeChecked);
  if (keys.length !== Object.keys(actualShape).length) {
    return { matched: false, reason: "object shape mismatch" };
  }
  for (const key of keys) {
    if (!Object.hasOwn(actualShape, key)) {
      return { matched: false, reason: `missing key "${key}"` };
    }
    const result = graphEqual(expected[key], actualShape[key], ctx);
    if (!result.matched) {
      return result;
    }
  }
  return { matched: true };
}

/**
 * `JSON.stringify`, but replaces any reference that is its own ancestor (a genuine cycle) with
 * `"[[circular]]"` instead of throwing. Needed for mismatch reporting: a fixture exercising issue
 * #495's cyclic/aliased values may hold a genuinely cyclic actual value, which plain
 * `JSON.stringify` cannot serialize at all.
 *
 * Deliberately tracks only the *current path* (a stack of in-progress ancestors), not every
 * reference ever visited — a plain acyclic-but-shared reference (the same sub-list appearing
 * twice, unrelated to each other) must still render its full contents at each occurrence rather
 * than being collapsed to a placeholder the second time; only an actual self-reference (a node
 * that is its own ancestor while still being rendered) gets the placeholder.
 */
export function safeStringify(value) {
  const onPath = new Set();
  function walk(node) {
    if (node === null || typeof node !== "object") {
      return node;
    }
    if (onPath.has(node)) {
      return "[[circular]]";
    }
    onPath.add(node);
    try {
      if (Array.isArray(node)) {
        return node.map((item) => walk(item));
      }
      const out = {};
      for (const key of Object.keys(node)) {
        out[key] = walk(node[key]);
      }
      return out;
    } finally {
      onPath.delete(node);
    }
  }
  try {
    return JSON.stringify(walk(value));
  } catch (err) {
    return `[[unstringifiable: ${err.message}]]`;
  }
}

/**
 * One expected/actual comparison, dispatching to the identity-aware {@link graphEqual} when the
 * expected side opted in via a `$id`/`$ref` marker, or the plain {@link deepEqual} otherwise
 * (every pre-existing fixture). Either path is wrapped so a comparison that would otherwise
 * overflow the host call stack — e.g. a genuinely cyclic actual value the fixture forgot to
 * encode with `$id`/`$ref` — is reported as a clean mismatch instead of crashing the harness.
 */
export function itemsMatch(expectedItem, actualItem, ctx) {
  try {
    if (hasGraphMarkers(expectedItem)) {
      return graphEqual(expectedItem, actualItem, ctx);
    }
    return { matched: deepEqual(expectedItem, actualItem) };
  } catch (err) {
    return {
      matched: false,
      reason: `comparison error (an actual cyclic/shared value may need the fixture's expected side to use $id/$ref — see tests/conformance/README.md): ${err.message}`,
    };
  }
}

/** Diff two streams element-by-element; return a readable report of the first mismatch, or null. */
export function diffStream(label, keyField, expected, actual) {
  const count = Math.max(expected.length, actual.length);
  for (let index = 0; index < count; index++) {
    const expectedItem = expected[index];
    const actualItem = actual[index];
    // A fresh `ctx` per item: per spec/execution-model.md's effect-event snapshot rule, each
    // event (or diagnostic) is an independently captured, sealed snapshot. The spec guarantees
    // alias/cycle identity WITHIN one event's payload but makes no identity guarantee ACROSS two
    // different events, so a fixture's $id/$ref graph markers must only ever resolve within the
    // SAME item — never leak into (or out of) a sibling item's payload.
    const ctx = { idToActual: new Map(), actualToId: new Map() };
    const result = itemsMatch(expectedItem, actualItem, ctx);
    if (result.matched) {
      continue;
    }
    const key = expectedItem?.[keyField] ?? actualItem?.[keyField] ?? index;
    const reasonLine = result.reason ? `\n    reason:   ${result.reason}` : "";
    return [
      `  ${label} mismatch at ${keyField}=${JSON.stringify(key)} (index ${index}):`,
      `    expected: ${expectedItem === undefined ? "(missing)" : safeStringify(expectedItem)}`,
      `    actual:   ${actualItem === undefined ? "(missing)" : safeStringify(actualItem)}${reasonLine}`,
    ].join("\n");
  }
  return null;
}

/**
 * The five fields that are a diagnostic's **identity** under `spec/error-model.md:256-261`:
 * "diagnostic identity is `code` plus `params`; prose is presentation", with the span, stage and
 * severity carried alongside because a fixture asserts *where* and *when* too. Every fixture is
 * compared on these, always.
 */
function diagnosticIdentity(diagnostic) {
  return {
    code: diagnostic.code,
    source_span: diagnostic.source_span,
    params: diagnostic.params,
    stage: diagnostic.stage,
    severity: diagnostic.severity,
  };
}

/**
 * Project one expected/actual diagnostic down to the fields to compare: its identity, plus
 * `message` only when `withMessage`. Both sides of a pair are projected with the **same**
 * `withMessage`, so an actual message is never compared against an expectation that did not ask for
 * one.
 */
function projectDiagnostic(diagnostic, withMessage) {
  const projected = diagnosticIdentity(diagnostic);
  if (withMessage) {
    projected.message = diagnostic.message;
  }
  return projected;
}

/**
 * Compare produced output against expected; `matched` is true when both streams agree.
 *
 * Diagnostic prose is compared only when the fixture set `"compareMessages": true` **and** the
 * individual expected diagnostic carries a `message` — see {@link loadFixture} for why the fixture
 * flag is explicit rather than inferred, and why a `message` without the flag is a fixture error
 * instead of a silent no-op. Within an opted-in fixture the per-diagnostic grain is what lets a
 * fixture pin the one sentence the spec fixes and leave its siblings on identity alone.
 */
export function compare(expected, actual) {
  // Diagnostics are aligned by index, and by the SAME index alignment diffStream uses, so the
  // expected diagnostic at index i decides whether the actual one at index i has its message
  // compared. An actual diagnostic past the end of the expected stream has no expectation to
  // consult, so it is projected to identity alone — it is reported as surplus either way.
  const comparesMessage = (expectedDiagnostic) =>
    expected.compareMessages === true &&
    expectedDiagnostic !== undefined &&
    Object.hasOwn(expectedDiagnostic, "message");

  const expectedDiagnostics = expected.diagnostics.map((diagnostic) =>
    projectDiagnostic(diagnostic, comparesMessage(diagnostic)),
  );
  const actualDiagnostics = actual.diagnostics.map((diagnostic, index) =>
    projectDiagnostic(diagnostic, comparesMessage(expected.diagnostics[index])),
  );

  // No ctx is created (or shared) here: diffStream gives every individual event/diagnostic its
  // own fresh graph-identity ctx, so $id/$ref aliasing can never leak across two events, across
  // two diagnostics, or between the event stream and the diagnostic stream.
  const reports = [
    diffStream("event", "seq", expected.events, actual.events),
    diffStream("diagnostic", "code", expectedDiagnostics, actualDiagnostics),
  ].filter((report) => report !== null);
  return { matched: reports.length === 0, report: reports.join("\n") };
}

/** Parse CLI arguments. */
export function parseArgs(argv) {
  let profile;
  for (const arg of argv) {
    if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length);
    }
  }
  const flagIndex = argv.indexOf("--profile");
  if (flagIndex !== -1 && flagIndex + 1 < argv.length) {
    profile = argv[flagIndex + 1];
  }
  return { profile };
}

/**
 * Run the conformance harness with the given options. Returns exit code.
 * This is the main logic entry point; the CLI shell calls this.
 */
export function runHarness(options = {}) {
  const { profile: selectedProfile, root = ROOT } = options;

  // Validate selected profile
  if (selectedProfile) {
    if (!(selectedProfile in PROFILE_DEPS)) {
      console.error(
        `conformance: unknown profile "${selectedProfile}" (not in the spec DAG)`,
      );
      return 2;
    }
  }

  const fixtures = discoverFixtures(root);
  if (fixtures.length === 0) {
    console.log(
      `conformance: no fixtures found under ${root} — nothing to run.`,
    );
    return 0;
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];

  for (const fixture of fixtures) {
    const loaded = loadFixture(fixture);
    if (loaded.error) {
      failed++;
      failures.push(`FAIL ${fixture.name}\n  ${loaded.error}`);
      continue;
    }

    const { expected, source } = loaded;

    // Check off-contract violations
    const errors = fixtureErrors(expected);
    // The declared-profile gate (issue #790) runs only once the fixture's profile identifiers are
    // known-good, so `closureOf` cannot throw on an unregistered one.
    if (errors.length === 0) {
      errors.push(...profileGateErrors(expected, source));
    }
    if (errors.length > 0) {
      failed++;
      failures.push(
        `FAIL ${fixture.name} (off-contract fixture)\n  ${errors.join("\n  ")}`,
      );
      continue;
    }

    // Identify self-tests early (before profile filtering) so they always run
    const isSelfTest = fixture.name.startsWith(SELF_TEST_PREFIX);

    // Self-tests must declare expect: "mismatch"
    if (isSelfTest && expected.expect !== "mismatch") {
      failed++;
      failures.push(
        `FAIL ${fixture.name} (self-test must declare expect: "mismatch")`,
      );
      continue;
    }

    // Filter by profile if --profile was given (but always run self-tests)
    if (selectedProfile && !isSelfTest) {
      const closure = closureOf(selectedProfile);
      const isIncluded = expected.profiles.some((p) => closure.has(p));
      if (!isIncluded) {
        skipped++;
        continue;
      }
    }

    // Document name for parser = fixture path without .expected.json suffix
    const document = fixture.name.replace(/\.expected\.json$/, "");
    const result = compare(
      expected,
      produce(
        source,
        document,
        expected.execute,
        expected.check,
        expected.profiles,
        expected.style,
        expected.executeOptions,
      ),
    );

    // Use expect field to determine comparison polarity
    const expectMatch = expected.expect === "match";
    const success = expectMatch ? result.matched : !result.matched;

    if (success) {
      passed++;
      if (isSelfTest) {
        console.log(
          `ok   ${fixture.name} — self-test: mismatch correctly detected`,
        );
        console.log(result.report);
      } else {
        console.log(`ok   ${fixture.name}`);
      }
    } else {
      failed++;
      if (expectMatch) {
        failures.push(`FAIL ${fixture.name}\n${result.report}`);
      } else {
        failures.push(
          `FAIL ${fixture.name} (expected mismatch but streams matched)`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.log("");
    for (const failure of failures) {
      console.log(failure);
    }
  }

  const scope = selectedProfile ? `profile "${selectedProfile}"` : "full DAG";
  console.log(
    `\nconformance: ${passed} passed, ${failed} failed, ${skipped} skipped (${scope})`,
  );

  return failed > 0 ? 1 : 0;
}

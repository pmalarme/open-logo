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
} from "@openlogo/core";
import { check, parse } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

export const ROOT = "tests/conformance";
export const EXPECTED_SUFFIX = ".expected.json";

// Profile dependency closure from spec/conformance.md's DAG.
export const PROFILE_DEPS = {
  "core-language": [],
  "turtle-rendering": ["core-language"],
  geometry: ["turtle-rendering", "data"],
  sprites: ["turtle-rendering"],
  data: ["core-language"],
  heritage: ["core-language", "data"],
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

  // Validate each diagnostic has required fields per spec/error-model.md:28-38
  // Note: "message" is optional per error-model.md:193-194 (diagnostic identity = code+params, not prose)
  for (let i = 0; i < spec.diagnostics.length; i++) {
    const diag = spec.diagnostics[i];
    if (!diag.code) {
      return { error: `diagnostic[${i}] missing required field "code"` };
    }
    if (!diag.source_span) {
      return { error: `diagnostic[${i}] missing required field "source_span"` };
    }
    if (!diag.params) {
      return { error: `diagnostic[${i}] missing required field "params"` };
    }
    if (!diag.stage) {
      return { error: `diagnostic[${i}] missing required field "stage"` };
    }
    if (!diag.severity) {
      return { error: `diagnostic[${i}] missing required field "severity"` };
    }
    // message is optional (prose, not identity)
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
  // execute() third argument (ExecuteOptions: instructionBudget/recursionDepthLimit/signal). It
  // exists so a fixture can deterministically trigger the execution-safety gates (ol-limit) with
  // a small, hand-reviewable budget/depth instead of hanging on the large production defaults.
  // `signal`, when present, must be a plain `{ aborted: boolean }` object — the only shape JSON
  // can express and the only shape execute() actually needs (it just reads `signal.aborted`); a
  // fixture cannot express a signal that flips mid-run, so a fixture can only assert the
  // "already cancelled" case.
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
    if (
      typeof spec.executeOptions !== "object" ||
      spec.executeOptions === null ||
      Array.isArray(spec.executeOptions)
    ) {
      return { error: `"executeOptions" must be an object when present` };
    }
    const { instructionBudget, recursionDepthLimit, signal } =
      spec.executeOptions;
    if (
      instructionBudget !== undefined &&
      typeof instructionBudget !== "number"
    ) {
      return { error: `"executeOptions.instructionBudget" must be a number` };
    }
    if (
      recursionDepthLimit !== undefined &&
      typeof recursionDepthLimit !== "number"
    ) {
      return {
        error: `"executeOptions.recursionDepthLimit" must be a number`,
      };
    }
    if (
      signal !== undefined &&
      (typeof signal !== "object" ||
        signal === null ||
        typeof signal.aborted !== "boolean")
    ) {
      return {
        error: `"executeOptions.signal" must be an object with a boolean "aborted"`,
      };
    }
  }

  const expected = {
    description: spec.description ?? "",
    profiles: spec.profiles,
    expect: spec.expect ?? "match",
    execute: spec.execute ?? false,
    check: spec.check ?? false,
    style: spec.style ?? false,
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

/** Order-insensitive structural equality for the plain JSON values in a fixture. */
export function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  return keys.every(
    (key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]),
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
 * snapshot or a real render (issue #495). `ctx` is shared across an entire `compare()` call (both
 * the event stream and the diagnostic stream), so a fixture can assert identity that spans two
 * different effect events, e.g. "the list `print` showed here is unaffected by a later mutation
 * shown there."
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
      return { matched: false, reason: `$ref "${id}" has no earlier $id in this fixture` };
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
    if (existingActual !== undefined && existingActual !== actual) {
      return {
        matched: false,
        reason: `$id "${id}" is declared more than once for different references — each $id label must be unique within a fixture`,
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
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  ) {
    return { matched: false, reason: "value mismatch" };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (
      !Array.isArray(expected) ||
      !Array.isArray(actual) ||
      expected.length !== actual.length
    ) {
      return { matched: false, reason: "array shape mismatch" };
    }
    for (let i = 0; i < expected.length; i++) {
      const result = graphEqual(expected[i], actual[i], ctx);
      if (!result.matched) {
        return result;
      }
    }
    return { matched: true };
  }
  const keys = Object.keys(expected);
  if (keys.length !== Object.keys(actual).length) {
    return { matched: false, reason: "object shape mismatch" };
  }
  for (const key of keys) {
    if (!Object.hasOwn(actual, key)) {
      return { matched: false, reason: `missing key "${key}"` };
    }
    const result = graphEqual(expected[key], actual[key], ctx);
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
export function diffStream(label, keyField, expected, actual, ctx) {
  const count = Math.max(expected.length, actual.length);
  for (let index = 0; index < count; index++) {
    const expectedItem = expected[index];
    const actualItem = actual[index];
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

/** Compare produced output against expected; `matched` is true when both streams agree. */
export function compare(expected, actual) {
  // Per spec/error-model.md:193-194, diagnostic identity = code+params, not prose.
  // Exclude "message" from comparison (prose may change under localization/rewording).
  const projectDiagnostic = (d) => ({
    code: d.code,
    source_span: d.source_span,
    params: d.params,
    stage: d.stage,
    severity: d.severity,
  });

  // One `ctx`, shared across the event stream AND the diagnostic stream, so a graph fixture's
  // $id/$ref labels can span the whole fixture (e.g. asserting identity across two events).
  const ctx = { idToActual: new Map(), actualToId: new Map() };

  const reports = [
    diffStream("event", "seq", expected.events, actual.events, ctx),
    diffStream(
      "diagnostic",
      "code",
      expected.diagnostics.map(projectDiagnostic),
      actual.diagnostics.map(projectDiagnostic),
      ctx,
    ),
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
    if (errors.length > 0) {
      failed++;
      failures.push(
        `FAIL ${fixture.name} (off-contract fixture)\n  ${errors.join("\n  ")}`,
      );
      continue;
    }

    // Identify self-tests early (before profile filtering) so they always run
    const isSelfTest = fixture.name.startsWith("_harness-selftest/");

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

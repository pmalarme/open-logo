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
 * `data` was ever checked — silently masking the missing declaration. {@link detectUsedProfiles}
 * statically scans the parsed AST for the constructs `spec/conformance.md` classifies as
 * normatively belonging to an optional profile (list-index/dict/struct/mutation-form usage and
 * the Data-profile derived reporters `dict`/`list`/`reverse`/`pick`/`sort`/`keys`/`values`/
 * `type_of` — detected via `@openlogo/parser`'s own `dataPrimitiveArity()` name table, not a
 * second hand-maintained list — for Data; `grid`/`axes`/`measure` via `geometryPrimitiveArity()`
 * for Geometry; `explain`/`why`/`hint`/`debug` via `educationalPrimitiveArity()` for Educational;
 * `note`/`beep`/`play`/`rest`/`set_tempo` for Sound;
 * `input`/`when`/`every`/`on_key`/`on_click`/`wait` for Interaction & Events;
 * `new_turtle`/`tell`/`ask`/`each`/`turtles`/`who` for Sprites; the closed Heritage short-alias
 * list plus `make` plus `value of … for key` (which also needs Data) for Heritage — see
 * {@link detectUsedProfiles}'s own doc comment for the full per-profile audit, including the
 * profiles/spellings that are honestly undetectable today (Modules, Localization, Tutor (AI)'s
 * `challenge`, and the Heritage `to`/`output`/`op` spellings) and why), and
 * {@link runExamplesGate} compares that detected set against the manifest's declared profiles
 * (expanded to their full dependency closure via `scripts/harness/index.mjs`'s `PROFILE_DEPS`)
 * for **every** example — before the SKIP decision, so an under-declaration FAILS the gate loudly
 * (naming the example and the missing profile) even when the file would otherwise be skipped for
 * an unrelated reason.
 *
 * The profile manifest (`scripts/examples-profiles.json`) is owned here, not under `spec/` —
 * `spec/` is maintainer-owned (AGENTS.md), so this gate must never add tags/headers to the
 * `.logo` files themselves.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  dataPrimitiveArity,
  educationalPrimitiveArity,
  geometryPrimitiveArity,
  parse,
  walk,
} from "@openlogo/parser";
import { execute } from "@openlogo/runtime";
import { closureOf } from "./harness/index.mjs";

export const EXAMPLES_DIR = join("spec", "examples");
export const MANIFEST_PATH = join("scripts", "examples-profiles.json");

/**
 * Profiles with real conformance fixtures today (`tests/conformance/<profile>/`) — i.e. the
 * spec's profile DAG (`spec/conformance.md`) nodes that are actually implemented, not just
 * planned. Update this list only alongside a milestone that lands a new profile's conformance
 * fixtures (see `tests/conformance/README.md`); keeping it in lockstep is what lets this gate
 * SKIP (rather than wrongly fail or wrongly pass) an example that needs a profile not yet built.
 */
export const IMPLEMENTED_PROFILES = [
  "core-language",
  "turtle-rendering",
  "data",
  "geometry",
];

/**
 * AST node kinds that `spec/conformance.md`'s feature table classifies as unconditionally
 * **Data**-profile behavior, regardless of what implementation-status other profiles the example
 * also declares: dictionary literals (`{ key: value }`), `struct` type declarations, and the
 * `add`/`remove`/`clear`/`insert` collection-mutation forms.
 *
 * `ValueOfKey` (the Heritage `value of … for key` dictionary reader) is deliberately NOT in this
 * set: `spec/conformance.md:273`/`:301` classify that spelling as **Heritage**, which *also*
 * depends on **Data** because the reader operates on dicts — so a source using it needs BOTH
 * profiles, not just Data. It gets its own check below so it can add both.
 *
 * This does NOT cover the Data profile's derived-reporter *primitives* (`dict`, `list`, `reverse`,
 * `pick`, `sort`, `keys`, `values`, `type_of`, `spec/data-structures.md`'s "Derived list
 * reporters"/dictionary/record-operation tables) — those are call-site names, not distinct node
 * kinds (they parse as ordinary `Call`/`ParenCall` nodes), so {@link detectUsedProfiles} detects
 * them via `@openlogo/parser`'s own `dataPrimitiveArity()` name table instead of a second,
 * hand-maintained name list that could drift from the parser's.
 */
const DATA_NODE_KINDS = new Set([
  "DictLit",
  "StructDef",
  "Add",
  "Remove",
  "RemoveKey",
  "Insert",
  "Clear",
]);

/**
 * Call-site names that `spec/interaction-events.md` reserves for the **Sound** primitives
 * (`set_tempo`/`note`/`play`/`beep`/`rest`).
 */
const SOUND_CALLEE_NAMES = new Set([
  "note",
  "play",
  "beep",
  "rest",
  "set_tempo",
]);

/**
 * Call-site names `spec/interaction-events.md` reserves for the **Interaction & Events**
 * primitives (`input`, `wait`, and the `when`/`every`/`on_key`/`on_click` block-heads).
 */
const INTERACTION_EVENTS_CALLEE_NAMES = new Set([
  "input",
  "wait",
  "when",
  "every",
  "on_key",
  "on_click",
]);

/**
 * Call-site names `spec/turtles-and-sprites.md`'s canonical-forms list reserves for the
 * **Sprites** profile (`new_turtle`, `tell`, `ask`, `each`, `turtles`, `who`).
 */
const SPRITES_CALLEE_NAMES = new Set([
  "new_turtle",
  "tell",
  "ask",
  "each",
  "turtles",
  "who",
]);

/**
 * The **Heritage** profile's closed short-alias list (`spec/conformance.md:105-117`,`:271-272`):
 * `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/`pr` plus the list-reporter alias spellings
 * `bf`/`bl`/`se`, plus `make` (the Heritage assignment spelling, `spec/conformance.md:107`) — it
 * has no dedicated AST node, but it still parses as an ordinary zero-arity `Call` (the parser has
 * no arity entry for it, so the reader that provides its `"x" 1` operands is left for the next
 * statement, producing `ol-bad-token` diagnostics), so its *callee name* is still detectable here.
 * `to`/`output`/`op` are also Heritage spellings but are reserved words with no `Call`/`ParenCall`
 * production at all today, so they cannot be detected this way; the list below is what a real
 * example's parsed callee names can actually contain.
 */
const HERITAGE_CALLEE_NAMES = new Set([
  "fd",
  "bk",
  "lt",
  "rt",
  "pu",
  "pd",
  "st",
  "ht",
  "cs",
  "pr",
  "bf",
  "bl",
  "se",
  "make",
]);

/**
 * Statically detect the set of optional conformance profiles `source` actually uses, per
 * `spec/conformance.md`'s normative feature-to-profile classification. This is independent of
 * which profiles are implemented today (see {@link IMPLEMENTED_PROFILES}) and independent of the
 * manifest's declared profiles — it is a fact about the source text alone, used to catch a
 * manifest entry that under-declares what the example needs (issue #519, finding G8).
 *
 * **Exhaustiveness audit against every optional profile in `spec/conformance.md`'s dependency
 * DAG** (issue #519, third review round — see git history for the two prior rounds that added
 * Data-derived-reporter and Heritage `value of … for key` detection):
 *
 * | Profile | Detected via | Notes |
 * | --- | --- | --- |
 * | Data | `DATA_NODE_KINDS`, index/field segments, `dataPrimitiveArity()` | |
 * | Turtle & Rendering | *(not detected)* | every example needs it; never contradicts a declaration |
 * | Geometry | `geometryPrimitiveArity()` (`grid`/`axes`/`measure`) | implemented profile — a live masking case |
 * |  |  | `polygon`/`star`/`circle`/`arc`/`area`/`perimeter` are Geometry-owned per
 *   `spec/geometry-module.md`, but they are **derived stdlib source procedures** an example
 *   `define`s for itself (see `spec/examples/13-geometry-stdlib.logo`), not parser primitives, so
 *   they have no callee name a shared detector could recognize — same undetectable-by-design
 *   class as `challenge`/`to`/`output`/`op`. This is not a live masking risk: they need no runtime
 *   capability beyond Core+Turtle+Data (`geometry: ["turtle-rendering", "data"]` in
 *   `harness/index.mjs`'s `PROFILE_DEPS`), and the checker only rejects an undeclared `geometry`
 *   claim for the renderer-backed `grid`/`axes`/`measure` overlay primitives above, which *are*
 *   detected. |
 * | Heritage | `HERITAGE_CALLEE_NAMES`, `ValueOfKey` (adds `data` too) | `to`/`output`/`op` excluded, see below |
 * | Sprites | `SPRITES_CALLEE_NAMES` | |
 * | Interaction & Events | `INTERACTION_EVENTS_CALLEE_NAMES` | |
 * | Sound | `SOUND_CALLEE_NAMES` | |
 * | Educational | `educationalPrimitiveArity()` (`explain`/`why`/`hint`/`debug`) | `challenge` excluded, see below |
 * | Modules | *(not detectable today)* | `import`/`export`/`alias` are reserved words
 *   (`packages/parser/src/parser.ts`'s `NON_PRIMARY_NAMES`) with no dedicated AST production or
 *   parse function today — they cannot begin an expression/Call, so an example using them fails
 *   to parse cleanly rather than silently masking a manifest gap. |
 * | Localization | *(not detectable today)* | depends on Modules, which has no parseable form yet
 *   (no locale-pack keyword/production exists in the grammar today either). |
 * | Tutor (AI) | *(not detectable today)* | `challenge` has no registered primitive-arity entry
 *   (`packages/parser/src/educational-meta-commands.test.mjs:64` asserts
 *   `educationalPrimitiveArity("challenge")` is `undefined`) — it parses as an ordinary,
 *   unrecognized `Call`, indistinguishable from a user-defined procedure named `challenge`.
 *   Detecting it by bare callee name would risk false positives on a learner's own procedure, so
 *   it is deliberately NOT hardcoded; this is the same class of honest limitation as
 *   `to`/`output`/`op` below, not an oversight. |
 *
 * `to`/`output`/`op` are Heritage spellings that are reserved words with no `Call`/`ParenCall`
 * production at all today (same `NON_PRIMARY_NAMES` set), so — like Modules/Localization above —
 * they cannot be detected this way either; see {@link HERITAGE_CALLEE_NAMES}'s doc comment.
 *
 * Deliberately conservative otherwise: it flags only constructs the spec ties to one profile in
 * *every* context (list-index/field-selector reads, dict/struct/mutation-form syntax, and each
 * profile's reserved primitive/alias names). It does not attempt record-binder destructuring
 * (`spec/conformance.md`'s Data-vs-Core split for `for [:x :y] in ...` depends on the *runtime*
 * value being destructured — list vs record — which a static AST walk cannot decide; see the
 * spec's "List-binder destructuring classification").
 *
 * Never throws: a source that fails to parse cleanly still returns whatever partial AST
 * `@openlogo/parser`'s `parse()` recovered, and this function only ever reads node `kind`s and
 * callee names off it.
 *
 * **User-defined procedures never masquerade as profile usage** (round-5 rubber-duck review):
 * `define` accepts any `name` token (`packages/parser/src/parser.ts`'s `parseProcedureDef` has no
 * reserved-name check), so a Core-only example is free to `define` its own procedure that happens
 * to share a name with an optional profile's callee (e.g. `define note :duration ... end`). Bare
 * callee-name matching alone would then misattribute that call to Sound/Geometry/Data/etc., and
 * acceptance criterion 3 (a correctly-declared example still passes) would break for a program
 * that needs no optional profile at all. This function therefore precollects every name the
 * source itself `define`s and never treats a call to one of those names as profile-primitive
 * usage — the same "ambiguous with a user procedure ⇒ don't guess" principle already applied to
 * `challenge`, just made structural instead of one-off.
 *
 * **The Data shadow-guard exception depends on AST *position*, not just the name** (round-6 and
 * round-7 rubber-duck reviews — two runtime dispatch paths, two opposite bugs):
 * - Round 6: `@openlogo/runtime`'s **expression** evaluator (`evaluate.ts`) resolves the 8 Data
 *   derived-reporter names (`list`/`dict`/`reverse`/`pick`/`sort`/`keys`/`values`/`type_of`) to
 *   the Data builtin *before* it ever consults `environment.procedures` — so a colliding local
 *   `define` does NOT shadow them in expression position (e.g. `define list ... end` then
 *   `print list 1 2` still prints the builtin's result). Applying the shadow-guard there would
 *   under-detect a real Data dependency, reopening G8.
 * - Round 7: but `@openlogo/runtime`'s **statement**-position dispatch
 *   (`execute-internal.ts`'s `isProcedureCallStatement`) checks `environment.procedures.has(name)`
 *   FIRST, with no builtin exclusion at all — confirmed by direct `execute()` repro: with
 *   `define list :a :b / print :a / end` in scope, the bare statement `list 1 2` emits a
 *   `procedure-enter` for the user's `list` and prints `1`, never touching the Data builtin. So a
 *   colliding local `define` DOES shadow these 8 names in statement position, and unconditionally
 *   attributing `"data"` there — as round 6's fix did — reopens the exact round-5 false-positive
 *   class (a Core-only example whose own procedure happens to be named `list`/`dict`/etc. would be
 *   wrongly failed for omitting Data, violating acceptance criterion 3).
 *
 * The fix tracks which `Call`/`ParenCall` nodes are themselves direct statements (elements of a
 * `Program`/`Block`'s `body`, i.e. every position `execute()`'s `executeStatements` dispatches via
 * `isProcedureCallStatement`) versus nested inside an expression. Only the latter gets the
 * unconditional Data attribution; a statement-position Data-reporter call still goes through the
 * ordinary shadow-guard, exactly like every other profile's callee names.
 *
 * @returns a sorted, de-duplicated array of profile ids, e.g. `["data"]` or `["data", "sound"]`.
 */
export function detectUsedProfiles(source) {
  const { ast } = parse(source);
  const used = new Set();

  const definedProcedureNames = new Set();
  walk(ast, (node) => {
    if (node.kind === "ProcedureDef") {
      definedProcedureNames.add(node.name.name.toLowerCase());
    }
  });

  // Every `Call`/`ParenCall` that is itself a direct element of a `Program`/`Block`'s `body` —
  // i.e. a statement, not an expression nested inside one (an argument, a condition, a `print`
  // operand, ...). `childrenOf`'s `Program`/`Block` case returns `node.body` verbatim
  // (`packages/parser/src/ast.ts`), and every control-flow body (`If`/`While`/`Repeat`/`Forever`/
  // `ForIn`/`ForRange`/`ProcedureDef`) wraps its body in a `BlockNode`, so this single check
  // covers every statement position the runtime's `executeStatements` iterates.
  const statementPositionCalls = new Set();
  walk(ast, (node) => {
    if (node.kind !== "Program" && node.kind !== "Block") {
      return;
    }
    for (const statement of node.body) {
      if (statement.kind === "Call" || statement.kind === "ParenCall") {
        statementPositionCalls.add(statement);
      }
    }
  });

  walk(ast, (node) => {
    if (node.kind === "ValueOfKey") {
      // The Heritage `value of ... for key` dictionary reader (`spec/conformance.md:273`,`:301`):
      // classified as Heritage, but it "also needs Data" because it operates on dicts — an
      // example using it must declare BOTH, or the missing one goes undetected (issue #519
      // masking class: declaring only `data` would silently under-declare `heritage`, and vice
      // versa).
      used.add("heritage");
      used.add("data");
      return;
    }
    if (DATA_NODE_KINDS.has(node.kind)) {
      used.add("data");
      return;
    }
    if (node.kind === "Place" || node.kind === "PostfixExpression") {
      for (const segment of node.segments) {
        if (segment.kind === "index" || segment.kind === "field") {
          used.add("data");
        }
      }
      return;
    }
    if (node.kind !== "Call" && node.kind !== "ParenCall") {
      return;
    }
    const name = node.callee.name.toLowerCase();
    if (dataPrimitiveArity(name) !== undefined) {
      // The Data profile's derived list/dict/record reporters (`dict`, `list`, `reverse`,
      // `pick`, `sort`, `keys`, `values`, `type_of`) are call-site names, not distinct AST node
      // kinds — detected via the parser's own name table so this stays in lockstep with it
      // (issue #519 rubber-duck review: a hand-maintained second list would drift and reopen the
      // exact masking gap this fix closes).
      //
      // A colliding local `define` shadows one of these 8 names ONLY in statement position, not
      // expression position (round-6 vs. round-7 rubber-duck reviews; see this function's own
      // doc comment for the full runtime-dispatch evidence from `evaluate.ts` and
      // `execute-internal.ts`). So: in expression position, always attribute `"data"`
      // unconditionally (a local `define` can never suppress it, or a real Data dependency goes
      // undetected); in statement position, fall through to the ordinary
      // `definedProcedureNames` shadow-guard below, exactly like every other profile's callee
      // names (or a Core-only example whose own procedure happens to be named e.g. `list` would
      // be wrongly failed for omitting Data).
      if (
        !statementPositionCalls.has(node) ||
        !definedProcedureNames.has(name)
      ) {
        used.add("data");
      }
      return;
    }
    if (definedProcedureNames.has(name)) {
      // A locally `define`d procedure of this name shadows every OTHER optional-profile callee it
      // happens to collide with: `@openlogo/runtime`'s statement dispatch
      // (`execute-internal.ts`'s `isProcedureCallStatement`) checks `environment.procedures` with
      // no builtin exclusion, and none of Geometry/Educational/Sound/Interaction & Events/
      // Sprites/Heritage's names appear in `evaluate.ts`'s expression dispatch chain either — so a
      // user procedure of one of those names always wins, at both statement and expression
      // position. Treat the call as ordinary Core user code, not as evidence of profile usage.
      return;
    }
    if (geometryPrimitiveArity(name) !== undefined) {
      // The Geometry profile's renderer-backed overlay primitives `grid`/`axes`/`measure`
      // (`packages/parser/src/signatures.ts`'s `GEOMETRY_PRIMITIVE_ARITY`) — Geometry IS
      // implemented (see {@link IMPLEMENTED_PROFILES}), so an example using one of these while
      // under-declaring `geometry` is a live, catchable masking case, not a hypothetical.
      used.add("geometry");
    } else if (educationalPrimitiveArity(name) !== undefined) {
      // The Educational profile's baseline meta-commands `explain`/`why`/`hint`/`debug`
      // (`packages/parser/src/signatures.ts`'s `EDUCATIONAL_PRIMITIVE_ARITY`).
      used.add("educational");
    } else if (SOUND_CALLEE_NAMES.has(name)) {
      used.add("sound");
    } else if (INTERACTION_EVENTS_CALLEE_NAMES.has(name)) {
      used.add("interaction-events");
    } else if (SPRITES_CALLEE_NAMES.has(name)) {
      used.add("sprites");
    } else if (HERITAGE_CALLEE_NAMES.has(name)) {
      used.add("heritage");
    }
  });

  return [...used].sort();
}

/** Load the filename -> required-profile-id[] manifest from `manifestPath`. */
export function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

/** True when every profile in `requiredProfiles` is already implemented. */
export function isRunnable(requiredProfiles, implementedProfiles) {
  return requiredProfiles.every((profile) =>
    implementedProfiles.includes(profile),
  );
}

/**
 * Parse+execute `source` (document label `name`) via `@openlogo/runtime`'s `execute()` and
 * classify the result. `execute()` is not expected to throw for a well-formed program, but a gate
 * must never itself crash on an unexpected internal error — an unexpected throw is reported as a
 * failure rather than propagated.
 *
 * @returns `{ status: "pass" }`, or `{ status: "fail", reason }` when execution produced one or
 *   more error-severity diagnostics (joined into `reason`) or threw.
 */
export function classifyExample(source, name) {
  let result;
  try {
    result = execute(source, name);
  } catch (err) {
    return { status: "fail", reason: `threw: ${err.message}` };
  }
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length === 0) {
    return { status: "pass" };
  }
  return {
    status: "fail",
    reason: errors.map((d) => `${d.code}: ${d.message}`).join("; "),
  };
}

/**
 * Run the full examples gate over every `.logo` file in `dir`, using `manifest` (default: read
 * from `manifestPath`) to determine each file's required profiles. Never calls `process.exit` —
 * the CLI shell (`check-examples.mjs`) does that from the returned `ok` flag.
 *
 * For every example with a manifest entry, this also runs the profile under-declaration check
 * (issue #519, finding G8, see {@link detectUsedProfiles}) BEFORE deciding whether to run or skip
 * it: an example whose source uses a construct outside its declared profiles' dependency closure
 * FAILS loudly, naming the example and the missing profile(s), regardless of whether the example
 * would otherwise have run, passed, or been skipped for an unrelated not-yet-implemented profile.
 *
 * @returns `{ ok, ran, skipped, failed, lines }` — `lines` is the printable report (one
 *   `PASS`/`FAIL`/`SKIP` line per example plus a trailing summary line); `ok` is `false` when any
 *   example failed or the manifest/directory itself is invalid.
 */
export function runExamplesGate({
  dir = EXAMPLES_DIR,
  manifestPath = MANIFEST_PATH,
  manifest,
  implementedProfiles = IMPLEMENTED_PROFILES,
} = {}) {
  const lines = [];

  if (!existsSync(dir)) {
    lines.push(`examples: directory ${dir} does not exist`);
    return { ok: false, ran: 0, skipped: 0, failed: 0, lines };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".logo"))
    .sort();

  if (files.length === 0) {
    lines.push(`examples: no .logo files found in ${dir}`);
    return { ok: false, ran: 0, skipped: 0, failed: 0, lines };
  }

  const resolvedManifest = manifest ?? loadManifest(manifestPath);

  let ran = 0;
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
    const outcome = classifyExample(source, file);
    if (outcome.status === "pass") {
      lines.push(`PASS ${file}`);
    } else {
      failed += 1;
      lines.push(`FAIL ${file}: ${outcome.reason}`);
    }
  }

  lines.push(
    `examples: ran ${ran}, skipped ${skipped}, failed ${failed} (of ${files.length} total)`,
  );

  return { ok: failed === 0, ran, skipped, failed, lines };
}

/** Parse CLI arguments: `--dir=<path>` and `--manifest=<path>` override the defaults (used by the
 * subprocess regression test to point the CLI at isolated temp fixtures instead of the real
 * `spec/examples/` corpus). */
export function parseArgs(argv) {
  let dir;
  let manifestPath;
  for (const arg of argv) {
    if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (arg.startsWith("--manifest=")) {
      manifestPath = arg.slice("--manifest=".length);
    }
  }
  return { dir, manifestPath };
}

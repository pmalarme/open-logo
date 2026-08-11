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
 * statically scans the parsed AST (plus the parser's own diagnostics, for the handful of reserved
 * words with no AST production at all) for the constructs `spec/conformance.md` classifies as
 * normatively belonging to an optional profile (list-index/dict/struct/mutation-form usage and
 * the Data-profile derived reporters `dict`/`list`/`reverse`/`pick`/`sort`/`keys`/`values`/
 * `type_of` — detected via `@openlogo/parser`'s own `dataPrimitiveArity()` name table, not a
 * second hand-maintained list — for Data; `grid`/`axes`/`measure` via `geometryPrimitiveArity()`
 * plus the derived stdlib procedures `polygon`/`star`/`circle`/`arc`/`area`/`perimeter` (the
 * latter two also needing Data) for Geometry; `explain`/`why`/`hint`/`debug` via
 * `educationalPrimitiveArity()` for Educational; `note`/`beep`/`play`/`rest`/`set_tempo` for
 * Sound; `input`/`when`/`every`/`on_key`/`on_click`/`wait` for Interaction & Events;
 * `new_turtle`/`tell`/`ask`/`each`/`turtles`/`who` for Sprites; the closed Heritage short-alias
 * list plus `make` plus `value of … for key` (which also needs Data) for Heritage; `challenge` for
 * Tutor (AI); and the reserved words `to`/`output`/`op` (Heritage), `import`/`export` (Modules),
 * and `alias` (Localization) via the parser's own `ol-bad-token` diagnostics, since those six have
 * no `Call`/`ParenCall` production at all — see {@link detectUsedProfiles}'s own doc comment for
 * the full per-profile audit and the one remaining, genuinely-undetectable case (locale-pack
 * syntax beyond `alias` itself, none of which exists in the grammar today), and
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
 * planned. Update this list only alongside a saga that lands a new profile's conformance
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
 * Call-site name `spec/conformance.md:279-280` reserves for the **Tutor (AI)** profile's
 * Socratic-challenge entry point. Not in a parser arity table (same as `SOUND_CALLEE_NAMES`/
 * `SPRITES_CALLEE_NAMES`/`INTERACTION_EVENTS_CALLEE_NAMES` above — none of those are
 * arity-registered either), so it is a bare-name hand-list identical in kind to those three. The
 * `definedProcedureNames` shadow-guard (checked before any of these hand-lists are consulted)
 * already neutralizes the "collides with a user's own `define challenge ... end`" risk for all
 * four, so there is no principled reason to hardcode Sound/Sprites/Interaction & Events this way
 * but leave Tutor (AI) undetected — doing so left a live G8 masking hole (issue #519, fourth
 * review round): an example calling `challenge` while declaring only an unrelated unimplemented
 * profile (omitting `tutor-ai`) reached SKIP undetected.
 */
const TUTOR_AI_CALLEE_NAMES = new Set(["challenge"]);

/**
 * The **Heritage** profile's closed short-alias list (`spec/conformance.md:105-117`,`:271-272`):
 * `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/`pr` plus the list-reporter alias spellings
 * `bf`/`bl`/`se` — each an ordinary zero-arity `Call` whose *callee name* is detectable here.
 * The Heritage assignment spelling `make "name" value` is NOT in this set: since issue #151 it
 * parses as an `Assign` node (`form: "make"`), not a `Call`, so it is detected from that node
 * form directly in {@link detectUsedProfiles}'s walk. `to`/`output`/`op` are also Heritage
 * spellings but are reserved words with no `Call`/`ParenCall` production at all today, so a
 * bare-name check like this one can never see them — they are detected separately, via
 * {@link RESERVED_WORD_PROFILES}, from the parser's own parse-time diagnostics rather than from
 * the AST.
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
]);

/**
 * The Geometry profile's derived standard-library procedures (`spec/geometry-module.md`,
 * `spec/conformance.md:261`): `polygon`, `star`, `circle`, `arc`, `area`, `perimeter`. Unlike
 * `grid`/`axes`/`measure` (renderer-backed overlay primitives with a `geometryPrimitiveArity()`
 * table entry), these are **discoverable OpenLogo source** an example is expected to `define`
 * for itself (`spec/examples/13-geometry-stdlib.logo`), never a parser primitive — but a call
 * site invoking one of them is still an ordinary, recognizable `Call`/`ParenCall` node, exactly
 * like `SOUND_CALLEE_NAMES`/`SPRITES_CALLEE_NAMES`/etc. above. The `definedProcedureNames`
 * shadow-guard (checked before this set) already covers the "this example defines these itself"
 * case correctly, so leaving them out of a shared detector was an unprincipled gap, not a genuine
 * undetectability (fifth review round, issue #519): an example calling `polygon` without
 * defining it, while declaring only an unrelated unimplemented profile, reached SKIP with the
 * missing `geometry` declaration never surfaced.
 *
 * `area` and `perimeter` specifically also add `data`: `spec/conformance.md:261` states their
 * canonical stdlib implementation "read[s] a shape spec by list index, so they also need Data" —
 * the same "this construct's own semantics always need a second profile" reasoning already
 * applied to `ValueOfKey` above, scoped to just the two names the spec calls out.
 */
const GEOMETRY_STDLIB_CALLEE_NAMES = new Set([
  "polygon",
  "star",
  "circle",
  "arc",
  "area",
  "perimeter",
]);

/** Of {@link GEOMETRY_STDLIB_CALLEE_NAMES}, the two whose canonical implementation also needs Data. */
const GEOMETRY_STDLIB_ALSO_DATA_NAMES = new Set(["area", "perimeter"]);

/**
 * Reserved words (`packages/parser/src/parser.ts`'s `NON_PRIMARY_NAMES`) that have no
 * `Call`/`ParenCall` — or any other — AST production at all today, so no AST walk can ever see
 * them: the Heritage `to`/`output`/`op` procedure-definition/return spellings
 * (`spec/conformance.md:257`,`:270`), and the Modules/Localization `import`/`export`/`alias`
 * module-and-keyword-pack-aliasing forms (`spec/conformance.md:177-186`,`:277-278`;
 * `spec/localization.md:18-21`'s `alias new_name existing_name`). `struct` is deliberately
 * excluded from this map: unlike the six words above, it DOES have a dedicated production
 * (`parser.ts`'s `parseStructDef`, reached via its own statement-level dispatch), so it already
 * surfaces as a `StructDef` node in {@link DATA_NODE_KINDS} and needs no diagnostic-based
 * fallback.
 *
 * Every occurrence of `import`/`export`/`alias` produces a parser diagnostic today (none of the
 * three has any legitimate grammar role, so there is no "clean" use to miss). `to` is the one
 * exception, with THREE legitimate roles that all consume it with **zero** diagnostics when used
 * correctly — the `for … from … to` range bound, the `set … to` assignment preposition, and the
 * Data profile's `add … to …` list-mutation preposition (`spec/grammar.md:104`,`:113`,`:128`;
 * confirmed directly: `parse("for i from 1 to 5 [ ]")`, `parse("set x to 5")`, and
 * `parse("add 3 to colors")` all return `diagnostics: []`) — so a diagnostic naming `to` only ever
 * fires when it appears outside those three roles, i.e. genuinely as the Heritage procedure-opener
 * (or beside an already-unrelated parse error, which is not a live masking risk: such a source
 * would already fail `classifyExample`'s diagnostics check whenever it is actually run, and
 * over-attributing `heritage` to an already-broken file is the opposite of under-declaration).
 */
const RESERVED_WORD_PROFILES = new Map([
  ["to", "heritage"],
  ["output", "heritage"],
  ["op", "heritage"],
  ["import", "modules"],
  ["export", "modules"],
  ["alias", "localization"],
]);

/**
 * Statically detect the set of optional conformance profiles `source` actually uses, per
 * `spec/conformance.md`'s normative feature-to-profile classification. This is independent of
 * which profiles are implemented today (see {@link IMPLEMENTED_PROFILES}) and independent of the
 * manifest's declared profiles — it is a fact about the source text alone, used to catch a
 * manifest entry that under-declares what the example needs (issue #519, finding G8).
 *
 * **Exhaustiveness audit against every optional profile in `spec/conformance.md`'s dependency
 * DAG** (issue #519, fifth review round — see git history for the earlier rounds that added
 * Data-derived-reporter, Heritage `value of … for key`, Geometry/Educational/Tutor-AI table-driven
 * detection, and the reserved-word/Geometry-stdlib rounds below):
 *
 * | Profile | Detected via | Notes |
 * | --- | --- | --- |
 * | Data | `DATA_NODE_KINDS`, index/field segments, `dataPrimitiveArity()` | |
 * | Turtle & Rendering | *(not detected)* | every example needs it; never contradicts a declaration |
 * | Geometry | `geometryPrimitiveArity()` (`grid`/`axes`/`measure`) plus `GEOMETRY_STDLIB_CALLEE_NAMES`
 *   (`polygon`/`star`/`circle`/`arc`/`area`/`perimeter`, the latter two also adding `data` per
 *   `spec/conformance.md:261`) | implemented profile — a live masking case |
 * | Heritage | `HERITAGE_CALLEE_NAMES`, `ValueOfKey` (adds `data` too), `RESERVED_WORD_PROFILES`
 *   (`to`/`output`/`op`, via diagnostics) | |
 * | Sprites | `SPRITES_CALLEE_NAMES` | |
 * | Interaction & Events | `INTERACTION_EVENTS_CALLEE_NAMES` | |
 * | Sound | `SOUND_CALLEE_NAMES` | |
 * | Educational | `educationalPrimitiveArity()` (`explain`/`why`/`hint`/`debug`) | |
 * | Modules | `RESERVED_WORD_PROFILES` (`import`/`export`, via diagnostics) | |
 * | Localization | `RESERVED_WORD_PROFILES` (`alias`, via diagnostics) | depends on Modules,
 *   expanded by `closureOf` on the declared side |
 * | Tutor (AI) | `TUTOR_AI_CALLEE_NAMES` (`challenge`, `spec/conformance.md:279-280`) | |
 *
 * `to`/`output`/`op` (Heritage) and `import`/`export`/`alias` (Modules/Localization) have no
 * `Call`/`ParenCall` — or any other — AST production at all today (`packages/parser/src/parser.ts`'s
 * `NON_PRIMARY_NAMES`), so the AST walk below can never see them directly; {@link
 * RESERVED_WORD_PROFILES} detects them instead from the parser's own `ol-bad-token` diagnostics,
 * which always carry the offending token text even though no AST node results — see that map's own
 * doc comment for why this is safe (in particular, why `to`'s three legitimate non-Heritage roles
 * never produce a false positive).
 *
 * **After this round, every optional profile in the DAG is detected by at least one signal** —
 * either an AST construct/callee name, or (for the six reserved words with no production at all) a
 * parser diagnostic. There is no remaining profile-classified construct this function cannot see;
 * the only thing it deliberately does NOT attempt is record-binder destructuring (see below), which
 * is a Data-vs-Core split decided by a *runtime* value, not a static one.
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
 * callee-name matching alone would then misattribute that call to Sound/Geometry/Data/Tutor
 * (AI)/etc., and acceptance criterion 3 (a correctly-declared example still passes) would break
 * for a program that needs no optional profile at all. This function therefore precollects every
 * name the source itself `define`s and never treats a call to one of those names as
 * profile-primitive usage — a structural guard, not a one-off exclusion, so it covers every
 * bare-name hand-list (including `TUTOR_AI_CALLEE_NAMES`) uniformly.
 *
 * **The shadow-guard also precollects `struct` names, not just `define`d ones** (round-12
 * rubber-duck review — the opposite-direction bug from masking: a spurious FAIL on a *correct*
 * example): a `struct` declaration registers a same-named **constructor reporter**
 * (`packages/parser/src/ast.ts`'s `StructDefNode` doc comment), so `struct area [ value ]` then
 * `print area 5` is ordinary, valid Data-profile code whose `area` call resolves to the user's own
 * constructor — exactly like a colliding `define`. Enumerating every `"...Def"`-kind node in
 * `ast.ts`'s `OL_NODE_KINDS` shows exactly two register a same-named callable, `ProcedureDef` and
 * `StructDef` (no other declaration node introduces one), so precollecting both kinds makes this
 * guard provably exhaustive — there is no third declaration-with-callable-name construct left to
 * find.
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
 * The fix tracks which `Call`/`ParenCall` nodes are themselves direct statements — elements of
 * `Program.body`, or of the `BlockNode` a genuine control-flow construct (`If`'s `thenBody`/
 * `elseBody`, `While`/`Repeat`/`Forever`/`ForIn`/`ForRange`/`ProcedureDef`'s `body`) dispatches
 * through `executeStatements` — versus nested inside an expression. Deliberately enumerated by
 * parent node kind rather than "any `Block`-shaped node" (round-8 rubber-duck review): a
 * `Comprehension`'s `body` field is ALSO typed `BlockNode` (`packages/parser/src/ast.ts:381-386`)
 * but is evaluated as a bracketed *expression* per iteration
 * (`packages/runtime/src/evaluate.ts`'s comprehension evaluator), never through
 * `executeStatements` — confirmed by direct `execute()` repro: with the round-7 `define list`
 * shadow in scope, `print map x in [1 2] [ list :x :x ]` prints the Data builtin's
 * `[[1, 1], [2, 2]]`, with no `procedure-enter` for the user's `list`. A generic "every `Block`'s
 * body is a statement" rule would have wrongly classified that call as statement position and
 * shadow-guarded it, silently under-detecting a real Data dependency again. Only the latter
 * (expression position, including `Comprehension` bodies) gets the unconditional Data
 * attribution; a statement-position Data-reporter call still goes through the ordinary
 * shadow-guard, exactly like every other profile's callee names.
 *
 * @returns a sorted, de-duplicated array of profile ids, e.g. `["data"]` or `["data", "sound"]`.
 */
export function detectUsedProfiles(source) {
  const { ast, diagnostics } = parse(source);
  const used = new Set();

  // Reserved words with no AST production at all (`to`/`output`/`op`/`import`/`export`/`alias`,
  // see {@link RESERVED_WORD_PROFILES}) can never be found by the AST walk below, so they are
  // detected from the parser's own diagnostics instead: `packages/parser/src/errors.ts`'s
  // `badToken` (and its `missingTerminator` cascade sibling, both `ol-bad-token`) always carries
  // the exact offending token text in `params.text`. Matched on the diagnostic `code` plus an
  // exact, case-insensitive `params.text` value — never on `message` prose, which is not part of
  // a diagnostic's stable identity (`spec/localization.md:221`).
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== "ol-bad-token") {
      continue;
    }
    const text = diagnostic.params?.text;
    if (typeof text !== "string") {
      continue;
    }
    const profile = RESERVED_WORD_PROFILES.get(text.toLowerCase());
    if (profile !== undefined) {
      used.add(profile);
    }
  }

  // A `struct` declaration registers a same-named CONSTRUCTOR REPORTER, not just a type
  // (`packages/parser/src/ast.ts`'s `StructDefNode` doc comment: "declares a record type ... and
  // a same-named constructor reporter"; `spec/data-structures.md`) — so `struct area [ value ]`
  // makes a bare call to `area` resolve to the user's own constructor, exactly as
  // `define area ... end` would. Enumerating every `"...Def"`/`"...Declaration"` kind in
  // `ast.ts`'s `OL_NODE_KINDS`, exactly two register a same-named callable: `ProcedureDef` and
  // `StructDef` (no other declaration node — `DictLit`, `Add`/`Remove`/etc. — introduces a name).
  // Collecting only `ProcedureDef` here left that second one unguarded (round-12 rubber-duck
  // review): a *correct* Data-only example naming its own struct `area`/`polygon`/`note`/
  // `challenge` was spuriously flagged as needing Geometry/Sound/Tutor-AI, the false-positive
  // mirror image of the masking bug this whole detector exists to close. Collecting both kinds
  // makes the shadow-guard provably exhaustive.
  const definedProcedureNames = new Set();
  walk(ast, (node) => {
    if (node.kind === "ProcedureDef" || node.kind === "StructDef") {
      definedProcedureNames.add(node.name.name.toLowerCase());
    }
  });

  // Every `Call`/`ParenCall` that is itself a direct statement — a member of `Program.body`, or
  // of the `BlockNode` that a genuine control-flow construct runs through `executeStatements`.
  // Enumerated by exact parent node kind (not "any node whose shape happens to hold a
  // `BlockNode`") specifically so `Comprehension.body` — a `BlockNode`-typed field that is really
  // an expression, evaluated once per iteration, never dispatched via `executeStatements` — is
  // excluded; see this function's doc comment for the round-8 evidence.
  const statementPositionCalls = new Set();
  const collectStatementBody = (block) => {
    for (const statement of block.body) {
      if (statement.kind === "Call" || statement.kind === "ParenCall") {
        statementPositionCalls.add(statement);
      }
    }
  };
  walk(ast, (node) => {
    switch (node.kind) {
      case "Program":
        collectStatementBody(node);
        return;
      case "If":
        collectStatementBody(node.thenBody);
        if (node.elseBody !== undefined) {
          collectStatementBody(node.elseBody);
        }
        return;
      case "While":
      case "Repeat":
      case "Forever":
      case "ForIn":
      case "ForRange":
      case "ProcedureDef":
        collectStatementBody(node.body);
        return;
      default:
        return;
    }
  });

  walk(ast, (node) => {
    if (node.kind === "ProfileStatement") {
      // Profile block-head / mode-switch statements (`tell`/`ask`/`each`, `when`/`every`/`on_key`/
      // `on_click`) parse into a `ProfileStatement` node since issue #664 (slice C2) — NOT a `Call`
      // — so they are detected here by their head keyword, not by a callee name in the
      // `SPRITES_CALLEE_NAMES`/`INTERACTION_EVENTS_CALLEE_NAMES` sets. The reader only ever builds
      // this node when the head is NOT a user-declared callable (`parser.ts`'s `parseStatement`
      // guard: a `define ask … end` shadow parses as an ordinary Core call), so the
      // `definedProcedureNames` shadow-guard the callee-name branches use is unnecessary here — a
      // `ProfileStatement` head is by construction a genuine profile use.
      const keyword = node.keyword.name.toLowerCase();
      if (SPRITES_CALLEE_NAMES.has(keyword)) {
        used.add("sprites");
      } else if (INTERACTION_EVENTS_CALLEE_NAMES.has(keyword)) {
        used.add("interaction-events");
      }
      return;
    }
    if (node.kind === "Assign" && node.form === "make") {
      // The Heritage assignment spelling `make "name" value` (`spec/grammar.md:105`,
      // `spec/conformance.md:107`,`:270`). Since issue #151 it parses as an `Assign` node whose
      // `form` records the surface spelling — NOT a `Call` — so it is detected here by that form,
      // not by a callee name in `HERITAGE_CALLEE_NAMES`. It is an alternate spelling with no new
      // semantics, so no other profile is implied.
      used.add("heritage");
      return;
    }
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
    } else if (GEOMETRY_STDLIB_CALLEE_NAMES.has(name)) {
      // The Geometry profile's derived stdlib procedures `polygon`/`star`/`circle`/`arc`/`area`/
      // `perimeter` (`spec/geometry-module.md`, `spec/conformance.md:261`) — an ordinary,
      // recognizable call site an example either `define`s for itself (already excluded above by
      // the `definedProcedureNames` shadow-guard) or calls while relying on the profile's
      // stdlib semantics (fifth review round, issue #519).
      used.add("geometry");
      if (GEOMETRY_STDLIB_ALSO_DATA_NAMES.has(name)) {
        used.add("data");
      }
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
    } else if (TUTOR_AI_CALLEE_NAMES.has(name)) {
      used.add("tutor-ai");
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

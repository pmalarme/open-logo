/**
 * Static optional-conformance-profile detection for OpenLogo source, shared by every gate that
 * needs to answer "which optional profiles does this program actually use?" — independently of what
 * any manifest or fixture *declares*.
 *
 * Two gates consume it:
 *
 *   - `scripts/examples-gate.mjs` (+ `scripts/markdown-examples-gate.mjs`) — the examples gate's
 *     under-declaration check (issue #519, finding G8): a `spec/examples/*.logo` manifest entry that
 *     omits a profile the source needs FAILS loudly instead of being silently skipped.
 *   - `scripts/harness/index.mjs` — the conformance harness's declared-profile gate (issue #790):
 *     an `"execute": true` fixture's `profiles` array used to *select* the fixture without ever
 *     *gating* it, so a fixture using Sprites forms passed with `"sprites"` deleted.
 *
 * It lives in its own module rather than inside either gate because `scripts/examples-gate.mjs`
 * already imports `closureOf` from `scripts/harness/index.mjs`; putting the detector in the examples
 * gate and importing it from the harness would close an import cycle between the two.
 *
 * **Every detection rule is reachability-tested** (issue #701). The rules below key on AST *shape*
 * (node kinds, `form`/`keyword` discriminants) and on callee *names*, so a rule can silently stop
 * matching when the AST changes underneath it — which already happened once, in issue #151, when
 * Heritage `make` began parsing as `Assign{form:"make"}` instead of a `Call`. A rule that matches
 * nothing is indistinguishable from a profile that is not used, and nothing turns red. Every table
 * here is therefore **exported**, and `scripts/profile-detection.test.mjs` walks the live tables to
 * assert that each entry still attributes its profile and that no entry lacks a probe — so a rule
 * that stops matching, or a table entry added without one, is a test failure rather than a no-op.
 */

import {
  dataPrimitiveArity,
  educationalPrimitiveArity,
  geometryPrimitiveArity,
  parse,
  walk,
} from "@openlogo/parser";

/**
 * AST node kinds that `spec/conformance.md`'s feature table classifies as unconditionally
 * **Data**-profile behavior, regardless of what implementation-status other profiles the source
 * also declares: dictionary literals (`{ key: value }`), `struct` type declarations, and the
 * `add`/`remove`/`clear`/`insert` collection-mutation forms.
 *
 * `ValueOfKey` (the Heritage `value of … for key` dictionary reader) is deliberately NOT in this
 * set: `spec/conformance.md:277` classifies that spelling as **Heritage**, which *also*
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
export const DATA_NODE_KINDS = new Set([
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
export const SOUND_CALLEE_NAMES = new Set([
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
export const INTERACTION_EVENTS_CALLEE_NAMES = new Set([
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
export const SPRITES_CALLEE_NAMES = new Set([
  "new_turtle",
  "tell",
  "ask",
  "each",
  "turtles",
  "who",
]);

/**
 * Call-site name `spec/conformance.md:284` reserves for the **Tutor (AI)** profile's
 * Socratic-challenge entry point. Kept as a bare-name hand-list identical in kind to
 * `SOUND_CALLEE_NAMES`/`SPRITES_CALLEE_NAMES`/`INTERACTION_EVENTS_CALLEE_NAMES` above. The
 * `definedProcedureNames` shadow-guard (checked before any of these hand-lists are consulted)
 * already neutralizes the "collides with a user's own `define challenge ... end`" risk for all
 * four, so there is no principled reason to hardcode Sound/Sprites/Interaction & Events this way
 * but leave Tutor (AI) undetected — doing so left a live G8 masking hole (issue #519, fourth
 * review round): a source calling `challenge` while declaring only an unrelated unimplemented
 * profile (omitting `tutor-ai`) reached SKIP undetected.
 *
 * An earlier revision of this comment justified the hand-list by saying `challenge` is "not in a
 * parser arity table". That stopped being true in issue #838, which gave Tutor a registry
 * (`tutorPrimitiveArity`) so the checker could reject `define challenge`. The hand-list is left in
 * place because *this* detector detects CALL-SITE names for profile gating, which is a different
 * question from arity, and every sibling profile above is listed the same way — folding all four
 * into registry lookups is a worthwhile tidy-up but is not #838's, and doing it here would change
 * four profiles' behavior to fix a stale sentence.
 */
export const TUTOR_AI_CALLEE_NAMES = new Set(["challenge"]);

/**
 * The **Heritage** profile's closed short-alias list (`spec/conformance.md:148-160`,`:275-276`):
 * `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/`pr` plus the list-reporter alias spellings
 * `bf`/`bl`/`se` — each an ordinary zero-arity `Call` whose *callee name* is detectable here.
 * The Heritage assignment spelling `make "name" value` is NOT in this set: since issue #151 it
 * parses as an `Assign` node (`form: "make"`), not a `Call`, so it is detected from that node
 * form directly in {@link detectUsedProfiles}'s walk. `to`/`output`/`op` are also Heritage
 * spellings not in this set: as of issue #667 they parse into `ProcedureDef`/`Return` nodes
 * (discriminated by `keyword`), so they too are detected from their AST nodes in that walk, not by
 * a bare callee-name check here.
 */
export const HERITAGE_CALLEE_NAMES = new Set([
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
 * `spec/conformance.md:265`): `polygon`, `star`, `circle`, `arc`, `area`, `perimeter`. Unlike
 * `grid`/`axes`/`measure` (renderer-backed overlay primitives with a `geometryPrimitiveArity()`
 * table entry), these are **discoverable OpenLogo source** a program is expected to `define`
 * for itself (`spec/examples/13-geometry-stdlib.logo`), never a parser primitive — but a call
 * site invoking one of them is still an ordinary, recognizable `Call`/`ParenCall` node, exactly
 * like `SOUND_CALLEE_NAMES`/`SPRITES_CALLEE_NAMES`/etc. above. The `definedProcedureNames`
 * shadow-guard (checked before this set) already covers the "this source defines these itself"
 * case correctly, so leaving them out of a shared detector was an unprincipled gap, not a genuine
 * undetectability (fifth review round, issue #519): a source calling `polygon` without
 * defining it, while declaring only an unrelated unimplemented profile, reached SKIP with the
 * missing `geometry` declaration never surfaced.
 *
 * `area` and `perimeter` specifically also add `data`: `spec/conformance.md:265` states their
 * canonical stdlib implementation "read[s] a shape spec by list index, so they also need Data" —
 * the same "this construct's own semantics always need a second profile" reasoning already
 * applied to `ValueOfKey` above, scoped to just the two names the spec calls out.
 */
export const GEOMETRY_STDLIB_CALLEE_NAMES = new Set([
  "polygon",
  "star",
  "circle",
  "arc",
  "area",
  "perimeter",
]);

/** Of {@link GEOMETRY_STDLIB_CALLEE_NAMES}, the two whose canonical implementation also needs Data. */
export const GEOMETRY_STDLIB_ALSO_DATA_NAMES = new Set(["area", "perimeter"]);

/**
 * Reserved words that have no `Call`/`ParenCall` — or any other — AST production at all today, so no
 * AST walk can ever see them: the Modules/Localization `import`/`export`/`alias`
 * module-and-keyword-pack-aliasing forms (`spec/conformance.md:181-190`,`:281-282`;
 * `spec/localization.md:18-21`'s `alias new_name existing_name`). `struct` is deliberately excluded
 * from this map: unlike these three, it DOES have a dedicated production (`parser.ts`'s
 * `parseStructDef`, reached via its own statement-level dispatch), so it already surfaces as a
 * `StructDef` node in {@link DATA_NODE_KINDS} and needs no diagnostic-based fallback.
 *
 * The Heritage `to`/`output`/`op` procedure/return spellings USED to live here too — detected from
 * their `ol-bad-token` diagnostics because they had no production — but as of issue #667 (slice H2)
 * they parse into real `ProcedureDef`/`Return` nodes (discriminated by `keyword`) and no longer
 * produce that diagnostic, so their detection moved to the AST walk below (see #701: this detector
 * keys on AST shape, so a form gaining a production must move off its vanished diagnostic). Only the
 * three genuinely production-less module/localization words remain diagnostic-detected.
 *
 * Every occurrence of `import`/`export`/`alias` produces a parser diagnostic today (none of the
 * three has any legitimate grammar role, so there is no "clean" use to miss).
 */
export const RESERVED_WORD_PROFILES = new Map([
  ["import", "modules"],
  ["export", "modules"],
  ["alias", "localization"],
]);

/**
 * Every enumerable detection table, paired with the id prefix its probes carry. Exported so
 * `scripts/profile-detection.test.mjs` walks the **live** tables rather than a second hand-copied
 * list of its own — a copy would drift from these, which is precisely the failure mode issue #701
 * is about, one level up. Adding a table here is what makes its entries require probes.
 */
export const PROFILE_DETECTION_TABLES = Object.freeze([
  ["SOUND_CALLEE_NAMES", SOUND_CALLEE_NAMES],
  ["INTERACTION_EVENTS_CALLEE_NAMES", INTERACTION_EVENTS_CALLEE_NAMES],
  ["SPRITES_CALLEE_NAMES", SPRITES_CALLEE_NAMES],
  ["TUTOR_AI_CALLEE_NAMES", TUTOR_AI_CALLEE_NAMES],
  ["HERITAGE_CALLEE_NAMES", HERITAGE_CALLEE_NAMES],
  ["GEOMETRY_STDLIB_CALLEE_NAMES", GEOMETRY_STDLIB_CALLEE_NAMES],
  ["GEOMETRY_STDLIB_ALSO_DATA_NAMES", GEOMETRY_STDLIB_ALSO_DATA_NAMES],
  ["DATA_NODE_KINDS", DATA_NODE_KINDS],
  ["RESERVED_WORD_PROFILES", new Set(RESERVED_WORD_PROFILES.keys())],
]);

/**
 * The detection rules that key on an AST node's **shape** rather than on a name in one of the
 * tables above — each named here so `scripts/profile-detection.test.mjs` can require a probe for it
 * exactly as it does for every table entry (issue #701). These are the rules with no enumerable
 * table to walk, and historically the fragile ones: every id below detects a form that *gained* its
 * current AST production in a specific slice (`Assign{form:"make"}` in #151;
 * `ProcedureDef{keyword:"to"}` and `Return{keyword:"output"|"op"}` in #667), which is precisely the
 * change that silently breaks a shape-keyed rule.
 *
 * **This list is hand-maintained, and that is a real residual** (review round 1): a NEW shape rule
 * added to {@link detectUsedProfiles} without a matching id here would carry no probe and nothing
 * would notice. The tables above are exhaustive by construction; these are not, so the honest claim
 * is "every *registered* rule is probed", not "every rule is". A shape rule has no enumerable
 * membership to derive from — the only mechanical alternative would be parsing this module's own
 * source, which trades a rule you can forget for a fixture that breaks on any refactor. Adding a
 * shape rule therefore means adding its id here, in the same way adding a primitive is deliberately
 * a two-file change (ADR-0021).
 */
export const AST_SHAPE_RULE_IDS = Object.freeze([
  "Assign.form=make",
  "ProcedureDef.keyword=to",
  "Return.keyword=output",
  "Return.keyword=op",
  "ValueOfKey",
  "Place.segment=index",
  "Place.segment=field",
  "ProfileStatement.sprites",
  "ProfileStatement.interaction-events",
  "dataPrimitiveArity",
  "geometryPrimitiveArity",
  "educationalPrimitiveArity",
]);

/**
 * Statically detect the set of optional conformance profiles `source` actually uses, per
 * `spec/conformance.md`'s normative feature-to-profile classification. This is independent of
 * which profiles are implemented today and independent of any declared profile set — it is a fact
 * about the source text alone, used to catch a declaration that under-declares what the program
 * needs (issue #519's examples manifest, finding G8; issue #790's conformance fixtures).
 *
 * **Exhaustiveness audit against every optional profile in `spec/conformance.md`'s dependency
 * DAG** (issue #519, fifth review round — see git history for the earlier rounds that added
 * Data-derived-reporter, Heritage `value of … for key`, Geometry/Educational/Tutor-AI table-driven
 * detection, and the reserved-word/Geometry-stdlib rounds below). The audit is no longer only a
 * comment: `scripts/profile-detection.test.mjs` re-derives it from `PROFILE_DEPS`, so a profile
 * added to the DAG with no detection rule is a test failure (issue #701).
 *
 * | Profile | Detected via | Notes |
 * | --- | --- | --- |
 * | Data | `DATA_NODE_KINDS`, index/field segments, `dataPrimitiveArity()` | |
 * | Turtle & Rendering | *(not detected)* | every program needs it; never contradicts a declaration |
 * | Geometry | `geometryPrimitiveArity()` (`grid`/`axes`/`measure`) plus `GEOMETRY_STDLIB_CALLEE_NAMES`
 *   (`polygon`/`star`/`circle`/`arc`/`area`/`perimeter`, the latter two also adding `data` per
 *   `spec/conformance.md:265`) | implemented profile — a live masking case |
 * | Heritage | `HERITAGE_CALLEE_NAMES`, `ValueOfKey` (adds `data` too), `Assign form:"make"`,
 *   `ProcedureDef keyword:"to"`, and `Return keyword:"output"/"op"` (all via the AST walk) | |
 * | Sprites | `SPRITES_CALLEE_NAMES` | |
 * | Interaction & Events | `INTERACTION_EVENTS_CALLEE_NAMES` | |
 * | Sound | `SOUND_CALLEE_NAMES` | |
 * | Educational | `educationalPrimitiveArity()` (`explain`/`why`/`hint`/`debug`) | |
 * | Modules | `RESERVED_WORD_PROFILES` (`import`/`export`, via diagnostics) | |
 * | Localization | `RESERVED_WORD_PROFILES` (`alias`, via diagnostics) | depends on Modules,
 *   expanded by `closureOf` on the declared side |
 * | Tutor (AI) | `TUTOR_AI_CALLEE_NAMES` (`challenge`, `spec/conformance.md:284`) | |
 *
 * `import`/`export`/`alias` (Modules/Localization) have no `Call`/`ParenCall` — or any other — AST
 * production at all today (`packages/parser/src/parser.ts`'s `NON_PRIMARY_NAMES`), so the AST walk
 * below can never see them directly; {@link RESERVED_WORD_PROFILES} detects them instead from the
 * parser's own `ol-bad-token` diagnostics, which always carry the offending token text even though
 * no AST node results. The Heritage `make`/`to`/`output`/`op` heads all have real productions now
 * (issues #151, #667), so they are detected from their AST nodes in the walk below, not from
 * diagnostics.
 *
 * **Every optional profile in the DAG is detected by at least one signal** — either an AST
 * construct/callee name, or (for the three module/localization reserved words with no production at
 * all) a parser diagnostic. There is no remaining profile-classified construct this function cannot
 * see; the only thing it deliberately does NOT attempt is record-binder destructuring (see below),
 * which is a Data-vs-Core split decided by a *runtime* value, not a static one.
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
 * reserved-name check), so a Core-only program is free to `define` its own procedure that happens
 * to share a name with an optional profile's callee (e.g. `define note :duration ... end`). Bare
 * callee-name matching alone would then misattribute that call to Sound/Geometry/Data/Tutor
 * (AI)/etc., and a correctly-declared program that needs no optional profile at all would be
 * wrongly failed. This function therefore precollects every name the source itself `define`s and
 * never treats a call to one of those names as profile-primitive usage — a structural guard, not a
 * one-off exclusion, so it covers every bare-name hand-list (including `TUTOR_AI_CALLEE_NAMES`)
 * uniformly.
 *
 * **The shadow-guard also precollects `struct` names, not just `define`d ones** (round-12
 * rubber-duck review — the opposite-direction bug from masking: a spurious FAIL on a *correct*
 * program): a `struct` declaration registers a same-named **constructor reporter**
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
 *   class (a Core-only program whose own procedure happens to be named `list`/`dict`/etc. would be
 *   wrongly failed for omitting Data).
 *
 * The fix tracks which `Call`/`ParenCall` nodes are themselves direct statements — elements of
 * `Program.body`, or of the `BlockNode` a genuine control-flow construct (`If`'s `thenBody`/
 * `elseBody`, `While`/`Repeat`/`Forever`/`ForIn`/`ForRange`/`ProcedureDef`'s `body`) dispatches
 * through `executeStatements` — versus nested inside an expression. Deliberately enumerated by
 * parent node kind rather than "any `Block`-shaped node" (round-8 rubber-duck review): a
 * `Comprehension`'s `body` field is ALSO typed `BlockNode` (`packages/parser/src/ast.ts:386-395`)
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

  // Reserved words with no AST production at all (`import`/`export`/`alias`, see
  // {@link RESERVED_WORD_PROFILES}) can never be found by the AST walk below, so they are
  // detected from the parser's own diagnostics instead: `packages/parser/src/errors.ts`'s
  // `badToken` (and its `missingTerminator` cascade sibling) always carries the exact offending
  // token text in `params.text`. Those two are the only `ol-bad-token` emitters `parse()` can
  // reach, and each takes `text: string` as a required typed parameter — so an `ol-bad-token`
  // whose `params.text` is not a string cannot be produced here. (The one other emitter,
  // `checker-profile-word-position.ts`'s, is `stage: "semantic"` and comes from `check()`, never
  // from `parse()`; it too always supplies a string.) The guard that used to skip a non-string
  // `text` was therefore unreachable defensive code, and because it could never be exercised
  // legitimately its "coverage" depended on the cross-process V8 block-coverage merge artifact of
  // issue #417 — the fragility issue #701 asked to remove.
  //
  // Matched on the diagnostic `code` plus an exact, case-insensitive `params.text` value — never on
  // `message` prose, which is not part of a diagnostic's stable identity
  // (`spec/localization.md:219`). The Heritage `to`/`output`/`op` words are NOT here anymore: since
  // issue #667 they parse into real AST nodes and are detected in the walk below (see
  // `RESERVED_WORD_PROFILES`'s doc comment and #701).
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== "ol-bad-token") {
      continue;
    }
    const profile = RESERVED_WORD_PROFILES.get(
      diagnostic.params.text.toLowerCase(),
    );
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
  // review): a *correct* Data-only program naming its own struct `area`/`polygon`/`note`/
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
      // The Heritage assignment spelling `make "name" value` (`spec/grammar.md:107`,
      // `spec/conformance.md:274`). Since issue #151 it parses as an `Assign` node whose
      // `form` records the surface spelling — NOT a `Call` — so it is detected here by that form,
      // not by a callee name in `HERITAGE_CALLEE_NAMES`. It is an alternate spelling with no new
      // semantics, so no other profile is implied.
      used.add("heritage");
      return;
    }
    if (node.kind === "ProcedureDef" && node.keyword === "to") {
      // The Heritage procedure-definition spelling `to name … end` (`spec/grammar.md:148`,
      // `spec/conformance.md#heritage`). As of issue #667 (slice H2) it parses into the SAME
      // `ProcedureDef` node as Core `define`, discriminated by `keyword` — NOT the parse-time
      // `ol-bad-token` it produced before, so it is detected here by that `keyword` (see #701:
      // this detector keys on AST shape, and a form gaining a real production must move its
      // detection from the vanished diagnostic to the node). Alternate spelling, no new semantics.
      used.add("heritage");
      return;
    }
    if (
      node.kind === "Return" &&
      (node.keyword === "output" || node.keyword === "op")
    ) {
      // The Heritage return spellings `output value` / `op value` (`spec/grammar.md:152`,
      // `spec/conformance.md#heritage`). As of issue #667 (slice H2) they parse into the SAME
      // `Return` node as Core `return`, discriminated by `keyword` — NOT the parse-time
      // `ol-bad-token` they produced before — so they are detected here by that `keyword` (see
      // #701, as for `to` above). Alternate spelling, no new semantics.
      used.add("heritage");
      return;
    }
    if (node.kind === "ValueOfKey") {
      // The Heritage `value of ... for key` dictionary reader (`spec/conformance.md:277`,`:305`):
      // classified as Heritage, but it "also needs Data" because it operates on dicts — a
      // program using it must declare BOTH, or the missing one goes undetected (issue #519
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
      // names (or a Core-only program whose own procedure happens to be named e.g. `list` would
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
      // implemented, so a program using one of these while under-declaring `geometry` is a live,
      // catchable masking case, not a hypothetical.
      used.add("geometry");
    } else if (GEOMETRY_STDLIB_CALLEE_NAMES.has(name)) {
      // The Geometry profile's derived stdlib procedures `polygon`/`star`/`circle`/`arc`/`area`/
      // `perimeter` (`spec/geometry-module.md`, `spec/conformance.md:265`) — an ordinary,
      // recognizable call site a program either `define`s for itself (already excluded above by
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

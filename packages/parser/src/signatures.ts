/**
 * Default arities for the Core Language primitives, derived from the C3 signature matrix in
 * [`spec/commands.md`](../../../spec/commands.md). OpenLogo calls are prefix and
 * space-separated, and each callable has one fixed default arity, so the reader needs these
 * counts to group a fixed call's arguments: `forward random 100` reads as
 * `forward (random 100)` only because `random` is known to take one input.
 *
 * This registry holds the **Core** surface only; the Turtle & Rendering and later profiles
 * extend it with their own primitives in their slices. Infix and unary operators
 * (`+ - * / mod == != < > <= >= and or not`) are not listed here — the grammar groups them
 * by precedence, and the AST records them as {@link CallNode}s with the operator as callee.
 * Variadic forms such as `(print :a :b)` or `(random a b)` use the parenthesized call and so
 * do not depend on the default arity.
 *
 * Every fixed-arity Core Reporter and Command from `commands.md` must appear here: an omitted
 * name falls back to arity `0` in the reader, so its arguments are silently left on the line as
 * stray statements instead of being gathered — a quiet miscount with no diagnostic. Special
 * forms (`if`/`while`/`repeat`/`for`/`forever`/`define`/`return`/`stop`/`throw`/`local`/
 * `map`/`filter`/`reduce`) and the literals `true`/`false` are handled by dedicated grammar
 * productions, not this table.
 */

import type { NodeKind } from "./ast.js";

/**
 * Default arity of each Core primitive, keyed by its canonical lowercase name. Kept module-
 * private so the table is immutable from outside — callers read it only through the pure
 * {@link corePrimitiveArity} lookup, never a mutable `Map` reference.
 */
const CORE_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  // Variables and output.
  ["thing", 1],
  ["print", 1],
  ["show", 1],
  // Math.
  ["abs", 1],
  ["sqrt", 1],
  ["int", 1],
  ["round", 1],
  ["power", 2],
  ["random", 1],
  ["randomize", 0],
  ["sin", 1],
  ["cos", 1],
  ["tan", 1],
  ["pi", 0],
  // Logic and predicates.
  ["empty?", 1],
  ["member?", 2],
  ["is_a?", 2],
  ["repcount", 0],
  // Words and lists.
  ["word", 2],
  ["sentence", 2],
  ["first", 1],
  ["last", 1],
  ["butfirst", 1],
  ["butlast", 1],
  ["fput", 2],
  ["lput", 2],
  ["count", 1],
  ["uppercase", 1],
  ["lowercase", 1],
]);

/**
 * The default arity of a Core primitive, or `undefined` when `name` is not a known Core
 * primitive (a user procedure or an as-yet-unknown callable). Matching is case-insensitive.
 */
export function corePrimitiveArity(name: string): number | undefined {
  return CORE_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * Default arities for the **Turtle & Rendering** profile's Core-spelled primitives (issue #193),
 * derived from the Turtle movement / Pen and screen tables in
 * [`spec/commands.md`](../../../spec/commands.md). Registers the canonical underscored names plus
 * the small set of Turtle & Rendering (not Heritage) aliases the spec documents inline —
 * `setxy`/`seth` (issue #202; `spec/commands.md:1279,1296`), `setcolor`/`setbg` (issue #208;
 * `spec/commands.md:1521,1539`), and `setwidth` (issue #209; `spec/commands.md:1556`).
 * `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs` are the genuinely
 * **Heritage**-profile (M5) short spellings and stay out of this table — the Heritage profile's
 * short-alias list is closed by `spec/conformance.md:105-117`, and `setxy`/`seth`/`setcolor`/
 * `setbg`/`setwidth` are not members of it. Kept
 * as a separate table from {@link CORE_PRIMITIVE_ARITY} (rather than merged into it) because the two
 * profiles have independent visibility: the Layer-2 checker gates each on its own active profile
 * (`spec/tooling.md:175-176`), while the reader (this table's only consumer, via
 * {@link primitiveArity}) groups a bare call's arguments for *any* recognized primitive
 * regardless of profile — the profile-legality decision belongs to the checker, not the reader.
 */
const TURTLE_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  // Turtle movement.
  ["forward", 1],
  ["back", 1],
  ["left", 1],
  ["right", 1],
  ["home", 0],
  ["set_xy", 2],
  ["setxy", 2], // Turtle & Rendering alias of `set_xy` (spec/commands.md:1279), not Heritage.
  ["set_heading", 1],
  ["seth", 1], // Turtle & Rendering alias of `set_heading` (spec/commands.md:1296), not Heritage.
  ["xcor", 0],
  ["ycor", 0],
  ["heading", 0],
  ["pos", 0],
  ["towards", 2],
  ["distance", 2],
  // Pen and screen.
  ["show_turtle", 0],
  ["hide_turtle", 0],
  ["pen_up", 0],
  ["pen_down", 0],
  ["clear_screen", 0],
  ["clean", 0],
  ["set_color", 1],
  ["setcolor", 1], // Turtle & Rendering alias of `set_color` (spec/commands.md:1521), not Heritage.
  ["set_background", 1],
  ["setbg", 1], // Turtle & Rendering alias of `set_background` (spec/commands.md:1539), not Heritage.
  ["set_width", 1],
  ["setwidth", 1], // Turtle & Rendering alias of `set_width` (spec/commands.md:1556), not Heritage.
  ["fill", 0],
  ["stamp", 0],
  ["set_shape", 1],
]);

/**
 * The default arity of a Turtle & Rendering primitive, or `undefined` when `name` is not one of
 * the Core-spelled turtle primitives registered in {@link TURTLE_PRIMITIVE_ARITY}. Matching is
 * case-insensitive.
 *
 * `TURTLE_PRIMITIVE_ARITY` is this profile's single source-of-truth table. A future visibility
 * slice (issue #136) that makes turtle primitives visible to `ol-unknown-command`
 * (`checker-names.ts`) and its static arity check (`checker-arity.ts`) should add its own
 * `turtlePrimitiveNames()` / `turtlePrimitiveArityRange()` accessors reading from this same table
 * — mirroring {@link corePrimitiveNames} / {@link corePrimitiveArityRange} — rather than
 * re-deriving a separate turtle name/arity list. Wiring that visibility is intentionally deferred
 * to #136: extending `checker-arity.ts` to treat a turtle callee as statically-known *before*
 * `checker-names.ts` also treats it as visible would make `ol-unknown-command` and
 * `ol-not-enough-inputs`/`ol-too-many-inputs` both fire for the same call site, breaking the two
 * rules' documented never-double-report contract.
 */
export function turtlePrimitiveArity(name: string): number | undefined {
  return TURTLE_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * Every Turtle & Rendering primitive's canonical lowercase name, sorted for deterministic
 * iteration. This is the enumerable counterpart to {@link turtlePrimitiveArity} — the checker's
 * visible-name model (`checker-names.ts`, issue #136) needs the full name *list*, gated on the
 * `turtle-rendering` profile, to make these primitives both callable without `ol-unknown-command`
 * and candidates for its did-you-mean suggestions — mirroring {@link corePrimitiveNames}'s role
 * for the Core table. Kept as a frozen array computed once so callers cannot mutate the shared
 * table.
 */
const TURTLE_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...TURTLE_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Turtle & Rendering primitive names, in sorted order. See
 * {@link TURTLE_PRIMITIVE_NAMES}. */
export function turtlePrimitiveNames(): readonly string[] {
  return TURTLE_PRIMITIVE_NAMES;
}

/**
 * Default arities for the **Data** profile's derived list/dict reporters (issue #190 for
 * `reverse`/`pick`/`sort`; issue #322 adds `dict`/`keys`/`values`; issue #329 adds `type_of`;
 * issue #397 adds `list`), derived from the "Mutating list operations" table, the "Derived list
 * reporters in the Data profile" table, the dictionary operations table, and the record operations
 * table in [`spec/data-structures.md`](../../../spec/data-structures.md): `reverse`/`pick`/`sort`
 * each take one `list` argument, matching the spec's own worked example's bare-call form
 * (`:backward = reverse :nums`); `list` takes none as a bare call (`spec/data-structures.md:77`'s
 * empty-list constructor reporter — its variadic parenthesized form `(list a b …)`,
 * `spec/data-structures.md:78`, is not a fixed arity and so is not represented in this table, the
 * same way `dict` has no parenthesized variadic form to register); `dict` takes none (the
 * empty-constructor reporter); `keys`/`values` each take one `dict` argument; `type_of` takes one
 * `record` argument and reports its struct type name (`spec/data-structures.md:286`). Kept as its
 * own table rather than folded into {@link CORE_PRIMITIVE_ARITY} for the same reason
 * {@link TURTLE_PRIMITIVE_ARITY} is separate: the two profiles have independent visibility (the
 * Layer-2 checker gates each on its own active profile, `spec/tooling.md:175-176`), while the
 * reader (this table's only consumer, via {@link primitiveArity}) groups a bare call's arguments
 * for *any* recognized primitive regardless of profile.
 */
const DATA_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  ["reverse", 1],
  ["pick", 1],
  ["sort", 1],
  ["list", 0],
  ["dict", 0],
  ["keys", 1],
  ["values", 1],
  ["type_of", 1],
]);

/**
 * The default (bare-call) arity of a Data-profile derived list reporter, or `undefined` when
 * `name` is not one of the primitives registered in {@link DATA_PRIMITIVE_ARITY}. Matching is
 * case-insensitive.
 *
 * `DATA_PRIMITIVE_ARITY` is this profile's single source-of-truth table. Its name-enumeration
 * counterpart, {@link dataPrimitiveNames}, makes these reporters visible to `ol-unknown-command`
 * (`checker-names.ts`, issue #397); its range counterpart, {@link dataPrimitiveArityRange}, is what
 * the static arity check (`checker-arity.ts`, issue #405) actually consults — mirroring
 * {@link corePrimitiveArityRange}'s role for Core primitives.
 */
export function dataPrimitiveArity(name: string): number | undefined {
  return DATA_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * Data-profile primitives whose parenthesized call form accepts more inputs than their bare
 * default arity, keyed by canonical lowercase name to the maximum the paren form accepts
 * (`Number.POSITIVE_INFINITY` for an open variadic) — mirrors {@link CORE_PRIMITIVE_MAX_ARITY}
 * exactly. `list`'s bare form is the empty-list constructor (arity 0), but its parenthesized
 * alternate `(list a b …)` (`spec/data-structures.md:78`) is open variadic, just like `(print …)`.
 * Every other Data primitive absent here is strictly fixed-arity.
 */
const DATA_PRIMITIVE_MAX_ARITY: ReadonlyMap<string, number> = new Map([
  ["list", Number.POSITIVE_INFINITY],
]);

/**
 * The inclusive input-count range a Data-profile primitive accepts, or `undefined` when `name` is
 * not a known Data primitive. `min` is the bare default arity ({@link dataPrimitiveArity}); `max`
 * is the most its parenthesized alternate/variadic form accepts
 * ({@link DATA_PRIMITIVE_MAX_ARITY}) — `Number.POSITIVE_INFINITY` for an open variadic (`list`),
 * and equal to `min` for every other, strictly fixed-arity Data primitive. Mirrors
 * {@link corePrimitiveArityRange} exactly; the static arity checker (issue #405) uses this to tell
 * `list`'s genuine variadic paren form (`(list 1 2)`) from a fixed-arity Data primitive given too
 * many inputs (`(reverse :a :b)`). Matching is case-insensitive.
 */
export function dataPrimitiveArityRange(
  name: string,
): { readonly min: number; readonly max: number } | undefined {
  const min = dataPrimitiveArity(name);
  if (min === undefined) {
    return undefined;
  }
  return { min, max: DATA_PRIMITIVE_MAX_ARITY.get(name.toLowerCase()) ?? min };
}

/**
 * Every Data-profile primitive's canonical lowercase name, sorted for deterministic iteration.
 * This is the enumerable counterpart to {@link dataPrimitiveArity} — the checker's visible-name
 * model (`checker-names.ts`, issue #397 and issue #405) needs the full name *list*, gated on the
 * `data` profile, to make these primitives both callable without `ol-unknown-command` and
 * candidates for its did-you-mean suggestions — mirroring {@link turtlePrimitiveNames}'s role for
 * the Turtle & Rendering table.
 */
const DATA_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...DATA_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Data-profile primitive names, in sorted order. See
 * {@link DATA_PRIMITIVE_NAMES}. */
export function dataPrimitiveNames(): readonly string[] {
  return DATA_PRIMITIVE_NAMES;
}

/**
 * Default arities for the **Educational** profile's baseline meta-commands (issue #331), derived
 * from the signature table in [`spec/conformance.md`](../../../spec/conformance.md#educational):
 * `explain`/`why`/`hint`/`debug` are each a Command, arity 0, invoked as a bare word — the exact
 * same "zero-input bare Command" grammar production `home`/`pi`/`randomize` already use, so
 * `spec/commands.md`'s "Meta-commands are commands taking no inputs" note needs no new grammar
 * production or AST node kind (`ast-design` skill: "one node kind per grammar production"). Kept
 * as its own table for the same reason {@link TURTLE_PRIMITIVE_ARITY}/{@link DATA_PRIMITIVE_ARITY}
 * are separate: Educational has its own independent profile visibility (the Layer-2 checker gates
 * it on its own active profile, `spec/tooling.md:175-176`), while the reader groups a bare call's
 * arguments for *any* recognized primitive regardless of profile.
 */
const EDUCATIONAL_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  ["explain", 0],
  ["why", 0],
  ["hint", 0],
  ["debug", 0],
]);

/**
 * The default arity of an Educational-profile meta-command, or `undefined` when `name` is not one
 * of `explain`/`why`/`hint`/`debug`. Matching is case-insensitive.
 *
 * `EDUCATIONAL_PRIMITIVE_ARITY` is this profile's single source-of-truth table — mirroring
 * {@link turtlePrimitiveArity}/{@link dataPrimitiveArity} — for a future visibility slice's
 * `educationalPrimitiveNames()` accessor to read from, exactly as {@link turtlePrimitiveNames} does
 * for Turtle & Rendering.
 */
export function educationalPrimitiveArity(name: string): number | undefined {
  return EDUCATIONAL_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * Every Educational-profile meta-command's canonical lowercase name, sorted for deterministic
 * iteration. This is the enumerable counterpart to {@link educationalPrimitiveArity} — the
 * checker's visible-name model (`checker-names.ts`) needs the full name *list*, gated on the
 * `educational` profile, to make these meta-commands both callable without `ol-unknown-command`
 * and candidates for its did-you-mean suggestions — mirroring {@link turtlePrimitiveNames}'s role
 * for the Turtle & Rendering table.
 */
const EDUCATIONAL_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...EDUCATIONAL_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Educational-profile meta-command names, in sorted order. See
 * {@link EDUCATIONAL_PRIMITIVE_NAMES}. */
export function educationalPrimitiveNames(): readonly string[] {
  return EDUCATIONAL_PRIMITIVE_NAMES;
}

/**
 * Default arities for the **Geometry** profile's renderer-backed overlay primitives (issue #341):
 * `grid`/`axes`/`measure`, derived from
 * [`spec/geometry-module.md`](../../../spec/geometry-module.md)'s `## grid`, `## axes`, and
 * `## measure` sections —
 * each is a Kind-C Command taking no inputs, invoked as a bare word exactly like
 * `home`/`pi`/`randomize` and the Educational meta-commands. Unlike `polygon` and the rest of the
 * Geometry standard library (discoverable OpenLogo `.logo` source, not primitives — team agreement
 * §6), these three ARE primitives because they are renderer-backed: they emit an `overlay` trace
 * event but never mutate turtle state, and only a real renderer can turn that event into a grid of
 * guide lines, crossed axes, or a measurement marker. Kept as its own table for the same reason
 * {@link TURTLE_PRIMITIVE_ARITY}/{@link EDUCATIONAL_PRIMITIVE_ARITY} are separate: Geometry has its
 * own independent profile visibility (the Layer-2 checker gates it on its own active profile,
 * `spec/tooling.md:175-176`), while the reader groups a bare call's arguments for *any* recognized
 * primitive regardless of profile.
 */
const GEOMETRY_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  ["grid", 0],
  ["axes", 0],
  ["measure", 0],
]);

/**
 * The default arity of a Geometry-profile overlay primitive, or `undefined` when `name` is not
 * one of `grid`/`axes`/`measure`. Matching is case-insensitive.
 *
 * `GEOMETRY_PRIMITIVE_ARITY` is this profile's single source-of-truth table — mirroring
 * {@link turtlePrimitiveArity}/{@link educationalPrimitiveArity}.
 */
export function geometryPrimitiveArity(name: string): number | undefined {
  return GEOMETRY_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * Every Geometry-profile overlay primitive's canonical lowercase name, sorted for deterministic
 * iteration. This is the enumerable counterpart to {@link geometryPrimitiveArity} — the checker's
 * visible-name model (`checker-names.ts`) needs the full name *list*, gated on the `geometry`
 * profile, to make these primitives both callable without `ol-unknown-command` and candidates for
 * its did-you-mean suggestions — mirroring {@link turtlePrimitiveNames}'s/
 * {@link educationalPrimitiveNames}'s role for their tables.
 */
const GEOMETRY_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...GEOMETRY_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Geometry-profile overlay primitive names, in sorted order. See
 * {@link GEOMETRY_PRIMITIVE_NAMES}. */
export function geometryPrimitiveNames(): readonly string[] {
  return GEOMETRY_PRIMITIVE_NAMES;
}

/**
 * Default arities for the **Interaction & Events** profile's Core-spelled primitives that the
 * reader must group arguments for — `wait <n>` (issue #680, slice I1) and `input <prompt>` (issue
 * #681, slice I2), the profile's only two ordinary calls (`spec/interaction-events.md:65`: "`input`
 * and `wait` are ordinary calls and take no block"). `wait` is a Kind-C Command taking one input and
 * `input` a Kind-R Reporter taking one prompt, both derived from
 * [`spec/interaction-events.md`](../../../spec/interaction-events.md)'s "Profiles and reservation"
 * table and their `### wait <n>` / `### input <prompt>` sections.
 * `when`/`every`/`on_key`/`on_click` are profile block-heads (reserved words with their own block
 * grammar, not ordinary calls) and register their reader support elsewhere — see
 * {@link INTERACTION_EVENTS_BLOCK_HEAD_NAMES}; only the ordinary calls need an arity entry here so
 * the reader groups their single argument. Kept as its own table for the same reason
 * {@link TURTLE_PRIMITIVE_ARITY}/{@link GEOMETRY_PRIMITIVE_ARITY} are separate:
 * Interaction & Events has its own independent profile visibility (the Layer-2 checker gates it on
 * its own active profile, `spec/tooling.md:175-176`), while the reader groups a bare call's
 * arguments for *any* recognized primitive regardless of profile.
 */
const INTERACTION_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  ["wait", 1],
  ["input", 1],
]);

/**
 * The default arity of an Interaction & Events-profile primitive, or `undefined` when `name` is
 * not one of them (`wait` and `input`). Matching is case-insensitive.
 *
 * `INTERACTION_PRIMITIVE_ARITY` is this profile's single source-of-truth table — mirroring
 * {@link geometryPrimitiveArity}/{@link educationalPrimitiveArity}. Its enumerable counterpart is
 * {@link interactionPrimitiveNames}.
 */
export function interactionPrimitiveArity(name: string): number | undefined {
  return INTERACTION_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * The inclusive input-count range an Interaction & Events-profile primitive accepts, or `undefined`
 * when `name` is not one. Both `wait <n>` and `input <prompt>` are strictly fixed-arity — each takes
 * exactly one input, with no variadic parenthesized alternate (`spec/interaction-events.md`'s
 * "Profiles and reservation" table) — so `max` always equals `min`
 * ({@link interactionPrimitiveArity}). Mirrors
 * {@link soundPrimitiveArityRange} exactly; the static arity checker (`checker-arity.ts`) consults
 * this to flag a known Interaction primitive given the wrong number of inputs (e.g. `(wait)` or
 * `(input "a" "b")`) under the active `interaction-events` profile. Matching is case-insensitive.
 */
export function interactionPrimitiveArityRange(
  name: string,
): { readonly min: number; readonly max: number } | undefined {
  const min = interactionPrimitiveArity(name);
  if (min === undefined) {
    return undefined;
  }
  return { min, max: min };
}

/**
 * Every Interaction & Events-profile primitive's canonical lowercase name, sorted for deterministic
 * iteration. This is the enumerable counterpart to {@link interactionPrimitiveArity} — the checker's
 * visible-name model (`checker-names.ts`) needs the full name *list*, gated on the
 * `interaction-events` profile, to make these primitives both callable without `ol-unknown-command`
 * and candidates for its did-you-mean suggestions — mirroring {@link geometryPrimitiveNames}'s and
 * {@link soundPrimitiveNames}'s role for their tables.
 *
 * Derived from {@link INTERACTION_PRIMITIVE_ARITY} rather than hand-listed, so this profile keeps a
 * single source of truth: a name becomes visible to the checker exactly when its arity is
 * registered, and the two can never drift apart. Today that is `input` and `wait` — the profile's
 * two ordinary calls, and the whole table. The tooling slice (#687) deliberately registered `wait`
 * alone and left `input` out, because a checker name with no runtime evaluator behind it lets a
 * program check clean and then fail at runtime — a false tooling claim worse for a learner than an
 * honest `ol-unknown-command`. Slice I2 (#681) ships `input`'s evaluator, so both halves of its
 * registration — this table for the reader/checker, and `@openlogo/runtime`'s `evaluateInput` —
 * land together, exactly as that boundary required.
 */
const INTERACTION_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...INTERACTION_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Interaction & Events-profile primitive names, in sorted order. See
 * {@link INTERACTION_PRIMITIVE_NAMES}. */
export function interactionPrimitiveNames(): readonly string[] {
  return INTERACTION_PRIMITIVE_NAMES;
}

/**
 * The **Interaction & Events** profile block-head names the Layer-2 checker must treat as visible
 * so a call site whose head is one of them does not raise `ol-unknown-command` under an active
 * `interaction-events` profile (issue #682, slice I3 — `spec/tooling.md:175-176`,
 * `spec/interaction-events.md` §Profiles and reservation). These are the four reserved block-heads
 * `when`/`every`/`on_key`/`on_click` the reader lowers to a `ProfileStatement` (C2 #664's
 * `PROFILE_STATEMENT_FORMS`), NOT ordinary primitive calls — so they live in their own table,
 * separate from {@link INTERACTION_PRIMITIVE_ARITY}'s Core-spelled `wait`, exactly as the spec
 * distinguishes profile block-heads from ordinary calls.
 *
 * `when` (#682/I3), `every` (#683/I4), `on_key` (#684/I5), and `on_click` (#685/I6) are listed today:
 * each is the head its slice delivers end to end. This table is now complete — all four Interaction &
 * Events block-heads are usable — following the same one-form-at-a-time growth as every other
 * profile's visible-name table; registering a head here before its slice can execute it would let a
 * program check clean and then silently no-op at runtime. `input` (a reporter) and `wait` (an
 * ordinary call) are visible through their own name path — {@link INTERACTION_PRIMITIVE_NAMES} —
 * not this block-head table. Entries stay in
 * registration order so the checker's candidate set (`checker-names.ts`) exposes a stable
 * did-you-mean ordering.
 */
const INTERACTION_EVENTS_BLOCK_HEAD_NAMES: readonly string[] = Object.freeze([
  "when",
  "every",
  "on_key",
  "on_click",
]);

/**
 * The Interaction & Events block-head names visible to the checker, in registration order. See
 * {@link INTERACTION_EVENTS_BLOCK_HEAD_NAMES}. The checker's visible-name model
 * (`checker-names.ts`) spreads these into its candidate set only when the `interaction-events`
 * profile is active, mirroring how {@link soundPrimitiveNames} gates the Sound profile's names.
 */
export function interactionEventsBlockHeadNames(): readonly string[] {
  return INTERACTION_EVENTS_BLOCK_HEAD_NAMES;
}

/**
 * Default arities for the **Sound** profile's primitives (issue #689,
 * [`spec/interaction-events.md`](../../../spec/interaction-events.md)'s "Sound primitives"
 * section). `set_tempo` takes one number (the beats-per-minute, `spec/interaction-events.md:259-272`)
 * and `beep` takes none (`spec/interaction-events.md:309-324`) — the two primitives slice S1 (#689)
 * delivers; the remaining Sound names (`note`/`play`/`rest`) join this table in their own slices
 * (#690/#691), each a bare `Call` grouped by this arity exactly as `set_width`/`grid` are. Kept as
 * its own table for the same reason {@link TURTLE_PRIMITIVE_ARITY}/{@link GEOMETRY_PRIMITIVE_ARITY}
 * are separate: Sound has its own independent profile visibility (the Layer-2 checker gates it on
 * its own active `sound` profile, `spec/tooling.md:175-176`), while the reader groups a bare call's
 * arguments for *any* recognized primitive regardless of profile — the profile-legality decision
 * belongs to the checker, not the reader. Sound command names are ordinary primitive names (not
 * reserved block-heads) when the profile is present (`spec/interaction-events.md`).
 */
const SOUND_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  ["set_tempo", 1],
  ["beep", 0],
  ["note", 2],
  ["rest", 1],
  ["play", 1],
]);

/**
 * The default arity of a Sound-profile primitive, or `undefined` when `name` is not one of the
 * primitives registered in {@link SOUND_PRIMITIVE_ARITY}. Matching is case-insensitive.
 *
 * `SOUND_PRIMITIVE_ARITY` is this profile's single source-of-truth table — mirroring
 * {@link geometryPrimitiveArity}/{@link educationalPrimitiveArity}.
 */
export function soundPrimitiveArity(name: string): number | undefined {
  return SOUND_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * The inclusive input-count range a Sound-profile primitive accepts, or `undefined` when `name` is
 * not a known Sound primitive. Every Sound primitive (`set_tempo`, `beep`, `note`, `rest`) is
 * strictly fixed-arity — none has a variadic parenthesized alternate — so `max` always equals `min`
 * ({@link soundPrimitiveArity}). Mirrors {@link dataPrimitiveArityRange} exactly; the static arity
 * checker (`checker-arity.ts`) consults this to flag a known Sound command given the wrong number
 * of inputs (e.g. `(set_tempo 1 2)`, `(beep 1)`, or `(note "c4")`) under the active `sound`
 * profile. Matching is case-insensitive.
 */
export function soundPrimitiveArityRange(
  name: string,
): { readonly min: number; readonly max: number } | undefined {
  const min = soundPrimitiveArity(name);
  if (min === undefined) {
    return undefined;
  }
  return { min, max: min };
}

/**
 * Every Sound-profile primitive's canonical lowercase name, sorted for deterministic iteration.
 * This is the enumerable counterpart to {@link soundPrimitiveArity} — the checker's visible-name
 * model (`checker-names.ts`) needs the full name *list*, gated on the `sound` profile, to make
 * these primitives both callable without `ol-unknown-command` and candidates for its did-you-mean
 * suggestions — mirroring {@link geometryPrimitiveNames}'s role for its table.
 */
const SOUND_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...SOUND_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Sound-profile primitive names, in sorted order. See
 * {@link SOUND_PRIMITIVE_NAMES}. */
export function soundPrimitiveNames(): readonly string[] {
  return SOUND_PRIMITIVE_NAMES;
}

/**
 * Default arities for the **Sprites** profile's turtle-identity reporters (issue #673),
 * derived from [`spec/turtles-and-sprites.md`](../../../spec/turtles-and-sprites.md)'s "Canonical
 * forms" table (the authoritative C3 rows): `new_turtle` (R, 0 → turtle), `who` (R, 0 → turtle),
 * and `turtles` (R, 0 → list) are each a Kind-R reporter taking no inputs, invoked as a bare word
 * exactly like `pos`/`heading` or the Geometry overlay primitives. The Sprites block-heads
 * `tell`/`ask`/`each` are NOT here: they are statement forms/reserved words handled by the grammar
 * and checker, not bare-call primitives whose arguments the reader groups. Kept as its own table
 * for the same reason {@link TURTLE_PRIMITIVE_ARITY}/{@link GEOMETRY_PRIMITIVE_ARITY} are separate:
 * Sprites has its own independent profile visibility (the Layer-2 checker gates it on its own
 * active profile, `spec/tooling.md:175-176`), while the reader groups a bare call's arguments for
 * *any* recognized primitive regardless of profile. Registering these arities therefore does NOT
 * make the Sprites profile callable under Core or claimable — that gating is the checker's and the
 * profile-claim slice's concern.
 */
const SPRITES_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  ["new_turtle", 0],
  ["who", 0],
  ["turtles", 0],
]);

/**
 * The default arity of a Sprites-profile reporter, or `undefined` when `name` is not one of
 * `new_turtle`/`who`/`turtles`. Matching is case-insensitive.
 *
 * `SPRITES_PRIMITIVE_ARITY` is this profile's single source-of-truth table — mirroring
 * {@link turtlePrimitiveArity}/{@link geometryPrimitiveArity}. Its enumerable name-list counterpart
 * ({@link spritesPrimitiveNames}, mirroring {@link geometryPrimitiveNames}) is added by the Sprites
 * semantic-checker slice (#678) that first needs it, so `new_turtle`/`who`/`turtles` become known
 * callees under an active `sprites` profile rather than raising `ol-unknown-command`.
 */
export function spritesPrimitiveArity(name: string): number | undefined {
  return SPRITES_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * Every Sprites-profile reporter's canonical lowercase name, sorted for deterministic iteration.
 * This is the enumerable counterpart to {@link spritesPrimitiveArity} — the checker's visible-name
 * model (`checker-names.ts`) needs the full name *list*, gated on the `sprites` profile, to make
 * `new_turtle`/`who`/`turtles` both callable without `ol-unknown-command` and candidates for its
 * did-you-mean suggestions — mirroring {@link geometryPrimitiveNames}'s role for its table.
 */
const SPRITES_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...SPRITES_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Sprites-profile reporter names, in sorted order. See
 * {@link SPRITES_PRIMITIVE_NAMES}. */
export function spritesPrimitiveNames(): readonly string[] {
  return SPRITES_PRIMITIVE_NAMES;
}

/**
 * The Sprites-profile **statement forms** whose head keyword the checker must recognize as a
 * visible command name (issue #674), so a `ProfileStatement` such as `tell :friend` is not reported
 * `ol-unknown-command` under an active `sprites` profile (`unknownCommandRule` walks the head
 * keyword against {@link collectVisibleNames}). `tell` was registered for SP2 (the addressing
 * mode-switch), `ask` for SP3 (#675, the scoped block-head), and `each` for SP4 (#676, the
 * once-per-turtle block-head this slice runs); the `new_turtle`/`who`/`turtles` reporters have their
 * own name-list (#678), so registering them here would let a program "check clean" against a form
 * nothing runs. Sourced from a dedicated table rather than
 * {@link SPRITES_PRIMITIVE_ARITY} because these are statement forms (grouped by the grammar's
 * profile-statement rule), not bare-call reporters whose arguments the reader groups.
 */
const SPRITES_STATEMENT_FORM_NAMES: readonly string[] = ["tell", "ask", "each"];

/**
 * Every Sprites-profile statement-form head keyword the checker treats as a visible command name
 * (`tell` from #674, `ask` from #675, `each` from #676). The enumerable counterpart the checker's
 * unknown-command rule consults, mirroring {@link soundPrimitiveNames}.
 */
export function spritesStatementFormNames(): readonly string[] {
  return SPRITES_STATEMENT_FORM_NAMES;
}

/**
 * The **Heritage** profile's short command and reporter aliases (issues #668 slice H3 + #669 slice
 * H4), each mapping onto the Core-spelled command or reporter it is an alternate spelling of. The
 * list and its one-to-one canonical mapping are authoritative in `spec/conformance.md:151` and
 * `spec/commands.md`'s per-command **Aliases** rows (`fd`→`forward`:1195, `bk`→`back`:1212,
 * `lt`→`left`:1229, `rt`→`right`:1246, `st`→`show_turtle`:1418, `ht`→`hide_turtle`:1435,
 * `pu`→`pen_up`:1452, `pd`→`pen_down`:1470, `cs`→`clear_screen`:1488, `pr`→`print`:146, plus the
 * list reporters `bf`→`butfirst`:1070, `bl`→`butlast`:1087, `se`→`sentence`:1019). Heritage is
 * "alternate spellings only — no new semantics" (`spec/conformance.md:146`): the reader records
 * `canonical` on the alias's {@link import("./ast.js").CallNode} so the runtime dispatches through
 * the exact same code path as the Core spelling, and this module never keeps a second copy of each
 * canonical's arity — that stays each owning profile's single source-of-truth table (see
 * {@link heritageAliasArity} and {@link heritageAliasArityRange}, which resolve the alias then read
 * the canonical's own arity).
 */
const HERITAGE_ALIAS_CANONICAL: ReadonlyMap<string, string> = new Map([
  ["fd", "forward"],
  ["bk", "back"],
  ["lt", "left"],
  ["rt", "right"],
  ["st", "show_turtle"],
  ["ht", "hide_turtle"],
  ["pu", "pen_up"],
  ["pd", "pen_down"],
  ["cs", "clear_screen"],
  ["pr", "print"],
  ["bf", "butfirst"],
  ["bl", "butlast"],
  ["se", "sentence"],
]);

/**
 * The Core-spelled command a Heritage short alias is an alternate spelling of, or `undefined` when
 * `name` is not a Heritage short alias. Matching is case-insensitive. This is the one-to-one
 * mapping the reader records as {@link import("./ast.js").CallNode.canonical} and every consumer
 * (runtime dispatch, the checker's arity/did-you-mean logic, tutor `explain`/`why`) resolves an
 * alias through — so Heritage stays "alternate spellings only" with no duplicated semantics.
 */
export function canonicalOfHeritageAlias(name: string): string | undefined {
  return HERITAGE_ALIAS_CANONICAL.get(name.toLowerCase());
}

/**
 * Every Heritage short command alias's lowercase spelling, sorted for deterministic iteration.
 * The enumerable counterpart to {@link canonicalOfHeritageAlias} — the checker's visible-name model
 * (`checker-names.ts`) needs the full list, gated on the `heritage` profile, to make these aliases
 * both callable without `ol-unknown-command` and did-you-mean candidates, mirroring
 * {@link turtlePrimitiveNames}'s role for its table.
 */
const HERITAGE_ALIAS_NAMES: readonly string[] = Object.freeze(
  [...HERITAGE_ALIAS_CANONICAL.keys()].sort(),
);

/** The full list of Heritage short alias names, in sorted order. See {@link HERITAGE_ALIAS_NAMES}. */
export function heritageAliasNames(): readonly string[] {
  return HERITAGE_ALIAS_NAMES;
}

/**
 * The **Heritage** form heads (issue #667, slice H2) — the special-form spellings that are not
 * *names* the reader lowers to a call, but surface tags on the same Core AST node as their Core
 * equivalent — each mapped to the Core spelling it is an alternate spelling of. `make` → `set`
 * (the word-shaped Core assignment; `=` is the other Core form), `to` → `define`, and
 * `output`/`op` → `return`.
 *
 * This is the form-head counterpart of {@link HERITAGE_ALIAS_CANONICAL}, and it lives here — beside
 * it — so the parser has exactly ONE table answering "what Core spelling is this Heritage spelling
 * an alternate of". Two consumers need that answer for different reasons, and they must never drift:
 * `checker-heritage-form.ts` points a Core-only learner's did-you-mean at the Core spelling, and
 * `checker-control-flow.ts` canonicalizes `params.keyword` so a Heritage escape's diagnostic
 * identity is byte-identical to its Core twin's (`spec/error-model.md:235-238`, issue #737).
 *
 * Declared `as const` so {@link canonicalOfHeritageFormHead} can report each head's canonical as a
 * literal type: that is what lets a caller thread a canonical spelling into a diagnostic param
 * without a cast, and what makes feeding a *surface* spelling to a canonical-typed parameter a
 * compile error rather than a silently divergent diagnostic.
 */
const HERITAGE_FORM_HEAD_CANONICAL = {
  make: "set",
  to: "define",
  output: "return",
  op: "return",
} as const;

/** One of the four Heritage form-head spellings — the keys of {@link HERITAGE_FORM_HEAD_CANONICAL}. */
export type HeritageFormHead = keyof typeof HERITAGE_FORM_HEAD_CANONICAL;

/**
 * The Core spelling a Heritage form head is an alternate spelling of, as a **literal type**:
 * `canonicalOfHeritageFormHead("op")` is typed `"return"`, not `string`. Callers that must produce
 * a canonical value — a diagnostic's structured params above all — get it from this one registry
 * rather than repeating the mapping, so a Heritage spelling can never reach a canonical position.
 */
export function canonicalOfHeritageFormHead<Head extends HeritageFormHead>(
  head: Head,
): (typeof HERITAGE_FORM_HEAD_CANONICAL)[Head] {
  return HERITAGE_FORM_HEAD_CANONICAL[head];
}

/** Every Heritage form-head spelling, sorted for deterministic iteration. */
const HERITAGE_FORM_HEAD_NAMES: readonly HeritageFormHead[] = Object.freeze(
  (Object.keys(HERITAGE_FORM_HEAD_CANONICAL) as HeritageFormHead[]).sort(),
);

/** The full list of Heritage form-head spellings, in sorted order. */
export function heritageFormHeadNames(): readonly HeritageFormHead[] {
  return HERITAGE_FORM_HEAD_NAMES;
}

/**
 * The **Heritage** profile's WORDED forms — the multi-word spellings, which are neither callable
 * *names* like {@link HERITAGE_ALIAS_CANONICAL}'s aliases nor single-word statement heads like
 * {@link HERITAGE_FORM_HEAD_CANONICAL}'s. `spec/conformance.md:153` lists exactly one today, the
 * worded dictionary reporter `value of … for key` (slice H5, issue #670), whose production is
 * `spec/grammar.md:213`'s `value-of-reader`.
 *
 * Each entry records three things. `phrase` is quoted verbatim from that spec bullet, so a guard
 * can hold this table against the spec's own inventory without normalising anything. `node` is the
 * AST node kind the reader lowers the form onto, which lets a guard check that a test program
 * parses to that kind rather than merely mentioning the form's head word — the AST records node
 * kinds, not the production that built them, so it distinguishes registered forms only as long as
 * no two share a kind, an invariant the parser guard asserts. And `head` is the word the
 * form is identified BY — the one part of the phrase that can reach a diagnostic's structured
 * params, and the only word in it that appears in no other production: `of` is the contextual
 * preposition of the `is member of` predicate (`spec/grammar.md:365`), `for` opens the Core
 * `for … in`/`for … from … to` loops, and `key` is also the Data profile's `remove key … from`
 * (`spec/grammar.md:115`). The operands the phrase elides are a dict and a word/number key
 * (`spec/data-structures.md:268`).
 *
 * There is deliberately no `canonical` column. The four form heads each map onto a Core WORD
 * (`make` → `set`, `to` → `define`, `output`/`op` → `return`), which is what lets
 * {@link canonicalOfHeritageFormHead} hand a caller a canonical spelling for a diagnostic param.
 * This reader's Core equivalent is the `[]`/`.` selector *syntax* — `:d["k"]`, `:d.k`
 * (`spec/data-structures.md:265-268`) — not a word, so there is no canonical spelling to report and
 * inventing one would name something absent from the diagnostic's own span. That is exactly why
 * `checker-heritage-form.ts` gives this form's rejection no `did you mean`, and why the form must
 * live in its own table rather than being forced into the head→canonical map.
 *
 * Each entry is frozen at RUNTIME, not merely `as const` at the type level:
 * {@link heritageWordedForm} hands the entry object straight to callers rather than copying it, so
 * an unfrozen entry would let one consumer mutate the head every other consumer reads — which is
 * precisely the single-source-of-truth guarantee this table exists to provide.
 */
const HERITAGE_WORDED_FORMS = {
  "value-of-reader": Object.freeze({
    head: "value",
    phrase: "value of … for key",
    node: "ValueOfKey",
  }),
} as const satisfies Record<
  string,
  { head: string; phrase: string; node: NodeKind }
>;

/**
 * One of the Heritage worded forms, named by its grammar production — the keys of
 * {@link HERITAGE_WORDED_FORMS}.
 */
export type HeritageWordedFormName = keyof typeof HERITAGE_WORDED_FORMS;

/** A Heritage worded form's head word and full phrase. */
export type HeritageWordedForm =
  (typeof HERITAGE_WORDED_FORMS)[HeritageWordedFormName];

/**
 * A Heritage worded form, by its grammar production name, as a **literal type**:
 * `heritageWordedForm("value-of-reader").head` is typed `"value"`, not `string`. That is the same
 * device {@link canonicalOfHeritageFormHead} uses, and it is what lets `checker-heritage-form.ts`
 * span and report the reader's head word without keeping a second copy of the string beside the
 * registry the guards match against (issue #755).
 */
export function heritageWordedForm<Name extends HeritageWordedFormName>(
  name: Name,
): (typeof HERITAGE_WORDED_FORMS)[Name] {
  return HERITAGE_WORDED_FORMS[name];
}

/**
 * The worded-form table itself, frozen. Unlike the entry freezes above this guards nothing an
 * external caller could do — the table is module-private and only {@link heritageWordedForm}'s
 * return value escapes — so it is defence against an accidental mutation inside this module, and
 * no test asserts it.
 */
Object.freeze(HERITAGE_WORDED_FORMS);

/**
 * Every Heritage worded form's grammar-production name, sorted for deterministic iteration — the
 * enumerable counterpart of {@link heritageWordedForm}. A guard that must prove each FORM is
 * covered (rather than merely its head word, which any program may contain by accident) iterates
 * these and looks each one up.
 */
const HERITAGE_WORDED_FORM_NAMES: readonly HeritageWordedFormName[] =
  Object.freeze(
    (Object.keys(HERITAGE_WORDED_FORMS) as HeritageWordedFormName[]).sort(),
  );

/** The full list of Heritage worded-form production names, in sorted order. */
export function heritageWordedFormNames(): readonly HeritageWordedFormName[] {
  return HERITAGE_WORDED_FORM_NAMES;
}

/**
 * Every Heritage worded form, sorted by production name for deterministic iteration. The
 * enumerable counterpart of {@link heritageFormHeadNames} for the multi-word spellings, so a
 * consumer that must name the form to a learner has the phrase without restating it.
 */
const HERITAGE_WORDED_FORM_ENTRIES: readonly HeritageWordedForm[] =
  Object.freeze(
    HERITAGE_WORDED_FORM_NAMES.map((name) => HERITAGE_WORDED_FORMS[name]),
  );

/** The full list of Heritage worded forms. See {@link HERITAGE_WORDED_FORM_ENTRIES}. */
export function heritageWordedForms(): readonly HeritageWordedForm[] {
  return HERITAGE_WORDED_FORM_ENTRIES;
}

/**
 * Every Heritage worded form's head word, sorted for deterministic iteration. This is the part of
 * a worded form that can reach a diagnostic's structured params — `checker-heritage-form.ts` emits
 * exactly this word as the `ol-unknown-command` `name` when Heritage is inactive — so it is what
 * {@link HERITAGE_SURFACE_SPELLINGS} carries on the form's behalf.
 */
const HERITAGE_WORDED_FORM_HEADS: readonly string[] = Object.freeze(
  HERITAGE_WORDED_FORM_ENTRIES.map((form) => form.head).sort(),
);

/** The full list of Heritage worded-form head words, in sorted order. */
export function heritageWordedFormHeads(): readonly string[] {
  return HERITAGE_WORDED_FORM_HEADS;
}

/**
 * Every surface WORD that identifies a Heritage-only FORM — the short command/reporter aliases
 * ({@link heritageAliasNames}), the form heads ({@link heritageFormHeadNames}), and the worded
 * forms' heads ({@link heritageWordedFormHeads}) — sorted for deterministic iteration.
 *
 * Read "identifies" precisely: these are the words a learner writes to make the reader take a
 * Heritage spelling rather than a Core one. Several of them are ALSO ordinary Core vocabulary in
 * some other position, so this is not a list of Heritage-exclusive tokens: `to` is the preposition
 * of Core's `set … to` and the bound of `for … from … to` (`spec/grammar.md:104,128`) as well as
 * the Heritage procedure opener, and the worded reader's head `value` is a globally reserved word
 * (`spec/grammar.md:358`). What each entry has in common is that a diagnostic naming it would be
 * naming the learner's Heritage spelling of a condition their Core twin raises identically.
 *
 * This is the enumerable definition of "a Heritage surface spelling", and it exists so the
 * canonical-diagnostic-params guards (`heritage-canonical-diagnostic-params.test.mjs` in
 * `@openlogo/parser` for the parse/semantic stages, issue #737, and in `@openlogo/runtime` for the
 * runtime stage, issue #741) are driven by the registry instead of a hand-kept list: a future slice
 * that adds a Heritage spelling to any of the three tables is automatically pulled into both
 * guards, so the class of bug where a surface spelling leaks into a diagnostic's structured params
 * is much harder to reintroduce unnoticed.
 *
 * A spelling here is a WORD, which is why {@link HERITAGE_WORDED_FORMS} contributes its head
 * rather than its phrase: a leak is a string sitting in a param, and the guards match whole words
 * against rendered param values. The three tables together cover every spelling
 * `spec/conformance.md:146-157`'s Heritage inventory writes in code formatting (issue #755) — an
 * agreement the parser guard asserts against the spec file itself, rather than by restating it
 * here. Before #755 these were the single-word tables only, and this comment nevertheless claimed a
 * completeness the worded reader disproved.
 */
const HERITAGE_SURFACE_SPELLINGS: readonly string[] = Object.freeze(
  [
    ...HERITAGE_ALIAS_NAMES,
    ...HERITAGE_FORM_HEAD_NAMES,
    ...HERITAGE_WORDED_FORM_HEADS,
  ].sort(),
);

/** The full list of Heritage-only surface spellings. See {@link HERITAGE_SURFACE_SPELLINGS}. */
export function heritageSurfaceSpellings(): readonly string[] {
  return HERITAGE_SURFACE_SPELLINGS;
}

/**
 * The default (bare-call) arity a Heritage short alias groups its arguments by, or `undefined` when
 * `name` is not a Heritage short alias. Because Heritage adds no semantics, this is exactly the
 * canonical command's own default arity ({@link primitiveArity} of the resolved Core name) — the
 * alias never carries a second arity number of its own. The reader consults it (via
 * {@link primitiveArity}) so `fd 100` groups one argument exactly as `forward 100` does and `pr :x`
 * groups one exactly as `print :x` does.
 */
export function heritageAliasArity(name: string): number | undefined {
  const canonical = canonicalOfHeritageAlias(name);
  return canonical === undefined ? undefined : primitiveArity(canonical);
}

/**
 * The inclusive input-count range a Heritage short alias accepts, or `undefined` when `name` is not
 * a Heritage short alias — exactly the resolved canonical command's own range, so the static arity
 * checker treats `pr` like `print` (its `(pr …)` form is an open variadic) and `fd` like `forward`
 * (a turtle primitive with no static range, left to the runtime arity check). Only `print` among
 * the ten canonicals has a Core static range; the turtle canonicals return `undefined` here just as
 * they do through {@link corePrimitiveArityRange}, so the checker leaves their arity to the runtime.
 */
export function heritageAliasArityRange(
  name: string,
): { readonly min: number; readonly max: number } | undefined {
  const canonical = canonicalOfHeritageAlias(name);
  return canonical === undefined
    ? undefined
    : corePrimitiveArityRange(canonical);
}

/**
 * Every profile's primitive-arity table the reader consults, in lookup order. Core Language is
 * checked first (today's only always-visible table), then each optional profile's Core-spelled
 * primitives as they are registered — currently Turtle & Rendering, Data, Educational, Geometry,
 * Interaction & Events, Sound, and Sprites. A later profile slice adds its table here rather than editing
 * {@link primitiveArity}'s body. Heritage short aliases are deliberately NOT a table here: they
 * carry no arity of their own — {@link heritageAliasArity} resolves the alias to its canonical and
 * reads that canonical's arity from these very tables, so there is never a duplicate arity number.
 */
const PROFILE_PRIMITIVE_ARITY_TABLES: readonly ReadonlyMap<string, number>[] = [
  CORE_PRIMITIVE_ARITY,
  TURTLE_PRIMITIVE_ARITY,
  DATA_PRIMITIVE_ARITY,
  EDUCATIONAL_PRIMITIVE_ARITY,
  GEOMETRY_PRIMITIVE_ARITY,
  INTERACTION_PRIMITIVE_ARITY,
  SOUND_PRIMITIVE_ARITY,
  SPRITES_PRIMITIVE_ARITY,
];

/**
 * The default arity of any registered primitive — Core or an optional profile's Core-spelled
 * primitives — or `undefined` when `name` matches none of them. This is the reader's single
 * lookup (`parser.ts`'s `arityOf`): the reader has no notion of an "active profile" (that is a
 * Layer-2 checker concept, `spec/tooling.md:175-176`), so it must group a bare call's arguments
 * for *any* known primitive name, leaving the question of whether that primitive is legal under
 * the program's active profile set entirely to `check()`. Matching is case-insensitive.
 */
export function primitiveArity(name: string): number | undefined {
  const lower = name.toLowerCase();
  for (const table of PROFILE_PRIMITIVE_ARITY_TABLES) {
    const arity = table.get(lower);
    if (arity !== undefined) {
      return arity;
    }
  }
  return undefined;
}

/**
 * Every Core primitive's canonical lowercase name, sorted for deterministic iteration. This is
 * the enumerable counterpart to {@link corePrimitiveArity}: the checker's unknown-command rule
 * (issue #117) needs the full name *list* to build its did-you-mean candidate set, not just a
 * single-name arity lookup. Kept as a frozen array computed once so callers cannot mutate the
 * shared table.
 */
const CORE_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...CORE_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Core primitive names, in sorted order. See {@link CORE_PRIMITIVE_NAMES}. */
export function corePrimitiveNames(): readonly string[] {
  return CORE_PRIMITIVE_NAMES;
}

/**
 * Core primitives whose parenthesized call form accepts more inputs than their bare default
 * arity, keyed by canonical lowercase name to the maximum the paren form accepts
 * (`Number.POSITIVE_INFINITY` for an open variadic). Derived from the signatures in
 * [`spec/commands.md`](../../../spec/commands.md): `(print …)`, `(word …)`, and `(sentence …)`
 * are open variadic, while `(random a b)` and `(randomize seed)` are bounded alternates. A
 * primitive absent here is strictly fixed-arity — its parenthesized form must supply exactly its
 * default count. The bare default arity stays {@link corePrimitiveArity}; the reader still groups
 * bare calls by that number and never consults this table.
 */
const CORE_PRIMITIVE_MAX_ARITY: ReadonlyMap<string, number> = new Map([
  ["print", Number.POSITIVE_INFINITY],
  ["word", Number.POSITIVE_INFINITY],
  ["sentence", Number.POSITIVE_INFINITY],
  ["random", 2],
  ["randomize", 1],
]);

/**
 * The inclusive input-count range a Core primitive accepts, or `undefined` when `name` is not a
 * known Core primitive. `min` is the bare default arity ({@link corePrimitiveArity}); `max` is the
 * most its parenthesized alternate/variadic form accepts ({@link CORE_PRIMITIVE_MAX_ARITY}) —
 * `Number.POSITIVE_INFINITY` for an open variadic, and equal to `min` for a strictly fixed-arity
 * primitive. The static arity checker (issue #111) uses this to tell a genuine variadic paren
 * form (`(print …)`) from a fixed-arity primitive given too many inputs (`(first 1 2)`). Matching
 * is case-insensitive.
 */
export function corePrimitiveArityRange(
  name: string,
): { readonly min: number; readonly max: number } | undefined {
  const min = corePrimitiveArity(name);
  if (min === undefined) {
    return undefined;
  }
  return { min, max: CORE_PRIMITIVE_MAX_ARITY.get(name.toLowerCase()) ?? min };
}

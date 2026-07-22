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
 * Every profile's primitive-arity table the reader consults, in lookup order. Core Language is
 * checked first (today's only always-visible table), then each optional profile's Core-spelled
 * primitives as they are registered — currently Turtle & Rendering, Data, Educational, and
 * Geometry. A later profile slice adds its table here rather than editing {@link primitiveArity}'s
 * body.
 */
const PROFILE_PRIMITIVE_ARITY_TABLES: readonly ReadonlyMap<string, number>[] = [
  CORE_PRIMITIVE_ARITY,
  TURTLE_PRIMITIVE_ARITY,
  DATA_PRIMITIVE_ARITY,
  EDUCATIONAL_PRIMITIVE_ARITY,
  GEOMETRY_PRIMITIVE_ARITY,
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

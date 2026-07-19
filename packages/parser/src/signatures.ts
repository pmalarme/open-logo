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
 * [`spec/commands.md`](../../../spec/commands.md). Only the canonical underscored names are
 * registered here — `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/`setxy`/`seth`/`setcolor`/
 * `setbg`/`setwidth` are **Heritage**-profile aliases (M5) and stay out of this table. Kept as a
 * separate table from {@link CORE_PRIMITIVE_ARITY} (rather than merged into it) because the two
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
  ["set_heading", 1],
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
  ["set_background", 1],
  ["set_width", 1],
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
 * Every profile's primitive-arity table the reader consults, in lookup order. Core Language is
 * checked first (today's only always-visible table), then each optional profile's Core-spelled
 * primitives as they are registered — currently just Turtle & Rendering. A later profile slice
 * adds its table here rather than editing {@link primitiveArity}'s body.
 */
const PROFILE_PRIMITIVE_ARITY_TABLES: readonly ReadonlyMap<string, number>[] = [
  CORE_PRIMITIVE_ARITY,
  TURTLE_PRIMITIVE_ARITY,
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

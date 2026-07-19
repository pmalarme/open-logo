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
  ["reverse", 1],
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

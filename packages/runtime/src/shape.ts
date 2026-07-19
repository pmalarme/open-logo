/**
 * Shape-value validation for `set_shape` (issue #210), per `spec/rendering.md`'s "Turtle avatar
 * and shapes" section: an implementation MUST support the default shape and SHOULD support the
 * portable set `"turtle"`, `"triangle"`, `"arrow"`, `"circle"` — an open, implementation-defined
 * set (MAY support more), not a closed enumerable palette the way `set_color`'s colors are
 * (`spec/commands.md`'s `set_shape` entry: "Possible errors: none specified in C3 beyond general
 * type and arity diagnostics"). Because the set is open, an unrecognized shape word is reported
 * as `ol-type` with `expected: "shape"` (an `ol-type` *identity* distinct from a non-word
 * argument's `expected: "word"`, since `error-model.md` treats `params` as part of a diagnostic's
 * identity) rather than a dedicated `ol-bad-shape` code — there is no closed set to enumerate a
 * `value` against the way `ol-bad-color` does.
 *
 * Deliberately runtime-local rather than importing `@openlogo/turtle`'s own shape handling: the
 * runtime package must not depend on `@openlogo/turtle` (same package-boundary rule
 * `packages/runtime/src/color.ts` documents).
 */

/**
 * The portable shape set every implementation SHOULD support (`spec/rendering.md`'s "Turtle
 * avatar and shapes" section), lowercase. `"turtle"` is also the default
 * (`createDefaultTurtleState`'s `shape: "turtle"`, matching `@openlogo/turtle`'s
 * `INITIAL_TURTLE_STATE.shape`).
 */
const RECOGNIZED_SHAPES: ReadonlySet<string> = new Set([
  "turtle",
  "triangle",
  "arrow",
  "circle",
]);

/**
 * Is `shape` (already confirmed to be a word/string) one of the recognized `set_shape` shapes?
 * Matching is case-insensitive, mirroring {@link import("./color.js").normalizeColor}'s named
 * colors — the canonical stored/reported form is always lowercase.
 */
export function isRecognizedShape(shape: string): boolean {
  return RECOGNIZED_SHAPES.has(shape.toLowerCase());
}

/**
 * Normalize a confirmed-recognized shape word to its canonical lowercase form. Callers must check
 * {@link isRecognizedShape} first — this does not itself validate.
 */
export function normalizeShape(shape: string): string {
  return shape.toLowerCase();
}

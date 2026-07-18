/**
 * The OpenLogo value/type model — the runtime representation of the four Core v0.1 types
 * (`number`, `word`, `list`, `boolean`), per
 * [`spec/execution-model.md`](../../../spec/execution-model.md)'s "Value and type model"
 * section. `dict`/`record`/`turtle` are later profiles and are not modeled here yet. Kept in
 * `@openlogo/core` since every package that evaluates or displays a value (runtime, turtle,
 * studio, edu) needs the same representation and the same `ol-*` `expected`/`actual` type
 * names for diagnostics.
 *
 * Representation choices: a `number` is a JS `number` (IEEE-754 double, matching the spec
 * exactly); a `word` is a JS `string` (quotes already stripped by the reader); a `boolean` is a
 * JS `boolean`; a `list` is a JS array of `OLValue`. There is no wrapper/tag — the JS `typeof`
 * (plus `Array.isArray`) already distinguishes the four Core types unambiguously.
 */

/** A runtime value for one of the four Core v0.1 types. */
export type OLValue = number | string | boolean | readonly OLValue[];

/** The learner-facing concept name for a Core type, as `ol-type`'s `expected`/`actual` params use. */
export type OLTypeName = "number" | "word" | "list" | "boolean";

/** The {@link OLTypeName} of a runtime value, for `ol-type` diagnostic params. */
export function typeNameOf(value: OLValue): OLTypeName {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "string") {
    return "word";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  return "list";
}

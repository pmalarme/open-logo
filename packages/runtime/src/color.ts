/**
 * Color-value validation and normalization for `set_color`/`set_background` (and their
 * `setcolor`/`setbg` Turtle & Rendering aliases, issue #208), per `spec/commands.md`'s "Colors"
 * section: a color argument is exactly one of a named color word from the normative 11-color
 * palette, an `[r g b]` list of three numbers each `0` through `255`, or a `"#rrggbb"` hex word.
 * Anything else — an unknown word, a wrong-length or out-of-range-component list, or a malformed
 * hex word — is `ol-bad-color` (`spec/error-model.md:122`); the caller raises that diagnostic
 * whenever {@link normalizeColor} returns `undefined`.
 *
 * Deliberately runtime-local rather than importing `@openlogo/turtle`'s own color handling: the
 * runtime package must not depend on `@openlogo/turtle` (the package-boundary rule this issue's
 * write-set is scoped to). `@openlogo/turtle`'s renderer performs its own sRGB normalization from
 * whatever canonical string this module returns (`spec/rendering.md`'s "Color" section:
 * "Implementations MUST normalize each accepted color to an sRGB color before rendering or
 * export") — this module only validates the three accepted *forms* and produces a stable,
 * renderer-parseable string; it does not itself need to compute sRGB.
 */

import type { OLValue } from "@openlogo/core";

/**
 * The normative named-color palette (`spec/commands.md`'s "Colors" section), lowercase. Matching
 * is case-insensitive (see {@link normalizeColor}); the canonical stored/reported form is always
 * lowercase, matching `createDefaultTurtleState`'s own default `color: "black"`.
 */
const NAMED_COLORS: ReadonlySet<string> = new Set([
  "black",
  "white",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "brown",
  "gray",
]);

/** A `"#rrggbb"` hex word: exactly `#` followed by six hex digits, case-insensitive. */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * Validate `value` as a `set_color`/`set_background` color argument and normalize it to a stable,
 * renderer-parseable string: the palette word itself (lowercased), the hex word (lowercased), or
 * a CSS-style `rgb(r, g, b)` string for an `[r g b]` list. Returns `undefined` when `value` is not
 * one of the three accepted forms — including a value of the wrong OpenLogo type entirely, such as
 * a bare number or boolean — so the caller can raise `ol-bad-color`.
 */
export function normalizeColor(value: OLValue): string | undefined {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return NAMED_COLORS.has(lower) || HEX_COLOR_PATTERN.test(lower)
      ? lower
      : undefined;
  }
  if (Array.isArray(value)) {
    if (value.length !== 3) {
      return undefined;
    }
    const components: number[] = [];
    for (const component of value) {
      if (
        typeof component !== "number" ||
        !Number.isFinite(component) ||
        component < 0 ||
        component > 255
      ) {
        return undefined;
      }
      components.push(component);
    }
    const [r, g, b] = components as [number, number, number];
    return `rgb(${r}, ${g}, ${b})`;
  }
  return undefined;
}

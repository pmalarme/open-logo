/**
 * The OpenLogo value/type model — the runtime representation of the four Core v0.1 types
 * (`number`, `word`, `list`, `boolean`) plus the Data-profile `dict` type, per
 * [`spec/execution-model.md`](../../../spec/execution-model.md)'s "Value and type model"
 * section and [`spec/data-structures.md`](../../../spec/data-structures.md)'s dictionaries
 * section. `record`/`turtle` are later profiles and are not modeled here yet. Kept in
 * `@openlogo/core` since every package that evaluates or displays a value (runtime, turtle,
 * studio, edu) needs the same representation and the same `ol-*` `expected`/`actual` type
 * names for diagnostics.
 *
 * Representation choices: a `number` is a JS `number` (IEEE-754 double, matching the spec
 * exactly); a `word` is a JS `string` (quotes already stripped by the reader); a `boolean` is a
 * JS `boolean`; a `list` is a JS array of `OLValue`; a `dict` is an {@link OLDict}. There is no
 * wrapper/tag for the first four — the JS `typeof` (plus `Array.isArray`) already distinguishes
 * them unambiguously; `dict` is distinguished with `instanceof OLDict`.
 */

/** A legal dictionary key: words or numbers only (`spec/data-structures.md:143-153`). */
export type OLDictKey = string | number;

/** One live entry inside an {@link OLDict}: the original key plus its current value. */
interface OLDictEntry {
  readonly key: OLDictKey;
  value: OLValue;
}

/**
 * The Data-profile `dict` value (`spec/data-structures.md:143-250`): a mutable, insertion-ordered
 * key/value collection. Keys are words or numbers, compared under OpenLogo's number↔word equality
 * (`spec/execution-model.md:490-491`, e.g. `5` and `"5"` name the same slot, `5` and `"05"` do
 * not). {@link set} on an existing canonical key updates the stored value in place rather than
 * reinserting, so "last-duplicate-wins value, first-insertion-position iteration"
 * (`spec/data-structures.md:160-168`) falls directly out of the backing `Map`'s own
 * insertion-order guarantee. Assigning a dict copies the reference, not the contents
 * (`spec/execution-model.md:13-40`), same as a list.
 */
export class OLDict {
  private readonly entries = new Map<string, OLDictEntry>();

  /**
   * The canonical string a key collapses onto for lookup: a number canonicalizes to its printed
   * form (mirroring `@openlogo/runtime`'s `formatNumber`, duplicated here in miniature since
   * `@openlogo/core` cannot depend on `@openlogo/runtime`); a word is used as-is.
   */
  private static canonicalKey(key: OLDictKey): string {
    if (typeof key === "number") {
      return Number.isInteger(key)
        ? String(key)
        : String(Number(key.toPrecision(10)));
    }
    return key;
  }

  /** Whether `key` (a word or number) names an existing entry; gracefully `false` otherwise. */
  has(key: OLValue): boolean {
    if (typeof key !== "string" && typeof key !== "number") {
      return false;
    }
    return this.entries.has(OLDict.canonicalKey(key));
  }

  /** The value stored under `key`, or `undefined` if absent (including a wrong-typed key). */
  get(key: OLValue): OLValue | undefined {
    if (typeof key !== "string" && typeof key !== "number") {
      return undefined;
    }
    return this.entries.get(OLDict.canonicalKey(key))?.value;
  }

  /** Upsert `value` under `key`, preserving the first-insertion position on update. */
  set(key: OLDictKey, value: OLValue): void {
    const canonical = OLDict.canonicalKey(key);
    const existing = this.entries.get(canonical);
    if (existing !== undefined) {
      existing.value = value;
      return;
    }
    this.entries.set(canonical, { key, value });
  }

  /** Remove the entry named by `key`; reports whether an entry was actually removed. */
  delete(key: OLValue): boolean {
    if (typeof key !== "string" && typeof key !== "number") {
      return false;
    }
    return this.entries.delete(OLDict.canonicalKey(key));
  }

  /** Remove every entry. */
  clear(): void {
    this.entries.clear();
  }

  /** The number of entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Keys in insertion order, each in its original word-or-number form. */
  keys(): OLDictKey[] {
    return [...this.entries.values()].map((entry) => entry.key);
  }

  /** Values in the same insertion order as {@link keys}. */
  values(): OLValue[] {
    return [...this.entries.values()].map((entry) => entry.value);
  }
}

/** A runtime value for a Core v0.1 type or the Data-profile `dict` type. */
export type OLValue = number | string | boolean | readonly OLValue[] | OLDict;

/** The learner-facing concept name for a type, as `ol-type`'s `expected`/`actual` params use. */
export type OLTypeName = "number" | "word" | "list" | "boolean" | "dict";

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
  if (value instanceof OLDict) {
    return "dict";
  }
  return "list";
}

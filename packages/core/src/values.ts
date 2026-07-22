/**
 * The OpenLogo value/type model — the runtime representation of the four Core v0.1 types
 * (`number`, `word`, `list`, `boolean`) plus the Data-profile `dict` and `record` types, per
 * [`spec/execution-model.md`](../../../spec/execution-model.md)'s "Value and type model"
 * section and [`spec/data-structures.md`](../../../spec/data-structures.md)'s dictionaries and
 * records/structs sections. `turtle` is a later profile and is not modeled here yet. Kept in
 * `@openlogo/core` since every package that evaluates or displays a value (runtime, turtle,
 * studio, edu) needs the same representation and the same `ol-*` `expected`/`actual` type
 * names for diagnostics.
 *
 * Representation choices: a `number` is a JS `number` (IEEE-754 double, matching the spec
 * exactly); a `word` is a JS `string` (quotes already stripped by the reader); a `boolean` is a
 * JS `boolean`; a `list` is a JS array of `OLValue`; a `dict` is an {@link OLDict}; a `record` is
 * an {@link OLRecord}. There is no wrapper/tag for the first four — the JS `typeof` (plus
 * `Array.isArray`) already distinguishes them unambiguously; `dict` is distinguished with
 * `instanceof OLDict` and `record` with `instanceof OLRecord`.
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

/**
 * The Data-profile `record` value (`spec/data-structures.md:252-327`): a mutable aggregate whose
 * field set is FIXED at construction from its `struct` declaration. Unlike an {@link OLDict}, a
 * record can never grow or shrink — its fields are exactly the ones the `struct` declared, in
 * declared order, so writing an undeclared field is an error the runtime raises
 * (`ol-unknown-field`), never a silent insert. `type` is the struct type name the constructor was
 * named after: `type_of` reports it and `is_a?` matches against it (`spec/data-structures.md:
 * 286-287`). Assigning a record copies the reference, not the contents
 * (`spec/execution-model.md:13-40`), same as a list or dict — aliases observe in-place mutation.
 */
export class OLRecord {
  /** The struct type name this record was constructed from (`type_of`/`is_a?` read it). */
  readonly type: string;
  private readonly slots: Map<string, OLValue>;

  /**
   * Build a record of struct type `type` binding each of `fields` (declared order) to the value
   * at the same index in `values`. The caller (the constructor dispatch in `@openlogo/runtime`)
   * has already checked that `values.length` equals the declared field count, so every field has
   * a value.
   */
  constructor(
    type: string,
    fields: readonly string[],
    values: readonly OLValue[],
  ) {
    this.type = type;
    this.slots = new Map(
      fields.map((field, index) => [field, values[index] as OLValue]),
    );
  }

  /** Whether `field` is one of this record's fixed, declared fields. */
  has(field: string): boolean {
    return this.slots.has(field);
  }

  /** The value stored in `field`, or `undefined` when `field` is not a declared field. */
  get(field: string): OLValue | undefined {
    return this.slots.get(field);
  }

  /**
   * Write `value` into `field` in place. The caller must have confirmed `field` is declared (via
   * {@link has}) — a record's field set is fixed, so this never creates a new field.
   */
  set(field: string, value: OLValue): void {
    this.slots.set(field, value);
  }

  /** The record's field names, in declared order. */
  fields(): string[] {
    return [...this.slots.keys()];
  }
}

/** A runtime value for a Core v0.1 type or the Data-profile `dict`/`record` types. */
export type OLValue =
  number | string | boolean | readonly OLValue[] | OLDict | OLRecord;

/** The learner-facing concept name for a type, as `ol-type`'s `expected`/`actual` params use. */
export type OLTypeName =
  "number" | "word" | "list" | "boolean" | "dict" | "record";

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
  if (value instanceof OLRecord) {
    return "record";
  }
  return "list";
}

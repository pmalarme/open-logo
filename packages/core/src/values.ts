/**
 * The OpenLogo value/type model — the runtime representation of the four Core v0.1 types
 * (`number`, `word`, `list`, `boolean`) plus the Data-profile `dict` and `record` types, per
 * [`spec/execution-model.md`](../../../spec/execution-model.md)'s "Value and type model"
 * section and [`spec/data-structures.md`](../../../spec/data-structures.md)'s dictionaries and
 * records/structs sections. The Sprites-profile `turtle` value type ({@link OLTurtle}) is also
 * modeled here — it is a registered value kind like any other, so every package that evaluates or
 * displays a value shares one representation, but adding the type does NOT make the Sprites profile
 * claimable (`SUPPORTED_PROFILES` is unchanged; see `packages/core/src/host-metadata.ts`). Kept in
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
 * Pin a value class's backing collections to the objects its constructor made.
 *
 * The brand (`#brand`) proves an object is a genuine instance; it says nothing about what that
 * instance's properties currently hold. A subclass, or anything holding a reference, could swap
 * `entries` for a `Map` subclass whose `forEach` reports different contents than its `get` — and
 * `@openlogo/core`'s diagnostic de-duplicator reads those collections to tell two faults apart, so
 * a successful lie there is a **silently discarded diagnostic**, which is the failure that whole
 * encoding exists to prevent. `readonly` is erased at run time and stops nobody.
 *
 * Making the properties non-writable and non-configurable closes it at the source rather than at
 * every reader: the reference cannot be replaced or redefined after construction, so a reader that
 * has brand-checked knows the collection is the constructor's own. A subclass attempting the swap
 * now throws at construction (module code is strict), which is loud instead of silent. It also
 * makes the lie unrepresentable through a Proxy, because a `get` trap may not report a value other
 * than the target's for a non-writable, non-configurable own data property.
 *
 * The properties stay **enumerable**, deliberately: `structuredClone` copies enumerable own
 * properties and cannot see a `#private` field, and a diagnostic payload crossing the studio
 * worker's `postMessage` with its contents erased is the same silent collision by another route.
 * The collections' *contents* stay mutable — records and dicts are mutable values.
 */
function lockBackingData(target: object, names: readonly string[]): void {
  for (const name of names) {
    Object.defineProperty(target, name, {
      value: (target as Record<string, unknown>)[name],
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
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

  /** Unforgeable brand — see {@link OLDict.isGenuine}. */
  readonly #brand = true;

  constructor() {
    lockBackingData(this, ["entries"]);
  }

  /**
   * Is `value` a genuine instance, rather than a Proxy wearing one's prototype?
   *
   * A private field is keyed on the target object, so `#brand in proxy` is false even for a Proxy
   * whose target IS an `OLDict` — which `instanceof` cannot tell apart. The data itself lives in an
   * ordinary own property so `structuredClone` preserves it across a worker boundary; the brand is
   * what makes reading that property safe, and {@link lockBackingData} is what keeps the property
   * pointing at the collection this constructor made.
   */
  static isGenuine(value: unknown): boolean {
    return typeof value === "object" && value !== null && #brand in value;
  }

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
  /**
   * The declared field names, in declaration order and original spelling — `fields()` (and thus
   * `type_of`, destructuring, and the printed form) reports these, so a struct declared
   * `[ X Y ]` keeps its `X`/`Y` display while access folds case (below). Names that fold to the
   * same identifier are collapsed to their first spelling, so this list stays 1:1 with {@link
   * slots}: identifiers are case-insensitive (`spec/grammar.md:13`), so a declaration like
   * `[ x X ]` names one field, not two, and `fields()` must not report a phantom position that no
   * slot backs.
   */
  private readonly declaredFields: readonly string[];
  /**
   * Field values keyed by the case-folded field name. Identifiers are case-insensitive
   * (`spec/grammar.md:13`), so `.x`, `.X`, and `.x` all address one slot; the folded key is the
   * single canonical form the accessors resolve against.
   */
  private readonly slots: Map<string, OLValue>;

  /** Unforgeable brand — see {@link OLRecord.isGenuine}. */
  readonly #brand = true;

  /** Is `value` a genuine instance? See {@link OLDict.isGenuine} for why `instanceof` is not enough. */
  static isGenuine(value: unknown): boolean {
    return typeof value === "object" && value !== null && #brand in value;
  }

  /**
   * Build a record of struct type `type` binding each of `fields` (declared order) to the value
   * at the same index in `values`. The caller (the constructor dispatch in `@openlogo/runtime`)
   * has already checked that `values.length` equals the declared field count, so every field has
   * a value. Field names are stored case-folded so access is case-insensitive
   * (`spec/grammar.md:13`), while `declaredFields` preserves their original spelling for display.
   * Because identifiers fold, two declared names that differ only in case denote one field: the
   * folded `slots` map and the deduplicated `declaredFields` both keep the last value / first
   * spelling for such a collision, so the two views never disagree on the field count.
   */
  constructor(
    type: string,
    fields: readonly string[],
    values: readonly OLValue[],
  ) {
    this.type = type;
    const declaredFields: string[] = [];
    const seen = new Set<string>();
    for (const field of fields) {
      const key = field.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        declaredFields.push(field);
      }
    }
    this.declaredFields = declaredFields;
    this.slots = new Map(
      fields.map((field, index) => [
        field.toLowerCase(),
        values[index] as OLValue,
      ]),
    );
    lockBackingData(this, ["type", "declaredFields", "slots"]);
  }

  /** Whether `field` is one of this record's fixed, declared fields (case-insensitive). */
  has(field: string): boolean {
    return this.slots.has(field.toLowerCase());
  }

  /** The value stored in `field`, or `undefined` when `field` is not a declared field. */
  get(field: string): OLValue | undefined {
    return this.slots.get(field.toLowerCase());
  }

  /**
   * Write `value` into `field` in place. The caller must have confirmed `field` is declared (via
   * {@link has}) — a record's field set is fixed, so this never creates a new field. The lookup
   * folds case (`spec/grammar.md:13`), so `:p.X = …` mutates the same slot `:p.x` reads.
   */
  set(field: string, value: OLValue): void {
    this.slots.set(field.toLowerCase(), value);
  }

  /** The record's field names, in declared order and original spelling. */
  fields(): string[] {
    return [...this.declaredFields];
  }
}

/**
 * The Sprites-profile `turtle` value type (`spec/turtles-and-sprites.md:13`,
 * `spec/execution-model.md:25`): a mutable turtle identity with its own drawing state. Turtle
 * values **compare by identity, not by position or shape** (`spec/execution-model.md:540` — the
 * turtle row of the `==` matrix is "Same turtle identity"), so two turtles created by `new_turtle`
 * are never `==` even when their state is identical, and a turtle equals only the same turtle.
 *
 * That identity is the stable {@link id}, **not** the JS instance. Every distinct turtle has a
 * distinct id and each turtle keeps its id for its whole life, so id-equality gives exactly
 * "same turtle" — while being immune to the natural trap that reference identity would create: a
 * turtle value flows to the program through several routes (`new_turtle`, `who`, `turtles`,
 * `ask`/`each` binding, an effect-event payload, a snapshot round-trip), and a downstream slice
 * that builds a fresh `OLTurtle` wrapper for one of those routes (e.g. `turtles` materializing its
 * list) must not thereby make `who == :friend` report `false`. Comparing by id makes that interning
 * invariant hold **by construction**, so no slice has to know how instances are allocated to get
 * equality right. Implementations SHOULD still intern one instance per live turtle where practical,
 * but correctness of `==` does not depend on it. The id is also the `turtle-id` of turtle-specific
 * trace events, so a value and its events correlate on the same key.
 *
 * This slice models only the value's *identity* and its display; the per-turtle drawing state
 * (position, heading, pen, color, width, visibility, shape) lives in `@openlogo/turtle`/
 * `@openlogo/runtime` and is filled in by the Sprites command slices (#673 onward). Adding the type
 * here does not add any sprite command and does not make the Sprites profile claimable.
 */
export class OLTurtle {
  /**
   * The turtle's stable, per-world serial number: assigned once at creation, never reassigned,
   * unique across the world's turtles. It **is** the turtle's identity for `==`
   * (`spec/execution-model.md:540`) — two turtle values are the same turtle exactly when their ids
   * are equal — and doubles as the `turtle-id` of turtle-specific trace events and the token in the
   * deterministic printed form ({@link printedForm} renders `turtle #<id>`). Allocating ids so they
   * stay unique and stable per turtle is the `new_turtle`/world slice's responsibility (#673):
   * because the id now **is** identity, a duplicate id silently merges two turtles into one and an
   * unstable id silently splits one turtle into two, so #673 must guarantee ids are unique, stable
   * for a turtle's whole life, and deterministic (including a reserved id for the main turtle).
   */
  readonly id: number;

  constructor(id: number) {
    this.id = id;
  }
}

/** A runtime value for a Core v0.1 type, the Data-profile `dict`/`record`, or a Sprites `turtle`. */
export type OLValue =
  number | string | boolean | readonly OLValue[] | OLDict | OLRecord | OLTurtle;

/** The learner-facing concept name for a type, as `ol-type`'s `expected`/`actual` params use. */
export type OLTypeName =
  "number" | "word" | "list" | "boolean" | "dict" | "record" | "turtle";

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
  if (value instanceof OLTurtle) {
    return "turtle";
  }
  return "list";
}

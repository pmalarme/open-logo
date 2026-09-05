/**
 * The `ol-*` diagnostic contract — the normative shape every OpenLogo finding takes, plus
 * the stable code registry. Owned by `@openlogo/core`; parser and runtime emit these, and
 * studio, tests, and the tutor consume them. Never throw bare strings or invent an `ol-*`
 * code in implementation code — the namespace is reserved by
 * [`spec/error-model.md`](../../../spec/error-model.md); a genuinely new code is a
 * maintainer-owned spec change.
 */

import type { SourceSpan } from "./spans.js";
import { OLDict, OLRecord, OLTurtle } from "./values.js";

/**
 * The normative `ol-*` error/semantic/runtime code registry from `spec/error-model.md`.
 * Kept as data (`as const`) so tooling can enumerate it and {@link DiagnosticCode} derives
 * from it — one source of truth, no scattered string literals.
 */
export const OL_DIAGNOSTIC_CODES = [
  "ol-unknown-command",
  "ol-not-enough-inputs",
  "ol-too-many-inputs",
  "ol-type",
  "ol-range",
  "ol-undefined-var",
  "ol-unmatched-bracket",
  "ol-unmatched-brace",
  "ol-unmatched-paren",
  "ol-missing-end",
  "ol-mismatched-end",
  "ol-unclosed-comment",
  "ol-unclosed-string",
  "ol-bad-token",
  "ol-div-zero",
  "ol-neg-sqrt",
  "ol-tan-undefined",
  "ol-no-output",
  "ol-no-value",
  "ol-return-outside-proc",
  "ol-return-in-comprehension",
  "ol-duplicate-binder",
  "ol-stop-outside-proc",
  "ol-repcount-outside-repeat",
  "ol-limit",
  "ol-user-error",
  "ol-not-boolean",
  "ol-bad-color",
  "ol-reserved-word",
  "ol-duplicate-definition",
  "ol-unknown-type",
  "ol-unknown-field",
  "ol-unknown-key",
  "ol-not-a-place",
  "ol-not-implemented",
] as const;

/** A stable `ol-*` diagnostic code from the normative registry. */
export type DiagnosticCode = (typeof OL_DIAGNOSTIC_CODES)[number];

/**
 * Style-lint codes. These reuse the diagnostic shape with `severity: "warning"` and MUST
 * NOT change program meaning. `spec/tooling.md:243-256` registers 14 `ol-style-*` codes; issue
 * #115 slice 1 wired `ol-style-useless-value`, `ol-style-equality-confusion`, and
 * `ol-style-name-case`; #169 slice 2a added `ol-style-magic-number` and
 * `ol-style-predicate-name`; slice 2b (this one) adds the layout group —
 * `ol-style-one-command-per-line`, `ol-style-deep-nesting`, `ol-style-block-indentation`, and
 * `ol-style-prefer-block` — the remaining four (`ol-style-full-name`, `ol-style-procedure-name`,
 * `ol-style-comment-style`, `ol-style-hidden-abstraction`) are tracked in the #169 follow-up
 * issue.
 *
 * Issue #828 adds `ol-style-nested-handler`, the first code in this family that is not sourced
 * from `spec/style-guide.md`: it comes from the #828 ruling, which pairs the runtime's instruction
 * budget (the guard that *bounds* unbounded handler accumulation) with a check-time lint that
 * *teaches* why it happens. The budget catches; the lint explains. Registered normatively in
 * `spec/tooling.md`'s "Layer 3: style lints" table alongside the other codes.
 */
export const OL_STYLE_DIAGNOSTIC_CODES = [
  "ol-style-useless-value",
  "ol-style-equality-confusion",
  "ol-style-name-case",
  "ol-style-magic-number",
  "ol-style-predicate-name",
  "ol-style-one-command-per-line",
  "ol-style-deep-nesting",
  "ol-style-block-indentation",
  "ol-style-prefer-block",
  "ol-style-nested-handler",
] as const;

/** A stable `ol-style-*` linter code. */
export type StyleDiagnosticCode = (typeof OL_STYLE_DIAGNOSTIC_CODES)[number];

/** When the finding was discovered: reading structure, understanding it, or running it. */
export type DiagnosticStage = "parse" | "semantic" | "runtime";

/** Errors stop execution; style warnings never change meaning. There is no `info`. */
export type DiagnosticSeverity = "error" | "warning";

/** Optional extra detail for `debug`, developer tools, and advanced learners. */
export interface DiagnosticDebug {
  /** Innermost call first. */
  readonly procedure_stack?: readonly string[];
  /** Observable state after the error was reported. */
  readonly state_after_error?: unknown;
}

/**
 * A single diagnostic. `code` + `params` are the identity; `message` is localizable prose
 * derived from them — tools MUST NOT parse the English message.
 */
export interface Diagnostic {
  /** Stable identity from {@link OL_DIAGNOSTIC_CODES} or an `ol-style-*` code. */
  readonly code: DiagnosticCode | StyleDiagnosticCode;
  /** The source location that best explains the finding. */
  readonly source_span: SourceSpan;
  /** Structured data used for identity, repair, telemetry, and localization. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Learner-facing prose generated from `code` and `params`. */
  readonly message: string;
  /** Parse, semantic, or runtime. */
  readonly stage: DiagnosticStage;
  /** Error or warning. */
  readonly severity: DiagnosticSeverity;
  /** Optional detail for tooling; off by default for learners. */
  readonly debug?: DiagnosticDebug;
}

/** Type guard: is `value` a registered `ol-*` diagnostic code? */
export function isDiagnosticCode(value: string): value is DiagnosticCode {
  return (OL_DIAGNOSTIC_CODES as readonly string[]).includes(value);
}

/**
 * The identity of one *fault*, as `spec/execution-model.md:741-748` defines it for the
 * de-duplication rule: `code` + `params` (diagnostic identity per `spec/error-model.md:255-260`)
 * plus `source_span` (the location). `message` is derived prose and `stage` is deliberately
 * **excluded** — the spec says outright that `stage` "records when the fault was found, not which
 * fault it is", so the same fault reported at `semantic` and again at `runtime` is one fault.
 *
 * `params` are serialized **canonically**: keys are sorted at every depth, so two findings carrying
 * the same entries in a different insertion order compare equal. Two rules can legitimately build
 * the same params object field-by-field in different orders, and an identity that depended on that
 * order would silently let the duplicate through. Sorting only the top level is not enough —
 * `ol-duplicate-definition`'s `original_span` is itself an object (a normative `params` entry,
 * `spec/error-model.md:144-147`), and two identical findings whose nested keys were inserted in
 * different orders were measured surviving as two.
 *
 * Beyond ordering, the encoding must be **injective**, **total**, and **cycle-safe**, and all three
 * fail in the same direction. A missed duplicate is merely visible — the learner reads the same
 * fault twice. A *collision* or a crash is silent or wrong: two different faults are judged one and
 * the second is discarded, or the de-duplicator itself throws and replaces the diagnostic a program
 * was owed. That is intolerable in the one component whose entire job is deciding which findings
 * survive. Three review rounds each found the previous encoding failing one of the three:
 *
 * - **Injective by construction.** Values are not rendered structurally: an object's sorted entry
 *   list is byte-identical to a literal array of the same pairs, and `params` carry both (an object
 *   in `original_span`, arrays in `expected`). Every value emits a **type tag**, and strings are
 *   **length-prefixed**, so no payload can be mistaken for a different shape's rendering.
 *   Type-tagging is what separates the number `NaN` from the word `"NaN"`, and `undefined` from the
 *   word `"undefined"` — a round that encoded special atoms *by name* made all four pairs collide,
 *   and its test compared the specials only against each other, never against their spellings.
 * - **`OLValue`s are read as own data properties, not through `Object.keys` and not through
 *   dispatch.** `OLDict` and `OLRecord` hold their contents in a `Map`, which `Object.keys` reports
 *   as empty — so every dict collapsed onto every other dict, and `ol-type {actual: {a: 1}}` and
 *   `{actual: {a: 2}}` at one span were one fault. Each collection is snapshotted **once**; asking
 *   `values()` per key rebuilt the whole collection per entry, which is quadratic (~280 ms at 8,000
 *   entries). A turtle is encoded by `id`: `spec/execution-model.md:552` requires two turtles to be
 *   `==` when they are the "Same turtle identity" but says nothing about how identity is
 *   represented — that `id` *is* the representation is {@link OLTurtle}'s own contract, not the
 *   spec's. (An earlier draft of this comment cited the spec for the second claim as well. It
 *   resolved and did not support it, which is the failure mode `npm run spec-citations` prints that
 *   it cannot see.)
 * - **Total, including deep, wide and cyclic values.** The traversal is **iterative over an explicit
 *   stack**, so it does not consume the host call stack — neither by depth (~1,500 nested lists once
 *   raised `RangeError`, surfacing as `ol-limit` in place of the `ol-type` the program was owed) nor
 *   by width (`push(...children)` passes every element as an argument and threw at ~150,000). A
 *   cycle is emitted as a back-reference to the depth of the value it revisits.
 *
 * The value **domain is bounded**, not universal. `params` is typed `Record<string, unknown>`, but
 * the values diagnostics actually carry are `OLValue`s, spans, words and numbers, and only those are
 * described structurally. Everything else — a `Symbol`, a function, a `Date`, a `Set`, an object with
 * a symbol key, a non-enumerable slot or an accessor — takes an **opaque per-instance identity**.
 * That is conservative in the safe direction: two *equal* exotic values false-split into two
 * findings rather than colliding. Both are deviations from `spec/execution-model.md:741-748`'s
 * "report such a fault once" — the difference is that a reader can see a split and nobody can see
 * a collision. Describing every host type structurally would be unbounded work, and reading
 * unknown objects through `Object.keys` was measured both colliding (symbol-keyed and
 * non-enumerable properties are invisible to it) and *throwing* (an enumerable getter that raises).
 *
 * A **plain `Map` with primitive keys** is the one exception, and the exception has a reason rather
 * than a convenience: it is what a `structuredClone`d dict or record arrives as. See the `Map` arm
 * in {@link describe} and the retraction below — the rule held and one membership claim did not.
 *
 * **Where this stops, stated rather than implied.** Every guard here is *reflective*, and
 * reflection has two blind spots no further guard can close. A `Proxy` answers its own traps, so a
 * value whose `get` says one thing and whose descriptor says another has no privileged reading —
 * and an object can hide state in a private slot that no reflection reports at all, behind a
 * prototype reset to something this encoder admits. Both were measured colliding. Neither is
 * reachable from an OpenLogo program **as specified for v0.1**: the language has no lambda and no
 * function values (`spec/execution-model.md:413`), and no reflection or `Proxy` — which the spec
 * does not mention at all, so that half is an inference from Core's enumeration being closed
 * rather than a citation. No production path in this tree constructs one either; the only
 * `Proxy`s here are adversarial fixtures in `dedupe-diagnostics.test.mjs`, and every one of them
 * lands opaque. The sound fix is a **trusted transport representation** at the worker boundary
 * rather than a further reflective test, which is a design change and not this slice's: issue
 * #1128. Adding another guard here would look like progress and close nothing. Note the v0.1
 * qualifier is load-bearing — a future host-object escape would make this disposition wrong, and
 * #1128 carries that.
 *
 * **The clone boundary, and why the data is NOT `#private`.** A private field is invisible to
 * `structuredClone`, so a `Diagnostic` crossing the studio worker's `postMessage` would arrive with
 * `{}` where a dict was. Measured with the data private: two records differing only in their
 * declared fields both cloned to `{"type":"p"}`, collided, and the screen-reader announcer stopped
 * reporting the change — a **silent** loss, and a regression against the pre-slice shape where
 * `declaredFields` was an ordinary property that clones natively. So the data stays in ordinary
 * properties, `#brand` carries the unforgeable part, and `lockBackingData` keeps the property
 * pointing at the collection the constructor made.
 *
 * A cloned value also loses its **prototype**, so it arrives as a plain object holding a bare
 * `Map` — and that is why `Map` has a structural arm here at all. Without one it took opaque
 * per-instance identity, so EVERY pair of cloned dict/record diagnostics split, including two runs
 * of the same program: a screen-reader user heard the same error again on every Run, and no such
 * diagnostic could be de-duplicated on the worker side at all. Both halves of the boundary are
 * measured in `a11y.test.mjs`, in both directions — announce on change, and only on change.
 */
/**
 * The guards, readers and **reflection primitives** this encoder trusts, captured at module load.
 *
 * Every one of these is a mutable slot at call time, and each was measured producing a collision
 * when left dynamic. `OLDict.isGenuine` is a writable static, so `OLDict.isGenuine = () => true`
 * admitted an `Object.create(OLDict.prototype)` with a lying `entries` and collapsed it onto a
 * genuine empty dict. `Map.prototype.forEach` is the same shape one level down: a `Map` subclass
 * overriding it reports contents its `get` contradicts. And `Object.getOwnPropertyDescriptor` is
 * the same shape one level down again — patching it to report an empty map made two genuine dicts
 * holding `1` and `2` collide, straight through every brand check above it.
 *
 * The pattern is what matters, not the instances: **capturing some of the chain leaves the rest of
 * it dynamic**, and the hardening is only as strong as its most reachable link. Three review rounds
 * running, a sentence here claimed the family was complete and a reviewer measured it short — by
 * three, then by one, then by one again. So the claim is no longer made in prose: the test
 * `"no intrinsic on the identity path is read dynamically"` **enumerates this file** and fails on
 * any dynamic read outside this block, including a `.call` on a captured function (which is itself
 * a mutable property of that function object — hence `Reflect.apply`). If you need to know what is
 * captured, read the list below; if you need to know that the list is complete, read that test.
 */
const dictIsGenuine = OLDict.isGenuine;
const recordIsGenuine = OLRecord.isGenuine;
const mapForEach = Map.prototype.forEach;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const ownDescriptors = Object.getOwnPropertyDescriptors;
const ownNames = Object.getOwnPropertyNames;
const ownSymbols = Object.getOwnPropertySymbols;
const prototypeOf = Object.getPrototypeOf;
const isArray = Array.isArray;
const objectKeys = Object.keys;
const sameValue = Object.is;
const isFiniteNumber = Number.isFinite;
const isIntegerNumber = Number.isInteger;
const registeredSymbolKey = Symbol.keyFor;
const sortStrings = Array.prototype.sort;
const applyFunction = Reflect.apply;
const toNumber = Number;
const toText = String;
const MapConstructor = Map;
const SetConstructor = Set;
const WeakMapConstructor = WeakMap;
const SymbolConstructor = Symbol;
const TypeErrorConstructor = TypeError;
const mapPrototype = Map.prototype;
const objectPrototype = Object.prototype;

/**
 * Snapshot a `Map`'s entries through the captured intrinsic, or throw.
 *
 * Throwing is the correct outcome for anything that is not a real `Map`: the sole caller treats it
 * as "cannot be described", which is opaque identity — a false split, never a collision.
 */
function mapEntrySnapshot(map: unknown): [unknown, unknown][] {
  const snapshot: [unknown, unknown][] = [];
  applyFunction(mapForEach, map as Map<unknown, unknown>, [
    (value: unknown, key: unknown) => {
      snapshot.push([key, value]);
    },
  ]);
  return snapshot;
}

/**
 * Does structural equality agree with `Map`'s own key comparison for this key?
 *
 * A `Map` compares keys by SameValueZero, which is **reference** identity for objects, functions
 * and symbols — while this encoder compares structurally. The two disagree exactly there, and the
 * disagreement is the silent direction: two maps keyed by *different* empty objects encode alike
 * (both keys describe as `obj0(`) although neither `has` the other's key. Measured, they collided.
 *
 * For every primitive the two agree, which covers the whole reason the `Map` arm exists — a cloned
 * dict keys its backing map by canonical strings, a cloned record by folded field names.
 */
function keyComparesStructurally(key: unknown): boolean {
  const kind = typeof key;
  return (
    key === null ||
    (kind !== "object" && kind !== "function" && kind !== "symbol")
  );
}

/** A string rendered so it cannot be confused with anything around it. */
function tagged(tag: string, text: string): string {
  return `${tag}${text.length}:${text}`;
}

/**
 * Per-instance identity for a value this encoder cannot describe structurally.
 *
 * A `Symbol`, a function, a `Date`, a `Set`, a `RegExp` — none is an `OLValue`, and `String()`
 * cannot tell two of them apart (`Symbol("x")` and a second `Symbol("x")` print the same) while
 * `Object.keys()` flattens them all to an empty object. Encoding them by their printed form
 * therefore *collided* them, which is the silent direction.
 *
 * They get an opaque serial number instead. That is deliberately **conservative**: two structurally
 * equal exotic values — two `Date(0)`s, say — become two findings rather than one. A false split is
 * visible and a collision is not, and no diagnostic this implementation raises carries such a
 * value, so the split costs nothing real. The alternative, describing every host type structurally,
 * is unbounded work for a domain with no members.
 *
 * `Map` **was** on that list and is not any more, because the domain turned out to have a member:
 * a `structuredClone`d dict or record arrives as a plain object holding a bare `Map`. See the
 * `Map` arm in {@link describe} — the general argument was right and the specific membership claim
 * was wrong, so the fix is to move the one member, not to abandon the rule. Only the shape that
 * member has moved: a `Map` with a subclass prototype, an own property, or an object key is still
 * opaque, because those carry state or reference semantics a structural encoding cannot represent.
 */
const opaqueIdentities = new WeakMapConstructor<WeakKey, number>();
let nextOpaqueIdentity = 0;

function opaqueIdentity(value: symbol | object): string {
  // A REGISTERED symbol cannot be a `WeakMap` key — `Symbol.for("x")` throws `TypeError: Invalid
  // value used as weak map key`. It is also globally identified by its key, so it needs no serial:
  // two `Symbol.for("x")` are the same symbol, and encoding them alike is correct rather than a
  // collision.
  if (typeof value === "symbol") {
    const registeredKey = registeredSymbolKey(value);
    if (registeredKey !== undefined) {
      return tagged("regsym", registeredKey);
    }
  }
  const existing = opaqueIdentities.get(value);
  if (existing !== undefined) {
    return `opq${existing};`;
  }
  nextOpaqueIdentity += 1;
  opaqueIdentities.set(value, nextOpaqueIdentity);
  return `opq${nextOpaqueIdentity};`;
}

/**
 * The own entries of `value` when they describe it **completely and safely**, or `undefined` when
 * it must be treated as opaque.
 *
 * Prototype alone is not enough, which three measurements showed: two objects differing only in a
 * **symbol-keyed** property collided, two differing only in a **non-enumerable** property collided,
 * and an object with a **throwing getter** made de-duplication itself throw. So a value is
 * structural only when every own property is an enumerable, string-keyed **data** property. Anything
 * else — an accessor, a symbol key, a non-enumerable slot — falls to opaque identity, which may
 * false-split but cannot collide or throw.
 */
function structuralEntries(value: object): [string, unknown][] | undefined {
  if (ownSymbols(value).length > 0) {
    return undefined;
  }
  const descriptors = ownDescriptors(value);
  const entries: [string, unknown][] = [];
  for (const key of applyFunction(sortStrings, objectKeys(descriptors), [])) {
    const descriptor = descriptors[key] as PropertyDescriptor;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      return undefined;
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

/**
 * Is `name` the **canonical** spelling of an array index?
 *
 * `/^\d+$/` is not the same question and was measured wrong: `"01"` matches it but is an ordinary
 * named property that no index walk ever visits, so two arrays differing only in `array["01"]`
 * collided. An index is a non-negative integer below `2^32 - 1` whose canonical decimal spelling is
 * the name itself.
 */
function isArrayIndexName(name: string): boolean {
  const index = toNumber(name);
  return (
    isIntegerNumber(index) &&
    index >= 0 &&
    index < 2 ** 32 - 1 &&
    toText(index) === name
  );
}

/**
 * The elements of `value` when its indices are plain data properties, or `undefined` when it
 * carries accessors or extra own properties and must be treated as opaque. Holes are reported as
 * {@link ARRAY_HOLE}.
 */
function arrayElements(value: readonly unknown[]): unknown[] | undefined {
  if (ownSymbols(value).length > 0) {
    return undefined;
  }
  for (const name of ownNames(value)) {
    if (name !== "length" && !isArrayIndexName(name)) {
      return undefined;
    }
  }
  const elements: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    // `index in value` distinguishes a hole from a stored `undefined`: `[, ]` and `[undefined]`
    // have the same length and the same element reads, and encoded alike they collided.
    if (!(index in value)) {
      elements.push(ARRAY_HOLE);
      continue;
    }
    const descriptor = ownDescriptor(value, index);
    if (descriptor === undefined || !("value" in descriptor)) {
      return undefined;
    }
    elements.push(descriptor.value);
  }
  return elements;
}

/** Marks an array hole, so `[, ]` and `[undefined]` do not encode alike. */
const ARRAY_HOLE = SymbolConstructor("array-hole");

/** The containers currently open on the walk, for cycle detection. */
interface OpenContainers {
  /** Depth of each open container, so a revisit is O(1) rather than a scan of the whole path. */
  readonly depthOf: Map<unknown, number>;
  /** The same containers in order, so closing one knows which to forget. */
  readonly stack: unknown[];
}

function canonicalize(value: unknown): string {
  const out: string[] = [];
  const open: OpenContainers = { depthOf: new MapConstructor(), stack: [] };
  /**
   * Explicit work stack. Each entry is either a one-element array holding the value to encode, or
   * `null` marking "the container opened here is finished". The wrapper array matters: a value to
   * encode may itself be `null`, and boxing keeps that from reading as the sentinel.
   */
  const work: (readonly [unknown] | null)[] = [[value]];

  while (work.length > 0) {
    const item = work.pop();
    if (item === undefined || item === null) {
      open.depthOf.delete(open.stack.pop());
      out.push(")");
      continue;
    }
    out.push(encodeAtomOrOpen(item[0], open, work));
  }
  return out.join("");
}

/**
 * Emit `value`'s encoding, pushing its children onto `work` when it is a container. Container
 * children are pushed in reverse so they are visited in order, with a `null` sentinel beneath them
 * to close the group and forget the container.
 *
 * Children are pushed one at a time. `push(...children)` passes every element as an argument and so
 * overflows the host stack on a *wide* value — measured at ~150,000 elements — which would be the
 * deep-nesting defect again through a different door.
 */
function encodeAtomOrOpen(
  value: unknown,
  open: OpenContainers,
  work: (readonly [unknown] | null)[],
): string {
  if (value === ARRAY_HOLE) {
    return "hole;";
  }
  const seenAt = open.depthOf.get(value);
  if (seenAt !== undefined) {
    return `cyc${seenAt};`;
  }
  switch (typeof value) {
    case "undefined":
      return "und;";
    case "boolean":
      return value ? "bool1;" : "bool0;";
    case "number":
      // `Object.is` separates -0 from 0, which `String()` renders identically.
      return tagged("num", sameValue(value, -0) ? "-0" : `${value}`);
    case "string":
      return tagged("str", value);
    case "bigint":
      return tagged("big", `${value}`);
    case "object":
      break;
    default:
      // symbol, function — printed forms collide, so identity is per-instance.
      return opaqueIdentity(value as WeakKey);
  }
  if (value === null) {
    return "nul;";
  }

  // EVERYTHING from here reflects on a host-supplied object, and reflection itself can raise: a
  // Proxy may throw from `ownKeys` or `getPrototypeOf`, an `OLDict` subclass may override `keys()`,
  // an `OLTurtle` subclass may give `id` a throwing accessor. `instanceof` admits all of them, so
  // the trusted-class exemption is trusted about the CLASS, not about the instance. One guard
  // closes the whole family: any failure to classify or snapshot a value means it cannot be
  // described, and a value that cannot be described gets an opaque identity — which is exactly what
  // the boundary already does for a `Date` or a `Set`. Patching the three known instances would
  // have left the fourth.
  let described: Described | undefined;
  try {
    described = describe(value);
  } catch {
    return opaqueIdentity(value);
  }
  if (described === undefined) {
    return opaqueIdentity(value);
  }
  if (described.kind === "atom") {
    return described.text;
  }

  open.depthOf.set(value, open.stack.length);
  open.stack.push(value);
  work.push(null);
  const { children } = described;
  for (let index = children.length - 1; index >= 0; index--) {
    work.push([children[index]]);
  }
  return described.head;
}

/** A value's structural description: complete in itself, or a container with children to visit. */
type Described =
  | { readonly kind: "atom"; readonly text: string }
  | {
      readonly kind: "container";
      readonly head: string;
      readonly children: readonly unknown[];
    };

/**
 * Classify `value` and snapshot its children, or return `undefined` when it has no structural
 * description. May throw — the sole caller treats that identically to `undefined`.
 *
 * **Trusted-class contents are read as own data properties, never through dispatch.** A guard that
 * only catches *throwing* overrides still trusts *lying* ones: an `OLDict` subclass whose `keys()`
 * returns `[]` was measured making two dicts with different contents into one fault, and a
 * populated liar collapse onto a genuinely empty dict — the silent discard this whole encoding
 * exists to prevent, reached through the one path the `try` cannot see, because misdescription
 * never raises. `instanceof` is likewise not proof of shape: `Symbol.hasInstance` can be trapped.
 * So each trusted arm first checks an unforgeable `#private` brand, then reads the backing state
 * through its own property descriptor — a hostile receiver fails the brand and a `get` trap never
 * runs. Nothing here depends on the instance behaving.
 */
function describe(value: object): Described | undefined {
  if (value instanceof OLTurtle) {
    // NOTE — `OLTurtle` is the third value class on this path and the only one with NO brand and no
    // locked backing property, so a Proxy wearing its prototype CAN lie about `id` and collapse two
    // different turtles into one fault. That is measured, pre-existing (it was unbranded at this
    // slice's merge-base too), and unreachable from an OpenLogo program — the language has no
    // lambda, no reflection and no way to construct a Proxy, so the attacker is already host JS
    // inside the realm. It is recorded here rather than left silent because two of three classes
    // being hardened reads as "all three are handled". Tracked by issue #1129; do not read the
    // absence of a brand here as a decision that one is unnecessary.
    const id = dataProperty(value, "id");
    // A turtle's identity is its id, so an id that is not a finite number identifies nothing —
    // `String()` rendered two `OLTurtle(NaN)` alike although `NaN !== NaN` makes them different
    // turtles, and collapsed id `1` onto the string `"1"`. Anything else is opaque.
    if (typeof id !== "number" || !isFiniteNumber(id)) {
      return undefined;
    }
    return { kind: "atom", text: `turtle${id};` };
  }
  const children: unknown[] = [];
  if (isArray(value)) {
    const elements = arrayElements(value);
    if (elements === undefined) {
      return undefined;
    }
    for (const element of elements) {
      children.push(element);
    }
    return { kind: "container", head: `arr${value.length}(`, children };
  }
  if (dictIsGenuine(value)) {
    // Read the OWN DATA PROPERTY, not a method and not a trapped read, and read the collection it
    // holds through a CAPTURED INTRINSIC rather than through dispatch. Three mutable slots sit on
    // this path and each was measured producing a collision: the instance's own `keys()`, the
    // static `OLDict.isGenuine`, and `Map.prototype.forEach` on the backing map. The brand proves
    // the object is genuine; `lockBackingData` proves the property still points at the map the
    // constructor made; the captured `forEach` proves the read reaches that map's internal slot.
    //
    // The data deliberately lives in an ordinary property rather than a `#private` one. A private
    // field is invisible to `structuredClone`, and a `Diagnostic` crossing the studio worker's
    // `postMessage` then arrives with `{}` where a dict was — two different dicts sharing an
    // identity, one silently discarded, in the accessibility path. Measured: with the data private,
    // two records differing only in their declared fields both cloned to `{"type":"p"}` and the
    // screen-reader announcer stopped reporting the change.
    //
    // The arm is ENTERED on the brand, not on `instanceof`. `instanceof` consults
    // `OLDict[Symbol.hasInstance]`. The inherited `Function.prototype[Symbol.hasInstance]` is
    // non-writable, but a class constructor is EXTENSIBLE, so `Object.defineProperty` installs a
    // shadowing own property — and shadowing it with `() => false` made two IDENTICAL dicts split,
    // because the value skipped this arm and took a per-reference opaque serial from the
    // plain-object arm — the same screen-reader regression the `Map` arm's own entry test was
    // changed to avoid, one binding over. The brand is unforgeable and total, so it is both the
    // entry test and the guard.
    const snapshot = mapEntrySnapshot(dataProperty(value, "entries"));
    for (const [canonicalKey, entry] of snapshot) {
      if (typeof entry !== "object" || entry === null) {
        return undefined;
      }
      // The CANONICAL KEY is encoded beside the payload, not discarded. It is the key `get()`
      // resolves against, so two dicts whose payloads match but whose backing keys differ answer
      // `get` differently while encoding alike — measured colliding. The payload's own `key` is
      // the original spelling and is a different fact, so both are part of the value.
      children.push(
        canonicalKey,
        dataProperty(entry, "key"),
        dataProperty(entry, "value"),
      );
    }
    return { kind: "container", head: `dict${snapshot.length}(`, children };
  }
  if (recordIsGenuine(value)) {
    // Entered on the brand rather than `instanceof`, for the reason given in the dict arm above.
    const type = dataProperty(value, "type");
    if (typeof type !== "string") {
      // Record type `1` and record type `"1"` are different types; `String()` made them one.
      return undefined;
    }
    const declared = dataProperty(value, "declaredFields");
    if (!isArray(declared)) {
      return undefined;
    }
    // The declared names go through the same array snapshot as any other array, so an array with
    // extra own properties or holes is described faithfully rather than by length alone.
    const declaredNames = arrayElements(declared);
    if (declaredNames === undefined) {
      return undefined;
    }
    // Encode EVERY slot, not just the declared ones. `set()` folds the key and writes
    // unconditionally, so a caller that skips `has()` leaves a slot no declared field names —
    // observable through `get()`, and invisible to an encoding that walks `declaredFields`. Two
    // records with the same declared fields and different hidden slots collided.
    const slots = mapEntrySnapshot(dataProperty(value, "slots"));
    for (const name of declaredNames) {
      children.push(name);
    }
    for (const [key, slot] of slots) {
      children.push(key, slot);
    }
    return {
      kind: "container",
      head: `rec${tagged("", type)}${declaredNames.length}/${slots.length}(`,
      children,
    };
  }
  if (prototypeOf(value) === mapPrototype) {
    // A `Map` is not an `OLValue`, and this arm was deliberately absent: exotic host types took
    // opaque identity because describing all of them is unbounded work "for a domain with no
    // members". That premise was FALSIFIED by measurement. `structuredClone` strips a prototype,
    // so an `OLDict` crossing the studio worker's `postMessage` arrives as a plain object holding
    // a bare `Map` — and every such value took a fresh serial. Two DIFFERENT cloned dicts split
    // (correct, by luck), but so did two IDENTICAL ones: re-running the same erroneous program
    // re-announced every diagnostic carrying a dict or record, so a screen-reader user heard the
    // same error again on every Run, and no such diagnostic could be de-duplicated at all on the
    // worker side. The domain has exactly one member and it is on the accessibility path.
    //
    // The arm is therefore admitted only for the shape that member actually has, because moving a
    // value OFF the opaque path trades a guaranteed false split for the possibility of a
    // collision. Three guards, and every one of them was measured colliding without it:
    //
    //   1. EXACT PROTOTYPE — a `Map` subclass carries state this encoding cannot see. This is now
    //      the ARM'S OWN TEST rather than a check inside it: the arm used to be entered on
    //      `value instanceof Map`, and `instanceof` consults `Map[Symbol.hasInstance]`. The
    //      inherited `Function.prototype` one is non-writable, but a constructor is EXTENSIBLE, so
    //      `Object.defineProperty` shadows it. Two reviewers measured that shadowing it with
    //      `() => false` made two IDENTICAL cloned dicts split — reinstating the exact
    //      accessibility regression this arm was added to fix. A `Map` subclass still lands
    //      opaque: it fails this test, then fails the plain-object arm's prototype test too.
    //   2. NO OWN PROPERTIES — `map.extra = "x"` is part of the value and was ignored.
    //      `arrayElements` rejects an array with a named own property for the same reason, and this
    //      arm shipped without the equivalent. Note the dict and record arms above do NOT guard
    //      this: two `OLDict`s (or `OLRecord`s) differing only in an extra own property were
    //      measured colliding, 1 survivor where there should be 2. That is INTRODUCED BY THIS
    //      SLICE. At the merge base nothing de-duplicated runtime diagnostics at all; the only
    //      `dedupeDiagnostics` was module-private in `parser.ts`, over parse-stage findings, and
    //      that file contained zero references to `OLDict`, so a dict never reached it.
    //      The merge-base boundary these values DID cross is studio's `diagnosticsKey`, which
    //      keyed on `JSON.stringify` — and there they collided far worse, because
    //      `JSON.stringify` cannot serialize a `Map`'s internal slots, so every dict rendered as
    //      `{"entries":{}}` whatever it held. (Not because the map was private:
    //      `private readonly entries` is TypeScript-only and erased at run time.) So this slice
    //      closed a collision that fired on every dict and opened a narrower one that fires only
    //      on extra own state. Deferring rests on reachability alone: no OpenLogo operation writes
    //      a named own property onto a host object, so no program can construct it. Tracked by
    //      #1133 — recorded here rather than left implied, because an earlier version of this line
    //      claimed every other container arm guarded it.
    //   3. PRIMITIVE KEYS ONLY — see `keyComparesStructurally`. A map keyed by objects has
    //      reference semantics that a structural encoding cannot represent.
    //
    // A cloned dict's or record's backing map satisfies all three (exact prototype, zero own
    // properties, string keys), so the clone path this arm exists for is untouched. Anything else
    // falls back to the opaque serial it had before, which is the safe direction.
    if (ownNames(value).length > 0 || ownSymbols(value).length > 0) {
      return undefined;
    }
    // Read through the captured intrinsic for the same reason the trusted classes do: a `Map`
    // subclass overriding `forEach` would otherwise misdescribe itself without raising.
    const snapshot = mapEntrySnapshot(value);
    for (const [key, entry] of snapshot) {
      if (!keyComparesStructurally(key)) {
        return undefined;
      }
      children.push(key, entry);
    }
    return { kind: "container", head: `map${snapshot.length}(`, children };
  }
  const prototype = prototypeOf(value);
  const entries =
    prototype === objectPrototype || prototype === null
      ? structuralEntries(value)
      : undefined;
  if (entries === undefined) {
    return undefined;
  }
  for (const [key, entry] of entries) {
    children.push(key, entry);
  }
  return { kind: "container", head: `obj${entries.length}(`, children };
}

/**
 * An own **data** property of `value`, returned RAW and read through its descriptor rather than
 * through a possibly-installed accessor. Throws when the slot is missing or is an accessor, which
 * the caller turns into opaque identity.
 *
 * It deliberately does not stringify. `String()` erased both type and equality: two `OLTurtle(NaN)`
 * rendered alike although `NaN !== NaN` makes them different turtles, turtle id `1` collapsed onto
 * the string `"1"`, and record type `1` onto `"1"`. Each caller validates the domain it expects.
 */
function dataProperty(value: object, name: string): unknown {
  const descriptor = ownDescriptor(value, name);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeErrorConstructor(`${name} is not a data property`);
  }
  return descriptor.value;
}

function faultIdentity(diagnostic: Diagnostic): string {
  // The whole `source_span` goes through `canonicalize` rather than being read field by field.
  // Reading `span.document` directly assumed a well-formed span and threw on one without it —
  // `dedupeDiagnostics` and `diagnosticIdentity` are public API, so a host's diagnostic (studio's
  // own a11y fixtures, for one) crashed the de-duplicator. The encoder is already total over
  // anything a host can supply; there is no reason for the span to be the one part that is not.
  return canonicalize([
    diagnostic.code,
    diagnostic.source_span,
    diagnostic.params,
  ]);
}

/**
 * The identity of one *fault* as a string, for callers that must tell two diagnostics apart
 * without re-deriving the rule.
 *
 * This is {@link dedupeDiagnostics}' own key, exported so nothing has to approximate it. Studio's
 * screen-reader announcer used `JSON.stringify(params)` for the same purpose, and it collided two
 * records of different shapes when the contents were behind `#private` fields: both serialized to
 * `{"type":"p"}`, so a genuinely changed diagnostic stopped being announced to an
 * assistive-technology user. ANY structural comparison of `params` carries that hazard; this one
 * reads values as own data properties and is total over what a host can put in `params`.
 *
 * Note the deliberate difference from a "has anything changed" key: **both `stage` and `severity`
 * are excluded**, because `spec/execution-model.md:741-745` defines a fault's identity as `code` +
 * `params` + `source_span` and nothing else — `stage` "records when the fault was found, not which
 * fault it is", and severity is a property of the code rather than of the occurrence. A caller that
 * must distinguish either compares it beside this; `packages/studio/src/a11y.ts` compares both.
 *
 * An earlier version of this doc argued the `stage` exclusion carefully and cited the spec for it,
 * while saying nothing about `severity` — so a next caller would have got one right because it was
 * documented and the other wrong because it was not. Both are named here for that reason.
 *
 * One latent consequence, recorded because it is not reachable today rather than because it is
 * harmless: {@link dedupeDiagnostics} keeps the FIRST of a colliding pair, so a warning arriving
 * before an identical-identity error would drop the error and defeat a severity gate downstream.
 * Only `checker-style.ts` emits warnings and only under `ol-style-*` codes, which no error shares,
 * so no pair can collide.
 */
export function diagnosticIdentity(diagnostic: Diagnostic): string {
  return faultIdentity(diagnostic);
}

/**
 * Report each fault once — `spec/execution-model.md:741-748`'s **de-duplication** half of *one
 * fault, one diagnostic*. Findings sharing a {@link faultIdentity} collapse to the FIRST one, and
 * the surviving order is the input order, so the earliest and most specific report is the one a
 * learner reads.
 *
 * It lives in core because more than one producer now has to obey it: the reader collapses the two
 * findings its own recovery paths can push for a single fault, and the check-before-run gate
 * (`spec/execution-model.md:632-694`) merges Layer 1's and Layer 2's collections, where the same
 * fault can legitimately be found twice — once statically, once again at run time under the
 * unchecked-run opt-out. A rule two packages implement separately is a rule they can drift on.
 */
export function dedupeDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  const seen = new SetConstructor<string>();
  const result: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const identity = faultIdentity(diagnostic);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    result.push(diagnostic);
  }
  return result;
}

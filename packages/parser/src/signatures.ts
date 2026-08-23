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

import type { NodeKind } from "./ast.js";
import type { CheckProfile } from "./check.js";

/**
 * The inclusive input-count range a primitive accepts: `min` is its bare default arity (the count
 * the reader gathers for a bare call) and `max` the most its parenthesized alternate/variadic form
 * accepts — `Number.POSITIVE_INFINITY` for an open variadic such as `(print …)`, and equal to `min`
 * for a strictly fixed-arity primitive.
 */
export interface ArityRange {
  readonly min: number;
  readonly max: number;
}

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
 * The **Turtle & Rendering** profile's primitives (issue #193), derived from the Turtle movement /
 * Pen and screen tables in [`spec/commands.md`](../../../spec/commands.md). Each row is a canonical
 * name, its arity, and — for five of them — the one-word alias spelling `spec/commands.md`
 * documents inline: `setxy`/`seth` (issue #202; `spec/commands.md:1280,1297`), `setcolor`/`setbg`
 * (issue #208; `spec/commands.md:1522,1540`), and `setwidth` (issue #209; `spec/commands.md:1557`).
 *
 * **The alias lives on its canonical's row rather than in a table beside it.** Until issue #841 the
 * five were independent arity entries with no recorded relationship, so nothing anywhere could
 * answer "what is `setxy` an alias *of*?" — `canonicalOfHeritageAlias("setxy")` returns `undefined`,
 * because they are not Heritage (`spec/conformance.md:148-157` closes that list and none of them is
 * in it). That made the edge unverifiable: `spec/built-in-names.json` records `setxy → set_xy`, and
 * the strongest check available against an unrecorded edge was "the target is some entry of equal
 * arity", which accepts `setxy → distance` just as happily.
 * [ADR-0021](../../../docs/adr/0021-built-in-names-list-and-ci-gate.md) §3 requires of #841 an
 * enumerable canonical map *"consumed by the resolver, so it cannot drift"*.
 *
 * The map is enumerable. The **consumption** half is not satisfied, so this is the narrow claim:
 * keeping the pair on one row removes the duplicate **arity** — both spellings take the same literal
 * because the row holds only one — and nothing more.
 * {@link turtlePrimitiveArity} reads {@link TURTLE_PRIMITIVE_ARITY} directly and never consults the
 * canonical map, so **which canonical a spelling maps to is still two facts**: this table's alias
 * column, and the runtime's own dispatch in `packages/runtime/src/execute-internal.ts`. Move an
 * alias column onto a different row of equal arity and update `spec/built-in-names.json` to match,
 * and the gate agrees while the runtime still dispatches the old way. Only a hand-written pin in
 * this slice's own `scripts/built-in-names-gate.test.mjs` notices, and **nothing compares either
 * fact against the runtime's dispatch**. Closing that needs a real consumer of the map, which this
 * slice does not add; the gap is recorded on #841.
 *
 * It does **not** change what the five mean at a call site: they remain independent spellings bound
 * to one primitive, with no canonicalisation in either direction, which is exactly the call-site
 * split that makes them built-in names in the first place
 * ([LDR-0007](../../../docs/design-notes/0007-binding-vs-registration.md)).
 *
 * `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs` are the genuinely **Heritage**-profile (M5) short
 * spellings and are not here. Kept as a separate table from {@link CORE_PRIMITIVE_ARITY} because
 * the two profiles have independent visibility: the Layer-2 checker gates each on its own active
 * profile (`spec/tooling.md:175-176`), while the reader groups a bare call's arguments for *any*
 * recognized primitive regardless of profile — the profile-legality decision belongs to the
 * checker, not the reader.
 */
const TURTLE_PRIMITIVES: readonly (readonly [
  canonical: string,
  arity: number,
  alias?: string,
])[] = [
  // Turtle movement.
  ["forward", 1],
  ["back", 1],
  ["left", 1],
  ["right", 1],
  ["home", 0],
  ["set_xy", 2, "setxy"],
  ["set_heading", 1, "seth"],
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
  ["set_color", 1, "setcolor"],
  ["set_background", 1, "setbg"],
  ["set_width", 1, "setwidth"],
  ["fill", 0],
  ["stamp", 0],
  ["set_shape", 1],
];

/** Every Turtle & Rendering primitive name — canonical and alias spellings alike — to its arity. */
const TURTLE_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map(
  TURTLE_PRIMITIVES.flatMap(([canonical, arity, alias]): [string, number][] =>
    alias === undefined
      ? [[canonical, arity]]
      : [
          [canonical, arity],
          [alias, arity],
        ],
  ),
);

/** Each one-word alias spelling to the canonical name it is a spelling of. */
const TURTLE_ALIAS_CANONICAL: ReadonlyMap<string, string> = new Map(
  TURTLE_PRIMITIVES.flatMap(([canonical, , alias]): [string, string][] =>
    alias === undefined ? [] : [[alias, canonical]],
  ),
);

/**
 * The canonical Turtle & Rendering name `name` is a one-word alias spelling of, or `undefined` when
 * it is not one of the five. Matching is case-insensitive, like every other name lookup here. The
 * Heritage counterpart is {@link canonicalOfHeritageAlias}.
 */
export function canonicalOfTurtleAlias(name: string): string | undefined {
  return TURTLE_ALIAS_CANONICAL.get(name.toLowerCase());
}

/** Every Turtle & Rendering one-word alias spelling, sorted for deterministic iteration. */
const TURTLE_ALIAS_NAMES: readonly string[] = Object.freeze(
  [...TURTLE_ALIAS_CANONICAL.keys()].sort(),
);

/**
 * The five Turtle & Rendering one-word alias spellings, in sorted order. The enumerable half of
 * {@link canonicalOfTurtleAlias}, so a consumer can walk the edges rather than probe for them.
 */
export function turtleAliasNames(): readonly string[] {
  return TURTLE_ALIAS_NAMES;
}

/**
 * The default arity of a Turtle & Rendering primitive, or `undefined` when `name` is not one of the
 * primitives registered in {@link TURTLE_PRIMITIVE_ARITY} — which holds the canonical spellings
 * **and** the five one-word alias spellings, each sharing its canonical's arity because they share
 * a row in {@link TURTLE_PRIMITIVES}. Matching is case-insensitive.
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
 * Every Turtle & Rendering primitive name — the canonical spellings and the five one-word alias
 * spellings alike — sorted for deterministic iteration. Both belong here: `spec/tooling.md`'s
 * `primitive` token class covers aliases explicitly, and `spec/grammar.md:414` makes every alias
 * spelling a built-in name, so a consumer asking what the profile registers must be told about
 * `setxy` as well as `set_xy`. The arities behind the five are shared with their canonicals rather
 * than duplicated — see {@link TURTLE_ALIAS_CANONICAL}.
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
 * (`checker-names.ts`, issue #397); the static arity check (`checker-arity.ts`) reaches the same
 * table — paired with {@link DATA_PRIMITIVE_MAX_ARITY} — through the profile-keyed
 * {@link PROFILE_PRIMITIVES} registry rather than a per-profile range accessor of its own
 * (issue #874).
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
 * The **Tutor (AI)** profile's one command (issue #838), whose canonical signature is normative in
 * [`spec/conformance.md`](../../../spec/conformance.md#tutor-ai): `challenge` is a Command, arity 0,
 * invoked as the bare word — the same "zero-input bare Command" shape as the Educational
 * meta-commands it augments (`spec/ai-tutor.md:173`).
 *
 * Tutor has no runtime yet, so before this slice `challenge` was the one built-in name with **no
 * registry at all** and therefore the one a program could declare with nothing to consult. It gets
 * its own table for the same reason {@link EDUCATIONAL_PRIMITIVE_ARITY} does: Tutor is a profile of
 * its own in the DAG, and a table per profile is what lets each be enumerated independently.
 */
const TUTOR_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  ["challenge", 0],
]);

/**
 * The default arity of a Tutor-profile command, or `undefined` when `name` is not `challenge`.
 * Matching is case-insensitive. {@link TUTOR_PRIMITIVE_ARITY} is this profile's single
 * source-of-truth table, mirroring {@link educationalPrimitiveArity}.
 */
export function tutorPrimitiveArity(name: string): number | undefined {
  return TUTOR_PRIMITIVE_ARITY.get(name.toLowerCase());
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
 * {@link turtlePrimitiveArity}/{@link educationalPrimitiveArity}. All three overlay primitives are
 * strictly fixed-arity 0 (`spec/geometry-module.md`'s `## grid`, `## axes`, and `## measure`
 * sections each specify a Kind-C command taking no inputs), so the profile registers no ceiling
 * table in {@link PROFILE_PRIMITIVES} and the static arity checker reads `max === min` from this
 * table alone.
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
 * Default arities for the **Interaction & Events** profile's Core-spelled primitives that the
 * reader must group arguments for — `wait <n>` (issue #680, slice I1) and `input <prompt>` (issue
 * #681, slice I2), the profile's only two ordinary calls (`spec/interaction-events.md:65`: "`input`
 * and `wait` are ordinary calls and take no block"). `wait` is a Kind-C Command taking one input and
 * `input` a Kind-R Reporter taking one prompt, both derived from
 * [`spec/interaction-events.md`](../../../spec/interaction-events.md)'s "Profiles and reservation"
 * table and their `### wait <n>` / `### input <prompt>` sections.
 * `when`/`every`/`on_key`/`on_click` are profile block-heads (reserved words with their own block
 * grammar, not ordinary calls) and register their reader support elsewhere — see
 * {@link INTERACTION_EVENTS_BLOCK_HEAD_NAMES}; only the ordinary calls need an arity entry here so
 * the reader groups their single argument. Kept as its own table for the same reason
 * {@link TURTLE_PRIMITIVE_ARITY}/{@link GEOMETRY_PRIMITIVE_ARITY} are separate:
 * Interaction & Events has its own independent profile visibility (the Layer-2 checker gates it on
 * its own active profile, `spec/tooling.md:175-176`), while the reader groups a bare call's
 * arguments for *any* recognized primitive regardless of profile.
 */
const INTERACTION_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  ["wait", 1],
  ["input", 1],
]);

/**
 * The default arity of an Interaction & Events-profile primitive, or `undefined` when `name` is
 * not one of them (`wait` and `input`). Matching is case-insensitive.
 *
 * `INTERACTION_PRIMITIVE_ARITY` is this profile's single source-of-truth table — mirroring
 * {@link geometryPrimitiveArity}/{@link educationalPrimitiveArity}. Its enumerable counterpart is
 * {@link interactionPrimitiveNames}. Both `wait <n>` and `input <prompt>` are strictly fixed-arity
 * (`spec/interaction-events.md`'s "Profiles and reservation" table), so the profile registers no
 * ceiling table in {@link PROFILE_PRIMITIVES}.
 */
export function interactionPrimitiveArity(name: string): number | undefined {
  return INTERACTION_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * Every Interaction & Events-profile primitive's canonical lowercase name, sorted for deterministic
 * iteration. This is the enumerable counterpart to {@link interactionPrimitiveArity} — the checker's
 * visible-name model (`checker-names.ts`) needs the full name *list*, gated on the
 * `interaction-events` profile, to make these primitives both callable without `ol-unknown-command`
 * and candidates for its did-you-mean suggestions — mirroring {@link geometryPrimitiveNames}'s and
 * {@link soundPrimitiveNames}'s role for their tables.
 *
 * Derived from {@link INTERACTION_PRIMITIVE_ARITY} rather than hand-listed, so this profile keeps a
 * single source of truth: a name becomes visible to the checker exactly when its arity is
 * registered, and the two can never drift apart. Today that is `input` and `wait` — the profile's
 * two ordinary calls, and the whole table. The tooling slice (#687) deliberately registered `wait`
 * alone and left `input` out, because a checker name with no runtime evaluator behind it lets a
 * program check clean and then fail at runtime — a false tooling claim worse for a learner than an
 * honest `ol-unknown-command`. Slice I2 (#681) ships `input`'s evaluator, so both halves of its
 * registration — this table for the reader/checker, and `@openlogo/runtime`'s `evaluateInput` —
 * land together, exactly as that boundary required.
 */
const INTERACTION_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...INTERACTION_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Interaction & Events-profile primitive names, in sorted order. See
 * {@link INTERACTION_PRIMITIVE_NAMES}. */
export function interactionPrimitiveNames(): readonly string[] {
  return INTERACTION_PRIMITIVE_NAMES;
}

/**
 * The **Interaction & Events** profile block-head names the Layer-2 checker must treat as visible
 * so a call site whose head is one of them does not raise `ol-unknown-command` under an active
 * `interaction-events` profile (issue #682, slice I3 — `spec/tooling.md:175-176`,
 * `spec/interaction-events.md` §Profiles and reservation). These are the four reserved block-heads
 * `when`/`every`/`on_key`/`on_click` the reader lowers to a `ProfileStatement` (C2 #664's
 * `PROFILE_STATEMENT_FORMS`), NOT ordinary primitive calls — so they live in their own table,
 * separate from {@link INTERACTION_PRIMITIVE_ARITY}'s Core-spelled `wait`, exactly as the spec
 * distinguishes profile block-heads from ordinary calls.
 *
 * `when` (#682/I3), `every` (#683/I4), `on_key` (#684/I5), and `on_click` (#685/I6) are listed today:
 * each is the head its slice delivers end to end. This table is now complete — all four Interaction &
 * Events block-heads are usable — following the same one-form-at-a-time growth as every other
 * profile's visible-name table; registering a head here before its slice can execute it would let a
 * program check clean and then silently no-op at runtime. `input` (a reporter) and `wait` (an
 * ordinary call) are visible through their own name path — {@link INTERACTION_PRIMITIVE_NAMES} —
 * not this block-head table. Entries stay in
 * registration order so the checker's candidate set (`checker-names.ts`) exposes a stable
 * did-you-mean ordering.
 */
const INTERACTION_EVENTS_BLOCK_HEAD_NAMES: readonly string[] = Object.freeze([
  "when",
  "every",
  "on_key",
  "on_click",
]);

/**
 * The Interaction & Events block-head names visible to the checker, in registration order. See
 * {@link INTERACTION_EVENTS_BLOCK_HEAD_NAMES}. The checker's visible-name model
 * (`checker-names.ts`) spreads these into its candidate set only when the `interaction-events`
 * profile is active, mirroring how {@link soundPrimitiveNames} gates the Sound profile's names.
 */
export function interactionEventsBlockHeadNames(): readonly string[] {
  return INTERACTION_EVENTS_BLOCK_HEAD_NAMES;
}

/**
 * Default arities for the **Sound** profile's primitives (issue #689,
 * [`spec/interaction-events.md`](../../../spec/interaction-events.md)'s "Sound primitives"
 * section). `set_tempo` takes one number (the beats-per-minute, `spec/interaction-events.md:259-272`)
 * and `beep` takes none (`spec/interaction-events.md:309-324`) — the two primitives slice S1 (#689)
 * delivers; the remaining Sound names (`note`/`play`/`rest`) join this table in their own slices
 * (#690/#691), each a bare `Call` grouped by this arity exactly as `set_width`/`grid` are. Kept as
 * its own table for the same reason {@link TURTLE_PRIMITIVE_ARITY}/{@link GEOMETRY_PRIMITIVE_ARITY}
 * are separate: Sound has its own independent profile visibility (the Layer-2 checker gates it on
 * its own active `sound` profile, `spec/tooling.md:175-176`), while the reader groups a bare call's
 * arguments for *any* recognized primitive regardless of profile — the profile-legality decision
 * belongs to the checker, not the reader. Sound command names are ordinary primitive names (not
 * reserved block-heads) whose availability requires the profile (`spec/interaction-events.md:47`;
 * the names themselves are built-in unconditionally per `spec/grammar.md:408`).
 */
const SOUND_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  ["set_tempo", 1],
  ["beep", 0],
  ["note", 2],
  ["rest", 1],
  ["play", 1],
]);

/**
 * The default arity of a Sound-profile primitive, or `undefined` when `name` is not one of the
 * primitives registered in {@link SOUND_PRIMITIVE_ARITY}. Matching is case-insensitive.
 *
 * `SOUND_PRIMITIVE_ARITY` is this profile's single source-of-truth table — mirroring
 * {@link geometryPrimitiveArity}/{@link educationalPrimitiveArity}. Every Sound primitive is
 * strictly fixed-arity — none has a variadic parenthesized alternate — so the profile registers no
 * ceiling table in {@link PROFILE_PRIMITIVES}.
 */
export function soundPrimitiveArity(name: string): number | undefined {
  return SOUND_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * Every Sound-profile primitive's canonical lowercase name, sorted for deterministic iteration.
 * This is the enumerable counterpart to {@link soundPrimitiveArity} — the checker's visible-name
 * model (`checker-names.ts`) needs the full name *list*, gated on the `sound` profile, to make
 * these primitives both callable without `ol-unknown-command` and candidates for its did-you-mean
 * suggestions — mirroring {@link geometryPrimitiveNames}'s role for its table.
 */
const SOUND_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...SOUND_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Sound-profile primitive names, in sorted order. See
 * {@link SOUND_PRIMITIVE_NAMES}. */
export function soundPrimitiveNames(): readonly string[] {
  return SOUND_PRIMITIVE_NAMES;
}

/**
 * Default arities for the **Sprites** profile's turtle-identity reporters (issue #673),
 * derived from [`spec/turtles-and-sprites.md`](../../../spec/turtles-and-sprites.md)'s "Canonical
 * forms" table (the authoritative C3 rows): `new_turtle` (R, 0 → turtle), `who` (R, 0 → turtle),
 * and `turtles` (R, 0 → list) are each a Kind-R reporter taking no inputs, invoked as a bare word
 * exactly like `pos`/`heading` or the Geometry overlay primitives. The Sprites block-heads
 * `tell`/`ask`/`each` are NOT here: they are statement forms/reserved words handled by the grammar
 * and checker, not bare-call primitives whose arguments the reader groups. Kept as its own table
 * for the same reason {@link TURTLE_PRIMITIVE_ARITY}/{@link GEOMETRY_PRIMITIVE_ARITY} are separate:
 * Sprites has its own independent profile visibility (the Layer-2 checker gates it on its own
 * active profile, `spec/tooling.md:175-176`), while the reader groups a bare call's arguments for
 * *any* recognized primitive regardless of profile. Registering these arities therefore does NOT
 * make the Sprites profile callable under Core or claimable — that gating is the checker's and the
 * profile-claim slice's concern.
 */
const SPRITES_PRIMITIVE_ARITY: ReadonlyMap<string, number> = new Map([
  ["new_turtle", 0],
  ["who", 0],
  ["turtles", 0],
]);

/**
 * The default arity of a Sprites-profile reporter, or `undefined` when `name` is not one of
 * `new_turtle`/`who`/`turtles`. Matching is case-insensitive.
 *
 * `SPRITES_PRIMITIVE_ARITY` is this profile's single source-of-truth table — mirroring
 * {@link turtlePrimitiveArity}/{@link geometryPrimitiveArity}. Its enumerable name-list counterpart
 * ({@link spritesPrimitiveNames}, mirroring {@link geometryPrimitiveNames}) is added by the Sprites
 * semantic-checker slice (#678) that first needs it, so `new_turtle`/`who`/`turtles` become known
 * callees under an active `sprites` profile rather than raising `ol-unknown-command`.
 */
export function spritesPrimitiveArity(name: string): number | undefined {
  return SPRITES_PRIMITIVE_ARITY.get(name.toLowerCase());
}

/**
 * Every Sprites-profile reporter's canonical lowercase name, sorted for deterministic iteration.
 * This is the enumerable counterpart to {@link spritesPrimitiveArity} — the checker's visible-name
 * model (`checker-names.ts`) needs the full name *list*, gated on the `sprites` profile, to make
 * `new_turtle`/`who`/`turtles` both callable without `ol-unknown-command` and candidates for its
 * did-you-mean suggestions — mirroring {@link geometryPrimitiveNames}'s role for its table.
 */
const SPRITES_PRIMITIVE_NAMES: readonly string[] = Object.freeze(
  [...SPRITES_PRIMITIVE_ARITY.keys()].sort(),
);

/**
 * The full list of Sprites-profile reporter names, in sorted order. See
 * {@link SPRITES_PRIMITIVE_NAMES}. */
export function spritesPrimitiveNames(): readonly string[] {
  return SPRITES_PRIMITIVE_NAMES;
}

/**
 * The Sprites-profile **statement forms** whose head keyword the checker must recognize as a
 * visible command name (issue #674), so a `ProfileStatement` such as `tell :friend` is not reported
 * `ol-unknown-command` under an active `sprites` profile (`unknownCommandRule` walks the head
 * keyword against {@link collectVisibleNames}). `tell` was registered for SP2 (the addressing
 * mode-switch), `ask` for SP3 (#675, the scoped block-head), and `each` for SP4 (#676, the
 * once-per-turtle block-head this slice runs); the `new_turtle`/`who`/`turtles` reporters have their
 * own name-list (#678), so registering them here would let a program "check clean" against a form
 * nothing runs. Sourced from a dedicated table rather than
 * {@link SPRITES_PRIMITIVE_ARITY} because these are statement forms (grouped by the grammar's
 * profile-statement rule), not bare-call reporters whose arguments the reader groups.
 */
const SPRITES_STATEMENT_FORM_NAMES: readonly string[] = ["tell", "ask", "each"];

/**
 * Every Sprites-profile statement-form head keyword the checker treats as a visible command name
 * (`tell` from #674, `ask` from #675, `each` from #676). The enumerable counterpart the checker's
 * unknown-command rule consults, mirroring {@link soundPrimitiveNames}.
 */
export function spritesStatementFormNames(): readonly string[] {
  return SPRITES_STATEMENT_FORM_NAMES;
}

/**
 * The **Heritage** profile's short command and reporter aliases (issues #668 slice H3 + #669 slice
 * H4), each mapping onto the Core-spelled command or reporter it is an alternate spelling of. The
 * list and its one-to-one canonical mapping are authoritative in `spec/conformance.md:151` and
 * `spec/commands.md`'s per-command **Aliases** rows (`fd`→`forward`:1195, `bk`→`back`:1212,
 * `lt`→`left`:1229, `rt`→`right`:1246, `st`→`show_turtle`:1418, `ht`→`hide_turtle`:1435,
 * `pu`→`pen_up`:1452, `pd`→`pen_down`:1470, `cs`→`clear_screen`:1488, `pr`→`print`:146, plus the
 * list reporters `bf`→`butfirst`:1070, `bl`→`butlast`:1087, `se`→`sentence`:1019). Heritage is
 * "alternate spellings only — no new semantics" (`spec/conformance.md:146`): the reader records
 * `canonical` on the alias's {@link import("./ast.js").CallNode} so the runtime dispatches through
 * the exact same code path as the Core spelling, and this module never keeps a second copy of each
 * canonical's arity — that stays each owning profile's single source-of-truth table (see
 * {@link heritageAliasArity} and {@link heritageAliasArityRange}, which resolve the alias then read
 * the canonical's own arity).
 */
const HERITAGE_ALIAS_CANONICAL: ReadonlyMap<string, string> = new Map([
  ["fd", "forward"],
  ["bk", "back"],
  ["lt", "left"],
  ["rt", "right"],
  ["st", "show_turtle"],
  ["ht", "hide_turtle"],
  ["pu", "pen_up"],
  ["pd", "pen_down"],
  ["cs", "clear_screen"],
  ["pr", "print"],
  ["bf", "butfirst"],
  ["bl", "butlast"],
  ["se", "sentence"],
]);

/**
 * The Core-spelled command a Heritage short alias is an alternate spelling of, or `undefined` when
 * `name` is not a Heritage short alias. Matching is case-insensitive. This is the one-to-one
 * mapping the reader records as {@link import("./ast.js").CallNode.canonical} and every consumer
 * (runtime dispatch, the checker's arity/did-you-mean logic, tutor `explain`/`why`) resolves an
 * alias through — so Heritage stays "alternate spellings only" with no duplicated semantics.
 */
export function canonicalOfHeritageAlias(name: string): string | undefined {
  return HERITAGE_ALIAS_CANONICAL.get(name.toLowerCase());
}

/**
 * Every Heritage short command alias's lowercase spelling, sorted for deterministic iteration.
 * The enumerable counterpart to {@link canonicalOfHeritageAlias} — the checker's visible-name model
 * (`checker-names.ts`) needs the full list, gated on the `heritage` profile, to make these aliases
 * both callable without `ol-unknown-command` and did-you-mean candidates, mirroring
 * {@link turtlePrimitiveNames}'s role for its table.
 */
const HERITAGE_ALIAS_NAMES: readonly string[] = Object.freeze(
  [...HERITAGE_ALIAS_CANONICAL.keys()].sort(),
);

/** The full list of Heritage short alias names, in sorted order. See {@link HERITAGE_ALIAS_NAMES}. */
export function heritageAliasNames(): readonly string[] {
  return HERITAGE_ALIAS_NAMES;
}

/**
 * The **Heritage** form heads (issue #667, slice H2) — the special-form spellings that are not
 * *names* the reader lowers to a call, but surface tags on the same Core AST node as their Core
 * equivalent — each mapped to the Core spelling it is an alternate spelling of. `make` → `set`
 * (the word-shaped Core assignment; `=` is the other Core form), `to` → `define`, and
 * `output`/`op` → `return`.
 *
 * This is the form-head counterpart of {@link HERITAGE_ALIAS_CANONICAL}, and it lives here — beside
 * it — so the parser has exactly ONE table answering "what Core spelling is this Heritage spelling
 * an alternate of". Two consumers need that answer for different reasons, and they must never drift:
 * `checker-heritage-form.ts` points a Core-only learner's did-you-mean at the Core spelling, and
 * `checker-control-flow.ts` canonicalizes `params.keyword` so a Heritage escape's diagnostic
 * identity is byte-identical to its Core twin's (`spec/error-model.md:235-238`, issue #737).
 *
 * Declared `as const` so {@link canonicalOfHeritageFormHead} can report each head's canonical as a
 * literal type: that is what lets a caller thread a canonical spelling into a diagnostic param
 * without a cast, and what makes feeding a *surface* spelling to a canonical-typed parameter a
 * compile error rather than a silently divergent diagnostic.
 */
const HERITAGE_FORM_HEAD_CANONICAL = {
  make: "set",
  to: "define",
  output: "return",
  op: "return",
} as const;

/** One of the four Heritage form-head spellings — the keys of {@link HERITAGE_FORM_HEAD_CANONICAL}. */
export type HeritageFormHead = keyof typeof HERITAGE_FORM_HEAD_CANONICAL;

/**
 * The Core spelling a Heritage form head is an alternate spelling of, as a **literal type**:
 * `canonicalOfHeritageFormHead("op")` is typed `"return"`, not `string`. Callers that must produce
 * a canonical value — a diagnostic's structured params above all — get it from this one registry
 * rather than repeating the mapping, so a Heritage spelling can never reach a canonical position.
 */
export function canonicalOfHeritageFormHead<Head extends HeritageFormHead>(
  head: Head,
): (typeof HERITAGE_FORM_HEAD_CANONICAL)[Head] {
  return HERITAGE_FORM_HEAD_CANONICAL[head];
}

/** Every Heritage form-head spelling, sorted for deterministic iteration. */
const HERITAGE_FORM_HEAD_NAMES: readonly HeritageFormHead[] = Object.freeze(
  (Object.keys(HERITAGE_FORM_HEAD_CANONICAL) as HeritageFormHead[]).sort(),
);

/** The full list of Heritage form-head spellings, in sorted order. */
export function heritageFormHeadNames(): readonly HeritageFormHead[] {
  return HERITAGE_FORM_HEAD_NAMES;
}

/**
 * The **Heritage** profile's WORDED forms — the multi-word spellings, which are neither callable
 * *names* like {@link HERITAGE_ALIAS_CANONICAL}'s aliases nor single-word statement heads like
 * {@link HERITAGE_FORM_HEAD_CANONICAL}'s. `spec/conformance.md:153` lists exactly one today, the
 * worded dictionary reporter `value of … for key` (slice H5, issue #670), whose production is
 * `spec/grammar.md:213`'s `value-of-reader`.
 *
 * Each entry records three things. `phrase` is quoted verbatim from that spec bullet, so a guard
 * can hold this table against the spec's own inventory without normalising anything. `node` is the
 * AST node kind the reader lowers the form onto, which lets a guard check that a test program
 * parses to that kind rather than merely mentioning the form's head word — the AST records node
 * kinds, not the production that built them, so it distinguishes registered forms only as long as
 * no two share a kind, an invariant the parser guard asserts. And `head` is the word the
 * form is identified BY — the only literal unique to this grammar production, and so its
 * least-ambiguous representative in the registry. It is NOT a proof token: `value` turning up in a
 * diagnostic's params does not establish that this form produced it, because a learner may name a
 * dict key `value` like any other word. The phrase's other literals are weaker still, being
 * ordinary vocabulary that reaches params on its own account (a malformed form quotes whatever
 * token it stopped at through `ol-bad-token`'s `text`): `of` is the contextual preposition of the
 * `is member of` predicate (`spec/grammar.md:380`), `for` opens the Core `for … in`/`for … from … to`
 * loops, and `key` is also the Data profile's `remove key … from` (`spec/grammar.md:115`) — which is
 * why the head, not the phrase, is what {@link HERITAGE_SURFACE_SPELLINGS} registers for
 * canonical-param matching. The operands the phrase elides are a dict and a word/number key
 * (`spec/data-structures.md:268`).
 *
 * There is deliberately no `canonical` column. The four form heads each map onto a Core WORD
 * (`make` → `set`, `to` → `define`, `output`/`op` → `return`), which is what lets
 * {@link canonicalOfHeritageFormHead} hand a caller a canonical spelling for a diagnostic param.
 * This reader's Core equivalent is the `[]`/`.` selector *syntax* — `:d["k"]`, `:d.k`
 * (`spec/data-structures.md:265-268`) — not a word, so there is no canonical spelling to report and
 * inventing one would name something absent from the diagnostic's own span. That is exactly why
 * `checker-heritage-form.ts` gives this form's rejection no `did you mean`, and why the form must
 * live in its own table rather than being forced into the head→canonical map.
 *
 * Each entry is frozen at RUNTIME, not merely `as const` at the type level:
 * {@link heritageWordedForm} hands the entry object straight to callers rather than copying it, so
 * an unfrozen entry would let one consumer mutate the head every other consumer reads — which is
 * precisely the single-source-of-truth guarantee this table exists to provide.
 */
const HERITAGE_WORDED_FORMS = {
  "value-of-reader": Object.freeze({
    head: "value",
    phrase: "value of … for key",
    node: "ValueOfKey",
  }),
} as const satisfies Record<
  string,
  { head: string; phrase: string; node: NodeKind }
>;

/**
 * One of the Heritage worded forms, named by its grammar production — the keys of
 * {@link HERITAGE_WORDED_FORMS}.
 */
export type HeritageWordedFormName = keyof typeof HERITAGE_WORDED_FORMS;

/** A Heritage worded form's head word and full phrase. */
export type HeritageWordedForm =
  (typeof HERITAGE_WORDED_FORMS)[HeritageWordedFormName];

/**
 * A Heritage worded form, by its grammar production name, as a **literal type**:
 * `heritageWordedForm("value-of-reader").head` is typed `"value"`, not `string`. That is the same
 * device {@link canonicalOfHeritageFormHead} uses, and it is what lets `checker-heritage-form.ts`
 * span and report the reader's head word without keeping a second copy of the string beside the
 * registry the guards match against (issue #755).
 */
export function heritageWordedForm<Name extends HeritageWordedFormName>(
  name: Name,
): (typeof HERITAGE_WORDED_FORMS)[Name] {
  return HERITAGE_WORDED_FORMS[name];
}

/**
 * The worded-form table itself, frozen. Unlike the entry freezes above this guards nothing an
 * external caller could do — the table is module-private and only {@link heritageWordedForm}'s
 * return value escapes — so it is defence against an accidental mutation inside this module, and
 * no test asserts it.
 */
Object.freeze(HERITAGE_WORDED_FORMS);

/**
 * Every Heritage worded form's grammar-production name, sorted for deterministic iteration — the
 * enumerable counterpart of {@link heritageWordedForm}. A guard that must prove each FORM is
 * covered (rather than merely its head word, which any program may contain by accident) iterates
 * these and looks each one up.
 */
const HERITAGE_WORDED_FORM_NAMES: readonly HeritageWordedFormName[] =
  Object.freeze(
    (Object.keys(HERITAGE_WORDED_FORMS) as HeritageWordedFormName[]).sort(),
  );

/** The full list of Heritage worded-form production names, in sorted order. */
export function heritageWordedFormNames(): readonly HeritageWordedFormName[] {
  return HERITAGE_WORDED_FORM_NAMES;
}

/**
 * Every Heritage worded form, sorted by production name for deterministic iteration. The
 * enumerable counterpart of {@link heritageFormHeadNames} for the multi-word spellings, so a
 * consumer that must name the form to a learner has the phrase without restating it.
 */
const HERITAGE_WORDED_FORM_ENTRIES: readonly HeritageWordedForm[] =
  Object.freeze(
    HERITAGE_WORDED_FORM_NAMES.map((name) => HERITAGE_WORDED_FORMS[name]),
  );

/** The full list of Heritage worded forms. See {@link HERITAGE_WORDED_FORM_ENTRIES}. */
export function heritageWordedForms(): readonly HeritageWordedForm[] {
  return HERITAGE_WORDED_FORM_ENTRIES;
}

/**
 * Every Heritage worded form's head word, sorted for deterministic iteration. This is the literal
 * unique to the form's grammar production, and so its least-ambiguous representative when a
 * diagnostic's structured params are scanned — `checker-heritage-form.ts` emits exactly this word
 * as the `ol-unknown-command` `name` when Heritage is inactive — which is what
 * {@link HERITAGE_SURFACE_SPELLINGS} carries on the form's behalf. It does not prove provenance: a
 * learner may name a dict key `value` like any other word. The phrase's other literals are not
 * registered at all, being ordinary vocabulary that matching on would fire on text that is not
 * Heritage.
 */
const HERITAGE_WORDED_FORM_HEADS: readonly string[] = Object.freeze(
  HERITAGE_WORDED_FORM_ENTRIES.map((form) => form.head).sort(),
);

/** The full list of Heritage worded-form head words, in sorted order. */
export function heritageWordedFormHeads(): readonly string[] {
  return HERITAGE_WORDED_FORM_HEADS;
}

/**
 * Every surface WORD that identifies a Heritage-only FORM — the short command/reporter aliases
 * ({@link heritageAliasNames}), the form heads ({@link heritageFormHeadNames}), and the worded
 * forms' heads ({@link heritageWordedFormHeads}) — sorted for deterministic iteration.
 *
 * Read "identifies" precisely: these are the words a learner writes to make the reader take a
 * Heritage spelling rather than a Core one. Several of them are ALSO ordinary Core vocabulary in
 * some other position, so this is not a list of Heritage-exclusive tokens: `to` is the preposition
 * of Core's `set … to` and the bound of `for … from … to` (`spec/grammar.md:104,128`) as well as
 * the Heritage procedure opener, and the worded reader's head `value` is a globally reserved word
 * (`spec/grammar.md:371`). What each entry has in common is that a diagnostic naming it would be
 * naming the learner's Heritage spelling of a condition their Core twin raises identically.
 *
 * This is the enumerable definition of "a Heritage surface spelling", and it exists so the
 * canonical-diagnostic-params guards (`heritage-canonical-diagnostic-params.test.mjs` in
 * `@openlogo/parser` for the parse/semantic stages, issue #737, and in `@openlogo/runtime` for the
 * runtime stage, issue #741) are driven by the registry instead of a hand-kept list: a future slice
 * that adds a Heritage spelling to any of the three tables is automatically pulled into both
 * guards, so the class of bug where a surface spelling leaks into a diagnostic's structured params
 * is much harder to reintroduce unnoticed.
 *
 * A spelling here is a WORD, which is why {@link HERITAGE_WORDED_FORMS} contributes its head
 * rather than its phrase: a leak is a string sitting in a param, and the guards match whole words
 * against rendered param values. The three tables together cover every spelling
 * `spec/conformance.md:146-157`'s Heritage inventory writes in code formatting (issue #755) — an
 * agreement the parser guard asserts against the spec file itself, rather than by restating it
 * here. Before #755 these were the single-word tables only, and this comment nevertheless claimed a
 * completeness the worded reader disproved.
 */
const HERITAGE_SURFACE_SPELLINGS: readonly string[] = Object.freeze(
  [
    ...HERITAGE_ALIAS_NAMES,
    ...HERITAGE_FORM_HEAD_NAMES,
    ...HERITAGE_WORDED_FORM_HEADS,
  ].sort(),
);

/** The full list of Heritage-only surface spellings. See {@link HERITAGE_SURFACE_SPELLINGS}. */
export function heritageSurfaceSpellings(): readonly string[] {
  return HERITAGE_SURFACE_SPELLINGS;
}

/**
 * The default (bare-call) arity a Heritage short alias groups its arguments by, or `undefined` when
 * `name` is not a Heritage short alias. Because Heritage adds no semantics, this is exactly the
 * canonical command's own default arity ({@link primitiveArity} of the resolved Core name) — the
 * alias never carries a second arity number of its own. The reader consults it (via
 * {@link primitiveArity}) so `fd 100` groups one argument exactly as `forward 100` does and `pr :x`
 * groups one exactly as `print :x` does.
 */
export function heritageAliasArity(name: string): number | undefined {
  const canonical = canonicalOfHeritageAlias(name);
  return canonical === undefined ? undefined : primitiveArity(canonical);
}

/**
 * The inclusive input-count range a Heritage short alias accepts, or `undefined` when `name` is not
 * a Heritage short alias — exactly the resolved canonical command's own range, so the static arity
 * checker treats `pr` like `print` (its `(pr …)` form is an open variadic) and `fd` like `forward`
 * (a turtle primitive with no static range, left to the runtime arity check). Only `print` among
 * the ten canonicals has a Core static range; the turtle canonicals return `undefined` here just as
 * they do through {@link corePrimitiveArityRange}, so the checker leaves their arity to the runtime.
 */
export function heritageAliasArityRange(
  name: string,
): { readonly min: number; readonly max: number } | undefined {
  const canonical = canonicalOfHeritageAlias(name);
  return canonical === undefined
    ? undefined
    : corePrimitiveArityRange(canonical);
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

/**
 * One conformance profile's primitive registration: the profile's single source-of-truth default
 * arity table and, only when the profile owns a primitive with a variadic or bounded-alternate
 * *parenthesized* form, the ceiling table that records it. A profile with no such form omits
 * `maxArity` entirely and every one of its primitives reads back as strictly fixed-arity
 * (`max === min`) — which is what all of Turtle & Rendering, Educational, Geometry,
 * Interaction & Events, Sound, Sprites, and Tutor are.
 */
interface ProfilePrimitives {
  readonly arity: ReadonlyMap<string, number>;
  readonly maxArity?: ReadonlyMap<string, number>;
}

/**
 * **The primitive registry: one entry per conformance profile, and the single place a profile's
 * primitives are wired to everything that consults them** (issue #874).
 *
 * Its type is `Record<CheckProfile, …>` — a mapped type over `OL_CHECK_PROFILES` — so it is
 * **exhaustive by construction**: a profile added to that list does not compile until it declares
 * an entry here, and the declaration is a binary choice with no silent third option (a table, or an
 * explicit `null` meaning "this profile contributes no bare-call primitives"). That is the
 * fail-closed property this registry exists for, and it is the same structural move `parser.ts`'s
 * `NON_PRIMARY_NAMES` makes for keywords (issue #853).
 *
 * **Why it is shaped this way.** Before this, the reader walked an untagged *array* of tables while
 * the checker's arity rule hand-wrote one `if (<profile>Active) { … }` branch per profile against a
 * per-profile range accessor. Nothing tied the two together, so a profile could be — and for
 * Turtle & Rendering, Educational, Sprites, and Tutor **was** — registered for the reader and
 * silently missing from the checker: `(home 10)` checked clean while the runtime raised
 * `ol-too-many-inputs` for the very same call (issue #874, the third instance of the same shape
 * after #783 and #854). Tagging each table with its owning {@link CheckProfile} collapses both
 * lookups onto one registry, so **registering a future profile's table here wires the reader and
 * the checker together, with no edit to `checker-arity.ts` at all**.
 *
 * The `null` entries are not omissions, they are claims:
 * - `heritage` — its short aliases carry no arity of their own. Heritage is "alternate spellings
 *   only, no new semantics" (`spec/conformance.md:146`), so an alias resolves to its canonical and
 *   reads *that* profile's entry ({@link heritageAliasArity}); a Heritage table here would be a
 *   second copy of every canonical's arity, the very duplication this registry removes.
 * - `modules`, `localization` — neither profile defines a bare-call primitive: `spec/modules.md`'s
 *   `import`/`export` and `spec/localization.md`'s `alias` are grammar forms with their own
 *   productions, not callables whose arguments the reader groups.
 *
 * **Tutor's entry is load-bearing.** When issue #838 registered it, a QA review measured that
 * removing it failed no test, and said so in a comment here. That is no longer true: issue #854
 * routes `ol-style-name-case` to `challenge` through {@link primitiveArity}, so unregistering
 * Tutor now reddens a test. The stale comment is deliberately not carried forward — a
 * hand-maintained claim drifting from the registry it describes is epic #900's own failure mode,
 * one file deeper. The proof is genuine but narrow: the Tutor table holds exactly one name, so it
 * demonstrates that the entry is *reachable*, not that every future Tutor primitive would be.
 */
const PROFILE_PRIMITIVES: Readonly<
  Record<CheckProfile, ProfilePrimitives | null>
> = {
  "core-language": {
    arity: CORE_PRIMITIVE_ARITY,
    maxArity: CORE_PRIMITIVE_MAX_ARITY,
  },
  "turtle-rendering": { arity: TURTLE_PRIMITIVE_ARITY },
  geometry: { arity: GEOMETRY_PRIMITIVE_ARITY },
  sprites: { arity: SPRITES_PRIMITIVE_ARITY },
  data: { arity: DATA_PRIMITIVE_ARITY, maxArity: DATA_PRIMITIVE_MAX_ARITY },
  heritage: null,
  "interaction-events": { arity: INTERACTION_PRIMITIVE_ARITY },
  sound: { arity: SOUND_PRIMITIVE_ARITY },
  modules: null,
  localization: null,
  educational: { arity: EDUCATIONAL_PRIMITIVE_ARITY },
  "tutor-ai": { arity: TUTOR_PRIMITIVE_ARITY },
};

/**
 * {@link PROFILE_PRIMITIVES}'s arity-bearing entries, flattened once into `[profile, tables]` pairs
 * in registry declaration order. Both lookups below walk this one array, so the profile-blind
 * reader ({@link primitiveArity}) and the profile-aware checker
 * ({@link activeProfilePrimitiveArityRange}) resolve a name through the identical sequence of
 * tables and can never disagree about which profile owns it.
 */
const REGISTERED_PROFILE_PRIMITIVES: readonly (readonly [
  CheckProfile,
  ProfilePrimitives,
])[] = Object.entries(PROFILE_PRIMITIVES).flatMap(([profile, tables]) =>
  tables === null ? [] : [[profile as CheckProfile, tables] as const],
);

/** Reads `name` (already lowercased) out of one profile's tables. See {@link ArityRange}. */
function arityRangeIn(
  tables: ProfilePrimitives,
  name: string,
): ArityRange | undefined {
  const min = tables.arity.get(name);
  if (min === undefined) {
    return undefined;
  }
  return { min, max: tables.maxArity?.get(name) ?? min };
}

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
  for (const [, tables] of REGISTERED_PROFILE_PRIMITIVES) {
    const arity = tables.arity.get(lower);
    if (arity !== undefined) {
      return arity;
    }
  }
  return undefined;
}

/**
 * The inclusive input-count range `name` accepts under the **active** conformance profile set, or
 * `undefined` when no active profile registers it — the static arity checker's single lookup
 * (`checker-arity.ts`, issue #874), and the profile-aware counterpart to {@link primitiveArity}.
 *
 * Only profiles present in `profiles` are consulted, exactly as `spec/tooling.md:175-176` requires
 * ("MUST use the active conformance profile set when deciding which primitives and profile
 * block-heads are available") — a primitive whose owning profile is inactive is not visible, so its
 * arity is not statically known and the callee belongs to `ol-unknown-command` instead. An
 * unrecognized profile identifier simply matches no entry and contributes nothing. Matching is
 * case-insensitive.
 */
export function activeProfilePrimitiveArityRange(
  name: string,
  profiles: readonly CheckProfile[],
): ArityRange | undefined {
  const lower = name.toLowerCase();
  const active = new Set<string>(profiles);
  for (const [profile, tables] of REGISTERED_PROFILE_PRIMITIVES) {
    if (!active.has(profile)) {
      continue;
    }
    const range = arityRangeIn(tables, lower);
    if (range !== undefined) {
      return range;
    }
  }
  return undefined;
}

/**
 * Every primitive name `profile` registers in {@link PROFILE_PRIMITIVES}, sorted, computed once per
 * profile and frozen. Empty for a profile whose registry entry is `null` (`heritage`, `modules`,
 * `localization`) — those contribute no bare-call primitives, which is a claim the registry makes
 * rather than an omission.
 */
const PROFILE_PRIMITIVE_NAMES: ReadonlyMap<CheckProfile, readonly string[]> =
  new Map(
    Object.entries(PROFILE_PRIMITIVES).map(([profile, tables]) => [
      profile as CheckProfile,
      Object.freeze(tables === null ? [] : [...tables.arity.keys()].sort()),
    ]),
  );

/**
 * The full list of primitive names one conformance profile registers, in sorted order — the
 * enumerable counterpart to {@link activeProfilePrimitiveArityRange}, derived from the same
 * {@link PROFILE_PRIMITIVES} registry so the two can never disagree about what a profile owns.
 *
 * This is what lets a caller — the unit suites above all — walk the profile DAG
 * (`OL_CHECK_PROFILES`) and assert a property of *every* registered primitive without restating any
 * command name, so a primitive added to a profile's table is covered without editing the assertion.
 * An unrecognized profile identifier reports no names.
 */
export function profilePrimitiveNames(
  profile: CheckProfile,
): readonly string[] {
  return PROFILE_PRIMITIVE_NAMES.get(profile) ?? [];
}

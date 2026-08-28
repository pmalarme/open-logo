// The child-edge gate (issue #960) — the half of #925 that a `never` guard cannot reach.
//
// #925 made `childrenOf`'s dispatch exhaustive over discriminant *values*: every node kind, `is`
// test form, place-segment kind and comprehension form selects an explicit case or the build fails
// ([ADR-0024](../../../docs/adr/0024-ast-traversal-kind-dispatch-is-compiler-enforced.md)). It did
// not, and could not, check that a case returns the *right* children. A node-valued field added to
// an already-handled kind still compiles clean, is silently absent from the child list, and is
// therefore never reached by `walk` — nor by the runtime's `registerDeclarations`, the checkers,
// the highlighter's semantic tokens, or the studio's fold ranges, because every one of them
// descends through `childrenOf`. The instrument and its subject share the traversal, so a
// derivation over the corpus stays green about its own gap.
//
// **This file audits that traversal from a source that does not use it.** For every node in the
// corpus it derives, by *reflection over the node's own object fields*, the child edges that node
// actually holds, and compares them against what `childrenOf` reports — by object **identity and
// multiplicity**, not membership. The two sides share `parse`, object identity and `OL_NODE_KINDS`;
// what they do not share is any child-edge enumeration or recursion logic, which is the property
// that makes the comparison mean anything.
//
// Membership alone is not enough, and that is not a hypothetical: an earlier version of this file
// compared reachable *sets* and the #960 reviewer defeated it three ways — an aliased edge dropped
// while the node stayed reachable by its other route, a spurious grandchild added to a parent's
// list, and a node hidden inside a container `Object.entries` does not enumerate. All three now
// fail, and each has an assertion of its own.
//
// Scope: every `*.logo` file under `tests/conformance/`, `spec/examples/` and `stdlib/`. Files that
// do not parse cleanly are skipped — they are the corpus's deliberate parse-error fixtures and hold
// no tree to audit — so this gate speaks for the parseable corpus, not for all of it.
//
// Three self-checks the reviewer of #925 asked for, each of which exists because a gate that cannot
// see its own assumptions is the defect one level up:
//
//   1. The node-detection oracle is stated here, in the open, rather than buried in a predicate.
//      An assumption in a named constant can be reviewed; the same assumption inside a helper cannot.
//   2. A kinded, spanned shape whose `kind` is not a node kind FAILS rather than being skipped.
//      It is unreachable today, and making it loud is what keeps it that way.
//   3. The corpus must populate every declared node-valued field path. Without this, a green run
//      over a corpus that never exercises a field is indistinguishable from a green run over a
//      correct implementation — the "green signal certifying less than it appears to" that #924 and
//      #932 both measured.
//
// **What this gate does not close.** The reflective half is an audit of the trees the corpus
// actually produces, not a proof about the type declarations, and a node-valued field that no
// `.logo` file populates is invisible to reflection. That is what self-check 3 is for — and since
// issue #986 the expected field set is derived a **second** time, from `ast.ts`'s type declarations
// via the TypeScript 7 compiler API (`auditTheDeclarations`), so the declarations and the corpus
// must agree in both directions. Adding a walkable field whose `kind`-and-route is not already
// exercised is therefore still a deliberate **three**-place change — the type declaration,
// `childrenOf`, and `POPULATED_FIELD_PATHS` — after which the gate still fails until a fixture
// exercises it, but now the *first* of those three is read by the gate rather than trusted. A field
// that *shares* a route with an exercised variant is residual 1 below, and fails nothing.
//
// **Two residuals survive that, and both were found by the #986 reviewers rather than predicted.**
//
//   1. **Variants that share a path are indistinguishable.** A path is keyed by node `kind` plus the
//      dotted route, so two declaring shapes that meet at one route merge. Measured: adding
//      `initial?: ExpressionNode` to `MapFilterComprehensionNode` passes 11/11, because
//      `ReduceComprehensionNode.initial` already populates `Comprehension.initial`; adding
//      `key?: ExpressionNode` to `FieldSegment` passes 11/11, because `SelectorSegment.key` already
//      populates `Place.segments[].key`. A route merges only where a **non-node union has two or
//      more descended members** (`PlaceSegment`, `IsTest`) or where **two interfaces share a `kind`**
//      (`Comprehension`) — three merge points. `Binder` is **not** one: its `DestructuringBinderNode`
//      member terminates the path and its `SpannedName` member extends it, so the two cannot collide.
//      Measured: a node-valued field on `SpannedName` fails loudly, naming `ForIn.binder.probe` and
//      `Comprehension.binder.probe` among 17 paths. Closing the real merge points means qualifying
//      paths by each variant's discriminant on **both** sides, which changes the path rule
//      `edgesUnder`, `POPULATED_FIELD_PATHS` and ADR-0025 all share — a redesign of that gate rather
//      than a follow-up to it. Tracked as issue #1004.
//   2. **A node-shaped interface outside `AnyNode`.** The walk starts at `AnyNode`, so the
//      `OL_NODE_KINDS` agreement it enforces is exactly as wide as that union. An interface that does
//      not extend `NodeBase` and appears in no union is invisible here — inert, because `childrenOf`
//      and `walk` are typed and `foreignShapes` would fire if one ever reached a tree, but not
//      something this file checks.
//
// Paths resolve from this file, not from `process.cwd()`, so a package-scoped run still finds the
// corpus.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
// The TypeScript 7 compiler API, used by `auditTheDeclarations` below to read `ast.ts`'s type
// declarations. ADR-0025 deferred this on the belief that the shim "exposes no compiler API"; that
// claim was false and came from looking for the pre-7 `lib/typescript.js` layout instead of reading
// the package's export map. `unstable/*` is the only spelling TypeScript 7 publishes for it.
import {
  API,
  SignatureKind,
  SymbolFlags,
  TypeFlags,
} from "typescript/unstable/sync";
import { OL_NODE_KINDS, parse, walk } from "@openlogo/parser";
// The subject under audit. It is intra-package (`index.ts` exports `ast`, `OL_NODE_KINDS` and
// `walk`, not this), so it is imported from the package's own build output rather than promoted to
// the public surface for a test's benefit. Node resolves this to the same module instance the
// package entry loads, so object identity is shared and the comparison below is meaningful.
import { childrenOf } from "../dist/ast.js";

/**
 * THE NODE-DETECTION ORACLE (assertion 1). Everything this gate concludes rests on it, so it is
 * one named constant rather than a condition inside a helper.
 *
 * A value is a walkable node when its `kind` is in `OL_NODE_KINDS`. That list is the parser's own
 * vocabulary, so the oracle is derived rather than hand-copied — but ADR-0024 records that
 * `OL_NODE_KINDS` agreeing with the `AnyNode` union is *test*-enforced, not compiler-enforced. That
 * is the assumption underneath this gate, stated rather than assumed.
 */
const WALKABLE_NODE_KINDS = new Set(OL_NODE_KINDS);

/**
 * Shapes that carry a `kind` and a `source_span` and are deliberately NOT walkable nodes: the two
 * {@link PlaceSegment} discriminants. A dotted `.field` segment holds only a `SpannedName`; a
 * bracketed `[ key ]` selector holds a key expression, which `childrenOf` returns as a child of the
 * *place*, not of the segment.
 *
 * Anything else kinded and spanned is a node the oracle does not know about, and self-check 2 fails
 * on it. This list is the complete set of exceptions, which is why it is compared as a whole set
 * rather than consulted by a skip.
 */
const KINDED_NON_NODE_SHAPES = ["field", "index"];

/**
 * Every node-valued field path the corpus is expected to populate (self-check 3), as the dotted route
 * from the owning node down to the node it leads to, through any wrapper objects and arrays. Only
 * routes that end at a node are recorded, so `ProcedureDef.params[].defaultValue` appears and
 * `ProcedureDef.params` does not: a corpus full of parameterless procedures leaves the parameter
 * list populated with metadata and contributes no path at all, which is exactly the distinction this
 * list has to make.
 *
 * Both directions are checked. A path here that the corpus stops populating fails, because a clean
 * result could then come from an unexercised field; a path the corpus populates that is missing here
 * fails, because a new walkable field must be seen by a human before this gate certifies it.
 *
 * This list is pinned **once**, against the corpus. Since #986 the corpus set is also compared
 * against one derived from the **type declarations**, and a second assertion pinning this list
 * against that derivation was written and then deleted during review: with both differences asserted
 * empty it had no independent failure state, which is the definition of decorative.
 */
const POPULATED_FIELD_PATHS = [
  "Add.target",
  "Add.value",
  "Assign.place",
  "Assign.value",
  "Block.body[]",
  "Call.args[]",
  "Clear.target",
  "ComparisonChain.operands[]",
  "Comprehension.binder",
  "Comprehension.body",
  "Comprehension.initial",
  "Comprehension.iterable",
  "DictLit.entries[].key",
  "DictLit.entries[].value",
  "ForIn.binder",
  "ForIn.body",
  "ForIn.iterable",
  "ForRange.body",
  "ForRange.by",
  "ForRange.from",
  "ForRange.to",
  "Forever.body",
  "If.condition",
  "If.elseBody",
  "If.thenBody",
  "Insert.index",
  "Insert.target",
  "Insert.value",
  "IsPredicate.operand",
  "IsPredicate.test.collection",
  "IsPredicate.test.high",
  "IsPredicate.test.low",
  "IsPredicate.test.type",
  "ListLit.elements[]",
  "ParenCall.args[]",
  "Place.segments[].key",
  "PostfixExpression.base",
  "PostfixExpression.segments[].key",
  "ProcedureDef.body",
  "ProcedureDef.params[].defaultValue",
  "ProfileStatement.args[]",
  "ProfileStatement.body",
  "Program.body[]",
  "Remove.target",
  "Remove.value",
  "RemoveKey.key",
  "RemoveKey.target",
  "Repeat.body",
  "Repeat.count",
  "Return.value",
  "Throw.value",
  "ValueOfKey.dictionary",
  "ValueOfKey.key",
  "While.body",
  "While.condition",
];

/**
 * The repository root, resolved from this file rather than from `process.cwd()` so a package-scoped
 * run (`cd packages/parser && node --test src/…`) finds the corpus and the `tsconfig.json` below.
 */
const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * How {@link auditTheDeclarations} classifies one declared type, **indexed by priority** so the
 * classification is a subscript rather than a chain of conditionals: a ternary arm that only runs
 * when something is already wrong is dead on a green tree, which is the defect this file rejects
 * everywhere else.
 *
 * A `union` is expanded into its constituents, a `node` ends a path, a `sequence` (an array or a
 * tuple) is walked through its type *arguments*, an `object` is walked through its properties, and
 * everything else is a `leaf`.
 *
 * **Intersections are deliberately absent.** They cannot occur in today's declarations, and giving
 * them an arm would be a recording path no green run executes. Instead they fall to `leaf`, where
 * `TypeFlags.Intersection` breaks {@link EXPECTED_LEAF_TYPE_FLAGS}. That catch covers every
 * **non-object** constructor — `any`, `unknown`, `never`, and the **error type** an unresolved
 * reference produces. It does **not** cover object-flagged ones: a mapped type, a function type and
 * an index-signature type are all `isObjectType()`, so they never reach `leaf` at all. Those are
 * caught instead by `opaqueObjectTypes` (see `objectTypeParts`), and it took a reviewer's
 * counterexample to establish that the leaf net alone did not cover them.
 *
 * A `sequence` is walked by type argument and never by property, which is load-bearing rather than a
 * shortcut: `getPropertiesOfType` on `readonly [number, number]` returns 34 members — `map`,
 * `flatMap`, `at`, `Symbol.iterator` — so descending an array by its properties would walk the whole
 * `Array` prototype surface instead of its elements.
 */
const TYPE_CATEGORIES = ["leaf", "object", "sequence", "node", "union"];

/**
 * The categories {@link auditTheDeclarations} is expected to meet, as a whole set: an unexercised
 * one means the walk stopped reaching a shape it used to reach.
 */
const EXPECTED_TYPE_CATEGORIES = [...TYPE_CATEGORIES].sort();

/**
 * Every `TypeFlags` value a declared **leaf** may carry, as a whole set — the declaration-side twin
 * of {@link EXPECTED_VALUE_TYPES}, and the check that makes "everything else is a leaf" safe rather
 * than a blind spot. `undefined` is an absent optional field; `string`/`number` are `VarRef.name`
 * and `PostfixExpression.parenGroupCount`; the string literals are discriminants such as
 * `Assign.form`; the boolean literals are `IsTest`'s `strict`, which TypeScript models as `true |
 * false`.
 *
 * Written as enum members rather than the numbers they equal, so the list is derived from the
 * compiler's own vocabulary; the values were measured, not predicted, and are 4, 32, 64, 1024 and
 * 8192.
 */
const EXPECTED_LEAF_TYPE_FLAGS = [
  TypeFlags.Undefined,
  TypeFlags.String,
  TypeFlags.Number,
  TypeFlags.StringLiteral,
  TypeFlags.BooleanLiteral,
].sort((left, right) => left - right);

/**
 * The `kind` a value declares as its own **data** property — read from the descriptor, never from
 * the value.
 *
 * `value.kind` looks equivalent and is not: `kind` can be **inherited**, and an inherited accessor is
 * invisible to `fieldsOf`, which enumerates own keys. So a getter on the prototype was never recorded
 * as an accessor *and* ran during the snapshot phase, which is user code in the one phase that
 * claims to invoke none. The #960 reviewer used exactly that to delete a descendant before the
 * snapshot reached it.
 *
 * An inherited `kind` therefore makes a value *not a node* for this gate's purposes, which is the
 * conservative direction: it stops being skipped as a known shape and starts being reported.
 */
const ownDataKindOf = (value) =>
  Reflect.ownKeys(value)
    .filter((key) => key === "kind")
    .map((key) => Object.getOwnPropertyDescriptor(value, key))
    .filter(isDataDescriptor)
    .map((descriptor) => descriptor.value)[0];

const isWalkableNode = (value) => WALKABLE_NODE_KINDS.has(ownDataKindOf(value));

/**
 * Every `typeof` the traversal expects to meet in a node's fields, as a whole set.
 *
 * `object` covers nodes, wrapper objects, arrays and spans; the rest are leaf field values — names,
 * numbers, flags, and absent optional fields. Notably **not** `function`: the reviewer of
 * #960 hid a real `Call` node on a function-valued field, which the object test returns past as a
 * childless leaf, so it was classified and enumerated by nothing at all.
 *
 * No corpus field value is `null` — an earlier version of this comment claimed `object` covered it,
 * which was a guess sitting inside a sentence claiming to be a measurement.
 *
 * This list was predicted and then confirmed by the assertion below, which is what makes it a
 * measurement rather than a guess: it is compared as a whole set, so an unanticipated container
 * class fails here rather than being skipped.
 */
const EXPECTED_VALUE_TYPES = [
  "boolean",
  "number",
  "object",
  "string",
  "undefined",
];

/**
 * How an own property of an intrinsic prototype is classified for the audit below.
 *
 * `unexpected-key` is the general case and the one that matters: every prototype-pollution attack
 * the #960 reviewers built worked by **adding** a key, whatever it then held — a node, a getter
 * returning one, or a plain wrapper object containing one. Comparing against a pristine realm
 * catches all three without needing to recognise any of them.
 *
 * `data-node` and `accessor` remain for a key that *does* exist in a pristine realm but has been
 * given a node, or replaced by a getter that could return one. An accessor is reported, never
 * invoked, which is this gate's rule everywhere else.
 *
 * Array-subscript selection rather than nested ternaries, so no arm goes untaken on a green tree.
 * The `!== null` conjunct is a **guard**, not a recording arm: no intrinsic prototype has a
 * null-valued own data property today, so it never decides anything — but a guard that is
 * unreachable is safe, where a *recording* path that is unreachable is a claim about a case that
 * cannot happen and gets deleted. The file draws that line deliberately.
 */
const canonicalPrototypeFieldKind = (descriptor, isPristineKey) =>
  ["unexpected-key", "accessor", "data-other", "data-node"][
    Number(isPristineKey) *
      (1 +
        Number(Object.hasOwn(descriptor, "value")) *
          (1 +
            Number(
              Object.hasOwn(descriptor, "value") &&
                typeof descriptor.value === "object" &&
                descriptor.value !== null &&
                isWalkableNode(descriptor.value),
            )))
  ];

/** Indexed by the same names the pristine realm reports, so the two sides cannot drift apart. */
const LIVE_INTRINSIC_PROTOTYPES = {
  "Object.prototype": Object.prototype,
  "Array.prototype": Array.prototype,
  "Function.prototype": Function.prototype,
};

/** Orders two nodes by where they start in the source. */
const bySourcePosition = (left, right) =>
  left.source_span.start[0] - right.source_span.start[0] ||
  left.source_span.start[1] - right.source_span.start[1];

/**
 * How many adjacent pairs in `children` are **distinct** nodes sharing a start position — the case a
 * stable sort cannot order, so the comparison below would silently accept either arrangement.
 *
 * The same node appearing twice is excluded deliberately: aliasing is legitimate (a node reachable by
 * two fields must appear twice in its parent's child list), and there is no order to get wrong
 * between a reference and itself.
 */
const tiedStartCount = (children) =>
  children.filter(
    (child, index) =>
      index > 0 &&
      children[index - 1] !== child &&
      bySourcePosition(children[index - 1], child) === 0,
  ).length;

/**
 * A name for the shape of `value`: whether it is an array or a record, and whether its prototype is
 * the exact one that shape is supposed to have — `Array.prototype` for an array, `Object.prototype`
 * for a plain record. Deliberately branch-free: a conditional that only takes its second arm when
 * something is already wrong is dead on a green tree, which is the same defect as a dead recording
 * branch. Every object gets a name and the whole set is compared.
 *
 * A plain record is `object/plain` and an array `array/plain`. A `Map`, a class instance, a
 * null-prototype object, an `Object.create(proto)` result and an **array subclass** are all
 * `…/exotic` — each can hold a node that enumeration will not report, or lie about its own contents
 * through an inherited iterator.
 *
 * **Reads no property of `value`.** An earlier version named the shape with
 * `Object.prototype.toString.call(value)`, which consults `Symbol.toStringTag` and therefore
 * *invokes an inherited getter* — user code, running during the snapshot phase that claims to run
 * none. The #960 reviewer put a `Symbol.toStringTag` getter on a root's prototype that deleted a
 * populated descendant field and then restored the canonical prototype, and the gate passed 9/9.
 * The tag carried no detection power the prototype comparison did not already have — a subclass
 * lying about its tag is caught by its prototype either way — so it is gone rather than deferred.
 * `Object.getPrototypeOf` and `Array.isArray` read internal slots and invoke nothing — **on any value
 * that is not a `Proxy`.** `Object.getPrototypeOf` triggers a proxy's `getPrototypeOf` trap, and the
 * #960 reviewer used exactly that: a proxied `Program.body` that enumerated its own keys truthfully
 * and deleted `Call.args[0]` from the trap, leaving the gate 9/9 green. That is the hostile-`Proxy`
 * residual ADR-0025 records, reached through a second trap rather than through `ownKeys`; no AST
 * here is proxied.
 */
const shapeNameOf = (value) =>
  `${["object", "array"][Number(Array.isArray(value))]}/${
    // Array index rather than a ternary: both names exist unconditionally and one is selected by
    // subscript, so there is no arm that goes untaken while the tree is green.
    ["exotic", "plain"][
      Number(
        Object.getPrototypeOf(value) ===
          expectedPrototypesOf[Number(Array.isArray(value))],
      )
    ]
  }`;

/** Indexed by `Number(Array.isArray(value))`, so the lookup needs no branch. */
const expectedPrototypesOf = [Object.prototype, Array.prototype];

/**
 * `[path, descriptor, key]` for every own property of `value` — symbols included, and with **no key
 * excluded by name**.
 *
 * An earlier version skipped `source_span` here, on the reasoning that a node's span is metadata
 * rather than a child edge. That is true of a *node*, and false of every wrapper object reflection
 * descends through — so `source_span` became an unconditionally ignored hiding place, and the #960
 * reviewer put a declared, populated, node-valued field there and passed the whole gate 8/8 with the
 * node unreachable by both `childrenOf` and `walk`. A name-based exclusion is a blind spot with a
 * name; it does not stop being one because the name is usually metadata.
 *
 * Nothing needs excluding. A `SourceSpan` is a `document` string and two `Position` tuples of
 * numbers, so descending into one finds no nodes and contributes no field path — it costs a
 * traversal and removes the exception.
 */
const fieldsOf = (value, path) =>
  Reflect.ownKeys(value).map((key) => [
    `${path}.${String(key)}`,
    Object.getOwnPropertyDescriptor(value, key),
    key,
  ]);

// A data descriptor always carries `value`; an accessor descriptor carries `get`/`set` instead.
// `Object.hasOwn` is a single always-evaluated expression, where `d.get !== undefined || …` would
// leave a short-circuit arm untaken on a green tree. Array index rather than a ternary for the same
// reason: both names exist unconditionally and one is selected by subscript.
const isDataDescriptor = (descriptor) => Object.hasOwn(descriptor, "value");
const isDataField = (field) => isDataDescriptor(field[1]);
const descriptorKindOf = (field) =>
  ["accessor", "data"][Number(Object.hasOwn(field[1], "value"))];
const pathOfField = (field) => field[0];
const keyOfField = (field) => String(field[2]);
const isIndexField = (field) => isIndexKey(field[2]);
const isNonIndexField = (field) => !isIndexKey(field[2]);

/**
 * The largest value a canonical array index can take. `2 ** 32 - 1` is the maximum `length`, so the
 * highest index is one below it — `"4294967295"` is an ordinary string property, not an index, and a
 * node parked there is somewhere `for…of` will never look.
 */
const ARRAY_LENGTH_LIMIT = 2 ** 32 - 1;

/**
 * True when `key` is a canonical array index — one of the keys array iteration actually reads.
 *
 * The canonical spelling test is the load-bearing half: `"00"`, `"1e2"`, `"-0"` and `" 1"` all
 * *number* to something but are stored as ordinary string properties, so they must be reported, not
 * descended. An earlier draft used `String(Number(key)) === key` alone, which the #960 reviewer
 * broke five ways at once — `"4294967295"`, `"-1"`, `"1.5"`, `"NaN"` and `"Infinity"` all satisfy it
 * and none is an index.
 *
 * The `typeof` conjunct is a **guard**, not a recording arm: an array in a clean AST has only index
 * keys and `"length"`, so it never decides anything today. A guard that is unreachable is safe; a
 * *recording* path that is unreachable is a claim about a case that cannot happen, and gets deleted.
 */
const isIndexKey = (key) =>
  typeof key === "string" &&
  String(Number(key)) === key &&
  Number.isInteger(Number(key)) &&
  Number(key) >= 0 &&
  Number(key) < ARRAY_LENGTH_LIMIT;

/**
 * Every `[path, node]` pair reachable from `value` **without passing through another node** —
 * descending through arrays and through wrapper objects (`DictEntryNode`, `PlaceSegment`, `IsTest`,
 * `ProcedureParam`) but stopping at the first node, which is the child edge itself.
 *
 * Enumeration is `Reflect.ownKeys`, not `Object.entries`, so a symbol-keyed or non-enumerable field
 * is seen rather than silently skipped, and an array's non-index own keys are reported rather than
 * passed over by `for…of`. `seen` collects everything this traversal had to trust: the `kind` of
 * every kinded, spanned non-node; the shape of every object descended into; any accessor property
 * **on a child-bearing field**, which is reported rather than read, since a getter may return a
 * fresh object per call and make identity comparison meaningless; and every non-index key on an
 * array. All of them are compared as whole sets, because a recogniser that skips what it knows is
 * how the unknown case becomes reachable unnoticed.
 *
 * **No property of `value` is ever read during this phase.** Classification uses own *descriptors*
 * only — `kind` from its own data descriptor, `source_span` by key presence — and shape naming uses
 * `Array.isArray` and `Object.getPrototypeOf`, which read internal slots. Three earlier versions
 * each read something and each was defeated through it: a `Symbol.toStringTag` getter, a
 * self-erasing own `kind` getter, and an **inherited** `kind` getter that `fieldsOf` could not see
 * at all because it enumerates own keys. The rule that survived is not "guard each read" but
 * "do not read".
 */
function edgesUnder(value, path, seen, out) {
  // Recorded for **every** value, before any branch, and compared as a whole set. This is what
  // catches a container class the branches below do not have a case for — the #960 reviewer hid a
  // real `Call` node on a **function**-valued field, which `typeof value !== "object"` returns past
  // as a childless leaf, so it was classified by nothing, enumerated by nothing, and invisible to
  // `childrenOf`, to `walk` and to all eight assertions at once.
  //
  // A `typeof value === "function"` branch would have been the obvious fix and is the wrong one
  // twice over: it is a recording arm no green tree ever executes, which is the dead-code defect
  // this file rejects everywhere else, and it closes exactly one container while leaving the next
  // unnamed one open — the per-container blind spot, for the sixth time. Recording the type of
  // every value unconditionally has neither property: nothing is dead, and a container class nobody
  // anticipated breaks the equality rather than being silently skipped.
  //
  // Descending a function would be worse than rejecting it: `fieldsOf` would reach `prototype`,
  // whose `constructor` points back, and recurse forever.
  seen.valueTypes.add(typeof value);
  if (Array.isArray(value)) {
    // Descriptors are snapshotted *first*, before any property of `value` is read. Ordering is
    // load-bearing, not stylistic: the #960 reviewer wrote a getter that, when read, deleted a
    // sibling field holding a real node and replaced itself with a plain data property. Every read
    // is a chance for the subject to change, so the audit records what is there before it touches
    // anything.
    const fields = fieldsOf(value, path);
    for (const field of fields) {
      seen.descriptorKinds.add(descriptorKindOf(field));
    }
    // Read by own key, not by iteration. `for…of` goes through `Symbol.iterator`, which an array
    // subclass or an own property can override to report contents that are not there — and it reads
    // an index through its getter, which this gate refuses to do for object fields for the same
    // reason. Indices are descended by descriptor; every *non*-index own key is reported by name and
    // compared as a whole set against `["length"]`, so an expando, a `"4294967295"`, or an own
    // `Symbol.iterator` breaks the equality instead of slipping past a recogniser. Each of those hid
    // a node from an earlier version of this file with the gate fully green.
    seen.shapes.add(shapeNameOf(value));
    for (const field of fields.filter(isNonIndexField)) {
      seen.arrayKeys.add(keyOfField(field));
    }
    for (const field of fields.filter(isIndexField).filter(isDataField)) {
      edgesUnder(field[1].value, `${path}[]`, seen, out);
    }
    return out;
  }
  // `=== null` is a **guard**: no corpus field value is `null` today, so it never decides anything.
  // Unreachable guards are safe here; unreachable *recording* paths are not, and get deleted.
  if (typeof value !== "object" || value === null) {
    return out;
  }
  // Same ordering rule as the array branch above: snapshot the descriptors before classifying, so a
  // `kind` accessor is recorded as one even if reading it would erase the evidence.
  const fields = fieldsOf(value, path);
  for (const field of fields) {
    seen.descriptorKinds.add(descriptorKindOf(field));
  }
  if (isWalkableNode(value)) {
    out.push([path, value]);
    return out;
  }
  // Classified from the snapshotted own **data** descriptors, never by reading a property — the
  // `source_span` presence test included. An inherited accessor for either is invisible to
  // `fieldsOf` and would run user code here, in the phase that claims to run none.
  const foreignKind = ownDataKindOf(value);
  if (
    typeof foreignKind === "string" &&
    fields.some((field) => keyOfField(field) === "source_span")
  ) {
    seen.foreignShapes.add(foreignKind);
  }
  seen.shapes.add(shapeNameOf(value));
  for (const field of fields.filter(isDataField)) {
    edgesUnder(field[1].value, pathOfField(field), seen, out);
  }
  return out;
}

/**
 * The child edges reflection finds directly on `node` — `[path, child]` in field order, one entry
 * per edge, so an aliased node reachable by two fields appears twice. Multiplicity matters: dropping
 * one of two edges to the same object leaves the object reachable, which is precisely how an earlier
 * version of this gate was defeated.
 */
function reflectedEdgesOf(node, seen) {
  // Own descriptors before **any** property read, for the reason given in `edgesUnder`: a
  // self-erasing accessor cannot be recorded by an audit that has already triggered it. That
  // includes `kind`, which is itself a property — an earlier version read it to build the path
  // prefix, `fieldsOf(node, node.kind)`, and so triggered the very getter it was about to classify.
  // Reading it from its own data descriptor rather than off the object closes the inherited case
  // too, which `fieldsOf` cannot see at all.
  const fields = fieldsOf(node, "");
  for (const field of fields) {
    seen.descriptorKinds.add(descriptorKindOf(field));
  }
  seen.shapes.add(shapeNameOf(node));
  const kind = ownDataKindOf(node);
  const edges = [];
  for (const field of fields.filter(isDataField)) {
    edgesUnder(field[1].value, `${kind}${pathOfField(field)}`, seen, edges);
  }
  return edges;
}

/** Parse every `.logo` file in the repository and audit `walk` against reflection. */
function auditTheCorpus() {
  const roots = ["tests/conformance", "spec/examples", "stdlib"].map((root) =>
    join(REPOSITORY_ROOT, root),
  );
  const seen = {
    foreignShapes: new Set(),
    shapes: new Set(),
    descriptorKinds: new Set(),
    valueTypes: new Set(),
    arrayKeys: new Set(),
  };
  const populated = new Set();
  const kindsSeen = new Set();
  const childListRows = [];
  const visitRows = [];
  const filesPerRoot = new Map();
  let nodeCount = 0;
  let fileCount = 0;

  // Named rather than inlined into the `.map()` calls below, and used on the always-populated paths
  // too, so that neither is a function only a failing tree ever invokes. A projection that runs only
  // when something is already wrong is dead on a green tree, which is the same defect as a dead
  // recording branch — one level further out.
  const pathOf = (edge) => edge[0];
  const kindOf = (node) => node.kind;

  // Phase 2 work, deliberately *not* called during the phase 1 snapshot below: it reads
  // `node.source_span.start`, and a span getter that erases a sibling would then fire before that
  // sibling had been recorded. Same reason `childrenOf` and `bySourcePosition` are phase 2.
  const handles = new Map();
  const handleOf = (node) => {
    if (!handles.has(node)) {
      handles.set(node, handles.size);
    }
    const span = node.source_span;
    return `${node.kind}@${span.start[0]}:${span.start[1]}#${handles.get(node)}`;
  };

  const auditFile = (file, root) => {
    const { ast, diagnostics } = parse(readFileSync(file, "utf8"), file);
    if (diagnostics.length > 0) {
      return;
    }
    fileCount += 1;
    filesPerRoot.set(root, filesPerRoot.get(root) + 1);

    // ---- Phase 1: snapshot the whole reachable graph, reading nothing else. ----
    //
    // Ordering is the load-bearing part of this gate, and it took three separate defeats to get
    // right. Reflection must complete over **every** node before anything else touches the tree,
    // because every read is a chance for the subject to edit the evidence:
    //
    //   - a `walk` that removed a node as it traversed was invisible while `walk` ran first, because
    //     reflection then agreed with the truncated tree;
    //   - a `kind` getter that deleted its node-bearing sibling was invisible while descriptors were
    //     snapshotted after classification;
    //   - and, subtler than both, an *ancestor's* `childrenOf` or a child's `source_span.start`
    //     getter could erase a **descendant's** field while the audit was still walking down to it,
    //     because the old design interleaved reflect-and-compare per node. Snapshotting one node
    //     before reading it is not enough; the graph has to be snapshotted before the graph is read.
    //
    // So phase 1 **reads no property of any value**: `kind` comes from its own data descriptor,
    // `source_span` from key presence, and shape from `Array.isArray` and `Object.getPrototypeOf`.
    // The claim is deliberately about *property reads*, not about builtins — phase 1 also calls
    // `Object.hasOwn`, `Set.prototype.add` and `Array.prototype.filter`, every one of which the
    // subject could have replaced, because this gate runs in the subject's realm. That residual is
    // recorded in ADR-0025 rather than claimed away; an earlier version of this comment said phase 1
    // "calls only `Reflect.ownKeys` and `Object.getOwnPropertyDescriptor`, which invoke no user code
    // at all", and a reviewer falsified it in one build. `childrenOf`, `handleOf`,
    // `bySourcePosition` and `walk` all come after this phase, and do read properties.
    const snapshot = [];
    const edgesByNode = new Map();
    const collect = (node) => {
      const edges = reflectedEdgesOf(node, seen);
      snapshot.push([node, edges]);
      // A **guard**: the corpus contains no aliased node, so this never decides anything today. It
      // exists because an alias would otherwise overwrite its own entry, and the pre-order below
      // reads this map. Unreachable guards are safe; unreachable recording paths are not.
      if (!edgesByNode.has(node)) {
        edgesByNode.set(node, edges);
      }
      for (const edge of edges) {
        collect(edge[1]);
      }
    };
    collect(ast);

    // ---- Phase 2: compare the snapshot against `childrenOf`. ----
    for (const [node, edges] of snapshot) {
      for (const edge of edges) {
        populated.add(pathOf(edge));
      }
      const returned = childrenOf(node);
      // The comparison this gate exists for: what the node itself holds, against what `childrenOf`
      // reports, as order-independent multisets of object identities. Built for every node whether
      // or not it matches, so the row-building code is never dead; the mismatch filter below is what
      // turns rows into findings. Order is checked separately, against source position rather than
      // against reflection's field order — see `outOfOrderChildren`.
      childListRows.push({
        at: node.kind,
        edges: edges.map(pathOf).join(" "),
        reflected: edges
          .map((edge) => handleOf(edge[1]))
          .sort()
          .join(" "),
        returned: returned.map(handleOf).sort().join(" "),
        // `childrenOf` promises its children "in source order" (`ast.ts`), and every traversal built
        // on it inherits that promise — `walk` is pre-order, so the highlighter's semantic tokens
        // and the studio's fold ranges both observe it. The identity multisets above are sorted and
        // so deliberately blind to order, which let a reversed child list pass an earlier version of
        // this gate. Both spellings are computed for every node, so neither is a projection that
        // only a failing tree evaluates; the comparison is against the spans the parser recorded,
        // which is the one ordering that cannot be circular.
        order: returned.map(handleOf).join(" "),
        sourceOrder: [...returned]
          .sort(bySourcePosition)
          .map(handleOf)
          .join(" "),
        // `Array.prototype.sort` is stable, so two children sharing a start position keep
        // `returned`'s order in `sourceOrder` and the order comparison above can never fire for
        // them. There are none today; recording the count means the day one appears, the weakening
        // announces itself instead of going quiet — a green signal certifying less than it appears.
        tiedStarts: tiedStartCount([...returned].sort(bySourcePosition)),
      });
    }

    // The pre-order `walk` is expected to produce, built from the phase 1 snapshot rather than from
    // `childrenOf`, so the comparison below stays non-circular.
    const reflectedNodes = [];
    const buildPreorder = (node) => {
      reflectedNodes.push(node);
      for (const edge of [...edgesByNode.get(node)].sort((left, right) =>
        bySourcePosition(left[1], right[1]),
      )) {
        buildPreorder(edge[1]);
      }
    };
    buildPreorder(ast);

    // ---- Phase 3: run the subject. ----
    const walked = new Set();
    const walkVisits = [];
    walk(ast, (node) => {
      walked.add(node);
      walkVisits.push(node);
    });
    nodeCount += walked.size;
    for (const node of walked) {
      kindsSeen.add(kindOf(node));
    }
    // `walk` retained as the integration check: the per-node comparison above proves each child list
    // is right, and this proves `walk` actually descends them — **in the order it promises**. The
    // sequences are compared as ordered identity sequences, not as sets, not as counts, and not as
    // sorted multisets. Each weaker spelling was tried and each was defeated: counts alone let a
    // traversal visit a *different* population the same number of times; membership alone hides the
    // multiplicity an aliased edge lives in; and sorting both sides — which this file did until the
    // #960 reviewer moved `visit(node)` after the recursion — makes a **post-order** walker
    // indistinguishable from the pre-order one `ast.ts` documents, as it does a reversed sibling
    // traversal. Sorting is the same defect as the sorted child lists two rounds earlier: a
    // comparison that normalises away a property cannot detect a defect in that property.
    //
    // The expected sequence is reflection's own pre-order, recursing through children in source
    // position order — the contract `walk` states — so it is derived from the node fields rather
    // than from `childrenOf`, and the comparison stays non-circular. `tiedStartRows` below asserts
    // no two siblings share a start, which is what makes that ordering total; were a tie to appear,
    // it would fail there rather than making this comparison quietly arbitrary.
    visitRows.push({
      file,
      walked: walkVisits.map(handleOf).join(" "),
      reflected: reflectedNodes.map(handleOf).join(" "),
    });
  };

  const visit = (directory, root) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        visit(full, root);
      } else if (entry.endsWith(".logo")) {
        auditFile(full, root);
      }
    }
  };
  // Seeded with every root, so the count lookups below need no ?? 0 fallback -- a fallback arm
  // that is only taken when a root is missing is dead on a green tree.
  for (const root of roots) {
    filesPerRoot.set(root, 0);
  }
  // Visited unconditionally. An earlier version guarded each root with `existsSync` and collected
  // the missing ones for a named assertion, which put a filter arm here that can only execute on a
  // run that is already red -- the same dead-on-green claim the comment three lines above condemns.
  // The sibling gate `execute-declaration-slots.test.mjs` had reached the opposite answer in this
  // same change, and two files in one diff answering one question two ways is worse than either
  // answer, so this one was deleted rather than argued: a missing root now throws `ENOENT` and names
  // itself, and the per-root floor below is what catches a root that exists but has collapsed.
  for (const root of roots) {
    visit(root, root);
  }

  // `shapeNameOf` proves every value descended into has *exactly* one of these prototypes. That is
  // what rejects a class instance or an array subclass — and it says nothing about what those
  // prototypes themselves hold. The #960 reviewer defeated three successive versions of this check:
  // a real `Call` parked on `Array.prototype` as a data property; then the same node behind a
  // **getter** on `Object.prototype`, whose value is not in the descriptor at all; then a
  // node inside a plain **wrapper object** on `Object.prototype`, which is neither a node nor an
  // accessor and so was classified `data-other` and filtered away. Each fix caught the shape it was
  // shown and missed the next one — the per-container blind spot, at one remove.
  //
  // So this is not a fourth classification. Every one of these attacks works by **adding an own
  // property to an intrinsic prototype**, so the check is that the intrinsic prototypes still have
  // exactly the own keys a *pristine realm* has. `node:vm` gives a fresh realm whose intrinsics
  // nothing has touched, and comparing key sets against it is version-independent by construction:
  // the baseline is computed by the same Node that runs the test, so it cannot drift, and it needs
  // no hand-maintained list of what a prototype is supposed to contain.
  //
  // `Function.prototype` is included, which also closes the reviewer's `node.toString.someProperty`
  // route without auditing every intrinsic reachable from it.
  //
  // The shallow node/accessor classification is kept alongside, because a key-set comparison cannot
  // see a node written over an *existing* intrinsic — though overwriting `Object.prototype.toString`
  // with an AST node breaks the runtime long before it reaches this gate.
  const pristine = runInNewContext(
    "({ 'Object.prototype': Object.prototype, 'Array.prototype': Array.prototype, 'Function.prototype': Function.prototype })",
  );
  const canonicalPrototypeFields = Object.entries(pristine).flatMap(
    ([name, pristinePrototype]) => {
      const live = LIVE_INTRINSIC_PROTOTYPES[name];
      // Compared **by identity**, not by `String(key)`. Well-known symbols are shared across realms
      // (`vm.runInNewContext("Symbol.iterator") === Symbol.iterator`, measured), so identity is
      // available and is the only sound comparison: `String(Symbol("Symbol.iterator"))` is
      // byte-identical to `String(Symbol.iterator)`, so a freshly minted symbol that merely
      // *imitates* a well-known description was classified as pristine and filtered away. The #960
      // reviewer buried a real node under exactly that key and the gate stayed 9/9 green.
      const pristineKeys = new Set(Reflect.ownKeys(pristinePrototype));
      return Reflect.ownKeys(live).map((key) => ({
        at: `${name}.${String(key)}`,
        kind: canonicalPrototypeFieldKind(
          Object.getOwnPropertyDescriptor(live, key),
          pristineKeys.has(key),
        ),
      }));
    },
  );

  return {
    prototypeAnomalies: canonicalPrototypeFields
      .filter((row) => row.kind !== "data-other")
      .sort((left, right) => left.at.localeCompare(right.at)),
    mismatchedChildLists: childListRows.filter(
      (row) => row.reflected !== row.returned,
    ),
    outOfOrderChildren: childListRows.filter(
      (row) => row.order !== row.sourceOrder,
    ),
    tiedStartRows: childListRows.filter((row) => row.tiedStarts > 0),
    visitMismatches: visitRows.filter((row) => row.walked !== row.reflected),
    foreignShapes: [...seen.foreignShapes].sort(),
    shapes: [...seen.shapes].sort(),
    descriptorKinds: [...seen.descriptorKinds].sort(),
    valueTypes: [...seen.valueTypes].sort(),
    arrayKeys: [...seen.arrayKeys].sort(),
    thinRoots: roots.filter((root) => filesPerRoot.get(root) < 3),
    populated: [...populated].sort(),
    kindsSeen: [...kindsSeen].sort(),
    nodeCount,
    fileCount,
  };
}

/**
 * Every node-valued field path the **type declarations** declare, derived from `ast.ts` by the
 * TypeScript 7 compiler API (issue #986).
 *
 * This is the second source `POPULATED_FIELD_PATHS` is compared against, and it is the one that can
 * see what reflection cannot. Reflection reads the trees the corpus produces, so a declared field no
 * fixture populates contributes nothing and is indistinguishable from a field that does not exist —
 * exactly the "green signal certifying less than it appears to" shape. A declaration walk has the
 * mirror-image blind spot (it knows nothing about what runs), so the two together pin the set from
 * both ends: `declared \ populated` is an unexercised field, `populated \ declared` is a tree that
 * disagrees with its own types.
 *
 * **It applies the same path rule as {@link edgesUnder}, and the same node oracle.** A path is the
 * dotted route from the owning kind through wrappers and arrays to the first type that is a node, so
 * `ProcedureDef.params[].defaultValue` is distinct from `ProcedureDef.params`. That granularity is
 * the whole point: attributing a wrapper-held node to the holder's field collapses these 55 paths to
 * 51 (measured) and hides whether the wrapper's own node-valued part is ever exercised.
 *
 * **What it does not remove.** Both sides ask {@link WALKABLE_NODE_KINDS} what a node is, so the
 * `OL_NODE_KINDS`/`AnyNode` agreement ADR-0024 leaves test-enforced is still the assumption
 * underneath — but this walk reaches `AnyNode` itself, so `kinds` below *is* that enforcement, made
 * from the declarations rather than assumed.
 *
 * **Termination is measured, not argued.** Wrapper types form a DAG today, so the walk terminates;
 * rather than assert that, every descent filters out types already on the current chain and counts
 * what it removed, and `cyclicEdges` is asserted to be 0. A counted filter costs nothing on a green
 * tree, where an `if (cycle) throw` arm would be a recording path no green run executes.
 */
function auditTheDeclarations() {
  const configFile = join(
    REPOSITORY_ROOT,
    "packages",
    "parser",
    "tsconfig.json",
  );
  const api = new API({ cwd: REPOSITORY_ROOT });
  try {
    const projects = api
      .updateSnapshot({ openProjects: [configFile] })
      .getProjects();
    const checker = projects[0].checker;

    /**
     * The kind a *type* declares, read from its `kind` property's string-literal type — the
     * declaration-side twin of {@link ownDataKindOf}, filtered rather than branched so no arm is
     * reachable only on a broken tree. A type with no `kind`, or a `kind` that is not a single
     * literal, yields `undefined` and is therefore not a node.
     */
    const declaredKindOf = (type) =>
      checker
        .getPropertiesOfType(type)
        .filter((property) => property.name === "kind")
        .map((property) => checker.getTypeOfSymbol(property))
        .filter((kindType) => kindType.isStringLiteralType())
        .map((kindType) => kindType.value)[0];

    // Priority by subscript, exactly as `canonicalPrototypeFieldKind` does it: every term is
    // evaluated and the largest wins, so there is no untaken arm. `node` outranks `sequence` and
    // `object` because a node ends a path.
    //
    // `union` outranks `node` so that a union is expanded rather than terminated. **That contest is
    // currently never held** — measured: the number of types classified `union` whose
    // `declaredKindOf` is also a node kind is 0, because TypeScript flattens nested unions, so
    // `ComprehensionNode` (whose two members both declare `kind: "Comprehension"`) never appears as
    // a type object in this walk; `MapFilterComprehensionNode` and `ReduceComprehensionNode` are
    // direct members of `AnyNode`. An earlier version of this comment claimed the ordering was what
    // found `ReduceComprehensionNode.initial`, and the #986 reviewer measured that false twice over:
    // that path comes from the top-level `AnyNode` loop, and the union arm — which the ordering does
    // select — descends to two members that are each `node`, so it terminates without reaching
    // `initial` either way. The ordering is defensive, not load-bearing.
    //
    // `sequence` is `isArrayType`/`isTupleType`, **not** `ObjectFlags.Reference`. Reference covers
    // every generic instantiation, so an ordinary generic wrapper — `Box<BlockNode>` — was walked
    // through its type arguments and derived `field[]` where reflection derives `field.value`. That
    // rejected a valid shape, which is worse than missing an invalid one.
    const categoryOf = (type) =>
      TYPE_CATEGORIES[
        Math.max(
          Number(type.isUnionType()) * 4,
          Number(WALKABLE_NODE_KINDS.has(declaredKindOf(type))) * 3,
          Math.max(
            Number(checker.isArrayType(type)),
            Number(checker.isTupleType(type)),
          ) * 2,
          Number(type.isObjectType()),
          0,
        )
      ];

    /**
     * What each type classified `object` carries **beyond** the properties
     * {@link walkDeclaredType}'s `object` arm descends. A TypeScript object type is described by four
     * things — properties, index infos, call signatures and construct signatures — so recording the
     * other three per path states the whole remainder as an invariant, rather than as a list of
     * shapes that have caught someone out.
     *
     * The scope is the `object` **category**, not every `isObjectType()` type: a node and a sequence
     * outrank that arm and are descended by their own rules, which is why nothing here has to
     * special-case them.
     *
     * The #986 reviewers hid a `BlockNode` behind each of `() => BlockNode`,
     * `Record<string, BlockNode>` and `{ readonly [key: string]: BlockNode }` — all three are object
     * types with **zero** properties, so `descend([])` visited nothing and the gate stayed 11/11
     * green. That is the per-container blind spot ADR-0025 records at length, reproduced inside
     * the instrument built to close it.
     *
     * Testing "has no properties" would have closed exactly those three and left a type that carries
     * both open — `{ a: string; [k: string]: unknown }` has a property *and* an index signature.
     *
     * A row is recorded for **every** such type and the offenders are filtered out at the end, for
     * the same reason `childListRows` is built for every node: a `push` that only runs on a tree that
     * is already broken is a recording arm no green run executes, which the coverage gate catches and
     * this file rejects on its own terms. A first draft did exactly that and was caught by neither
     * reviewer — only by `npm run coverage` naming the six dead lines.
     *
     * A lib generic that is not an array — `Map`, `Set`, `Promise` — takes the `object` arm and is
     * reported through its prototype methods, one opaque row per call signature
     * (`…probeMap.forEach`, `.get`, `.has`, `.entries`, …). That is loud rather than silent, which is
     * the point, but the offending field is the path two segments **up** from the rows.
     */
    const objectTypeParts = (type, path) => ({
      at: path,
      indexSignatures: checker.getIndexInfosOfType(type).length,
      callSignatures: checker.getSignaturesOfType(type, SignatureKind.Call)
        .length,
      constructSignatures: checker.getSignaturesOfType(
        type,
        SignatureKind.Construct,
      ).length,
    });

    const seen = { categories: new Set(), leafTypeFlags: new Set() };
    const typeVisits = [];
    const objectTypeRows = [];
    const paths = new Set();
    const kinds = new Set();
    let cyclicEdges = 0;

    const walkDeclaredType = (type, path, chain) => {
      const category = categoryOf(type);
      seen.categories.add(category);
      // Recorded for every type, before any dispatch, so an unresolved reference is reported by
      // name rather than only as an anomalous flag in `leafTypeFlags`. `isErrorType()` is the
      // compiler's own answer to "this reference did not resolve", which is the failure that would
      // otherwise make this whole derivation quietly smaller than the declarations it reads.
      typeVisits.push({ at: path, unresolved: type.isErrorType() });
      const nextChain = new Set(chain).add(type.id);
      const descend = (edges) => {
        const fresh = edges.filter((edge) => !nextChain.has(edge[0].id));
        cyclicEdges += edges.length - fresh.length;
        for (const edge of fresh) {
          walkDeclaredType(edge[0], edge[1], nextChain);
        }
      };
      ({
        union: () => descend(type.getTypes().map((member) => [member, path])),
        node: () => paths.add(path),
        sequence: () =>
          descend(
            checker
              .getTypeArguments(type)
              .map((argument) => [argument, `${path}[]`]),
          ),
        object: () => {
          objectTypeRows.push(objectTypeParts(type, path));
          descend(
            checker
              .getPropertiesOfType(type)
              .map((property) => [
                checker.getTypeOfSymbol(property),
                `${path}.${property.name}`,
              ]),
          );
        },
        leaf: () => seen.leafTypeFlags.add(type.flags),
      })[category]();
    };

    // `AnyNode` is the declarations' own answer to "what is a node", so the walk starts there rather
    // than from a list of interface names kept here — a list would be the hand-maintained oracle
    // this instrument exists to replace.
    const anyNode = checker.getDeclaredTypeOfSymbol(
      checker.resolveName("AnyNode", SymbolFlags.Type, {
        document: join(REPOSITORY_ROOT, "packages", "parser", "src", "ast.ts"),
        position: 0,
      }),
    );
    for (const member of anyNode.getTypes()) {
      const kind = declaredKindOf(member);
      kinds.add(kind);
      for (const property of checker.getPropertiesOfType(member)) {
        walkDeclaredType(
          checker.getTypeOfSymbol(property),
          `${kind}.${property.name}`,
          new Set(),
        );
      }
    }

    return {
      paths: [...paths].sort(),
      kinds: [...kinds].sort(),
      categories: [...seen.categories].sort(),
      leafTypeFlags: [...seen.leafTypeFlags].sort(
        (left, right) => left - right,
      ),
      unresolvedTypes: typeVisits.filter((visit) => visit.unresolved),
      opaqueObjectTypes: objectTypeRows.filter(
        (row) =>
          row.indexSignatures + row.callSignatures + row.constructSignatures >
          0,
      ),
      typeVisitCount: typeVisits.length,
      cyclicEdges,
      projectCount: projects.length,
      configFileName: projects[0].configFileName.replaceAll("\\", "/"),
      expectedConfigFileName: configFile.replaceAll("\\", "/"),
    };
  } finally {
    // The API runs a `tsgo` child process; without this the test run finishes and never exits. If
    // `close()` itself throws it would mask an in-flight error — no measured path does, and a
    // try/catch here would be a recording arm no green run executes.
    api.close();
  }
}

const audit = auditTheCorpus();
const declarations = auditTheDeclarations();

// The two derivations, differenced both ways so a failure names the direction as well as the path.
// Computed unconditionally rather than inside the assertions: a projection only a failing tree
// evaluates is dead on a green one.
const populatedFieldPaths = new Set(audit.populated);
const declaredFieldPaths = new Set(declarations.paths);
const declaredButUnpopulated = declarations.paths.filter(
  (path) => !populatedFieldPaths.has(path),
);
const populatedButUndeclared = audit.populated.filter(
  (path) => !declaredFieldPaths.has(path),
);

test("every node's child list is exactly the edges the node itself holds", () => {
  // The comparison this gate exists for, and the one that has to be by identity and multiplicity
  // rather than membership. An earlier version compared reachable *sets* and was defeated three
  // ways by the #960 reviewer: an aliased edge dropped while the node stayed reachable by its other
  // route, a spurious grandchild added to a parent's list, and a node hidden in a container
  // `Object.entries` does not enumerate. Each row carries the field paths, so a failure names the
  // edge rather than only the kind.
  assert.deepEqual(audit.mismatchedChildLists, []);
});

test("`walk` visits exactly the nodes the child lists declare, as often", () => {
  // Compared per file as identity multisets, not counts and not membership. Counts alone let a
  // traversal visit a *different* set the same number of times — the #960 reviewer built exactly
  // that. Membership alone hides multiplicity, which is where an aliased edge lives: a node
  // reachable by two fields is listed twice and visited twice, and that is legitimate.
  assert.deepEqual(audit.visitMismatches, []);
});

test("no kinded, spanned shape outside the oracle appears anywhere in the corpus", () => {
  // Self-check 2 — fail, do not skip. `WALKABLE_NODE_KINDS` is the oracle everything here rests on;
  // a new kinded shape it does not know about would be silently invisible to this gate, so it is
  // compared as a whole set and any newcomer breaks this equality.
  assert.deepEqual(audit.foreignShapes, KINDED_NON_NODE_SHAPES);
});

test("every child list is in source order, as `childrenOf` promises", () => {
  // Sorting the identity multisets above deliberately ignores order, so the "in source order"
  // contract is asserted here on its own, against the spans the parser recorded rather than against
  // reflection's field order — the one comparison that cannot be circular. Every traversal built on
  // `childrenOf` inherits the promise: the highlighter's semantic tokens and the studio's fold
  // ranges both consume it. Reversing a child list passed an earlier version of this gate.
  assert.deepEqual(audit.outOfOrderChildren, []);
  // And no two siblings share a start position, which is what makes the comparison above total:
  // `sort` is stable, so a tied pair would keep `returned`'s own order and could never disagree.
  assert.deepEqual(audit.tiedStartRows, []);
});

test("a node aliased by two fields is a tie with itself, and legitimate", () => {
  // The exemption in `tiedStartCount` exists for exactly one case — aliasing — and until the #960
  // reviewer pointed it out, *nothing exercised it*. ADR-0025 promised that a correct alias "must
  // pass" and no test made that promise fail if it stopped being true, which is an unenforced
  // assertion of precisely the kind this saga exists to remove. The corpus cannot supply the case:
  // the parser makes a fresh object per source position, so no natural alias occurs.
  //
  // Aliasing is legitimate — a node reachable by two fields must appear twice in its parent's child
  // list, and `walk` must visit it twice — so this is a *regression* case, asserting the gate does
  // not fail on valid input. A gate that rejects valid input is worse than one that misses invalid
  // input, and an earlier draft of this file did exactly that.
  const span = (line, column) => ({
    document: "test",
    start: [line, column],
    end: [line, column + 1],
  });
  const aliased = { kind: "NumberLit", source_span: span(1, 1), value: 1 };
  const distinct = { kind: "NumberLit", source_span: span(1, 1), value: 2 };
  const later = { kind: "NumberLit", source_span: span(2, 1), value: 3 };

  // The same object twice: no order to get wrong between a reference and itself.
  assert.equal(tiedStartCount([aliased, aliased]), 0);
  // Two *distinct* nodes sharing a start: a real tie, which a stable sort cannot order, so the
  // source-order comparison could silently accept either arrangement. This is the case the
  // assertion above is guarding against ever appearing unnoticed.
  assert.equal(tiedStartCount([distinct, aliased]), 1);
  // And an ordinary pair with different starts is not a tie either way round.
  assert.equal(tiedStartCount([aliased, later]), 0);
});

test("reflection reads every own key of the shapes it descends", () => {
  // `Object.entries` reads enumerable string keys of a plain object and nothing else, so a `Map`, a
  // class instance, a null-prototype object or an `Object.create(proto)` result would be silently
  // childless to this gate — the defect it exists to catch, reproduced inside the instrument.
  // Enumeration is `Reflect.ownKeys` (symbols and non-enumerables included) and every prototype
  // descended into is compared as a whole set — arrays included, which is what rejects an array
  // *subclass* holding a node behind an inherited getter. Hardening the object branch alone left
  // that cross-product open, with the gate fully green.
  //
  // The residual, stated rather than papered over: a `Proxy` whose `ownKeys` trap lies is
  // undetectable from userland and would still hide a node. That is a limit of reflection itself,
  // not of this implementation, and no AST here is proxied.
  assert.deepEqual(audit.shapes, ["array/plain", "object/plain"]);
  // A getter is never invoked — it may return a fresh object per call, which would make identity
  // comparison meaningless — so every field's descriptor kind is recorded and the whole set is
  // compared. Recorded for *every* field, unconditionally: an earlier spelling collected only the
  // accessors, `fields.filter(isAccessor).map(pathOfField)`, which is a projection that runs solely
  // on a tree that is already broken. That is dead on a green tree in exactly the way this file
  // rejects elsewhere, and it is why the shape and array-key checks are whole-set comparisons too.
  // The trade is deliberate: the failure names the kind rather than the offending path, which is
  // the same trade `shapes` and `arrayKeys` already make.
  //
  // This holds for array *indices* too, which are read from their descriptors rather than by
  // `for…of` — an earlier version made this claim while its array branch read indices through
  // iteration, so the sentence was true of objects and false of arrays.
  assert.deepEqual(audit.descriptorKinds, ["data"]);
  // Arrays are enumerated by own key, so their non-index own keys are reported rather than passed
  // over: a node parked on an expando, on `"4294967295"` (one past the last real index, and an
  // ordinary string property), or behind an own `Symbol.iterator` that lies about the contents
  // breaks this equality instead of slipping past. `Reflect.ownKeys` reads all of these perfectly
  // well, so unlike the `Proxy` above this is a case the gate closes rather than concedes.
  assert.deepEqual(audit.arrayKeys, ["length"]);
  // And every value the traversal met was one of the types it has a case for. A container class the
  // branches do not name — the reviewer used a **function**, which `typeof value !== "object"`
  // returns past as a childless leaf — is otherwise classified by nothing and enumerated by
  // nothing. Recorded unconditionally rather than as a `typeof === "function"` branch, which would
  // be a recording arm no green tree executes and would close one container while leaving the next
  // unnamed one open.
  assert.deepEqual(audit.valueTypes, EXPECTED_VALUE_TYPES);
  // And the intrinsic prototypes are still the ones a pristine realm ships. Asserting that every
  // value *has* `Object.prototype` or `Array.prototype` says nothing about what those objects
  // contain, and three successive versions of this check were defeated in turn: a node parked on
  // `Array.prototype` as a data property, then the same node behind a **getter** whose value is not
  // in the descriptor, then a node inside a plain **wrapper object** that is neither. Each fix
  // recognised the shape it had been shown.
  //
  // The general property is that all three *add a key*, so the baseline is a fresh realm's own-key
  // set rather than a hand-maintained list. It cannot drift, because the same Node computes both
  // sides. The three accessors below are the ones a pristine realm ships — `__proto__` on
  // `Object.prototype`, and the poisoned `caller`/`arguments` pair on `Function.prototype`. That
  // last pair is the argument for measuring the baseline rather than predicting it: this assertion
  // was written expecting one entry. Sorted by path, so the comparison does not depend on the order
  // `Reflect.ownKeys` happens to report.
  assert.deepEqual(audit.prototypeAnomalies, [
    { at: "Function.prototype.arguments", kind: "accessor" },
    { at: "Function.prototype.caller", kind: "accessor" },
    { at: "Object.prototype.__proto__", kind: "accessor" },
  ]);
  // Which is only exhaustive if these are the whole inherited surface of what this gate descends
  // into, so pin it from every side rather than assuming it: `shapes` above proves every descended
  // value has exactly `Object.prototype` or `Array.prototype`, `valueTypes` proves no function is
  // ever descended, `Function.prototype` is audited anyway, and this proves the chain above them
  // terminates. Without the last one, re-pointing `Array.prototype`'s own prototype at a
  // node-bearing object would reopen the gap one level up.
  assert.equal(Object.getPrototypeOf(Array.prototype), Object.prototype);
  assert.equal(Object.getPrototypeOf(Object.prototype), null);
});

test("every corpus root this gate claims to read still contributes files", () => {
  // A mistyped or moved root would make the audit quietly smaller rather than absent, and every
  // assertion here is satisfied by an empty audit. A missing root is not checked here at all: the
  // traversal above visits each one unconditionally, so it throws `ENOENT` naming the path.
  //
  // The floor is per root, not per corpus, because the whole-corpus floors cannot see one root
  // collapsing — `tests/conformance` saturates every path, kind and floor on its own.
  //
  // State precisely what it does and does not buy, because an earlier wording ("a root can shrink,
  // but only loudly") was measurably false and the #960 reviewer measured it: `spec/examples` 13 → 3
  // and `stdlib` 6 → 3 together drop 68% of the non-conformance corpus with both gates fully green.
  // A floor catches a root that has *collapsed*; it does not catch one that has merely shrunk. The
  // alternative is a census, which asserts a count nothing re-derives and fails on ordinary growth
  // — the trade is deliberate, and overstating it is what turns an accepted limit into a false
  // claim.
  assert.deepEqual(audit.thinRoots, []);
});

test("the corpus populates exactly the declared node-valued field paths", () => {
  // Self-check 3 — corpus adequacy, in both directions. Without it, a green run over a corpus that
  // never exercises a field is indistinguishable from a green run over a correct implementation.
  assert.deepEqual(audit.populated, [...POPULATED_FIELD_PATHS].sort());
});

test("the type declarations and the corpus agree on every field path", () => {
  // Issue #986. `POPULATED_FIELD_PATHS` is a list a human maintains, and the test above compares it
  // against one derivation. That leaves the declarations — the source a new field is actually added
  // to — consulted by nobody, which is the #964 shape: the list could be complete about the corpus
  // and silent about `ast.ts`.
  //
  // Differenced both ways, because the two directions are different defects. A declared path the
  // corpus never populates is an unexercised field, and every other assertion in this file stays
  // green about it — reflection cannot report a field no tree carries. A populated path the
  // declarations do not have is a tree disagreeing with its own types.
  assert.deepEqual(declaredButUnpopulated, []);
  assert.deepEqual(populatedButUndeclared, []);
});

test("the declaration walk resolved every type it read", () => {
  // A derivation that silently resolved nothing satisfies `declaredButUnpopulated` trivially — the
  // empty set is a subset of everything — so the walk states what it met rather than only what it
  // concluded.
  //
  // An unresolved reference yields the compiler's error type, which is the one way this walk can
  // come back smaller than the declarations without anything looking wrong.
  assert.deepEqual(declarations.unresolvedTypes, []);
  // And nothing an object type carries went undescended. The `object` arm reads
  // `getPropertiesOfType` and nothing else, so a node behind an index signature, a call signature or
  // a construct signature is invisible to it — the #986 reviewers hid one behind each of
  // `() => BlockNode`, `Record<string, BlockNode>` and `{ readonly [key: string]: BlockNode }`, all
  // three of which have zero properties, and the gate stayed 11/11 green. Measured 0 rows today, so
  // this costs nothing on a green tree and is not a recording arm.
  assert.deepEqual(declarations.opaqueObjectTypes, []);
  // Every leaf's flags as a whole set. This is what makes "everything else is a leaf" safe for the
  // **non-object** constructors: an intersection, an `any`, an `unknown`, a `never` or the error
  // type all land here and break the equality. Object-flagged constructors never reach `leaf` and
  // are the assertion above's job — an earlier version of this comment claimed this one covered
  // mapped types, which a reviewer measured false.
  assert.deepEqual(declarations.leafTypeFlags, EXPECTED_LEAF_TYPE_FLAGS);
  // And every category was actually exercised, so none of the five arms is carrying no traffic.
  assert.deepEqual(declarations.categories, EXPECTED_TYPE_CATEGORIES);
  // Wrapper types form a DAG, measured rather than argued — see `auditTheDeclarations`. A non-zero
  // count is a notification, not a bug: it means a wrapper type became recursive, the walk stopped
  // early to stay terminating, and the DAG assumption above has to be re-stated before this is
  // relaxed.
  assert.equal(declarations.cyclicEdges, 0);
  // The walk started from `AnyNode`, so the kinds it reached are the union's own membership. ADR-0024
  // records that `OL_NODE_KINDS` agreeing with `AnyNode` is test-enforced rather than
  // compiler-enforced, and names no test; this is that test. The oracle `WALKABLE_NODE_KINDS` — which
  // both halves of this gate rest on — is exactly `OL_NODE_KINDS`, so a kind in one list and not the
  // other would make one of the two halves blind, in the direction that reports nothing. The
  // enforcement is exactly as wide as `AnyNode`; residual 2 in the header states what that leaves.
  assert.deepEqual(declarations.kinds, [...OL_NODE_KINDS].sort());
  // Exactly one project was opened, and it is the one this gate names. A snapshot that silently
  // resolved a different `tsconfig.json` would read different declarations.
  assert.equal(declarations.projectCount, 1);
  assert.equal(
    declarations.configFileName,
    declarations.expectedConfigFileName,
  );
  // A floor, not a census: it only fails on a walk that has collapsed, so ordinary growth in `ast.ts`
  // never touches it and no derived count is asserted.
  assert.ok(
    declarations.typeVisitCount > 1000,
    `visited ${declarations.typeVisitCount} declared types`,
  );
});

test("the audit actually traversed the corpus, reaching every node kind", () => {
  // A gate that silently measured nothing is the failure mode every assertion above shares: an
  // empty audit satisfies all of them. The kind census is the sharper half — adequacy in the
  // dimension `POPULATED_FIELD_PATHS` cannot express, since a kind the corpus never instantiates
  // contributes no field paths to be missing from the declared list in the first place.
  assert.deepEqual(audit.kindsSeen, [...OL_NODE_KINDS].sort());
  // Floors, not a census: they only ever fail on a *shrinking* corpus, so ordinary growth never
  // touches them and no derived count is asserted. Raised from a laxer pair after the #960 reviewer
  // measured that the originals had enough headroom to absorb losing an entire corpus root.
  assert.ok(audit.fileCount > 800, `parsed ${audit.fileCount} files`);
  assert.ok(audit.nodeCount > 9000, `visited ${audit.nodeCount} nodes`);
});

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
// **What this gate does not close.** It is an audit of the trees the corpus actually produces, not a
// proof about the type declarations. A node-valued field that no `.logo` file populates is invisible
// to reflection — which is exactly why self-check 3 exists, and why `POPULATED_FIELD_PATHS` makes
// adding a walkable field a deliberate **three**-place change: the type declaration, `childrenOf`,
// and the declared path list here — after which the gate still fails until a fixture exercises it.
//
// Paths resolve from this file, not from `process.cwd()`, so a package-scoped run still finds the
// corpus.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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
 * `Object.getPrototypeOf` and `Array.isArray` read internal slots and invoke nothing.
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
  const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  const roots = ["tests/conformance", "spec/examples", "stdlib"].map((root) =>
    join(repositoryRoot, root),
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
    // So phase 1 calls only `Reflect.ownKeys` and `Object.getOwnPropertyDescriptor`, which invoke no
    // user code at all. `childrenOf`, `handleOf`, `bySourcePosition` and `walk` all come after it.
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

const audit = auditTheCorpus();

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

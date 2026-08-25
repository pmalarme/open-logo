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
// to reflection — which is exactly why self-check 3 exists, and why `POPULATED_FIELD_PATHS` is a
// deliberate two-place change: adding a walkable field means declaring it here, and the gate then
// fails until a fixture exercises it *and* `childrenOf` returns it.
//
// Paths resolve from this file, not from `process.cwd()`, so a package-scoped run still finds the
// corpus.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

const isWalkableNode = (value) => WALKABLE_NODE_KINDS.has(value.kind);

/**
 * Every `[path, node]` pair reachable from `value` **without passing through another node** —
 * descending through arrays and through wrapper objects (`DictEntryNode`, `PlaceSegment`, `IsTest`,
 * `ProcedureParam`) but stopping at the first node, which is the child edge itself.
 *
 * `foreignShapes` collects any kinded, spanned wrapper it passes through and `containerTags` every
 * non-node object it descends into, so both can be compared as whole sets rather than consulted by a
 * recogniser that silently skips what it knows.
 */
function edgesUnder(value, path, seen, out) {
  if (Array.isArray(value)) {
    for (const item of value) {
      edgesUnder(item, `${path}[]`, seen, out);
    }
    return out;
  }
  if (typeof value !== "object" || value === null) {
    return out;
  }
  if (isWalkableNode(value)) {
    out.push([path, value]);
    return out;
  }
  if (typeof value.kind === "string" && value.source_span !== undefined) {
    seen.foreignShapes.add(value.kind);
  }
  // Every container reflection descends into is tagged and compared as a whole set. Without this a
  // `Map`, `Set` or any other object `Object.entries` does not enumerate would be treated as
  // childless and its nodes would be invisible to this gate — which is exactly the silence it
  // exists to detect, reproduced inside the instrument. Found by the #960 reviewer, which defeated
  // an earlier version of this file with a `BlockNode` inside a populated `ReadonlyMap`.
  seen.containerTags.add(Object.prototype.toString.call(value));
  for (const [key, inner] of Object.entries(value)) {
    if (key !== "source_span") {
      edgesUnder(inner, `${path}.${key}`, seen, out);
    }
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
  const edges = [];
  for (const [field, value] of Object.entries(node)) {
    if (field !== "kind" && field !== "source_span") {
      edgesUnder(value, `${node.kind}.${field}`, seen, edges);
    }
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
  const seen = { foreignShapes: new Set(), containerTags: new Set() };
  const populated = new Set();
  const kindsSeen = new Set();
  const childListRows = [];
  const unreachedByWalk = [];
  let nodeCount = 0;
  let fileCount = 0;

  // Named rather than inlined into the `.map()` calls below, and used on the always-populated paths
  // too, so that neither is a function only a failing tree ever invokes. A projection that runs only
  // when something is already wrong is dead on a green tree, which is the same defect as a dead
  // recording branch — one level further out.
  const pathOf = (edge) => edge[0];
  const kindOf = (node) => node.kind;

  // A stable per-object handle, so a child list can be compared by *identity and multiplicity*
  // rather than by membership. Two edges to the same object must appear twice; dropping one of them
  // leaves the object reachable by the other and is invisible to any set comparison.
  const handles = new Map();
  const handleOf = (node) => {
    if (!handles.has(node)) {
      handles.set(node, handles.size);
    }
    const span = node.source_span;
    return `${node.kind}@${span.start[0]}:${span.start[1]}#${handles.get(node)}`;
  };

  const auditNode = (node, reflectedNodes) => {
    reflectedNodes.push(node);
    const edges = reflectedEdgesOf(node, seen);
    for (const edge of edges) {
      populated.add(pathOf(edge));
    }
    // The comparison this gate exists for: what the node itself holds, against what `childrenOf`
    // reports, as order-independent multisets of object identities. Built for every node whether or
    // not it matches, so the row-building code is never dead; the mismatch filter below is what
    // turns rows into findings.
    childListRows.push({
      at: node.kind,
      edges: edges.map(pathOf).join(" "),
      reflected: edges
        .map((edge) => handleOf(edge[1]))
        .sort()
        .join(" "),
      returned: childrenOf(node).map(handleOf).sort().join(" "),
    });
    for (const edge of edges) {
      auditNode(edge[1], reflectedNodes);
    }
  };

  const auditFile = (file) => {
    const { ast, diagnostics } = parse(readFileSync(file, "utf8"), file);
    if (diagnostics.length > 0) {
      return;
    }
    fileCount += 1;
    const walked = new Set();
    walk(ast, (node) => walked.add(node));
    nodeCount += walked.size;
    for (const node of walked) {
      kindsSeen.add(kindOf(node));
    }
    const reflectedNodes = [];
    auditNode(ast, reflectedNodes);
    // `walk` retained as an integration check: the per-node comparison above proves each child list
    // is right, and this proves `walk` actually descends them. Spread-pushed from a filter with no
    // loop body, so nothing here is dead on a green tree — but note that coverage cannot reach these
    // projections on a passing run either way. The mutants recorded in ADR-0025 are what discharge
    // the recording paths; 100% coverage of this file is not evidence that they work.
    unreachedByWalk.push(
      ...reflectedNodes.filter((node) => !walked.has(node)).map(kindOf),
    );
  };

  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
      } else if (entry.endsWith(".logo")) {
        auditFile(full);
      }
    }
  };
  const missingRoots = roots.filter((root) => !existsSync(root));
  for (const root of roots.filter((root) => existsSync(root))) {
    visit(root);
  }

  return {
    mismatchedChildLists: childListRows.filter(
      (row) => row.reflected !== row.returned,
    ),
    unreachedByWalk: [...new Set(unreachedByWalk)].sort(),
    foreignShapes: [...seen.foreignShapes].sort(),
    containerTags: [...seen.containerTags].sort(),
    missingRoots,
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

test("`walk` descends every child edge the child lists declare", () => {
  // The integration half: the assertion above proves each child list is correct, this proves the
  // traversal built on it actually visits them.
  assert.deepEqual(audit.unreachedByWalk, []);
});

test("no kinded, spanned shape outside the oracle appears anywhere in the corpus", () => {
  // Self-check 2 — fail, do not skip. `WALKABLE_NODE_KINDS` is the oracle everything here rests on;
  // a new kinded shape it does not know about would be silently invisible to this gate, so it is
  // compared as a whole set and any newcomer breaks this equality.
  assert.deepEqual(audit.foreignShapes, KINDED_NON_NODE_SHAPES);
});

test("reflection descends only containers it can actually enumerate", () => {
  // `Object.entries` sees a plain object's own properties and nothing else, so a `Map` or `Set` in
  // the AST would be silently childless to this gate — the defect it exists to catch, reproduced
  // inside the instrument. Every container descended into is tagged and compared as a whole set.
  assert.deepEqual(audit.containerTags, ["[object Object]"]);
});

test("the corpus roots this gate claims to read all exist", () => {
  // A mistyped or moved root would make the audit quietly smaller rather than absent, and every
  // assertion here is satisfied by an empty audit.
  assert.deepEqual(audit.missingRoots, []);
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

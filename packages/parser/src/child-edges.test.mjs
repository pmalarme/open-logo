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
// **This file audits that traversal from a source that does not use it.** It walks the corpus twice:
// once with `walk` (which descends through `childrenOf`), and once by *reflection* over each node's
// own object fields, which drives its own recursion and therefore inherits nothing from the thing it
// is auditing. Two independent traversals of the same trees must reach the same nodes. A missing
// child edge makes the reflective set a strict superset, and the edge that broke is named.
//
// Three assertions the reviewer of #925 asked for, each of which exists because a gate that cannot
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
// to reflection — which is exactly why assertion 3 exists, and why `POPULATED_FIELD_PATHS` is a
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
 * Anything else kinded and spanned is a node the oracle does not know about, and assertion 2 fails
 * on it. This list is the complete set of exceptions, which is why it is compared as a whole set
 * rather than consulted by a skip.
 */
const KINDED_NON_NODE_SHAPES = ["field", "index"];

/**
 * Every node-valued field path the corpus is expected to populate (assertion 3), as the dotted route
 * from the owning node through any wrapper objects and arrays: `ProcedureDef.params[].defaultValue`
 * is tracked separately from `ProcedureDef.params`, because a corpus full of parameterless
 * procedures exercises the second and says nothing about the first.
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
 * `foreignShapes` collects any kinded, spanned wrapper it passes through, so assertion 2 can compare
 * the whole set rather than skipping the ones it recognises.
 */
function edgesUnder(value, path, foreignShapes, out) {
  if (Array.isArray(value)) {
    for (const item of value) {
      edgesUnder(item, `${path}[]`, foreignShapes, out);
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
    foreignShapes.add(value.kind);
  }
  for (const [key, inner] of Object.entries(value)) {
    if (key !== "source_span") {
      edgesUnder(inner, `${path}.${key}`, foreignShapes, out);
    }
  }
  return out;
}

/**
 * Reflect over one tree, recording every child edge and the node it leads to. Recursion is driven by
 * reflection alone — `walk` and `childrenOf` are never consulted — which is the property that lets
 * the comparison below mean anything.
 */
function reflectEdges(node, foreignShapes, edges) {
  for (const [field, value] of Object.entries(node)) {
    if (field !== "kind" && field !== "source_span") {
      for (const edge of edgesUnder(
        value,
        `${node.kind}.${field}`,
        foreignShapes,
        [],
      )) {
        edges.push([edge[0], node, edge[1]]);
        reflectEdges(edge[1], foreignShapes, edges);
      }
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
  const foreignShapes = new Set();
  const populated = new Set();
  const kindsSeen = new Set();
  const brokenEdges = [];
  const unreflectedNodes = [];
  let nodeCount = 0;
  let fileCount = 0;

  // Named rather than inlined into the `.map()` calls below, and used on the always-populated paths
  // too, so that neither is a function only a failing tree ever invokes. A projection that runs only
  // when something is already wrong is dead on a green tree, which is the same defect as a dead
  // recording branch — one level further out.
  const pathOf = (edge) => edge[0];
  const kindOf = (node) => node.kind;

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

    const reflected = new Set([ast]);
    const edges = reflectEdges(ast, foreignShapes, []);
    for (const edge of edges) {
      populated.add(pathOf(edge));
      reflected.add(edge[2]);
    }
    // Spread-push from a filter rather than a collecting `if`, and deliberately with no loop body:
    // a recording branch that never runs on a green tree is a partly-dead test body — the shape
    // this saga has shipped more than once, and the shape #960 warned this gate not to take. A
    // filter predicate is evaluated on every edge whether or not it matches, and `push` with no
    // arguments still runs, so nothing here is dead when the tree is clean. Only the topmost break
    // is recorded: a child whose parent was itself unreached is a consequence, not a second finding.
    brokenEdges.push(
      ...edges
        .filter(([, parent, child]) => walked.has(parent) && !walked.has(child))
        .map(pathOf),
    );
    unreflectedNodes.push(
      ...[...walked].filter((seen) => !reflected.has(seen)).map(kindOf),
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
  for (const root of roots) {
    if (existsSync(root)) {
      visit(root);
    }
  }

  return {
    brokenEdges: [...new Set(brokenEdges)].sort(),
    unreflectedNodes: [...new Set(unreflectedNodes)].sort(),
    foreignShapes: [...foreignShapes].sort(),
    populated: [...populated].sort(),
    kindsSeen: [...kindsSeen].sort(),
    nodeCount,
    fileCount,
  };
}

const audit = auditTheCorpus();

test("every node-valued field the corpus produces is a child edge `walk` descends", () => {
  // The failure this exists to catch: a field added to an already-handled kind, which `tsc` accepts
  // and which #925's guard cannot see. Reported as the dotted path of the edge that broke.
  assert.deepEqual(audit.brokenEdges, []);
});

test("`childrenOf` returns no child that reflection cannot find on the node itself", () => {
  // The opposite direction: a child list that reports something the node does not hold would make
  // every AST-derived instrument see a node that is not there.
  assert.deepEqual(audit.unreflectedNodes, []);
});

test("no kinded, spanned shape outside the oracle appears anywhere in the corpus", () => {
  // Assertion 2 — fail, do not skip. `WALKABLE_NODE_KINDS` is the oracle everything here rests on;
  // a new kinded shape it does not know about would be silently invisible to this gate, so it is
  // compared as a whole set and any newcomer breaks this equality.
  assert.deepEqual(audit.foreignShapes, KINDED_NON_NODE_SHAPES);
});

test("the corpus populates exactly the declared node-valued field paths", () => {
  // Assertion 3 — corpus adequacy, in both directions. Without it, a green run over a corpus that
  // never exercises a field is indistinguishable from a green run over a correct implementation.
  assert.deepEqual(audit.populated, [...POPULATED_FIELD_PATHS].sort());
});

test("the audit actually traversed the corpus, reaching every node kind", () => {
  // A gate that silently measured nothing is the failure mode all four assertions above share: an
  // empty audit satisfies every one of them. The kind census is the sharper half — adequacy in the
  // dimension `POPULATED_FIELD_PATHS` cannot express, since a kind the corpus never instantiates
  // contributes no field paths to be missing from the declared list in the first place.
  assert.deepEqual(audit.kindsSeen, [...OL_NODE_KINDS].sort());
  // Deliberately loose floors: a liveness check, not a census, so ordinary corpus growth never
  // touches them and no derived count is asserted here.
  assert.ok(audit.fileCount > 500, `parsed ${audit.fileCount} files`);
  assert.ok(audit.nodeCount > 5000, `visited ${audit.nodeCount} nodes`);
});

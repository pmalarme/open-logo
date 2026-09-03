// The Heritage reporter-alias **chokepoint agreement** — issue #787's regression, carried down one
// level by issue #839, exactly as `tests/conformance/heritage/execution/`'s three
// `heritage-reporter-alias-*` fixtures asked for before they were inverted.
//
// #787 was a host crash: `evaluate.ts`'s expression chokepoint (`resolveHeritageAliasName`)
// resolved `fd` to `forward` for DISPATCH, but handed the UNRESOLVED node to `callProcedure`, whose
// `runProcedureBody` re-derives its lookup key from `node.callee.name`. The two disagreed, the
// lookup returned `undefined`, and a raw JavaScript `TypeError` escaped to the embedder with no
// `ol-*` diagnostic at all — an outcome `spec/error-model.md` never admits. `withResolvedCallee`
// closed it by rewriting the node before dispatch, so both chokepoints derive the same name.
//
// Issue #839 removes the *source-level* route to that branch: every one of the thirteen Heritage
// alias canonicals is a built-in name, so `define forward` is now `ol-reserved-word` at phase-1
// registration and no `.logo` program can put a user procedure behind an alias any more. The
// fixtures that used to reach it are inverted in place (they now assert the registration error), and
// the branch itself is pinned HERE instead, against the surface it is still reachable through:
// `evaluate()` over an `Environment` a host assembled itself. That surface is real — `evaluate` and
// `createEnvironment` are public API of `@openlogo/runtime` — and the defect underneath (two
// chokepoints in one call path deriving the callee name differently) is wrong however the naming
// rules land.
//
// These tests deliberately bypass `execute()`'s registration guard rather than working around it:
// the point is to keep the *evaluator's* invariant pinned independently of whichever declarations
// the registration phase happens to admit.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "@openlogo/parser";
import { createEnvironment, evaluate } from "@openlogo/runtime";

const doc = "heritage-alias-chokepoint.logo";

/** The reporter-position call node in `print <callee>` — the node the expression chokepoint sees. */
function reporterCallNode(source) {
  const { ast, diagnostics } = parse(source, doc);
  assert.deepEqual(diagnostics, [], `${source} must parse cleanly`);
  return ast.body[0].args[0];
}

/** A minimal `ProcedureDef` for `name`, enough for `procedures.has(name)` to match. */
function procedureNamed(name) {
  const { ast } = parse(`define ${name}\n  return 55\nend`, doc);
  return ast.body[0];
}

/**
 * An environment whose procedure registry holds exactly `names`, and whose `callProcedure` records
 * the node it was handed instead of running it. Assembled by hand — `execute()` would reject these
 * declarations at phase 1 — so the evaluator's own dispatch invariant can be asserted in isolation.
 */
function environmentWithProcedures(names) {
  const calls = [];
  const environment = {
    ...createEnvironment(),
    procedures: new Map(names.map((name) => [name, procedureNamed(name)])),
    callProcedure: (node) => {
      calls.push(node);
      return { ok: true, value: 55 };
    },
  };
  return { environment, calls };
}

test("#787: a reporter-position alias over a registered canonical dispatches with the CANONICAL callee, not the surface alias", () => {
  // The literal crash shape: `procedures` holds `forward`, the source says `fd`. The node handed to
  // `callProcedure` must already spell `forward`, because that is the name `runProcedureBody`
  // re-derives its lookup key from. A node still spelling `fd` is the #787 bug exactly.
  const { environment, calls } = environmentWithProcedures(["forward"]);

  const result = evaluate(reporterCallNode("print fd"), environment);

  assert.deepEqual(result, { ok: true, value: 55 });
  assert.equal(calls.length, 1, "the user procedure was dispatched to");
  assert.equal(calls[0].callee.name, "forward");
});

test("#787: rewriting the callee does not rewrite the span — it still points at the alias the learner wrote", () => {
  // `withResolvedCallee` preserves `callee.source_span`, so a diagnostic raised against the
  // dispatched node still underlines `fd`'s two columns rather than `forward`'s seven.
  const { environment, calls } = environmentWithProcedures(["forward"]);

  evaluate(reporterCallNode("print fd"), environment);

  assert.deepEqual(calls[0].callee.source_span, {
    document: doc,
    start: [1, 7],
    end: [1, 9],
  });
});

test("a registered SURFACE spelling shadows the alias: the callee is left alone", () => {
  // The other direction of `resolveHeritageAliasName`'s guard: when the surface name is itself
  // registered, the alias must NOT be resolved, so the call reaches that procedure rather than the
  // canonical's. The node is handed on unchanged.
  const { environment, calls } = environmentWithProcedures(["fd"]);

  const result = evaluate(reporterCallNode("print fd"), environment);

  assert.deepEqual(result, { ok: true, value: 55 });
  assert.equal(calls[0].callee.name, "fd");
});

test("a Core-spelled reporter call is handed on untouched", () => {
  // The no-op guard: a callee carrying no `canonical` resolves to itself, so `withResolvedCallee`
  // takes its early return and the Core path is bit-for-bit unchanged.
  const { environment, calls } = environmentWithProcedures(["twice"]);

  evaluate(reporterCallNode("print twice"), environment);

  assert.equal(calls[0].callee.name, "twice");
});

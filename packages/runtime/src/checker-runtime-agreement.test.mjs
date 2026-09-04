// **The checker/runtime agreement guard** — issue #825.
//
// `spec/execution-model.md`'s § *Variables, scoping, and procedures* is implemented **twice**, on
// purpose and unavoidably: `@openlogo/runtime`'s `scope.ts` resolves a name as execution reaches it,
// and `@openlogo/parser`'s `checker-undefined-var.ts` restates the same rules lexically. They cannot
// share code — `@openlogo/parser` cannot depend on `@openlogo/runtime`, because the dependency runs
// the other way — so the risk is that the two models drift apart and disagree on a real program,
// which a learner would experience as the editor and the Run button contradicting each other.
//
// This file is the guard. `packages/runtime` may import both packages, so it is the only place the
// two can be put side by side. Each case below runs ONE program through `check()` and `execute()`
// and asserts they report the same **identity** — `code` + `params` — at the same span.
//
// **What is deliberately NOT asserted:** `stage`, which differs by design (the checker decides
// `ol-var-not-visible` at `semantic`, the runtime raises it at `runtime` because `execute()` never
// runs `check()`), and the `ol-undefined-var` *message*, which the two stages word differently — a
// pre-existing divergence predating this slice, tracked as issue #1117. `ol-var-not-visible`'s
// message IS asserted byte-for-byte, because `spec/error-model.md:132` makes naming the boundary
// and naming the fix normative and one wording is what the learner must get from either stage.
//
// **The sanctioned divergences get their own test at the bottom** rather than being quietly omitted.
// `spec/execution-model.md:416-424` requires the checker to be *conservative*: it reports a name
// only when no execution order could make it visible, so it is silent in cases the evaluator still
// fails on. Pinning those keeps the asymmetry deliberate instead of accidental.

import assert from "node:assert/strict";
import { test } from "node:test";
import { check, parse } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

const doc = "agreement.logo";
const PROFILES = ["core-language", "turtle-rendering"];

/** The name-resolution findings `check()` reports, in source order. */
function checkFindings(source) {
  const { ast, diagnostics } = parse(source, doc);
  assert.deepEqual(diagnostics, [], `parse: ${source}`);
  return check(ast, { profiles: PROFILES, source }).diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === "ol-undefined-var" ||
      diagnostic.code === "ol-var-not-visible",
  );
}

/** The name-resolution findings a run reports. Execution halts at the first, so there is ≤ 1. */
function runFindings(source) {
  return execute(source, doc).diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === "ol-undefined-var" ||
      diagnostic.code === "ol-var-not-visible",
  );
}

/**
 * Both stages must report the same identity at the same place. The runtime stops at the first
 * failure, so only the checker's first finding is compared — and the checker never reports
 * *earlier* than the runtime fails, which is what `spec/execution-model.md:416-419` means by "within
 * one scope's straight-line statement list the two agree exactly".
 */
function assertAgree(label, source, expected) {
  const fromCheck = checkFindings(source);
  const fromRun = runFindings(source);

  if (expected === null) {
    assert.deepEqual(fromCheck, [], `${label}: check() should be clean`);
    assert.deepEqual(fromRun, [], `${label}: execute() should be clean`);
    return;
  }

  assert.ok(fromCheck.length > 0, `${label}: check() reported nothing`);
  assert.equal(
    fromRun.length,
    1,
    `${label}: execute() reported ${fromRun.length}`,
  );
  const checked = fromCheck[0];
  const ran = fromRun[0];

  assert.equal(checked.code, expected.code, `${label}: check() code`);
  assert.equal(ran.code, expected.code, `${label}: execute() code`);
  assert.deepEqual(checked.params, expected.params, `${label}: check() params`);
  assert.deepEqual(ran.params, expected.params, `${label}: execute() params`);
  assert.deepEqual(
    checked.source_span,
    ran.source_span,
    `${label}: the two stages point at different source`,
  );
}

// ── The root-scope name set: the exact axis the two models could drift on ────────────────────
//
// `ol-var-not-visible` is decided from "the names the root scope binds anywhere, minus the ones
// declared `global`" — `collectRootScopeNames` in the runtime, `DocumentFacts.rootScopeNames` in the
// checker. The five cases below pin that set from every side, so a perturbation of either derivation
// turns one of them red rather than passing unnoticed:
//
//   - a plain top-level assignment IS in the set          → both say ol-var-not-visible
//   - a top-level `local` IS in the set                   → both say ol-var-not-visible
//   - a `global` is NOT in the set                        → both stay clean
//   - a name only a top-level BLOCK binds is NOT in it    → both say ol-undefined-var
//   - a name nothing binds is NOT in it                   → both say ol-undefined-var
//
// and the sixth pins that the set is **lexical, not temporal**: the read runs before the top-level
// line that binds the name, and both stages still call it the boundary's fault.

test("a procedure reading a plain top-level name: both stages say ol-var-not-visible, same params, same span", () => {
  assertAgree(
    "plain top-level name",
    ":count = 0\ndefine f\n  print :count\nend\nf\n",
    { code: "ol-var-not-visible", params: { name: "count", procedure: "f" } },
  );
});

test("a top-level `local` binds in the root scope too, so it is boundary-hidden the same way", () => {
  assertAgree(
    "top-level local",
    "local held\n:held = 1\ndefine f\n  print :held\nend\nf\n",
    { code: "ol-var-not-visible", params: { name: "held", procedure: "f" } },
  );
});

test("a `global` is NOT boundary-hidden: both stages are clean", () => {
  assertAgree(
    "global",
    "global count = 0\ndefine f\n  print :count\nend\nf\n",
    null,
  );
});

test("a name only a top-level BLOCK binds is not boundary-hidden: both say ol-undefined-var", () => {
  // A block encloses no procedure body, so the boundary is not the reason the read failed
  // (`spec/error-model.md:102`). Offering `global b = …` here would name a fix for a name that is
  // not a top-level name.
  assertAgree(
    "block-bound name",
    "repeat 1 [ :b = 1 ]\ndefine f\n  print :b\nend\nf\n",
    { code: "ol-undefined-var", params: { name: "b" } },
  );
});

test("a name bound nowhere at all: both say ol-undefined-var", () => {
  assertAgree("bound nowhere", "define f\n  print :nowhere\nend\nf\n", {
    code: "ol-undefined-var",
    params: { name: "nowhere" },
  });
});

test("the code is LEXICAL, not temporal: the read runs BEFORE the binding line and both still say ol-var-not-visible", () => {
  // `spec/execution-model.md:405-414`. This is the case a temporal root set would get wrong in the
  // checker (it would report `ol-undefined-var`), and it is exactly what keeps the code decidable at
  // the `semantic` stage.
  assertAgree(
    "lexical not temporal",
    "define peek\n  print :later\nend\npeek\n:later = 1\n",
    {
      code: "ol-var-not-visible",
      params: { name: "later", procedure: "peek" },
    },
  );
});

test("the spec's own worked example agrees at both stages, on the READ", () => {
  assertAgree(
    "worked example",
    ":count = 0\ndefine draw_steps\n  repeat 4 [\n    forward :count * 10\n    :count = :count + 1\n  ]\nend\ndraw_steps\n",
    {
      code: "ol-var-not-visible",
      params: { name: "count", procedure: "draw_steps" },
    },
  );
});

// ── The learner-facing prose is one string across both stages ────────────────────────────────

test("ol-var-not-visible's message is byte-identical at both stages (spec/error-model.md:132)", () => {
  const source =
    ":count = 0\ndefine draw_steps\n  print :count\nend\ndraw_steps\n";
  const checked = checkFindings(source)[0];
  const ran = runFindings(source)[0];

  assert.equal(checked.message, ran.message);
  // Both normative halves, so a reword that dropped one would fail here rather than in one stage.
  assert.ok(
    checked.message.includes(":count is not defined inside draw_steps"),
  );
  assert.ok(checked.message.includes("global count = ..."));
});

// ── Non-regressions: over-reaching is this slice's real risk ─────────────────────────────────

test("both stages stay clean on the programs the ruling exists to permit", () => {
  for (const [label, source] of [
    [
      "accumulator idiom",
      ":total = 0\nrepeat 4 [ :total = :total + 1 ]\nprint :total\n",
    ],
    [
      "global carries state",
      "global count = 0\ndefine bump\n  :count = :count + 1\nend\nbump\nprint :count\n",
    ],
    [
      "write-first shadows silently",
      ":count = 0\ndefine f\n  :count = 1\n  print :count\nend\nf\n",
    ],
    ["parameter read", "define f :n\n  print :n\nend\nf 1\n"],
    ["local initializer snapshots", "local x = 1\nlocal x = :x\nprint :x\n"],
    [
      "reduce binds accumulator and element",
      ":t = reduce sum turn in [ 1 2 ] from 0 [ :sum + :turn ]\nprint :t\n",
    ],
  ]) {
    assertAgree(label, source, null);
  }
});

// ── The sanctioned divergences, pinned so they stay deliberate ───────────────────────────────

test("SANCTIONED DIVERGENCE: a read before a LATER `global` declaration — the checker is silent, the runtime raises", () => {
  // `spec/execution-model.md:571-574` — a `global` declaration takes effect when it runs, so a read
  // before that line "finds no binding and raises ol-undefined-var, like any other name". The
  // checker must NOT report it: `spec/execution-model.md:423-424` forbids reporting a name a later
  // declaration could reach, and here it plainly could (the same procedure called after the
  // declaration is clean). Conservatism, not a defect.
  const source = "define f\n  print :count\nend\nf\nglobal count = 1\n";

  assert.deepEqual(checkFindings(source), []);
  assert.deepEqual(
    runFindings(source).map((diagnostic) => diagnostic.code),
    ["ol-undefined-var"],
  );
});

test("SANCTIONED DIVERGENCE: a block read of a name its enclosing scope binds LATER", () => {
  // Same rule from the other side. A deferred handler registered here would legitimately see the
  // binding when it fires, and the checker cannot tell an inline block from a deferred one without
  // guessing, so it stays quiet across every scope boundary.
  const source = "repeat 1 [ print :later ]\n:later = 1\n";

  assert.deepEqual(checkFindings(source), []);
  assert.deepEqual(
    runFindings(source).map((diagnostic) => diagnostic.code),
    ["ol-undefined-var"],
  );
});

test("NON-DIVERGENCE control: within ONE scope's straight-line list the two agree exactly", () => {
  // The paired positive control for the two divergences above. Move the same read into the root
  // scope's own statement list and the checker reports it, because no execution order could make it
  // visible there (`spec/execution-model.md:416-419`).
  assertAgree("straight-line root read", "print :later\n:later = 1\n", {
    code: "ol-undefined-var",
    params: { name: "later" },
  });
});

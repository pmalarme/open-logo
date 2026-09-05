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
// **The sanctioned divergence gets its own test at the bottom** rather than being quietly omitted.
// `spec/execution-model.md:416-424` requires the checker to be *conservative*: it reports a name
// only when no execution order could make it visible, so it is silent in a case the evaluator still
// fails on — a read before a LATER `global` declaration, where `execute()` genuinely raises
// `ol-undefined-var` (measured). Pinning it keeps the asymmetry deliberate instead of accidental.
//
// A deferred handler reading a name bound later LOOKS like a second divergence and is not: both
// stages are clean. Its test says so, and says why a clean run there proves nothing — the handler
// never fires under an empty host. Every run-stage claim in this file was audited for whether the
// code it cites actually ran; "`execute()` is clean" is only evidence when something executed.

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
 * failure, so `expected` describes that first finding — and the checker never reports *earlier* than
 * the runtime fails, which is what `spec/execution-model.md:416-419` means by "within one scope's
 * straight-line statement list the two agree exactly".
 *
 * `expected.count` closes the one hole a first-finding comparison would otherwise leave: the checker
 * could agree on finding 1 and still **over-report** afterwards, which is the direction a false
 * positive arrives from and the one that would actually hurt a learner. Every call passes it, so
 * spurious extra findings fail here rather than being averaged away. `null` asserts both stages are
 * clean, which has no first finding to compare and needs no count.
 */
function assertAgree(label, source, expected) {
  const fromCheck = checkFindings(source);
  const fromRun = runFindings(source);

  if (expected === null) {
    assert.deepEqual(fromCheck, [], `${label}: check() should be clean`);
    assert.deepEqual(fromRun, [], `${label}: execute() should be clean`);
    return;
  }

  assert.equal(
    fromCheck.length,
    expected.count,
    `${label}: check() reported ${fromCheck.length} finding(s), expected ${expected.count}`,
  );
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
// `ol-var-not-visible` is decided from the names the root scope binds anywhere —
// `collectRootScopeNames` in the runtime, `DocumentFacts.rootBindings` in the checker.
//
// The two are NOT literally the same set, and the difference is deliberate rather than drift. The
// runtime subtracts every name a root-level `global` declares, because it can reach `boundaryHiding`
// for such a name: a read that runs *before* the declaration line finds no binding, and
// `spec/execution-model.md:412-414` says that read is an ordinary `ol-undefined-var`. The checker
// performs no such subtraction, because there the subtraction is **unobservable** — its check is
// lexical, so a root-level `global` is already visible through the seal at every read in the
// document, and `boundaryHiding` is only ever consulted after a read has already failed. Measured,
// not assumed: removing the subtraction from the checker changed no test and no corpus finding,
// which is exactly why it was removed rather than kept as code nothing could fail.
// `checker-undefined-var.ts`'s doc table records it; issue #1116 records what a future unification
// must not get wrong.
//
// The five cases below pin the set from every side, so a perturbation of either derivation turns one
// of them red rather than passing unnoticed:
//
//   - a plain top-level assignment IS in the set          → both say ol-var-not-visible
//   - a top-level `local` IS in the set                   → both say ol-var-not-visible
//   - a `global` is NOT boundary-hidden                   → both stay clean
//   - a name only a top-level BLOCK binds is NOT in it    → both say ol-undefined-var
//   - a name nothing binds is NOT in it                   → both say ol-undefined-var
//
// a sixth pins that the set is **lexical, not temporal** — the read runs before the top-level line
// that binds the name, and both stages still call it the boundary's fault — and a seventh runs the
// spec's own worked example end to end.

test("a procedure reading a plain top-level name: both stages say ol-var-not-visible, same params, same span", () => {
  assertAgree(
    "plain top-level name",
    ":count = 0\ndefine f\n  print :count\nend\nf\n",
    {
      code: "ol-var-not-visible",
      params: { name: "count", procedure: "f" },
      count: 1,
    },
  );
});

test("a top-level `local` binds in the root scope too, so it is boundary-hidden the same way", () => {
  assertAgree(
    "top-level local",
    "local held\n:held = 1\ndefine f\n  print :held\nend\nf\n",
    {
      code: "ol-var-not-visible",
      params: { name: "held", procedure: "f" },
      count: 1,
    },
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
    { code: "ol-undefined-var", params: { name: "b" }, count: 1 },
  );
});

test("a name bound nowhere at all: both say ol-undefined-var", () => {
  assertAgree("bound nowhere", "define f\n  print :nowhere\nend\nf\n", {
    code: "ol-undefined-var",
    params: { name: "nowhere" },
    count: 1,
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
      count: 1,
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
      // BOTH reads in the body: `forward :count * 10` and the `:count + 1` inside the write. The
      // runtime halts at the first, so only the checker can see the pair — which is precisely why
      // the count is asserted here rather than inferred from the run.
      count: 2,
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
  assert.ok(checked.message.includes("global count = (its starting value)"));
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

test("an EAGER block's read of a name its enclosing scope binds later: both stages report it", () => {
  // Round 1 of the review gate had this as a sanctioned divergence — the checker was silent while
  // the runtime raised. `rubber-duck` was right that it should not be: `spec/tooling.md:184` names
  // "a block's read of an enclosing binding created later" as `ol-undefined-var` at Layer 2, and a
  // control body runs where it is written, so no execution order rescues it. The checker now agrees
  // with the runtime here, which is what this test exists to hold.
  assertAgree(
    "eager block, later binding",
    "repeat 1 [ print :later ]\n:later = 1\n",
    {
      code: "ol-undefined-var",
      params: { name: "later" },
      count: 1,
    },
  );
});

test("a DEFERRED handler's read of a name bound later: the checker is silent, and so is the runtime", () => {
  // This sits beside the divergence above because it is the case people expect to be one, and is
  // not. The checker MUST NOT report it (`spec/execution-model.md:401-403,423-424`: a handler sees
  // the binding whenever it fires), and `execute()` does not report it either — but for a reason
  // that carries no semantic weight: an `on_click` handler needs host input, so under an empty host
  // it never fires at all. **Zero print events, measured.**
  //
  // Both stages are asserted below, and deliberately: the runtime line is a **record** of what this
  // host produces, not evidence that the two models agree about deferred visibility. It would still
  // be clean if the checker's deferred handling were removed entirely. The semantic claim this test
  // makes is the check-stage one.
  //
  // Round 1 shipped this as a "SANCTIONED DIVERGENCE ... the runtime raises", which was simply
  // false. `rubber-duck` caught the same shape in two fixture descriptions; auditing every
  // run-stage claim in this slice for whether the cited code actually ran is what turned it up here.
  const source = "on_click [ print :later ]\n:later = 1\n";

  assert.deepEqual(checkFindings(source), []);
  assert.deepEqual(runFindings(source), []);
});

test("NON-DIVERGENCE control: within ONE scope's straight-line list the two agree exactly", () => {
  // The paired positive control for the divergence above. Move the same read into the root scope's
  // own statement list and the checker reports it, because no execution order could make it
  // visible there (`spec/execution-model.md:416-419`).
  assertAgree("straight-line root read", "print :later\n:later = 1\n", {
    code: "ol-undefined-var",
    params: { name: "later" },
    count: 1,
  });
});

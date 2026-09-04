// The checker half of the #821 scoping ruling — issue #825 (`ol-var-not-visible` and
// block-lifetime name resolution) and issue #1102 (a `local` initializer is evaluated *before* the
// binding it creates).
//
// `packages/runtime/src/scoping.test.mjs` is this file's twin: same ruling, same sentence — **a name
// is born where it is first assigned, lives until that scope ends, and a procedure's edge is
// sealed** — asserted at the other stage. Where that file runs whole programs and asserts what a
// learner *sees*, this one runs `check()` and asserts what a learner is *told before running*, which
// is the entire point of giving the boundary its own `semantic`-stage code.
//
// Three things drive every case here:
//
//   1. `spec/execution-model.md:389-394` — inside a procedure body exactly three things are visible:
//      its parameters, the bindings its body has already made, and names declared `global`.
//   2. `spec/execution-model.md:405-414` — the choice between the two codes is **lexical, not
//      temporal**, which is what keeps `ol-var-not-visible` decidable at the `semantic` stage.
//   3. `spec/execution-model.md:416-424` — the checker resolves **conservatively**: it reports a
//      name only when no execution order could make it visible, so within one scope's straight-line
//      statement list it agrees with the evaluator exactly, and across a scope boundary it never
//      reports a name a later declaration or a deferred handler could reach.
//
// These are BEHAVIOUR CHANGES against the checker this slice replaced, each measured at #824's head
// rather than assumed:
//
//   - `:count = 0` + a procedure reading `:count`      was clean, is now `ol-var-not-visible`
//   - `repeat 3 [ :i = 1 ]` then `print :i`            was clean, is now `ol-undefined-var`
//   - `local x = :x`                                   was clean, is now `ol-undefined-var` (#1102)
//   - `print :later` before `:later = 1`               was clean, is now `ol-undefined-var`
//
// The last one retires a deviation the old module declared **about itself** — see the comment on the
// matching test in `name-resolution.test.mjs`.
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only `check()`.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "variable-visibility.logo";

/** Parse then check, so a test never checks an AST the reader already rejected. */
function checkSource(source, profiles = ["core-language", "turtle-rendering"]) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(diagnostics, [], `parse: ${source}`);
  return OL.check(ast, { profiles, source }).diagnostics;
}

const codesOf = (diagnostics) => diagnostics.map((d) => d.code);

/**
 * The section's own worked example (`spec/execution-model.md:431-447`), verbatim. It is also
 * `tests/conformance/core-language/check/var-not-visible-worked-example` and
 * `tests/conformance/core-language/scoping/procedure-boundary-hides-a-top-level-read`, so one
 * program is asserted at the parse, check and run stages.
 */
const WORKED_EXAMPLE = [
  ":count = 0",
  "define draw_steps",
  "  repeat 4 [",
  "    forward :count * 10",
  "    :count = :count + 1",
  "  ]",
  "end",
  "",
].join("\n");

// ── ⭐ The headline: the boundary, named ──────────────────────────────────────────────────────

test("the spec's worked example raises ol-var-not-visible on the READ, at semantic stage", () => {
  const [finding] = checkSource(WORKED_EXAMPLE);

  assert.equal(finding.code, "ol-var-not-visible");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  // The READ, not the write: `forward :count * 10` on line 4, column 13. The write on line 5 never
  // gets a diagnostic of its own — its target creates a binding, silently and correctly.
  assert.deepEqual(finding.source_span, {
    document: doc,
    start: [4, 13],
    end: [4, 19],
  });
});

test("params carry BOTH the name and the enclosing procedure — the two-param identity is what a generic undefined-variable code could not express", () => {
  const [finding] = checkSource(WORKED_EXAMPLE);

  assert.deepEqual(finding.params, { name: "count", procedure: "draw_steps" });
});

test("the message names the boundary AND the fix (spec/error-model.md:132)", () => {
  const [finding] = checkSource(WORKED_EXAMPLE);

  // Both halves are normative: the message MUST name the boundary, and the suggestion MUST name the
  // fix. Asserted as substrings so the sentence around them can be reworded without a false failure,
  // and byte-exactly below against the runtime, which is what pins the whole string.
  assert.ok(
    finding.message.includes(":count is not defined inside draw_steps"),
    finding.message,
  );
  assert.ok(finding.message.includes("global count = ..."), finding.message);
});

test("both reads in the body are reported — the second is the read inside the write's own value, not the write", () => {
  // `:count = :count + 1` reads `count` before the binding it creates exists, so it fails for the
  // same reason the first read did. What must never be reported is the assignment TARGET.
  const findings = checkSource(WORKED_EXAMPLE);

  assert.deepEqual(codesOf(findings), [
    "ol-var-not-visible",
    "ol-var-not-visible",
  ]);
  assert.deepEqual(
    findings.map((finding) => finding.source_span.start),
    [
      [4, 13],
      [5, 14],
    ],
  );
});

test("`global count = 0` instead of `:count = 0` makes the same program clean", () => {
  assert.deepEqual(
    checkSource(WORKED_EXAMPLE.replace(":count = 0", "global count = 0")),
    [],
  );
});

test("the same fault in two differently-named procedures names ITS OWN procedure each time", () => {
  // The boundary is the point of the message, so a shared "undefined variable" string would leave
  // both learners with the same unhelpful sentence.
  const findings = checkSource(
    ":count = 0\ndefine alpha\n  print :count\nend\ndefine beta\n  print :count\nend\n",
  );

  assert.deepEqual(
    findings.map((finding) => finding.params),
    [
      { name: "count", procedure: "alpha" },
      { name: "count", procedure: "beta" },
    ],
  );
});

test("the procedure param carries the DEFINITION's declared spelling, not a call site's", () => {
  const [finding] = checkSource(
    ":count = 0\ndefine DrawSteps\n  print :count\nend\ndrawsteps\n",
  );

  assert.equal(finding.params.procedure, "DrawSteps");
  // The name itself is case-folded, because resolution is case-insensitive and `:Count`/`:count`
  // are one condition (`spec/grammar.md:13`).
  assert.equal(finding.params.name, "count");
});

test("a mis-cased read folds to one identity", () => {
  const [finding] = checkSource(":count = 0\ndefine f\n  print :COUNT\nend\n");

  assert.deepEqual(finding.params, { name: "count", procedure: "f" });
});

test("the boundary is absolute, so nesting depth inside the body never dilutes it", () => {
  for (const body of [
    "  print :count",
    "  repeat 2 [ print :count ]",
    "  if true [ print :count ]",
    "  while false [ print :count ]",
    "  for i in [ 1 ]\n    print :count\n  end",
    "  print map n in [ 1 ] [ :count ]",
  ]) {
    const source = `:count = 0\ndefine f\n${body}\nend\n`;
    assert.deepEqual(
      codesOf(checkSource(source)),
      ["ol-var-not-visible"],
      source,
    );
  }
});

// ── The write-first rule: silent, and deliberately so ────────────────────────────────────────

test("WRITE-FIRST on a name the procedure cannot see is SILENT — it creates a genuinely different variable", () => {
  // `spec/execution-model.md:443-446`. This is the one place the ruling is deliberately silent, and
  // #826's `global` token class is its only reader-facing guard, so it is asserted explicitly rather
  // than left to be inferred from the absence of a test.
  assert.deepEqual(
    checkSource(":count = 0\ndefine f\n  :count = 1\n  print :count\nend\n"),
    [],
  );
});

test("⚠️ but a VISIBLE global is the write target, whatever the order — visibility decides, never ordering", () => {
  // `spec/execution-model.md:483-490`. An unqualified "write-first creates a local" reading would
  // make `global` readable but not writable, which is the opposite of what the declaration is for.
  assert.deepEqual(
    checkSource("global count = 5\ndefine reset\n  :count = 0\nend\nreset\n"),
    [],
  );
  assert.deepEqual(
    checkSource(
      "global count = 5\ndefine bump\n  :count = :count + 1\n  print :count\nend\nbump\n",
    ),
    [],
  );
});

test("a postfix place's base is a READ, so it is diagnosed where the bare form is silent (spec/execution-model.md:492-499)", () => {
  // The two forms differ, and it follows from evaluation order rather than from scoping: only the
  // second one needs an existing value to write into.
  assert.deepEqual(
    checkSource(":people = { tom: 1 }\ndefine g\n  :people = 9\nend\n", [
      "core-language",
      "data",
    ]),
    [],
  );
  const [finding] = checkSource(
    ":people = { tom: 1 }\ndefine g\n  :people.tom = 9\nend\n",
    ["core-language", "data"],
  );
  assert.deepEqual(finding.params, { name: "people", procedure: "g" });
});

// ── NAMES, NOT VALUES — the boundary seals names, not what is inside a value ─────────────────

test("mutating a mutable ARGUMENT is intended and MUST NOT be diagnosed (spec/execution-model.md:455-474)", () => {
  assert.deepEqual(
    checkSource("define f :lst\n  add 99 to :lst\nend\n:a = [1 2]\nf :a\n", [
      "core-language",
      "data",
    ]),
    [],
  );
  assert.deepEqual(
    checkSource(
      "struct point [ x y ]\ndefine g :p\n  :p.x = 99\nend\ng (point 1 2)\n",
      ["core-language", "data"],
    ),
    [],
  );
});

test("reads of parameters and of globals are fine", () => {
  assert.deepEqual(checkSource("define f :n\n  print :n\nend\nf 1\n"), []);
  assert.deepEqual(
    checkSource(
      "global total = 5\ndefine report\n  print :total\nend\nreport\n",
    ),
    [],
  );
});

test("a parameter default value resolves in the CALLEE frame, and is boundary-sealed like the body", () => {
  assert.deepEqual(
    checkSource("define f :a (:b :a)\n  print :b\nend\nf 1\n"),
    [],
  );
  const [finding] = checkSource(
    ":outer = 1\ndefine f (:b :outer)\n  print :b\nend\nf\n",
  );
  assert.deepEqual(finding.params, { name: "outer", procedure: "f" });
});

// ── E-C: a procedure called FROM a block cannot see that block ───────────────────────────────

test("a procedure called from a block cannot see that block's names — and it is ol-undefined-var, NOT ol-var-not-visible", () => {
  // A top-level *block* encloses no procedure body, so `temp` is not something the boundary hides:
  // it is bound nowhere the read could reach (`spec/error-model.md:102`). Getting this wrong in the
  // other direction would offer `global temp = …` as a fix for a name that is not a top-level name.
  const findings = checkSource(
    "define helper\n  print :temp\nend\nrepeat 2 [ :temp = 5\n  helper ]\n",
  );

  assert.deepEqual(codesOf(findings), ["ol-undefined-var"]);
  assert.deepEqual(findings[0].params, { name: "temp" });
});

// ── Block lifetime ───────────────────────────────────────────────────────────────────────────

test("a name born inside a block is gone after the block closes (spec/execution-model.md:603-615)", () => {
  const findings = checkSource("repeat 3 [ :i = 1 ]\nprint :i\n");

  assert.deepEqual(codesOf(findings), ["ol-undefined-var"]);
  assert.deepEqual(findings[0].source_span.start, [2, 7]);
});

test("every block form ends its own names' lives, not just repeat", () => {
  for (const source of [
    "repeat 1 [ :born = 1 ]\nprint :born\n",
    "if true [ :born = 1 ]\nprint :born\n",
    "while false [ :born = 1 ]\nprint :born\n",
    "for i in [ 1 ]\n  :born = 1\nend\nprint :born\n",
    "for i from 1 to 1\n  :born = 1\nend\nprint :born\n",
    "print map n in [ 1 ] [ :born = 1\n  :n ]\nprint :born\n",
  ]) {
    assert.deepEqual(
      codesOf(checkSource(source)),
      ["ol-undefined-var"],
      source,
    );
  }
});

test("NON-REGRESSION: the accumulator idiom stays clean — a block UPDATES what it can see", () => {
  // `spec/execution-model.md:595-601`. Over-reaching here is this slice's whole risk: a block is a
  // lifetime boundary, not a write boundary.
  assert.deepEqual(
    checkSource(":total = 0\nrepeat 4 [ :total = :total + 1 ]\nprint :total\n"),
    [],
  );
  assert.deepEqual(
    checkSource(
      "global total = 0\nrepeat 4 [ :total = :total + 1 ]\nprint :total\n",
    ),
    [],
  );
});

test("two diagnostics in ONE program are both reported, in source order", () => {
  // A boundary-hidden read and a block-born name read after its block, in one file. A checker that
  // stopped at the first finding would satisfy every single-diagnostic test above.
  const findings = checkSource(
    [
      ":count = 0",
      "define draw",
      "  print :count",
      "end",
      "repeat 2 [ :multiplier = 3 ]",
      "print :multiplier",
      "",
    ].join("\n"),
  );

  assert.deepEqual(codesOf(findings), [
    "ol-var-not-visible",
    "ol-undefined-var",
  ]);
  assert.deepEqual(
    findings.map((finding) => finding.params),
    [{ name: "count", procedure: "draw" }, { name: "multiplier" }],
  );
});

// ── REDUCE HAS TWO BINDERS — a live false-positive trap, not a hypothetical ──────────────────

test("reduce binds BOTH the accumulator and the element (spec/examples/12-fractal.logo:23)", () => {
  // A checker modelling only the element wrongly flags `sum` as an outer read. The mistake was made
  // and caught during corpus analysis for #821.
  assert.deepEqual(
    checkSource(
      ":wide_turns = [ 1 2 3 ]\n:t = reduce sum turn in :wide_turns from 0 [ :sum + :turn ]\n",
    ),
    [],
  );
});

// ── Conservatism across a scope boundary ─────────────────────────────────────────────────────

test("a deferred handler reading a name the root scope binds LATER is never reported (spec/execution-model.md:401-403,423-424)", () => {
  assert.deepEqual(
    checkSource("on_click [ print :score ]\n:score = 0\n", [
      "core-language",
      "interaction-events",
    ]),
    [],
  );
});

test("a handler block updating a top-level name needs no declaration (spec/execution-model.md:599-601)", () => {
  assert.deepEqual(
    checkSource(":score = 0\non_click [ :score = :score + 1 ]\n", [
      "core-language",
      "interaction-events",
    ]),
    [],
  );
});

// ── A misplaced `global`: one mistake, one diagnostic — except when the boundary is real ─────

test("a misplaced global still suppresses ol-undefined-var on reads of its name", () => {
  assert.deepEqual(
    codesOf(
      checkSource("define f\n  global count = 0\n  print :count\nend\nf\n"),
    ),
    ["ol-global-outside-root"],
  );
});

test("but it does NOT suppress ol-var-not-visible — the learner still needs the diagnostic that names the fix", () => {
  // The suppression above exists so one mistake earns one diagnostic. It must not reach the code
  // whose whole job is to say `global count = …` at the top level, because that is what the learner
  // who put `global` in the wrong place actually needs to read.
  const findings = checkSource(
    ":count = 0\ndefine f\n  global count = 0\n  print :count\nend\nf\n",
  );

  assert.deepEqual(
    new Set(codesOf(findings)),
    new Set(["ol-var-not-visible", "ol-global-outside-root"]),
  );
  const [boundary] = findings.filter((d) => d.code === "ol-var-not-visible");
  assert.deepEqual(boundary.params, { name: "count", procedure: "f" });
});

// ── #1102: a `local` initializer is evaluated BEFORE the binding it creates ──────────────────

test("#1102: `local x = :x` with no other visible x reports on the read in the initializer", () => {
  for (const source of [
    "local x = :x\n",
    "define f\n  local x = :x\nend\nf\n",
  ]) {
    assert.deepEqual(
      codesOf(checkSource(source)),
      ["ol-undefined-var"],
      source,
    );
  }
});

test("#1102: `local x = 1` then `local x = :x` stays clean — the snapshot idiom the spec exists to allow", () => {
  // `spec/execution-model.md:508-515`. A partial fix that excluded the declared name unconditionally
  // would reject this conforming program, which is worse than the false negative it replaced.
  assert.deepEqual(checkSource("local x = 1\nlocal x = :x\nprint :x\n"), []);
});

test("#1102: an initializer sees a global, a parameter, and an enclosing block's binding", () => {
  assert.deepEqual(
    checkSource(
      "global count = 0\ndefine f\n  local count = :count + 1\n  print :count\nend\nf\n",
    ),
    [],
  );
  assert.deepEqual(
    checkSource(
      "define f :n\n  local total = :n + 1\n  print :total\nend\nf 1\n",
    ),
    [],
  );
  assert.deepEqual(
    checkSource(
      ":outer = 1\nrepeat 1 [ local snapshot = :outer\n  print :snapshot ]\n",
    ),
    [],
  );
});

test("#1102: a local declared inside a block does not leak out of it", () => {
  assert.deepEqual(codesOf(checkSource("repeat 1 [ local y ]\nprint :y\n")), [
    "ol-undefined-var",
  ]);
});

test("#1102: a bare `local x` still shadows for the rest of its own scope", () => {
  assert.deepEqual(checkSource("local x\n:x = 1\nprint :x\n"), []);
});

// ── Profile sensitivity: the rule reads no profile set (the #814 trap) ───────────────────────

test("findings are identical for core-language and core-language + turtle-rendering", () => {
  const programs = [
    WORKED_EXAMPLE,
    "repeat 3 [ :i = 1 ]\nprint :i\n",
    "local x = :x\n",
    ":total = 0\nrepeat 4 [ :total = :total + 1 ]\nprint :total\n",
  ];
  for (const source of programs) {
    const core = checkSource(source, ["core-language"]).filter(
      (d) => d.code === "ol-undefined-var" || d.code === "ol-var-not-visible",
    );
    const withTurtle = checkSource(source, [
      "core-language",
      "turtle-rendering",
    ]).filter(
      (d) => d.code === "ol-undefined-var" || d.code === "ol-var-not-visible",
    );
    assert.deepEqual(withTurtle, core, source);
  }
});

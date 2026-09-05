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
const isUndefinedVar = (diagnostic) => diagnostic.code === "ol-undefined-var";

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
  assert.ok(
    finding.message.includes("global count = (its starting value)"),
    finding.message,
  );
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

// ── Read positions that 100% coverage did NOT make load-bearing ──────────────────────────────
//
// `@testing`'s review-gate mutation sweep found five branches of `checker-undefined-var.ts` that
// were *covered* — some test executed them — but that no test *depended on*: each could be deleted
// and the whole 5107-test suite plus 994 conformance fixtures stayed green. Coverage answers "was
// this line run?", never "would anything notice if it stopped working", and these five are the gap
// between the two questions. Each case below is the distinguishing program the sweep measured.

test('a `thing` callee is matched case-insensitively (`print THING "missing"`)', () => {
  const [finding] = checkSource('print THING "missing"').filter(isUndefinedVar);

  assert.deepEqual(finding.params, { name: "missing" });
});

test("a read-Place's index KEY is itself a read (`print :nums[:missing]`)", () => {
  const findings = checkSource(":nums = [1 2]\nprint :nums[:missing]\n").filter(
    isUndefinedVar,
  );

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].params, { name: "missing" });
  assert.deepEqual(findings[0].source_span.start, [2, 13]);
});

test("a `for … from … to … by` STEP expression is a read, resolved in the enclosing scope", () => {
  const [finding] = checkSource(
    "for i from 1 to 10 by :step\n  print :i\nend\n",
  ).filter(isUndefinedVar);

  assert.deepEqual(finding.params, { name: "step" });
  // The enclosing scope, not the loop body: the step is evaluated before the binder exists.
  assert.deepEqual(finding.source_span.start, [1, 23]);
});

test("a `reduce`'s `from` seed is a read, resolved OUTSIDE the comprehension body", () => {
  const [finding] = checkSource(
    ":t = reduce sum n in [ 1 2 ] from :missing [ :sum + :n ]\n",
  ).filter(isUndefinedVar);

  assert.deepEqual(finding.params, { name: "missing" });
});

test("a SEGMENTED assignment target binds nothing — its base stays a read, before and after", () => {
  // `:people.tom = 1` is not a declaration of `people`: there is no intermediate auto-vivification
  // (`spec/execution-model.md:492-499`), so the base is a read that fails, and it does not go on to
  // make `people` visible to the next line either. Both findings, or the rule has quietly turned a
  // postfix write into a binding.
  const findings = checkSource(":people.tom = 1\nprint :people\n").filter(
    isUndefinedVar,
  );

  assert.deepEqual(
    findings.map((finding) => finding.source_span.start),
    [
      [1, 1],
      [2, 7],
    ],
  );
});

// `@testing`'s round-2 sweep found the same class again, three of them on the lines immediately
// above the ones round 2 had just pinned: a test for `for … by` left `from` and `to` inert, and a
// test for `reduce`'s `from` seed left the iterable inert. Every expression a binder form evaluates
// in the ENCLOSING scope is a read position, so each gets its own case rather than another partial
// sweep.

test("every expression a binder form evaluates in the ENCLOSING scope is a read", () => {
  for (const [source, name] of [
    ["for x in :missing_iter\n  print :x\nend\n", "missing_iter"],
    ["for i from :missing_from to 3\n  print :i\nend\n", "missing_from"],
    ["for i from 1 to :missing_to\n  print :i\nend\n", "missing_to"],
    [":t = map n in :missing_src [ :n ]\n", "missing_src"],
    [":t = filter n in :missing_src [ true ]\n", "missing_src"],
    [":t = reduce s n in :missing_src from 0 [ :s ]\n", "missing_src"],
  ]) {
    const findings = checkSource(source).filter(isUndefinedVar);
    assert.equal(findings.length, 1, source);
    assert.deepEqual(findings[0].params, { name }, source);
  }
});

test("a ROOT-level `global` is a legal declaration, and a read above it is still reported", () => {
  // The root's excuse is positional, so a read written above any declaration is reported whatever
  // that declaration's legality (`spec/execution-model.md:571-574`).
  //
  // NOTE what this does NOT pin, because a green suite must not be mistaken for evidence:
  // `collectMisplacedGlobals`'s exemption of the root declaration is **unobservable**, and
  // `@testing`'s mutation sweep proved it by surviving. A name a root-level `global` declares can
  // never reach the excuse at all — the proof is in that function's doc comment — so no test can
  // distinguish the exemption. It is kept because a set named "misplaced" that held legal
  // declarations would be a lying identifier, not because it changes an answer.
  const findings = checkSource("print :g\nglobal g = 1\n").filter(
    isUndefinedVar,
  );

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].source_span.start, [1, 7]);
  // ...and the paired control: after the declaration, the same read is clean.
  assert.deepEqual(checkSource("global g = 1\nprint :g\n"), []);
});

// ── Eager bodies vs deferred handlers: the two chains ────────────────────────────────────────
//
// Raised as a blocking finding by the `rubber-duck` reviewer in #825's review gate and **taken**:
// an earlier revision treated every enclosing scope as position-blind, which silently missed the
// eager case `spec/tooling.md:184` names at Layer 2. A second round corrected the classification
// itself — `ask`/`each` bodies run where they are written and are **eager**; only the
// Interaction & Events handler heads defer, and the checker reads them from `signatures.ts`'s
// registry rather than keeping a second list.
//
// **Note which way the default points:** anything not in that registry is treated as EAGER, which is
// the *reporting* direction. A deferred handler head a later profile adds and does not register
// would produce a false positive on a conforming program, so registering it is mandatory, not
// optional. It is safe today only because the registry is complete.

test("an EAGER control body reads its enclosing scope only as far as that scope has got", () => {
  for (const source of [
    "repeat 1 [ print :later ]\n:later = 1\n",
    "if true [ print :later ]\n:later = 1\n",
    "while false [ print :later ]\n:later = 1\n",
    "for i in [ 1 ]\n  print :later\nend\n:later = 1\n",
    "print map n in [ 1 ] [ :later ]\n:later = 1\n",
  ]) {
    assert.deepEqual(
      codesOf(checkSource(source)),
      ["ol-undefined-var"],
      source,
    );
  }
});

test("a DEFERRED handler block sees its enclosing scope in full, whenever it fires", () => {
  // `spec/execution-model.md:401-403`. Reporting these would be a false positive on conforming
  // programs: the handler COULD fire after the declaration line, and `:423-424` forbids reporting a
  // name a deferred handler could reach — "could", not "does", is the operative word.
  //
  // Do NOT reach for `execute()` as corroboration here. None of these three handlers fires under an
  // empty host: `on_click` and `on_key` need host input, and `every` needs a `wait` to have any
  // elapsed time to fire in. A clean run is vacuous, and citing it would be evidence-shaped noise.
  // The claim is a check-stage one and is asserted as such.
  for (const source of [
    "on_click [ print :later ]\n:later = 1\n",
    "every 5 [ print :later ]\n:later = 1\n",
    'on_key "a" [ print :later ]\n:later = 1\n',
  ]) {
    assert.deepEqual(
      checkSource(source, ["core-language", "interaction-events"]),
      [],
      source,
    );
  }
});

test("`ask` and `each` bodies are EAGER, not deferred — they run where they are written", () => {
  // Measured, not assumed: `execute()` raises `ol-undefined-var` on both programs below, so a
  // checker that treated every profile block-head as deferred would miss a diagnostic the runtime
  // raises. The split comes from `signatures.ts`'s Interaction & Events registry, so the Sprites
  // heads — which are not in it — land on the eager side without a second list to maintain.
  //
  // `each` is asserted in its own right rather than assumed to follow `ask`: nothing else in this
  // file fails if `each` alone becomes deferred, which is what `@testing` caught. `tell` is
  // deliberately absent — it is a plain command carrying no block at all (`node.body` is
  // `undefined`), so it says nothing about body classification either way.
  const profiles = ["core-language", "turtle-rendering", "sprites"];
  for (const source of [
    ":t = new_turtle\nask :t [ print :later ]\n:later = 1\n",
    "each [ print :later ]\n:later = 1\n",
  ]) {
    assert.deepEqual(
      codesOf(checkSource(source, profiles)),
      ["ol-undefined-var"],
      source,
    );
  }
  // The paired positive controls: bind it first and both are clean.
  for (const source of [
    ":later = 1\n:t = new_turtle\nask :t [ print :later ]\n",
    ":later = 1\neach [ print :later ]\n",
  ]) {
    assert.deepEqual(checkSource(source, profiles), [], source);
  }
});

test("the deferred/eager split is case-insensitive end to end, like every other identifier", () => {
  // `spec/grammar.md:13`. Asserted at the level a learner experiences it — `ON_CLICK` must behave
  // exactly like `on_click`, or a conforming program earns a FALSE POSITIVE.
  //
  // What this does NOT prove is that the `toLowerCase()` on the lookup is load-bearing: the reader
  // already normalises `ProfileStatement.keyword.name` to lowercase, so removing the fold survives
  // every test — measured, and stated here so nobody reads this test as evidence for that call. It
  // is kept because `checker-control-flow.ts` folds the same lookup the same way, and one of the two
  // silently not folding would be worse than both folding redundantly.
  for (const head of ["on_click", "ON_CLICK", "On_Click"]) {
    assert.deepEqual(
      checkSource(`${head} [ print :later ]\n:later = 1\n`, [
        "core-language",
        "interaction-events",
      ]),
      [],
      head,
    );
  }
});

test("every expression a CONTROL form or profile head evaluates in the enclosing scope is a read", () => {
  // `@testing` found this class a third time: round 4's own new `case` arms reintroduced it, with
  // `If`'s condition, `While`'s condition, `Repeat`'s count and `ProfileStatement`'s arguments all
  // covered and none depended on. Fixing instances rather than the class is what let it recur, so
  // this asserts the heads as a group alongside the binder-form group above.
  for (const [source, name, profiles] of [
    ["if :missing_cond [ print 1 ]\n", "missing_cond", undefined],
    ["while :missing_cond [ print 1 ]\n", "missing_cond", undefined],
    ["repeat :missing_count [ print 1 ]\n", "missing_count", undefined],
    [
      "on_key :missing_key [ print 1 ]\n",
      "missing_key",
      ["core-language", "interaction-events"],
    ],
    [
      "every :missing_ms [ print 1 ]\n",
      "missing_ms",
      ["core-language", "interaction-events"],
    ],
    [
      "ask :missing_turtle [ print 1 ]\n",
      "missing_turtle",
      ["core-language", "turtle-rendering", "sprites"],
    ],
  ]) {
    const findings = (
      profiles === undefined
        ? checkSource(source)
        : checkSource(source, profiles)
    ).filter(isUndefinedVar);
    assert.equal(findings.length, 1, source);
    assert.deepEqual(findings[0].params, { name }, source);
  }
});

test('MEASURED UNDER-REPORT: `when "start"` is treated as deferred although this runtime fires it at registration (#1119)', () => {
  // `execute()` raises `ol-undefined-var` here; `check()` does not. The gap is deliberate:
  // `spec/interaction-events.md:212-224` never says when `"start"` occurs relative to the
  // registering statement, so treating it as eager would encode this runtime's choice as the
  // contract and would become a FALSE POSITIVE if the event ever fires after the top-level program.
  // Silence is the safe direction on an open question. Asserted so the gap stays deliberate.
  assert.deepEqual(
    checkSource('when "start" [ print :later ]\n:later = 1\n', [
      "core-language",
      "interaction-events",
    ]),
    [],
  );
});

test("deferredness propagates through the WHOLE chain, not one level (a handler registered inside a loop)", () => {
  // The case that rules out the one-level version of this fix. `spec/execution-model.md:617-637`
  // makes a handler capture the scope it was registered in — here, that turn of the `repeat` — so
  // its view of the root must be the eventual one even though its immediate parent is eager.
  assert.deepEqual(
    checkSource('repeat 3 [ every 5 [ print :label ] ]\n:label = "hi"\n', [
      "core-language",
      "interaction-events",
    ]),
    [],
  );
});

test("NON-REGRESSION: the spec's own block-lifetime contrast example stays clean (spec/execution-model.md:607-615)", () => {
  // This program is why a scope's BINDINGS must be judged against the same chain its reads resolve
  // through. An earlier revision of the two-chain model judged the binding position-blind and the
  // read positionally: the block's `:x = 0` looked like an update of the *later* top-level `:x`, so
  // it created no block binding, and the very next read could not see one either. The spec's own
  // worked example reported twice. Both loops must be clean; the first prints 1 1 1 1 and the
  // second 1 2 3 4.
  assert.deepEqual(
    checkSource(
      "repeat 4 [ :x = 0   :x = :x + 1   print :x ]\n:x = 0\nrepeat 4 [ :x = :x + 1   print :x ]\n",
    ),
    [],
  );
});

// ── The excuse a misplaced `global` grants, and how far it reaches ───────────────────────────

test("a misplaced `global` suppresses reads of its name, and the suppression follows the same order/lexical split", () => {
  // Raised by `rubber-duck` as a blocking finding, and its second counter-example was right: the
  // suppression means "assume the reported mistake is repaired", so it is only sound where
  // relocating the declaration to the root really would make the read resolve.
  //
  // The rule is **positional iff the nearest non-eager ancestor is the root**. A PROCEDURE BODY and
  // a DEFERRED HANDLER re-base to the whole document's set, because a root `global` is visible to
  // them wherever in the document either one sits; an EAGER block and the root's own statement list
  // are positional. The assertions below walk all four, and the eager/deferred pair at the end is
  // the one that looks identical in the source:
  assert.deepEqual(
    codesOf(
      checkSource("define f\n  global count = 0\n  print :count\nend\nf\n"),
    ),
    ["ol-global-outside-root"],
  );

  // In the ROOT scope's own statement list it would not, when the read comes first. `print :x`
  // above the repaired declaration still fails (`spec/execution-model.md:571-574`), so suppressing
  // it would hide a diagnostic the repair does not remove:
  assert.deepEqual(
    codesOf(checkSource("print :x\ndefine bad\n  global x = 0\nend\n")),
    ["ol-undefined-var", "ol-global-outside-root"],
  );
  // ...and the repaired program, order preserved, reports exactly the same read:
  assert.deepEqual(
    codesOf(checkSource("print :x\nglobal x = 0\ndefine bad\nend\n")),
    ["ol-undefined-var"],
  );

  // A root read AFTER the misplaced declaration is suppressed, because there the repair does clear
  // it — one mistake, one diagnostic (issue #823):
  assert.deepEqual(
    codesOf(checkSource("repeat 1 [ global a = 1 ]\nprint :a\n")),
    ["ol-global-outside-root"],
  );
  assert.deepEqual(checkSource("global a = 1\nprint :a\n"), []);

  // A DEFERRED handler is excused whatever the declaration's position, because it may fire after
  // the relocated declaration; an EAGER block in the same position is not:
  assert.deepEqual(
    codesOf(
      checkSource("on_click [ print :x ]\ndefine bad\n  global x = 0\nend\n", [
        "core-language",
        "interaction-events",
      ]),
    ),
    ["ol-global-outside-root"],
  );
  assert.deepEqual(
    codesOf(
      checkSource("repeat 1 [ print :x ]\ndefine bad\n  global x = 0\nend\n"),
    ),
    ["ol-undefined-var", "ol-global-outside-root"],
  );
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

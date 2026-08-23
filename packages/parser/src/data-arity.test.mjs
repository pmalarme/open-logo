import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the Data profile's semantic-checker registration (issue #405, M4 audit finding
 * F3, `spec/tooling.md:172-185`). `dict`/`keys`/`values`/`type_of`/`reverse`/`pick`/`sort` and a
 * `struct`'s constructor call must be recognized by `check()` — visibility (no
 * `ol-unknown-command`), exact arity (`ol-not-enough-inputs`/`ol-too-many-inputs`), and reserved-word
 * collision (`ol-reserved-word`).
 *
 * **Three axes, and only two of them are the profile's to decide.** Visibility and arity are
 * genuinely profile-scoped — `spec/tooling.md:175-176` gates which names are *available*, so
 * without `data` a Data primitive is an unknown callee like any other undeclared name, and its
 * arity is nobody's business. **Reserved-word collision is not.** `spec/grammar.md:408` makes the
 * primitives of every optional profile built-in names **unconditionally** — "what a profile decides
 * is whether a name *works*, never whether a program may declare it" — so a conforming 0.4.0
 * implementation raises `ol-reserved-word` on `define dict` with or without the profile claimed.
 *
 * The checker no longer gates that third axis (issue #841), which is why the Core-only cases below
 * expect `ol-reserved-word` rather than a clean check.
 */

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, "data-arity.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

const DATA_PRIMITIVES = [
  ["dict", 0],
  ["keys", 1],
  ["values", 1],
  ["type_of", 1],
  ["reverse", 1],
  ["pick", 1],
  ["sort", 1],
];

test("dataPrimitiveArity reports each Data primitive's fixed arity, case-insensitively, and undefined otherwise", () => {
  for (const [name, arity] of DATA_PRIMITIVES) {
    assert.equal(OL.dataPrimitiveArity(name), arity);
    assert.equal(OL.dataPrimitiveArity(name.toUpperCase()), arity);
  }
  assert.equal(OL.dataPrimitiveArity("forward"), undefined);
  assert.equal(OL.dataPrimitiveArity("point"), undefined);
});

test("with the data profile active, every Data primitive fully applied is a clean, known callee", () => {
  for (const [name, arity] of DATA_PRIMITIVES) {
    const args = Array.from({ length: arity }, () => "1").join(" ");
    const source = args.length > 0 ? `${name} ${args}` : name;
    const ast = parseClean(source);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "data"],
    });
    assert.deepEqual(diagnostics, [], `expected ${source} to check cleanly`);
  }
});

test("without the data profile active, a Data primitive parses cleanly but is flagged ol-unknown-command", () => {
  const ast = parseClean("dict");
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
  assert.equal(diagnostics[0].stage, "semantic");
});

test("a Data primitive called with too few inputs raises ol-not-enough-inputs", () => {
  const ast = parseClean("keys");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-not-enough-inputs");
  assert.equal(diagnostics[0].params.callable, "keys");
});

test("a Data primitive called (parenthesized) with too many inputs raises ol-too-many-inputs", () => {
  const ast = parseClean("(type_of 1 2)");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-too-many-inputs");
  assert.equal(diagnostics[0].params.callable, "type_of");
});

// --- struct constructor calls ------------------------------------------------

// TRIAGE NOTE — F12, raised by @testing during issue #838's review, recorded here by issue #841.
//
// **Under Core alone a `struct` declaration is half-registered: it BLOCKS a later `define` of the
// same name while providing no callable constructor.** Both halves are asserted in this file — the
// blocking half by "without the data profile active, a struct DUPLICATING a procedure is still
// reported", the un-callable half by the test immediately below — so the split is pinned, not
// theoretical.
//
// `spec/data-structures.md:304` describes registration as ONE act: a `struct` declaration registers
// the type name and its constructor together. The shipped checker performs that act in two places
// with different conditions: the duplicate-definition walk is profile-blind (correctly — the
// question "did the PROGRAM declare this name twice?" has no profile in it, and
// `spec/execution-model.md:82-88` answers it without one), while `collectVisibleNames` gates the
// constructor on `data`. Under Core alone the learner therefore gets the worst of both: the name is
// taken, and calling it is an unknown command.
//
// **This is pre-existing.** #838 did not create it; it made the first half profile-blind and so
// made the asymmetry visible. It is NOT what issue #841 retired either: #841's subject was the
// `ol-reserved-word` axis (may a program DECLARE a built-in name), and this is the
// `ol-unknown-command` axis (is a name AVAILABLE), which `spec/tooling.md:175-176` genuinely does
// gate on the profile. The open question is narrower than either: whether a Core-only `struct` is a
// registration at all, and if it is, why its constructor is not visible.
//
// Recorded as a written note rather than a filed issue because issue creation is closed under the
// maintainer's scope freeze. It is spec-adjacent — resolving it means deciding what
// `spec/data-structures.md:304` requires when `data` is not claimed — so it needs a maintainer, and
// it is written down here, beside the assertions that prove it, so it cannot be lost in a review
// thread.

test("with the data profile active, a struct's constructor call is a clean, known callee at its declared arity", () => {
  const ast = parseClean("struct point [ x y ]\npoint 3 4");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.deepEqual(diagnostics, []);
});

test("without the data profile active, a struct declaration is not walked and its constructor is unknown", () => {
  const ast = parseClean("struct point [ x y ]\npoint 3 4");
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  assert.equal(
    diagnostics.filter((d) => d.code === "ol-unknown-command").length,
    1,
  );
});

test("a struct constructor called with too few inputs raises ol-not-enough-inputs", () => {
  const ast = parseClean("struct point [ x y ]\npoint 3");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-not-enough-inputs");
  assert.equal(diagnostics[0].params.callable, "point");
});

test("a struct constructor called (parenthesized) with too many inputs raises ol-too-many-inputs", () => {
  const ast = parseClean("struct point [ x y ]\n(point 3 4 5)");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-too-many-inputs");
  assert.equal(diagnostics[0].params.callable, "point");
});

// --- declaration-slot collisions ----------------------------------------------

test("a struct type name colliding with a Data primitive raises ol-reserved-word", () => {
  const ast = parseClean("struct dict [ x ]");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-reserved-word");
  // Issue #838 removed the `namespace` param: `ol-reserved-word` now means exactly "OpenLogo owns
  // this name" and carries `params: { name }` only (`spec/error-model.md:125`).
  assert.deepEqual(diagnostics[0].params, { name: "dict" });
});

test("a struct type name colliding with a define'd procedure raises ol-duplicate-definition", () => {
  const ast = parseClean("define point\nend\nstruct point [ x ]");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  // A name the PROGRAM declared is not a name OpenLogo owns, so #838 split this case out of
  // `ol-reserved-word` (`spec/grammar.md:412`, `spec/error-model.md:126`) and gave it both spans.
  assert.equal(diagnostics[0].code, "ol-duplicate-definition");
  assert.equal(diagnostics[0].params.name, "point");
  assert.deepEqual(diagnostics[0].params.original_span.start, [1, 8]);
});

test("a define colliding with an earlier struct type name raises ol-duplicate-definition", () => {
  const ast = parseClean("struct point [ x ]\ndefine point\nend");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-duplicate-definition");
  assert.equal(diagnostics[0].params.name, "point");
  assert.deepEqual(diagnostics[0].params.original_span.start, [1, 8]);
});

test("two struct declarations sharing a name are checked in source order: the first is clean", () => {
  const ast = parseClean("struct point [ x ]\nstruct point [ y ]");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-duplicate-definition");
  assert.deepEqual(diagnostics[0].source_span.start, [2, 8]);
  assert.deepEqual(diagnostics[0].params.original_span.start, [1, 8]);
});

test("#841: `dict` is a built-in name without the data profile, so `struct dict` raises", () => {
  // The title used to say "so `struct dict` is free", stating a profile gate that
  // `spec/grammar.md:408` had already overruled — a profile decides whether a name works, never
  // whether a program may declare it. Issue #841 retired the gate, so `dict` is a built-in name
  // under Core alone exactly as it is under Data, and this is the `ol-reserved-word` half rather
  // than `ol-duplicate-definition`'s.
  const ast = parseClean("struct dict [ x ]");
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-reserved-word");
  assert.deepEqual(diagnostics[0].params, { name: "dict" });
});

test("without the data profile active, a struct DUPLICATING a procedure is still reported", () => {
  // This asserted the opposite until issue #838's review round: "not checked either way". The gate
  // it pinned was real (issue #405) but belonged to the OLD rule, where the diagnostic meant "this
  // name is already taken" and a struct that registered nothing could not take one.
  //
  // `ol-duplicate-definition` asks a different question — did the PROGRAM declare this name twice?
  // — and `spec/execution-model.md:82-88` answers it with no profile condition: "The reader
  // registers every `define`/`to` procedure AND EVERY `struct` declaration … a name an earlier
  // declaration in the program or an imported module already registered raises
  // `ol-duplicate-definition`". `spec/data-structures.md:304` says the same. The runtime's phase-1
  // guard is profile-blind too, so keeping the gate here made `check()` call clean a program that
  // `execute()` then rejected.
  //
  // Its neighbours above are unaffected, which is the distinction worth keeping: `struct dict` is
  // now `ol-reserved-word` under Core alone because issue #841 made `dict` a built-in name whether
  // or not `data` is claimed, and `local point` stays clean because `local` is a binding form
  // (ruling #833). Three questions, three answers — only one of which a profile ever moved.
  for (const [label, source, laterLine] of [
    ["define then struct", "define point\nend\nstruct point [ x ]", 3],
    ["struct then define", "struct point [ x ]\ndefine point\nend", 2],
  ]) {
    const { diagnostics } = OL.check(parseClean(source), {
      profiles: ["core-language"],
    });
    assert.equal(diagnostics.length, 1, `${label} must be reported`);
    assert.equal(diagnostics[0].code, "ol-duplicate-definition");
    assert.deepEqual(diagnostics[0].source_span.start, [laterLine, 8]);
    assert.deepEqual(diagnostics[0].params.original_span.start, [1, 8]);
  }
});

test("without the data profile active, a local colliding with a struct name is not checked", () => {
  const ast = parseClean(
    "struct point [ x ]\ndefine greet\n  local point\nend",
  );
  assert.deepEqual(
    OL.check(ast, { profiles: ["core-language"] }).diagnostics,
    [],
  );
});

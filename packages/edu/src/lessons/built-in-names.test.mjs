// The built-in-names curriculum audit (issue #843, ruling #833), made durable as a test.
//
// The maintainer ruling in `spec/grammar.md:363` is one sentence: **"A program may not declare a
// built-in name. A program may bind a value to any name."** `spec/grammar.md:382` names the four
// declaration slots (`define`, the heritage `to`, `struct`, and the first operand of `alias`), and
// `spec/grammar.md:386` frees every binding form. For the curriculum that has one consequence in
// each direction: a lesson may name a variable, a parameter, a binder, or a dictionary key
// anything at all, and a lesson may not *declare* a procedure or a record type whose name OpenLogo
// already owns.
//
// **Why this file exists and the sibling `level-N.test.mjs` files are not enough.** Every other
// test in this package validates lesson content with `execute()`, which runs `parse()` and then
// the evaluator — it never calls `check()`. `ol-reserved-word` is a `stage: "semantic"` diagnostic
// (`spec/grammar.md:390`), so it is produced *only* by `check()`: a lesson that declared a
// built-in name would run cleanly through every existing test and ship. This file closes that gap
// by putting the curriculum corpus through `check()` as well.
//
// **The forward-looking half.** `checker-reserved-word.ts` does not yet consult every primitive
// table — Turtle & Rendering awaits issue #783, and the Educational meta-commands are not wired in
// either — so today `check()` alone would not catch a lesson that declared `forward` or `hint`.
// {@link builtInKind} therefore evaluates the *completed* rule of `spec/grammar.md:361-363,414`
// directly off the registries `@openlogo/parser` already publishes: the keyword list under **every**
// profile (`spec/grammar.md:408` — profile words are built-in unconditionally), every primitive
// table, and every Heritage alias spelling. That way this audit protects the curriculum on the day
// those slices land rather than on the day a learner hits it.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";
import {
  check,
  corePrimitiveArity,
  dataPrimitiveArity,
  educationalPrimitiveArity,
  geometryPrimitiveArity,
  heritageAliasNames,
  interactionPrimitiveArity,
  isKeyword,
  OL_CHECK_PROFILES,
  parse,
  soundPrimitiveArity,
  spritesPrimitiveArity,
  turtlePrimitiveArity,
} from "@openlogo/parser";

/**
 * Every primitive table the spec's built-in-name set draws on (`spec/grammar.md:414` — "every
 * primitive … assigned by the C3 primitive matrix and the profile documents"). Turtle & Rendering
 * and Educational are included deliberately: `check()` does not consult them yet, and a lesson
 * declaring `forward` or `hint` is exactly what this audit exists to prevent.
 */
const PRIMITIVE_TABLES = [
  corePrimitiveArity,
  turtlePrimitiveArity,
  dataPrimitiveArity,
  educationalPrimitiveArity,
  geometryPrimitiveArity,
  interactionPrimitiveArity,
  soundPrimitiveArity,
  spritesPrimitiveArity,
];

/** Every Heritage alias spelling; `spec/grammar.md:359` makes an alias a built-in name too. */
const HERITAGE_ALIASES = new Set(heritageAliasNames());

/** Matches a declaration slot's name: `define x`, the heritage `to x`, or `struct x`. */
const DECLARATION =
  /^[ \t]*(?:define|to|struct)[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gm;

/**
 * Why `name` is a built-in name under the completed ruling, or `"free"` when a program may declare
 * it. Profiles are never gated here: `spec/grammar.md:408` makes every profile's keywords and
 * primitives built-in names "in **every** implementation, whether or not that profile is claimed".
 */
function builtInKind(name) {
  if (isKeyword(name, OL_CHECK_PROFILES)) {
    return "keyword";
  }
  if (PRIMITIVE_TABLES.some((arityOf) => arityOf(name) !== undefined)) {
    return "primitive";
  }
  if (HERITAGE_ALIASES.has(name)) {
    return "alias";
  }
  return "free";
}

/** Every `ol-*` code `source` raises, from parsing and from the semantic checker, in order. */
function diagnosticCodes(source) {
  const { ast, diagnostics } = parse(source);
  const checked = check(ast, { profiles: OL_CHECK_PROFILES, source });
  return [...diagnostics, ...checked.diagnostics].map(
    (diagnostic) => diagnostic.code,
  );
}

/** The names declared in `source` by a `define`, a heritage `to`, or a `struct`. */
function declaredNames(source) {
  return [...source.matchAll(DECLARATION)].map((match) => match[1]);
}

/** Every runnable OpenLogo program the curriculum shows a learner, each with a label. */
const CURRICULUM_SOURCES = [
  ...OL.LESSONS.flatMap((lesson) =>
    lesson.workedExamples.map((example, index) => ({
      label: `${lesson.id} worked example #${index}`,
      source: example.source,
    })),
  ),
  ...OL.EXERCISES.map((exercise) => ({
    label: `${exercise.id} reference solution`,
    source: exercise.referenceSolution.source,
  })),
];

// A harness that silently does nothing reports a clean corpus forever. `parse()` returns a
// `ParseResult`, not a `ProgramNode`, so handing its result straight to `check()` type-checks in
// plain JS and quietly finds nothing at all. These three controls pin that `diagnosticCodes` runs
// both stages for real before any assertion below trusts an empty result.
test("the audit harness really runs both parse() and check()", () => {
  assert.deepEqual(diagnosticCodes("forward 10"), []);
  assert.deepEqual(diagnosticCodes("print :nope"), ["ol-undefined-var"]);
  assert.deepEqual(diagnosticCodes("define count\nend"), ["ol-reserved-word"]);
});

test("the curriculum corpus is non-empty and statically clean", () => {
  assert.equal(CURRICULUM_SOURCES.length > 0, true);
  for (const { label, source } of CURRICULUM_SOURCES) {
    assert.deepEqual(
      diagnosticCodes(source),
      [],
      `${label} is no longer statically clean`,
    );
  }
});

// AC1/AC2 of #843: the audit's central claim. Every name the curriculum declares must stay free
// under the completed ruling, not merely under today's partially-wired checker.
test("every name the curriculum declares is free to declare under the completed ruling", () => {
  const declared = new Set(
    CURRICULUM_SOURCES.flatMap(({ source }) => declaredNames(source)),
  );
  assert.equal(declared.size > 0, true);
  for (const name of declared) {
    assert.equal(
      builtInKind(name),
      "free",
      `the curriculum declares \`${name}\`, which OpenLogo owns`,
    );
  }
});

// AC2: `spec/grammar.md:412` protects `spec/educational-model.md:169` ("Learners build `polygon`
// from `repeat`") by making the derived Geometry standard library OpenLogo *source* rather than
// primitives — while the renderer-backed overlays of `spec/educational-model.md:219` stay built in.
test("the Geometry standard library stays learner-buildable and the overlays stay built in", () => {
  for (const name of [
    "polygon",
    "star",
    "circle",
    "arc",
    "area",
    "perimeter",
  ]) {
    assert.equal(
      builtInKind(name),
      "free",
      `a learner must still be able to build \`${name}\` from repeat`,
    );
  }
  for (const name of ["grid", "axes", "measure"]) {
    assert.equal(
      builtInKind(name),
      "primitive",
      `\`${name}\` is a renderer-backed overlay, so declaring it must stay an error`,
    );
  }
});

// AC4: the meta-commands a learner asks for help with are themselves built-in names, so no lesson
// may declare one. `challenge` belongs to the Tutor (AI) profile, which has no signature table in
// `@openlogo/parser` yet, so it is checked only for absence from the corpus rather than for kind.
test("no lesson declares an educational meta-command", () => {
  for (const name of ["explain", "why", "hint", "debug"]) {
    assert.equal(
      builtInKind(name),
      "primitive",
      `\`${name}\` is an Educational profile primitive`,
    );
  }
  const declared = new Set(
    CURRICULUM_SOURCES.flatMap(({ source }) => declaredNames(source)),
  );
  for (const name of ["explain", "why", "hint", "debug", "challenge"]) {
    assert.equal(
      declared.has(name),
      false,
      `a lesson declares \`${name}\`, which a learner can no longer do`,
    );
  }
});

// The other half of `spec/grammar.md:363`: binding is completely free, so a lesson may name a
// variable, a parameter, a `for` binder, or a dictionary key after a keyword or a primitive. A
// lesson must never teach that these names are forbidden, because they are not.
test("binding a built-in name stays legal everywhere the curriculum could use one", () => {
  for (const source of [
    ":end = 1",
    ":count = 1",
    "local value",
    'make "repeat" 1',
    ":marks = { end: 1 }",
    "for end from 1 to 3\n  print :end\nend for",
  ]) {
    assert.deepEqual(diagnosticCodes(source), [], source);
  }
});

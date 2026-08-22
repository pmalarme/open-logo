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
// (`spec/grammar.md:390`), so for a *procedure* declaration it is produced only by `check()`: a
// lesson containing `define count` or `define forward` runs cleanly through every existing test in
// this package and would ship. (The runtime's own phase-1 registration guard does catch some
// `struct` collisions, so the hole is not total — but a procedure declaration, which is what the
// curriculum actually teaches at Level 5, falls straight through it.) This file closes that gap by
// putting the curriculum corpus through `check()` as well.
//
// **The forward-looking half.** `checker-reserved-word.ts` does not yet consult every primitive
// table — Turtle & Rendering awaits issue #783, and the Educational meta-commands are not wired in
// either — so today `check()` alone would not catch a lesson that declared `forward` or `hint`.
// {@link builtInKind} therefore evaluates the *completed* rule of `spec/grammar.md:361-363,414`
// directly off the registries `@openlogo/parser` already publishes: the keyword list under **every**
// profile (`spec/grammar.md:408` — profile words are built-in unconditionally), every primitive
// table, and every Heritage alias spelling. That way this audit protects the curriculum on the day
// those slices land rather than on the day a learner hits it. Where the two halves disagree, the
// registry half is the stricter one and the one that decides.
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
  walk,
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

/**
 * Names this specification version assigns as primitives but `@openlogo/parser` has no signature
 * table for yet. `challenge` is the Tutor (AI) profile's meta-command (`spec/conformance.md:239`,
 * `:244`), and `spec/grammar.md:408` makes every profile's primitives built-in names "in **every**
 * implementation, whether or not that profile is claimed" — so a learner may not declare it even
 * though nothing rejects `define challenge` today. Delete an entry here the day its profile gains a
 * table, rather than letting this set quietly become a second, drifting registry.
 */
const TUTOR_AI_PRIMITIVES = new Set(["challenge"]);

/** Every Heritage alias spelling; `spec/grammar.md:359` makes an alias a built-in name too. */
const HERITAGE_ALIASES = new Set(heritageAliasNames());

/**
 * The `alias` declaration slot, which cannot be read off the AST. `spec/grammar.md:382` names four
 * slots; three of them ({@link declaredNames} reads `define`, the heritage `to`, and `struct` from
 * `ProcedureDef`/`StructDef` nodes) are modeled, but Modules is a later profile — `alias fd forward`
 * does not parse at all today (measured: two `ol-bad-token`s), so there is no node to walk. This
 * pattern covers the fourth slot until there is, and captures the **first** operand, which is the
 * declared one (`spec/grammar.md:410`); the second is the name being pointed at and is unrestricted.
 * The identifier form follows `spec/grammar.md:54-55` and the `i` flag follows `:13`.
 */
const ALIAS_DECLARATION =
  /^[ \t]*alias[ \t]+([\p{XID_Start}_][\p{XID_Continue}_]*[?!]?)/gimu;

/**
 * Why `name` is a built-in name under the completed ruling, or `"free"` when a program may declare
 * it. Two things this deliberately does that a naive lookup would not:
 *
 * - **Profiles are never gated.** `spec/grammar.md:408` makes every profile's keywords and
 *   primitives built-in names whether or not that profile is claimed.
 * - **The name is folded first.** `spec/grammar.md:13` makes identifiers case-insensitive, so
 *   `define FD` declares the Heritage alias `fd` and must be caught as one.
 */
function builtInKind(name) {
  const canonical = name.toLowerCase();
  if (isKeyword(canonical, OL_CHECK_PROFILES)) {
    return "keyword";
  }
  if (PRIMITIVE_TABLES.some((arityOf) => arityOf(canonical) !== undefined)) {
    return "primitive";
  }
  if (TUTOR_AI_PRIMITIVES.has(canonical)) {
    return "primitive";
  }
  if (HERITAGE_ALIASES.has(canonical)) {
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

/**
 * The names `source` declares. `define`, the heritage `to`, and `struct` are read off the parsed
 * AST rather than matched in the text, which is what makes this sound: a declaration nested inside
 * an `if` or a `repeat` block is still a declaration and is found, while `define forward` sitting
 * inside a `/* … *\/` block comment (`spec/grammar.md:32`) is not one and is not. A line-oriented
 * pattern gets both of those backwards. The fourth slot, `alias`, has no node to walk — see
 * {@link ALIAS_DECLARATION}.
 */
function declaredNames(source) {
  const { ast } = parse(source);
  const names = [];
  walk(ast, (node) => {
    if (node.kind === "ProcedureDef" || node.kind === "StructDef") {
      names.push(node.name.name);
    }
  });
  for (const match of source.matchAll(ALIAS_DECLARATION)) {
    names.push(match[1]);
  }
  return names;
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
// plain JS and quietly finds nothing at all. These four controls pin that `diagnosticCodes` runs
// both stages for real, and keeps both halves of each stage's output: `@` is rejected at the parse
// stage, so dropping `parse()`'s own diagnostics fails here rather than in the corpus.
test("the audit harness really runs both parse() and check()", () => {
  assert.deepEqual(diagnosticCodes("forward 10"), []);
  assert.deepEqual(diagnosticCodes("@"), ["ol-bad-token"]);
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

// The names a learner is most likely to reach for, and what each one now costs them.
// `spec/grammar.md:382` — "**Nothing shadows.** `define count`, `define forward`, and `define fd`
// are equally errors, whether the name is a keyword, a Core primitive, a profile primitive, or an
// alias spelling of one." A lesson that ever suggests one of these as a procedure name is broken.
test("the names a learner reaches for are owned across all three categories", () => {
  for (const name of ["repeat", "end", "define"]) {
    assert.equal(builtInKind(name), "keyword", name);
  }
  for (const name of ["forward", "print", "count"]) {
    assert.equal(builtInKind(name), "primitive", name);
  }
  for (const name of ["fd", "pr"]) {
    assert.equal(builtInKind(name), "alias", name);
  }
});

// The audit is only as good as its model of the grammar. Ways a hand-rolled model silently
// under- or over-approximates the rule and so lets a broken lesson through, or invents a defect:
// missing a declaration slot; missing a declaration *nested* in a block; reading one out of a block
// comment; folding case the way the host language does rather than the way `spec/grammar.md:13`
// does; and dropping an identifier's `?`/`!` suffix (`spec/grammar.md:54-55`) so a declaration is
// attributed to the wrong name — `empty` is explicitly not a built-in name (`:380`) while `empty?`
// is a Core primitive. `challenge` covers the last case: a name the spec assigns whose profile has
// no signature table yet.
test("the audit models every declaration slot, case-insensitively, suffix and all", () => {
  assert.deepEqual(declaredNames("define polygon :sides\n  forward 1\nend"), [
    "polygon",
  ]);
  assert.deepEqual(declaredNames("to triangle :size\n  forward 1\nend"), [
    "triangle",
  ]);
  assert.deepEqual(declaredNames("struct point [ x y ]"), ["point"]);
  // Only `alias`'s FIRST operand declares (`spec/grammar.md:410`); the second is unrestricted.
  assert.deepEqual(declaredNames("alias fd forward"), ["fd"]);
  assert.deepEqual(declaredNames("define empty? :xs\n  return 1\nend"), [
    "empty?",
  ]);
  assert.deepEqual(declaredNames("DEFINE FD :n\n  print :n\nend"), ["FD"]);
  // A declaration nested in a block is still a declaration...
  assert.deepEqual(
    declaredNames("if true\n  define forward :n\n    print :n\n  end\nend if"),
    ["forward"],
  );
  // ...and text inside a block comment is not one.
  assert.deepEqual(
    declaredNames("/* a note about\ndefine forward :n\nend\n*/\nforward 10"),
    [],
  );

  assert.equal(builtInKind("FD"), "alias");
  assert.equal(builtInKind("Repeat"), "keyword");
  assert.equal(builtInKind("Forward"), "primitive");
  assert.equal(builtInKind("empty?"), "primitive");
  assert.equal(builtInKind("challenge"), "primitive");
  assert.equal(builtInKind("Polygon"), "free");
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
// may declare one. `challenge` is the Tutor (AI) profile's, and reaches {@link builtInKind} through
// {@link TUTOR_AI_PRIMITIVES} rather than a signature table — see that set's note.
test("no lesson declares an educational meta-command", () => {
  for (const name of ["explain", "why", "hint", "debug", "challenge"]) {
    assert.equal(
      builtInKind(name),
      "primitive",
      `\`${name}\` is a meta-command OpenLogo owns`,
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

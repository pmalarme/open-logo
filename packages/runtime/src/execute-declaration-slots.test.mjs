// The runtime's **declaration-slot** guard — issue #839, implementing maintainer ruling #833
// (rules 3 and 6) at phase-1 registration (`spec/execution-model.md:82-89`).
//
// A declaration slot (`define`/`to`, `struct`) asks one question — *is this name already taken, and
// by whom?* — and `spec/error-model.md:132-141` splits the answer in two so each code means exactly
// one thing: `ol-reserved-word` (OpenLogo owns this name) and `ol-duplicate-definition` (something
// in the program already declares it, with `params.original_span` naming where).
//
// `check()` has answered that question since issue #838. `execute()` did not: it checked `struct`
// names only, under the retired `namespace` param, and never checked `define` at all — so
// `define foo` twice ran the SECOND body, and `define first` left the learner's procedure silently
// dead behind the primitive. These tests pin the runtime's half AND the agreement between the two
// stages, which is the property that actually decayed.
//
// **Why the built-in enumeration is derived, not listed.** The names are walked out of
// `@openlogo/parser`'s own registries (`OL_KEYWORDS`, `OL_PROFILE_KEYWORDS`, `profilePrimitiveNames`
// over `OL_CHECK_PROFILES`, `heritageAliasNames`). A hand-maintained runtime copy of the list is the
// exact mechanism by which `execute()` and `check()` drifted apart in the first place
// (`docs/adr/0021-built-in-names-list-and-ci-gate.md`), so a name added to any profile's table is
// covered here the day it lands rather than the day someone remembers to add it.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalOfHeritageAlias,
  check,
  heritageAliasNames,
  OL_CHECK_PROFILES,
  OL_KEYWORDS,
  OL_PROFILE_KEYWORDS,
  parse,
  profilePrimitiveNames,
} from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

const doc = "execute-declaration-slots.logo";

/** Every keyword, of Core and of every keyword-contributing profile. */
const everyKeyword = [
  ...OL_KEYWORDS,
  ...Object.values(OL_PROFILE_KEYWORDS).flat(),
];

/** Every primitive name any profile registers, plus every Heritage short-alias spelling. */
const everyPrimitiveName = [
  ...OL_CHECK_PROFILES.flatMap((profile) => profilePrimitiveNames(profile)),
  ...heritageAliasNames(),
];

/** Every built-in name: what `ol-reserved-word` is about (`spec/error-model.md:125`). */
const everyBuiltInName = [
  ...new Set([...everyKeyword, ...everyPrimitiveName]),
].sort();

/** The `[code, params]` identity of every diagnostic `execute()` reports for `source`. */
function executeIdentity(source) {
  return execute(source, doc).diagnostics.map((finding) => [
    finding.code,
    finding.params,
  ]);
}

/** The same, from `check()` with every profile active — the stage `execute()` must agree with. */
function checkIdentity(source) {
  const { ast, diagnostics } = parse(source, doc);
  if (diagnostics.length > 0) {
    return diagnostics.map((finding) => [finding.code, finding.params]);
  }
  return check(ast, { profiles: OL_CHECK_PROFILES }).diagnostics.map(
    (finding) => [finding.code, finding.params],
  );
}

/**
 * The declaration `define <name> … end` with an EMPTY body. Deliberately empty: a body is source
 * too, and a body that calls a primitive is re-read against the very declaration under test — with
 * `print 1` as the body, `define print` declares a zero-parameter `print` and the body's own
 * `print 1` then leaves `1` stranded as `ol-bad-token`, which has nothing to do with the
 * declaration slot. An empty body keeps each sweep row about the name alone.
 */
function declareProcedure(name) {
  return `define ${name}\nend`;
}

// ---------------------------------------------------------------------------
// The enumeration is real — a guard against every loop below iterating nothing
// ---------------------------------------------------------------------------

test("the derived built-in-name enumeration is non-trivial and holds the names this slice is about", () => {
  // Three sessions in this saga shipped a test whose body never ran, because the array it iterated
  // was empty. `profilePrimitiveNames` reports `[]` for an unrecognized profile rather than
  // throwing, so an unguarded sweep would pass over nothing. Assert the shape of the enumeration
  // before relying on it, and anchor it on names drawn from four DIFFERENT registries so a single
  // table falling out of the walk is visible rather than merely smaller.
  assert.ok(
    everyBuiltInName.length > 100,
    `expected a substantial built-in-name list, got ${everyBuiltInName.length}`,
  );
  for (const name of [
    "define", // Core keyword
    "ask", // Sprites profile keyword
    "first", // Core primitive
    "forward", // Turtle & Rendering primitive
    "dict", // Data primitive
    "hint", // Educational primitive
    "challenge", // Tutor primitive
    "who", // Sprites primitive
    "wait", // Interaction & Events primitive
    "beep", // Sound primitive
    "grid", // Geometry overlay primitive
    "fd", // Heritage short alias
  ]) {
    assert.ok(
      everyBuiltInName.includes(name),
      `${name} must be in the derived built-in-name list`,
    );
  }
});

// ---------------------------------------------------------------------------
// AC4 — "nothing shadows", enforced at runtime for EVERY built-in name
// ---------------------------------------------------------------------------

test("EVERY built-in name is rejected at `define`, with `ol-reserved-word` and `params: { name }`", () => {
  const accepted = [];
  const wrongIdentity = [];
  for (const name of everyBuiltInName) {
    const identity = executeIdentity(declareProcedure(name));
    if (identity.length === 0) {
      accepted.push(name);
      continue;
    }
    const [[code, params]] = identity;
    if (
      identity.length !== 1 ||
      code !== "ol-reserved-word" ||
      params.name !== name ||
      Object.keys(params).length !== 1
    ) {
      wrongIdentity.push([name, identity]);
    }
  }
  assert.deepEqual(accepted, [], "no built-in name may be declared");
  assert.deepEqual(wrongIdentity, []);
});

test("EVERY built-in name is rejected at `struct` too — both registration forms, not just one", () => {
  // Ruling #833's amendment measured that the names free at `define` were free at `struct` as well,
  // so a fix covering only one form would leave the other open.
  const accepted = [];
  for (const name of everyBuiltInName) {
    if (executeIdentity(`struct ${name} [ x y ]`).length === 0) {
      accepted.push(name);
    }
  }
  assert.deepEqual(accepted, []);
});

test("`execute()` and `check()` report the SAME identity for every built-in name at `define`", () => {
  // The cross-stage agreement, name by name. Only `stage` may differ (`"runtime"` vs `"semantic"`),
  // because `execute()` runs `parse()` and never `check()`.
  const disagreements = [];
  for (const name of everyBuiltInName) {
    const source = declareProcedure(name);
    const fromExecute = executeIdentity(source);
    const fromCheck = checkIdentity(source);
    if (JSON.stringify(fromExecute) !== JSON.stringify(fromCheck)) {
      disagreements.push([name, fromCheck, fromExecute]);
    }
  }
  assert.deepEqual(disagreements, []);
});

test("`execute()` and `check()` agree on the SPAN, not merely the code and params", () => {
  for (const name of ["forward", "fd", "hint", "dict", "if"]) {
    const source = declareProcedure(name);
    const { ast } = parse(source, doc);
    const [fromCheck] = check(ast, { profiles: OL_CHECK_PROFILES }).diagnostics;
    const [fromExecute] = execute(source, doc).diagnostics;
    assert.deepEqual(fromExecute.source_span, fromCheck.source_span, name);
  }
});

test("a Heritage alias is exactly as illegal as its canonical, by construction", () => {
  // Heritage is "alternate spellings only, no new semantics", so `define pr` must be as (il)legal as
  // `define print`. Derived from the alias registry, so a new alias is covered without editing this.
  for (const alias of heritageAliasNames()) {
    const canonical = canonicalOfHeritageAlias(alias);
    assert.notEqual(canonical, undefined, alias);
    assert.deepEqual(
      executeIdentity(declareProcedure(alias)).map(([code]) => code),
      executeIdentity(declareProcedure(canonical)).map(([code]) => code),
      `${alias} must be exactly as illegal as ${canonical}`,
    );
  }
});

test("no canonical spelling is itself an alias, so alias resolution is depth-1 and cannot loop", () => {
  // The runtime's `isPrimitiveName` re-enters itself on a resolved canonical. That terminates only
  // because the registry is one level deep; pinned here off the registry rather than assumed.
  for (const alias of heritageAliasNames()) {
    assert.equal(
      canonicalOfHeritageAlias(canonicalOfHeritageAlias(alias)),
      undefined,
      `${alias}'s canonical must not itself be an alias`,
    );
  }
});

// ---------------------------------------------------------------------------
// AC1 / AC2 — duplicates, and the four forms agreeing across both stages
// ---------------------------------------------------------------------------

/** The four duplicate-registration forms of issue #839's AC2 table, with DIFFERING declarations. */
const duplicateForms = {
  "define twice": "define foo\n  print 111\nend\ndefine foo\n  print 222\nend\nfoo",
  "struct twice": "struct point [ x y ]\nstruct point [ a b ]",
  "define then struct": "define pair\n  return 1\nend\nstruct pair [ x ]",
  "struct then define": "struct pair [ x ]\ndefine pair\n  return 1\nend",
};

test("all four duplicate-registration forms raise ol-duplicate-definition at runtime", () => {
  for (const [label, source] of Object.entries(duplicateForms)) {
    const identity = executeIdentity(source);
    assert.equal(identity.length, 1, label);
    assert.equal(identity[0][0], "ol-duplicate-definition", label);
    assert.notEqual(
      identity[0][1].original_span,
      undefined,
      `${label} must carry both spans`,
    );
  }
});

test("all four forms report the SAME code, params and span from check() and execute()", () => {
  // AC2 in full: the table that used to have one row splitting across the stages and three rows
  // reporting the wrong code now has four rows that agree.
  for (const [label, source] of Object.entries(duplicateForms)) {
    assert.deepEqual(executeIdentity(source), checkIdentity(source), label);
    const { ast } = parse(source, doc);
    const [fromCheck] = check(ast, { profiles: OL_CHECK_PROFILES }).diagnostics;
    const [fromExecute] = execute(source, doc).diagnostics;
    assert.deepEqual(fromExecute.source_span, fromCheck.source_span, label);
  }
});

test("a duplicate definition halts the program: NEITHER body runs", () => {
  // The bug in one assertion. `execute()` used to print `222` here.
  const result = execute(duplicateForms["define twice"], doc);
  assert.deepEqual(
    result.events,
    [],
    "no event at all, not merely no print of 111",
  );
});

test("`ol-duplicate-definition` is not profile-gated — Core-only sees it too", () => {
  // Phase-1 registration is unconditional (`spec/execution-model.md:82-88`). `execute()` has no
  // profile set to gate on, and `check()` must not gate either; a Core-only program declaring
  // `point` twice is a duplicate whether or not the Data profile is claimed.
  const source = duplicateForms["struct twice"];
  const { ast } = parse(source, doc);
  assert.deepEqual(
    check(ast, { profiles: ["core-language"] }).diagnostics.map((d) => d.code),
    ["ol-duplicate-definition"],
  );
  assert.deepEqual(executeIdentity(source).map(([code]) => code), [
    "ol-duplicate-definition",
  ]);
});

// ---------------------------------------------------------------------------
// Priority and ordering
// ---------------------------------------------------------------------------

test("a built-in name declared twice reports ol-reserved-word, never degrading into a duplicate", () => {
  // A built-in name is never recorded as a first declaration, so the second `define forward` cannot
  // be reported as a duplicate of the first. `execute()` halts at the first collision, so what this
  // pins at runtime is that the FIRST declaration is already the reserved-word error; `check()`,
  // which reports every finding, is asserted alongside to show BOTH are reserved-word.
  const source = "define forward\nend\ndefine forward\nend";
  assert.deepEqual(executeIdentity(source), [
    ["ol-reserved-word", { name: "forward" }],
  ]);
  const { ast } = parse(source, doc);
  assert.deepEqual(
    check(ast, { profiles: OL_CHECK_PROFILES }).diagnostics.map((d) => d.code),
    ["ol-reserved-word", "ol-reserved-word"],
  );
});

test("the first collision in source order halts the run, whichever code it carries", () => {
  const duplicateFirst =
    "define tally\n  print 1\nend\ndefine tally\n  print 2\nend\ndefine forward\n  print 3\nend";
  const builtInFirst =
    "define forward\n  print 3\nend\ndefine tally\n  print 1\nend\ndefine tally\n  print 2\nend";
  assert.equal(executeIdentity(duplicateFirst)[0][0], "ol-duplicate-definition");
  assert.equal(executeIdentity(builtInFirst)[0][0], "ol-reserved-word");
});

// ---------------------------------------------------------------------------
// Non-regression: what stays legal
// ---------------------------------------------------------------------------

test("binding a built-in name is still legal at run time — only DECLARING one is not", () => {
  // `spec/grammar.md` makes accepting these a MUST: a program may bind a value to any name. This is
  // the boundary the declaration-slot guard must not cross, and the one issue #739 got wrong.
  const result = execute(
    ':end = 7\nprint :end\nlocal count\nfor forward from 1 to 2 [ print :forward ]',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]),
    [7, 1, 2],
  );
});

test("declaring ordinary names, forward references, and mutual recursion all still work", () => {
  // The registration pass builds the same two registries it always did; only its rejections changed.
  const result = execute(
    "print later 3\ndefine later :n\n  return helper :n\nend\ndefine helper :n\n  return :n * 2\nend\nstruct point [ x y ]\nprint (point 1 2).y",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]),
    [6, 2],
  );
});

test("a name declared once and CALLED many times is not a duplicate", () => {
  const result = execute(
    "define twice :n\n  return :n * 2\nend\nprint twice 1\nprint twice 2\nprint twice 3",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.events.filter((event) => event.kind === "print").length,
    3,
  );
});

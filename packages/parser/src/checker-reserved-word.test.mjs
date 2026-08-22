// Unit tests for the two **declaration-slot** rules in `checker-reserved-word.ts`:
// `ol-reserved-word` ("OpenLogo owns this name") and `ol-duplicate-definition` ("something in the
// program already declares this name"). Issue #838 is what split them; before it, one code with a
// `namespace` param carried both meanings.
//
// The file grew out of issues #746 and #742, which closed two holes in the primitive category
// together — the Sprites reporter table, and the Heritage short aliases — and those tests are kept
// below because the property they pin (an alias is its canonical, **by construction**) is exactly
// what let #838 close nine more names with no edit to the Heritage branch at all.
//
// What #838 adds here:
//
//   1. **All 45 built-in names are blocked at BOTH registration forms, under EVERY profile set.**
//      The list is spelled out verbatim from the issue's AC2 rather than re-derived, because the
//      count moved 23 -> 65 -> 42 -> 45 and every correction came from a method that could not
//      observe what it claimed. A named list drifts loudly; a count drifts silently. The literals
//      are drift-guarded against the public registries below, so a rename fails here rather than
//      quietly shrinking the guard.
//   2. **`ol-reserved-word` carries `params: { name }` and nothing else**, and its one sentence
//      never says *keyword*, *primitive* or *alias* (`spec/error-model.md:125`, issue #883).
//   3. **`ol-duplicate-definition` carries BOTH spans** (`spec/error-model.md:126,143-146`).
//
// Every assertion that can be is driven off the **registry** — `heritageAliasNames()`,
// `OL_CHECK_PROFILES` — rather than a hand-kept list, so a future slice that adds an alias is
// pulled into this guard automatically instead of quietly escaping it.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "checker-reserved-word.logo";

/** Every profile the checker knows, so a name is tested against the widest possible claim. */
const ALL_PROFILES = OL.OL_CHECK_PROFILES;
const CORE_ONLY = ["core-language"];

/**
 * The Sprites reporters (`spec/turtles-and-sprites.md`'s C3 Kind-R rows). Spelled out rather than
 * enumerated, because `signatures.ts`' name-list counterparts are internal by convention — only the
 * `*Arity` lookups are on the public surface — and a test may not widen that surface to read one.
 * The literal is therefore drift-guarded below against the public `spritesPrimitiveArity`.
 */
const SPRITES_REPORTERS = ["new_turtle", "who", "turtles"];

/**
 * The 45 built-in names issue #838 blocks, exactly as its AC2 names them: 30 Turtle & Rendering
 * (including the five compact alias spellings), 9 Heritage short aliases, 4 Educational, 1 Tutor,
 * and `mod`. Measured free at both registration forms at the saga tip `fc4371d` — except `mod`,
 * which #837 had already reached as a keyword.
 */
const TURTLE_BUILT_INS = [
  "back",
  "clean",
  "clear_screen",
  "distance",
  "fill",
  "forward",
  "heading",
  "hide_turtle",
  "home",
  "left",
  "pen_down",
  "pen_up",
  "pos",
  "right",
  "set_background",
  "set_color",
  "set_heading",
  "set_shape",
  "set_width",
  "set_xy",
  "show_turtle",
  "stamp",
  "towards",
  "xcor",
  "ycor",
  "setbg",
  "setcolor",
  "seth",
  "setwidth",
  "setxy",
];
const HERITAGE_TURTLE_ALIASES = [
  "fd",
  "bk",
  "lt",
  "rt",
  "pu",
  "pd",
  "st",
  "ht",
  "cs",
];
const EDUCATIONAL_BUILT_INS = ["debug", "explain", "hint", "why"];
const TUTOR_BUILT_INS = ["challenge"];
const AC2_BUILT_IN_NAMES = [
  ...TURTLE_BUILT_INS,
  ...HERITAGE_TURTLE_ALIASES,
  ...EDUCATIONAL_BUILT_INS,
  ...TUTOR_BUILT_INS,
  "mod",
];

/** Every diagnostic `source` raises under `profiles`. Parse errors fail loudly. */
function findings(source, profiles) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected ${JSON.stringify(source)} to parse cleanly`,
  );
  return OL.check(ast, { profiles, source }).diagnostics;
}

/** The `ol-reserved-word` findings `source` raises under `profiles`. */
function reservedWordFindings(source, profiles) {
  return findings(source, profiles).filter(
    (d) => d.code === "ol-reserved-word",
  );
}

/** The `ol-duplicate-definition` findings `source` raises under `profiles`. */
function duplicateFindings(source, profiles) {
  return findings(source, profiles).filter(
    (d) => d.code === "ol-duplicate-definition",
  );
}

/** `true` when `define <name>` raises `ol-reserved-word`. */
function collides(name, profiles) {
  return reservedWordFindings(`define ${name}\nend\n`, profiles).length > 0;
}

// --- #838 AC2: all 45 built-in names, both slots, every profile set ----------------------------

test("#838: the AC2 literal still matches the registries it was measured from", () => {
  // Drift guard. The list above is deliberately hand-written (see the header), so it needs a guard
  // that a rename in `signatures.ts` breaks here rather than silently shrinking the coverage below.
  assert.equal(AC2_BUILT_IN_NAMES.length, 45, "AC2 names exactly 45 names");
  assert.equal(new Set(AC2_BUILT_IN_NAMES).size, 45, "the 45 are distinct");
  for (const name of TURTLE_BUILT_INS) {
    assert.notEqual(
      OL.turtlePrimitiveArity(name),
      undefined,
      `${name} is no longer a Turtle & Rendering primitive`,
    );
  }
  for (const name of EDUCATIONAL_BUILT_INS) {
    assert.equal(
      OL.educationalPrimitiveArity(name),
      0,
      `${name} is no longer a zero-arity Educational meta-command`,
    );
  }
  for (const name of TUTOR_BUILT_INS) {
    assert.equal(
      OL.tutorPrimitiveArity(name),
      0,
      `${name} is no longer a zero-arity Tutor command (spec/conformance.md:244)`,
    );
  }
  for (const alias of HERITAGE_TURTLE_ALIASES) {
    const canonical = OL.canonicalOfHeritageAlias(alias);
    assert.ok(
      TURTLE_BUILT_INS.includes(canonical),
      `${alias} no longer aliases a Turtle & Rendering primitive (got ${canonical})`,
    );
  }
  assert.ok(OL.OL_KEYWORDS.includes("mod"), "mod is no longer a keyword");
});

test("#838 AC2: every built-in name is rejected at `define`, whatever profiles are active", () => {
  // "REGARDLESS of the active profile set, including Core-only" — `spec/grammar.md:408`: what a
  // profile decides is whether a name *works*, never whether a program may declare it. The
  // Core-only column is the one that was failing: it is the profile set a beginner's program runs
  // under, and it is where `define forward` silently stopped the turtle.
  for (const profiles of [ALL_PROFILES, CORE_ONLY]) {
    for (const name of AC2_BUILT_IN_NAMES) {
      const raised = reservedWordFindings(`define ${name}\nend\n`, profiles);
      assert.equal(
        raised.length,
        1,
        `define ${name} must raise exactly one ol-reserved-word under ${JSON.stringify(profiles)}`,
      );
      assert.deepEqual(raised[0].params, { name });
      assert.deepEqual(raised[0].source_span.start, [1, 8]);
      assert.deepEqual(raised[0].source_span.end, [1, 8 + name.length]);
    }
  }
});

test("#838 AC2: every built-in name is rejected at `struct` too, whatever profiles are active", () => {
  // The fix must cover BOTH registration forms or the shadow simply moves to the one that was
  // missed. `struct` is a declaration slot with no profile condition on it (`spec/grammar.md:382`),
  // so its built-in check runs even when `data` is inactive and the declaration would register
  // nothing: the program still asked OpenLogo for a name OpenLogo owns.
  for (const profiles of [ALL_PROFILES, CORE_ONLY]) {
    for (const name of AC2_BUILT_IN_NAMES) {
      const raised = reservedWordFindings(`struct ${name} [ x ]\n`, profiles);
      assert.equal(
        raised.length,
        1,
        `struct ${name} must raise exactly one ol-reserved-word under ${JSON.stringify(profiles)}`,
      );
      assert.deepEqual(raised[0].params, { name });
    }
  }
});

test("#838 AC2: a built-in name is rejected in the source spelling the learner wrote", () => {
  // `params.name` is **surface by contract** (#737's audit), and matching is case-insensitive.
  const raised = reservedWordFindings("define ForWard\nend\n", CORE_ONLY);
  assert.equal(raised.length, 1);
  assert.deepEqual(raised[0].params, { name: "ForWard" });
});

// --- #838 AC4: one code, one sentence, no namespace --------------------------------------------

test("#838 AC4: ol-reserved-word carries params { name } only and names no category", () => {
  // Issue #883, measured before the fix: `define thing` produced the ungrammatical "thing is
  // already a reserved", and `define count` leaked the word *primitive* into learner text. One
  // sentence replaces both (`spec/error-model.md:125`), and the three forbidden words are asserted
  // rather than assumed, because a well-meaning "clearer" message is exactly how they come back.
  for (const name of ["thing", "count", "forward", "fd", "challenge", "mod"]) {
    const [finding] = reservedWordFindings(`define ${name}\nend\n`, CORE_ONLY);
    assert.deepEqual(Object.keys(finding.params), ["name"]);
    assert.equal(
      finding.message,
      `${name} is already part of OpenLogo. Choose another name.`,
    );
    for (const forbidden of ["keyword", "primitive", "alias", "reserved"]) {
      assert.ok(
        !finding.message.toLowerCase().includes(forbidden),
        `the learner message must never say "${forbidden}": ${finding.message}`,
      );
    }
    assert.equal(finding.stage, "semantic");
    assert.equal(finding.severity, "error");
  }
});

// --- #838 AC5: ol-duplicate-definition, carrying both spans ------------------------------------

test("#838 AC5: a procedure defined twice raises ol-duplicate-definition with both spans", () => {
  const source = "define f\nend\ndefine f\nend\n";
  const raised = findings(source, CORE_ONLY);
  assert.equal(raised.length, 1, "only the LATER declaration is flagged");
  const [finding] = raised;
  assert.equal(finding.code, "ol-duplicate-definition");
  assert.deepEqual(finding.source_span.start, [3, 8]);
  assert.deepEqual(finding.params.name, "f");
  assert.deepEqual(finding.params.original_span, {
    document: doc,
    start: [1, 8],
    end: [1, 9],
  });
  assert.equal(finding.message, "You already defined f on line 1.");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
});

test("#838 AC5: a third declaration still names the FIRST one", () => {
  // `original_span` is "the earlier one" (`spec/error-model.md:126`). Pointing a third `define` at
  // the second would send the learner to another duplicate rather than to the definition that won.
  const raised = duplicateFindings(
    "define f\nend\ndefine f\nend\ndefine f\nend\n",
    CORE_ONLY,
  );
  assert.equal(raised.length, 2);
  for (const finding of raised) {
    assert.deepEqual(finding.params.original_span.start, [1, 8]);
  }
});

test("#838 AC5: struct-vs-struct and struct-vs-procedure duplicate in either order", () => {
  for (const [label, source, laterLine] of [
    ["struct twice", "struct pt [ x ]\nstruct pt [ y ]\n", 2],
    ["procedure then struct", "define pt\nend\nstruct pt [ x ]\n", 3],
    ["struct then procedure", "struct pt [ x ]\ndefine pt\nend\n", 2],
  ]) {
    const raised = findings(source, ["core-language", "data"]);
    assert.equal(raised.length, 1, `${label} should raise exactly one finding`);
    assert.equal(raised[0].code, "ol-duplicate-definition");
    assert.deepEqual(raised[0].source_span.start, [laterLine, 8]);
    assert.deepEqual(raised[0].params.original_span.start, [1, 8]);
  }
});

test("#838 AC5: struct duplicates stay gated on the data profile", () => {
  // The scope boundary #838 kept: with `data` inactive a struct registers no constructor at all
  // (`checker-names.ts`'s `collectVisibleNames`, issue #405), so there is nothing for a later
  // declaration to duplicate and reporting one would flag a name that is not in fact taken. Only
  // the BUILT-IN half of the struct check is unconditional. Unifying the gate is issue #841's.
  assert.deepEqual(
    findings("struct pt [ x ]\nstruct pt [ y ]\n", CORE_ONLY),
    [],
    "a struct cannot duplicate another struct while data is inactive",
  );
  assert.deepEqual(
    findings("define pt\nend\nstruct pt [ x ]\n", CORE_ONLY),
    [],
    "a struct cannot duplicate a procedure while data is inactive",
  );
});

test("#838 AC5: built-in beats duplicate — a doubly-taken name is reported once, as reserved", () => {
  // `define forward` twice is both "OpenLogo owns this" and "you already declared this". Only the
  // first answer is actionable, so it is the only one reported — and each occurrence gets exactly
  // one diagnostic, never two.
  const raised = findings(
    "define forward\nend\ndefine forward\nend\n",
    CORE_ONLY,
  );
  assert.equal(raised.length, 2);
  for (const finding of raised) {
    assert.equal(finding.code, "ol-reserved-word");
  }
});

test("#838 AC3: the Geometry stdlib is a library — defining it is legal, redefining is a duplicate", () => {
  // Maintainer ruling in #838: `polygon`/`circle`/`arc`/`star`/`area`/`perimeter` have `.logo`
  // files under `stdlib/geometry/`, so they are OpenLogo SOURCE, not names OpenLogo implements.
  // `spec/educational-model.md:169` — "Learners build `polygon` from `repeat`" — depends on the
  // first `define polygon` staying clean, and `spec/grammar.md:412` makes a SECOND one
  // `ol-duplicate-definition`, never `ol-reserved-word`. The overlays `grid`/`axes`/`measure` are
  // renderer-backed primitives and stay blocked (pinned by the geometry conformance fixtures).
  const stdlib = ["polygon", "circle", "arc", "star", "area", "perimeter"];
  for (const name of stdlib) {
    assert.deepEqual(
      findings(`define ${name}\nend\n`, ALL_PROFILES),
      [],
      `${name} is library source, so building it must stay legal — that IS the lesson`,
    );
    const [finding] = findings(
      `define ${name}\nend\ndefine ${name}\nend\n`,
      ALL_PROFILES,
    );
    assert.equal(
      finding.code,
      "ol-duplicate-definition",
      `redefining ${name} is a duplicate, not a collision with the language`,
    );
  }
});

// --- #742: a Heritage alias is its canonical, in both directions ------------------------------

test("#742: every Heritage alias collides exactly as its canonical does, under every profile", () => {
  // The whole point of that fix: not "aliases are rejected" but "an alias and its canonical always
  // give the SAME answer". Pinning the relationship rather than the answer is what let #838 flip the
  // nine turtle aliases with no edit to the Heritage branch, and what makes a future divergence
  // impossible to miss.
  const aliases = OL.heritageAliasNames();
  assert.ok(
    aliases.length > 0,
    "expected the Heritage alias registry to be populated",
  );
  for (const alias of aliases) {
    const canonical = OL.canonicalOfHeritageAlias(alias);
    assert.ok(canonical, `${alias} must resolve to a canonical spelling`);
    assert.equal(
      collides(alias, ALL_PROFILES),
      collides(canonical, ALL_PROFILES),
      `define ${alias} and define ${canonical} must agree — Heritage is alternate spellings only, no new semantics (spec/conformance.md:146)`,
    );
  }
});

test("#742: the four Core-backed aliases are rejected, with the surface spelling in params.name", () => {
  // The concrete half of the symmetry above, spelled out so the test is not vacuous if the registry
  // were ever emptied. `pr`/`bf`/`bl`/`se` alias **Core** primitives (`print`/`butfirst`/`butlast`/
  // `sentence`), so these four are exactly the pairs that were asymmetric before #742.
  for (const [alias, canonical] of [
    ["pr", "print"],
    ["bf", "butfirst"],
    ["bl", "butlast"],
    ["se", "sentence"],
  ]) {
    assert.equal(
      OL.canonicalOfHeritageAlias(alias),
      canonical,
      `registry drift: ${alias} no longer aliases ${canonical}`,
    );
    const raised = reservedWordFindings(`define ${alias}\nend\n`, ALL_PROFILES);
    assert.equal(
      raised.length,
      1,
      `define ${alias} should raise exactly one finding`,
    );
    const [finding] = raised;
    // `params.name` is **surface by contract** (#737's audit): the diagnostic names the registration
    // the learner actually wrote, at that name's own span — so `pr`, never `print`.
    assert.deepEqual(finding.params, { name: alias });
    assert.deepEqual(finding.source_span.start, [1, 8]);
    assert.deepEqual(finding.source_span.end, [1, 8 + alias.length]);
  }
});

test("#742: the four Core-backed aliases are the last profile-gated names left", () => {
  // The boundary #838 deliberately left standing, asserted so it cannot be mistaken for an
  // oversight in either direction. `spec/grammar.md:408` makes profile words built-in
  // unconditionally, and #838 delivered that for the 45 names it had MEASURED — which is why the
  // nine turtle aliases now raise Core-only. `pr`/`bf`/`bl`/`se` resolve to CORE canonicals reached
  // through the still-gated branch, so they remain free without `heritage`. Issue #841's always-on
  // list is what takes these four, and this assertion flips to "rejected" when it lands.
  for (const alias of ["pr", "bf", "bl", "se"]) {
    assert.deepEqual(
      reservedWordFindings(`define ${alias}\nend\n`, CORE_ONLY),
      [],
      `${alias} still depends on the heritage gate until #841`,
    );
  }
  for (const alias of HERITAGE_TURTLE_ALIASES) {
    assert.ok(
      collides(alias, CORE_ONLY),
      `${alias} is a built-in name unconditionally (spec/grammar.md:408,414)`,
    );
  }
});

test("#742: alias resolution is depth-1 — no canonical spelling is itself an alias", () => {
  // Both `unconditionalBuiltInName` and `gatedPrimitiveCollision` re-enter themselves on the
  // resolved canonical. That terminates only because the registry is a one-step map; an alias whose
  // canonical were itself an alias would loop. The registry is the thing to guard, so guard it
  // directly rather than adding a depth counter to the checker for a shape the language does not
  // have.
  for (const alias of OL.heritageAliasNames()) {
    const canonical = OL.canonicalOfHeritageAlias(alias);
    assert.equal(
      OL.canonicalOfHeritageAlias(canonical),
      undefined,
      `${alias} resolves to ${canonical}, which is itself an alias — the registry must stay one-step`,
    );
  }
});

test("#742: an alias collides from every registration form its canonical does", () => {
  // `define` is not the only declaration slot: `struct` routes through the same rule, so the alias
  // must behave identically at both or the shadow simply moves to whichever form was missed.
  // (`local` was a third row here until maintainer ruling #833 / issue #837 made it a binding form
  // — see `keyword-binding-forms.test.mjs`.)
  for (const [label, aliasSource, canonicalSource] of [
    ["define", "define pr\nend\n", "define print\nend\n"],
    ["struct", "struct pr [ x ]\n", "struct print [ x ]\n"],
  ]) {
    const aliasFindings = reservedWordFindings(aliasSource, ALL_PROFILES);
    const canonicalFindings = reservedWordFindings(
      canonicalSource,
      ALL_PROFILES,
    );
    assert.equal(
      aliasFindings.length,
      1,
      `${label} pr should raise one finding`,
    );
    assert.equal(
      canonicalFindings.length,
      1,
      `${label} print should raise one finding`,
    );
    assert.deepEqual(aliasFindings[0].params, { name: "pr" });
    assert.deepEqual(canonicalFindings[0].params, { name: "print" });
  }
});

// --- #746: the Sprites reporter table is consulted --------------------------------------------

test("#746: the Sprites reporter literal still matches the registry", () => {
  // Drift guard for `SPRITES_REPORTERS`. Each must be a zero-arity Sprites primitive, and a name
  // that is *not* one must not be — so a rename lands here rather than silently shrinking coverage.
  for (const reporter of SPRITES_REPORTERS) {
    assert.equal(
      OL.spritesPrimitiveArity(reporter),
      0,
      `${reporter} is no longer a zero-arity Sprites reporter`,
    );
  }
  for (const notAReporter of ["tell", "ask", "each", "forward", "square"]) {
    assert.equal(
      OL.spritesPrimitiveArity(notAReporter),
      undefined,
      `${notAReporter} must not be in the Sprites primitive table`,
    );
  }
});

test("#746: every Sprites reporter collides while sprites is active", () => {
  for (const reporter of SPRITES_REPORTERS) {
    const raised = reservedWordFindings(
      `define ${reporter}\nend\n`,
      ALL_PROFILES,
    );
    assert.equal(raised.length, 1);
    assert.deepEqual(raised[0].params, { name: reporter });
  }
});

test("#746: no Sprites reporter collides while the sprites profile is inactive", () => {
  for (const reporter of SPRITES_REPORTERS) {
    assert.deepEqual(
      reservedWordFindings(`define ${reporter}\nend\n`, CORE_ONLY),
      [],
      `${reporter} must stay free to declare when sprites is inactive`,
    );
  }
});

test("#746: the Sprites reporters match the four profiles that already collided", () => {
  // The consistency claim both issues rest on, asserted as one comparison rather than asserted of
  // Sprites alone: `grid` (Geometry), `set_tempo` (Sound), `dict` (Data), and `wait` (Interaction &
  // Events) were already rejected, and `who` was not. All five must now agree.
  for (const name of ["grid", "set_tempo", "dict", "wait", "who"]) {
    assert.ok(
      collides(name, ALL_PROFILES),
      `define ${name} must collide under its active profile`,
    );
  }
});

// --- Non-regression: neither branch widened anything it should not have -------------------------

test("no branch leaked: an ordinary learner name is still free to declare under every profile", () => {
  // The false-positive guard. The rule grew an unconditional branch; it may not make an ordinary
  // name collide, and the recursion in particular must not fire for a non-alias.
  for (const name of ["square", "my_shape", "spiral", "greet"]) {
    assert.deepEqual(
      findings(`define ${name}\nend\n`, ALL_PROFILES),
      [],
      `${name} is an ordinary name and must stay free to declare`,
    );
  }
});

test("no branch leaked: the Heritage form heads are still rejected under every profile set", () => {
  // #742's scope item 3, verified rather than assumed: `make`/`to`/`output`/`op` are keywords
  // (`spec/grammar.md`'s C19 list), so they were already caught — by the keyword branch, which runs
  // first and is profile-independent for Core keywords. Nothing changed here but the params.
  for (const head of OL.heritageFormHeadNames()) {
    for (const profiles of [ALL_PROFILES, CORE_ONLY]) {
      const raised = reservedWordFindings(`define ${head}\nend\n`, profiles);
      assert.equal(raised.length, 1, `define ${head} should raise one finding`);
      assert.deepEqual(raised[0].params, { name: head });
    }
  }
});

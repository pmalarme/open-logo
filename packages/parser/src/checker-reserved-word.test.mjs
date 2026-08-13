// Unit tests for the **primitive** category of the `ol-reserved-word` rule
// (`checker-reserved-word.ts`'s `primitiveCollision`), covering the two holes issues #746 and #742
// closed together — the Sprites reporter table, and the Heritage short aliases.
//
// Why one file for two issues: they are one property, and fixing either alone makes the language
// *less* consistent. `spec/tooling.md:184` is a normative Layer-2 "Required behavior" row —
// "Redefining a reserved word, **primitive**, existing procedure, existing type constructor, or
// existing alias → `ol-reserved-word`" — and `:175-176` requires it be applied against the **active
// profile set**. The checker honoured that for Core, Data, Geometry, Sound, and Interaction &
// Events, but not for Sprites (#746) and not for the Heritage aliases (#742). Landing #746 alone
// would have protected `forward`… while leaving `fd` open, moving the alias asymmetry from 4/13 to
// 13/13 — strictly worse. So both land here.
//
// The design property these tests pin is **symmetry by construction**: the `heritage` branch does
// not carry a table of its own, it resolves the alias through `canonicalOfHeritageAlias` and
// re-enters the same profile-table lookup on the canonical spelling. So an alias can never disagree
// with its canonical, whatever table the canonical is (or is not) in. Every assertion below is
// therefore driven off the **registry** — `heritageAliasNames()`, `spritesPrimitiveNames()`,
// `OL_CHECK_PROFILES` — rather than a hand-kept list, so a future slice that adds an alias or a
// Sprites reporter is pulled into this guard automatically instead of quietly escaping it.
//
// **Turtle & Rendering is deliberately still not consulted** (issue #783, awaiting a maintainer
// ruling): `define forward` is accepted, so `define fd` is accepted too. That is asserted here as an
// explicit, intentional pairing rather than left to fall out silently — see the "tracks its
// canonical" test, which pins the *relationship*, not today's answer, and so keeps passing
// unchanged on the day #783 wires `turtlePrimitiveArity` in.

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

/** The `ol-reserved-word` findings `source` raises under `profiles`. Parse errors fail loudly. */
function reservedWordFindings(source, profiles) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected ${JSON.stringify(source)} to parse cleanly`,
  );
  return OL.check(ast, { profiles, source }).diagnostics.filter(
    (d) => d.code === "ol-reserved-word",
  );
}

/** `true` when `define <name>` raises `ol-reserved-word` with `namespace: "primitive"`. */
function collidesAsPrimitive(name, profiles) {
  return reservedWordFindings(`define ${name}\nend\n`, profiles).some(
    (d) => d.params.namespace === "primitive",
  );
}

// --- #742: a Heritage alias is its canonical, in both directions ------------------------------

test("#742: every Heritage alias collides exactly as its canonical does, under every profile", () => {
  // The whole point of the fix: not "aliases are rejected" (nine of the thirteen are not, because
  // their Turtle & Rendering canonicals are not yet consulted — #783) but "an alias and its
  // canonical always give the SAME answer". Pinning the relationship rather than the answer is what
  // makes this test survive #783 unchanged, and what makes a future divergence impossible to miss.
  const aliases = OL.heritageAliasNames();
  assert.ok(
    aliases.length > 0,
    "expected the Heritage alias registry to be populated",
  );
  for (const alias of aliases) {
    const canonical = OL.canonicalOfHeritageAlias(alias);
    assert.ok(canonical, `${alias} must resolve to a canonical spelling`);
    assert.equal(
      collidesAsPrimitive(alias, ALL_PROFILES),
      collidesAsPrimitive(canonical, ALL_PROFILES),
      `define ${alias} and define ${canonical} must agree — Heritage is alternate spellings only, no new semantics (spec/conformance.md:146)`,
    );
  }
});

test("#742: the four Core-backed aliases are now rejected, with the surface spelling in params.name", () => {
  // The concrete half of the symmetry above, spelled out so the test is not vacuous if the registry
  // were ever emptied. `pr`/`bf`/`bl`/`se` alias **Core** primitives (`print`/`butfirst`/`butlast`/
  // `sentence`), the one table already consulted — so these four are exactly the pairs that were
  // asymmetric before the fix, and the four that must now raise.
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
    const findings = reservedWordFindings(
      `define ${alias}\nend\n`,
      ALL_PROFILES,
    );
    assert.equal(
      findings.length,
      1,
      `define ${alias} should raise exactly one finding`,
    );
    const [finding] = findings;
    // `params.name` is **surface by contract** (#737's audit): the diagnostic names the registration
    // the learner actually wrote, at that name's own span — so `pr`, never `print`.
    assert.deepEqual(finding.params, { name: alias, namespace: "primitive" });
    assert.equal(finding.stage, "semantic");
    assert.equal(finding.severity, "error");
    assert.deepEqual(finding.source_span.start, [1, 8]);
    assert.deepEqual(finding.source_span.end, [1, 8 + alias.length]);
  }
});

test("#742: no Heritage alias collides while the heritage profile is inactive", () => {
  // The other direction, and the property that keeps this from being a Core-wide land-grab: `pr` is
  // an ordinary name in a Core-only program, exactly as `define ask` stays legal without Sprites
  // (`spec/tooling.md:175-176` — the rule is applied against the *active* profile set).
  for (const alias of OL.heritageAliasNames()) {
    assert.deepEqual(
      reservedWordFindings(`define ${alias}\nend\n`, CORE_ONLY),
      [],
      `${alias} must stay free to declare when heritage is inactive`,
    );
  }
});

test("#742: an alias tracks its canonical for Turtle & Rendering too — both accepted, together (#783)", () => {
  // The scope boundary, asserted rather than assumed. `fd` aliases `forward`, a Turtle & Rendering
  // primitive whose table `collidingNamespace` deliberately does NOT consult while #783 awaits a
  // maintainer ruling. Because the fix resolves to the canonical instead of keeping its own table,
  // `define fd` is accepted *because* `define forward` is — and on the day #783 wires
  // `turtlePrimitiveArity` in, both flip together with no edit to the Heritage branch. This test
  // asserts the pairing, so it passes before and after that ruling; the per-name answer is pinned by
  // the conformance fixtures instead.
  const turtleAliases = OL.heritageAliasNames().filter(
    (alias) =>
      OL.turtlePrimitiveArity(OL.canonicalOfHeritageAlias(alias)) !== undefined,
  );
  assert.equal(
    turtleAliases.length,
    9,
    "expected the nine turtle-command aliases fd/bk/lt/rt/st/ht/pu/pd/cs",
  );
  for (const alias of turtleAliases) {
    const canonical = OL.canonicalOfHeritageAlias(alias);
    assert.equal(
      collidesAsPrimitive(alias, ALL_PROFILES),
      collidesAsPrimitive(canonical, ALL_PROFILES),
      `${alias} must track ${canonical} whichever way #783 is ruled`,
    );
  }
});

test("#742: alias resolution is depth-1 — no canonical spelling is itself an alias", () => {
  // `primitiveCollision` re-enters itself on the resolved canonical. That terminates only because
  // the registry is a one-step map; an alias whose canonical were itself an alias would loop. The
  // registry is the thing to guard, so guard it directly rather than adding a depth counter to the
  // checker for a shape the language does not have.
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
  // `define` is not the only registration: `local` and `struct` route through the same
  // `collidingNamespace`, so the alias must behave identically at all three or the shadow simply
  // moves to whichever form was missed.
  for (const [label, aliasSource, canonicalSource] of [
    ["define", "define pr\nend\n", "define print\nend\n"],
    ["local", "local pr\n", "local print\n"],
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
    assert.equal(aliasFindings[0].params.namespace, "primitive");
    assert.equal(
      aliasFindings[0].params.namespace,
      canonicalFindings[0].params.namespace,
      `${label}: pr and print must report the same namespace`,
    );
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

test("#746: every Sprites reporter collides as a primitive while sprites is active", () => {
  for (const reporter of SPRITES_REPORTERS) {
    const findings = reservedWordFindings(
      `define ${reporter}\nend\n`,
      ALL_PROFILES,
    );
    assert.equal(findings.length, 1);
    // `"primitive"`, NOT `"reserved"` — the reporters are C3 Kind-R primitives, unlike the
    // block-heads `tell`/`ask`/`each`, which `spec/turtles-and-sprites.md:154` reserves.
    assert.deepEqual(findings[0].params, {
      name: reporter,
      namespace: "primitive",
    });
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

test("#746: the Sprites reporters now match the four profiles that already collided", () => {
  // The consistency claim both issues rest on, asserted as one comparison rather than asserted of
  // Sprites alone: `grid` (Geometry), `set_tempo` (Sound), `dict` (Data), and `wait` (Interaction &
  // Events) were already rejected, and `who` was not. All five must now agree.
  for (const name of ["grid", "set_tempo", "dict", "wait", "who"]) {
    assert.ok(
      collidesAsPrimitive(name, ALL_PROFILES),
      `define ${name} must collide as a primitive under its active profile`,
    );
  }
});

// --- Non-regression: neither branch widened anything it should not have -------------------------

test("no branch leaked: an ordinary learner name is still free to declare under every profile", () => {
  // The false-positive guard. `primitiveCollision` grew two branches; neither may make an ordinary
  // name collide, and the recursion in particular must not fire for a non-alias.
  for (const name of ["square", "my_shape", "spiral", "greet"]) {
    assert.deepEqual(
      reservedWordFindings(`define ${name}\nend\n`, ALL_PROFILES),
      [],
      `${name} is an ordinary name and must stay free to declare`,
    );
  }
});

test("no branch leaked: the Heritage form heads still report `reserved`, not `primitive`", () => {
  // #742's scope item 3, verified rather than assumed: `make`/`to`/`output`/`op` are Core reserved
  // words (`spec/grammar.md`'s C19 list), so they were already caught — by the *reserved* branch,
  // which runs before the primitive one and is profile-independent. Nothing changed here, and the
  // ordering that keeps `reserved` winning is what this asserts.
  for (const head of OL.heritageFormHeadNames()) {
    for (const profiles of [ALL_PROFILES, CORE_ONLY]) {
      const findings = reservedWordFindings(`define ${head}\nend\n`, profiles);
      assert.equal(
        findings.length,
        1,
        `define ${head} should raise one finding`,
      );
      assert.deepEqual(findings[0].params, {
        name: head,
        namespace: "reserved",
      });
    }
  }
});

test("no branch leaked: a reserved word that is also a primitive still reports `reserved`", () => {
  // `thing` is both (the module doc comment's stated priority case). The primitive branch was
  // rewritten around it, so pin that reserved still wins.
  const findings = reservedWordFindings("define thing\nend\n", ALL_PROFILES);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].params, {
    name: "thing",
    namespace: "reserved",
  });
});

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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalOfHeritageAlias,
  check,
  heritageAliasNames,
  OL_CHECK_PROFILES,
  OL_KEYWORDS,
  OL_PROFILE_KEYWORDS,
  parse,
  profilePrimitiveNames,
  walk,
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

/**
 * The `[code, params]` identity of every diagnostic `check()` reports for `source` with every
 * profile active — the stage `execute()` must agree with. Every source these tests hand it parses
 * cleanly, so `check()` is always reached; a parse failure would surface as an empty result and a
 * mismatch against `executeIdentity`, rather than being papered over with a fallback branch that
 * no test ever executes.
 */
function checkIdentity(source) {
  const { ast } = parse(source, doc);
  return check(ast, { profiles: OL_CHECK_PROFILES }).diagnostics.map(
    (finding) => [finding.code, finding.params],
  );
}

/**
 * The **full** identity of a diagnostic — `code`, `params` AND `source_span`.
 *
 * `executeIdentity`/`checkIdentity` deliberately omit the span so their rows stay readable, but that
 * omission is itself a variable held constant: a mutant reporting the ENCLOSING declaration's span
 * at depth ≥ 2 (underlining `define b` instead of `forward`) passed every gate, because the only
 * span assertions in this suite were at depth 0. Comparing the whole shape closes that by
 * construction, and retroactively strengthens every sweep that uses it.
 */
function fullIdentity(diagnostics) {
  return diagnostics.map((finding) => [
    finding.code,
    finding.params,
    finding.source_span,
  ]);
}

/**
 * `fullIdentity` restricted to the two **declaration-slot** codes.
 *
 * A wrapper may legitimately introduce a finding of its own that has nothing to do with this rule:
 * a comprehension body must produce a value, so `map i in [ 1 ] [ define forward end ]` also raises
 * `ol-no-value` at check stage. Comparing raw diagnostic lists would then fail for a reason the
 * product is not about — and dropping the comprehension wrapper to avoid it would leave a
 * block-bearing slot uncovered, which is the defect this whole axis exists to prevent. Restricting
 * to the codes under test keeps every slot in the product; the "exactly one diagnostic from
 * `execute()`" assertion alongside is what stops a spurious extra finding hiding behind the filter.
 */
const DECLARATION_SLOT_CODES = new Set([
  "ol-reserved-word",
  "ol-duplicate-definition",
]);

function declarationSlotIdentity(diagnostics) {
  return fullIdentity(diagnostics).filter(([code]) =>
    DECLARATION_SLOT_CODES.has(code),
  );
}

/** `fullIdentity` of `execute()` and of `check()` for one source, for direct comparison. */
function bothStages(source) {
  const { ast } = parse(source, doc);
  const ran = execute(source, doc);
  return {
    fromExecute: declarationSlotIdentity(ran.diagnostics),
    fromCheck: declarationSlotIdentity(
      check(ast, { profiles: OL_CHECK_PROFILES }).diagnostics,
    ),
    executeDiagnosticCount: ran.diagnostics.length,
    events: ran.events.length,
  };
}

/**
 * The declaration `<keyword> <name> …` with an EMPTY body. Deliberately empty: a body is source
 * too, and a body that calls a primitive is re-read against the very declaration under test — with
 * `print 1` as the body, `define print` declares a zero-parameter `print` and the body's own
 * `print 1` then leaves `1` stranded as `ol-bad-token`, which has nothing to do with the
 * declaration slot. An empty body keeps each sweep row about the name alone.
 *
 * `keyword` selects the declaration spelling. `spec/grammar.md`'s declaration slots are `define`,
 * the Heritage `to`, `struct`, and the first operand of `alias` — and a sweep that only ever writes
 * `define` holds the SPELLING constant, which is the same blindness that let a mixed-case defect
 * through: the corpus cannot see a variable it never varies. `define` and `to` reach the same
 * `ProcedureDef` node, differing only in its `keyword` field, so a guard keyed on that field would
 * be invisible to a `define`-only sweep.
 */
function declareProcedure(name, keyword = "define") {
  return keyword === "struct"
    ? `struct ${name} [ x ]`
    : `${keyword} ${name}\nend`;
}

/**
 * The same declaration, wrapped in `depth` enclosing `define … end` procedures.
 *
 * `spec/grammar.md:93-94,147-148` makes a declaration an ordinary `statement` and a body a sequence
 * of statements, so declarations nest by construction — and `registerDeclarations` uses a
 * whole-program `walk`, which is depth-agnostic for free. **"For free" is exactly why it needs
 * pinning:** nothing about the guard mentions depth, so a change that started visiting only
 * `program.body` would look local and correct, and every declaration in this repository's fixtures
 * sat at column 1 until this slice. Measured: a mutant exempting non-top-level declarations passed
 * the entire Definition of Done while a nested `define forward` ran silently.
 *
 * **`depth` is a parameter, not a constant, and callers must use more than one value.** Fixing it at
 * 1 is the same defect one level in: a mutant exempting only depth ≥ 2 also passed every gate. The
 * variable has to be varied, not merely introduced.
 */
function nestInsideProcedure(
  declaration,
  depth = 1,
  prefix = "outer",
  keyword = "define",
) {
  let nested = declaration;
  for (let level = 0; level < depth; level += 1) {
    const indented = nested
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    nested = `${keyword} ${prefix}${level}\n${indented}\nend`;
  }
  return depth === 0 ? nested : `${nested}\n${prefix}${depth - 1}`;
}

/**
 * One declaration's full configuration as source: spelling, casing, enclosing construct and nesting
 * depth. `prefix` keeps the synthesised enclosing procedures distinct so two independently-nested
 * declarations can sit in one program without colliding with each other, and `enclosingKeyword`
 * varies the SPELLING of those synthesised wrappers — hard-coding `define` there would have held a
 * third copy of the spelling axis constant.
 *
 * **Every axis is drawn per declaration, never per program.** A diagnostic about two declarations
 * has *pair-relative* properties — are they in the same construct? at the same depth? — that are
 * invisible if the generator applies one wrapper to the pair. Measured: it did, and a mutant giving
 * handler bodies their own declaration scope let `define dup` + `every 1 [ define dup ]` silently
 * override across the boundary, passing all 3943 tests and 892 fixtures.
 */
function declarationSource({
  name,
  keyword,
  wrapper,
  depth,
  prefix,
  enclosingKeyword = "define",
}) {
  return nestInsideProcedure(
    BLOCK_SLOT_WRAPPERS[wrapper](declareProcedure(name, keyword), prefix),
    depth,
    prefix,
    enclosingKeyword,
  );
}

/**
 * Every **block-bearing slot** in the AST — `(node kind, field)` pairs whose value is a `Block`, and
 * therefore every position in the grammar where a declaration can sit.
 *
 * **Derived, not listed.** It is computed by parsing the whole conformance corpus plus
 * `spec/examples/` and `stdlib/` and collecting the slots that actually occur, exactly as
 * `everyBuiltInName` is derived from the parser's registries. A hand-written wrapper list is a
 * *sample*, and this file has already been burned twice by sampling: the `22` vs `32` residual came
 * from a hand-picked probe list, and a hand-written seven-entry wrapper map left `while`, `for`,
 * `forever`, comprehension bodies and — most tellingly — the **`else` branch of an `if`** un-drawn.
 * `If.thenBody` and `If.elseBody` are the same node *kind*, so the unit of this axis is the **slot**,
 * not the kind, and no amount of adding node kinds would have found it.
 *
 * Because the corpus is the stack-neutral artifact every implementation must satisfy, a construct
 * added to the grammar arrives here as soon as it has a fixture — and {@link BLOCK_SLOT_WRAPPERS}
 * then fails to cover it, which is the point.
 */
function everyBlockSlotInTheCorpus() {
  const slots = new Set();
  const roots = ["tests/conformance", "spec/examples", "stdlib"];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
      } else if (entry.endsWith(".logo")) {
        const { ast, diagnostics } = parse(readFileSync(full, "utf8"), full);
        if (diagnostics.length > 0) {
          continue;
        }
        walk(ast, (node) => {
          for (const [field, value] of Object.entries(node)) {
            for (const item of Array.isArray(value) ? value : [value]) {
              if (item && typeof item === "object" && item.kind === "Block") {
                slots.add(`${node.kind}.${field}`);
              }
            }
          }
        });
      }
    }
  };
  for (const root of roots) {
    if (existsSync(root)) {
      visit(root);
    }
  }
  return slots;
}

/**
 * One source wrapper per block-bearing slot, plus the extra `ProfileStatement` heads.
 *
 * The four Interaction & Events heads and the two Sprites heads all land in the SAME slot
 * (`ProfileStatement.body`), so covering the slot does not require all six — but they are kept
 * because they are the constructs an implementer is most likely to special-case ("handlers run
 * later" invites deferring their registration), and a mutant exempting exactly those bodies once
 * passed every gate. `Program.body` is the identity wrapper, so "unwrapped" is a value of the
 * variable rather than a special case.
 */
const BLOCK_SLOT_WRAPPERS = {
  "Program.body": (declaration) => declaration,
  "ProcedureDef.body": (declaration, unique = "") =>
    `define wrapper_procedure${unique}\n${declaration}\nend`,
  "Repeat.body": (declaration) => `repeat 1 [ ${declaration} ]`,
  "If.thenBody": (declaration) => `if true [ ${declaration} ]`,
  "If.elseBody": (declaration) =>
    `if false [ print 1 ] else [ ${declaration} ]`,
  "While.body": (declaration) => `while false [ ${declaration} ]`,
  "Forever.body": (declaration) => `forever [ ${declaration} ]`,
  "ForRange.body": (declaration) => `for i from 1 to 1 [ ${declaration} ]`,
  "ForIn.body": (declaration) => `for i in [ 1 ] [ ${declaration} ]`,
  "Comprehension.body": (declaration) =>
    `print map i in [ 1 ] [ ${declaration} ]`,
  "ProfileStatement.body": (declaration) => `when true [ ${declaration} ]`,
  "ProfileStatement.body/every": (declaration) => `every 1 [ ${declaration} ]`,
  "ProfileStatement.body/on_key": (declaration) =>
    `on_key "a" [ ${declaration} ]`,
  "ProfileStatement.body/on_click": (declaration) =>
    `on_click [ ${declaration} ]`,
  "ProfileStatement.body/ask": (declaration) => `ask 0 [ ${declaration} ]`,
  "ProfileStatement.body/each": (declaration) => `each [ ${declaration} ]`,
};

/** Every declaration spelling, every nesting depth, every enclosing construct, both casings. */
const DECLARATION_KEYWORDS = ["define", "to", "struct"];
const NESTING_DEPTHS = [0, 1, 2];
const WRAPPER_KINDS = Object.keys(BLOCK_SLOT_WRAPPERS);

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

test("the wrapper axis COVERS every block-bearing slot the grammar actually has", () => {
  // The completeness argument below rests on `(keyword, case, depth, wrapper)` characterising a
  // declaration. That is only true if `wrapper` ENUMERATES the positions a declaration can occupy
  // rather than sampling them. This is the assertion that makes it true, and it is derived from the
  // corpus rather than from a list kept here — so a construct added to the grammar fails this the
  // moment it has a fixture, instead of waiting for a reviewer to notice.
  const required = everyBlockSlotInTheCorpus();
  assert.ok(
    required.size >= 10,
    `expected the corpus to exhibit many block slots, got ${required.size}`,
  );
  const covered = new Set(WRAPPER_KINDS.map((kind) => kind.split("/")[0]));
  assert.deepEqual(
    [...required].filter((slot) => !covered.has(slot)).sort(),
    [],
    "every block-bearing slot needs a wrapper",
  );

  // And each wrapper really places the declaration in the slot it claims — a wrapper whose source
  // parsed into a different slot would silently double-cover one and leave another empty.
  for (const wrapper of WRAPPER_KINDS) {
    const claimed = wrapper.split("/")[0];
    if (claimed === "Program.body") {
      continue;
    }
    const source = BLOCK_SLOT_WRAPPERS[wrapper](
      "define probe_name\nend",
      "_probe",
    );
    const { ast, diagnostics } = parse(source, doc);
    assert.deepEqual(diagnostics, [], wrapper);
    let actual = "(none)";
    walk(ast, (node) => {
      for (const [field, value] of Object.entries(node)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          if (item && typeof item === "object" && item.kind === "Block") {
            let holds = false;
            walk(item, (inner) => {
              if (
                inner.kind === "ProcedureDef" &&
                inner.name.name === "probe_name"
              ) {
                holds = true;
              }
            });
            if (holds) {
              actual = `${node.kind}.${field}`;
            }
          }
        }
      }
    });
    assert.equal(actual, claimed, wrapper);
  }
});

test("EVERY built-in name is rejected at `define`, with `ol-reserved-word` and `params: { name }`", () => {
  // Written as one whole-list comparison rather than a filter that collects failures: a loop whose
  // recording branch never runs is a test whose body is partly dead, and this saga has shipped three
  // of those. Every line here executes on a green run, and a failure is a readable diff.
  assert.deepEqual(
    everyBuiltInName.map((name) => [
      name,
      executeIdentity(declareProcedure(name)),
    ]),
    everyBuiltInName.map((name) => [name, [["ol-reserved-word", { name }]]]),
  );
});

test("EVERY built-in name is rejected at the Heritage `to` as well — the spelling is not the variable", () => {
  // `spec/grammar.md` makes `to` a declaration slot in its own right. `define` and `to` lower to the
  // same `ProcedureDef` node, differing only in its `keyword` field, so a `define`-only sweep cannot
  // see a guard keyed on that field — and until this row existed, exempting `to` from the built-in
  // check was killed by exactly one incidental assertion elsewhere in the suite.
  assert.deepEqual(
    everyBuiltInName.map((name) => [
      name,
      executeIdentity(declareProcedure(name, "to")),
    ]),
    everyBuiltInName.map((name) => [name, [["ol-reserved-word", { name }]]]),
  );
});

test("EVERY built-in name is rejected at `struct` too — both registration forms, not just one", () => {
  // Ruling #833's amendment measured that the names free at `define` were free at `struct` as well,
  // so a fix covering only one form would leave the other open.
  assert.deepEqual(
    everyBuiltInName.map((name) => [
      name,
      executeIdentity(`struct ${name} [ x y ]`).map(([code]) => code),
    ]),
    everyBuiltInName.map((name) => [name, ["ol-reserved-word"]]),
  );
});

test("`execute()` and `check()` report the SAME identity for every built-in name at `define`", () => {
  // The cross-stage agreement, name by name. Only `stage` may differ (`"runtime"` vs `"semantic"`),
  // because `execute()` runs `parse()` and never `check()`.
  assert.deepEqual(
    everyBuiltInName.map((name) => [
      name,
      executeIdentity(declareProcedure(name)),
    ]),
    everyBuiltInName.map((name) => [
      name,
      checkIdentity(declareProcedure(name)),
    ]),
  );
});

test("`execute()` and `check()` agree on the SPAN, not merely the code and params", () => {
  // Swept across all three declaration spellings, not just `define`: `to` is three characters where
  // the others are six, so the reported column differs, and a `define`-only span sweep would be
  // pinned to the widths that happen to coincide.
  for (const source of [
    "define forward\nend",
    "define fd\nend",
    "define if\nend",
    "to forward\nend",
    "to fd\nend",
    "struct forward [ x ]",
    "struct dict [ x ]",
  ]) {
    const { ast } = parse(source, doc);
    const [fromCheck] = check(ast, { profiles: OL_CHECK_PROFILES }).diagnostics;
    const [fromExecute] = execute(source, doc).diagnostics;
    assert.deepEqual(fromExecute.source_span, fromCheck.source_span, source);
  }
});

test("`params.name` is the DECLARED surface spelling for a built-in too, never the canonical", () => {
  // The registry-derived sweeps above cannot see this. Every name they iterate is the canonical
  // lowercase spelling, so the declared spelling, the canonical, and any case-folded form all
  // COINCIDE — an implementation that reported the folded name would pass all 148 rows and still
  // break AC2, which is the same structural blindness ruling #833's amendment found in the 57
  // fixtures pinning `params.callable`. Mixed case is applied to the duplicate half by
  // `define-twice-differing-case` and the `"define twice, differing case"` row below; this is the
  // reserved-word half. Both declaration forms, and a keyword as well as primitives and an alias,
  // because each reaches `ol-reserved-word` through a different branch of `isBuiltInName`.
  for (const source of [
    "define FORWARD\nend",
    "define FiRsT\nend",
    "define FD\nend",
    "define IF\nend",
    "to FORWARD\nend",
    "struct FORWARD [ x ]",
    "struct FD [ x ]",
  ]) {
    const identity = executeIdentity(source);
    assert.deepEqual(identity, checkIdentity(source), source);
    assert.equal(
      identity[0][1].name,
      source.split(/\s+/)[1],
      `${source} must report the spelling the learner wrote`,
    );
  }
});

test("the learner-facing MESSAGE quotes the declared spelling too, and matches the checker's", () => {
  // `params` is diagnostic identity, but the message is what the learner reads — and the
  // conformance harness deliberately EXCLUDES `message` from comparison, so a unit test is the only
  // place wording can be pinned at all. A mutant lowercasing only the message would survive every
  // fixture and every params assertion above. `spec/error-model.md` fixes both the sentence and its
  // warm lowercase voice, so the two stages must produce it identically.
  for (const source of ["define FORWARD\nend", "struct FD [ x ]"]) {
    const declared = source.split(/\s+/)[1];
    const { ast } = parse(source, doc);
    const [fromCheck] = check(ast, { profiles: OL_CHECK_PROFILES }).diagnostics;
    const [fromExecute] = execute(source, doc).diagnostics;
    assert.equal(
      fromExecute.message,
      `${declared} is already part of OpenLogo. choose another name.`,
      source,
    );
    assert.equal(fromExecute.message, fromCheck.message, source);
  }
});

test("the duplicate MESSAGE names the earlier declaration's line, and matches the checker's", () => {
  const source = duplicateForms["define twice, differing case"];
  const { ast } = parse(source, doc);
  const [fromCheck] = check(ast, { profiles: OL_CHECK_PROFILES }).diagnostics;
  const [fromExecute] = execute(source, doc).diagnostics;
  assert.equal(fromExecute.message, "you already defined FOO on line 1.");
  assert.equal(fromExecute.message, fromCheck.message);
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

/**
 * The duplicate-registration forms of issue #839's AC2 table, with DIFFERING declarations.
 *
 * Three variables are varied deliberately, because the corpus is blind to any one it holds
 * constant: the declaration **kind** (`define`/`to`/`struct`, in both orders), the declaration
 * **spelling** (`define` vs the Heritage `to` — both lower to one `ProcedureDef` differing only in
 * its `keyword` field), and the **casing** of the later declaration, at more than one kind.
 */
const duplicateForms = {
  "define twice":
    "define foo\n  print 111\nend\ndefine foo\n  print 222\nend\nfoo",
  "struct twice": "struct point [ x y ]\nstruct point [ a b ]",
  "define then struct": "define pair\n  return 1\nend\nstruct pair [ x ]",
  "struct then define": "struct pair [ x ]\ndefine pair\n  return 1\nend",
  // The Heritage `to` spelling of the same slot. Until these rows existed, exempting `to` from the
  // duplicate guard reproduced issue #839's ORIGINAL defect verbatim — `to foo` twice ran the
  // second body and printed `222` — while all 3912 tests and 886 fixtures stayed green.
  "to twice": "to foo\n  print 111\nend\nto foo\n  print 222\nend\nfoo",
  "define then to":
    "define foo\n  print 111\nend\nto foo\n  print 222\nend\nfoo",
  "to then define":
    "to foo\n  print 111\nend\ndefine foo\n  print 222\nend\nfoo",
  "to then struct": "to pair\n  print 1\nend\nstruct pair [ x ]",
  "struct then to": "struct pair [ x ]\nto pair\n  print 1\nend",
  // Mixed case on purpose. An all-lowercase corpus is exactly how issue #874's `params.callable`
  // question stayed unadjudicated for 57 fixtures: the rule under test never varied. Applied at
  // more than one declaration kind, because holding the KIND constant at the mixed-case site hides
  // a fold applied only to `struct` — measured: that mutant survived every gate.
  "define twice, differing case":
    "define foo\n  print 111\nend\ndefine FOO\n  print 222\nend\nfoo",
  "define then struct, differing case":
    "define foo\n  return 1\nend\nstruct FOO [ x ]",
  "struct then define, differing case":
    "struct foo [ x ]\ndefine FOO\n  return 1\nend",
  "to twice, differing case":
    "to foo\n  print 111\nend\nto FOO\n  print 222\nend\nfoo",
};

test("every duplicate-registration form raises ol-duplicate-definition at runtime", () => {
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

test("`params.name` is the LATER declaration's surface spelling, exactly as written", () => {
  // Matching is case-insensitive, but the name a diagnostic reports is the one the learner typed at
  // that span — the same rule the checker follows. A folded `foo` here would misquote the source.
  // Asserted at every mixed-case row rather than one, because the later declaration's KIND and
  // SPELLING are themselves variables: a fold applied only to `struct`, or only to `to`, survives a
  // single `define`/`define` row.
  for (const label of [
    "define twice, differing case",
    "define then struct, differing case",
    "struct then define, differing case",
    "to twice, differing case",
  ]) {
    const source = duplicateForms[label];
    const [[, params]] = executeIdentity(source);
    assert.equal(params.name, "FOO", label);
    // The earlier declaration's span is derived from its own keyword rather than hard-coded: `to`
    // is three characters where `define` and `struct` are six, so a fixed column would have quietly
    // restricted this assertion to the spellings that happen to share a width.
    const [keyword] = source.split(/\s+/);
    assert.deepEqual(
      params.original_span.start,
      [1, keyword.length + 2],
      label,
    );
  }
});

test("every duplicate form reports the SAME code, params and span from check() and execute()", () => {
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
  assert.deepEqual(
    executeIdentity(source).map(([code]) => code),
    ["ol-duplicate-definition"],
  );
});

// ---------------------------------------------------------------------------
// Nesting depth — the guard is depth-agnostic, and that must be asserted
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The declaration-slot rule is INVARIANT under spelling, case, depth and
// enclosing construct — asserted as a generated cross-product, not a table
// ---------------------------------------------------------------------------
//
// Five review rounds each found the same defect one cell further in: the suite named a variable and
// then held it at a single value. Rows were added; the next cell was empty again. What follows
// states the rule once, as what it actually is — an invariance — and generates the product, so a
// cell neither author nor reviewer thought of is covered without anyone enumerating it.
//
// The axes, and the mutant that proved each one was load-bearing:
//
// | axis                  | values                                          | mutant it kills |
// |---|---|---|
// | declaration spelling  | `define`, `to`, `struct`                        | exempt `to` (round 3) |
// | name casing           | `forward`, `FORWARD`                            | fold `params.name` (rounds 1, 5) |
// | nesting depth         | 0, 1, 2                                         | top-level-only; depth >= 2 (rounds 4, 5) |
// | enclosing construct   | none, `repeat`, `if`, `when`, `every`, `on_key`, `on_click` | exempt handler bodies (round 5) |
// | assertion facet       | `code`, `params`, `source_span`                 | wrong span at depth >= 2 (round 5) |
//
// 3 x 2 x 3 x 7 = 126 programs, each asserted to produce ONE `ol-reserved-word` naming the declared
// spelling at the declared span, identically from `check()` and `execute()`, with nothing executed.

test("the built-in-name rule is invariant across spelling x case x depth x enclosing construct", () => {
  const rows = [];
  for (const keyword of DECLARATION_KEYWORDS) {
    for (const name of ["forward", "FORWARD"]) {
      for (const depth of NESTING_DEPTHS) {
        for (const wrapper of WRAPPER_KINDS) {
          const source = declarationSource({
            name,
            keyword,
            wrapper,
            depth,
            prefix: "outer",
          });
          const label = `${keyword} ${name} @depth ${depth} in ${wrapper}`;
          const { fromExecute, fromCheck } = bothStages(source);
          rows.push([
            label,
            fromExecute,
            fromCheck,
            execute(source, doc).events.length,
          ]);
        }
      }
    }
  }

  // The product is real, and every row ran. Derived from the axis lengths, never hand-computed —
  // a literal cell count is a second source of truth that can disagree with the loops.
  assert.equal(
    rows.length,
    DECLARATION_KEYWORDS.length *
      2 *
      NESTING_DEPTHS.length *
      WRAPPER_KINDS.length,
  );

  // `execute()` and `check()` agree on code, params AND span, for every cell.
  assert.deepEqual(
    rows.map(([label, fromExecute]) => [label, fromExecute]),
    rows.map(([label, , fromCheck]) => [label, fromCheck]),
  );

  // Each cell reports exactly one `ol-reserved-word` naming the spelling as written, and runs nothing.
  assert.deepEqual(
    rows.map(([label, fromExecute, , events]) => [
      label,
      fromExecute.map(([code, params]) => [code, params.name]),
      events,
    ]),
    rows.map(([label]) => [
      label,
      [["ol-reserved-word", label.split(" ")[1]]],
      0,
    ]),
  );
});

// Every configuration of ONE declaration, as `{ keyword, case, depth, wrapper }`. This is the tuple
// the completeness argument says fully characterises a declaration.
const EVERY_DECLARATION_CONFIGURATION = DECLARATION_KEYWORDS.flatMap(
  (keyword) =>
    NESTING_DEPTHS.flatMap((depth) =>
      WRAPPER_KINDS.map((wrapper) => ({ keyword, depth, wrapper })),
    ),
);

test("the duplicate rule is invariant across the per-declaration product — every axis drawn in BOTH roles", () => {
  // Two declarations, each independently configured. The completeness argument: both diagnostics
  // concern **at most two declarations**, each declaration is fully characterised by
  // `(keyword, case, depth, wrapper)`, and there is no third level because there is no third
  // declaration. What follows draws all four axes independently for each of the two.
  //
  // **The bound, stated plainly rather than hidden.** The unrestricted product is
  // |config|^2 x |case| = 144^2 x 2 = 41,472 cells and takes four minutes — too slow to be run, and
  // a test nobody runs asserts nothing. It is reduced on a stated principle, not by sampling:
  //
  //  1. **Every configuration appears in BOTH roles.** Each of the 144 configurations is used as the
  //     EARLIER declaration against a fixed later one, and as the LATER declaration against a fixed
  //     earlier one. So no configuration is unexercised in either position — which is what the
  //     per-declaration half of the completeness argument actually requires.
  //  2. **The one axis with a MEASURED relational defect is enumerated relationally in full.**
  //     `wrapper x wrapper` (16 x 16) is swept completely, because that is the pair-relative axis a
  //     mutant has actually exploited: giving handler bodies their own declaration scope let
  //     `define dup` + `every 1 [ define dup ]` silently override across the boundary while passing
  //     every gate. Depth is likewise swept relationally in full (3 x 3).
  //  3. **Casing is drawn on the later declaration throughout**, since `params.name` reports the
  //     later spelling and a fold applied only when nested survived a lowercase-only product.
  //
  // What that deliberately does NOT cover is a defect requiring a specific *combination* of two
  // configurations differing in three or more axes at once. If such a mutant is ever found, this
  // bound is where it got in, and the honest fix is to widen the sweep rather than to add its cell.
  const fixedEarlier = { keyword: "define", depth: 0, wrapper: "Program.body" };
  const fixedLater = { keyword: "define", depth: 0, wrapper: "Program.body" };

  const pairs = [];
  for (const configuration of EVERY_DECLARATION_CONFIGURATION) {
    for (const laterName of ["dup", "DUP"]) {
      pairs.push([configuration, fixedLater, laterName, "earlier role"]);
      pairs.push([fixedEarlier, configuration, laterName, "later role"]);
    }
  }
  for (const firstWrapper of WRAPPER_KINDS) {
    for (const secondWrapper of WRAPPER_KINDS) {
      pairs.push([
        { keyword: "define", depth: 0, wrapper: firstWrapper },
        { keyword: "to", depth: 0, wrapper: secondWrapper },
        "DUP",
        "wrapper x wrapper",
      ]);
    }
  }
  for (const firstDepth of NESTING_DEPTHS) {
    for (const secondDepth of NESTING_DEPTHS) {
      for (const firstKeyword of DECLARATION_KEYWORDS) {
        for (const secondKeyword of DECLARATION_KEYWORDS) {
          pairs.push([
            {
              keyword: firstKeyword,
              depth: firstDepth,
              wrapper: "Program.body",
            },
            {
              keyword: secondKeyword,
              depth: secondDepth,
              wrapper: "Program.body",
            },
            "DUP",
            "depth x depth x keyword x keyword",
          ]);
        }
      }
    }
  }

  assert.equal(
    pairs.length,
    EVERY_DECLARATION_CONFIGURATION.length * 2 * 2 +
      WRAPPER_KINDS.length * WRAPPER_KINDS.length +
      NESTING_DEPTHS.length *
        NESTING_DEPTHS.length *
        DECLARATION_KEYWORDS.length *
        DECLARATION_KEYWORDS.length,
  );

  const rows = pairs.map(([earlier, later, laterName, group]) => {
    const source = `${declarationSource({
      ...earlier,
      name: "dup",
      prefix: "outerA",
      enclosingKeyword: "define",
    })}\n${declarationSource({
      ...later,
      name: laterName,
      prefix: "outerB",
      enclosingKeyword: "to",
    })}`;
    const label = `[${group}] ${earlier.keyword}@${earlier.depth}/${earlier.wrapper} + ${later.keyword} ${laterName}@${later.depth}/${later.wrapper}`;
    return [label, bothStages(source), laterName];
  });

  // Compared as compact per-row strings rather than nested objects: a 913-row `deepEqual` over
  // object graphs produces a diff no one can read, which makes a real failure as good as invisible.
  // Every row is still built and compared, so no line here goes unexecuted.
  const describe = ([label, stages, laterName]) =>
    [
      label,
      stages.fromExecute
        .map(
          ([code, params]) =>
            `${code}:${params.name}:${params.original_span !== undefined}`,
        )
        .join(","),
      stages.fromCheck
        .map(
          ([code, params]) =>
            `${code}:${params.name}:${params.original_span !== undefined}`,
        )
        .join(","),
      `diagnostics=${stages.executeDiagnosticCount}`,
      `events=${stages.events}`,
      laterName,
    ].join(" | ");

  assert.deepEqual(
    rows.map(describe),
    rows.map(([label, , laterName]) =>
      [
        label,
        `ol-duplicate-definition:${laterName}:true`,
        `ol-duplicate-definition:${laterName}:true`,
        "diagnostics=1",
        "events=0",
        laterName,
      ].join(" | "),
    ),
  );
});

test("a cross-depth duplicate is reported in BOTH orientations, always naming the earlier one", () => {
  // The declaration ORDER across depths is its own variable. A two-pass registration — top-level
  // first, then descend, a plausible "so forward references resolve" refactor — preserves the
  // top-level-first orientation and INVERTS the other: it flags the earlier declaration as the
  // duplicate and names the later one as the original, so the learner stands on line 2 and is told
  // "you already defined foo on line 5". `spec/execution-model.md:86-87` requires the opposite:
  // it is "a name an EARLIER declaration in the program already registered" that raises. Measured:
  // that mutant passed every gate while only the top-level-first orientation was pinned.
  const orientations = {
    "top-level first, nested second": [
      "define foo\nend\ndefine outer\n  define foo\n  end\nend",
      [4, 10],
      [1, 8],
    ],
    "nested first, top-level second": [
      "define outer\n  define foo\n  end\nend\ndefine foo\nend",
      [5, 8],
      [2, 10],
    ],
  };
  for (const [label, [source, later, earlier]] of Object.entries(
    orientations,
  )) {
    const [diagnostic] = execute(source, doc).diagnostics;
    assert.equal(diagnostic.code, "ol-duplicate-definition", label);
    assert.deepEqual(diagnostic.source_span.start, later, label);
    assert.deepEqual(diagnostic.params.original_span.start, earlier, label);
    assert.deepEqual(executeIdentity(source), checkIdentity(source), label);
  }
});

test("a legal NESTED declaration still registers and is callable — the guard rejects, it does not disable", () => {
  // The other half, and what makes every mutant above non-trivial: nested declarations are genuinely
  // registered by the same walk, so the guard riding on it is load-bearing rather than decorative.
  const result = execute(
    "define outer\n  define helper\n    print 42\n  end\nend\nhelper",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]),
    [42],
  );
});

test("EVERY built-in name — all 148, not just the two the cross-product samples — is rejected when NESTED", () => {
  // The invariance product varies every axis but samples only `forward`/`FORWARD` for the name, so
  // it proves the RULE is depth-invariant without proving the NAME SET is. This sweep is the other
  // projection: the whole registry, at depth 1 and depth 2. Keeping both is deliberate — each is
  // blind to what the other varies, which is the entire lesson of this slice.
  for (const depth of [1, 2]) {
    const rows = everyBuiltInName.map((name) => {
      const source = nestInsideProcedure(declareProcedure(name), depth);
      const { fromExecute, fromCheck } = bothStages(source);
      return [name, fromExecute, fromCheck];
    });
    // Compared on the FULL identity, span included — `executeIdentity` omits the span, and an
    // omitted facet is a variable held constant across every table that uses the helper.
    assert.deepEqual(
      rows.map(([name, fromExecute]) => [name, fromExecute]),
      rows.map(([name, , fromCheck]) => [name, fromCheck]),
      `depth ${depth}`,
    );
    assert.deepEqual(
      rows.map(([name, fromExecute]) => [
        name,
        fromExecute.map(([code, params]) => [code, params.name]),
      ]),
      everyBuiltInName.map((name) => [name, [["ol-reserved-word", name]]]),
      `depth ${depth}`,
    );
  }
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
  assert.equal(
    executeIdentity(duplicateFirst)[0][0],
    "ol-duplicate-definition",
  );
  assert.equal(executeIdentity(builtInFirst)[0][0], "ol-reserved-word");

  // Depth-mixed, because both rows above are entirely at depth 0 and a two-pass registration that
  // visited every top-level declaration before descending would reorder exactly this: the NESTED
  // built-in on line 2 comes first in source order, so it is what halts the run — a top-level-first
  // pass would instead reach the depth-0 duplicate on line 7 and report the wrong code entirely.
  const nestedBuiltInBeforeTopLevelDuplicate =
    "define outer\n  define forward\n  end\nend\ndefine dup\nend\ndefine dup\nend";
  assert.deepEqual(executeIdentity(nestedBuiltInBeforeTopLevelDuplicate), [
    ["ol-reserved-word", { name: "forward" }],
  ]);
});

// ---------------------------------------------------------------------------
// Non-regression: what stays legal
// ---------------------------------------------------------------------------

test("binding a built-in name is still legal at run time — only DECLARING one is not", () => {
  // `spec/grammar.md` makes accepting these a MUST: a program may bind a value to any name. This is
  // the boundary the declaration-slot guard must not cross, and the one issue #739 got wrong.
  const result = execute(
    ":end = 7\nprint :end\nlocal count\nfor forward from 1 to 2 [ print :forward ]",
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

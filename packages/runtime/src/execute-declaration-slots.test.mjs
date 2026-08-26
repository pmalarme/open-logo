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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
 * The **full** identity of a diagnostic — `code`, `params`, `source_span` AND `severity`.
 *
 * `severity` is in the row because `spec/error-model.md:125` makes `ol-reserved-word` normatively an
 * error, and measured: downgrading it to `"warning"` **only inside loop and comprehension bodies**
 * passed the entire Definition of Done. It is safe to compare across stages because both produce
 * `"error"`. **`stage` is deliberately NOT here** — `execute()` reports `"runtime"` and `check()`
 * reports `"semantic"` by design, so including it would make every cross-stage cell diff.
 *
 * `executeIdentity`/`checkIdentity` deliberately omit the span so their rows stay readable, but that
 * omission is itself a variable held constant: a mutant reporting the ENCLOSING declaration's span
 * at depth ≥ 2 (underlining `define b` instead of `forward`) passed every gate, because the only
 * span assertions in this suite were at depth 0.
 */
function fullIdentity(diagnostics) {
  return diagnostics.map((finding) => [
    finding.code,
    finding.params,
    finding.source_span,
    finding.severity,
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

/**
 * A value rendered with object keys in sorted order, so two structurally equal diagnostics can never
 * differ merely by key insertion order.
 */
function stableText(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableText).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${key}:${stableText(value[key])}`)
      .join(",")}}`;
  }
  return String(value);
}

/**
 * The **comparable row** for one stage: every declaration-slot diagnostic rendered as one compact
 * string carrying `code`, the WHOLE of `params`, and `source_span`.
 *
 * **This is the single place that decides which facets are compared, and it exists because two
 * readability refactors quietly narrowed the comparison twice.** Both cross-products used to project
 * the identity down to `code:params.name` in their own formatters — computing `source_span` and
 * throwing it away, and rendering `original_span` as a mere boolean. Measured: a mutant widening the
 * reported span **inside loop and comprehension bodies only**, and one pointing `original_span` at
 * the later declaration when the earlier sat in a loop body, both passed the entire Definition of
 * Done. They are round 5's and round 4's defects re-emerging in the slots round 8's derivation
 * added, which arrived covered for code and name and blind for spans.
 *
 * Per-caller formatting is what re-opened this three times (NB14, NB17, and again here), so the
 * formatting lives at the helper. A caller can choose what to *assert*; it cannot choose what a row
 * *contains*.
 */
function comparableRow(diagnostics) {
  return declarationSlotIdentity(diagnostics)
    .map(
      ([code, params, span, severity]) =>
        `${code} severity=${severity} params=${stableText(params)} span=${stableText(span)}`,
    )
    .join(" ;; ");
}

/**
 * Both stages' comparable rows for one source, plus the two count facets. Every consumer compares
 * `fromExecuteRow` against `fromCheckRow`; nothing downstream re-projects the identity.
 */
function bothStages(source) {
  const { ast } = parse(source, doc);
  const ran = execute(source, doc);
  const checked = check(ast, { profiles: OL_CHECK_PROFILES }).diagnostics;
  return {
    fromExecute: declarationSlotIdentity(ran.diagnostics),
    fromCheck: declarationSlotIdentity(checked),
    fromExecuteRow: comparableRow(ran.diagnostics),
    fromCheckRow: comparableRow(checked),
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
 * Every **block-bearing field** in the AST — `(node kind, field)` pairs whose value is a `Block`.
 *
 * **What this is and is not.** It enumerates the AST *fields* that hold a block, which is the unit
 * the declaration-slot guard actually turns on — `If.thenBody` and `If.elseBody` are the same node
 * *kind*, and a mutant exempting only the else branch passed every gate, so keying on kinds would
 * have missed it. It is **not** an enumeration of every grammar position: `(kind, field)` collapses
 * discriminants the field does not carry, so `define` and `to` share `ProcedureDef.body`, and
 * `map`/`filter`/`reduce` share `Comprehension.body`. Those discriminants are varied on the
 * *declaration* axes instead (`DECLARATION_KEYWORDS`); the comprehension kind is not varied, which
 * is a stated gap rather than a covered one.
 *
 * **Derived, not listed.** It is computed by parsing the whole conformance corpus plus
 * `spec/examples/` and `stdlib/` and collecting the fields that actually occur, exactly as
 * `everyBuiltInName` is derived from the parser's registries. A hand-written wrapper list is a
 * *sample*, and this file has already been burned twice by sampling: the `22` vs `32` residual came
 * from a hand-picked probe list, and a hand-written seven-entry wrapper map left `while`, `for`,
 * `forever`, comprehension bodies and the **`else` branch of an `if`** un-drawn.
 *
 * Files that fail to parse are skipped — a few dozen of those discovered, the corpus's deliberate
 * parse-error fixtures. (Deliberately not a count: nothing gates the number, so a literal one is an
 * unenforced assertion that drifts with the next fixture, as this line's did.) They cannot
 * contribute a field, so skipping them is correct, but it does mean this set is derived from the
 * *parseable* corpus rather than from all of it.
 *
 * Because the corpus is the stack-neutral artifact every implementation must satisfy, a construct
 * added to the grammar arrives here as soon as it has a fixture — and {@link BLOCK_SLOT_WRAPPERS}
 * then fails to cover it, which is the point. `@testing` independently derived the same ten fields
 * from `packages/parser/src/ast.ts`'s `BlockNode`-typed declarations; the sets coincide.
 *
 * **One blind spot this derivation cannot see, stated because "derived, not listed" is the claim it
 * rests on:** it walks with `walk`, whose child list is a hand-written per-kind switch
 * (`packages/parser/src/ast.ts`'s `childrenOf`) — and so does `registerDeclarations`. Since #925
 * that switch handles every node *kind* or fails to compile, and since #960 the field half is closed
 * for every field the corpus populates: `packages/parser/src/child-edges.test.mjs` audits
 * `childrenOf` by reflection, from a source that does not use it, and fails naming the dotted path
 * of any node-valued field `walk` does not descend
 * ([ADR-0025](../../../docs/adr/0025-child-edge-gate-audits-childrenof-independently.md)). All ten
 * slots below are `BlockNode`-typed fields the corpus populates, so all ten are covered by it. What
 * survives is narrower: a slot on a node-valued field that **no** fixture populates, which is
 * invisible to reflection too. The instrument and the subject still share a traversal — that is why
 * the surviving case is stated rather than assumed away.
 *
 * Paths resolve from this file, not from `process.cwd()`: a package-scoped run
 * (`cd packages/runtime && node --test src/…`) would otherwise find no corpus at all.
 */
function everyBlockSlotInTheCorpus() {
  const slots = new Set();
  const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  const roots = ["tests/conformance", "spec/examples", "stdlib"].map((root) =>
    join(repositoryRoot, root),
  );
  // Seeded with every root, so the lookups below need no `?? 0` fallback — a fallback arm taken only
  // when a root is missing is dead on a green tree.
  const filesPerRoot = new Map(roots.map((root) => [root, 0]));
  const visit = (directory, root) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        visit(full, root);
      } else if (entry.endsWith(".logo")) {
        const { ast, diagnostics } = parse(readFileSync(full, "utf8"), full);
        if (diagnostics.length > 0) {
          continue;
        }
        filesPerRoot.set(root, filesPerRoot.get(root) + 1);
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
  // Roots are visited unconditionally. An `existsSync` guard here used to skip a root that had been
  // renamed or moved, and a skip is invisible in the direction that matters: `required` is *derived*
  // from the corpus precisely so a construct fails the moment it has a fixture, and the assertion
  // below is `required \ covered === []`, so a *smaller* `required` passes more easily. A construct
  // whose only fixtures lived in the vanished root would silently stop being derived and this test
  // would go green while proving strictly less. The `required.size >= coveredBlockSlots.size` floor
  // is not protection: `tests/conformance` alone exhibits all ten covered slots (the other two roots
  // exhibit 7 and 3, measured on #960), so dropping either of the smaller roots leaves the union
  // unchanged and the floor satisfied. Without the guard a
  // missing root throws `ENOENT` and names itself; `thinRoots` catches a root that still exists but
  // has collapsed. It does not catch a root that has merely shrunk — measured on #960, this root set
  // can lose 68% of its non-conformance files with this gate green — because the alternative is a
  // census, which asserts a count nothing re-derives and fails on ordinary growth.
  for (const root of roots) {
    visit(root, root);
  }
  return {
    slots,
    thinRoots: roots.filter((root) => filesPerRoot.get(root) < 3),
  };
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

test("the COMPARATOR distinguishes diagnostics that differ only in a span or a param", () => {
  // Every other guard in this file protects the ENUMERATION — that the axes are complete and the
  // cells all run. Nothing protected the COMPARISON, and twice a readability refactor narrowed it
  // without any test noticing: `source_span` was computed and dropped, and `original_span` was
  // rendered as a boolean. A narrowed comparator is the exact dual of a held-constant variable —
  // the cells vary, and the assertion cannot see it — so it needs a guard of its own.
  const span = (startLine) => ({
    document: doc,
    start: [startLine, 8],
    end: [startLine, 11],
  });
  const base = [
    {
      code: "ol-duplicate-definition",
      params: { name: "dup", original_span: span(1) },
      source_span: span(4),
      severity: "error",
    },
  ];
  const differentSourceSpan = [{ ...base[0], source_span: span(5) }];
  const differentOriginalSpan = [
    { ...base[0], params: { name: "dup", original_span: span(2) } },
  ];
  const differentName = [
    { ...base[0], params: { name: "DUP", original_span: span(1) } },
  ];
  const differentCode = [{ ...base[0], code: "ol-reserved-word" }];
  const differentSeverity = [{ ...base[0], severity: "warning" }];

  assert.notEqual(
    comparableRow(base),
    comparableRow(differentSourceSpan),
    "a differing source_span must change the row",
  );
  assert.notEqual(
    comparableRow(base),
    comparableRow(differentOriginalSpan),
    "a differing original_span must change the row — not merely its presence",
  );
  assert.notEqual(
    comparableRow(base),
    comparableRow(differentName),
    "a differing params.name must change the row",
  );
  assert.notEqual(
    comparableRow(base),
    comparableRow(differentCode),
    "a differing code must change the row — the one facet this guard used to hold constant",
  );
  assert.notEqual(
    comparableRow(base),
    comparableRow(differentSeverity),
    "a differing severity must change the row: `spec/error-model.md:125` makes it an error",
  );
  // Key order must NOT change it, or every product would diff on incidental ordering.
  assert.equal(
    comparableRow(base),
    comparableRow([
      {
        severity: "error",
        source_span: span(4),
        params: { original_span: span(1), name: "dup" },
        code: "ol-duplicate-definition",
      },
    ]),
  );
  // And a diagnostic outside the two declaration-slot codes stays filtered out.
  assert.equal(
    comparableRow([
      ...base,
      {
        code: "ol-no-value",
        params: {},
        source_span: span(9),
        severity: "error",
      },
    ]),
    comparableRow(base),
  );
});

test("the wrapper axis COVERS every block-bearing slot the grammar actually has", () => {
  // The completeness argument below rests on `(keyword, case, depth, wrapper)` characterising a
  // declaration. That is only true if `wrapper` ENUMERATES the positions a declaration can occupy
  // rather than sampling them. This is the assertion that makes it true, and it is derived from the
  // corpus rather than from a list kept here — so a construct added to the grammar fails this the
  // moment it has a fixture, instead of waiting for a reviewer to notice.
  const { slots: required, thinRoots } = everyBlockSlotInTheCorpus();
  // A root that still exists but has been emptied shrinks `required` exactly as a missing one
  // would, and the floor below cannot see it: `tests/conformance` saturates every slot on its own,
  // so the other roots keep it satisfied. `thinRoots` catches a root that has *collapsed*; it does
  // not catch one that has merely shrunk, and saying otherwise overstates it — measured on #960,
  // this root set can lose 68% of its non-conformance files with this gate green. A floor rather
  // than a census, because a census asserts a count nothing re-derives.
  assert.deepEqual(thinRoots, [], "every corpus root must contribute files");
  // The floor is derived from the wrapper map's own distinct slots, not a literal — a hand-written
  // `>= 10` is the last remaining second source of truth in a file that spent a round removing them,
  // and it would go stale the day a slot is added.
  const covered = new Set(WRAPPER_KINDS.map((kind) => kind.split("/")[0]));
  const coveredBlockSlots = new Set(
    [...covered].filter((slot) => slot !== "Program.body"),
  );
  assert.ok(
    required.size >= coveredBlockSlots.size,
    `expected the corpus to exhibit at least the ${coveredBlockSlots.size} slots the wrappers cover, got ${required.size}`,
  );
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
          const stages = bothStages(source);
          rows.push([label, stages, name]);
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

  // Compared as compact per-row strings: a diff over nested object graphs at this size is
  // unreadable, and an assertion that fires while explaining nothing gets worked around rather than
  // understood. The row comes from `bothStages`, which decides the facets — code, the WHOLE of
  // params, and source_span — so a formatter here cannot narrow the comparison, which is what
  // happened twice before. The expected name comes from the row's own `name`, not from re-parsing
  // the label: a label is for humans, and deriving an expectation from it makes the two drift.
  assert.deepEqual(
    rows.map(([label, stages]) => [label, stages.fromExecuteRow]),
    rows.map(([label, stages]) => [label, stages.fromCheckRow]),
  );

  const describe = ([label, stages, name]) =>
    [
      label,
      stages.fromExecute
        .map(([code, params]) => `${code}:${params.name}`)
        .join(","),
      `diagnostics=${stages.executeDiagnosticCount}`,
      `events=${stages.events}`,
      name,
    ].join(" | ");

  assert.deepEqual(
    rows.map(describe),
    rows.map(([label, , name]) =>
      [
        label,
        `ol-reserved-word:${name}`,
        "diagnostics=1",
        "events=0",
        name,
      ].join(" | "),
    ),
  );
});

/**
 * The axes of ONE declaration, and the value each takes when it is not the axis under test.
 *
 * **All five are per-declaration**, including `name`'s casing and the spelling of the synthesised
 * enclosing procedure. An earlier revision listed `case` in its prose and omitted it from the tuple:
 * every *earlier* declaration was lowercase and only the later one varied, so `define FOO` followed
 * by `define foo` was generated nowhere. That matters — an implementation storing the first
 * declaration under its SURFACE spelling while looking up the FOLDED one reports the duplicate for
 * `foo`/`FOO` and silently overrides for `FOO`/`foo`, and only the second order exposes it.
 */
const DECLARATION_AXES = {
  keyword: DECLARATION_KEYWORDS,
  depth: NESTING_DEPTHS,
  wrapper: WRAPPER_KINDS,
  name: ["dup", "DUP"],
  enclosingKeyword: DECLARATION_KEYWORDS.filter((k) => k !== "struct"),
};
const AXIS_NAMES = Object.keys(DECLARATION_AXES);
const DEFAULT_CONFIGURATION = {
  keyword: "define",
  depth: 0,
  wrapper: "Program.body",
  name: "dup",
  enclosingKeyword: "define",
};

/**
 * Per-axis overrides applied when THAT axis is the one being drawn.
 *
 * **Some axes are conditioned on another axis's value, and for those "the rest at defaults" is not a
 * neutral background — it is a switch that turns the axis off.** `enclosingKeyword` only reaches the
 * source through {@link nestInsideProcedure}'s loop, which does not run at depth 0, so drawing it
 * against `DEFAULT_CONFIGURATION` produced **one** distinct program from two values. Measured: 9 of
 * the 25 ordered cross-role axis pairs were degenerate — every one of them involving
 * `enclosingKeyword` — while the derived cell count stayed correct at 1,828. A live defect sat in
 * that gap: a declaration nested in a `to`-spelled procedure, silently overridden by a later
 * `struct` of the same name, reproducing issue #839's own bug and surviving the entire Definition
 * of Done.
 *
 * The default stays `depth: 0` globally, because top-level is the baseline worth keeping for every
 * other axis; only the conditioned axis carries an enabling value. {@link drawAxis} applies it, and
 * the "every axis changes the source" test below is what makes a future conditioned axis fail loudly
 * instead of silently collapsing.
 */
const AXIS_ENABLING_CONFIGURATION = {
  enclosingKeyword: { depth: 1 },
};

/** One declaration's configuration with `axis` set to `value`, at a configuration that lets it act. */
function drawAxis(axis, value) {
  return {
    ...DEFAULT_CONFIGURATION,
    ...(AXIS_ENABLING_CONFIGURATION[axis] ?? {}),
    [axis]: value,
  };
}

/** Every full configuration of one declaration — the product of all five axes. */
const EVERY_DECLARATION_CONFIGURATION = AXIS_NAMES.reduce(
  (configurations, axis) =>
    configurations.flatMap((configuration) =>
      DECLARATION_AXES[axis].map((value) => ({
        ...configuration,
        [axis]: value,
      })),
    ),
  [{ ...DEFAULT_CONFIGURATION }],
);

const configurationLabel = (configuration) =>
  AXIS_NAMES.map((axis) => `${axis}=${configuration[axis]}`).join(",");

test("every AXIS actually changes the generated source at the configuration the product draws it", () => {
  // The dual of "each wrapper places the declaration in the slot it claims": that guard protects an
  // axis's VALUE SET, this one protects the BACKGROUND it is drawn against. A pairwise covering
  // array assumes its axes are independent; `enclosingKeyword` is conditioned on `depth > 0`, so
  // drawn at the global default it produced ONE program from two values and 9 of 25 ordered axis
  // pairs were silently degenerate — while the derived cell count stayed correct, which is exactly
  // what stopped anyone looking. A derived count certifies the table, not the artefact.
  //
  // This also catches an axis that is inert entirely: add one to `DECLARATION_AXES` that
  // `declarationSource` never consumes and the product doubles while asserting nothing — measured,
  // 28/28 green before this test existed.
  for (const axis of AXIS_NAMES) {
    const sources = new Set(
      DECLARATION_AXES[axis].map((value) =>
        declarationSource({ ...drawAxis(axis, value), prefix: "outerA" }),
      ),
    );
    assert.equal(
      sources.size,
      DECLARATION_AXES[axis].length,
      `axis \`${axis}\` must produce a distinct program per value where the product draws it`,
    );
  }
});

test("the cross-role pair generator emits DISTINCT programs, not merely the right count", () => {
  // The count is derived from the axis lengths and was correct at 1,828 while 469 of those cells
  // were duplicates of another cell. A generator can satisfy a derived count and still emit the
  // wrong pairs — the same shape as the wrapper-collision bug, where two wrappers shared a name and
  // the product silently tested itself.
  const blocks = [];
  for (const earlierAxis of AXIS_NAMES) {
    for (const laterAxis of AXIS_NAMES) {
      const programs = new Set();
      for (const earlierValue of DECLARATION_AXES[earlierAxis]) {
        for (const laterValue of DECLARATION_AXES[laterAxis]) {
          programs.add(
            `${declarationSource({
              ...drawAxis(earlierAxis, earlierValue),
              prefix: "outerA",
            })}\n${declarationSource({
              ...drawAxis(laterAxis, laterValue),
              prefix: "outerB",
            })}`,
          );
        }
      }
      assert.equal(
        programs.size,
        DECLARATION_AXES[earlierAxis].length *
          DECLARATION_AXES[laterAxis].length,
        `pair \`${earlierAxis} x ${laterAxis}\` must emit one distinct program per combination`,
      );
      blocks.push(programs);
    }
  }
  // Every ordered axis-pair block must be genuinely distinct from every other block — the strict
  // claim, which is true, rather than "all 676 cells are distinct", which is not: 192 cells are
  // shared between blocks, because two different pairs can generate the same program where their
  // drawn values coincide with the shared default. Asserted as "no two blocks are the same SET",
  // with no magic floor: a hand-written threshold is the `>= 10` shape this file already removed
  // once, and a comment claiming more than its assertion checks is the shape it removed three times.
  const blockKeys = blocks.map((programs) =>
    [...programs].sort().join("\u0000"),
  );
  assert.equal(
    new Set(blockKeys).size,
    blockKeys.length,
    "no ordered axis pair may be a relabelling of another",
  );
});

test("the duplicate rule is invariant across the per-declaration product, with every cross-role AXIS PAIR covered", () => {
  // Two declarations, each independently configured across all five axes. The completeness argument:
  // both diagnostics concern **at most two declarations**; each declaration is fully characterised by
  // `(keyword, case, depth, wrapper, enclosing spelling)`; there is no third level because there is
  // no third declaration.
  //
  // **The bound, stated exactly rather than generously.** The unrestricted product is
  // |config|^2 = 576^2 = 331,776 cells and is not runnable, so it is reduced on two stated
  // principles — and the reduction is *pairwise*, not the "three or more axes" the previous revision
  // claimed. That claim was wrong: it excluded ordinary TWO-axis cross-role interactions, such as an
  // earlier `define` in an `every` handler against a later top-level `struct`, which no sweep
  // generated. Both a cross-kind defect and a handler-scope defect have actually been measured here,
  // so their combination was plausible rather than contrived.
  //
  //  1. **Every configuration appears in BOTH roles** — as the earlier declaration against a default
  //     later one, and as the later against a default earlier one. No configuration is unexercised
  //     in either position.
  //  2. **Every cross-role AXIS PAIR is covered exhaustively** — for each ordered pair of axes, one
  //     drawn on the earlier declaration and one on the later, every combination of their values
  //     appears with the remaining axes at their defaults. So any defect expressible as "this
  //     property of the earlier declaration together with that property of the later" is generated.
  //
  // What remains outside, stated exactly: (a) a defect requiring **three or more** axis values to
  // coincide across the two declarations simultaneously, and (b) **ancestor-chain interleaving**.
  // `declarationSource` always applies the wrapper INSIDE the nest, so every generated ancestor
  // chain is `{procedures}* · {one wrapper}` — a procedure inside a loop body is not in the space.
  // Measured: a mutant exempting declarations whose enclosing PROCEDURE sits in a loop body
  // survives, while the plausible unconditional form of that wrong model — "declarations in a loop
  // body are per-iteration" — dies against two tests. The surviving variant is derived from this
  // generator's composition order rather than from how the code could plausibly be wrong, which is
  // why it is recorded as a boundary and not patched with its own cell. If a mutant is ever found
  // there that is derived from the code, the fix is to widen the composition — not to add the cell.
  const pairs = [];
  for (const configuration of EVERY_DECLARATION_CONFIGURATION) {
    pairs.push([configuration, DEFAULT_CONFIGURATION, "earlier role"]);
    pairs.push([DEFAULT_CONFIGURATION, configuration, "later role"]);
  }
  for (const earlierAxis of AXIS_NAMES) {
    for (const laterAxis of AXIS_NAMES) {
      for (const earlierValue of DECLARATION_AXES[earlierAxis]) {
        for (const laterValue of DECLARATION_AXES[laterAxis]) {
          pairs.push([
            drawAxis(earlierAxis, earlierValue),
            drawAxis(laterAxis, laterValue),
            `${earlierAxis} x ${laterAxis}`,
          ]);
        }
      }
    }
  }

  // Derived from the axis lengths, never hand-computed.
  const axisValueTotal = AXIS_NAMES.reduce(
    (total, axis) => total + DECLARATION_AXES[axis].length,
    0,
  );
  assert.equal(
    pairs.length,
    EVERY_DECLARATION_CONFIGURATION.length * 2 +
      axisValueTotal * axisValueTotal,
  );

  const rows = pairs.map(([earlier, later, group]) => {
    const source = `${declarationSource({
      ...earlier,
      prefix: "outerA",
    })}\n${declarationSource({
      ...later,
      prefix: "outerB",
    })}`;
    const label = `[${group}] ${configurationLabel(earlier)} + ${configurationLabel(later)}`;
    return [label, bothStages(source), later.name];
  });

  // Cross-stage agreement on the FULL identity — code, severity, every param including
  // `original_span`'s value, and `source_span`. Asserted from the helper's row so no formatter here
  // can narrow it.
  assert.deepEqual(
    rows.map(([label, stages]) => [label, stages.fromExecuteRow]),
    rows.map(([label, stages]) => [label, stages.fromCheckRow]),
  );

  const describe = ([label, stages, laterName]) =>
    [
      label,
      stages.fromExecute
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
    const rows = everyBuiltInName.map((name) => [
      name,
      bothStages(nestInsideProcedure(declareProcedure(name), depth)),
    ]);
    // Compared on the FULL identity, span included — an omitted facet is a variable held constant
    // across every table that uses the helper, which is why `fullIdentity` replaced the
    // params-only comparison everywhere rather than at one site. `diagnostics` and `events` are
    // asserted here too: `bothStages` filters to the two declaration-slot codes, so without the
    // count a spurious extra diagnostic would hide behind the filter.
    assert.deepEqual(
      rows.map(([name, stages]) => [name, stages.fromExecuteRow]),
      rows.map(([name, stages]) => [name, stages.fromCheckRow]),
      `depth ${depth}`,
    );
    assert.deepEqual(
      rows.map(([name, stages]) => [
        name,
        stages.fromExecute.map(([code, params]) => [code, params.name]),
        stages.executeDiagnosticCount,
        stages.events,
      ]),
      everyBuiltInName.map((name) => [
        name,
        [["ol-reserved-word", name]],
        1,
        0,
      ]),
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

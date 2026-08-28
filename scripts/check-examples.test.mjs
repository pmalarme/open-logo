// Unit + regression tests for the examples DoD gate (issue #283). Per ADR-0009's pattern, these
// import scripts/examples-gate.mjs's logic directly (for 100% coverage) plus one subprocess test
// for the CLI shell (scripts/check-examples.mjs), pointed at isolated temp fixtures via --dir/
// --manifest rather than the real spec/examples/ corpus.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  EXAMPLES_DIR,
  HOST_INPUT_PATH,
  IMPLEMENTED_PROFILES,
  MANIFEST_PATH,
  classifyExample,
  isRunnable,
  loadHostInputManifest,
  loadManifest,
  parseArgs,
  registersHostHandlers,
  runExamplesGate,
  validateHostInputEntry,
} from "./examples-gate.mjs";
import { detectUsedProfiles } from "./profile-detection.mjs";

// Each test gets its own fresh, uniquely-named OS temp directory — never a shared or repo-tracked
// fixture path (same convention scripts/conformance.test.mjs uses, issue #140).
let TEMP_DIR;

beforeEach(() => {
  TEMP_DIR = mkdtempSync(join(tmpdir(), "ol-examples-gate-"));
});

afterEach(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

function writeExample(name, source) {
  writeFileSync(join(TEMP_DIR, name), source, "utf8");
}

function writeManifestFile(manifest) {
  const manifestPath = join(TEMP_DIR, "profiles.json");
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  return manifestPath;
}

// --- Unit tests ---------------------------------------------------------------------------

test("isRunnable is true when every required profile is implemented", () => {
  assert.equal(isRunnable(["core-language"], ["core-language"]), true);
  assert.equal(
    isRunnable(
      ["core-language", "turtle-rendering"],
      ["core-language", "turtle-rendering"],
    ),
    true,
  );
});

test("isRunnable is false when any required profile is missing", () => {
  assert.equal(isRunnable(["core-language", "data"], ["core-language"]), false);
});

test("isRunnable is vacuously true for an empty requirement list", () => {
  assert.equal(isRunnable([], ["core-language"]), true);
});

test("classifyExample passes a clean, error-free program", () => {
  const result = classifyExample("forward 10\nright 90\n", "clean.logo");
  assert.deepEqual(result, { status: "pass" });
});

test("classifyExample fails a program with an error-severity diagnostic", () => {
  const result = classifyExample("print :undefined_name\n", "broken.logo");
  assert.equal(result.status, "fail");
  assert.match(result.reason, /ol-undefined-var/);
});

test("classifyExample reports a thrown exception as a failure rather than propagating it", () => {
  // execute() throws a plain TypeError for a non-string source rather than returning
  // diagnostics — this exercises classifyExample's defensive catch branch.
  const result = classifyExample(undefined, "throws.logo");
  assert.equal(result.status, "fail");
  assert.match(result.reason, /^threw: /);
});

test("loadManifest parses the real repo manifest and covers every real example", () => {
  const manifest = loadManifest(MANIFEST_PATH);
  assert.equal(manifest["05-procedures.logo"].includes("heritage"), true);
  assert.equal(
    manifest["01-movement.logo"].every((p) => IMPLEMENTED_PROFILES.includes(p)),
    true,
  );
});

test("parseArgs reads --dir, --manifest and --host-input overrides", () => {
  assert.deepEqual(
    parseArgs([
      "--dir=tmp/examples",
      "--manifest=tmp/profiles.json",
      "--host-input=tmp/host-input.json",
    ]),
    {
      dir: "tmp/examples",
      manifestPath: "tmp/profiles.json",
      hostInputPath: "tmp/host-input.json",
    },
  );
});

test("parseArgs returns undefined overrides when no flags are given", () => {
  assert.deepEqual(parseArgs([]), {
    dir: undefined,
    manifestPath: undefined,
    hostInputPath: undefined,
  });
});

// --- detectUsedProfiles unit tests (issue #519, finding G8) -------------------------------
//
// One case per construct spec/conformance.md ties to an optional profile in every context,
// plus the plain-Core baseline and the record-vs-list-binder destructuring case the task
// explicitly rules Core (spec/conformance.md's list-binder-over-plain-lists classification).

test("detectUsedProfiles finds no optional profile in a plain Core/Turtle program", () => {
  assert.deepEqual(
    detectUsedProfiles("clear_screen\nforward 50\nright 90\n"),
    [],
  );
});

test("detectUsedProfiles: plain-list-binder destructuring stays Core, not Data", () => {
  // Mirrors 08-algorithms.logo's real usage: destructuring a *plain list* of coordinate pairs.
  // spec/conformance.md rules this Core — only record-binder destructuring needs Data, and that
  // depends on the runtime value being destructured, which a static AST walk cannot decide.
  assert.deepEqual(
    detectUsedProfiles(
      ":points = [[0 0] [10 0]]\nfor [:x :y] in :points\n  forward :x\nend for\n",
    ),
    [],
  );
});

test("detectUsedProfiles finds data for a list-index read", () => {
  assert.deepEqual(detectUsedProfiles("print :colors[1]\n"), ["data"]);
});

test("detectUsedProfiles finds data for a list-index write (place assignment)", () => {
  assert.deepEqual(detectUsedProfiles(':colors[2] = "purple"\n'), ["data"]);
});

test("detectUsedProfiles finds data for dotted field access", () => {
  assert.deepEqual(detectUsedProfiles("print :ages.tom\n"), ["data"]);
});

test("detectUsedProfiles finds data for a dict literal", () => {
  assert.deepEqual(detectUsedProfiles(":ages = {\n  tom: 8\n}\n"), ["data"]);
});

test("detectUsedProfiles finds data for a struct declaration", () => {
  assert.deepEqual(detectUsedProfiles("struct point [ x y ]\n"), ["data"]);
});

test("detectUsedProfiles finds data for add/remove/insert/clear collection mutation forms", () => {
  assert.deepEqual(detectUsedProfiles('add "orange" to :colors\n'), ["data"]);
  assert.deepEqual(detectUsedProfiles('remove "orange" from :colors\n'), [
    "data",
  ]);
  assert.deepEqual(detectUsedProfiles("remove key sophie from :ages\n"), [
    "data",
  ]);
  assert.deepEqual(detectUsedProfiles('insert "x" in :colors at 1\n'), [
    "data",
  ]);
  assert.deepEqual(detectUsedProfiles("clear :colors\n"), ["data"]);
});

test("detectUsedProfiles finds BOTH heritage and data for the 'value of ... for key' dict reader", () => {
  // spec/conformance.md:273/:301: `value of ... for key` is classified as Heritage, but that
  // spelling "also needs Data" because it operates on dicts — an example using it must declare
  // BOTH profiles, or the missing one goes undetected (the same G8 masking class this whole gate
  // exists to close; a first draft classified this construct as "data" only and missed heritage).
  assert.deepEqual(detectUsedProfiles('print value of :ages for key "tom"\n'), [
    "data",
    "heritage",
  ]);
});

test("detectUsedProfiles finds data for the Data profile's derived call-site reporters", () => {
  // These are call-site names, not distinct AST node kinds — detected via
  // @openlogo/parser's own dataPrimitiveArity() name table (issue #519 rubber-duck review:
  // a bare `dict`/`list` constructor call has no DictLit/list-index/field AST shape at all, so
  // without this the exact G8 masking bug would still be reproducible via these primitives).
  assert.deepEqual(detectUsedProfiles(":d = dict\n"), ["data"]);
  assert.deepEqual(detectUsedProfiles(":l = list\n"), ["data"]);
  assert.deepEqual(detectUsedProfiles("print reverse :nums\n"), ["data"]);
  assert.deepEqual(detectUsedProfiles("print pick :nums\n"), ["data"]);
  assert.deepEqual(detectUsedProfiles("print sort :nums\n"), ["data"]);
  assert.deepEqual(detectUsedProfiles("print keys :ages\n"), ["data"]);
  assert.deepEqual(detectUsedProfiles("print values :ages\n"), ["data"]);
  assert.deepEqual(detectUsedProfiles("print type_of :p\n"), ["data"]);
});

test("detectUsedProfiles finds sound for the Sound primitive names", () => {
  assert.deepEqual(detectUsedProfiles("note 440 1\n"), ["sound"]);
  assert.deepEqual(detectUsedProfiles('play "C4"\n'), ["sound"]);
});

test("detectUsedProfiles finds interaction-events for wait/when/every/on_key/on_click/input", () => {
  assert.deepEqual(detectUsedProfiles("wait 1\n"), ["interaction-events"]);
});

test("detectUsedProfiles finds sprites for new_turtle/tell/ask/each/turtles/who", () => {
  assert.deepEqual(detectUsedProfiles("ask :leader [ forward 10 ]\n"), [
    "sprites",
  ]);
});

test("detectUsedProfiles finds geometry for the grid/axes/measure overlay primitives", () => {
  // spec/geometry-module.md's grid/axes/measure are renderer-backed primitives (unlike
  // polygon/area/perimeter, which are discoverable OpenLogo stdlib source an example typically
  // `define`s for itself — but a bare call to one is still detected too, see the next test), and
  // Geometry IS an implemented profile (IMPLEMENTED_PROFILES), so this is a live masking case
  // (issue #519, third review round).
  assert.deepEqual(detectUsedProfiles("grid\n"), ["geometry"]);
  assert.deepEqual(detectUsedProfiles("axes\n"), ["geometry"]);
  assert.deepEqual(detectUsedProfiles("measure\n"), ["geometry"]);
});

test("detectUsedProfiles finds geometry for the polygon/star/circle/arc derived stdlib procedures", () => {
  // Fifth review round (issue #519): these have no arity-table entry (they are discoverable
  // OpenLogo source, per spec/geometry-module.md), but a bare call site is an ordinary,
  // recognizable Call — exactly as detectable-by-bare-name as SOUND_CALLEE_NAMES etc. above.
  assert.deepEqual(detectUsedProfiles("polygon 5 100\n"), ["geometry"]);
  assert.deepEqual(detectUsedProfiles("star 5 100\n"), ["geometry"]);
  assert.deepEqual(detectUsedProfiles("circle 50\n"), ["geometry"]);
  assert.deepEqual(detectUsedProfiles("arc 50 90\n"), ["geometry"]);
});

test("detectUsedProfiles finds BOTH geometry and data for area/perimeter (spec/conformance.md:261)", () => {
  // "area/perimeter read a shape spec by list index, so they also need Data" — the same
  // "this construct's own semantics always need a second profile" rule already applied to
  // ValueOfKey, scoped to just these two of the six derived stdlib names.
  assert.deepEqual(detectUsedProfiles("area [4 4]\n"), ["data", "geometry"]);
  assert.deepEqual(detectUsedProfiles("perimeter [4 4]\n"), [
    "data",
    "geometry",
  ]);
});

test("detectUsedProfiles does NOT flag geometry when an example defines its own polygon/area/perimeter (mirrors 13-geometry-stdlib.logo)", () => {
  // The real spec/examples/13-geometry-stdlib.logo defines these procedures itself; the
  // definedProcedureNames shadow-guard (checked before GEOMETRY_STDLIB_CALLEE_NAMES) must
  // continue to treat that as ordinary Core user code, not evidence of Geometry usage.
  assert.deepEqual(
    detectUsedProfiles(
      "define polygon :sides :length\n  repeat :sides [ forward :length right 90 ]\nend\npolygon 4 50\n",
    ),
    [],
  );
});

test("detectUsedProfiles does NOT flag geometry/sound/tutor-ai when a struct's own constructor name collides with a profile callee (round-12 rubber-duck: struct is a callable-registering declaration too, not just define)", () => {
  // A `struct` declaration registers a same-named constructor reporter (ast.ts's StructDefNode
  // doc comment), so `struct area [ value ]` then `print area 5` is ordinary, valid Data-only
  // code. Before the round-12 fix, the definedProcedureNames shadow-guard only precollected
  // `ProcedureDef` names, so this call reached the geometry/sound/tutor-ai bare-name branches
  // unguarded and detectUsedProfiles wrongly returned ["data","geometry"] for a Data-only example.
  assert.deepEqual(
    detectUsedProfiles("struct area [ value ]\nprint area 5\n"),
    ["data"],
  );
  assert.deepEqual(
    detectUsedProfiles("struct polygon [ sides ]\nprint polygon 4\n"),
    ["data"],
  );
  assert.deepEqual(
    detectUsedProfiles("struct note [ pitch ]\nprint note 60\n"),
    ["data"],
  );
  assert.deepEqual(
    detectUsedProfiles("struct challenge [ n ]\nprint challenge 1\n"),
    ["data"],
  );
});

test("runExamplesGate does NOT spuriously fail a Data-only example whose struct constructor shares a name with a Geometry callee (round-12 false-positive regression)", () => {
  writeExample(
    "struct-name-collision.logo",
    "struct area [ value ]\nprint area 5\n",
  );
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "struct-name-collision.logo": ["core-language", "data"],
    },
    implementedProfiles: [
      "core-language",
      "turtle-rendering",
      "data",
      "geometry",
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.failed, 0);
  assert.ok(
    result.lines.some((line) => line === "PASS struct-name-collision.logo"),
  );
  assert.ok(
    !result.lines.some((line) => line.includes("under-declared")),
    "must not report an under-declared-profile failure for a correctly-declared Data example",
  );
});

test("detectUsedProfiles finds educational for the explain/why/hint/debug meta-commands", () => {
  assert.deepEqual(detectUsedProfiles("explain\n"), ["educational"]);
  assert.deepEqual(detectUsedProfiles("why\n"), ["educational"]);
  assert.deepEqual(detectUsedProfiles("hint\n"), ["educational"]);
  assert.deepEqual(detectUsedProfiles("debug\n"), ["educational"]);
});

test("detectUsedProfiles finds tutor-ai for the 'challenge' Socratic entry point (spec/conformance.md:279-280)", () => {
  // Fourth review round: `challenge` was previously excluded on the theory that, like
  // `to`/`output`/`op`, it has no registered primitive-arity entry
  // (packages/parser/src/educational-meta-commands.test.mjs:64 confirms
  // educationalPrimitiveArity("challenge") is undefined) and so would be indistinguishable from a
  // user-defined procedure. But `to`/`output`/`op` are reserved words with NO Call/ParenCall
  // production at all (an example using them fails to parse), whereas `challenge` parses as an
  // ordinary, recognizable Call — exactly as detectable-by-bare-name as SOUND_CALLEE_NAMES'
  // note/play/beep or SPRITES_CALLEE_NAMES' tell/ask, neither of which is arity-registered either.
  // The definedProcedureNames shadow-guard (see the next test) already neutralizes the
  // user-procedure collision risk identically for all of these, so there was no principled reason
  // to leave `challenge` undetected.
  assert.deepEqual(detectUsedProfiles("challenge\n"), ["tutor-ai"]);
});

test("detectUsedProfiles does NOT flag tutor-ai when 'challenge' is the example's own defined procedure", () => {
  // Mirrors the existing shadow-guard tests for Sound/Geometry/etc.: a Core-only example that
  // happens to `define` its own procedure named "challenge" and calls it must NOT be misattributed
  // to Tutor (AI), or acceptance criterion 3 (a correctly-declared example still passes) breaks.
  assert.deepEqual(
    detectUsedProfiles("define challenge\n  print 1\nend\nchallenge\n"),
    [],
  );
});

test("detectUsedProfiles finds heritage for a short-alias call", () => {
  assert.deepEqual(detectUsedProfiles("fd 10\n"), ["heritage"]);
});

test("detectUsedProfiles finds heritage for the 'make' assignment spelling", () => {
  // Since issue #151 `make "name" value` parses as an `Assign` node whose `form` is `"make"`
  // (spec/grammar.md:105 make-assignment ::= "make" word-literal expression), NOT a zero-arity
  // Call — so the detector recognizes it by that node form, not by a callee name.
  assert.deepEqual(detectUsedProfiles('make "x" 1\n'), ["heritage"]);
});

test("detectUsedProfiles finds heritage for the 'to'/'output'/'op' spellings via their AST nodes", () => {
  // As of issue #667 (slice H2) `to`/`output`/`op` parse into real AST nodes — `ProcedureDef`
  // with `keyword: "to"` and `Return` with `keyword: "output"/"op"` — NOT the `ol-bad-token`
  // diagnostic they produced before, so detectUsedProfiles recognizes them from those node shapes
  // in its walk (see #701: this detector keys on AST shape, so a form gaining a production moves
  // its detection off the vanished diagnostic and onto the node).
  assert.deepEqual(
    detectUsedProfiles("to draw_tick :size\nforward :size\nend\n"),
    ["heritage"],
  );
  assert.deepEqual(detectUsedProfiles("output 5\n"), ["heritage"]);
  assert.deepEqual(detectUsedProfiles("op 5\n"), ["heritage"]);
});

test("detectUsedProfiles does NOT flag heritage for 'to' in its three legitimate non-Heritage roles (for-range bound, set-assignment preposition, add-to-list preposition)", () => {
  // `to` is also a plain keyword in three grammar productions (spec/grammar.md:104, :113, :128)
  // where it appears mid-statement, never as a statement opener — so the reader never dispatches
  // `parseProcedureDef` for them and no `ProcedureDef keyword:"to"` node results, so a plain
  // example using one of them is never spuriously flagged as needing Heritage (acceptance
  // criterion 3).
  assert.deepEqual(detectUsedProfiles("for i from 1 to 5 [ print :i ]\n"), []);
  assert.deepEqual(detectUsedProfiles("local x\nset x to 5\nprint :x\n"), []);
  // `add … to …` is itself a Data-profile construct (rubber-duck-v11 review), so this must
  // report "data" (already covered by DATA_NODE_KINDS) but never "heritage".
  assert.deepEqual(
    detectUsedProfiles("local colors\nset colors to [1 2]\nadd 3 to colors\n"),
    ["data"],
  );
});

test("detectUsedProfiles finds modules for the 'import'/'export' reserved words", () => {
  // Like to/output/op, import/export have no AST production at all today
  // (NON_PRIMARY_NAMES) — every occurrence is an ol-bad-token diagnostic.
  assert.deepEqual(detectUsedProfiles("import foo\n"), ["modules"]);
  assert.deepEqual(detectUsedProfiles("export foo\n"), ["modules"]);
});

test("detectUsedProfiles finds localization for the 'alias' reserved word (spec/localization.md:18-21)", () => {
  // `alias new_name existing_name` is THE Localization aliasing mechanism; like import/export it
  // has no AST production today, so it is detected the same way.
  assert.deepEqual(detectUsedProfiles("alias avancer forward\n"), [
    "localization",
  ]);
});

test("detectUsedProfiles does NOT flag a user-defined procedure that shadows an optional-profile callee name (round-5 rubber-duck review)", () => {
  // `define` accepts any name token (no reserved-name check) — a Core-only example is free to
  // define its own `note` procedure. Bare callee-name matching alone would misattribute the call
  // below to Sound, breaking acceptance criterion 3 (a correctly-declared Core example must still
  // pass). Cover both a hand-maintained callee-name set (Sound's `note`) and a parser-table-driven
  // check (Geometry's `grid`) to prove the fix applies uniformly, not just to the one name found.
  assert.deepEqual(
    detectUsedProfiles(
      "define note :duration\n  print :duration\nend\nnote 500\n",
    ),
    [],
  );
  assert.deepEqual(
    detectUsedProfiles("define grid :n\n  print :n\nend\ngrid 4\n"),
    [],
  );
});

test("detectUsedProfiles STILL flags Data usage even when a same-named procedure is locally defined, in EXPRESSION position (round-6 rubber-duck review)", () => {
  // Round-6 rubber-duck review found the round-5 shadow-guard was overbroad: `@openlogo/runtime`'s
  // expression evaluator (evaluate.ts) resolves the 8 Data derived-reporter names (list/dict/
  // reverse/pick/sort/keys/values/type_of) to the Data builtin BEFORE it ever consults
  // environment.procedures — unlike every other checked name, a local `define` of one of these
  // names does NOT shadow the builtin at runtime in expression position. A Core-only manifest
  // declaration would therefore still execute Data behavior and must still be flagged.
  assert.deepEqual(
    detectUsedProfiles(
      'define list :a :b\n  return "shadowed"\nend\nprint list 1 2\n',
    ),
    ["data"],
  );
});

test("detectUsedProfiles does NOT flag Data usage when a same-named procedure is locally defined AND called in STATEMENT position (round-7 rubber-duck review)", () => {
  // Round-7 rubber-duck review found the round-6 fix was itself overbroad in the OPPOSITE
  // direction: unlike expression position, `@openlogo/runtime`'s STATEMENT dispatch
  // (`execute-internal.ts`'s `isProcedureCallStatement`) checks `environment.procedures.has(name)`
  // FIRST, with no builtin exclusion at all — confirmed by direct `execute()` repro: with this
  // exact `define list ... end` in scope, the bare statement `list 1 2` emits a `procedure-enter`
  // for the user's `list` (printing `1`), never touching the Data builtin. So a Core-only example
  // whose own procedure happens to be named `list` and is called as a bare statement must NOT be
  // flagged for Data, or acceptance criterion 3 (a correctly-declared example still passes) would
  // break — the same round-5 false-positive class, just for a name the round-6 fix had exempted
  // from the shadow-guard.
  assert.deepEqual(
    detectUsedProfiles("define list :a :b\n  print :a\nend\nlist 1 2\n"),
    [],
  );
});

test("detectUsedProfiles flags Data usage for a bare statement-position call when there is NO colliding local define", () => {
  // Sanity check for the round-7 fix: the statement/expression distinction only matters when a
  // local `define` actually collides with the name. With no such collision, a statement-position
  // call to a Data derived reporter (via the parenthesized-call spelling the grammar requires for
  // a reporter in statement position) is still attributed to Data.
  assert.deepEqual(detectUsedProfiles("(list 1 2)\n"), ["data"]);
});

test("detectUsedProfiles does NOT flag Data usage when a same-named procedure shadows a call NESTED in an if-block's statement body (round-8 rubber-duck review)", () => {
  // Round-8 rubber-duck review stress-tested the round-7 fix's statement-position detection
  // beyond the top-level Program body: a call inside an `If`'s `thenBody` block is *also*
  // genuine statement position (`execute-internal.ts`'s `executeStatements` recurses into
  // `statement.thenBody.body`), so it must be shadow-guarded exactly like a top-level statement.
  assert.deepEqual(
    detectUsedProfiles(
      "define list :a :b\n  print :a\nend\nif 1 == 1 [\n  list 1 2\n]\n",
    ),
    [],
  );
});

test("detectUsedProfiles STILL flags Data usage for a same-named procedure called inside a comprehension body (round-8 rubber-duck review)", () => {
  // Round-8 rubber-duck review found the round-7 fix was itself incomplete: `Comprehension.body`
  // is ALSO typed `BlockNode` (`packages/parser/src/ast.ts:381-386`), so a naive "every Block's
  // body is a statement" rule would have wrongly shadow-guarded a call inside a `map`/`filter`/
  // `reduce` body — but a comprehension body is evaluated as an EXPRESSION per iteration, never
  // through `executeStatements`. Confirmed by direct `execute()` repro: with this exact
  // `define list ... end` in scope, `print map x in [1 2] [ list :x :x ]` prints the Data
  // builtin's `[[1, 1], [2, 2]]`, with no `procedure-enter` for the user's `list` — so this must
  // still be flagged, not shadow-guarded.
  assert.deepEqual(
    detectUsedProfiles(
      'define list :a :b\n  return "shadowed"\nend\nprint map x in [1 2] [ list :x :x ]\n',
    ),
    ["data"],
  );
});

test("detectUsedProfiles does NOT flag Data usage for a same-named procedure called inside a while/forever/for-range/repeat body", () => {
  // Every `BlockNode`-holding control form that dispatches its body through `executeStatements`
  // (not just `Program`/`If`, already covered above) must apply the same statement-position
  // shadow-guard. `while`/`forever`/`for ... from ... to` never appear in the real
  // spec/examples/*.logo corpus, so this also exercises those switch arms that the corpus alone
  // does not reach.
  const preamble = "define list :a :b\n  print :a\nend\n";
  assert.deepEqual(
    detectUsedProfiles(`${preamble}while 1 == 1\n  list 1 2\n  stop\nend\n`),
    [],
  );
  assert.deepEqual(
    detectUsedProfiles(`${preamble}forever\n  list 1 2\n  stop\nend\n`),
    [],
  );
  assert.deepEqual(
    detectUsedProfiles(`${preamble}for i from 1 to 1\n  list 1 2\nend\n`),
    [],
  );
  assert.deepEqual(
    detectUsedProfiles(`${preamble}repeat 1\n  list 1 2\nend\n`),
    [],
  );
});

test("detectUsedProfiles still detects the real primitive when no same-named procedure is defined", () => {
  // Sanity check for the shadow-guard above: it must not over-suppress detection of genuine
  // profile usage when there is no colliding `define`.
  assert.deepEqual(detectUsedProfiles("note 440 1\n"), ["sound"]);
  assert.deepEqual(detectUsedProfiles("grid 4\n"), ["geometry"]);
});

test("detectUsedProfiles returns every distinct profile a source uses, sorted", () => {
  assert.deepEqual(detectUsedProfiles("print :durations[:i]\nnote 440 1\n"), [
    "data",
    "sound",
  ]);
});

// --- runExamplesGate regression tests -----------------------------------------------------

test("runExamplesGate: a known-good Core example passes", () => {
  writeExample("good.logo", "clear_screen\nforward 50\nright 90\n");
  const manifest = { "good.logo": ["core-language", "turtle-rendering"] };

  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest,
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ran, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.ok(result.lines.some((line) => line === "PASS good.logo"));
});

test("runExamplesGate: FAILS the gate on a deliberately-broken example and SKIPS a Heritage one", () => {
  writeExample("good.logo", "forward 50\n");
  writeExample("broken.logo", "print :missing\n");
  // Mirrors 05-procedures.logo's real Heritage `to … end` form, which the parser does not yet
  // implement (`to`/`output`/`op` are reserved words with no AST node).
  writeExample("heritage.logo", "to draw_tick :size\nforward :size\nend\n");

  const manifest = {
    "good.logo": ["core-language", "turtle-rendering"],
    "broken.logo": ["core-language", "turtle-rendering"],
    "heritage.logo": ["core-language", "turtle-rendering", "heritage"],
  };

  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest,
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false, "the gate must fail overall");
  assert.equal(result.ran, 2, "good.logo and broken.logo both actually ran");
  assert.equal(result.skipped, 1, "heritage.logo must be skipped, not run");
  assert.equal(result.failed, 1, "only broken.logo counts as a failure");
  assert.ok(result.lines.some((line) => line === "PASS good.logo"));
  assert.ok(result.lines.some((line) => line.startsWith("FAIL broken.logo:")));
  assert.ok(
    result.lines.some((line) =>
      line.startsWith("SKIP heritage.logo (requires heritage"),
    ),
    "a skipped example must print a visible notice naming the missing profile — " +
      "this is what keeps the gate from silently degrading back to a presence-only check",
  );
});

test("runExamplesGate: an example missing from the manifest fails loudly, not silently", () => {
  writeExample("undeclared.logo", "forward 10\n");

  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {},
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some((line) =>
      line.startsWith("FAIL undeclared.logo: no entry in the profile manifest"),
    ),
  );
});

test("runExamplesGate: a manifest requiring several missing profiles lists all of them", () => {
  writeExample("needs-many.logo", "ask :leader [ forward 10 ]\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: { "needs-many.logo": ["core-language", "sprites", "sound"] },
    implementedProfiles: ["core-language"],
  });

  assert.equal(result.skipped, 1);
  assert.ok(
    result.lines.some((line) =>
      line.startsWith("SKIP needs-many.logo (requires sprites, sound"),
    ),
  );
});

test("runExamplesGate: catches an under-declared profile even when masked by an unrelated unimplemented profile (issue #519, finding G8)", () => {
  // Reproduces the exact bug: a source using a Data construct (list-index) whose manifest
  // entry declares an unrelated, not-yet-implemented profile (sound) but omits "data". Before
  // this hardening, the SKIP-for-sound path ran first and this gap was never even checked —
  // the gate would have wrongly printed SKIP. It must now FAIL loudly instead, naming both the
  // example and the missing "data" profile, regardless of the also-declared unimplemented
  // profile.
  writeExample("masked.logo", "set_tempo 120\nprint :durations[1]\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: { "masked.logo": ["core-language", "turtle-rendering", "sound"] },
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.skipped,
    0,
    "must FAIL, not SKIP — the under-declaration must not be masked",
  );
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some(
      (line) => line.startsWith("FAIL masked.logo:") && line.includes("data"),
    ),
    "the failure line must name the example and the missing profile (data)",
  );
});

test("runExamplesGate: catches masking via a Data derived-reporter primitive too, not just list-index (rubber-duck review follow-up)", () => {
  // The rubber-duck non-author review of this exact fix flagged that a bare Data primitive call
  // (e.g. `dict`) has no DictLit/index/field AST shape, so a first draft that only recognized
  // those node kinds would have let this masking scenario back in. `set_tempo` (Sound) is
  // declared but Data (via the `dict` call) is omitted — must still FAIL loudly, not SKIP.
  writeExample("masked-primitive.logo", "set_tempo 120\n:d = dict\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "masked-primitive.logo": ["core-language", "turtle-rendering", "sound"],
    },
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some(
      (line) =>
        line.startsWith("FAIL masked-primitive.logo:") && line.includes("data"),
    ),
  );
});

test("runExamplesGate: catches masking of the Heritage half of 'value of ... for key' too (integration-owner review follow-up)", () => {
  // spec/conformance.md:273/:301: `value of ... for key` is Heritage AND (because it operates on
  // dicts) Data. A manifest that declares "data" + an unrelated unimplemented profile ("sound")
  // but omits "heritage" must still FAIL loudly naming heritage, not SKIP — the exact G8 masking
  // class this gate exists to close, this time on the Heritage side of the dependency.
  writeExample(
    "masked-value-of.logo",
    'set_tempo 120\nprint value of :ages for key "tom"\n',
  );
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "masked-value-of.logo": [
        "core-language",
        "turtle-rendering",
        "sound",
        "data",
      ],
    },
    implementedProfiles: ["core-language", "turtle-rendering", "data"],
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.skipped,
    0,
    "must FAIL, not SKIP — the missing heritage declaration must not be masked",
  );
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some(
      (line) =>
        line.startsWith("FAIL masked-value-of.logo:") &&
        line.includes("heritage"),
    ),
    "the failure line must name the example and the missing profile (heritage)",
  );
});

test("runExamplesGate: catches masking of the Geometry overlay primitives too (orchestrator review, third round)", () => {
  // Geometry IS an implemented profile (unlike sound), so this is not hypothetical: an example
  // using `grid` while omitting "geometry" from its declared profiles, alongside an unrelated
  // unimplemented profile (interaction-events), must FAIL loudly naming geometry, not SKIP.
  writeExample("masked-grid.logo", "wait 1\ngrid\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "masked-grid.logo": [
        "core-language",
        "turtle-rendering",
        "interaction-events",
      ],
    },
    implementedProfiles: ["core-language", "turtle-rendering", "geometry"],
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.skipped,
    0,
    "must FAIL, not SKIP — the missing geometry declaration must not be masked",
  );
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some(
      (line) =>
        line.startsWith("FAIL masked-grid.logo:") && line.includes("geometry"),
    ),
    "the failure line must name the example and the missing profile (geometry)",
  );
});

test("runExamplesGate: catches masking of the Educational meta-commands too (orchestrator review, third round)", () => {
  // An example using `explain` while declaring only an unrelated unimplemented profile (sound)
  // but omitting "educational" must FAIL loudly naming educational, not SKIP.
  writeExample("masked-explain.logo", "set_tempo 120\nexplain\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "masked-explain.logo": ["core-language", "turtle-rendering", "sound"],
    },
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.skipped,
    0,
    "must FAIL, not SKIP — the missing educational declaration must not be masked",
  );
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some(
      (line) =>
        line.startsWith("FAIL masked-explain.logo:") &&
        line.includes("educational"),
    ),
    "the failure line must name the example and the missing profile (educational)",
  );
});

test("runExamplesGate: catches masking of the Tutor (AI) 'challenge' entry point too (fourth review round)", () => {
  // An example using `challenge` while declaring only an unrelated unimplemented profile (sound)
  // but omitting "tutor-ai" must FAIL loudly naming tutor-ai, not SKIP — the exact G8 masking
  // class this whole slice exists to close, now closed for every profile with a parseable callee.
  writeExample("masked-challenge.logo", "set_tempo 120\nchallenge\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "masked-challenge.logo": ["core-language", "turtle-rendering", "sound"],
    },
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.skipped,
    0,
    "must FAIL, not SKIP — the missing tutor-ai declaration must not be masked",
  );
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some(
      (line) =>
        line.startsWith("FAIL masked-challenge.logo:") &&
        line.includes("tutor-ai"),
    ),
    "the failure line must name the example and the missing profile (tutor-ai)",
  );
});

test("runExamplesGate: catches masking of the Geometry derived stdlib (polygon) too (fifth review round)", () => {
  // An example calling `polygon` at the top level (not defining its own), declaring only an
  // unrelated unimplemented profile (sound) but omitting "geometry", must FAIL loudly naming
  // geometry, not SKIP.
  writeExample("masked-polygon.logo", "set_tempo 120\npolygon 5 100\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "masked-polygon.logo": ["core-language", "turtle-rendering", "sound"],
    },
    implementedProfiles: ["core-language", "turtle-rendering", "geometry"],
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.skipped,
    0,
    "must FAIL, not SKIP — the missing geometry declaration must not be masked",
  );
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some(
      (line) =>
        line.startsWith("FAIL masked-polygon.logo:") &&
        line.includes("geometry"),
    ),
    "the failure line must name the example and the missing profile (geometry)",
  );
});

test("runExamplesGate: catches masking of the Heritage 'to ... end' reserved word too (fifth review round)", () => {
  // An example using the Heritage `to … end` procedure-definition spelling, declaring only an
  // unrelated unimplemented profile (sound) but omitting "heritage", must FAIL loudly naming
  // heritage, not SKIP — `to` has no AST node at all, so this proves the diagnostic-based
  // RESERVED_WORD_PROFILES detection (not just the AST walk) participates in the under-declaration
  // check.
  writeExample(
    "masked-to.logo",
    "set_tempo 120\nto draw_tick :size\nforward :size\nend\n",
  );
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "masked-to.logo": ["core-language", "turtle-rendering", "sound"],
    },
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.skipped,
    0,
    "must FAIL, not SKIP — the missing heritage declaration must not be masked",
  );
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some(
      (line) =>
        line.startsWith("FAIL masked-to.logo:") && line.includes("heritage"),
    ),
    "the failure line must name the example and the missing profile (heritage)",
  );
});

test("runExamplesGate: catches masking of the Modules 'import' reserved word too (fifth review round)", () => {
  // An example using `import`, declaring only an unrelated unimplemented profile (sound) but
  // omitting "modules", must FAIL loudly naming modules, not SKIP.
  writeExample("masked-import.logo", "set_tempo 120\nimport shapes\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "masked-import.logo": ["core-language", "turtle-rendering", "sound"],
    },
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.skipped,
    0,
    "must FAIL, not SKIP — the missing modules declaration must not be masked",
  );
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some(
      (line) =>
        line.startsWith("FAIL masked-import.logo:") && line.includes("modules"),
    ),
    "the failure line must name the example and the missing profile (modules)",
  );
});

test("runExamplesGate: catches masking of the Localization 'alias' reserved word too (fifth review round)", () => {
  // An example using `alias`, declaring only an unrelated unimplemented profile (sound) but
  // omitting "localization" (and its transitive "modules" dependency), must FAIL loudly naming
  // localization, not SKIP.
  writeExample("masked-alias.logo", "set_tempo 120\nalias avancer forward\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "masked-alias.logo": ["core-language", "turtle-rendering", "sound"],
    },
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.skipped,
    0,
    "must FAIL, not SKIP — the missing localization declaration must not be masked",
  );
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some(
      (line) =>
        line.startsWith("FAIL masked-alias.logo:") &&
        line.includes("localization"),
    ),
    "the failure line must name the example and the missing profile (localization)",
  );
});

test("runExamplesGate: an example whose declared profiles are a superset of actual usage still passes", () => {
  // Declaring "geometry" implies "data" via closureOf's dependency closure (spec/conformance.md
  // Geometry -> Data), which is a strict superset of what this source actually uses (data only).
  // Acceptance criterion 3: correctly (over-)declared examples still pass, not fail.
  writeExample(
    "superset.logo",
    ':colors = ["red" "green"]\nprint :colors[1]\n',
  );
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "superset.logo": ["core-language", "turtle-rendering", "geometry"],
    },
    implementedProfiles: [
      "core-language",
      "turtle-rendering",
      "data",
      "geometry",
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ran, 1);
  assert.equal(result.failed, 0);
  assert.ok(result.lines.some((line) => line === "PASS superset.logo"));
});

test("runExamplesGate: loads the manifest from disk when none is passed in", () => {
  writeExample("good.logo", "forward 10\n");
  const manifestPath = writeManifestFile({
    "good.logo": ["core-language", "turtle-rendering"],
  });

  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifestPath,
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ran, 1);
});

test("runExamplesGate: reports a missing examples directory instead of crashing", () => {
  const result = runExamplesGate({ dir: join(TEMP_DIR, "does-not-exist") });
  assert.equal(result.ok, false);
  assert.equal(result.ran, 0);
  assert.ok(result.lines.some((line) => line.includes("does not exist")));
});

test("runExamplesGate: reports an empty examples directory instead of crashing", () => {
  const result = runExamplesGate({ dir: TEMP_DIR, manifest: {} });
  assert.equal(result.ok, false);
  assert.ok(result.lines.some((line) => line.includes("no .logo files found")));
});

test("runExamplesGate defaults exercise the real spec/examples/ corpus and manifest", () => {
  // No overrides: covers the EXAMPLES_DIR/MANIFEST_PATH default parameters directly, and doubles
  // as a sanity check that the shipped manifest still accounts for every real example (an
  // unlisted example would otherwise fail with a misleading "no entry in the profile manifest").
  const result = runExamplesGate();
  const missingManifestEntry = result.lines.some((line) =>
    line.includes("no entry in the profile manifest"),
  );
  assert.equal(
    missingManifestEntry,
    false,
    "every spec/examples/*.logo file must have a scripts/examples-profiles.json entry",
  );
  assert.equal(result.ran + result.skipped, 13);
});

test("runExamplesGate leaves NO example skipped in the real corpus now that all four M5 profiles are claimed", () => {
  const result = runExamplesGate();
  // Every example that used to SKIP has left the list one terminal slice at a time:
  // `11-music.logo` (sound, #693), `09-sprites.logo` (sprites, #679), `05-procedures.logo`
  // (heritage, #672) and finally `10-game.logo` (interaction-events, #688) — so the real corpus
  // now has zero skips. This is the STRONGER form of the old per-profile SKIP assertion, not a
  // weaker one: it fails if any claimed profile is ever un-claimed (its example would SKIP again)
  // and equally if a future example is added that needs a profile not yet in IMPLEMENTED_PROFILES.
  // The SKIP mechanism itself stays covered by the synthetic `implementedProfiles`-override tests
  // above, which can still exercise it without depending on an unclaimed real profile.
  assert.equal(
    result.skipped,
    0,
    "no real example may SKIP once every profile its manifest declares is implemented",
  );
  assert.ok(
    !result.lines.some((line) => line.startsWith("SKIP ")),
    "no SKIP notice may remain in the real corpus report",
  );
  assert.equal(result.ran, 13);
  assert.equal(result.failed, 0);
  assert.equal(result.ok, true);
});

test("runExamplesGate: 10-game.logo RUNS and PASSES now that #688 claims interaction-events (the observable proof of the claim)", () => {
  // This is the whole point of the Interaction & Events terminal slice — and of saga #572's last
  // profile claim: claiming `interaction-events` in IMPLEMENTED_PROFILES must flip 10-game.logo
  // from SKIP to a real PASS. The example registers three `on_key` handlers, an `on_click` handler
  // that mutates `:score`, and an `every 30` timer body that repositions and stamps, then holds the
  // program open with `wait 300` — so a green PASS proves the whole registration + tick-clock
  // surface executes end to end with zero error-severity diagnostics, not merely that the names
  // parse. If this ever regressed to SKIP, the claim would be premature (a false conformance claim,
  // M4 finding F9); if it FAILed, Interaction & Events would not be conformant.
  //
  // Since issue #955 the example additionally runs with a host-input schedule, so the PASS line
  // carries the "(with host input)" marker and the claim proved here is strictly stronger: not just
  // that the handlers register and the program executes cleanly, but that they FIRE.
  const result = runExamplesGate();
  assert.ok(
    result.lines.some((line) => line === "PASS 10-game.logo (with host input)"),
    "10-game.logo must RUN and PASS (not SKIP) once interaction-events is claimed",
  );
  assert.ok(
    !result.lines.some((line) => line.startsWith("SKIP 10-game.logo")),
    "10-game.logo must no longer be skipped",
  );
});

test("runExamplesGate: 05-procedures.logo RUNS and PASSES now that #672 claims heritage (the observable proof of the claim)", () => {
  // This is the whole point of the Heritage terminal slice: claiming `heritage` in
  // IMPLEMENTED_PROFILES must flip 05-procedures.logo from SKIP to a real PASS. It uses the
  // Heritage `to … end` procedure form (`draw_tick`) alongside Core `define`/`return`, and
  // requires only `heritage` (not `data`) — now implemented — so the example executes with zero
  // error-severity diagnostics. If this ever regressed to SKIP, the claim would be premature (a
  // false conformance claim, M4 finding F9); if it FAILed, Heritage would not be conformant. A
  // green PASS here is the earned proof.
  const result = runExamplesGate();
  assert.ok(
    result.lines.some((line) => line === "PASS 05-procedures.logo"),
    "05-procedures.logo must RUN and PASS (not SKIP) once heritage is claimed",
  );
  assert.ok(
    !result.lines.some((line) => line.startsWith("SKIP 05-procedures.logo")),
    "05-procedures.logo must no longer be skipped",
  );
});

test("runExamplesGate: 11-music.logo RUNS and PASSES now that #693 claims sound (the observable proof of the claim)", () => {
  // This is the whole point of the Sound terminal slice: claiming `sound` in IMPLEMENTED_PROFILES
  // must flip 11-music.logo from SKIP to a real PASS. It requires both `sound` and `data`
  // (the `:durations[:i]` list-index), and both are now implemented — so the example executes
  // with zero error-severity diagnostics. If this ever regressed to SKIP, the claim would be
  // premature (a false conformance claim, M4 finding F9); if it FAILed, Sound would not be
  // conformant. A green PASS here is the earned proof.
  const result = runExamplesGate();
  assert.ok(
    result.lines.some((line) => line === "PASS 11-music.logo"),
    "11-music.logo must RUN and PASS (not SKIP) once sound is claimed",
  );
  assert.ok(
    !result.lines.some((line) => line.startsWith("SKIP 11-music.logo")),
    "11-music.logo must no longer be skipped",
  );
});

test("runExamplesGate: 09-sprites.logo RUNS and PASSES now that #679 claims sprites (the observable proof of the claim)", () => {
  // This is the whole point of the Sprites terminal slice: claiming `sprites` in
  // IMPLEMENTED_PROFILES must flip 09-sprites.logo from SKIP to a real PASS. The example exercises
  // `new_turtle`, a turtle list, both `ask` blocks, `tell`, and `each [ stamp ]` — so a green PASS
  // proves the whole addressed-set surface executes end to end with zero error-severity
  // diagnostics. If this ever regressed to SKIP, the claim would be premature (a false conformance
  // claim, M4 finding F9); if it FAILed, Sprites would not be conformant.
  const result = runExamplesGate();
  assert.ok(
    result.lines.some((line) => line === "PASS 09-sprites.logo"),
    "09-sprites.logo must RUN and PASS (not SKIP) once sprites is claimed",
  );
  assert.ok(
    !result.lines.some((line) => line.startsWith("SKIP 09-sprites.logo")),
    "09-sprites.logo must no longer be skipped",
  );
});

// --- CLI subprocess test (out of the loaded-module coverage set, per ADR-0009) -------------

test("the check-examples.mjs CLI prints PASS/FAIL/SKIP lines and exits non-zero on failure", () => {
  writeExample("good.logo", "forward 10\n");
  writeExample("broken.logo", "print :missing\n");
  const manifestPath = writeManifestFile({
    "good.logo": ["core-language"],
    "broken.logo": ["core-language"],
  });

  const child = spawnSync(
    process.execPath,
    [
      "scripts/check-examples.mjs",
      `--dir=${TEMP_DIR}`,
      `--manifest=${manifestPath}`,
    ],
    { encoding: "utf8" },
  );

  assert.equal(child.status, 1);
  assert.match(child.stdout, /PASS good\.logo/);
  assert.match(child.stdout, /FAIL broken\.logo/);
});

test("the check-examples.mjs CLI exits 0 when every example passes or is skipped", () => {
  writeExample("good.logo", "forward 10\n");
  const manifestPath = writeManifestFile({
    "good.logo": ["core-language"],
  });

  const cliPath = "scripts/check-examples.mjs";
  const child = spawnSync(
    process.execPath,
    [cliPath, `--dir=${TEMP_DIR}`, `--manifest=${manifestPath}`],
    { encoding: "utf8" },
  );

  assert.equal(child.status, 0);
  assert.match(child.stdout, /PASS good\.logo/);
});

// --- M5 profile skip / no-masking (issue #666) --------------------------------------------
// This slice's examples-gate scaffolding must SKIP (with a visible notice) any example that needs
// a profile not yet claimed in IMPLEMENTED_PROFILES. All four M5 profiles are now claimed by their
// terminal slices — `sound` #693 (so 11-music.logo runs), `sprites` #679 (09-sprites.logo),
// `heritage` #672 (05-procedures.logo), and `interaction-events` #688 (10-game.logo) — which
// completes M5 and empties the M5 excluded set.
// The visible-SKIP behavior is exercised by the synthetic `implementedProfiles`-override tests
// above (which no longer depend on a real unclaimed profile), the "leaves NO example skipped in the
// real corpus" test asserts the real-gate consequence, and the no-masking guard (a genuinely
// failing example still fails loudly) is covered by the existing "catches masking of the Heritage
// 'to … end' reserved word" / "masked-alias" tests. We therefore keep this slice's addition to a
// single load-light invariant to avoid re-rolling the known cross-process coverage-merge artifact
// (issue #417) on examples-gate.mjs's hot classifyExample path — see the PR body's coverage note.

test("IMPLEMENTED_PROFILES claims all four M5 profiles and still excludes every profile whose terminal slice has not landed", () => {
  for (const [profile, slice] of [
    ["sound", "#693"],
    ["sprites", "#679"],
    ["heritage", "#672"],
    ["interaction-events", "#688"],
  ]) {
    assert.ok(
      IMPLEMENTED_PROFILES.includes(profile),
      `${profile} is claimed by its terminal slice ${slice}, so its example runs rather than SKIPs`,
    );
  }
  // #688 empties the M5 excluded set, but this guard does NOT retire — an assertion that guards
  // nothing is how the next premature claim slips through. It moves to the profiles whose terminal
  // slices have not landed, so the tripwire keeps naming a real, currently-false claim. These are
  // the same three the sibling F9 guard in packages/core/src/host-metadata.test.mjs holds back;
  // both must move together, and `IMPLEMENTED_PROFILES` must never run ahead of SUPPORTED_PROFILES.
  const unclaimedProfiles = ["modules", "localization", "tutor-ai"];
  assert.ok(
    unclaimedProfiles.length > 0,
    "the F9 tripwire must always guard at least one unclaimed profile; if the DAG is ever fully claimed, replace this with an exact-set assertion rather than deleting it",
  );
  for (const profile of unclaimedProfiles) {
    assert.ok(
      !IMPLEMENTED_PROFILES.includes(profile),
      `${profile} must NOT be in IMPLEMENTED_PROFILES until its terminal slice claims it`,
    );
  }
});

// --- Host-input schedules (issue #955) -----------------------------------------------------------
//
// Executing every example with an EMPTY host made this gate structurally blind to every
// host-dependent feature the language has. Measured on the parent commit, spec/examples/10-game.logo
// produced 131 events and ZERO prints with no host, 149 events and prints 1, 2 when a host delivered
// keys and clicks — and classifyExample() reported "pass" either way, while the file itself states
// "expected output: each click prints the updated :score." (spec/examples/10-game.logo:41).

const CLICK_TWICE = {
  executeOptions: {
    hostInput: {
      events: [
        { tick: 1, kind: "click" },
        { tick: 2, kind: "click" },
      ],
    },
  },
  expect: { prints: [{ values: [1] }, { values: [2] }] },
};

const COUNTING_CLICKS = `:score = 0
on_click [
  :score = :score + 1
  print :score
]
wait 10
`;

test("classifyExample with no host-input entry runs with an empty host, exactly as before", () => {
  assert.deepEqual(classifyExample(COUNTING_CLICKS, "clicks.logo"), {
    status: "pass",
  });
});

test("classifyExample drives the run from a host-input entry and passes when the declared output appears", () => {
  assert.deepEqual(
    classifyExample(COUNTING_CLICKS, "clicks.logo", CLICK_TWICE),
    { status: "pass" },
  );
});

test("classifyExample FAILS when a handler produces nothing — the whole point: the same program passes with an empty host", () => {
  // An empty schedule delivers no click, so the entry's declared prints never happen. This is the
  // mutation check for issue #955: a gate that cannot fail when a handler does not fire asserts
  // nothing at all.
  const inert = {
    executeOptions: { hostInput: { events: [] } },
    expect: { prints: [{ values: [1] }, { values: [2] }] },
  };
  const result = classifyExample(COUNTING_CLICKS, "clicks.logo", inert);
  assert.equal(result.status, "fail");
  assert.match(result.reason, /expected prints .* but got \[\]/);
  // ...while the very same source, with no entry, still passes. That gap is the defect.
  assert.deepEqual(classifyExample(COUNTING_CLICKS, "clicks.logo"), {
    status: "pass",
  });
});

test("classifyExample asserts exact event counts for contracts a print cannot express", () => {
  const source = `on_key "up" [ forward 10 ]\nwait 10\n`;
  const entry = {
    executeOptions: {
      hostInput: { events: [{ tick: 1, kind: "key", key: "up" }] },
    },
    expect: { eventCounts: { "draw-segment": 1 } },
  };
  assert.deepEqual(classifyExample(source, "key.logo", entry), {
    status: "pass",
  });
  const undelivered = {
    executeOptions: { hostInput: { events: [] } },
    expect: { eventCounts: { "draw-segment": 1 } },
  };
  const result = classifyExample(source, "key.logo", undelivered);
  assert.equal(result.status, "fail");
  assert.match(result.reason, /expected 1 "draw-segment" event\(s\) but got 0/);
});

test("classifyExample reports an execution error ahead of any expectation mismatch", () => {
  const entry = {
    executeOptions: { hostInput: { events: [] } },
    expect: { prints: [{ values: [1] }] },
  };
  const result = classifyExample(
    "print :undefined_name\n",
    "broken.logo",
    entry,
  );
  assert.equal(result.status, "fail");
  assert.match(result.reason, /^ol-/);
});

test("validateHostInputEntry accepts a well-formed entry", () => {
  assert.equal(validateHostInputEntry("x.logo", CLICK_TWICE), null);
});

test("validateHostInputEntry accepts an optional description", () => {
  assert.equal(
    validateHostInputEntry("x.logo", { description: "why", ...CLICK_TWICE }),
    null,
  );
});

test("validateHostInputEntry rejects a non-object entry", () => {
  assert.match(validateHostInputEntry("x.logo", []), /must be an object/);
});

test("validateHostInputEntry rejects an unknown entry key", () => {
  assert.match(
    validateHostInputEntry("x.logo", { ...CLICK_TWICE, expects: {} }),
    /"expects" is not a known host-input entry key/,
  );
});

test("validateHostInputEntry requires executeOptions", () => {
  assert.match(
    validateHostInputEntry("x.logo", { expect: { prints: [] } }),
    /must declare "executeOptions"/,
  );
});

test("validateHostInputEntry delegates executeOptions to the conformance harness's own validator, so a typo cannot load clean and be silently ignored", () => {
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: { hostinput: {} },
      expect: { prints: [] },
    }),
    /is not a JSON-expressible ExecuteOptions key/,
  );
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: { hostInput: { events: [{ kind: "click" }] } },
      expect: { prints: [] },
    }),
    /tick must be a finite number/,
  );
});

const ONE_CLICK_OPTIONS = {
  hostInput: { events: [{ tick: 1, kind: "click" }] },
};

test("validateHostInputEntry rejects an entry whose schedule delivers nothing", () => {
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: { randomSeed: 1 },
      expect: { prints: [{ values: [1] }] },
    }),
    /must deliver at least one event/,
  );
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: { hostInput: { events: [] } },
      expect: { prints: [{ values: [1] }] },
    }),
    /must deliver at least one event/,
  );
});

test("validateHostInputEntry requires an expect object", () => {
  assert.match(
    validateHostInputEntry("x.logo", { executeOptions: ONE_CLICK_OPTIONS }),
    /must declare an "expect" object/,
  );
});

test("validateHostInputEntry rejects an unknown expect key", () => {
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: ONE_CLICK_OPTIONS,
      expect: { printed: [] },
    }),
    /"expect.printed" is not a known key/,
  );
});

test("validateHostInputEntry type-checks the expect fields", () => {
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: ONE_CLICK_OPTIONS,
      expect: { prints: {} },
    }),
    /"expect.prints" must be an array/,
  );
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: ONE_CLICK_OPTIONS,
      expect: { eventCounts: [] },
    }),
    /"expect.eventCounts" must be an object/,
  );
});

test("validateHostInputEntry rejects an eventCounts key that is not in the @openlogo/core registry — a misspelled kind would assert 0 forever", () => {
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: ONE_CLICK_OPTIONS,
      expect: { eventCounts: { draw_segment: 1 } },
    }),
    /is not an event kind in the @openlogo\/core registry/,
  );
  assert.equal(
    validateHostInputEntry("x.logo", {
      executeOptions: ONE_CLICK_OPTIONS,
      expect: { eventCounts: { "draw-segment": 1 } },
    }),
    null,
  );
});

test("validateHostInputEntry rejects a non-integer or negative event count", () => {
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: ONE_CLICK_OPTIONS,
      expect: { eventCounts: { print: 1.5 } },
    }),
    /must be a non-negative integer/,
  );
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: ONE_CLICK_OPTIONS,
      expect: { eventCounts: { print: -1 } },
    }),
    /must be a non-negative integer/,
  );
});

test("validateHostInputEntry rejects an entry that schedules input but asserts nothing — including an EMPTY prints array or eventCounts object, which satisfy 'declared' while asserting zero things", () => {
  for (const expect of [{}, { prints: [] }, { eventCounts: {} }]) {
    assert.match(
      validateHostInputEntry("x.logo", {
        executeOptions: ONE_CLICK_OPTIONS,
        expect,
      }),
      /must assert something/,
      `expected ${JSON.stringify(expect)} to be rejected`,
    );
  }
});

test("validateHostInputEntry rejects an entry that schedules input but asserts nothing", () => {
  assert.match(
    validateHostInputEntry("x.logo", {
      executeOptions: { hostInput: { events: [{ tick: 1, kind: "click" }] } },
      expect: {},
    }),
    /must assert something/,
  );
});

test("runExamplesGate runs a listed example with its schedule and reports the with-input count", () => {
  writeExample("clicks.logo", COUNTING_CLICKS);
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "clicks.logo": [
        "core-language",
        "turtle-rendering",
        "interaction-events",
      ],
    },
    hostInputManifest: { "clicks.logo": CLICK_TWICE },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ran, 1);
  assert.equal(result.ranWithInput, 1);
  assert.ok(result.lines.includes("PASS clicks.logo (with host input)"));
  assert.match(
    result.lines.at(-1),
    /ran 1 \(1 with a host input schedule, 0 with an empty host\)/,
  );
});

test("runExamplesGate leaves an unlisted example running with an empty host", () => {
  writeExample("plain.logo", "forward 10\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: { "plain.logo": ["core-language", "turtle-rendering"] },
    hostInputManifest: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.ranWithInput, 0);
  assert.ok(result.lines.includes("PASS plain.logo"));
  assert.match(
    result.lines.at(-1),
    /ran 1 \(0 with a host input schedule, 1 with an empty host\)/,
  );
});

test("runExamplesGate fails a listed example whose declared output does not appear", () => {
  writeExample("clicks.logo", COUNTING_CLICKS);
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "clicks.logo": [
        "core-language",
        "turtle-rendering",
        "interaction-events",
      ],
    },
    hostInputManifest: {
      "clicks.logo": {
        // One click delivered, two prints expected — a real schedule whose declared output does
        // not appear, rather than a schedule that delivers nothing (which validation now rejects).
        executeOptions: { hostInput: { events: [{ tick: 1, kind: "click" }] } },
        expect: { prints: [{ values: [1] }, { values: [2] }] },
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.match(result.lines[0], /^FAIL clicks.logo: expected prints/);
});

test("runExamplesGate fails a malformed host-input entry instead of silently ignoring it", () => {
  writeExample("clicks.logo", COUNTING_CLICKS);
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "clicks.logo": [
        "core-language",
        "turtle-rendering",
        "interaction-events",
      ],
    },
    hostInputManifest: {
      "clicks.logo": { executeOptions: ONE_CLICK_OPTIONS, expect: {} },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.ran, 0);
  assert.match(result.lines[0], /^FAIL clicks.logo: .*must assert something/);
});

test("runExamplesGate FAILS an example that registers a handler needing host delivery but has no entry — so a deleted or misspelled entry cannot silently return it to an empty host", () => {
  writeExample("clicks.logo", COUNTING_CLICKS);
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "clicks.logo": [
        "core-language",
        "turtle-rendering",
        "interaction-events",
      ],
    },
    hostInputManifest: { "clicks-typo.logo": CLICK_TWICE },
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.match(
    result.lines[0],
    /^FAIL clicks.logo: registers a handler that needs host delivery .* but has no entry/,
  );
});

test("runExamplesGate leaves a handler-free example alone: no entry required", () => {
  writeExample("plain.logo", "forward 10\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: { "plain.logo": ["core-language", "turtle-rendering"] },
    hostInputManifest: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.ranWithInput, 0);
});

test("registersHostHandlers keys on 'needs delivery', not on 'is an interaction form'", () => {
  assert.equal(registersHostHandlers("on_click [ print 1 ]"), true);
  assert.equal(registersHostHandlers('on_key "a" [ print 1 ]'), true);
  // Measured with a clock-advancing `wait` and an EMPTY host: `when "stop"` prints 0 (and 1 once a
  // host delivers `stop`), so it needs a schedule; `when "start"` prints 1 because the runtime
  // delivers it internally, and `every` prints 10 off its own tick clock. Round 2 wrongly required
  // schedules for all four heads; round 3 wrongly excluded all of `when`, reopening the hole.
  assert.equal(registersHostHandlers('when "stop" [ print 1 ]'), true);
  assert.equal(registersHostHandlers('when "acme.shake" [ print 1 ]'), true);
  assert.equal(registersHostHandlers('when "start" [ print 1 ]'), false);
  // Word values preserve case and the runtime matches the delivered word exactly, so `"START"` is
  // NOT the internally-delivered `"start"`: measured, it prints 0 under an empty host and 1 only
  // when a host delivers `START`. Round 4 case-folded here and this assertion pinned the wrong
  // answer — the third time in this slice a test asserted the behaviour it should have caught.
  assert.equal(registersHostHandlers('when "START" [ print 1 ]'), true);
  assert.equal(registersHostHandlers('when "Start" [ print 1 ]'), true);
  assert.equal(registersHostHandlers("every 10 [ print 1 ]"), false);
  assert.equal(registersHostHandlers("forward 10"), false);
  // `wait` and `input` are in the interaction table but lower to `Call`, not `ProfileStatement`,
  // and neither needs a delivered event to do its job.
  assert.equal(registersHostHandlers("wait 10"), false);
  assert.equal(registersHostHandlers('print input "name"'), false);
  // A dynamic event word cannot be classified statically, so it is treated as needing a schedule —
  // the conservative direction for a gate that exists to stop handlers going unasserted.
  assert.equal(registersHostHandlers("when :chosen [ print 1 ]"), true);
});

test("an example whose only interaction fires without a host needs no schedule", () => {
  writeExample(
    "timer.logo",
    'every 5 [ forward 1 ]\nwhen "start" [ print 1 ]\nwait 20\n',
  );
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {
      "timer.logo": ["core-language", "turtle-rendering", "interaction-events"],
    },
    hostInputManifest: {},
  });
  assert.equal(result.ok, true, result.lines.join("\n"));
  assert.equal(result.ranWithInput, 0);
});

test('a `when "stop"` example needs a schedule, and passes once it has one — the false negative round 3 found', () => {
  const manifest = {
    "stopper.logo": ["core-language", "turtle-rendering", "interaction-events"],
  };
  writeExample("stopper.logo", 'when "stop" [ print 1 ]\nwait 10\n');
  const withoutEntry = runExamplesGate({
    dir: TEMP_DIR,
    manifest,
    hostInputManifest: {},
  });
  assert.equal(withoutEntry.ok, false);
  assert.match(
    withoutEntry.lines[0],
    /^FAIL stopper.logo: registers a handler that needs host delivery/,
  );

  const withEntry = runExamplesGate({
    dir: TEMP_DIR,
    manifest,
    hostInputManifest: {
      "stopper.logo": {
        executeOptions: {
          hostInput: { events: [{ tick: 1, kind: "event", event: "stop" }] },
        },
        expect: { prints: [{ values: [1] }] },
      },
    },
  });
  assert.equal(withEntry.ok, true, withEntry.lines.join("\n"));
  assert.equal(withEntry.ranWithInput, 1);
});

test("runExamplesGate reports a malformed entry even for an example it will SKIP — entry checks are hoisted above the skip for the same anti-masking reason the under-declaration check is", () => {
  writeExample("later.logo", "challenge\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: { "later.logo": ["core-language", "tutor-ai"] },
    hostInputManifest: {
      "later.logo": { executeOptions: ONE_CLICK_OPTIONS, expect: {} },
    },
    implementedProfiles: ["core-language"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, 0);
  assert.match(result.lines[0], /^FAIL later.logo: .*must assert something/);
});

test("runExamplesGate still SKIPs an example needing an unimplemented profile when its entry is absent and it registers no handlers", () => {
  writeExample("later.logo", "challenge\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: { "later.logo": ["core-language", "tutor-ai"] },
    hostInputManifest: {},
    implementedProfiles: ["core-language"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, 1);
  assert.equal(result.ranWithInput, 0);
});

// --- The real manifests describe the real corpus -------------------------------------------------

test("loadHostInputManifest reads the real manifest and drops its _comment key", () => {
  const entries = loadHostInputManifest();
  assert.ok(!("_comment" in entries));
  assert.ok(Object.keys(entries).length > 0);
});

test("every scripts/examples-host-input.json entry names a real example and is well-formed", () => {
  const examples = new Set(
    readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".logo")),
  );
  for (const [file, entry] of Object.entries(loadHostInputManifest())) {
    assert.ok(
      examples.has(file),
      `${HOST_INPUT_PATH} names ${file}, which is not in ${EXAMPLES_DIR} — its assertions would silently stop running`,
    );
    assert.equal(validateHostInputEntry(file, entry), null);
  }
});

test("10-game.logo's interaction contract is actually asserted, and fails without the schedule", () => {
  // The regression this whole mechanism exists to prevent. With the entry's schedule the example
  // passes; with the schedule emptied — a handler that cannot fire, which is what #952 was in the
  // studio — the very same expectations fail.
  const source = readFileSync(join(EXAMPLES_DIR, "10-game.logo"), "utf8");
  const entry = loadHostInputManifest()["10-game.logo"];
  assert.deepEqual(classifyExample(source, "10-game.logo", entry), {
    status: "pass",
  });
  const inert = {
    ...entry,
    executeOptions: { ...entry.executeOptions, hostInput: { events: [] } },
  };
  const result = classifyExample(source, "10-game.logo", inert);
  assert.equal(result.status, "fail");
  assert.match(result.reason, /expected prints/);
  assert.match(result.reason, /expected 3 "turn" event\(s\) but got 1/);
  assert.match(result.reason, /expected 1 "draw-segment" event\(s\) but got 0/);
});

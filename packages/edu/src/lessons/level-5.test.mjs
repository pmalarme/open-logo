// Unit tests for the Level 5 lesson + graded exercises (issue #327): the `Lesson`/`Exercise`
// type guards, plus running every embedded OpenLogo source through `@openlogo/runtime` so a
// lesson can never drift from real execution behavior. Level 5's payoff is `define` + procedure
// REUSE, not recursion — per the maintainer's scope-trim comment on issue #327, which moves any
// recursive ("tree"/"xmas tree") exercise out to Level 6 (Geometry).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";
import * as Parser from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

const level5Lessons = OL.getLessonsByLevel("5");
const level5Exercises = OL.getExercisesByLevel("5");

// spec/educational-model.md's "Concept to command map" fixes the FIRST level each OpenLogo form is
// taught. Levels are curriculum, not profiles, so the parser accepts a later-level form inside an
// earlier lesson and the runtime runs it — the DoD only asks "does it run?". The guard below is
// what issue #399 added after a lowercase `set_xy` (Level 6) slipped into an L5 challenge. It
// classifies on the parsed AST, not on text, so it is immune to the two ways a string scan leaks:
// casing (`SET_XY` — identifiers are case-insensitive, spec/grammar.md:13, and the lexer normalizes
// them) and comments (an explanatory `# … set_xy is a Level 6 idea` never becomes a node). It also
// resolves the block-vs-list-literal `[ ]` ambiguity a regex cannot: a list is a `ListLit` node, a
// block is not.

// AST node kinds whose grammar production is first taught at Level 6 or later. Core control forms
// the concept→level map does not schedule (while, forever, for-from-to) stay Core and are absent;
// the learner-built `polygon` is an ordinary Call, not a kind.
const LATER_LEVEL_NODE_KINDS = new Set([
  "ListLit", // list literal `[ … ]` — Level 7a
  "DictLit", // dict literal `{ … }` — Level 7b
  "ValueOfKey", // dict key read — Level 7b
  "StructDef", // `struct` record declaration — Level 7c
  "Add", // `add … to` a list — Level 7a
  "Remove", // `remove … from` a list — Level 7a
  "Insert", // list insert — Level 7a
  "RemoveKey", // dict key removal — Level 7b
  "ForIn", // `for … in` — Level 7a (destructuring at 8b)
  "DestructuringBinder", // `for [:x :y] in …` — Level 8b
  "Comprehension", // `map` / `filter` / `reduce` — Level 8b
  "Stop", // `stop` (recursion control) — Level 8a
]);

// Built-in command/reporter names first taught at Level 6 or later. They share the `Call` /
// `ParenCall` node kind with every Core call, so the case-folded callee name (identifiers are
// case-insensitive) sorts them by level. The parser preserves the surface spelling and does not
// canonicalize aliases today, so every documented one-word alias of a denied command is listed
// beside its canonical spelling; among the denied commands only `set_xy`/`set_heading` have one
// (`setxy`/`seth` — spec/commands.md:1279,1296). The learner-built `polygon` is Level 5 and absent.
const LATER_LEVEL_CALL_NAMES = new Set([
  // Level 6 — derived geometry beyond the learner-built polygon
  "star",
  "circle",
  "arc",
  "grid",
  "axes",
  "measure",
  // Level 6 — turtle placement and marking (absolute); `setxy`/`seth` are the one-word aliases
  "set_xy",
  "setxy",
  "set_heading",
  "seth",
  "stamp",
  // Level 6 — number tools and math
  "mod",
  "abs",
  "int",
  "round",
  "sin",
  "cos",
  "tan",
  "sqrt",
  "power",
  "pi",
  // Level 7a — list constructor and inspectors that are calls (add/remove are their own kinds)
  "list",
  "count",
  "first",
  "last",
  "member?",
]);

/**
 * Classifies `source` against the concept→level ramp: parses it, walks the AST, and returns a short
 * description of the FIRST Level-6+ concept it contains, or null when the source stays within
 * Levels 1–5. Used both to guard the real lesson corpus and — with crafted inputs — to prove the
 * gate actually fires on later-level forms rather than merely passing an all-Core corpus.
 */
function firstLaterLevelConcept(source, label) {
  const { ast } = Parser.parse(source, label);
  let found = null;
  Parser.walk(ast, (node) => {
    if (found !== null) {
      return;
    }
    if (LATER_LEVEL_NODE_KINDS.has(node.kind)) {
      found = `the Level 6+ form "${node.kind}"`;
    } else if (node.kind === "Place" && node.segments.length > 0) {
      // A place with a postfix segment is field/index access INTO a value — `:l[i]` (7a) or `:d.k`
      // / `:p.x` and nested chains (7b/7c). A Level-3 `:name` assignment target is a zero-segment
      // place, so this fires only on access, never on a plain variable.
      found = "a Level 7+ place access (:name.field or :name[index])";
    } else if (node.kind === "IsPredicate" && node.test.form === "member-of") {
      // Worded `… is member of …` is Level 7a; `is a` / `is between` are the Level-4 predicates.
      found = 'the Level 7a "… is member of" predicate';
    } else if (
      (node.kind === "Call" || node.kind === "ParenCall") &&
      LATER_LEVEL_CALL_NAMES.has(node.callee.name.toLowerCase())
    ) {
      found = `the Level 6+ command "${node.callee.name.toLowerCase()}"`;
    }
  });
  return found;
}

/**
 * Extracts the exact source lines of `define <name> …` … `end` from `source`, matching nested
 * block openers (`repeat`/`if`/`while`/`for`/`forever`/`define`) against their `end`/`end
 * <keyword>` closers by depth, so a procedure containing a nested block (e.g. `polygon`'s
 * `repeat … end repeat`) is not mistaken for closing at that nested `end` — a plain
 * `source.indexOf("\nend", start)` would stop at the first nested terminator instead of the
 * procedure's own.
 */
function procedureBody(source, name) {
  const lines = source.split("\n");
  const headerPattern = new RegExp(`^define\\s+${name}\\b`);
  const startIndex = lines.findIndex((line) => headerPattern.test(line.trim()));
  assert.notEqual(
    startIndex,
    -1,
    `expected to find "define ${name}" in: ${source}`,
  );
  const blockOpener = /^\(?\s*(define|repeat|if|while|for|forever)\b/;
  let depth = 0;
  let endIndex = -1;
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (blockOpener.test(trimmed)) {
      depth += 1;
    }
    if (/^end\b/.test(trimmed)) {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }
  assert.notEqual(
    endIndex,
    -1,
    `expected a closing "end" for procedure ${name} in: ${source}`,
  );
  return lines.slice(startIndex, endIndex + 1).join("\n");
}

test("getLessonsByLevel('5') contains only valid, Level 5 Lessons", () => {
  assert.equal(level5Lessons.length > 0, true);
  for (const lesson of level5Lessons) {
    assert.equal(OL.isLesson(lesson), true);
    assert.equal(lesson.level, "5");
  }
});

test("getExercisesByLevel('5') contains only valid, Level 5 Exercises tied to a known lesson", () => {
  assert.equal(level5Exercises.length > 0, true);
  const lessonIds = new Set(level5Lessons.map((lesson) => lesson.id));
  for (const exercise of level5Exercises) {
    assert.equal(OL.isExercise(exercise), true);
    assert.equal(exercise.level, "5");
    assert.equal(lessonIds.has(exercise.lessonId), true);
  }
});

test("level5Exercises ramps through every difficulty exactly once per lesson", () => {
  const byLesson = new Map();
  for (const exercise of level5Exercises) {
    const difficulties = byLesson.get(exercise.lessonId) ?? [];
    difficulties.push(exercise.difficulty);
    byLesson.set(exercise.lessonId, difficulties);
  }
  for (const difficulties of byLesson.values()) {
    assert.deepEqual([...difficulties].sort(), [
      "challenge",
      "guided",
      "practice",
    ]);
  }
});

test("the objective states define/return/local and the build-polygon-from-repeat guardrail", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-polygon-procedure",
  );
  assert.ok(lesson);
  assert.equal(
    lesson.objective.includes("define … end names a reusable procedure"),
    true,
  );
  assert.equal(
    lesson.objective.includes("local (a procedure's own private variable)"),
    true,
  );
  assert.equal(
    lesson.objective.includes(
      "Learners build polygon from repeat; it is never introduced as a black-box drawing trick",
    ),
    true,
  );
});

test("the objective mentions Heritage to … end / output only in prose, taught second", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-polygon-procedure",
  );
  assert.ok(lesson);
  assert.equal(
    lesson.objective.includes(
      "Heritage spellings to … end and output are recognized, but define and return are taught first",
    ),
    true,
  );
});

test("the first worked example matches spec/educational-model.md's polygon-from-repeat program verbatim", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-polygon-procedure",
  );
  assert.ok(lesson);
  assert.equal(
    lesson.workedExamples[0].source,
    [
      "# why: polygon is the side-and-turn pattern with names for the parts",
      "define polygon :sides :size",
      "  repeat :sides",
      "    forward :size",
      "    right 360 / :sides",
      "  end repeat",
      "end",
      "",
      "# why: five sides need five equal turns that add to a full turn",
      "polygon 5 60",
    ].join("\n"),
  );
});

test("the second worked example matches spec/educational-model.md's double reporter program verbatim", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-polygon-procedure",
  );
  assert.ok(lesson);
  assert.equal(
    lesson.workedExamples[1].source,
    [
      "# why: a reporter can answer a question for another instruction",
      "define double :n",
      "  return :n * 2",
      "end",
      "",
      "forward double 40",
    ].join("\n"),
  );
});

test("no Level 5 content uses a Level 6+ concept (list/dict literal, for-in, map/filter/reduce) or a recursive procedure call", () => {
  const forbidden = [
    /\[[^\]]*\]/, // list literal
    /\{[^}]*:[^}]*\}/, // dict literal
    /\bfor\b.*\bin\b/,
    /\bmap\b|\bfilter\b|\breduce\b/,
  ];
  const sources = [
    ...level5Lessons.flatMap((lesson) =>
      lesson.workedExamples.map((example) => example.source),
    ),
    ...level5Exercises.map((exercise) => exercise.referenceSolution.source),
  ];
  for (const source of sources) {
    for (const pattern of forbidden) {
      assert.equal(
        pattern.test(source),
        false,
        `found forbidden pattern ${pattern} in: ${source}`,
      );
    }
  }
});

test("no Level 5 content defines a procedure that calls itself (no recursion — deferred to Level 6)", () => {
  const sources = [
    ...level5Lessons.flatMap((lesson) =>
      lesson.workedExamples.map((example) => example.source),
    ),
    ...level5Exercises.map((exercise) => exercise.referenceSolution.source),
  ];
  for (const source of sources) {
    const defineMatches = [
      ...source.matchAll(/^define\s+([a-z_][a-z0-9_]*)/gim),
    ];
    for (const match of defineMatches) {
      const name = match[1];
      const body = procedureBody(source, name);
      const selfCallPattern = new RegExp(`\\b${name}\\b`, "g");
      const occurrences = body.match(selfCallPattern);
      assert.ok(occurrences);
      // Exactly one occurrence: the `define <name>` header itself. Any more means the
      // procedure's own body calls itself, i.e. recursion — out of scope for this slice.
      assert.equal(
        occurrences.length,
        1,
        `procedure ${name} appears to call itself (recursion) in: ${source}`,
      );
    }
  }
});

test("no Level 1–5 lesson or exercise source uses a Level 6+ concept — the concept→level ramp holds", () => {
  for (const level of ["1", "2", "3", "4", "5"]) {
    const sources = [
      ...OL.getLessonsByLevel(level).flatMap((lesson) =>
        lesson.workedExamples.map((example) => example.source),
      ),
      ...OL.getExercisesByLevel(level).map(
        (exercise) => exercise.referenceSolution.source,
      ),
    ];
    for (const source of sources) {
      const concept = firstLaterLevelConcept(source, `level-${level}`);
      assert.equal(
        concept,
        null,
        `Level ${level} content uses ${concept}: ${source}`,
      );
    }
  }
});

test("the concept→level gate flags every Level 6+ form, command, alias, and access — including the casing and list-literal bypasses a text scan misses", () => {
  // Crafted later-level sources: each must be classified as containing a Level 6+ concept. This is
  // what proves the gate above actually fires — an all-Core corpus alone would pass a gate that
  // detected nothing. It deliberately includes the exact bypasses a string scan leaks through: an
  // uppercase `SET_XY` (identifiers are case-insensitive) and a `[ 30 50 ]` list literal (which a
  // regex cannot tell from a Level-2 block), plus the `setxy`/`seth` one-word Heritage aliases.
  const laterLevelSamples = [
    "set_xy 120 0", // the original regression: Level 6 placement …
    "SET_XY 120 0", // … caught case-insensitively (a string scan would miss this)
    "setxy 120 0", // … and through its one-word Heritage alias
    "set_heading 0", // Level 6 absolute heading …
    "seth 0", // … and its alias
    "stamp", // Level 6 marking
    "print sin 30", // Level 6 math
    ":steps = [ 30 50 ]", // Level 7a list literal (a block-vs-list case a regex cannot resolve)
    "print :items[ 1 ]", // Level 7a list index …
    "print :ITEMS[ 1 ]", // … case-insensitively
    ":d = { name: 1 }", // Level 7b dict literal
    "print :person.age", // Level 7b/7c field access
    "struct Point [ x y ]", // Level 7c record declaration
    ":doubled = map n in :nums [ :n ]", // Level 8b comprehension
    "for [:x :y] in :points\n  print :x\nend for", // Level 8b destructuring for-in
    "if :x is member of [ 1 2 ] [ print :x ]", // Level 7a worded membership
    "add 1 to :xs", // Level 7a list mutation
    "remove 1 from :xs", // Level 7a list mutation
  ];
  for (const source of laterLevelSamples) {
    assert.notEqual(
      firstLaterLevelConcept(source, "later-level-sample"),
      null,
      `expected the gate to flag a Level 6+ concept in: ${source}`,
    );
  }
});

test("the concept→level gate passes Core Level 1–5 forms — no false positives on procedures, blocks, bare places, decimals, learner-built polygon, or Level-4 predicates", () => {
  // Core sources that must stay clean, exercising the shapes closest to a later-level form: a bare
  // `:name` assignment is a zero-segment place (not access), a decimal has a `.` that is not field
  // access, the learner-built `polygon` is an ordinary Level-5 call, and `is a` is a Level-4 worded
  // predicate (not `is member of`).
  const coreSamples = [
    "forward 100",
    "repeat 4 [ forward 50 right 90 ]",
    "if :x > 0 [ forward 10 ] else [ back 10 ]",
    "define square :size\n  repeat 4 [ forward :size right 90 ]\nend",
    ":count = 0",
    "set count to 5",
    "forward 1.5",
    "define polygon :n :len\n  repeat :n [ forward :len right 360 / :n ]\nend\npolygon 5 100",
    'if :x is a "number" [ print :x ]',
    "print :size",
    "home",
  ];
  for (const source of coreSamples) {
    assert.equal(
      firstLaterLevelConcept(source, "core-sample"),
      null,
      `expected no Level 6+ concept in Core source: ${source}`,
    );
  }
});

test("no executable Heritage to … end or output source is present (Heritage may only be mentioned in prose)", () => {
  const sources = [
    ...level5Lessons.flatMap((lesson) =>
      lesson.workedExamples.map((example) => example.source),
    ),
    ...level5Exercises.map((exercise) => exercise.referenceSolution.source),
  ];
  const headerPattern = /^\s*to\s+[a-z_]/im;
  for (const source of sources) {
    assert.equal(
      headerPattern.test(source),
      false,
      `found an executable Heritage 'to' procedure header in: ${source}`,
    );
    assert.equal(/\boutput\b/.test(source), false);
  }
});

test("the guided exercise changes exactly one line (polygon 5 60 to polygon 6 50) from the lesson's first worked example", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-polygon-procedure",
  );
  const guided = level5Exercises.find(
    (item) => item.id === "l5-polygon-hexagon",
  );
  assert.ok(lesson);
  assert.ok(guided);
  const baseLines = lesson.workedExamples[0].source.split("\n");
  const guidedLines = guided.referenceSolution.source.split("\n");
  assert.equal(baseLines.length, guidedLines.length);
  const changedLines = baseLines
    .map((line, index) => [line, guidedLines[index]])
    .filter(([before, after]) => before !== after);
  assert.equal(changedLines.length, 1);
  assert.deepEqual(changedLines[0], ["polygon 5 60", "polygon 6 50"]);
});

test("the practice exercise defines triangle by calling polygon (procedure reuse), not by repeating forward/right itself", () => {
  const practice = level5Exercises.find(
    (item) => item.id === "l5-triangle-calls-polygon",
  );
  assert.ok(practice);
  const source = practice.referenceSolution.source;
  assert.equal(/define triangle :size/.test(source), true);
  assert.equal(/polygon 3 :size/.test(source), true);
  // triangle's own body must not repeat forward/right — it must reuse polygon instead.
  const triangleBody = procedureBody(source, "triangle");
  assert.equal(/\bpolygon 3 :size\b/.test(triangleBody), true);
  assert.equal(/forward|right|repeat/.test(triangleBody), false);
});

test("the challenge exercise reuses house by calling it exactly twice, composed from polygon and triangle", () => {
  const challenge = level5Exercises.find(
    (item) => item.id === "l5-street-of-houses",
  );
  assert.ok(challenge);
  const source = challenge.referenceSolution.source;
  assert.equal(/define polygon :sides :size/.test(source), true);
  assert.equal(/define triangle :size/.test(source), true);
  assert.equal(/define house :size/.test(source), true);
  // Verify the exact reuse chain, not just that all three names are defined somewhere: house's
  // own body must call polygon 4 :size (the square body) and triangle :size (the roof); triangle's
  // own body must call polygon 3 :size — matching spec/examples/06-geometry.logo's chain.
  const houseBody = procedureBody(source, "house");
  assert.equal(/\bpolygon 4 :size\b/.test(houseBody), true);
  assert.equal(/\btriangle :size\b/.test(houseBody), true);
  const triangleBody = procedureBody(source, "triangle");
  assert.equal(/\bpolygon 3 :size\b/.test(triangleBody), true);
  const houseCallMatches = source.match(/^house 70$/gm);
  assert.ok(houseCallMatches);
  assert.equal(houseCallMatches.length, 2);
  // Reposition between the two houses with relative movement only — never set_xy/set_heading,
  // which name an absolute coordinate/heading and are a Level 6 concept (issue #399,
  // spec/educational-model.md's concept→level table). Strip comments first: the source's own
  // "# … set_xy is a Level 6 idea" note explains what to avoid and must not trip the gate. The
  // pen is lifted and lowered so the repositioning move draws nothing.
  const code = source
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
  assert.equal(/\bset_xy\b/.test(code), false);
  assert.equal(/\bset_heading\b/.test(code), false);
  assert.equal(/\bstamp\b/.test(code), false);
  assert.equal(/\bpen_up\b/.test(code), true);
  assert.equal(/\bpen_down\b/.test(code), true);
});

test("every Level 5 worked example parses and runs with no diagnostics", () => {
  for (const lesson of level5Lessons) {
    for (const example of lesson.workedExamples) {
      const result = execute(example.source, `${lesson.id}.logo`);
      assert.deepEqual(
        result.diagnostics,
        [],
        `${lesson.id} worked example raised diagnostics: ${JSON.stringify(result.diagnostics)}`,
      );
    }
  }
});

test("every Level 5 exercise reference solution parses and runs with no diagnostics", () => {
  for (const exercise of level5Exercises) {
    const result = execute(
      exercise.referenceSolution.source,
      `${exercise.id}.logo`,
    );
    assert.deepEqual(
      result.diagnostics,
      [],
      `${exercise.id} reference solution raised diagnostics: ${JSON.stringify(result.diagnostics)}`,
    );
  }
});

test("l5-polygon-hexagon draws a 6-sided polygon (6 moves, 6 turns)", () => {
  const exercise = level5Exercises.find(
    (item) => item.id === "l5-polygon-hexagon",
  );
  assert.ok(exercise);
  const result = execute(exercise.referenceSolution.source, "hexagon.logo");
  const moves = result.events.filter((event) => event.kind === "move");
  assert.equal(moves.length, 6);
});

test("l5-triangle-calls-polygon draws a 3-sided shape via polygon reuse (3 moves, one procedure-enter per call)", () => {
  const exercise = level5Exercises.find(
    (item) => item.id === "l5-triangle-calls-polygon",
  );
  assert.ok(exercise);
  const result = execute(
    exercise.referenceSolution.source,
    "triangle-calls-polygon.logo",
  );
  const moves = result.events.filter((event) => event.kind === "move");
  assert.equal(moves.length, 3);
  const procedureEnters = result.events.filter(
    (event) => event.kind === "procedure-enter",
  );
  // triangle 70 enters triangle once, then polygon once — two enters total, no recursion.
  assert.equal(procedureEnters.length, 2);
});

test("l5-street-of-houses draws exactly two complete houses (7 drawn segments each) with a finite, non-recursive call tree", () => {
  const exercise = level5Exercises.find(
    (item) => item.id === "l5-street-of-houses",
  );
  assert.ok(exercise);
  const result = execute(
    exercise.referenceSolution.source,
    "street-of-houses.logo",
  );
  const drawSegments = result.events.filter(
    (event) => event.kind === "draw-segment",
  );
  // Each house draws a 4-sided square body plus a 3-sided triangular roof: 7 segments; two
  // houses draw 14 segments total.
  assert.equal(drawSegments.length, 14);
  const procedureEnters = result.events.filter(
    (event) => event.kind === "procedure-enter",
  );
  // Per house: house + polygon (for the body) + triangle + polygon (inside triangle) = 4 enters;
  // two houses = 8 enters total — finite, confirming no recursive self-call blew this up.
  assert.equal(procedureEnters.length, 8);
});

test("the reporter worked examples (double :n) both return 80 for double 40 / 42 for double 21", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-polygon-procedure",
  );
  assert.ok(lesson);
  const reporterExample = lesson.workedExamples[1];
  const result = execute(reporterExample.source, "double-reporter.logo");
  const moves = result.events.filter((event) => event.kind === "move");
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].payload.to, [0, 80]);

  const localExample = lesson.workedExamples[2];
  const localResult = execute(localExample.source, "double-local.logo");
  const prints = localResult.events.filter((event) => event.kind === "print");
  assert.equal(prints.length, 1);
  assert.deepEqual(prints[0].payload.values, [42]);
});

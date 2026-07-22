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

test("no Level 1–5 content uses a Level 6+ concept — the concept→level ramp holds (AST-classified)", () => {
  // spec/educational-model.md's "Concept to command map" fixes the FIRST level each OpenLogo form
  // is taught. Levels are curriculum, not profiles, so the parser happily accepts a later-level
  // form inside an earlier lesson and the runtime happily runs it — the DoD only asks "does it
  // run?". This gate is what issue #399 added after a lowercase `set_xy` (Level 6) slipped past
  // that check into an L5 challenge. We classify by parsing each Level 1–5 source and walking the
  // AST rather than scanning text, so the guard is immune to the two ways a string scan leaks:
  //   - casing — `SET_XY` / `:ITEMS[1]` — because keywords and identifiers are case-insensitive
  //     (spec/grammar.md:13) and the lexer normalizes them before we ever see the node; and
  //   - comments — an explanatory `# … set_xy is a Level 6 idea` never becomes a node because the
  //     lexer drops `#…` comments.
  // It also removes the block-vs-list-literal `[ ]` ambiguity a regex cannot resolve: a list is a
  // `ListLit` node, a block is a `Block` node.

  // AST node kinds whose grammar production is first taught at Level 6 or later. Core control
  // forms that the concept→level map does not schedule (while, forever, for-from-to) are left to
  // Core and intentionally absent; the learner-built `polygon` is an ordinary Call, not a kind.
  const laterNodeKinds = new Set([
    "ListLit", // list literal `[ … ]` — Level 7a
    "DictLit", // dict literal `{ … }` — Level 7b
    "ValueOfKey", // dict key read — Level 7b
    "StructDef", // `struct` record declaration — Level 7c
    "Add", // `add … to` a list — Level 7a
    "Remove", // `remove … from` a list — Level 7a
    "Insert", // list insert — Level 7a
    "RemoveKey", // dict key removal — Level 7b
    "ForIn", // `for … in` — Level 7a (and destructuring at 8b)
    "DestructuringBinder", // `for [:x :y] in …` — Level 8b
    "Comprehension", // `map` / `filter` / `reduce` — Level 8b
    "Stop", // `stop` (recursion control) — Level 8a
  ]);

  // Built-in command/reporter names first taught at Level 6 or later. These share the `Call` /
  // `ParenCall` node kind with every Core call, so the callee name — canonicalized (so a Heritage
  // alias resolves to its Core spelling) and case-folded — is what sorts them by level. The
  // learner-built `polygon` is Level 5 and intentionally absent.
  const laterCallNames = new Set([
    // Level 6 — derived geometry beyond the learner-built polygon
    "star",
    "circle",
    "arc",
    "grid",
    "axes",
    "measure",
    // Level 6 — turtle placement and marking (absolute)
    "set_xy",
    "set_heading",
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
      const { ast } = Parser.parse(source, `level-${level}`);
      Parser.walk(ast, (node) => {
        assert.equal(
          laterNodeKinds.has(node.kind),
          false,
          `Level ${level} content uses the Level 6+ form "${node.kind}" (not taught until Level 6+): ${source}`,
        );
        // A place with any postfix segment is field/index access INTO a value — list index `:l[i]`
        // (Level 7a) or dict/record field `:d.k` / `:p.x` and nested chains (Level 7b/7c). A plain
        // Level-3 `:name` assignment target is a zero-segment place, so this only fires on access.
        assert.equal(
          node.kind === "Place" && node.segments.length > 0,
          false,
          `Level ${level} content uses a Level 7+ place access (:name.field or :name[index]): ${source}`,
        );
        // The worded `… is member of …` predicate is Level 7a; the other IsPredicate forms
        // (`is a`, `is between`) are the Level-4 worded predicates and stay allowed.
        assert.equal(
          node.kind === "IsPredicate" && node.test.form === "member-of",
          false,
          `Level ${level} content uses the Level 7a "… is member of" predicate: ${source}`,
        );
        if (node.kind === "Call" || node.kind === "ParenCall") {
          const name = (node.canonical ?? node.callee.name).toLowerCase();
          assert.equal(
            laterCallNames.has(name),
            false,
            `Level ${level} content calls the Level 6+ command "${name}" (not taught until Level 6+): ${source}`,
          );
        }
      });
    }
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

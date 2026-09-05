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
// (`setxy`/`seth` — spec/commands.md:1300,1317). The learner-built `polygon` is Level 5 and absent.
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

/**
 * The straight-line distance of every `move` event in `result`, in order — the measured side
 * lengths a drawing actually produced. Lesson explanations state these as plain numbers ("20,
 * 30, 40, 50, 60, 70"), which nothing else in the pipeline checks, so the tests compare against
 * this rather than trusting the prose.
 */
function sideLengths(result) {
  return result.events
    .filter((event) => event.kind === "move")
    .map((event) => {
      const [fromX, fromY] = event.payload.from;
      const [toX, toY] = event.payload.to;
      return Math.round(Math.hypot(toX - fromX, toY - fromY) * 1e6) / 1e6;
    });
}

/** Every `print` event's values in `result`, in order — one array per `print`. */
function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values);
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

test("the objective states define/return/the procedure boundary and the build-polygon-from-repeat guardrail", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-polygon-procedure",
  );
  assert.ok(lesson);
  assert.equal(
    lesson.objective.includes("define … end names a reusable procedure"),
    true,
  );
  // Issue #829: under saga #819's ruling privacy is automatic, so this level no longer sells
  // `local` as the thing that creates it. The objective must carry the maintainer's own
  // formulation from issue #821 instead — #829's comment asks for that wording rather than a
  // paraphrase of the normative text, because it was written to be teachable.
  assert.equal(
    lesson.objective.includes("define … end is a boundary"),
    true,
    "the objective must state the boundary in the maintainer's wording",
  );
  assert.equal(
    lesson.objective.includes(
      "inputs are yours — change them freely, the caller never sees it",
    ),
    true,
    "the objective must carry the maintainer's second line",
  );
  assert.equal(
    lesson.objective.includes(
      "Learners build polygon from repeat; it is never introduced as a black-box drawing trick",
    ),
    true,
  );
});

// Issue #829's headline consequence for this level, pinned so a later edit cannot quietly
// reintroduce it. `local` survives the ruling as a way to shadow a name that is already visible
// (`spec/execution-model.md:501-506`), which is only meaningful after a learner has met `global`
// — so no Level 5 program may use it, and no learner-facing Level 5 string may name it. The
// scan covers the whole level, both lessons, not just the one that used to carry it.
test("no Level 5 content teaches local — privacy is automatic under the scoping ruling", () => {
  const learnerStrings = [
    ...level5Lessons.flatMap((lesson) => [
      lesson.title,
      lesson.objective,
      lesson.exercisePrompt,
      ...lesson.workedExamples.flatMap((example) => [
        example.source,
        example.explanation,
      ]),
    ]),
    ...level5Exercises.flatMap((exercise) => [
      exercise.prompt,
      exercise.referenceSolution.source,
      exercise.referenceSolution.explanation,
    ]),
  ];
  for (const text of learnerStrings) {
    assert.equal(
      /\blocal\b/i.test(text),
      false,
      `Level 5 still mentions local: ${text}`,
    );
  }
});

// Round 1 (rubber-duck, blocking): #829's comment asks for the maintainer's four-line
// formulation recorded on issue #821 to be the lesson text rather than a paraphrase of the
// normative wording, because it was written to be teachable — no jargon, no exceptions. Three of
// the four lines apply at this level; the fourth is about lists and dicts, which are Level 7a/7b,
// and its deliberate deferral is recorded in level-5.ts's module comment. This pins the three.
test("the maintainer's formulation reaches the learner in its own words, not paraphrased", () => {
  const learnerText = level5Lessons
    .flatMap((lesson) => [
      lesson.objective,
      lesson.exercisePrompt,
      ...lesson.workedExamples.map((example) => example.explanation),
    ])
    .join("\n")
    .toLowerCase();

  for (const line of [
    "define … end is a boundary",
    "inputs are yours — change them freely, the caller never sees it",
    "global is shared — that's what makes it writable from inside",
  ]) {
    assert.equal(
      learnerText.includes(line),
      true,
      `the maintainer's line is missing from Level 5: "${line}"`,
    );
  }
});

// Round 1 (rubber-duck, blocking): "shared with every procedure" is broader than the contract.
// `spec/execution-model.md:585-590` scopes a `global` to the procedures declared in the same
// document — `import` shares procedures and alias declarations, never variables. Level 5 learners
// write one document, so the accurate claim is about *this program*, and the unqualified
// universal must not come back.
test("no Level 5 string claims a global is shared with every procedure everywhere", () => {
  const learnerStrings = level5Lessons.flatMap((lesson) => [
    lesson.title,
    lesson.objective,
    lesson.exercisePrompt,
    ...lesson.workedExamples.map((example) => example.explanation),
  ]);
  for (const text of learnerStrings) {
    assert.equal(
      /every procedure\b(?! in this program)/i.test(text),
      false,
      `a global's reach must be qualified to this program: ${text}`,
    );
  }
});

test("no learner-facing L5 string names Heritage spellings, Level 6, or absolute placement (issue #436)", () => {
  const learnerStrings = level5Lessons.flatMap((lesson) => [
    lesson.objective,
    lesson.exercisePrompt,
    ...lesson.workedExamples.map((example) => example.explanation),
  ]);
  assert.equal(learnerStrings.length > 0, true);
  learnerStrings.push(
    ...level5Exercises.flatMap((exercise) => [
      exercise.prompt,
      exercise.referenceSolution.source,
      exercise.referenceSolution.explanation,
    ]),
  );

  const bannedPatterns = [
    /heritage/i,
    /\bto\s*…\s*end\b/i,
    /\boutput\b/,
    /level\s*6/i,
    /absolute[- ]placement/i,
    /absolute\s+heading/i,
  ];

  for (const text of learnerStrings) {
    for (const pattern of bannedPatterns) {
      assert.equal(
        pattern.test(text),
        false,
        `found banned pattern ${pattern} in learner-facing text: ${text}`,
      );
    }
  }
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
  // regex cannot tell from a Level-2 block), plus the `setxy`/`seth` one-word Turtle & Rendering
  // short aliases (spec/commands.md:14 — short aliases of the canonical names, not Heritage).
  const laterLevelSamples = [
    "set_xy 120 0", // the original regression: Level 6 placement …
    "SET_XY 120 0", // … caught case-insensitively (a string scan would miss this)
    "setxy 120 0", // … and through its one-word short alias
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

test("the reporter worked example (double :n) returns 80 for double 40, and the boundary examples measure both halves of the seal", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-polygon-procedure",
  );
  assert.ok(lesson);
  const reporterExample = lesson.workedExamples[1];
  const result = execute(reporterExample.source, "double-reporter.logo");
  const moves = result.events.filter((event) => event.kind === "move");
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].payload.to, [0, 80]);

  // Issue #829 / saga #819: the names a procedure sets are its own, so the same spelling inside
  // and outside `show_double` is two variables. 42 then 5 is the claim the explanation makes.
  const privacyExample = lesson.workedExamples[2];
  const privacyResult = execute(privacyExample.source, "show-double.logo");
  assert.deepEqual(privacyResult.diagnostics, []);
  assert.deepEqual(printedValues(privacyResult), [[42], [5]]);

  // The other half of the boundary (`spec/execution-model.md:471-474`): rebinding a parameter
  // never escapes, so an input really is the procedure's to change. 107 then 7.
  const inputExample = lesson.workedExamples[3];
  const inputResult = execute(inputExample.source, "input-is-yours.logo");
  assert.deepEqual(inputResult.diagnostics, []);
  assert.deepEqual(printedValues(inputResult), [[107], [7]]);
});

// Round 1 (@ai-tutor B1): worked example 3 teaches that a write inside a procedure makes the
// procedure's own name, and the `global` lesson then shows a write inside a procedure FAILING.
// Both are true, and the rule that reconciles them is the write/read asymmetry — so the lesson
// now states it, and the statement is measured here in both directions rather than asserted.
test("the write/read asymmetry worked example 3 states is real in both directions", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-polygon-procedure",
  );
  assert.ok(lesson);
  const source = lesson.workedExamples[2].source;
  assert.equal(source.includes(":answer = :n * 2"), true);

  // Writing only: legal, and creates the procedure's own binding.
  assert.deepEqual(execute(source, "write-only.logo").diagnostics, []);

  // Reading first: exactly the edit the explanation names, and it must stop the program.
  const readsFirst = source.replace(
    ":answer = :n * 2",
    ":answer = :answer + 1",
  );
  assert.notEqual(readsFirst, source, "the asymmetry edit did not apply");
  const blocked = execute(readsFirst, "reads-first.logo");
  assert.equal(blocked.diagnostics.length, 1);
  assert.equal(blocked.diagnostics[0].code, "ol-var-not-visible");
  assert.equal(blocked.diagnostics[0].message.includes("show_double"), true);
  assert.deepEqual(printedValues(blocked), []);
});

// The `global` lesson (issue #829). Every number its explanations promise a learner is measured
// here, including the sequence of side lengths, because a "20, 30, 40, 50, 60, 70" written in
// prose is exactly the kind of derived claim nothing else in the pipeline checks.
test("l5-global-shared-value's worked examples print and draw what they promise", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-global-shared-value",
  );
  assert.ok(lesson);
  assert.equal(lesson.workedExamples.length, 2);

  const counter = execute(lesson.workedExamples[0].source, "global-bump.logo");
  assert.deepEqual(counter.diagnostics, []);
  assert.deepEqual(printedValues(counter), [[2]]);

  const steps = execute(lesson.workedExamples[1].source, "global-step.logo");
  assert.deepEqual(steps.diagnostics, []);
  assert.deepEqual(sideLengths(steps), [20, 30, 40, 50, 60, 70]);

  // "take the sharing away and every call would draw the same 20-step side" — the claim that
  // makes `global` visible in the drawing rather than only in a printed number.
  const shared = lesson.workedExamples[1].source;
  assert.equal(shared.includes("global side = 20"), true);
  const unshared = shared.replace(
    "global side = 20\ndefine step\n  forward :side",
    "define step\n  :side = 20\n  forward :side",
  );
  assert.notEqual(unshared, shared, "the unshared edit did not apply");
  const flat = execute(unshared, "global-step-unshared.logo");
  assert.deepEqual(flat.diagnostics, []);
  assert.deepEqual(sideLengths(flat), [20, 20, 20, 20, 20, 20]);
});

// The claim the first `global` explanation makes about the *broken* program a learner is told to
// try: it prints nothing at all and OpenLogo names the procedure, the rule, and the fix. The
// lesson corpus itself must stay statically clean (built-in-names.test.mjs and
// scoping-audit.test.mjs both assert that), so the broken variant is built here rather than
// shipped as a worked example — and it is built by editing the lesson's own source, so it cannot
// drift from the program the learner is shown. Round 1 (rubber-duck) found the earlier version
// asserting only the code plus two substrings, which would have stayed green if execution had
// continued or the quoted sentence had changed; the lesson quotes the message verbatim, so the
// whole quoted string is pinned.
test("dropping the global declaration stops the program with the message the lesson quotes", () => {
  const lesson = level5Lessons.find(
    (item) => item.id === "l5-global-shared-value",
  );
  assert.ok(lesson);
  const shared = lesson.workedExamples[0].source;
  assert.equal(shared.includes("global count = 0"), true);
  const withoutGlobal = shared.replace("global count = 0", ":count = 0");
  assert.notEqual(
    withoutGlobal,
    shared,
    "the counterfactual edit did not apply",
  );

  const result = execute(withoutGlobal, "global-bump-broken.logo");
  assert.equal(result.diagnostics.length, 1);
  const boundary = result.diagnostics[0];
  assert.equal(boundary.code, "ol-var-not-visible");

  // "it prints nothing at all" — the program stops, it does not carry on with a wrong number.
  assert.deepEqual(printedValues(result), []);

  // The lesson quotes the message inside its explanation; that quote must be the real one.
  const quoted =
    ":count is not defined inside bump. a procedure only sees its own inputs, the names it sets itself, and names declared global. the fix is one word at the top level: write global count = (its starting value).";
  assert.equal(boundary.message, quoted);
  assert.equal(
    lesson.workedExamples[0].explanation.includes(quoted),
    true,
    "the lesson's quoted diagnostic has drifted from the real message",
  );
});

test("l5-global-share-a-count shares the count, still closes the square, and is a one-line fix", () => {
  const exercise = level5Exercises.find(
    (item) => item.id === "l5-global-share-a-count",
  );
  assert.ok(exercise);
  const source = exercise.referenceSolution.source;
  assert.equal(source.includes("global drawn = 0"), true);

  const result = execute(source, "global-share-a-count.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[4]]);
  assert.deepEqual(sideLengths(result), [60, 60, 60, 60]);

  // "the drawing is unchanged" — four sides and four right angles bring the turtle home.
  const moves = result.events.filter((event) => event.kind === "move");
  const [endX, endY] = moves[moves.length - 1].payload.to;
  assert.ok(Math.hypot(endX, endY) < 1e-6);

  // Round 1 (@testing findings 1 and 2): the old assertion counted differing lines between the
  // fixed source and a one-line replacement of it, which is tautologically 1 and could never
  // fail. What the prompt actually claims is behavioural — that the program it describes STOPS
  // with a named diagnostic, and that `global` is the whole repair — so that is what is measured.
  const plain = source.replace("global drawn = 0", ":drawn = 0");
  assert.notEqual(plain, source, "the prompt's starting program was not built");
  const broken = execute(plain, "share-a-count-broken.logo");
  assert.equal(broken.diagnostics.length, 1);
  assert.equal(broken.diagnostics[0].code, "ol-var-not-visible");
  assert.equal(
    broken.diagnostics[0].message.startsWith(
      ":drawn is not defined inside draw_side.",
    ),
    true,
  );
  assert.deepEqual(printedValues(broken), []);
  // The prompt quotes that first clause; keep the two from drifting apart.
  assert.equal(
    exercise.prompt.includes(":drawn is not defined inside draw_side"),
    true,
  );
});

test("l5-global-total-of-inputs keeps per-call inputs separate while sharing one total", () => {
  const exercise = level5Exercises.find(
    (item) => item.id === "l5-global-total-of-inputs",
  );
  assert.ok(exercise);
  const result = execute(
    exercise.referenceSolution.source,
    "global-total-of-inputs.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(sideLengths(result), [30, 50, 70, 90]);
  assert.deepEqual(printedValues(result), [[30 + 50 + 70 + 90]]);
});

test("l5-global-staircase grows its steps from the shared name, not from its input", () => {
  const exercise = level5Exercises.find(
    (item) => item.id === "l5-global-staircase",
  );
  assert.ok(exercise);
  const source = exercise.referenceSolution.source;
  const result = execute(source, "staircase.logo");
  assert.deepEqual(result.diagnostics, []);

  // Four calls, each a rise then the 40-step tread it was handed. The rises grow although every
  // call is written `stair 40` — which is the whole point of the exercise.
  assert.deepEqual(sideLengths(result), [20, 40, 30, 40, 40, 40, 50, 40]);
  assert.deepEqual(printedValues(result), [[60]]);
  const calls = source
    .split("\n")
    .filter((line) => line.trim().startsWith("stair "));
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map((line) => line.trim())).size, 1);

  // "the steps stack, climbing to the right": every step ends higher and further right than it
  // started, which is the shape claim the explanation makes and a length list cannot prove.
  const moves = result.events.filter((event) => event.kind === "move");
  const [startX, startY] = moves[0].payload.from;
  for (let step = 0; step < 4; step += 1) {
    const [beforeX, beforeY] = moves[step * 2].payload.from;
    const [afterX, afterY] = moves[step * 2 + 1].payload.to;
    assert.ok(afterY > beforeY, `step ${step} did not rise`);
    assert.ok(afterX > beforeX, `step ${step} did not move right`);
  }
  const [endX, endY] = moves[moves.length - 1].payload.to;
  assert.ok(Math.abs(endY - startY - (20 + 30 + 40 + 50)) < 1e-6);
  assert.ok(Math.abs(endX - startX - 4 * 40) < 1e-6);

  // Without the shared growth every step would be identical — the drawing, not just a printed
  // number, is what `global` is buying here. And the program cannot even report the height: a
  // name the procedure sets belongs to the procedure, so the top-level `print :rise` has nothing
  // to read. Both halves are asserted, because either alone understates what `global` does.
  const unshared = source.replace(
    "global rise = 20\ndefine stair :tread\n  forward :rise",
    "define stair :tread\n  :rise = 20\n  forward :rise",
  );
  assert.notEqual(unshared, source, "the unshared edit did not apply");
  const flat = execute(unshared, "staircase-unshared.logo");
  assert.deepEqual(sideLengths(flat), [20, 40, 20, 40, 20, 40, 20, 40]);
  assert.deepEqual(printedValues(flat), []);
  assert.equal(flat.diagnostics.length, 1);
  assert.equal(flat.diagnostics[0].code, "ol-undefined-var");
});

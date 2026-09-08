// The curriculum scoping audit (issue #829, saga #819's ruling).
//
// Two of #829's Definition-of-Done items are audits rather than content, and an audit that is
// performed once and written up in a PR description decays the moment the next lesson lands. Both
// are therefore kept here as tests:
//
// - **"Existing lessons/exercises audited for procedures reading top-level names."** Under
//   `spec/execution-model.md:389-394` a procedure sees only its parameters, the names its body has
//   created, and names declared `global`; reading anything else raises `ol-var-not-visible`. The
//   corpus scan below asserts no lesson does that — and, crucially, first proves the scan can see
//   such a violation, because a detector that silently finds nothing reports a clean corpus
//   forever. `check()` is what makes the audit *lexical* rather than luck: an execution-only test
//   would miss a boundary-crossing read sitting in a branch the reference solution never takes.
//
// - **"Level 8a recursion material reviewed against the repaired behavior."** There is no Level
//   6-8 content in this package yet (Levels 1-5 are the authored range), so the review cannot be a
//   diff of existing lessons. What it can be, and is below, is a pin on the behaviour any future
//   Level 8a lesson will be authored against: the recursive-procedure-with-an-intermediate shape
//   from issue #821 printed `0 0 0` before the ruling — every frame sharing one global `:tmp` —
//   and prints `0 1 2` after it. That is the shape a learner writes when storing an intermediate
//   in a recursive procedure, so if it ever regresses, the flagship Level 8a material would be
//   teaching a broken pattern again and this fails first.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";
import { check, OL_CHECK_PROFILES, parse } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

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

/**
 * Every `ol-var-not-visible` diagnostic `source` raises, from the semantic checker and from
 * execution. Both stages are kept because they fail on different things: the checker decides the
 * boundary lexically and so reaches a read the program never runs, while execution is the
 * behaviour a learner actually meets.
 */
function boundaryViolations(source, label) {
  const { ast } = parse(source, label);
  const checked = check(ast, { profiles: OL_CHECK_PROFILES, source });
  return [...checked.diagnostics, ...execute(source, label).diagnostics].filter(
    (diagnostic) => diagnostic.code === "ol-var-not-visible",
  );
}

// The control. A procedure reading a top-level name is exactly what the corpus scan must catch,
// including when the read sits in a branch that never executes — which is why the scan checks as
// well as runs.
test("the audit can actually see a procedure reading a top-level name", () => {
  const reached = boundaryViolations(
    ":count = 0\ndefine draw_steps\n  forward :count\nend\ndraw_steps",
    "reached.logo",
  );
  assert.equal(reached.length > 0, true);
  assert.equal(reached[0].message.includes("draw_steps"), true);

  // Never executed — `if false` means the body never runs — but still a boundary violation, and
  // only the checker half of the audit can say so.
  const unreached = boundaryViolations(
    ":count = 0\ndefine draw_steps\n  if false\n    forward :count\n  end if\nend\ndraw_steps",
    "unreached.logo",
  );
  assert.equal(unreached.length > 0, true);

  // And the audit does not fire on the legitimate shapes the curriculum uses: a `global` name, a
  // parameter, and a name the procedure sets itself.
  assert.deepEqual(
    boundaryViolations(
      "global count = 0\ndefine bump :step\n  :seen = :step\n  :count = :count + :seen\nend\nbump 2",
      "clean.logo",
    ),
    [],
  );
});

test("no lesson or exercise has a procedure reading a name its boundary hides", () => {
  assert.equal(CURRICULUM_SOURCES.length > 0, true);
  for (const { label, source } of CURRICULUM_SOURCES) {
    assert.deepEqual(
      boundaryViolations(source, `${label}.logo`),
      [],
      `${label} has a procedure reading a name outside its boundary`,
    );
  }
});

// The Level 8a review, pinned. `f 2` walks down to 0 and prints on the way back up, so a correct
// run prints the value each frame stored: 0, then 1, then 2.
test("a recursive procedure storing an intermediate now unwinds correctly (the Level 8a shape)", () => {
  const source = [
    "define f :n",
    "  :tmp = :n",
    "  if :n > 0",
    "    f :n - 1",
    "  end if",
    "  print :tmp",
    "end",
    "",
    "f 2",
  ].join("\n");
  const result = execute(source, "recursive-intermediate.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events
      .filter((event) => event.kind === "print")
      .flatMap((event) => event.payload.values),
    [0, 1, 2],
    "each recursive frame must own its :tmp — [0, 0, 0] is the pre-ruling bug",
  );
});

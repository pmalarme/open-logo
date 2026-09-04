import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/turtle";

test("describeTurtleState matches the spec's exact worked example for a visible turtle", () => {
  const state = {
    ...OL.INITIAL_TURTLE_STATE,
    position: [100, 0],
    heading: 90,
  };
  assert.equal(
    OL.describeTurtleState(state),
    "turtle at x 100 y 0 heading 90 degrees pen down color black width 1",
  );
});

test("describeTurtleState reports pen up", () => {
  const state = { ...OL.INITIAL_TURTLE_STATE, penDown: false };
  assert.equal(
    OL.describeTurtleState(state),
    "turtle at x 0 y 0 heading 0 degrees pen up color black width 1",
  );
});

test("describeTurtleState reports a non-default color and width", () => {
  const state = { ...OL.INITIAL_TURTLE_STATE, color: "red", width: 3 };
  assert.equal(
    OL.describeTurtleState(state),
    "turtle at x 0 y 0 heading 0 degrees pen down color red width 3",
  );
});

test("describeTurtleState appends 'hidden' only when the turtle is not visible", () => {
  const visible = OL.describeTurtleState(OL.INITIAL_TURTLE_STATE);
  assert.ok(!visible.includes("hidden"));

  const hidden = OL.describeTurtleState({
    ...OL.INITIAL_TURTLE_STATE,
    visible: false,
  });
  assert.equal(
    hidden,
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1 hidden",
  );
});

test("describeTurtleState appends the current instruction when supplied, omits it when not", () => {
  const withInstruction = OL.describeTurtleState(OL.INITIAL_TURTLE_STATE, {
    currentInstruction: "forward 100",
  });
  assert.equal(
    withInstruction,
    'turtle at x 0 y 0 heading 0 degrees pen down color black width 1 instruction "forward 100"',
  );

  const withoutInstruction = OL.describeTurtleState(
    OL.INITIAL_TURTLE_STATE,
    {},
  );
  assert.ok(!withoutInstruction.includes("instruction"));
});

test("describeTurtleState combines hidden and current-instruction suffixes deterministically", () => {
  const description = OL.describeTurtleState(
    { ...OL.INITIAL_TURTLE_STATE, visible: false },
    { currentInstruction: "right 90" },
  );
  assert.equal(
    description,
    'turtle at x 0 y 0 heading 0 degrees pen down color black width 1 hidden instruction "right 90"',
  );
});

test("describeTurtleState is deterministic across repeated calls with the same input", () => {
  const state = {
    ...OL.INITIAL_TURTLE_STATE,
    position: [42, -7],
    heading: 315,
  };
  const a = OL.describeTurtleState(state, { currentInstruction: "forward 1" });
  const b = OL.describeTurtleState(state, { currentInstruction: "forward 1" });
  assert.equal(a, b);
});

test("describeCurrentStepCue conveys the current step via text, icon, and a solid line pattern", () => {
  const cue = OL.describeCurrentStepCue("forward 100");
  assert.equal(cue.kind, "current-step");
  assert.equal(cue.text, "current step: forward 100");
  assert.equal(typeof cue.icon, "string");
  assert.ok(cue.icon.length > 0);
  assert.equal(cue.linePattern, "solid");
});

test("describePenUpPreviewCue conveys pen-up state via text, icon, and a dashed line pattern", () => {
  const cue = OL.describePenUpPreviewCue();
  assert.equal(cue.kind, "pen-up-preview");
  assert.equal(cue.text, "pen up (not drawing)");
  assert.ok(cue.icon.length > 0);
  assert.equal(cue.linePattern, "dashed");
});

test("describeTurtleFocusCue conveys turtle focus via text, icon, and world position", () => {
  const cue = OL.describeTurtleFocusCue([12, -34]);
  assert.equal(cue.kind, "turtle-focus");
  assert.equal(cue.text, "turtle focus at x 12 y -34");
  assert.ok(cue.icon.length > 0);
  assert.deepEqual(cue.position, [12, -34]);
});

test("describeErrorLocationCue conveys an error location via text and icon, not color alone", () => {
  const cue = OL.describeErrorLocationCue(
    'ol-arity: "forward" expects 1 input, got 0',
  );
  assert.equal(cue.kind, "error-location");
  assert.equal(cue.text, 'error: ol-arity: "forward" expects 1 input, got 0');
  assert.ok(cue.icon.length > 0);
});

test("every color-independent cue kind is distinct", () => {
  const kinds = new Set([
    OL.describeCurrentStepCue("x").kind,
    OL.describePenUpPreviewCue().kind,
    OL.describeTurtleFocusCue([0, 0]).kind,
    OL.describeErrorLocationCue("x").kind,
  ]);
  assert.equal(kinds.size, 4);
});

// --- describeTurtleWorldState (#749, spec/rendering.md:193) ------------------------------------

/** A `TurtleWorldState` over `states` (`[id, state]` pairs in creation order) with `lastActedId`
 * as the last-acted turtle. */
function turtleWorld(states, lastActedId) {
  return { turtles: new Map(states), lastActedTurtleId: lastActedId };
}

test("describeTurtleWorldState of a single-turtle world is byte-identical to describeTurtleState", () => {
  // The compatibility property #749 protects: every Turtle & Rendering program keeps the spec's
  // own worked-example wording, with no turtle identity bolted on.
  const state = { ...OL.INITIAL_TURTLE_STATE, position: [100, 0], heading: 90 };
  const world = turtleWorld([[OL.MAIN_TURTLE_ID, state]], OL.MAIN_TURTLE_ID);
  assert.equal(
    OL.describeTurtleWorldState(world),
    "turtle at x 100 y 0 heading 90 degrees pen down color black width 1",
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    OL.describeTurtleState(state),
  );
  assert.equal(
    OL.describeTurtleWorldState(OL.INITIAL_TURTLE_WORLD_STATE),
    OL.describeTurtleState(OL.INITIAL_TURTLE_STATE),
  );
});

test("describeTurtleWorldState names the described turtle once there is more than one", () => {
  // spec/rendering.md:193 — "Implementations with multiple turtles MUST identify the active turtle
  // or addressed turtle set." The #749 defect was that this text named no turtle at all while
  // reporting one particular turtle's attributes.
  const world = turtleWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, { ...OL.INITIAL_TURTLE_STATE, color: "green" }],
      [
        2,
        {
          ...OL.INITIAL_TURTLE_STATE,
          position: [0, 10],
          color: "blue",
          visible: false,
        },
      ],
    ],
    2,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    "turtle #2 at x 0 y 10 heading 0 degrees pen down color blue width 1 hidden",
  );
});

test("describeTurtleWorldState names the turtle by its id, matching the identity an OpenLogo program prints", () => {
  // `print who` / `print :friend` render a turtle value as `turtle #<id>` (@openlogo/runtime's
  // printedForm, over @openlogo/core's OLTurtle.id; spec/turtles-and-sprites.md:39,:85). A
  // screen-reader user has only text channels, so the state region must use that same name — a
  // creation-order ordinal would read "turtle 2" for the turtle the output pane calls "turtle #7".
  const world = turtleWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [7, { ...OL.INITIAL_TURTLE_STATE, color: "green" }],
    ],
    7,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    "turtle #7 at x 0 y 0 heading 0 degrees pen down color green width 1",
  );
});

test("describeTurtleWorldState still appends the current instruction for a multi-turtle world", () => {
  const world = turtleWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, { ...OL.INITIAL_TURTLE_STATE, color: "green" }],
    ],
    1,
  );
  assert.equal(
    OL.describeTurtleWorldState(world, { currentInstruction: "forward 10" }),
    'turtle #1 at x 0 y 0 heading 0 degrees pen down color green width 1 instruction "forward 10"',
  );
});

test("describeTurtleWorldState of an empty world falls back to the program-start defaults", () => {
  // A hand-built world naming no live turtle must still announce something rather than throw.
  assert.equal(
    OL.describeTurtleWorldState({ turtles: new Map(), lastActedTurtleId: 0 }),
    OL.describeTurtleState(OL.INITIAL_TURTLE_STATE),
  );
});

test("describeTurtleWorldState never announces an identity no live turtle has", () => {
  // A multi-turtle world whose lastActedTurtleId names an absent turtle must not claim to be
  // describing `turtle #4` — nothing in the world corresponds to that name.
  const world = turtleWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, { ...OL.INITIAL_TURTLE_STATE, color: "green" }],
    ],
    4,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    OL.describeTurtleState(OL.INITIAL_TURTLE_STATE),
  );
  assert.equal(world.turtles.size > 1, true);
});

// --- the addressed turtle set (#770, spec/rendering.md:193) ------------------------------------

/** A `TurtleWorldState` carrying addressing, as `reduceTurtleWorldState` folds it from the
 * stream's addressing snapshots. `currentId` defaults to the addressed set's first member — what
 * the producer always reports — and is `null` for an empty set. */
function addressedWorld(states, addressedTurtleIds, lastActedId, currentId) {
  return {
    turtles: new Map(states),
    lastActedTurtleId: lastActedId,
    addressedTurtleIds,
    currentTurtleId:
      currentId === undefined ? (addressedTurtleIds[0] ?? null) : currentId,
  };
}

const GREEN = { ...OL.INITIAL_TURTLE_STATE, color: "green" };
const BLUE_HIDDEN = {
  ...OL.INITIAL_TURTLE_STATE,
  position: [0, 10],
  color: "blue",
  visible: false,
};

test("describeTurtleWorldState identifies the whole addressed set once more than one turtle is addressed", () => {
  // spec/rendering.md:193 — "Implementations with multiple turtles MUST identify the active turtle
  // OR ADDRESSED TURTLE SET." After `tell [ :a :b ]` no single turtle is the answer, so the text
  // leads with the set — and still reports the position/heading/pen of the turtle that last acted,
  // because this region is also how a non-visual learner follows what just changed.
  const world = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, GREEN],
      [2, BLUE_HIDDEN],
    ],
    [1, 2],
    2,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    "addressed turtles #1 #2. turtle #2 at x 0 y 10 heading 0 degrees pen down color blue width 1 hidden",
  );
});

test("describeTurtleWorldState names every addressed turtle, in the order each iterates", () => {
  const world = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [3, GREEN],
      [7, BLUE_HIDDEN],
      [5, OL.INITIAL_TURTLE_STATE],
    ],
    [7, 3, 5],
    3,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    "addressed turtles #7 #3 #5. turtle #3 at x 0 y 0 heading 0 degrees pen down color green width 1",
  );
});

test("describeTurtleWorldState identifies the addressed turtle after an ask block restores, while still describing the turtle that acted", () => {
  // The #770 defect, in its smallest form: `tell :a` / `ask :b [ forward 10 ]`. The addressed set
  // is back to { :a }, so naming only `:b` would identify neither "the active turtle" nor "the
  // addressed turtle set" — but `:b` is what just changed, and a non-visual learner must still hear
  // that (spec/rendering.md:195), so the sentence carries both.
  const world = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, GREEN],
      [2, BLUE_HIDDEN],
    ],
    [1],
    2,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    "addressed turtle #1. turtle #2 at x 0 y 10 heading 0 degrees pen down color blue width 1 hidden",
  );
});

test("describeTurtleWorldState keeps the wording exactly as #749 baselined it when the addressed turtle is the one that acted", () => {
  // `tell :b` / `forward 10`: the addressed set is exactly the turtle `lastActedTurtleId` names, so there is
  // nothing to disambiguate and the text stays the plain `turtle #<id>` sentence, unchanged.
  const world = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [7, GREEN],
    ],
    [7],
    7,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    "turtle #7 at x 0 y 0 heading 0 degrees pen down color green width 1",
  );
});

test("describeTurtleWorldState of a folded single-turtle world stays byte-identical to the spec's worked example", () => {
  // The compatibility property, now through the *folded* addressing path a real Turtle & Rendering
  // program takes (its addressed set is the single default turtle, spec/turtles-and-sprites.md:44)
  // rather than only through a hand-built world.
  const state = { ...OL.INITIAL_TURTLE_STATE, position: [100, 0], heading: 90 };
  const world = addressedWorld(
    [[OL.MAIN_TURTLE_ID, state]],
    [OL.MAIN_TURTLE_ID],
    OL.MAIN_TURTLE_ID,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    "turtle at x 100 y 0 heading 90 degrees pen down color black width 1",
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    OL.describeTurtleState(state),
  );
  assert.equal(
    OL.describeTurtleWorldState(OL.INITIAL_TURTLE_WORLD_STATE),
    OL.describeTurtleState(OL.INITIAL_TURTLE_STATE),
  );
});

test("describeTurtleWorldState says plainly when nothing is addressed (tell [ ])", () => {
  // `current_turtle_id` is null exactly when the addressed set is empty, and the spec defines no
  // current turtle there — so this consumer picks its own fallback: say nothing is addressed, then
  // keep describing the turtle the learner last watched act, the only honest subject left.
  // Dropping the state clause instead would breach `spec/rendering.md`'s non-visual *minimum*
  // (position, heading, pen, color, width, visibility, current instruction).
  const world = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, GREEN],
    ],
    [],
    1,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    "no addressed turtles. turtle #1 at x 0 y 0 heading 0 degrees pen down color green width 1",
  );
});

test("describeTurtleWorldState names the turtle again as soon as a second one exists, even with addressing unchanged", () => {
  // `:friend = new_turtle` adds a live turtle without touching the addressed set, so the addressed
  // set is still exactly the turtle `lastActedTurtleId` names — no addressing clause — but #749's
  // rule applies and
  // the subject is named. This is the exact boundary of the byte-identical guarantee: one live
  // turtle addressing itself, not "any Sprites program before it addresses something else".
  const world = addressedWorld(
    [
      [OL.MAIN_TURTLE_ID, OL.INITIAL_TURTLE_STATE],
      [1, GREEN],
    ],
    [OL.MAIN_TURTLE_ID],
    OL.MAIN_TURTLE_ID,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    "turtle #0 at x 0 y 0 heading 0 degrees pen down color black width 1",
  );
});

test("describeTurtleWorldState drops unusable addressing to the turtle's real state, not to the program-start defaults", () => {
  // An addressed set naming a turtle the world does not hold is dropped, and what is left is the
  // last-acted turtle's ACTUAL state — unnamed while the world holds one turtle, named once it
  // holds more. Only a `lastActedTurtleId` that names nothing live falls back to the defaults.
  const oneTurtle = addressedWorld([[3, GREEN]], [9], 3);
  assert.equal(
    OL.describeTurtleWorldState(oneTurtle),
    "turtle at x 0 y 0 heading 0 degrees pen down color green width 1",
  );

  const noSubject = addressedWorld([[3, GREEN]], [9], 4);
  assert.equal(
    OL.describeTurtleWorldState(noSubject),
    OL.describeTurtleState(OL.INITIAL_TURTLE_STATE),
  );
});

test("describeTurtleWorldState says nothing is addressed even in a single-turtle world", () => {
  // `tell [ ]` before any `new_turtle` empties the addressed set of a world holding only the main
  // turtle. The single-turtle wording is NOT restored there: after `tell [ ]` a turtle command
  // drives nothing, and a region that kept reading like business as usual would hide that. Turtle
  // & Rendering output is unaffected either way — `tell` is a Sprites primitive, so no
  // Turtle & Rendering program can reach this state.
  const world = addressedWorld(
    [[OL.MAIN_TURTLE_ID, OL.INITIAL_TURTLE_STATE]],
    [],
    OL.MAIN_TURTLE_ID,
  );
  assert.equal(world.turtles.size, 1);
  assert.equal(
    OL.describeTurtleWorldState(world),
    "no addressed turtles. turtle #0 at x 0 y 0 heading 0 degrees pen down color black width 1",
  );
});

test("describeTurtleWorldState falls back to the defaults when nothing is addressed and no turtle has acted either", () => {
  const world = addressedWorld([], [], 4);
  assert.equal(
    OL.describeTurtleWorldState(world),
    OL.describeTurtleState(OL.INITIAL_TURTLE_STATE),
  );
});

test("describeTurtleWorldState never announces an addressed identity no live turtle has", () => {
  // Same promise as for the last-acted turtle: rather than naming a turtle the world does not
  // hold, fall back to the plain last-acted wording. Only constructible by hand — the producer
  // addresses live turtles only.
  const missingFirstMember = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, GREEN],
    ],
    [4, 1],
    1,
  );
  assert.equal(
    OL.describeTurtleWorldState(missingFirstMember),
    "turtle #1 at x 0 y 0 heading 0 degrees pen down color green width 1",
  );

  const missingLastMember = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, GREEN],
    ],
    [1, 4],
    1,
  );
  assert.equal(
    OL.describeTurtleWorldState(missingLastMember),
    "turtle #1 at x 0 y 0 heading 0 degrees pen down color green width 1",
  );
});

test("describeTurtleWorldState never leaks the current-turtle pointer into the text", () => {
  // The description's subject is the turtle that acted and its set clause lists the addressed
  // turtles, so `currentTurtleId` — the `who` pointer the stream reports, kept on the world for
  // `why`/`debug` — is never read here. Even the values the producer can never emit (a null
  // pointer for a non-empty set, or one naming no live turtle) cannot reach a learner's ears.
  const nullPointer = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, GREEN],
      [2, BLUE_HIDDEN],
    ],
    [1, 2],
    2,
    null,
  );
  assert.equal(
    OL.describeTurtleWorldState(nullPointer),
    "addressed turtles #1 #2. turtle #2 at x 0 y 10 heading 0 degrees pen down color blue width 1 hidden",
  );

  const bogusPointer = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, GREEN],
    ],
    [1],
    1,
    9,
  );
  assert.equal(
    OL.describeTurtleWorldState(bogusPointer),
    "turtle #1 at x 0 y 0 heading 0 degrees pen down color green width 1",
  );
});

test("describeTurtleWorldState still appends the current instruction for an addressed set", () => {
  const world = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, GREEN],
      [2, BLUE_HIDDEN],
    ],
    [1, 2],
    2,
  );
  assert.equal(
    OL.describeTurtleWorldState(world, { currentInstruction: "forward 10" }),
    'addressed turtles #1 #2. turtle #2 at x 0 y 10 heading 0 degrees pen down color blue width 1 hidden instruction "forward 10"',
  );
});

test("describeTurtleWorldState is deterministic for the same addressed world", () => {
  const world = addressedWorld(
    [
      [0, OL.INITIAL_TURTLE_STATE],
      [1, GREEN],
      [2, BLUE_HIDDEN],
    ],
    [1, 2],
    2,
  );
  assert.equal(
    OL.describeTurtleWorldState(world),
    OL.describeTurtleWorldState(world),
  );
});

// --- #778: presentation of numbers and of multi-line instructions in a spoken description ---
//
// Both defects were re-derived on the saga tip before this fix, by driving every runnable
// `spec/examples/*.logo` through the studio live region: 917/1423 region texts carried a raw-float
// `x`, 950/1423 a `y`, 311/1423 a `heading`, and 163/1423 spliced a whole multi-line block.
// These tests assert the announcement TEXT, not merely that a description was produced.

test("describeTurtleState rounds float-noise coordinates to a speakable number (#778)", () => {
  // The issue's verbatim example: a closed square lands a hair off the origin.
  assert.equal(
    OL.describeTurtleState({
      ...OL.INITIAL_TURTLE_STATE,
      position: [1.4210854715202004e-14, -1.4695761589768237e-14],
    }),
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1",
  );
  // ...and the other verbatim example, accumulated error just above a whole number.
  assert.equal(
    OL.describeTurtleState({
      ...OL.INITIAL_TURTLE_STATE,
      position: [80.00000000000001, 0],
    }),
    "turtle at x 80 y 0 heading 0 degrees pen down color black width 1",
  );
});

test("describeTurtleState keeps three decimals of a genuinely fractional coordinate (#778)", () => {
  // Rounding must not flatten a real diagonal to a whole number: 60·sqrt(2) is really 84.853.
  assert.equal(
    OL.describeTurtleState({
      ...OL.INITIAL_TURTLE_STATE,
      position: [84.8528137423857, -84.8528137423857],
    }),
    "turtle at x 84.853 y -84.853 heading 0 degrees pen down color black width 1",
  );
});

test("describeTurtleState never speaks a negative zero (#778)", () => {
  // `(-0.0004).toFixed(3)` is "-0.000"; spoken as "-0" it would name a coordinate no learner
  // recognizes, and the sign is pure float noise at that magnitude.
  const text = OL.describeTurtleState({
    ...OL.INITIAL_TURTLE_STATE,
    position: [-0.0004, -1e-14],
  });
  assert.equal(
    text,
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1",
  );
  assert.doesNotMatch(text, /-0/);
});

test("describeTurtleState rounds a float-noise heading (#778)", () => {
  // The issue named only x/y; the sweep found 311/1423 texts with a noisy `heading` as well
  // (a 7-pointed star turns 1080/7 = 154.28571428571428 degrees).
  assert.equal(
    OL.describeTurtleState({
      ...OL.INITIAL_TURTLE_STATE,
      heading: 154.28571428571428,
    }),
    "turtle at x 0 y 0 heading 154.286 degrees pen down color black width 1",
  );
});

test("describeTurtleState never speaks a positive width as 0, and still removes width noise (#778)", () => {
  // `set_width 0` and `set_width -1` both raise `ol-range`, so a width is never legitimately zero
  // and `width 0` is false for every width that can exist. `set_width 0.0001` is diagnostic-free,
  // so the hairline must survive — while `set_width 1 / 3` (0.3333333333333333) and
  // `set_width 0.1 + 0.2` (0.30000000000000004) are equally diagnostic-free and must not recite
  // sixteen digits.
  const widthOf = (width) =>
    /width (\S+)$/.exec(
      OL.describeTurtleState({ ...OL.INITIAL_TURTLE_STATE, width }),
    )[1];
  assert.equal(widthOf(0.0001), "0.0001");
  assert.equal(widthOf(0.00049), "0.00049");
  assert.equal(widthOf(1 / 3), "0.333");
  assert.equal(widthOf(0.1 + 0.2), "0.3");
  assert.equal(widthOf(2.0000000000000004), "2");
  // The fallback is only taken below the threshold, so an ordinary width is never re-scaled to
  // three significant digits (which would turn 1234 into 1230).
  assert.equal(widthOf(1234), "1234");
  assert.equal(widthOf(1), "1");
});

test("summarizeSourceInstruction's comma separates the source text from the generated count (#778)", () => {
  // The measurable property the comma exists for: it marks where the learner's own source text
  // ends and the generated count begins. Without it the guard's trailing `3` runs straight into
  // the count with nothing between them. 11 of the 53 distinct block announcements the runnable
  // examples produce hit this; with the comma, 0 do.
  const summary = OL.summarizeSourceInstruction(
    "if :sides < 3\n  forward 1\nend if",
  );
  assert.equal(summary, "if :sides < 3, plus 2 more lines");
  assert.doesNotMatch(summary, /\d+\s+plus\s+\d+/);
  // Control: the un-comma'd form really does match, so the assertion above is discriminating.
  assert.match("if :sides < 3 plus 2 more lines", /\d+\s+plus\s+\d+/);
});

test("describeTurtleState renders two positions in the same rounding bucket identically (#778)", () => {
  // The accepted cost of rounding, pinned so it stays a decision rather than a surprise. Buckets
  // are 0.001 wide and the effect is bucket-relative, not magnitude-relative: `0.00049` and
  // `0.00051` differ by only 0.00002 and still render differently, while `0` and `0.0004`, twenty
  // times further apart, render the same. A scale-aware snap could have kept `0.0004`; it is not
  // built because across the runnable examples all 192 non-zero per-turtle movements are at least
  // 0.2571255761402784, none below one bucket width. Measured end to end: `repeat 4 /
  // forward 0.0001 / end repeat` yields 3 region texts — the initial one plus 2 changes — where
  // the same program with `forward 80` yields 7.
  assert.equal(
    OL.describeTurtleState({
      ...OL.INITIAL_TURTLE_STATE,
      position: [0, 0.0004],
    }),
    OL.describeTurtleState(OL.INITIAL_TURTLE_STATE),
  );
  // ...and two values a hair apart across a bucket boundary are still told apart.
  assert.match(
    OL.describeTurtleState({
      ...OL.INITIAL_TURTLE_STATE,
      position: [0, 0.00049],
    }),
    /y 0 /,
  );
  assert.match(
    OL.describeTurtleState({
      ...OL.INITIAL_TURTLE_STATE,
      position: [0, 0.00051],
    }),
    /y 0\.001 /,
  );
});

test("describeTurtleState speaks a magnitude at or above 1e21 in exponent form (#778)", () => {
  // `toFixed` itself switches to exponent notation there, and it is reachable: `forward power 10
  // 21` is diagnostic-free and announces `y 1e+21`. Recorded rather than special-cased — the
  // number really is that big.
  assert.match(
    OL.describeTurtleState({ ...OL.INITIAL_TURTLE_STATE, position: [0, 1e21] }),
    /y 1e\+21 /,
  );
});

test("describeTurtleState omits the instruction label when the slice has no head line (#778)", () => {
  // The summarizer returns "" here, and a label spoken with nothing in it is exactly what the
  // whole clause-omission rule exists to avoid.
  const text = OL.describeTurtleState(OL.INITIAL_TURTLE_STATE, {
    currentInstruction: "\nright 90",
  });
  assert.equal(
    text,
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1",
  );
  assert.doesNotMatch(text, /instruction/);
});

test("describeCurrentStepCue omits the trailing label when the slice has no head line (#778)", () => {
  // `ColorIndependentCue.text` is documented as sufficient on its own, so `current step: ` with an
  // empty tail would make it not so.
  assert.equal(OL.describeCurrentStepCue("\nright 90").text, "current step");
});

test("describeTurtleState speaks a heading that rounds up to a full turn as 0 (#778)", () => {
  // `spec/rendering.md:67` and `spec/execution-model.md:923` normalize headings into [0,360), so
  // `heading 360 degrees` names a value the model never holds. Reachable, not hypothetical:
  // `right 359.9999` and `repeat 3 / right 119.99999999 / end repeat` both reach it, with no
  // diagnostics, on a plain Turtle & Rendering program.
  assert.equal(
    OL.describeTurtleState({ ...OL.INITIAL_TURTLE_STATE, heading: 359.9999 }),
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1",
  );
  assert.equal(
    OL.describeTurtleState({
      ...OL.INITIAL_TURTLE_STATE,
      heading: 359.99999997000003,
    }),
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1",
  );
  // The neighbouring value must still be spoken as itself, not swallowed by the wrap.
  assert.match(
    OL.describeTurtleState({ ...OL.INITIAL_TURTLE_STATE, heading: 359.9 }),
    /heading 359\.9 degrees/,
  );
});

test("summarizeSourceInstruction returns a single-line instruction unchanged but trimmed (#778)", () => {
  assert.equal(OL.summarizeSourceInstruction("forward 100"), "forward 100");
  assert.equal(OL.summarizeSourceInstruction("  forward 100  "), "forward 100");
});

test("summarizeSourceInstruction reduces a block to its head line plus a line count (#778)", () => {
  assert.equal(
    OL.summarizeSourceInstruction(
      "repeat 4\n  forward 80\n  right 90\nend repeat",
    ),
    "repeat 4, plus 3 more lines",
  );
  // Singular for exactly one elided line — a learner hears grammar, not a template.
  assert.equal(
    OL.summarizeSourceInstruction("repeat 4\n  forward 80"),
    "repeat 4, plus 1 more line",
  );
  // Blank lines inside the span are counted: the phrase describes the source, not a subset of it.
  assert.equal(
    OL.summarizeSourceInstruction("repeat 4\n\n  forward 80"),
    "repeat 4, plus 2 more lines",
  );
});

test("summarizeSourceInstruction never returns a newline or any line but the head (#778)", () => {
  const summary = OL.summarizeSourceInstruction(
    'ask :leader [\n  set_shape "turtle"\n  set_color "blue"\n]',
  );
  assert.equal(summary, "ask :leader [, plus 3 more lines");
  assert.doesNotMatch(summary, /\n/);
  assert.doesNotMatch(summary, /set_shape|set_color/);
});

test("summarizeSourceInstruction has nothing to say when the head line is empty (#778)", () => {
  // Only a span pointing outside the current source reaches this; the caller then omits the
  // clause rather than speaking a bare label.
  assert.equal(OL.summarizeSourceInstruction("\n\n"), "");
  assert.equal(OL.summarizeSourceInstruction(""), "");
  assert.equal(OL.summarizeSourceInstruction("   "), "");
});

test("describeTurtleState summarizes a multi-line currentInstruction option (#778)", () => {
  assert.equal(
    OL.describeTurtleState(OL.INITIAL_TURTLE_STATE, {
      currentInstruction: "repeat 4\n  forward 80\nend repeat",
    }),
    'turtle at x 0 y 0 heading 0 degrees pen down color black width 1 instruction "repeat 4, plus 2 more lines"',
  );
});

test("describeTurtleFocusCue rounds its coordinates too (#778)", () => {
  assert.equal(
    OL.describeTurtleFocusCue([1.4210854715202004e-14, 80.00000000000001]).text,
    "turtle focus at x 0 y 80",
  );
});

test("describeCurrentStepCue summarizes a multi-line instruction (#778)", () => {
  // `ColorIndependentCue.text` is documented as sufficient on its own, so it is an accessible
  // label; a newline inside one is never useful.
  const cue = OL.describeCurrentStepCue("repeat 4\n  forward 80\nend repeat");
  assert.equal(cue.text, "current step: repeat 4, plus 2 more lines");
  assert.doesNotMatch(cue.text, /\n/);
});

test("the #778 presentation rules leave spec/rendering.md's worked example byte-identical", () => {
  // The compatibility property the whole change is built around (`spec/rendering.md:193`).
  assert.equal(
    OL.describeTurtleState({
      ...OL.INITIAL_TURTLE_STATE,
      position: [100, 0],
      heading: 90,
    }),
    "turtle at x 100 y 0 heading 90 degrees pen down color black width 1",
  );
});

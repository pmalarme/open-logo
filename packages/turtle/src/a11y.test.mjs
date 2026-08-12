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

// --- describeTurtleWorldState (#749, spec/rendering.md:191) ------------------------------------

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
  // spec/rendering.md:191 — "Implementations with multiple turtles MUST identify the active turtle
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

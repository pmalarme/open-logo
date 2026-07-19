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

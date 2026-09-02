import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";
import { MAIN_TURTLE_ID } from "@openlogo/turtle";

/** A `TurtleWorldState` holding just the main turtle at `state`, last-acted — what a single-turtle
 * (Turtle & Rendering) program's event stream folds to. */
function singleTurtleWorld(state) {
  return {
    turtles: new Map([[MAIN_TURTLE_ID, state]]),
    lastActedTurtleId: MAIN_TURTLE_ID,
  };
}

test("REPL_FOCUS_ORDER covers every studio region with unique, stable ids", () => {
  const order = OL.REPL_FOCUS_ORDER;
  assert.ok(order.length > 0);

  const ids = order.map((stop) => stop.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "every focus stop id must be unique",
  );

  const regions = new Set(order.map((stop) => stop.region));
  assert.deepEqual(
    [...regions].sort(),
    [
      "diagnostics",
      "editor",
      "lesson",
      "output",
      "repl",
      "turtle",
      "tutor",
    ].sort(),
    "focus order must span exactly the lesson, editor, repl, turtle, output, diagnostics, and tutor regions",
  );

  for (const stop of order) {
    assert.ok(
      stop.label.length > 0,
      `stop "${stop.id}" must have a non-empty label`,
    );
  }
});

test("REPL_FOCUS_ORDER puts the lesson pane first and the tutor-output pane last, with the editor, Start/Stop toggle, Reset, Speed, run log, canvas, turtle state, output, and diagnostics in between (#410)", () => {
  const order = OL.REPL_FOCUS_ORDER;
  assert.equal(order[0]?.id, "lesson-pane");
  assert.equal(order[1]?.id, "editor");
  assert.equal(order[order.length - 1]?.id, "tutor-output");

  const lessonStop = order.find((stop) => stop.id === "lesson-pane");
  assert.ok(lessonStop, "the lesson pane must be a focus stop");
  assert.equal(lessonStop.region, "lesson");
  assert.equal(lessonStop.role, "complementary");

  const replStops = order.filter((stop) => stop.region === "repl");
  assert.deepEqual(
    replStops.map((stop) => stop.label),
    ["Start run", "Reset", "Turtle speed", "Run log"],
  );
  assert.deepEqual(
    replStops.map((stop) => stop.role),
    ["button", "button", "slider", "log"],
  );

  const canvasStop = order.find((stop) => stop.id === "canvas");
  assert.ok(canvasStop, "the canvas must be a focus stop");
  assert.equal(canvasStop.region, "turtle");
  assert.equal(canvasStop.role, "img");

  const turtleStateStop = order.find((stop) => stop.id === "turtle-state");
  assert.ok(
    turtleStateStop,
    "the non-visual turtle-state text must be a focus stop (#410)",
  );
  assert.equal(turtleStateStop.region, "turtle");
  assert.equal(turtleStateStop.role, "status");
  assert.equal(turtleStateStop.label, "Turtle state");

  const outputStop = order.find((stop) => stop.id === "output");
  assert.ok(outputStop, "the program output pane must be a focus stop (#410)");
  assert.equal(outputStop.region, "output");
  assert.equal(outputStop.role, "status");
  assert.equal(outputStop.label, "Program output");

  const tutorOutputStop = order.find((stop) => stop.id === "tutor-output");
  assert.ok(tutorOutputStop, "the tutor-output pane must be a focus stop");
  assert.equal(tutorOutputStop.region, "tutor");
  assert.equal(tutorOutputStop.role, "log");
});

test("REPL_FOCUS_ORDER orders the new #410 stops between Speed and diagnostics: run log, canvas, turtle state, output — with #952's canvas activation button beside the canvas it activates", () => {
  const order = OL.REPL_FOCUS_ORDER;
  const ids = order.map((stop) => stop.id);
  assert.deepEqual(
    ids.slice(ids.indexOf("speed-slider"), ids.indexOf("diagnostics-list") + 1),
    [
      "speed-slider",
      "run-log",
      "canvas",
      "canvas-activate",
      "turtle-state",
      "output",
      "diagnostics-list",
    ],
  );
});

test("#952: the canvas activation button is a real, labelled, tab-reachable button stop — on_click's 'equivalent accessible action'", () => {
  const stop = OL.REPL_FOCUS_ORDER.find(
    (entry) => entry.id === "canvas-activate",
  );
  assert.ok(stop, "on_click must be reachable without a pointer");
  assert.equal(stop.region, "turtle");
  assert.equal(stop.role, "button");
  assert.equal(stop.label, OL.CANVAS_ACTIVATION_LABEL);
});

test("#315: the editor stays exactly one `textbox` focus stop, and CM6's own aria-role/aria-label (editor-cm6.ts) are derived from it, never a second literal that could drift", () => {
  const order = OL.REPL_FOCUS_ORDER;
  const editorStops = order.filter((stop) => stop.region === "editor");
  assert.equal(
    editorStops.length,
    1,
    "CM6 must remain a single textbox focus stop, not one stop per internal widget " +
      "(gutter/fold icons are chrome, not separate focusable stops)",
  );
  const [editorStop] = editorStops;
  assert.equal(editorStop.role, "textbox");
  assert.equal(editorStop.label, "OpenLogo source editor");

  // editor-cm6.ts's EDITOR_ARIA_ROLE/EDITOR_ARIA_LABEL read straight from this same stop (see
  // that module's own test asserting the converse), so this list is the one place that can
  // regress CM6's aria-role/aria-label and this list's role/label together, by construction.
  assert.equal(OL.EDITOR_ARIA_ROLE, editorStop.role);
  assert.equal(OL.EDITOR_ARIA_LABEL, editorStop.label);
});

test("#315: REPL_LANDMARK_ROLES' editor landmark matches the focus stop exactly, so the CM6 host container and its content-editable share one consistent role/label", () => {
  const editorLandmark = OL.REPL_LANDMARK_ROLES.find(
    (landmark) => landmark.region === "editor",
  );
  assert.ok(editorLandmark, "the editor must have a landmark role");
  const editorStop = OL.REPL_FOCUS_ORDER.find(
    (stop) => stop.region === "editor",
  );
  assert.equal(editorLandmark.role, editorStop.role);
  assert.equal(editorLandmark.label, editorStop.label);
});

test("nextFocusStop cycles forward through every stop with no trap", () => {
  const order = OL.REPL_FOCUS_ORDER;
  let currentId = order[0].id;
  const visited = [currentId];
  for (let i = 0; i < order.length; i += 1) {
    currentId = OL.nextFocusStop(order, currentId).id;
    visited.push(currentId);
  }
  // After exactly `order.length` forward moves from the first stop, we are back at the first —
  // proving the whole order was reachable and nothing got stuck.
  assert.equal(currentId, order[0].id);
  assert.deepEqual(
    new Set(visited.slice(0, order.length)),
    new Set(order.map((s) => s.id)),
  );
});

test("previousFocusStop cycles backward through every stop with no trap", () => {
  const order = OL.REPL_FOCUS_ORDER;
  let currentId = order[order.length - 1].id;
  const visited = [currentId];
  for (let i = 0; i < order.length; i += 1) {
    currentId = OL.previousFocusStop(order, currentId).id;
    visited.push(currentId);
  }
  assert.equal(currentId, order[order.length - 1].id);
  assert.deepEqual(
    new Set(visited.slice(0, order.length)),
    new Set(order.map((s) => s.id)),
  );
});

test("nextFocusStop and previousFocusStop are inverse over every stop", () => {
  const order = OL.REPL_FOCUS_ORDER;
  for (const stop of order) {
    const forward = OL.nextFocusStop(order, stop.id);
    const back = OL.previousFocusStop(order, forward.id);
    assert.equal(back.id, stop.id);
  }
});

test("nextFocusStop/previousFocusStop throw for an id outside the given order", () => {
  const order = OL.REPL_FOCUS_ORDER;
  assert.throws(() => OL.nextFocusStop(order, "not-a-stop"), RangeError);
  assert.throws(() => OL.previousFocusStop(order, "not-a-stop"), RangeError);
});

test("REPL_LANDMARK_ROLES declares landmarks for every studio region with a role and label", () => {
  const landmarks = OL.REPL_LANDMARK_ROLES;
  assert.deepEqual(
    landmarks.map((landmark) => landmark.region).sort(),
    [
      "diagnostics",
      "editor",
      "lesson",
      "output",
      "repl",
      "turtle",
      "turtle",
      "tutor",
    ].sort(),
  );
  const byRegion = new Map(
    landmarks.map((landmark) => [
      `${landmark.region}:${landmark.role}`,
      landmark,
    ]),
  );
  assert.equal(byRegion.get("lesson:complementary")?.role, "complementary");
  assert.equal(byRegion.get("editor:textbox")?.role, "textbox");
  assert.equal(byRegion.get("repl:toolbar")?.role, "toolbar");
  assert.equal(byRegion.get("turtle:img")?.role, "img");
  assert.equal(byRegion.get("turtle:status")?.role, "status");
  assert.equal(byRegion.get("output:status")?.role, "status");
  assert.equal(byRegion.get("diagnostics:log")?.role, "log");
  assert.equal(byRegion.get("tutor:log")?.role, "log");
  for (const landmark of landmarks) {
    assert.ok(landmark.label.length > 0);
  }
});

test("createA11yAnnouncer never announces the initial snapshot", () => {
  const state = OL.createStudioState();
  const announcer = OL.createA11yAnnouncer(state);
  assert.deepEqual(announcer.getAnnouncements(), []);
});

test("createA11yAnnouncer announces run-status transitions with structured, deterministic text", () => {
  const state = OL.createStudioState();
  const announcer = OL.createA11yAnnouncer(state);

  state.setRunStatus("running");
  state.setRunStatus("done");
  state.setRunStatus("stopped");
  state.setRunStatus("idle");

  assert.deepEqual(announcer.getAnnouncements(), [
    { politeness: "polite", message: "Run started." },
    { politeness: "polite", message: "Run complete." },
    { politeness: "polite", message: "Run stopped." },
    { politeness: "polite", message: "Ready." },
  ]);
});

test("createA11yAnnouncer does not re-announce setting the same run status again", () => {
  const state = OL.createStudioState();
  const announcer = OL.createA11yAnnouncer(state);

  state.setRunStatus("running");
  state.setRunStatus("running");

  assert.equal(announcer.getAnnouncements().length, 1);
});

test("createA11yAnnouncer does not re-announce a structurally-identical diagnostics list on a fresh array reference", () => {
  const state = OL.createStudioState();
  const announcer = OL.createA11yAnnouncer(state);

  const diagnostic = {
    code: "ol-bad-token",
    message: "irrelevant",
    severity: "error",
    stage: "parse",
    source_span: { start: [1, 1], end: [1, 2] },
    params: {},
  };
  // A fresh array with the exact same structured content — as the diagnostics/run controllers
  // republish on every parse/run — must not be announced as "new".
  state.setDiagnostics([{ ...diagnostic }]);
  state.setDiagnostics([{ ...diagnostic }]);
  // Re-setting the same (still-empty) diagnostics list after a clean run/edit is likewise a no-op.
  state.setDiagnostics([]);
  state.setDiagnostics([]);

  assert.deepEqual(announcer.getAnnouncements(), [
    { politeness: "assertive", message: "1 error found." },
    { politeness: "polite", message: "No diagnostics." },
  ]);
});

test("createA11yAnnouncer announces diagnostics changes using severity counts, not message prose", () => {
  const state = OL.createStudioState();
  const announcer = OL.createA11yAnnouncer(state);

  state.setDiagnostics([
    {
      code: "ol-bad-token",
      message: "this text is never inspected by the announcer",
      severity: "error",
      stage: "parse",
      source_span: { start: [1, 1], end: [1, 2] },
      params: {},
    },
  ]);

  assert.deepEqual(announcer.getAnnouncements(), [
    { politeness: "assertive", message: "1 error found." },
  ]);
});

test("createA11yAnnouncer announces multiple diagnostics with mixed severities, pluralized", () => {
  const state = OL.createStudioState();
  const announcer = OL.createA11yAnnouncer(state);

  const makeDiagnostic = (severity) => ({
    code: severity === "error" ? "ol-bad-token" : "ol-style-example",
    message: "irrelevant",
    severity,
    stage: "parse",
    source_span: { start: [1, 1], end: [1, 2] },
    params: {},
  });

  state.setDiagnostics([
    makeDiagnostic("error"),
    makeDiagnostic("error"),
    makeDiagnostic("warning"),
  ]);

  assert.deepEqual(announcer.getAnnouncements(), [
    { politeness: "assertive", message: "2 errors and 1 warning found." },
  ]);
});

test("createA11yAnnouncer pluralizes multiple warnings with no errors", () => {
  const state = OL.createStudioState();
  const announcer = OL.createA11yAnnouncer(state);

  const makeWarning = () => ({
    code: "ol-style-example",
    message: "irrelevant",
    severity: "warning",
    stage: "parse",
    source_span: { start: [1, 1], end: [1, 2] },
    params: {},
  });

  state.setDiagnostics([makeWarning(), makeWarning()]);

  assert.deepEqual(announcer.getAnnouncements(), [
    { politeness: "polite", message: "2 warnings found." },
  ]);
});

test("createA11yAnnouncer announces clearing diagnostics back to none, politely", () => {
  const state = OL.createStudioState();
  const announcer = OL.createA11yAnnouncer(state);

  state.setDiagnostics([
    {
      code: "ol-bad-token",
      message: "irrelevant",
      severity: "error",
      stage: "parse",
      source_span: { start: [1, 1], end: [1, 2] },
      params: {},
    },
  ]);
  state.setDiagnostics([]);

  assert.deepEqual(announcer.getAnnouncements()[1], {
    politeness: "polite",
    message: "No diagnostics.",
  });
});

test("createA11yAnnouncer.state is the exact same store instance passed in, not a copy", () => {
  const state = OL.createStudioState();
  const announcer = OL.createA11yAnnouncer(state);
  assert.equal(announcer.state, state);
});

test("two independent consumers of the same announcer observe identical announcements (single source of truth)", () => {
  const state = OL.createStudioState();
  const announcer = OL.createA11yAnnouncer(state);

  const consumerA = [];
  const consumerB = [];
  const unsubscribeA = announcer.subscribeAnnouncements((a) =>
    consumerA.push(a),
  );
  const unsubscribeB = announcer.subscribeAnnouncements((a) =>
    consumerB.push(a),
  );

  state.setRunStatus("running");
  state.setDiagnostics([
    {
      code: "ol-bad-token",
      message: "irrelevant",
      severity: "warning",
      stage: "parse",
      source_span: { start: [1, 1], end: [1, 2] },
      params: {},
    },
  ]);

  assert.deepEqual(consumerA, consumerB);
  assert.deepEqual(consumerA, announcer.getAnnouncements());

  unsubscribeA();
  unsubscribeB();
  state.setRunStatus("stopped");
  // Both unsubscribed, so neither list grows further even though the announcer keeps recording.
  assert.equal(consumerA.length, 2);
  assert.equal(consumerB.length, 2);
  assert.equal(announcer.getAnnouncements().length, 3);
});

test("createA11yAnnouncer composes with the real editor/run/diagnostics controllers end to end", () => {
  const state = OL.createStudioState();
  const shell = OL.createAppShell(state);
  const editor = OL.createEditorController(state);
  OL.mountEditorPane(shell, editor);
  const runController = OL.createRunController(state);
  OL.mountRunController(shell, runController);
  const announcer = OL.createA11yAnnouncer(state);

  editor.setText("print 2 + 3");
  runController.run();

  // `run()` replaces `diagnostics` with a fresh array, but it is structurally identical to the
  // starting (empty) diagnostics, so only the run-status transitions are announced — a clean run
  // does not spam a redundant "No diagnostics." announcement.
  const messages = announcer.getAnnouncements().map((a) => a.message);
  assert.deepEqual(messages, ["Run started.", "Run complete."]);
});

test("createTurtleStateRegion.getText describes the initial default turtle state immediately, via describeTurtleState", () => {
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  assert.equal(
    region.getText(),
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1",
  );
});

test("createTurtleStateRegion.state is the exact same store instance passed in, not a copy", () => {
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  assert.equal(region.state, state);
});

test("createTurtleStateRegion.getText updates when the turtle world changes", () => {
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);

  state.setTurtleWorld(
    singleTurtleWorld({
      position: [100, 0],
      heading: 90,
      penDown: true,
      color: "black",
      width: 1,
      shape: "turtle",
      visible: true,
    }),
  );

  assert.equal(
    region.getText(),
    "turtle at x 100 y 0 heading 90 degrees pen down color black width 1",
  );
});

test("createTurtleStateRegion does not notify for a same-reference re-set (no-op for the store's own change detection)", () => {
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const texts = [];
  region.subscribeText((text) => texts.push(text));

  const { turtleWorld, turtleState } = state.getState();
  state.setTurtleWorld(turtleWorld);
  assert.deepEqual(texts, []);

  // A genuine change is still delivered to the same listener.
  state.setTurtleWorld(singleTurtleWorld({ ...turtleState, heading: 90 }));
  assert.deepEqual(texts, [region.getText()]);
});

test("createTurtleStateRegion does not notify for a genuine no-op turtle event that still produces a fresh (but text-identical) turtle world", () => {
  // @openlogo/turtle's reduceTurtleState always spreads a new object for any state-bearing trace
  // event, even a no-op like a repeated pen_down while the pen is already down (the runtime emits
  // these; see execute-internal.ts's pen-change events), and reduceTurtleWorldState then hands
  // back a fresh world around it. A reference-equality check alone would wrongly re-notify
  // identical text on every such tick during a long animation — this proves the region instead
  // compares the rendered text, matching diagnosticsKey's precedent above.
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const texts = [];
  region.subscribeText((text) => texts.push(text));

  const { turtleState } = state.getState();
  assert.equal(turtleState.penDown, true, "the default turtle starts pen down");
  // A fresh object with the exact same field values as the current state — as a no-op pen_down/
  // set_color/etc. trace event's reducer output would be — must not be treated as a "change".
  state.setTurtleWorld(singleTurtleWorld({ ...turtleState }));
  assert.deepEqual(texts, []);

  // A genuine change afterward is still delivered.
  state.setTurtleWorld(singleTurtleWorld({ ...turtleState, penDown: false }));
  assert.deepEqual(texts, [region.getText()]);
});

test("createTurtleStateRegion.subscribeText only notifies listeners of changes after subscription, and unsubscribe stops delivery", () => {
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const texts = [];
  const unsubscribe = region.subscribeText((text) => texts.push(text));

  state.setTurtleWorld(
    singleTurtleWorld({
      ...state.getState().turtleState,
      position: [10, 0],
    }),
  );
  assert.deepEqual(texts, [
    "turtle at x 10 y 0 heading 0 degrees pen down color black width 1",
  ]);

  unsubscribe();
  state.setTurtleWorld(
    singleTurtleWorld({
      ...state.getState().turtleState,
      position: [20, 0],
    }),
  );
  // Unsubscribed, so no further notifications, even though getText() keeps tracking the change.
  assert.deepEqual(texts, [
    "turtle at x 10 y 0 heading 0 degrees pen down color black width 1",
  ]);
  assert.equal(
    region.getText(),
    "turtle at x 20 y 0 heading 0 degrees pen down color black width 1",
  );
});

test("two independent consumers of the same turtle-state region observe identical text (single source of truth)", () => {
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);

  const consumerA = [];
  const consumerB = [];
  region.subscribeText((text) => consumerA.push(text));
  region.subscribeText((text) => consumerB.push(text));

  state.setTurtleWorld(
    singleTurtleWorld({
      ...state.getState().turtleState,
      heading: 45,
    }),
  );

  assert.deepEqual(consumerA, consumerB);
  assert.deepEqual(consumerA, [region.getText()]);
});

test("the state text names the described turtle once the world holds more than one live turtle (#749, spec/rendering.md:193)", () => {
  // The #749 reproduction, as a screen reader hears it: `tell [ :a :b ]` / `forward 10` /
  // `ask :b [ hide_turtle set_color "blue" ]`. Before the fix the region announced ":b's" blue,
  // hidden attributes with no identity at all — indistinguishable from the one turtle a
  // Turtle & Rendering program has. Now the text names which turtle it is describing.
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const base = {
    position: [0, 10],
    heading: 0,
    penDown: true,
    width: 1,
    shape: "turtle",
  };
  state.setTurtleWorld({
    turtles: new Map([
      [0, { ...base, position: [0, 0], color: "black", visible: true }],
      [1, { ...base, color: "black", visible: true }],
      [2, { ...base, color: "blue", visible: false }],
    ]),
    lastActedTurtleId: 2,
  });

  assert.equal(
    region.getText(),
    "turtle #2 at x 0 y 10 heading 0 degrees pen down color blue width 1 hidden",
  );
});

test("the state region names a turtle exactly as the output pane does, so the two text channels agree (#749)", () => {
  // A screen-reader user has only text: the output pane (`print who` -> "turtle #2") and this
  // region. If the region used a creation-order ordinal it would call that same turtle "turtle 3",
  // contradicting the output pane by one for every turtle, forever. Driving a real program end to
  // end proves the two channels agree on the name.
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const controller = OL.createRunController(state);
  state.setSource(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell :b",
      "forward 10",
      "print who",
    ].join("\n"),
  );
  controller.run();

  const printedName = state.getState().output.at(-1);
  assert.equal(printedName, "turtle #2");
  assert.ok(
    region.getText().startsWith(`${printedName} at x `),
    `the state region must name the turtle "${printedName}", got: ${region.getText()}`,
  );
});

test("the state text identifies the whole addressed turtle set, end to end from a real program (#770, spec/rendering.md:193)", () => {
  // `tell [ :a :b ]` addresses two turtles at once, and no single turtle is "the" answer: the
  // per-turtle effects that follow name whichever turtle each one drove. Driving the real runtime
  // proves the addressing snapshots #766 publishes survive the whole chain — runtime → trace
  // stream → `reduceTurtleWorldState` → this region — and reach a screen reader as the set.
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const controller = OL.createRunController(state);
  state.setSource(
    [":a = new_turtle", ":b = new_turtle", "tell [ :a :b ]", "forward 10"].join(
      "\n",
    ),
  );
  controller.run();

  assert.equal(
    region.getText(),
    "addressed turtles #1 #2. turtle #2 at x 0 y 10 heading 0 degrees pen down color black width 1 current instruction forward 10",
  );
  // Both addressed turtles really did move — the text names the set precisely because describing
  // one of them alone would be describing half the drawing.
  const { turtleWorld } = state.getState();
  assert.deepEqual(turtleWorld.turtles.get(1).position, [0, 10]);
  assert.deepEqual(turtleWorld.turtles.get(2).position, [0, 10]);
});

test("the state text follows an ask block in and back out again, end to end (#770)", () => {
  // #770's acceptance criterion as a learner hears it. Inside `ask :b [ … ]` only `:b` is
  // addressed, and `:b` is also what acts, so the text is the plain `turtle #2` sentence; when the
  // block ends the runtime restores `{ :a, :b }` (spec/turtles-and-sprites.md:58) and the text
  // names that set again — while still reporting `:b`'s state, because `:b` is what changed.
  //
  // The restore lands in the SAME step as the block's last inner instruction (a step spans one
  // `instruction` event to the next), so that final sentence carries both halves of the step at
  // once: the set that is addressed again, and the change the step actually made. Describing the
  // restored turtle instead would announce `:a`, still black — and `:b` turning blue would never
  // be announced at all (rubber-duck finding 1 on this slice).
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const controller = OL.createRunController(state);
  state.setSource(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell [ :a :b ]",
      "forward 10",
      'ask :b [ set_color "blue" ]',
    ].join("\n"),
  );

  controller.step(); // :a = new_turtle
  controller.step(); // :b = new_turtle
  controller.step(); // tell [ :a :b ]
  assert.match(region.getText(), /^addressed turtles #1 #2\. turtle #/);

  controller.step(); // forward 10
  controller.step(); // ask :b [ … ] — its entry narrows the addressed set to { :b }
  assert.equal(
    region.getText(),
    'turtle #2 at x 0 y 10 heading 0 degrees pen down color black width 1 current instruction ask :b [ set_color "blue" ]',
  );

  controller.step(); // the block's inner instruction — and, in the same step, the exit's restore
  assert.equal(
    region.getText(),
    'addressed turtles #1 #2. turtle #2 at x 0 y 10 heading 0 degrees pen down color blue width 1 current instruction set_color "blue"',
  );
  // The restored set is named, and the turtle that actually turned blue is the one described.
  const { turtleWorld } = state.getState();
  assert.equal(turtleWorld.lastActedTurtleId, 2);
  assert.equal(turtleWorld.turtles.get(2).color, "blue");
  assert.equal(turtleWorld.turtles.get(1).color, "black");
});

test("the state text says plainly when a program addresses no turtle at all (#770)", () => {
  // `tell [ ]` addresses nothing, and the spec defines no current turtle for an empty set — the
  // stream reports `current_turtle_id: null` and leaves the display fallback to the consumer.
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const controller = OL.createRunController(state);
  state.setSource(
    [":a = new_turtle", "tell :a", "forward 10", "tell [ ]"].join("\n"),
  );
  controller.run();

  assert.equal(
    region.getText(),
    "no addressed turtles. turtle #1 at x 0 y 10 heading 0 degrees pen down color black width 1 current instruction tell [ ]",
  );
});

test("the state text of a Turtle & Rendering program never names a turtle (byte-identical to spec/rendering.md's example)", () => {
  // The compatibility half of #749: naming the described turtle must not leak into the
  // wording `spec/rendering.md:193` gives verbatim. The condition is one live turtle addressing
  // itself, which no Turtle & Rendering program can leave — `tell` is a Sprites primitive.
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  state.setTurtleWorld(
    singleTurtleWorld({
      position: [100, 0],
      heading: 90,
      penDown: true,
      color: "black",
      width: 1,
      shape: "turtle",
      visible: true,
    }),
  );
  assert.equal(
    region.getText(),
    "turtle at x 100 y 0 heading 90 degrees pen down color black width 1",
  );
});

test("createTurtleStateRegion composes with the real run controller end to end, in lockstep with the canvas turtle state, and includes the current source instruction (#410)", () => {
  const state = OL.createStudioState();
  const shell = OL.createAppShell(state);
  const editor = OL.createEditorController(state);
  OL.mountEditorPane(shell, editor);
  const runController = OL.createRunController(state);
  OL.mountRunController(shell, runController);
  const region = OL.createTurtleStateRegion(state);

  editor.setText("forward 100");
  runController.run();

  assert.equal(
    region.getText(),
    "turtle at x 0 y 100 heading 0 degrees pen down color black width 1 current instruction forward 100",
  );
});

test("createTurtleStateRegion omits the current-instruction clause entirely before any run/step (#410)", () => {
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  assert.equal(
    region.getText(),
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1",
  );
  assert.doesNotMatch(region.getText(), /current instruction/);
});

test("createTurtleStateRegion appends the current instruction's exact source text per step (#410)", () => {
  const state = OL.createStudioState();
  const shell = OL.createAppShell(state);
  const editor = OL.createEditorController(state);
  OL.mountEditorPane(shell, editor);
  const runController = OL.createRunController(state);
  OL.mountRunController(shell, runController);
  const region = OL.createTurtleStateRegion(state);

  editor.setText("forward 100\nright 90");
  runController.step(); // consumes "forward 100" — the first instruction.

  assert.match(region.getText(), /current instruction forward 100$/);

  runController.step(); // consumes "right 90" — the second instruction.

  assert.match(region.getText(), /current instruction right 90$/);
});

test("createTurtleStateRegion's current-instruction clause is cleared by reset() (#410)", () => {
  const state = OL.createStudioState();
  const shell = OL.createAppShell(state);
  const editor = OL.createEditorController(state);
  OL.mountEditorPane(shell, editor);
  const runController = OL.createRunController(state);
  OL.mountRunController(shell, runController);
  const region = OL.createTurtleStateRegion(state);

  editor.setText("forward 100");
  runController.run();
  assert.match(region.getText(), /current instruction/);

  runController.reset();
  assert.doesNotMatch(region.getText(), /current instruction/);
});

test("createTurtleStateRegion reduces a multi-line current-instruction span to its head line plus a count, never splicing the block (#778, was #410's verbatim join)", () => {
  // #410 joined every covered line into the live region verbatim. #778 replaced that: the region
  // text then contained the block's body lines as well as its head, and a block head recurs (2 of
  // 18 announcements for a four-line `repeat`), so those body lines were carried repeatedly.
  const state = OL.createStudioState();
  state.setSource("forward 100\nright 90\nback 50");
  state.setCurrentInstructionSourceSpan({
    document: "editor",
    start: [1, 1],
    end: [3, 8],
  });
  const region = OL.createTurtleStateRegion(state);
  assert.equal(
    region.getText(),
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1 current instruction forward 100, plus 2 more lines",
  );
  assert.doesNotMatch(region.getText(), /\n/);
  assert.doesNotMatch(region.getText(), /right 90|back 50/);
});

test("createTurtleStateRegion leaves a single-line current-instruction span byte-identical (#778)", () => {
  // The compatibility half: #410's wording is unchanged for every one-line instruction, which is
  // every instruction the #410 tests above cover.
  const state = OL.createStudioState();
  state.setSource("forward 100\nright 90");
  state.setCurrentInstructionSourceSpan({
    document: "editor",
    start: [1, 1],
    end: [1, 12],
  });
  const region = OL.createTurtleStateRegion(state);
  assert.equal(
    region.getText(),
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1 current instruction forward 100",
  );
});

test("createTurtleStateRegion defensively tolerates a current-instruction span whose lines are out of range for the current source, omitting the clause rather than throwing (#410, #778)", () => {
  // In normal operation this can't happen: state-model.ts's setSource()/setSourceAndSelection()
  // always clear currentInstructionSourceSpan to null on every edit (see the "clears the
  // current-instruction span whenever the source is edited" tests below), so a real learner
  // editing mid-run can never observe a stale span. This test bypasses that guard by calling
  // setCurrentInstructionSourceSpan() directly (as a headless test double for a future producer,
  // not via the editor) purely to exercise extractSourceSpanText's defensive out-of-range
  // fallback and keep it under coverage, not to describe a reachable user scenario.
  //
  // #778: the fallback used to speak `current instruction ` followed by two bare newlines. There
  // is no instruction text to name, so the clause is now omitted entirely — the same "omitted,
  // never a placeholder" rule a null span already followed.
  const state = OL.createStudioState();
  state.setSource("forward 100");
  state.setCurrentInstructionSourceSpan({
    document: "editor",
    start: [2, 1],
    end: [4, 5],
  });
  const region = OL.createTurtleStateRegion(state);
  assert.doesNotThrow(() => region.getText());
  assert.equal(
    region.getText(),
    "turtle at x 0 y 0 heading 0 degrees pen down color black width 1",
  );
  assert.doesNotMatch(region.getText(), /current instruction/);
});

// --- #778: what the region text carries across a whole run ---
//
// These assert the announcement VECTOR, not a total. Both defects were re-derived on the saga tip
// by driving every runnable `spec/examples/*.logo` through this region: 163/1423 texts spliced a
// multi-line block, 1018/1423 carried raw float noise in x, y or heading.

test("no announcement in a whole run carries a newline or raw float noise (#778)", () => {
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const controller = OL.createRunController(state);
  state.setSource(
    ["repeat 4", "  forward 80", "  right 90", "end repeat"].join("\n"),
  );
  const announcements = [region.getText()];
  region.subscribeText((text) => announcements.push(text));
  controller.run();

  // Control: a clean sweep means nothing unless announcements actually happened.
  assert.ok(
    announcements.length > 5,
    `expected several announcements, got ${announcements.length}`,
  );
  for (const text of announcements) {
    assert.doesNotMatch(text, /\n/);
    assert.doesNotMatch(text, /\d\.\d{4,}|\de[+-]\d+/);
  }

  // The turtle's real, un-rounded position at the closing corner IS float noise — so the clean
  // `x 0 y 0` announcement is this slice's rounding at work, not a coincidentally exact program.
  const [x, y] = state.getState().turtleWorld.turtles.get(0).position;
  assert.notEqual(x, 0);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9, `x=${x} y=${y}`);
  assert.match(announcements.at(-1), /^turtle at x 0 y 0 heading 0 degrees /);
});

test("a block instruction is announced by its head line, and its body lines never are (#778)", () => {
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const controller = OL.createRunController(state);
  state.setSource(
    ["repeat 4", "  forward 80", "  right 90", "end repeat"].join("\n"),
  );
  const announcements = [region.getText()];
  region.subscribeText((text) => announcements.push(text));
  controller.run();

  assert.ok(
    announcements.some((text) =>
      text.endsWith("current instruction repeat 4, plus 3 more lines"),
    ),
    `no head-line announcement in ${JSON.stringify(announcements)}`,
  );
  // `end repeat` is a line of the block that is never itself the current instruction; before
  // #778 the region text contained it whenever the block head was the current instruction.
  assert.ok(
    announcements.every((text) => !text.includes("end repeat")),
    "an elided block line was announced as the current instruction",
  );
});

test("a repeatedly-firing handler is announced by the same head-line rule, and identical text is never re-announced (#778)", () => {
  // The `every`/handler case: instructions arrive repeatedly, so any per-tick verbosity is paid
  // over and over. The rule does not change — the head line is the actionable identity — and the
  // region's existing text-equality guard still means a tick that changes nothing says nothing.
  const state = OL.createStudioState();
  const region = OL.createTurtleStateRegion(state);
  const controller = OL.createRunController(state);
  state.setSource(
    [
      "every 2 [",
      "  forward 10",
      "  right 90",
      "]",
      "repeat 8",
      "  wait 1",
      "end repeat",
    ].join("\n"),
  );
  const announcements = [region.getText()];
  region.subscribeText((text) => announcements.push(text));
  controller.run();

  assert.equal(state.getState().diagnostics.length, 0);
  assert.ok(
    announcements.some((text) =>
      text.endsWith("current instruction every 2 [, plus 3 more lines"),
    ),
    `no handler head-line announcement in ${JSON.stringify(announcements)}`,
  );
  for (const text of announcements) {
    assert.doesNotMatch(text, /\n/);
  }
  // No two consecutive announcements are identical — the region still only speaks real changes.
  for (let index = 1; index < announcements.length; index += 1) {
    assert.notEqual(announcements[index], announcements[index - 1]);
  }
});

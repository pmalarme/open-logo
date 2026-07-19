import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

test("REPL_FOCUS_ORDER covers every REPL region with unique, stable ids", () => {
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
    ["diagnostics", "editor", "repl"].sort(),
    "focus order must span exactly the editor, repl, and diagnostics regions",
  );

  for (const stop of order) {
    assert.ok(
      stop.label.length > 0,
      `stop "${stop.id}" must have a non-empty label`,
    );
  }
});

test("REPL_FOCUS_ORDER puts the editor first and diagnostics last, with Run/Stop/Reset in between", () => {
  const order = OL.REPL_FOCUS_ORDER;
  assert.equal(order[0]?.id, "editor");
  assert.equal(order[order.length - 1]?.id, "diagnostics-list");

  const replStops = order.filter((stop) => stop.region === "repl");
  assert.deepEqual(
    replStops.map((stop) => stop.label),
    ["Run", "Stop", "Reset"],
  );
  for (const stop of replStops) {
    assert.equal(stop.role, "button");
  }
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

test("REPL_LANDMARK_ROLES declares one landmark per REPL region with a role and label", () => {
  const landmarks = OL.REPL_LANDMARK_ROLES;
  assert.deepEqual(
    landmarks.map((landmark) => landmark.region).sort(),
    ["diagnostics", "editor", "repl"].sort(),
  );
  const byRegion = new Map(
    landmarks.map((landmark) => [landmark.region, landmark]),
  );
  assert.equal(byRegion.get("editor")?.role, "textbox");
  assert.equal(byRegion.get("repl")?.role, "toolbar");
  assert.equal(byRegion.get("diagnostics")?.role, "log");
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
  state.setRunStatus("stopped");
  state.setRunStatus("idle");

  assert.deepEqual(announcer.getAnnouncements(), [
    { politeness: "polite", message: "Run started." },
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
  assert.deepEqual(messages, ["Run started.", "Ready."]);
});

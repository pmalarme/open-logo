import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

test("createStudioState returns the documented initial snapshot", () => {
  const store = OL.createStudioState();
  const state = store.getState();

  assert.equal(state.source, "");
  assert.deepEqual(state.selection, { anchor: [1, 1], head: [1, 1] });
  assert.equal(state.runStatus, "idle");
  assert.deepEqual(state.diagnostics, []);
  assert.deepEqual(state.lesson, { lessonId: null, title: null });
});

test("createStudioState honors provided initial values", () => {
  const store = OL.createStudioState({
    source: "forward 100",
    runStatus: "running",
  });
  const state = store.getState();

  assert.equal(state.source, "forward 100");
  assert.equal(state.runStatus, "running");
});

test("getState is stable by reference until the next mutation", () => {
  const store = OL.createStudioState();
  const before = store.getState();

  assert.equal(store.getState(), before);

  store.setSource("right 90");
  const after = store.getState();

  assert.notEqual(after, before);
  assert.equal(store.getState(), after);
});

test("two consumers of the same store observe identical state after an update (no desync)", () => {
  const store = OL.createStudioState();

  // Simulate two independent panes that each hold only the shared store instance.
  const paneA = { readSource: () => store.getState().source };
  const paneB = { readSource: () => store.getState().source };

  assert.equal(paneA.readSource(), paneB.readSource());

  store.setSource("repeat 4 [ forward 50 right 90 ]");

  assert.equal(paneA.readSource(), "repeat 4 [ forward 50 right 90 ]");
  assert.equal(paneA.readSource(), paneB.readSource());
});

test("subscribe notifies listeners synchronously with the new snapshot on every set*", () => {
  const store = OL.createStudioState();
  const seen = [];
  store.subscribe((state) => seen.push(state));

  store.setSource("forward 10");
  store.setSelection({ anchor: [1, 1], head: [1, 5] });
  store.setRunStatus("running");
  store.setDiagnostics([
    {
      code: "ol-unknown-command",
      source_span: { document: "main.logo", start: [1, 1], end: [1, 3] },
      params: {},
      message: "unknown command",
      stage: "semantic",
      severity: "error",
    },
  ]);
  store.setLesson({ lessonId: "l1", title: "Squares" });

  assert.equal(seen.length, 5);
  assert.equal(seen[0].source, "forward 10");
  assert.deepEqual(seen[1].selection, { anchor: [1, 1], head: [1, 5] });
  assert.equal(seen[2].runStatus, "running");
  assert.equal(seen[3].diagnostics.length, 1);
  assert.deepEqual(seen[4].lesson, { lessonId: "l1", title: "Squares" });

  // Every notification carries the current getState() snapshot, so subscribers and getState()
  // agree — no separate copy that could drift.
  assert.equal(seen.at(-1), store.getState());
});

test("subscribe returns an unsubscribe function that stops further notifications", () => {
  const store = OL.createStudioState();
  const seen = [];
  const unsubscribe = store.subscribe((state) => seen.push(state));

  store.setSource("a");
  unsubscribe();
  store.setSource("b");

  assert.equal(seen.length, 1);
  assert.equal(seen[0].source, "a");
  assert.equal(store.getState().source, "b");
});

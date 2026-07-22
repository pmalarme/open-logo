import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

test("createTutorOutputController starts with an empty, absent-until-run view", () => {
  const store = OL.createStudioState();
  const tutorOutput = OL.createTutorOutputController(store);

  assert.deepEqual(tutorOutput.getEntries(), []);
  assert.equal(tutorOutput.state, store);
  assert.deepEqual(tutorOutput.getView(), { isVisible: false, items: [] });
});

test("run-controller.ts injects @openlogo/edu's real explain template (not the runtime's minimal default)", () => {
  const store = OL.createStudioState({ source: "forward 10\nexplain" });
  const tutorOutput = OL.createTutorOutputController(store);
  const controller = OL.createRunController(store);

  controller.run();

  const entries = tutorOutput.getEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].payload.command, "explain");
  assert.ok(entries[0].payload.segments.length > 0);
  assert.notEqual(
    entries[0].payload.segments[0],
    "Here is what the previous instruction does.",
    "the runtime's minimal defaultTutorTemplate fallback text must NOT appear — the studio's " +
      "own eduTutorTemplate adapter must have produced this segment instead",
  );
});

test("createTutorOutputController surfaces EVERY progressive hint stage from repeated hint invocations in one run, not just the first", () => {
  const store = OL.createStudioState({
    source: "forward 10\nhint\nhint\nhint\nhint\nhint",
  });
  const tutorOutput = OL.createTutorOutputController(store);
  const controller = OL.createRunController(store);

  controller.run();

  const stages = tutorOutput.getEntries().map((entry) => entry.payload.stage);
  assert.deepEqual(stages, [
    "nudge",
    "concept",
    "partial",
    "last-resort",
    "last-resort",
  ]);
});

test("createTutorOutputController accumulates tutor-output entries across separate runs, never replacing earlier history", () => {
  const store = OL.createStudioState({ source: "forward 10\nhint" });
  const tutorOutput = OL.createTutorOutputController(store, {
    now: () => 1000,
  });
  const controller = OL.createRunController(store);

  controller.run();
  assert.equal(tutorOutput.getEntries().length, 1);
  assert.equal(tutorOutput.getEntries()[0].payload.stage, "nudge");

  // A second, independent run's own `hint` invocation starts its OWN progression back at
  // "nudge" (execute()'s hintProgress resets every call, spec/execution-model.md:640-652) — but
  // the PANE's history must still keep both entries, visible side by side.
  controller.run();
  const entries = tutorOutput.getEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries[1].payload.stage, "nudge");
});

test("createTutorOutputController never records a reset() (idle transition), only completed runs", () => {
  const store = OL.createStudioState({ source: "explain" });
  const tutorOutput = OL.createTutorOutputController(store);
  const controller = OL.createRunController(store);

  controller.run();
  assert.equal(tutorOutput.getEntries().length, 1);

  controller.reset();
  assert.equal(
    tutorOutput.getEntries().length,
    1,
    "reset() must not append or drop any tutor-output history",
  );
});

test("createTutorOutputController records a run with no tutor-output events as zero entries", () => {
  const store = OL.createStudioState({ source: "forward 10" });
  const tutorOutput = OL.createTutorOutputController(store);
  const controller = OL.createRunController(store);

  controller.run();
  assert.deepEqual(tutorOutput.getEntries(), []);
  assert.deepEqual(tutorOutput.getView(), { isVisible: false, items: [] });
});

test("subscribeEntries notifies listeners with each newly appended entry, and unsubscribe stops further notifications", () => {
  const store = OL.createStudioState({ source: "explain" });
  const tutorOutput = OL.createTutorOutputController(store, {
    now: () => 42,
  });
  const seen = [];
  const unsubscribe = tutorOutput.subscribeEntries((entry) => seen.push(entry));
  const controller = OL.createRunController(store);

  controller.run();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].recordedAt, 42);

  unsubscribe();
  store.setSource("why");
  controller.run();
  assert.equal(
    seen.length,
    1,
    "a listener must not be notified after unsubscribing",
  );
  // The controller itself keeps recording regardless of listener subscriptions.
  assert.equal(tutorOutput.getEntries().length, 2);
});

test("createTutorOutputController uses Date.now by default when no clock is injected", () => {
  const store = OL.createStudioState({ source: "explain" });
  const tutorOutput = OL.createTutorOutputController(store);
  const controller = OL.createRunController(store);

  const before = Date.now();
  controller.run();
  const after = Date.now();

  const [entry] = tutorOutput.getEntries();
  assert.ok(entry.recordedAt >= before && entry.recordedAt <= after);
});

test("toTutorOutputListItems projects a plain command heading for explain/why/debug", () => {
  const items = OL.toTutorOutputListItems([
    {
      id: 1,
      recordedAt: 1000,
      payload: { command: "explain", segments: ["Forward moves the turtle."] },
    },
    {
      id: 2,
      recordedAt: 2000,
      payload: {
        command: "why",
        diagnostic_code: undefined,
        segments: ["The program ran without error."],
      },
    },
    {
      id: 3,
      recordedAt: 3000,
      payload: {
        command: "debug",
        diagnostic_code: undefined,
        segments: ["Nothing looks wrong yet."],
      },
    },
  ]);

  assert.deepEqual(items, [
    {
      id: 1,
      heading: "explain",
      segments: ["Forward moves the turtle."],
    },
    { id: 2, heading: "why", segments: ["The program ran without error."] },
    { id: 3, heading: "debug", segments: ["Nothing looks wrong yet."] },
  ]);
});

test("toTutorOutputListItems projects a stage-qualified heading for hint", () => {
  const items = OL.toTutorOutputListItems([
    {
      id: 1,
      recordedAt: 1000,
      payload: {
        command: "hint",
        stage: "concept",
        target_source_span: {
          document: "test",
          start: [1, 1],
          end: [1, 10],
        },
        segments: ["Think about how repetition could help here."],
      },
    },
  ]);

  assert.deepEqual(items, [
    {
      id: 1,
      heading: "hint — concept",
      segments: ["Think about how repetition could help here."],
    },
  ]);
});

test("toTutorOutputListItems returns an empty list for no entries", () => {
  assert.deepEqual(OL.toTutorOutputListItems([]), []);
});

test("mountTutorOutputPane mounts the controller into the app shell's 'tutor' region", () => {
  const store = OL.createStudioState();
  const shell = OL.createAppShell(store);
  const tutorOutput = OL.createTutorOutputController(store);

  OL.mountTutorOutputPane(shell, tutorOutput);

  assert.equal(shell.getRegion("tutor").content, tutorOutput);
});

test("eduTutorTemplate dispatches explain/why/hint/debug to @openlogo/edu's own per-command templates", () => {
  const store = OL.createStudioState({
    source: "forward 10\nexplain\nwhy\nhint\ndebug",
  });
  const tutorOutput = OL.createTutorOutputController(store);
  const controller = OL.createRunController(store);

  controller.run();

  const commands = tutorOutput
    .getEntries()
    .map((entry) => entry.payload.command);
  assert.deepEqual(commands, ["explain", "why", "hint", "debug"]);
});

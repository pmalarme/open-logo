import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

const {
  DEFAULT_RUN_PROGRAM,
  NO_DIAGNOSTICS_LABEL,
  toDiagnosticListItems,
  createTimeoutScheduler,
  formatOutput,
} = OL;

test("DEFAULT_RUN_PROGRAM is the canonical acceptance square", () => {
  assert.equal(DEFAULT_RUN_PROGRAM, "repeat 4 [ forward 100 right 90 ]");
});

test("toDiagnosticListItems returns the synthetic empty-state item for no diagnostics", () => {
  assert.deepEqual(toDiagnosticListItems([]), [
    { code: "", severity: "info", label: NO_DIAGNOSTICS_LABEL },
  ]);
});

test("NO_DIAGNOSTICS_LABEL is a fixed, learner-facing constant", () => {
  assert.equal(NO_DIAGNOSTICS_LABEL, "No diagnostics.");
});

test("toDiagnosticListItems formats one fully-labeled item per diagnostic", () => {
  const diagnostics = [
    {
      code: "ol-unknown-command",
      source_span: {
        document: "studio-session",
        start: [1, 1],
        end: [1, 8],
      },
      params: { name: "fowad", suggestion: "forward" },
      message: "i don't know how to fowad. did you mean forward?",
      stage: "semantic",
      severity: "error",
    },
    {
      code: "ol-style-todo",
      source_span: {
        document: "studio-session",
        start: [2, 5],
        end: [2, 9],
      },
      params: {},
      message: "Style nit.",
      stage: "semantic",
      severity: "warning",
    },
  ];

  assert.deepEqual(toDiagnosticListItems(diagnostics), [
    {
      code: "ol-unknown-command",
      severity: "error",
      label:
        "1:1 ol-unknown-command (error): i don't know how to fowad. did you mean forward?",
    },
    {
      code: "ol-style-todo",
      severity: "warning",
      label: "2:5 ol-style-todo (warning): Style nit.",
    },
  ]);
});

test("createTimeoutScheduler schedules via the injected setTimeout with the fixed delay", () => {
  const calls = [];
  let nextHandle = 0;
  const scheduler = createTimeoutScheduler(150, {
    setTimeout: (callback, delayMs) => {
      calls.push(["setTimeout", delayMs]);
      callback();
      return ++nextHandle;
    },
    clearTimeout: (handle) => {
      calls.push(["clearTimeout", handle]);
    },
  });

  let invoked = false;
  const cancel = scheduler(() => {
    invoked = true;
  }, 999);
  cancel();

  assert.equal(invoked, true);
  assert.deepEqual(calls, [
    ["setTimeout", 150],
    ["clearTimeout", 1],
  ]);
});

test("createTimeoutScheduler ignores the caller's own delayMs and always uses its fixed delay", () => {
  const seenDelays = [];
  const clearedHandles = [];
  const invokedCallbacks = [];
  const scheduler = createTimeoutScheduler(75, {
    setTimeout: (callback, delayMs) => {
      seenDelays.push(delayMs);
      callback();
      return "handle";
    },
    clearTimeout: (handle) => {
      clearedHandles.push(handle);
    },
  });

  const firstCancel = scheduler(() => {
    invokedCallbacks.push("first");
  }, 1);
  const secondCancel = scheduler(() => {
    invokedCallbacks.push("second");
  }, 10000);
  firstCancel();
  secondCancel();

  assert.deepEqual(seenDelays, [75, 75]);
  assert.deepEqual(invokedCallbacks, ["first", "second"]);
  assert.deepEqual(clearedHandles, ["handle", "handle"]);
});

test("createTimeoutScheduler's returned cancel function calls the injected clearTimeout with the same handle", () => {
  const calls = [];
  let invoked = false;
  const scheduler = createTimeoutScheduler(50, {
    setTimeout: (callback) => {
      callback();
      return "the-handle";
    },
    clearTimeout: (handle) => {
      calls.push(handle);
    },
  });

  const cancel = scheduler(() => {
    invoked = true;
  }, 50);
  cancel();

  assert.equal(invoked, true);
  assert.deepEqual(calls, ["the-handle"]);
});

test("formatOutput joins output lines with newlines", () => {
  assert.equal(formatOutput(["42", "hello"]), "42\nhello");
});

test("formatOutput formats empty output as an empty string", () => {
  assert.equal(formatOutput([]), "");
});

test("formatOutput formats a single output line without a trailing newline", () => {
  assert.equal(formatOutput(["42"]), "42");
});

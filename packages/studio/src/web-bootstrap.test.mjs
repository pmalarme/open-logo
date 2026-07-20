import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

const {
  DEFAULT_RUN_PROGRAM,
  NO_DIAGNOSTICS_LABEL,
  toDiagnosticListItems,
  createTimeoutScheduler,
  formatOutput,
  selectScheduler,
  assertPresent,
  syncTextValue,
  createKeyValueStorageAdapter,
  ANNOUNCER_POLITE_ELEMENT_ID,
  ANNOUNCER_ASSERTIVE_ELEMENT_ID,
  selectAnnouncerElementId,
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

test("selectScheduler picks the immediate scheduler when reduced motion is requested", () => {
  // Plain marker objects (not functions) are enough here: selectScheduler only ever
  // returns one of its two inputs by reference, it never calls either — using function
  // fakes would leave their bodies permanently uncovered since they're never invoked.
  const timeoutScheduler = { name: "timeout" };
  const immediateScheduler = { name: "immediate" };

  assert.equal(
    selectScheduler(true, timeoutScheduler, immediateScheduler),
    immediateScheduler,
  );
});

test("selectScheduler picks the timeout scheduler when reduced motion is not requested", () => {
  const timeoutScheduler = { name: "timeout" };
  const immediateScheduler = { name: "immediate" };

  assert.equal(
    selectScheduler(false, timeoutScheduler, immediateScheduler),
    timeoutScheduler,
  );
});

test("createKeyValueStorageAdapter's save delegates to the storage's setItem", () => {
  const calls = [];
  const adapter = createKeyValueStorageAdapter(() => ({
    setItem: (key, value) => calls.push(["setItem", key, value]),
  }));

  adapter.save("openlogo.studio.source", "forward 10");

  assert.deepEqual(calls, [
    ["setItem", "openlogo.studio.source", "forward 10"],
  ]);
});

test("createKeyValueStorageAdapter's load delegates to the storage's getItem and forwards null", () => {
  const adapterWithValue = createKeyValueStorageAdapter(() => ({
    getItem: () => "forward 10",
  }));
  const adapterWithNothingStored = createKeyValueStorageAdapter(() => ({
    getItem: () => null,
  }));

  assert.equal(adapterWithValue.load("openlogo.studio.source"), "forward 10");
  assert.equal(adapterWithNothingStored.load("openlogo.studio.source"), null);
});

test("createKeyValueStorageAdapter's clear delegates to the storage's removeItem", () => {
  const calls = [];
  const adapter = createKeyValueStorageAdapter(() => ({
    removeItem: (key) => calls.push(["removeItem", key]),
  }));

  adapter.clear("openlogo.studio.source");

  assert.deepEqual(calls, [["removeItem", "openlogo.studio.source"]]);
});

test("createKeyValueStorageAdapter defers calling its storage getter until save/load/clear run", () => {
  let getStorageCalls = 0;
  const getStorage = () => {
    getStorageCalls += 1;
    throw new Error("localStorage is disabled");
  };

  const adapter = createKeyValueStorageAdapter(getStorage);
  assert.equal(
    getStorageCalls,
    0,
    "constructing the adapter must not access storage yet",
  );

  assert.throws(() => adapter.save("k", "v"), /localStorage is disabled/);
  assert.throws(() => adapter.load("k"), /localStorage is disabled/);
  assert.throws(() => adapter.clear("k"), /localStorage is disabled/);
  assert.equal(getStorageCalls, 3);
});

test("assertPresent returns the value when the default null-check predicate passes", () => {
  assert.equal(assertPresent("hello", "greeting"), "hello");
});

test("assertPresent throws a descriptive error when the value is null", () => {
  assert.throws(
    () => assertPresent(null, "editor"),
    /index\.html is missing an expected element: editor/,
  );
});

test("assertPresent throws a descriptive error when the value is undefined", () => {
  assert.throws(
    () => assertPresent(undefined, "2-D canvas context"),
    /index\.html is missing an expected element: 2-D canvas context/,
  );
});

test("assertPresent returns the value when a custom predicate passes", () => {
  const isPositiveNumber = (value) => typeof value === "number" && value > 0;
  assert.equal(assertPresent(42, "count", isPositiveNumber), 42);
});

test("assertPresent throws a descriptive error when a custom predicate fails", () => {
  const isPositiveNumber = (value) => typeof value === "number" && value > 0;
  assert.throws(
    () => assertPresent(-1, "count", isPositiveNumber),
    /index\.html is missing an expected element: count/,
  );
});

test("syncTextValue writes nextValue when it differs from the target's current value", () => {
  const target = { value: "old" };
  syncTextValue(target, "new");
  assert.equal(target.value, "new");
});

test("syncTextValue leaves the target untouched when nextValue matches the current value", () => {
  // A frozen target makes ANY write throw (this module is strict-mode ESM), so a clean run
  // proves `syncTextValue` skipped the assignment rather than merely reassigning the same
  // string back — without needing an accessor stub that would sit at 0% function coverage.
  const target = Object.freeze({ value: "same" });

  assert.doesNotThrow(() => syncTextValue(target, "same"));
  assert.equal(target.value, "same");
});

test("ANNOUNCER_POLITE_ELEMENT_ID and ANNOUNCER_ASSERTIVE_ELEMENT_ID are distinct fixed ids", () => {
  assert.equal(ANNOUNCER_POLITE_ELEMENT_ID, "announcer-polite");
  assert.equal(ANNOUNCER_ASSERTIVE_ELEMENT_ID, "announcer-assertive");
  assert.notEqual(ANNOUNCER_POLITE_ELEMENT_ID, ANNOUNCER_ASSERTIVE_ELEMENT_ID);
});

test("selectAnnouncerElementId routes a polite announcement to the polite region", () => {
  assert.equal(selectAnnouncerElementId("polite"), ANNOUNCER_POLITE_ELEMENT_ID);
});

test("selectAnnouncerElementId routes an assertive announcement to the assertive region", () => {
  assert.equal(
    selectAnnouncerElementId("assertive"),
    ANNOUNCER_ASSERTIVE_ELEMENT_ID,
  );
});

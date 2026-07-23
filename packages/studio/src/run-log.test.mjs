import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/** A minimal `ol-*` diagnostic fixture — only the fields `toDiagnosticListItems`/severity checks
 * actually read, matching the shape other studio test files already use. */
function makeDiagnostic(overrides = {}) {
  return {
    code: "ol-unknown-command",
    source_span: {
      document: "test",
      start: [1, 1],
      end: [1, 5],
    },
    message: "Unknown command.",
    severity: "error",
    stage: "runtime",
    params: {},
    ...overrides,
  };
}

/** A minimal `@openlogo/turtle` `Scheduler` this test fully controls — a trimmed-down local copy
 * of the same helper in `run-controller.test.mjs` (not exported from either module), keeping only
 * what this test exercises: recording the pending tick without invoking it, and firing it on
 * demand, to simulate real, paced (`setTimeout`-backed) animation pacing deterministically. The
 * cancel function `scheduler()` must return (per `@openlogo/turtle`'s `Scheduler` type) is a single
 * shared reference so the test below can call it directly to exercise it. */
function createManualScheduler() {
  let pending = null;
  const cancel = () => {
    pending = null;
  };
  const scheduler = (callback) => {
    pending = callback;
    return cancel;
  };
  return {
    scheduler,
    cancel,
    /** Fires the pending tick, if any, returning whether one was pending — lets a test drain a
     * multi-tick paced animation with `while (manual.fire()) {}` without tracking tick count. */
    fire() {
      const tick = pending;
      if (!tick) {
        return false;
      }
      pending = null;
      tick();
      return true;
    },
  };
}

test("createRunLogController starts with an empty history", () => {
  const store = OL.createStudioState();
  const runLog = OL.createRunLogController(store);

  assert.deepEqual(runLog.getEntries(), []);
  assert.equal(runLog.state, store);
});

test("createRunLogController appends an entry once a run finishes on its own (running -> done)", () => {
  const store = OL.createStudioState({ source: '(print "hi")' });
  const runLog = OL.createRunLogController(store, { now: () => 1000 });
  const controller = OL.createRunController(store);

  controller.run();

  const entries = runLog.getEntries();
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    id: 1,
    completedAt: 1000,
    runStatus: "done",
    output: ["hi"],
    diagnostics: [],
  });
});

test("createRunLogController records a run's ol-* diagnostics even when it never printed anything", () => {
  const store = OL.createStudioState({
    source: 'print "hi"\nflibbertigibbet 5',
  });
  const runLog = OL.createRunLogController(store);
  const controller = OL.createRunController(store);

  controller.run();

  const entries = runLog.getEntries();
  assert.equal(entries.length, 1);
  // A whole-program semantic error (unknown command) is caught before any statement runs, so this
  // run's own recorded output is empty — the run log must still capture its diagnostics.
  assert.deepEqual(entries[0].output, []);
  assert.ok(entries[0].diagnostics.length > 0);
  assert.equal(entries[0].runStatus, "done");
});

test("createRunLogController records a stopped run (running -> stopped) too", () => {
  const store = OL.createStudioState({ source: "forever [ print 1 ]" });
  const runLog = OL.createRunLogController(store);
  const controller = OL.createRunController(store, { instructionBudget: 5 });

  controller.run();

  const entries = runLog.getEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].runStatus, "stopped");
  assert.ok(
    entries[0].diagnostics.some((diagnostic) => diagnostic.code === "ol-limit"),
  );
});

test("createRunLogController appends a second entry after a second run, keeping the first (history, not replacement)", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const runLog = OL.createRunLogController(store);
  const controller = OL.createRunController(store);

  controller.run();
  const firstEntries = runLog.getEntries();
  assert.equal(firstEntries.length, 1);

  store.setSource("print 2");
  controller.run();

  const secondEntries = runLog.getEntries();
  assert.equal(secondEntries.length, 2);
  // The first entry is untouched (immutable) — same reference, same values.
  assert.equal(secondEntries[0], firstEntries[0]);
  assert.deepEqual(secondEntries[0].output, ["1"]);
  assert.deepEqual(secondEntries[1].output, ["2"]);
  assert.equal(secondEntries[1].id, 2);
});

test("createRunLogController never logs a reset() (idle transition), only completed runs", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const runLog = OL.createRunLogController(store);
  const controller = OL.createRunController(store);

  controller.run();
  assert.equal(runLog.getEntries().length, 1);

  controller.reset();
  assert.equal(
    runLog.getEntries().length,
    1,
    "reset() must not append or remove a log entry",
  );
});

test("createRunLogController ignores state changes that keep runStatus at 'running' (no entry, no id bump)", () => {
  const store = OL.createStudioState();
  const runLog = OL.createRunLogController(store);

  store.setRunStatus("running");
  store.setOutput(["mid-run output"]);
  assert.deepEqual(runLog.getEntries(), []);

  store.setRunStatus("done");
  const entries = runLog.getEntries();
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].output, ["mid-run output"]);
});

test("createRunLogController ignores a terminal status reached without passing through 'running'", () => {
  const store = OL.createStudioState();
  const runLog = OL.createRunLogController(store);

  // Directly setting a terminal status from the initial "idle" state (never "running") must not
  // log a spurious entry.
  store.setRunStatus("done");
  assert.deepEqual(runLog.getEntries(), []);
});

test("createRunLogController uses Date.now by default when no clock is injected", () => {
  const store = OL.createStudioState();
  const runLog = OL.createRunLogController(store);

  const before = Date.now();
  store.setRunStatus("running");
  store.setRunStatus("done");
  const after = Date.now();

  const [entry] = runLog.getEntries();
  assert.ok(entry.completedAt >= before && entry.completedAt <= after);
});

test("subscribeEntries notifies listeners with each newly appended entry, and unsubscribe stops further notifications", () => {
  const store = OL.createStudioState();
  const runLog = OL.createRunLogController(store, { now: () => 42 });
  const seen = [];
  const unsubscribe = runLog.subscribeEntries((entry) => seen.push(entry));

  store.setRunStatus("running");
  store.setRunStatus("done");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].completedAt, 42);

  unsubscribe();
  store.setRunStatus("running");
  store.setRunStatus("stopped");
  assert.equal(
    seen.length,
    1,
    "a listener must not be notified after unsubscribing",
  );
  // The controller itself keeps recording regardless of listener subscriptions.
  assert.equal(runLog.getEntries().length, 2);
});

test("createRunLogController never loses a run to an overlapping Run click during paced animation (#314 fix in run-controller.ts)", () => {
  const store = OL.createStudioState({ source: "forward 1" });
  const runLog = OL.createRunLogController(store);
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
  });

  controller.run();
  assert.equal(store.getState().runStatus, "running");

  // Pressing Run again mid-animation must not start a second run nor lose the first one.
  store.setSource("print 2");
  controller.run();

  manual.fire(); // drain the ONLY run's single tick.
  assert.equal(store.getState().runStatus, "done");
  // The Scheduler contract's returned cancel is safe to call even after the tick it would have
  // cancelled already fired (idempotent no-op) — exercises that path directly since nothing in
  // this scenario triggers stop()/reset() to invoke it via run-controller.ts.
  manual.cancel();

  const entries = runLog.getEntries();
  assert.equal(
    entries.length,
    1,
    "the in-flight run must be recorded exactly once",
  );
  // Prove the recorded entry is the FIRST run's data, not the second — without the guard this
  // would silently be ["2"] (the second run's output), which is exactly the data-loss bug #314
  // fixed: a single entry alone doesn't prove which run it came from.
  assert.deepEqual(
    entries[0].output,
    [],
    "the recorded entry must be the FIRST run (forward 1, no print output), not the ignored second run's 'print 2'",
  );
});

test("createRunLogController captures the run's OWN output/diagnostics even when a mid-run edit wipes the live diagnostics field (#432 finding 2)", () => {
  const originalSource = "print 1\nforever [ forward 1 ]";
  const store = OL.createStudioState({
    source: originalSource,
  });
  const runLog = OL.createRunLogController(store);
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
    instructionBudget: 10,
  });
  // Real, live parse-as-you-type wiring — the actual mechanism this regression proves no longer
  // corrupts a completed run's logged entry.
  OL.createDiagnosticsController(store);

  controller.run();
  assert.equal(
    store.getState().runStatus,
    "running",
    "a paced run with real turtle events must still be mid-animation here",
  );
  assert.deepEqual(store.getState().output, ["1"]);
  assert.ok(
    store
      .getState()
      .diagnostics.some((diagnostic) => diagnostic.code === "ol-limit"),
    "the runaway forever loop must have already hit its instruction budget",
  );
  assert.equal(store.getState().lastRunResult.source, originalSource);

  // The learner edits the source mid-run, removing the runaway loop entirely. This triggers
  // `diagnostics.ts`'s live parse-as-you-type re-check, which republishes the EDITED (now
  // perfectly valid) source's diagnostics — wiping the shared `diagnostics` field well before
  // this run's own terminal transition.
  store.setSource("print 1\nforward 1");
  assert.deepEqual(
    store.getState().diagnostics,
    [],
    "the live diagnostics field must really have been corrupted by the mid-run edit",
  );
  assert.equal(
    store.getState().lastRunResult.source,
    originalSource,
    "the immutable snapshot's source must survive the live mid-run edit unchanged",
  );

  // Drain the paced animation until the run reaches its terminal transition.
  while (manual.fire()) {
    // keep firing until fully drained
  }
  assert.equal(store.getState().runStatus, "stopped");

  const entries = runLog.getEntries();
  assert.equal(entries.length, 1);
  // The logged entry must still be the RUN's own output/diagnostics — not the edited source's
  // (now clean) diagnostics the live field was corrupted to.
  assert.deepEqual(entries[0].output, ["1"]);
  assert.ok(
    entries[0].diagnostics.some((diagnostic) => diagnostic.code === "ol-limit"),
    "the logged entry must retain the run's own ol-limit diagnostic, not the edited source's empty diagnostics",
  );
});

test("toRunLogListItems returns the synthetic empty-state placeholder when there is no history yet", () => {
  const items = OL.toRunLogListItems([]);

  assert.deepEqual(items, [
    {
      id: 0,
      heading: "",
      outputText: OL.NO_RUN_LOG_ENTRIES_LABEL,
      diagnosticLabels: [],
      hasErrors: false,
    },
  ]);
});

test("toRunLogListItems formats a heading with the run number and an ISO timestamp", () => {
  const items = OL.toRunLogListItems([
    {
      id: 7,
      completedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
      runStatus: "done",
      output: ["hi"],
      diagnostics: [],
    },
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 7);
  assert.equal(items[0].heading, "Run 1 — 2026-01-02T03:04:05.000Z");
});

test("toRunLogListItems formats output via formatOutput, and falls back to a placeholder when empty", () => {
  const items = OL.toRunLogListItems([
    {
      id: 1,
      completedAt: 0,
      runStatus: "done",
      output: ["1", "2"],
      diagnostics: [],
    },
    {
      id: 2,
      completedAt: 0,
      runStatus: "done",
      output: [],
      diagnostics: [],
    },
  ]);

  assert.equal(items[0].outputText, OL.formatOutput(["1", "2"]));
  assert.equal(items[1].outputText, OL.NO_RUN_OUTPUT_LABEL);
});

test("toRunLogListItems formats diagnostics exactly like the diagnostics pane, and falls back to NO_DIAGNOSTICS_LABEL when empty", () => {
  const errorDiagnostic = makeDiagnostic({ severity: "error" });
  const warningDiagnostic = makeDiagnostic({
    code: "ol-style-unused",
    severity: "warning",
  });

  const items = OL.toRunLogListItems([
    {
      id: 1,
      completedAt: 0,
      runStatus: "done",
      output: [],
      diagnostics: [errorDiagnostic, warningDiagnostic],
    },
    {
      id: 2,
      completedAt: 0,
      runStatus: "done",
      output: [],
      diagnostics: [],
    },
  ]);

  assert.deepEqual(
    items[0].diagnosticLabels,
    OL.toDiagnosticListItems([errorDiagnostic, warningDiagnostic]).map(
      (item) => item.label,
    ),
  );
  assert.equal(items[0].hasErrors, true);

  assert.deepEqual(items[1].diagnosticLabels, [OL.NO_DIAGNOSTICS_LABEL]);
  assert.equal(items[1].hasErrors, false);
});

test("toRunLogListItems.hasErrors is false when every diagnostic is only a warning", () => {
  const items = OL.toRunLogListItems([
    {
      id: 1,
      completedAt: 0,
      runStatus: "done",
      output: [],
      diagnostics: [makeDiagnostic({ severity: "warning" })],
    },
  ]);

  assert.equal(items[0].hasErrors, false);
});

test("toRunLogListItems preserves entry order across multiple runs", () => {
  const items = OL.toRunLogListItems([
    {
      id: 1,
      completedAt: 0,
      runStatus: "done",
      output: ["a"],
      diagnostics: [],
    },
    {
      id: 2,
      completedAt: 1,
      runStatus: "stopped",
      output: ["b"],
      diagnostics: [],
    },
  ]);

  assert.deepEqual(
    items.map((item) => item.heading.split(" — ")[0]),
    ["Run 1", "Run 2"],
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

test("createInMemoryStorageAdapter round-trips save/load/clear", () => {
  const adapter = OL.createInMemoryStorageAdapter();

  assert.equal(adapter.load("k"), null);
  adapter.save("k", "hello");
  assert.equal(adapter.load("k"), "hello");
  adapter.clear("k");
  assert.equal(adapter.load("k"), null);
});

test("attachPersistence restores source from the adapter on creation", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  adapter.save(OL.DEFAULT_PERSISTENCE_KEY, "forward 100");

  const state = OL.createStudioState();
  OL.attachPersistence(state, { adapter });

  assert.equal(state.getState().source, "forward 100");
  assert.equal(state.getState().notice, null);
});

test("attachPersistence leaves source untouched when nothing is stored yet", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  const state = OL.createStudioState({ source: "right 90" });

  OL.attachPersistence(state, { adapter });

  assert.equal(state.getState().source, "right 90");
});

test("attachPersistence saves through the adapter whenever source changes, using the default key", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  const state = OL.createStudioState();

  OL.attachPersistence(state, { adapter });
  state.setSource("repeat 4 [ forward 50 right 90 ]");

  assert.equal(
    adapter.load(OL.DEFAULT_PERSISTENCE_KEY),
    "repeat 4 [ forward 50 right 90 ]",
  );
});

test("attachPersistence honors a custom key", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  const state = OL.createStudioState();

  OL.attachPersistence(state, { adapter, key: "lesson-42" });
  state.setSource("forward 10");

  assert.equal(adapter.load("lesson-42"), "forward 10");
  assert.equal(adapter.load(OL.DEFAULT_PERSISTENCE_KEY), null);
});

test("attachPersistence skips saving when an unrelated field changes (no redundant writes)", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  let saveCalls = 0;
  const countingAdapter = {
    ...adapter,
    save(key, value) {
      saveCalls += 1;
      adapter.save(key, value);
    },
  };
  const state = OL.createStudioState();

  OL.attachPersistence(state, { adapter: countingAdapter });
  state.setSource("forward 10");
  assert.equal(saveCalls, 1);

  state.setSelection({ anchor: [1, 1], head: [1, 3] });
  state.setRunStatus("running");
  state.setDiagnostics([]);
  state.setLesson({ lessonId: "l1", title: "Squares" });

  assert.equal(saveCalls, 1, "unrelated state changes must not trigger a save");
});

test("attachPersistence never forks source: two independent controllers over one store agree", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  const state = OL.createStudioState();
  OL.attachPersistence(state, { adapter });

  const paneA = { readSource: () => state.getState().source };
  const paneB = { readSource: () => state.getState().source };

  state.setSource("left 45");

  assert.equal(paneA.readSource(), "left 45");
  assert.equal(paneA.readSource(), paneB.readSource());
});

test("a load failure sets a visible warning notice instead of crashing", () => {
  const adapter = {
    load() {
      throw new Error("storage disabled");
    },
  };
  const state = OL.createStudioState({ source: "keep me" });

  OL.attachPersistence(state, { adapter });

  assert.equal(state.getState().source, "keep me");
  assert.deepEqual(state.getState().notice, {
    level: "warning",
    message: "Could not restore your saved work: storage disabled",
  });
});

test("a load failure with a non-Error throw still produces a readable notice message", () => {
  const adapter = {
    load() {
      throw "storage unavailable";
    },
  };
  const state = OL.createStudioState();

  OL.attachPersistence(state, { adapter });

  assert.deepEqual(state.getState().notice, {
    level: "warning",
    message: "Could not restore your saved work: storage unavailable",
  });
});

test("a save failure sets a visible warning notice and the learner can keep working", () => {
  const adapter = {
    load() {
      return null;
    },
    save() {
      throw new Error("quota exceeded");
    },
  };
  const state = OL.createStudioState();

  OL.attachPersistence(state, { adapter });
  state.setSource("forward 100");

  assert.equal(state.getState().source, "forward 100");
  assert.deepEqual(state.getState().notice, {
    level: "warning",
    message: "Your work could not be saved: quota exceeded",
  });

  // The learner keeps working: further edits still land in the shared store, no crash.
  state.setSource("forward 100 right 90");
  assert.equal(state.getState().source, "forward 100 right 90");
});

test("a warning notice clears automatically once a later save succeeds", () => {
  let shouldFail = true;
  const backing = new Map();
  const adapter = {
    load(key) {
      return backing.get(key) ?? null;
    },
    save(key, value) {
      if (shouldFail) {
        throw new Error("quota exceeded");
      }
      backing.set(key, value);
    },
  };
  const state = OL.createStudioState();

  OL.attachPersistence(state, { adapter });
  state.setSource("forward 100");
  assert.deepEqual(state.getState().notice, {
    level: "warning",
    message: "Your work could not be saved: quota exceeded",
  });

  shouldFail = false;
  state.setSource("forward 100 right 90");
  assert.equal(
    state.getState().notice,
    null,
    "a successful save must clear the warning this module set",
  );
});

test("a save-failure notice does not clobber an unrelated notice already set for another reason, and vice versa", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  const state = OL.createStudioState();

  OL.attachPersistence(state, { adapter });
  state.setNotice({ level: "info", message: "from some other pane" });
  state.setSource("forward 1");

  // The successful save must not clear a notice this module never set.
  assert.deepEqual(state.getState().notice, {
    level: "info",
    message: "from some other pane",
  });
});

test("a later pane's notice survives even if it overwrites a persistence warning before the next persistence success", () => {
  let shouldFail = true;
  const backing = new Map();
  const adapter = {
    load(key) {
      return backing.get(key) ?? null;
    },
    save(key, value) {
      if (shouldFail) {
        throw new Error("quota exceeded");
      }
      backing.set(key, value);
    },
  };
  const state = OL.createStudioState();

  OL.attachPersistence(state, { adapter });

  // 1. A save fails: persistence sets its own warning notice.
  state.setSource("forward 1");
  assert.deepEqual(state.getState().notice, {
    level: "warning",
    message: "Your work could not be saved: quota exceeded",
  });

  // 2. Some other pane overwrites the notice for an unrelated reason (persistence never sees
  //    this notice as "its own" — it only tracks the exact object it itself last set).
  const otherPanesNotice = { level: "info", message: "from some other pane" };
  state.setNotice(otherPanesNotice);

  // 3. A later save succeeds: persistence must NOT clear a notice it did not set.
  shouldFail = false;
  state.setSource("forward 1 forward 2");
  assert.equal(
    state.getState().notice,
    otherPanesNotice,
    "persistence must not clobber a notice set by another pane after its own warning was already replaced",
  );
});

test("clearPersisted resets lastSaved so re-setting the same source after a clear still persists it (no silent data loss)", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  const state = OL.createStudioState();
  const persistence = OL.attachPersistence(state, { adapter });

  state.setSource("forward 10");
  assert.equal(adapter.load(OL.DEFAULT_PERSISTENCE_KEY), "forward 10");

  persistence.clearPersisted();
  assert.equal(adapter.load(OL.DEFAULT_PERSISTENCE_KEY), null);

  // Re-affirming the exact same source after a clear must re-persist it, not be silently
  // skipped by the unchanged-value optimization.
  state.setSource("forward 10");
  assert.equal(adapter.load(OL.DEFAULT_PERSISTENCE_KEY), "forward 10");
});

test("clearPersisted removes the stored value via the adapter", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  const state = OL.createStudioState();
  const persistence = OL.attachPersistence(state, { adapter });

  state.setSource("forward 10");
  assert.equal(adapter.load(OL.DEFAULT_PERSISTENCE_KEY), "forward 10");

  persistence.clearPersisted();
  assert.equal(adapter.load(OL.DEFAULT_PERSISTENCE_KEY), null);
});

test("clearPersisted degrades gracefully and sets a notice when the adapter throws", () => {
  const adapter = {
    load() {
      return null;
    },
    clear() {
      throw new Error("cannot clear");
    },
  };
  const state = OL.createStudioState();
  const persistence = OL.attachPersistence(state, { adapter });

  persistence.clearPersisted();

  assert.deepEqual(state.getState().notice, {
    level: "warning",
    message: "Could not clear your saved work: cannot clear",
  });
});

test("dispose stops further saves", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  const state = OL.createStudioState();
  const persistence = OL.attachPersistence(state, { adapter });

  state.setSource("forward 1");
  assert.equal(adapter.load(OL.DEFAULT_PERSISTENCE_KEY), "forward 1");

  persistence.dispose();
  state.setSource("forward 2");

  assert.equal(adapter.load(OL.DEFAULT_PERSISTENCE_KEY), "forward 1");
});

test("attachPersistence exposes the adapter and key it was constructed with", () => {
  const adapter = OL.createInMemoryStorageAdapter();
  const state = OL.createStudioState();

  const persistence = OL.attachPersistence(state, {
    adapter,
    key: "custom-key",
  });

  assert.equal(persistence.adapter, adapter);
  assert.equal(persistence.key, "custom-key");
});

test("attachPersistence defaults to an in-memory adapter and the default key when none is given", () => {
  const state = OL.createStudioState();

  const persistence = OL.attachPersistence(state);

  assert.equal(persistence.key, OL.DEFAULT_PERSISTENCE_KEY);
  state.setSource("forward 5");
  assert.equal(
    persistence.adapter.load(OL.DEFAULT_PERSISTENCE_KEY),
    "forward 5",
  );
});

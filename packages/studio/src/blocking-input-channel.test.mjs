// The shared-memory protocol behind the studio's genuinely blocking `input` read (#876).
//
// `spec/interaction-events.md:108-111` makes `input` the only blocking read in v0.1, and
// `@openlogo/runtime`'s reader is synchronous *because* that is the guarantee by construction. A
// browser main thread cannot block for a styled prompt, so the interpreter moves to a Worker and
// parks there on `Atomics.wait` until the main thread writes the answer into shared memory.
//
// `Atomics.wait` is unavailable on a main thread and its scheduling is inherently timing-dependent,
// which is precisely the class of code that cannot be covered portably (issue #897). So the module
// takes `wait`/`notify` as parameters and these tests supply a **deterministic fake**: it performs a
// scripted main-thread action and returns, exactly as a real wake-up would, with no timers and no
// threads involved. Every branch below is therefore reproducible rather than raced.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/** Allocate a channel of `capacity` UTF-16 code units over ordinary (non-shared) memory. */
function makeChannel(capacity = 16) {
  return OL.createBlockingInputChannel(
    new ArrayBuffer(OL.blockingInputBufferByteLength(capacity)),
  );
}

/**
 * The control slot holding the pending answer's length. The module keeps its slot indices private,
 * which is right — but two of its stores are otherwise unobservable through the public API (the
 * `dismissed` path never decodes an answer), so the tests below read this one directly rather than
 * asserting a store in prose that nothing checks.
 */
const ANSWER_LENGTH_SLOT = 1;

/** Records every `Atomics.notify` the module would have issued. */
function makeNotifyRecorder() {
  const calls = [];
  return {
    calls,
    notify(control, index) {
      calls.push(index);
      return 1;
    },
  };
}

/**
 * A stand-in for `Atomics.wait` that runs `onPark` the first time the interpreter parks — the
 * deterministic equivalent of "the main thread answered while the Worker was blocked".
 */
function makeWait(onPark) {
  const state = { parkCount: 0, intervals: [] };
  return {
    state,
    wait(control, index, expected, timeoutMs) {
      state.parkCount += 1;
      state.intervals.push(timeoutMs);
      onPark?.(state.parkCount);
      return "ok";
    },
  };
}

test("blockingInputBufferByteLength sizes a control block plus the answer region", () => {
  const control = OL.BLOCKING_INPUT_CONTROL_SLOT_COUNT * 4;
  assert.equal(OL.blockingInputBufferByteLength(0), control);
  assert.equal(OL.blockingInputBufferByteLength(10), control + 20);
  // Called with no argument it uses the documented default capacity.
  assert.equal(
    OL.blockingInputBufferByteLength(),
    control + OL.DEFAULT_BLOCKING_INPUT_ANSWER_CAPACITY * 2,
  );
});

test("createBlockingInputChannel lays the two views over one buffer without overlapping", () => {
  const channel = makeChannel(16);

  assert.equal(channel.control.length, OL.BLOCKING_INPUT_CONTROL_SLOT_COUNT);
  assert.equal(channel.answer.length, 16);
  assert.equal(channel.control.byteOffset, 0);
  assert.equal(
    channel.answer.byteOffset,
    OL.BLOCKING_INPUT_CONTROL_SLOT_COUNT * 4,
  );
  // Both threads build their own views over the SAME memory — that is the whole mechanism.
  assert.equal(channel.control.buffer, channel.answer.buffer);
});

test("a freshly created channel has no read outstanding and no cancellation", () => {
  const channel = makeChannel();

  assert.equal(OL.isBlockingReadOutstanding(channel), false);
  assert.equal(OL.isBlockingCancellationRequested(channel), false);
});

test("armBlockingRead marks a read outstanding and clears any stale answer length", () => {
  const channel = makeChannel();
  const notifier = makeNotifyRecorder();
  OL.armBlockingRead(channel);
  OL.deliverBlockingAnswer(channel, "stale", notifier.notify);

  OL.armBlockingRead(channel);

  assert.equal(OL.isBlockingReadOutstanding(channel), true);
  // Re-arming must not leave the previous answer's length behind: a reader that woke on the new
  // read would otherwise decode `length` code units of whatever happens to be in the region.
  // Asserted on the control slot directly, because the `dismissed` path below never decodes an
  // answer — so observing only the outcome would leave the store unpinned.
  assert.equal(Atomics.load(channel.control, ANSWER_LENGTH_SLOT), 0);
  const wait = makeWait(() => {
    OL.dismissBlockingRead(channel, notifier.notify);
  });
  assert.deepEqual(OL.awaitBlockingRead(channel, wait.wait, 1), {
    kind: "dismissed",
  });
});

test("an answer delivered BEFORE the interpreter parks is still seen, without waiting at all", () => {
  // The ordering hazard the arm-then-report rule exists for: `postMessage` is asynchronous, so the
  // main thread can answer before `awaitBlockingRead` is even entered.
  const channel = makeChannel();
  const notifier = makeNotifyRecorder();
  OL.armBlockingRead(channel);
  OL.deliverBlockingAnswer(channel, "42", notifier.notify);

  const wait = makeWait();
  const outcome = OL.awaitBlockingRead(channel, wait.wait, 5);

  assert.deepEqual(outcome, { kind: "answered", answer: "42" });
  assert.equal(wait.state.parkCount, 0, "there was nothing left to wait for");
});

test("the interpreter parks until the main thread answers, then reports that answer", () => {
  const channel = makeChannel();
  const notifier = makeNotifyRecorder();
  OL.armBlockingRead(channel);

  // Answer only on the second park, so the loop is genuinely exercised rather than short-circuited.
  const wait = makeWait((parkCount) => {
    if (parkCount === 2) {
      OL.deliverBlockingAnswer(channel, "Ada", notifier.notify);
    }
  });
  const outcome = OL.awaitBlockingRead(channel, wait.wait, 5);

  assert.deepEqual(outcome, { kind: "answered", answer: "Ada" });
  assert.equal(wait.state.parkCount, 2);
  assert.deepEqual(wait.state.intervals, [5, 5]);
  assert.deepEqual(
    notifier.calls,
    [0],
    "delivering wakes the parked interpreter",
  );
});

test("awaitBlockingRead parks for the documented default interval when none is given", () => {
  const channel = makeChannel();
  const notifier = makeNotifyRecorder();
  OL.armBlockingRead(channel);
  const wait = makeWait(() => {
    OL.deliverBlockingAnswer(channel, "x", notifier.notify);
  });

  OL.awaitBlockingRead(channel, wait.wait);

  assert.deepEqual(wait.state.intervals, [
    OL.DEFAULT_BLOCKING_INPUT_POLL_INTERVAL_MS,
  ]);
});

test("a dismissed read ends unanswered — the runtime reader's own `undefined`", () => {
  const channel = makeChannel();
  const notifier = makeNotifyRecorder();
  OL.armBlockingRead(channel);
  const wait = makeWait(() => {
    OL.dismissBlockingRead(channel, notifier.notify);
  });

  assert.deepEqual(OL.awaitBlockingRead(channel, wait.wait, 5), {
    kind: "dismissed",
  });
  assert.deepEqual(notifier.calls, [0]);
});

test("cancellation ends a parked read even if its wake-up never arrives — the bound", () => {
  // This is what replaces the retry cap #881 deleted: a wait is never indefinite, so a Stop is
  // observed within one poll interval whether or not the notify was seen.
  const channel = makeChannel();
  OL.armBlockingRead(channel);
  const silentNotify = () => 0;
  const wait = makeWait((parkCount) => {
    if (parkCount === 1) {
      // Set the flag WITHOUT a working notify — the loop must still notice on its next pass.
      OL.requestBlockingCancellation(channel, silentNotify);
    }
  });

  assert.deepEqual(OL.awaitBlockingRead(channel, wait.wait, 5), {
    kind: "dismissed",
  });
  assert.equal(wait.state.parkCount, 1);
  assert.equal(OL.isBlockingCancellationRequested(channel), true);
});

test("cancellation requested before a read even starts is honoured without parking", () => {
  const channel = makeChannel();
  const notifier = makeNotifyRecorder();
  OL.requestBlockingCancellation(channel, notifier.notify);
  OL.armBlockingRead(channel);
  const wait = makeWait();

  assert.deepEqual(OL.awaitBlockingRead(channel, wait.wait, 5), {
    kind: "dismissed",
  });
  assert.equal(wait.state.parkCount, 0);
});

test("an answer round-trips verbatim, including characters outside the BMP", () => {
  const channel = makeChannel(64);
  const notifier = makeNotifyRecorder();
  const answer = 'héllo "wörld" 🐢 — done';
  OL.armBlockingRead(channel);

  const delivery = OL.deliverBlockingAnswer(channel, answer, notifier.notify);
  const wait = makeWait();
  const outcome = OL.awaitBlockingRead(channel, wait.wait, 5);

  assert.deepEqual(delivery, {
    delivered: true,
    requiredCapacity: answer.length,
  });
  assert.deepEqual(outcome, { kind: "answered", answer });
});

test("an empty answer is a real answer, not a dismissal", () => {
  const channel = makeChannel();
  const notifier = makeNotifyRecorder();
  OL.armBlockingRead(channel);
  OL.deliverBlockingAnswer(channel, "", notifier.notify);
  const wait = makeWait();

  assert.deepEqual(OL.awaitBlockingRead(channel, wait.wait, 5), {
    kind: "answered",
    answer: "",
  });
});

test("an answer that exceeds the region is refused, never truncated", () => {
  // Handing the program text the learner did not type would be a silent corruption. The read stays
  // outstanding so the caller decides what to do instead.
  const channel = makeChannel(4);
  const notifier = makeNotifyRecorder();
  OL.armBlockingRead(channel);

  const delivery = OL.deliverBlockingAnswer(
    channel,
    "toolong",
    notifier.notify,
  );

  assert.deepEqual(delivery, { delivered: false, requiredCapacity: 7 });
  assert.deepEqual(
    notifier.calls,
    [],
    "nothing was woken, because nothing changed",
  );
  assert.equal(OL.isBlockingReadOutstanding(channel), true);
});

test("an answer exactly filling the region is delivered", () => {
  const channel = makeChannel(4);
  const notifier = makeNotifyRecorder();
  OL.armBlockingRead(channel);

  assert.equal(
    OL.deliverBlockingAnswer(channel, "abcd", notifier.notify).delivered,
    true,
  );
  const wait = makeWait();
  assert.deepEqual(OL.awaitBlockingRead(channel, wait.wait, 5), {
    kind: "answered",
    answer: "abcd",
  });
});

test("createSharedCancellationSignal reports the flag live, which is the preemptible Stop", () => {
  // `@openlogo/runtime` reads `aborted` before every statement, so a flag another thread sets takes
  // effect MID-`execute()` — the thing a same-thread studio could never do.
  const channel = makeChannel();
  const notifier = makeNotifyRecorder();
  const signal = OL.createSharedCancellationSignal(channel);

  assert.equal(signal.aborted, false);
  OL.requestBlockingCancellation(channel, notifier.notify);
  assert.equal(signal.aborted, true);
});

test("requestBlockingCancellation also ends an outstanding read", () => {
  const channel = makeChannel();
  const notifier = makeNotifyRecorder();
  OL.armBlockingRead(channel);

  OL.requestBlockingCancellation(channel, notifier.notify);

  assert.equal(OL.isBlockingReadOutstanding(channel), false);
  assert.deepEqual(
    notifier.calls,
    [0],
    "a parked interpreter is woken, not left hanging",
  );
});

test("clearBlockingRead returns the channel to idle once an outcome is consumed", () => {
  const channel = makeChannel();
  const notifier = makeNotifyRecorder();
  OL.armBlockingRead(channel);
  OL.deliverBlockingAnswer(channel, "done", notifier.notify);

  OL.clearBlockingRead(channel);

  assert.equal(OL.isBlockingReadOutstanding(channel), false);
  // The length is cleared too, so a later read cannot decode a stale answer — asserted on the
  // control slot, since the `dismissed` outcome below never decodes one and so cannot prove it.
  assert.equal(Atomics.load(channel.control, ANSWER_LENGTH_SLOT), 0);
  OL.armBlockingRead(channel);
  OL.dismissBlockingRead(channel, notifier.notify);
  const wait = makeWait();
  assert.deepEqual(OL.awaitBlockingRead(channel, wait.wait, 5), {
    kind: "dismissed",
  });
});

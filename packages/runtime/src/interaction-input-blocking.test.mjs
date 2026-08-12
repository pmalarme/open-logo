// Unit tests for the **blocking** property of `input` (issue #681, slice I2 —
// `spec/interaction-events.md:108-111`):
//
//   "`input` is the only blocking read in OpenLogo v0.1. While `input` is waiting, the
//    implementation MAY continue rendering already-emitted trace events, but it MUST NOT run new
//    OpenLogo instructions or event handler blocks until the read finishes or the program is
//    cancelled."
//
// **This file is where that MUST is proven.** Conformance fixtures structurally cannot prove it: a
// fixture's answer is scripted, so the read returns immediately and there is no "waiting" interval a
// headless source→events fold can observe. What IS observable — and is what the MUST actually
// forbids — is *interleaving*: in this single-threaded evaluator the only OpenLogo code that can run
// between two instructions is an event handler block, and handler delivery happens exclusively at a
// `wait`'s per-tick checkpoint (`execute-internal.ts`'s `dispatchDueHandlers`, reached through
// `interaction.ts`'s `yieldToEventLoop`). So the property has two observable halves:
//
//   1. **No handler block runs across a read.** Proven DIFFERENTIALLY: each test schedules host
//      input that a `wait 0` in the very same position provably DOES deliver, and asserts an `input`
//      in that position delivers nothing. The paired `wait` assertion is what makes this a proof
//      rather than a vacuous "nothing happened" — without it, a program whose handler could never
//      fire for an unrelated reason would pass just as happily.
//   2. **A read does not advance the tick clock**, so no `every` handler can come due because of
//      one — the second way handler code could otherwise sneak in.
//
// Together those close every path by which "new OpenLogo instructions or event handler blocks" could
// run during a read. The implementation upholds them by ABSENCE: `evaluateInput` reaches no
// `yieldToEventLoop` checkpoint and never calls `advanceTickClock`. The tempting wrong
// implementation — pumping the event loop while "waiting for the host to answer" — flips every
// assertion below.
//
// Node-version trap: on Node 24+ `--experimental-test-coverage` silently excludes `*.test.mjs`, so
// verify coverage on Node 22 (`.nvmrc`), the version CI pins.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "input-blocking.logo";

/** One key press pending from tick 0 — due at the first checkpoint any program reaches. */
const KEY_AT_TICK_ZERO = Object.freeze([
  Object.freeze({ tick: 0, kind: "key", key: "a" }),
]);

/** The words a program printed, in order — how each handler announces that it ran. */
function printedWords(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .flatMap((event) => event.payload.values);
}

/**
 * The same program twice, with `pause` as the only difference: once with an `input` read in the
 * pausing position and once with `wait 0`. Both runs get the same pending host input and the same
 * scripted answer, so any difference in what ran is attributable to the pausing form alone.
 */
function bothForms(buildSource, options) {
  return {
    withInput: execute(buildSource(':answer = input "q"'), doc, options),
    withWait: execute(buildSource("wait 0"), doc, options),
  };
}

// --- Half 1: no event handler block runs across a read ------------------------------------------

test("a pending on_key handler does NOT fire across an input read, though a wait 0 in the same position DOES", () => {
  const source = (pause) =>
    ['on_key "a" [ print "handler-ran" ]', pause, 'print "after"'].join("\n");
  const { withInput, withWait } = bothForms(source, {
    hostInput: { events: KEY_AT_TICK_ZERO, responses: ["tom"] },
  });

  // The control: `wait 0` reaches the event-loop checkpoint, so the tick-0 key IS delivered. This
  // is what proves the key was genuinely pending and deliverable — the read below is not simply
  // running a program whose handler could never fire.
  assert.deepEqual(withWait.diagnostics, []);
  assert.deepEqual(printedWords(withWait), ["handler-ran", "after"]);

  // The property under test: the read reaches no checkpoint, so the handler block never runs.
  assert.deepEqual(withInput.diagnostics, []);
  assert.deepEqual(printedWords(withInput), ["after"]);
});

test("no handler block of ANY kind runs across a read — when, on_key, and on_click alike", () => {
  // `spec/interaction-events.md:84-89` lists four handler kinds; the MUST names "event handler
  // blocks" without exception, so all of them are covered, not just `on_key`. (`when "start"` is
  // delivered at registration, before the read, which is why it prints in BOTH runs — its presence
  // here proves the read does not *re-*deliver a named event either.)
  const source = (pause) =>
    [
      'when "later" [ print "when-ran" ]',
      'on_key "a" [ print "key-ran" ]',
      'on_click [ print "click-ran" ]',
      pause,
      'print "after"',
    ].join("\n");
  const hostInput = {
    events: [
      { tick: 0, kind: "key", key: "a" },
      { tick: 0, kind: "click" },
      { tick: 0, kind: "event", event: "later" },
    ],
    responses: ["tom"],
  };
  const { withInput, withWait } = bothForms(source, { hostInput });

  // Control: at a real checkpoint all three fire, in the normative same-tick order
  // (`when` → `on_key` → `on_click`).
  assert.deepEqual(printedWords(withWait), [
    "when-ran",
    "key-ran",
    "click-ran",
    "after",
  ]);
  // Under test: not one of them runs across the read.
  assert.deepEqual(printedWords(withInput), ["after"]);
});

test("a read inside a handler body does not let a second handler interleave either", () => {
  // The MUST is about the read, not about where it sits: an `input` inside a running handler block
  // must not become a delivery point for the *next* pending handler. `when "start"` fires at
  // registration and reads inside its own body; the tick-0 key stays undelivered until the later
  // `wait 0` reaches a checkpoint, so the key handler runs strictly after the whole reading handler
  // has finished.
  const result = execute(
    [
      'on_key "a" [ print "key-ran" ]',
      'when "start"',
      '  print "handler-start"',
      '  print input "q"',
      '  print "handler-end"',
      "end when",
      "wait 0",
    ].join("\n"),
    doc,
    { hostInput: { events: KEY_AT_TICK_ZERO, responses: ["tom"] } },
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedWords(result), [
    "handler-start",
    "tom",
    "handler-end",
    "key-ran",
  ]);
});

// --- Half 2: a read does not advance the tick clock ---------------------------------------------

test("reads do not advance the tick clock, so an every handler comes due on exactly the tick the waits produce", () => {
  // `every 2` registered at tick 0 is due at tick 2 ("the block first runs `n` ticks after
  // registration"). Two reads sit before the first `wait 1`, so if a read advanced the clock at all
  // the handler would come due at that FIRST wait and print before `mid`. Correct behavior: the
  // waits alone drive the clock, so tick 1 is not due (`mid` prints first) and tick 2 is (the
  // handler prints between `mid` and `done`).
  //
  // The ORDER is the assertion, not the count: a handler that is overdue still fires exactly once at
  // the next checkpoint, so counting prints cannot see a clock that ran fast. Watching *which* wait
  // it fires at can.
  const result = execute(
    [
      'every 2 [ print "every-ran" ]',
      ':a = input "q"',
      ':b = input "q"',
      "wait 1",
      'print "mid"',
      "wait 1",
      'print "done"',
    ].join("\n"),
    doc,
    { hostInput: { responses: ["1", "2"] } },
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedWords(result), ["mid", "every-ran", "done"]);
});

test("a run made entirely of reads reaches no checkpoint at all — nothing pending is ever delivered", () => {
  // With no `wait` anywhere, there is no checkpoint in the program, so pending host input stays
  // pending to the end. The reads themselves must not become one.
  const result = execute(
    ['on_key "a" [ print "key-ran" ]', ':a = input "q"', ':b = input "q"'].join(
      "\n",
    ),
    doc,
    { hostInput: { events: KEY_AT_TICK_ZERO, responses: ["one", "two"] } },
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedWords(result), []);
});

// --- The instruction half: the next instruction cannot start before the read finishes -----------

test("the next instruction's events all follow the read's primitive event", () => {
  // The other clause of `:110-111` — "MUST NOT run new OpenLogo instructions" — as the event stream
  // sees it: every event belonging to the statement after the read carries a strictly greater `seq`
  // than the read's own `primitive` event, and the read's statement emits nothing after it. A read
  // that returned before its answer was in hand (an async/pumped implementation) would let the
  // following `print` land first.
  const result = execute(':answer = input "q"\nprint :answer\nright 90', doc, {
    hostInput: { responses: ["tom"] },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => [event.seq, event.kind]),
    [
      [0, "instruction"], // :answer = input "q"
      [1, "primitive"], //   ... the read finishes
      [2, "instruction"], // print :answer
      [3, "print"],
      [4, "instruction"], // right 90
      [5, "turn"],
    ],
  );
});

test("a cancelled run stops at the read — the spec's other ending — and runs nothing after it", () => {
  // `:110-111` allows exactly two ways out of a blocking read: "until the read finishes or the
  // program is cancelled". With the run already cancelled, the statement carrying the read halts and
  // no later instruction runs.
  const result = execute(':answer = input "q"\nprint "never"', doc, {
    signal: { aborted: true },
    hostInput: { responses: ["tom"] },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, { limit: "cancelled" });
  assert.deepEqual(printedWords(result), []);
});

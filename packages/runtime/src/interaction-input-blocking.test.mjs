// Unit tests for the **blocking** property of `input` (issue #681, slice I2 —
// `spec/interaction-events.md:156-159`):
//
//   "`input` is the only blocking read in OpenLogo v0.1. While `input` is waiting, the
//    implementation MAY continue rendering already-emitted trace events, but it MUST NOT run new
//    OpenLogo instructions or event handler blocks until the read finishes or the program is
//    cancelled."
//
// **This file is where that MUST is proven**, in three layers of increasing directness.
//
//   0. **From INSIDE the outstanding read.** `ExecuteOptions.hostInput.read` (issue #681) is the
//      host's live reader, and the read is outstanding for exactly the duration of that call — so
//      assertions made inside it are made while the read is unresolved, which is the very window
//      the MUST governs. The probe is the reader's own call log: a handler body that also reads can
//      only reach the reader by running, so its absence mid-read is positive evidence that no
//      handler block ran. This is the "scripted reader that can hold the read open" the maintainer's
//      ruling on #657 required #681 to cover, and it carries the read's other ending too — a reader
//      reporting `undefined` cancels the run — so resolving and cancelling an outstanding read are
//      independently controllable through one seam.
//   1. **No handler block runs ACROSS a read**, with a scripted answer. Proven DIFFERENTIALLY: each
//      test schedules host input that a `wait 0` in the very same position provably DOES deliver,
//      and asserts an `input` in that position delivers nothing. The paired `wait` assertion is what
//      makes this a proof rather than a vacuous "nothing happened" — without it, a program whose
//      handler could never fire for an unrelated reason would pass just as happily. A further test
//      shows a read leaves pending input OUTSTANDING rather than dropping it
//      (`spec/interaction-events.md:139-141`): a later `wait` still delivers what the reads passed
//      over.
//   2. **A read does not advance the tick clock**, so no `every` handler can come due because of
//      one — the second way handler code could otherwise sneak in.
//
// Conformance fixtures reach none of this: a fixture's answer is scripted, so the read returns
// immediately and there is no waiting interval a headless source→events fold can observe, and a
// fixture cannot supply a function at all. The implementation upholds the MUST by ABSENCE plus
// SYNCHRONY: `evaluateInput` reaches no `yieldToEventLoop` checkpoint (`execute-internal.ts`'s
// `dispatchDueHandlers` is reached only from a `wait`), never calls `advanceTickClock`, and performs
// the read in a synchronous call with no suspension point at which anything else could be
// scheduled. The tempting wrong implementation — pumping the event loop while "waiting for the host
// to answer" — flips the assertions below.
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

// --- The outstanding read: observed from inside the window, through the injected reader ---------

test("while a read is OUTSTANDING, no further instruction and no handler block has run", () => {
  // The strongest form of `spec/interaction-events.md:156-159`, and the one the scripted-answer
  // tests below structurally cannot reach: `ExecuteOptions.hostInput.read` is the live host reader,
  // and the read is outstanding for exactly the duration of that call — so the assertions INSIDE it
  // are made while the read is unresolved, which is the very window the MUST governs.
  //
  // The probe is the reader's own call log. A handler body that also reads (`print input
  // "from-handler"`) can only reach the reader by running, so if any handler block ran while the
  // first read was outstanding, `prompts` would already contain "from-handler" at that moment. The
  // key is pending from tick 0 and provably deliverable — the `wait 0` at the end delivers it.
  const prompts = [];
  const observedInsideFirstRead = [];
  const result = execute(
    [
      'on_key "a" [ print input "from-handler" ]',
      ':a = input "first"',
      ':b = input "second"',
      'print "reads-done"',
      "wait 0",
    ].join("\n"),
    doc,
    {
      hostInput: {
        events: KEY_AT_TICK_ZERO,
        read: (prompt) => {
          prompts.push(prompt);
          if (prompt === "first") {
            // Mid-read, with the read unresolved: nothing else may have run.
            observedInsideFirstRead.push(...prompts);
          }
          return `answer-to-${prompt}`;
        },
      },
    },
  );

  assert.deepEqual(result.diagnostics, []);
  // Inside the outstanding first read, the only read that had begun was that read itself.
  assert.deepEqual(observedInsideFirstRead, ["first"]);
  // And over the whole run the handler's own read happens strictly after both top-level reads and
  // after the statement that follows them — i.e. only once a checkpoint was reached.
  assert.deepEqual(prompts, ["first", "second", "from-handler"]);
  assert.deepEqual(printedWords(result), [
    "reads-done",
    "answer-to-from-handler",
  ]);
});

test("the reader receives the prompt word verbatim — this is how a host shows it", () => {
  // `spec/interaction-events.md:182`: "`input` displays the prompt and waits for the learner to
  // enter one value." The runtime's half of "displays" is handing the host exactly the text a
  // learner sees. Since the #768 ruling the prompt is always a `word` (`:177`), so that text IS the
  // word — passed through unquoted and unrendered. The numeral word `"42"` proves it: it arrives as
  // the two characters `42`, with no quotes added and no re-rendering on the way out.
  const prompts = [];
  const result = execute(
    ['print input "what is your name?"', 'print input "42"'].join("\n"),
    doc,
    {
      hostInput: {
        read: (prompt) => {
          prompts.push(prompt);
          return "ok";
        },
      },
    },
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(prompts, ["what is your name?", "42"]);
});

test("a reader that declines to answer cancels the run — the read's other ending, on demand", () => {
  // `:158-159` again: "until the read finishes or the program is cancelled". A live host that
  // cannot answer (the learner closed the prompt, the session ended) reports `undefined`, and the
  // run takes the cancelled ending at that read — resolved and cancelled are therefore independently
  // controllable through one seam, not two.
  const result = execute(
    ':a = input "first"\n:b = input "second"\nprint "never"',
    doc,
    {
      hostInput: {
        read: (prompt) => (prompt === "first" ? "answered" : undefined),
      },
    },
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, { limit: "cancelled" });
  // The first read completed (its primitive event is there); the second ended the run.
  assert.deepEqual(
    result.events.filter((event) => event.kind === "primitive").length,
    1,
  );
  assert.deepEqual(printedWords(result), []);
});

test("a live reader is authoritative over the scripted queue — a real host never replays a stale script", () => {
  const prompts = [];
  const result = execute('print input "q"', doc, {
    hostInput: {
      responses: ["from-the-script"],
      read: (prompt) => {
        prompts.push(prompt);
        return "from-the-host";
      },
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(prompts, ["q"]);
  assert.deepEqual(printedWords(result), ["from-the-host"]);
});

test("a reader's answer is classified by the same number-vs-word rule as a scripted one", () => {
  // One meaning, two hosts: `spec/interaction-events.md:184-185` applies to whatever text the
  // learner submitted, however it reached the runtime.
  const result = execute(
    ':n = input "n"\nprint :n is a "number"\n:w = input "w"\nprint :w is a "number"',
    doc,
    { hostInput: { read: (prompt) => (prompt === "n" ? "42" : "tom") } },
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedWords(result), [true, false]);
});

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
  // `spec/interaction-events.md:132-137` lists four handler kinds; the MUST names "event handler
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

test("reads leave outstanding input OUTSTANDING — a later wait still delivers what they declined to", () => {
  // The sharper form of the previous test, and the one that separates "the read did not deliver the
  // key" from "the read quietly consumed and discarded it". `spec/interaction-events.md:139-141`
  // requires an implementation to "preserve the most recent key and click state needed to deliver
  // the next handler consistently", so a read must leave the pending queue exactly as it found it:
  // two reads pass over a key pending from tick 0, and the `wait 0` after them still delivers it.
  //
  // This is what a read "not running handler blocks" has to mean in a program that eventually does
  // reach a checkpoint — the work is deferred, not dropped.
  const result = execute(
    [
      'on_key "a" [ print "key-ran" ]',
      ':a = input "q"',
      ':b = input "q"',
      'print "reads-done"',
      "wait 0",
      'print "after"',
    ].join("\n"),
    doc,
    { hostInput: { events: KEY_AT_TICK_ZERO, responses: ["one", "two"] } },
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedWords(result), ["reads-done", "key-ran", "after"]);
});

// --- The instruction half: the next instruction cannot start before the read finishes -----------

test("the next instruction's events all follow the read's primitive event", () => {
  // The other clause of `:158-159` — "MUST NOT run new OpenLogo instructions" — as the event stream
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
  // `:158-159` allows exactly two ways out of a blocking read: "until the read finishes or the
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

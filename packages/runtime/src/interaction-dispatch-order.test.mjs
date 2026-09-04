// Unit tests for the unified same-tick handler dispatch order + cancellation (issue #686, slice I7 —
// `spec/interaction-events.md`, §"Time, ticks, and handlers" l.84-89 and §"Errors and
// cancellation"). This is the slice that proves the four handler forms COMPOSE: when several
// handlers of different kinds become due in the same tick, they must fire in the normative order
//
//     1. pending `when` events    (registration order)
//     2. pending `on_key` events  (registration order)
//     3. pending `on_click` events (registration order)
//     4. due `every` events       (registration order)
//
// A headless batch `execute()` has no real input device, so `on_key`/`on_click`/host-`when` never
// fire on their own — which is exactly why proving CROSS-KIND order needs a way to inject the input
// a host would have delivered. That is `ExecuteOptions.hostInput` (see `index.ts`): a tick-scheduled
// list of key presses, clicks, and named events, drained at each `wait`/tick checkpoint in the order
// above. It is host-supplied execution context (like `signal`), never observable in any event
// payload — these tests assert on the ORDER of the handler bodies' own `print`/effect events, never
// on any injected tick/coordinate, so the stream stays headless.
//
// Node-version trap (see the PR body): on Node 24+ `--experimental-test-coverage` silently excludes
// `*.test.mjs`, so a local coverage green can be a false positive that CI (Node 22, which counts
// them) then fails. These tests exercise every branch of the new dispatch/drain code so the Node-22
// CI gate sees full coverage.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "dispatch-order.logo";

/** The `print`ed values, in emission order — the concise handle on "which handler fired when". */
function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values);
}

/** The `primitive` names emitted, in order (for headless-never-fires assertions). */
function primitiveNames(result) {
  return result.events
    .filter((event) => event.kind === "primitive")
    .map((event) => event.payload.name);
}

// --- The four kinds compose in the normative same-tick order -----------------------------------

test("when → on_key → on_click → every all fire in one tick, in spec order (l.84-89)", () => {
  // All four handlers are registered before the wait, and all four become due at tick 1: a named
  // event "go", a key "x", a click, and an `every 1`. The spec fixes their same-tick order as
  // when → on_key → on_click → due every, each in registration order; the printed values must come
  // out 1, 2, 3, 4 regardless of the order the host input was supplied in.
  const source = [
    'when "go" [ print 1 ]',
    'on_key "x" [ print 2 ]',
    "on_click [ print 3 ]",
    "every 1 [ print 4 ]",
    "wait 1",
  ].join("\n");
  const result = execute(source, doc, {
    // Supplied deliberately OUT of dispatch order (click, then event, then key) to prove the order
    // is imposed at the drain point, not inherited from host-input order.
    hostInput: {
      events: [
        { tick: 1, kind: "click" },
        { tick: 1, kind: "event", event: "go" },
        { tick: 1, kind: "key", key: "x" },
      ],
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1], [2], [3], [4]]);
});

test("several handlers of the SAME kind fire in registration order within their step", () => {
  // Two `when "go"`, two `on_key "x"`, two `on_click`, two `every 1` — each pair must fire in
  // registration order, and the pairs must still interleave by kind: all when, then all on_key,
  // then all on_click, then all every.
  const source = [
    'when "go" [ print 1 ]',
    'when "go" [ print 2 ]',
    'on_key "x" [ print 3 ]',
    'on_key "x" [ print 4 ]',
    "on_click [ print 5 ]",
    "on_click [ print 6 ]",
    "every 1 [ print 7 ]",
    "every 1 [ print 8 ]",
    "wait 1",
  ].join("\n");
  const result = execute(source, doc, {
    hostInput: {
      events: [
        { tick: 1, kind: "event", event: "go" },
        { tick: 1, kind: "key", key: "x" },
        { tick: 1, kind: "click" },
      ],
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [
    [1],
    [2],
    [3],
    [4],
    [5],
    [6],
    [7],
    [8],
  ]);
});

test("only the matching on_key handler fires; a non-matching key is a no-op", () => {
  const source = [
    'on_key "a" [ print 1 ]',
    'on_key "b" [ print 2 ]',
    "wait 1",
  ].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "b" }] },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[2]]);
});

test("a click delivers to EVERY registered on_click handler, in registration order", () => {
  const source = [
    "on_click [ print 1 ]",
    "on_click [ print 2 ]",
    "wait 1",
  ].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 1, kind: "click" }] },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1], [2]]);
});

// --- Host input scheduled across DISTINCT ticks fires at the right tick --------------------------

test("host input scheduled at different ticks fires as the wait advances through each", () => {
  // A key at tick 1 and a click at tick 3, across a single `wait 3`. The key fires first (tick 1),
  // the click later (tick 3) — proving the tick cursor advances one entry set at a time.
  const source = [
    'on_key "x" [ print 1 ]',
    "on_click [ print 2 ]",
    "wait 3",
  ].join("\n");
  const result = execute(source, doc, {
    hostInput: {
      events: [
        { tick: 3, kind: "click" },
        { tick: 1, kind: "key", key: "x" },
      ],
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1], [2]]);
});

test("a tick:0 entry fires at the wait 0 yield checkpoint", () => {
  // `wait 0` still yields once (I1's single checkpoint); a tick:0 host entry is due there.
  const source = ['on_key "x" [ print 1 ]', "wait 0"].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 0, kind: "key", key: "x" }] },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1]]);
});

// --- Awkward positions: registration inside repeat / procedure / ask ----------------------------

test("handlers registered inside a repeat body still compose in spec order", () => {
  // Registration order is the textual/execution order the registrations RUN in, even from a loop.
  const source = ['repeat 2 [ on_key "x" [ print 1 ] ]', "wait 1"].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "x" }] },
  });
  assert.deepEqual(result.diagnostics, []);
  // Two handlers registered (two repeat passes); one key press delivers to both, in registration
  // order — both print 1.
  assert.deepEqual(printedValues(result), [[1], [1]]);
});

test("handlers registered inside a procedure body compose after the call registers them", () => {
  const source = [
    "define arm",
    '  on_key "x" [ print 1 ]',
    "  every 1 [ print 2 ]",
    "end",
    "arm",
    "wait 1",
  ].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "x" }] },
  });
  assert.deepEqual(result.diagnostics, []);
  // on_key before every, both due at tick 1.
  assert.deepEqual(printedValues(result), [[1], [2]]);
});

test("registration DURING a tick (inside an every body) does not fire in the same tick", () => {
  // An `every 1` whose body registers a NEW `on_key "x"` handler: the newly-registered handler
  // must not fire for a key already pending in this same tick — the pending key queue was already
  // snapshotted/drained before the every step ran. It arms for a later delivery instead.
  const source = [
    'on_key "x" [ print 1 ]',
    'every 1 [ print 2 on_key "x" [ print 3 ] ]',
    "wait 2",
  ].join("\n");
  const result = execute(source, doc, {
    hostInput: {
      events: [
        { tick: 1, kind: "key", key: "x" },
        { tick: 2, kind: "key", key: "x" },
      ],
    },
  });
  assert.deepEqual(result.diagnostics, []);
  // Tick 1: on_key(1) fires, then every(2) fires and registers a second on_key. The tick-1 key is
  // already drained, so print 3 does NOT run at tick 1.
  // Tick 2: the tick-2 key delivers to BOTH on_key handlers in registration order (1, then 3);
  // every(2) fires again and registers yet another on_key (which never receives a key).
  assert.deepEqual(printedValues(result), [[1], [2], [1], [3], [2]]);
});

// --- The wait-during-handlers criterion inherited from I1 ---------------------------------------

test("wait does not defer handler delivery: on_key/on_click/every fire during the pause (l.113-118)", () => {
  // The instructions AFTER the wait are deferred until it elapses, but registered handlers still
  // fire while it elapses. `print 99` (after the wait) must come LAST, after every handler that
  // fired during the pause.
  const source = [
    'on_key "x" [ print 1 ]',
    "every 1 [ print 2 ]",
    "wait 1",
    "print 99",
  ].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "x" }] },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1], [2], [99]]);
});

// --- Determinism: the same program + host input yields the same sequence every run --------------

test("the same program and host input produce an identical event sequence every run", () => {
  const source = [
    'when "go" [ print 1 ]',
    'on_key "x" [ print 2 ]',
    "on_click [ print 3 ]",
    "every 1 [ print 4 ]",
    "wait 1",
  ].join("\n");
  const hostInput = {
    events: [
      { tick: 1, kind: "event", event: "go" },
      { tick: 1, kind: "key", key: "x" },
      { tick: 1, kind: "click" },
    ],
  };
  const first = execute(source, doc, { hostInput });
  const second = execute(source, doc, { hostInput });
  assert.deepEqual(first.diagnostics, []);
  // Full event streams (seq + kind + span + payload) are byte-for-byte identical.
  assert.deepEqual(first.events, second.events);
});

// --- Headless default: no host input means no key/click/event ever fires (I5/I6 preserved) ------

test("with no hostInput, no on_key/on_click/when-host handler fires during a wait", () => {
  const source = [
    'on_key "x" [ print 1 ]',
    "on_click [ print 2 ]",
    'when "go" [ print 3 ]',
    "wait 5",
  ].join("\n");
  const result = execute(source, doc);
  assert.deepEqual(result.diagnostics, []);
  // Only the three registration primitives and the wait primitive — no handler body ran.
  assert.deepEqual(printedValues(result), []);
  assert.deepEqual(primitiveNames(result), [
    "on_key",
    "on_click",
    "when",
    "wait",
  ]);
});

// --- Cancellation: a cancelled run stops cleanly, no handler fires after cancellation ------------

test("a pre-cancelled run emits no events and halts with ol-limit(cancelled)", () => {
  const source = ['on_key "x" [ print 1 ]', "wait 1"].join("\n");
  const result = execute(source, doc, {
    signal: { aborted: true },
    hostInput: { events: [{ tick: 1, kind: "key", key: "x" }] },
  });
  // Cancelled before the first statement: no events at all, and the cancellation diagnostic.
  assert.deepEqual(result.events, []);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.equal(result.diagnostics[0].params.limit, "cancelled");
});

test("cancellation observed via the instruction budget stops further handler delivery mid-tick", () => {
  // A tiny instruction budget: the run halts with ol-limit partway through, and no handler fires
  // after the halt. Already-emitted events remain available (returned unchanged).
  const source = [
    'on_key "x" [ print 1 ]',
    'on_key "x" [ print 2 ]',
    "wait 1",
  ].join("\n");
  // Swept rather than hardcoded, like the two boundary tests below: since #828 a handler FIRING is
  // itself a charged instruction, so the exact budget at which delivery stops mid-tick is an
  // implementation-accounting detail, while the PROPERTY under test — first handler delivered,
  // second refused, no orphan block-head — is not. Sweeping pins the property and survives any
  // future accounting shift; hardcoding pinned the accounting and broke on this one.
  let halted = null;
  for (let budget = 1; budget <= 20; budget++) {
    const probe = execute(source, doc, {
      instructionBudget: budget,
      hostInput: { events: [{ tick: 1, kind: "key", key: "x" }] },
    });
    if (
      probe.diagnostics.length === 1 &&
      probe.diagnostics[0].params.limit === "instruction-budget" &&
      printedValues(probe).length === 1 &&
      printedValues(probe)[0][0] === 1
    ) {
      halted = probe;
      break;
    }
  }
  assert.ok(
    halted,
    "expected a budget where exactly the first handler completes then halts",
  );
  assert.equal(halted.diagnostics.length, 1);
  assert.equal(halted.diagnostics[0].code, "ol-limit");
  assert.equal(halted.diagnostics[0].params.limit, "instruction-budget");
  // The first handler's `print 1` fired; the budget then halts BEFORE the second handler's
  // `print 2`, so exactly `[[1]]` is printed — proof that delivery stops mid-tick and that
  // already-emitted events remain available (returned unchanged).
  assert.deepEqual(printedValues(halted), [[1]]);
  // And the cancelled second handler leaves NO orphan block-head in the trace: cancellation stops
  // future handler DELIVERY, so the halted handler is not started at all — the stream must not end
  // with a bare handler-start `instruction` that produced no effect. The final event is the first
  // handler's own `print`, not a second block-head.
  const last = halted.events[halted.events.length - 1];
  assert.equal(last.kind, "print");
  assert.deepEqual(last.payload.values, [1]);
});

test("a budget that halts exactly at a handler boundary starts no orphan handler", () => {
  // Two handlers become due in one tick; the budget is set so the FIRST handler's body exactly
  // exhausts it. The dispatch boundary check must then stop BEFORE the second handler emits its
  // block-head `instruction` event — otherwise the trace would show a handler that "started" yet ran
  // nothing (the partial-delivery trace incoherence). We assert the exact event tail: it ends with
  // the first handler's `print`, and there is no trailing handler-start instruction.
  const source = ['when "start" [ print 1 ]', 'when "start" [ print 2 ]'].join(
    "\n",
  );
  // `when "start"` handlers fire immediately at registration during a batch run; budget 8 lets the
  // first fire and halts before the second's block-head.
  let budget = 1;
  let halted = null;
  // Find the smallest budget at which exactly the first handler completed (`[[1]]`) with an
  // ol-limit — the exact-boundary case — so the assertion is robust to unrelated instruction-count
  // shifts.
  for (budget = 1; budget <= 20; budget++) {
    const probe = execute(source, doc, { instructionBudget: budget });
    if (
      probe.diagnostics.length === 1 &&
      probe.diagnostics[0].params.limit === "instruction-budget" &&
      printedValues(probe).length === 1 &&
      printedValues(probe)[0][0] === 1
    ) {
      halted = probe;
      break;
    }
  }
  assert.ok(
    halted,
    "expected a budget where exactly the first handler completes then halts",
  );
  assert.deepEqual(printedValues(halted), [[1]]);
  // No orphan: the trace never ends on a handler-start `instruction{ProfileStatement}` with no body
  // effect following it — the last event is the first handler's own `print`.
  const last = halted.events[halted.events.length - 1];
  assert.equal(last.kind, "print");
  assert.deepEqual(last.payload.values, [1]);
});

test("the dispatch-boundary budget guard covers every handler kind (on_click and every included)", () => {
  // The block-head guard lives at the entry every handler kind shares, so an exhausted budget stops
  // an `on_click` OR an `every` handler before its block-head just as it does a `when`/`on_key` one.
  // A single tick makes all four kinds due; a budget swept to the point where the FIRST-dispatched
  // `on_key` handler's body exactly exhausts it proves the later `on_click` and `every` handlers are
  // guarded (no orphan block-head, and their `print`s never appear).
  const source = [
    'on_key "x" [ print 1 ]',
    "on_click [ print 2 ]",
    "every 1 [ print 3 ]",
    "wait 1",
  ].join("\n");
  const hostInput = {
    events: [
      { tick: 1, kind: "key", key: "x" },
      { tick: 1, kind: "click" },
    ],
  };
  // Find the smallest budget where exactly the on_key handler completed (`[[1]]`) then halted — the
  // boundary that exercises the on_click AND every guard-halt branches on the same run.
  let halted = null;
  for (let budget = 1; budget <= 30; budget++) {
    const probe = execute(source, doc, {
      instructionBudget: budget,
      hostInput,
    });
    if (
      probe.diagnostics.length === 1 &&
      probe.diagnostics[0].params.limit === "instruction-budget" &&
      printedValues(probe).length === 1 &&
      printedValues(probe)[0][0] === 1
    ) {
      halted = probe;
      break;
    }
  }
  assert.ok(
    halted,
    "expected a budget where exactly the on_key handler completes then halts",
  );
  // Only handler 1 fired; on_click (2) and every (3) were guarded before their block-heads.
  assert.deepEqual(printedValues(halted), [[1]]);
  const last = halted.events[halted.events.length - 1];
  assert.equal(last.kind, "print");
  assert.deepEqual(last.payload.values, [1]);
});

test("the dispatch-boundary budget guard stops a due every handler with no orphan", () => {
  // As above but with NO on_click between the on_key and the every handler, so the every handler is
  // the first one reached after the budget is exhausted — exercising the `every` kind's own guard
  // branch. The on_key body exactly exhausts the budget; the every handler never emits a block-head.
  const source = [
    'on_key "x" [ print 1 ]',
    "every 1 [ print 3 ]",
    "wait 1",
  ].join("\n");
  const hostInput = { events: [{ tick: 1, kind: "key", key: "x" }] };
  let halted = null;
  for (let budget = 1; budget <= 30; budget++) {
    const probe = execute(source, doc, {
      instructionBudget: budget,
      hostInput,
    });
    if (
      probe.diagnostics.length === 1 &&
      probe.diagnostics[0].params.limit === "instruction-budget" &&
      printedValues(probe).length === 1 &&
      printedValues(probe)[0][0] === 1
    ) {
      halted = probe;
      break;
    }
  }
  assert.ok(
    halted,
    "expected a budget where exactly the on_key handler completes then halts",
  );
  assert.deepEqual(printedValues(halted), [[1]]);
  const last = halted.events[halted.events.length - 1];
  assert.equal(last.kind, "print");
  assert.deepEqual(last.payload.values, [1]);
});

test("an empty-bodied handler is still delivered at an exhausted budget (no statement gate)", () => {
  // An empty handler body has no per-statement budget gate, so the ONLY budget a handler with an
  // empty body must afford is its own firing (issue #828: a handler firing is itself one charged
  // instruction). It therefore still runs at a budget where an otherwise identical handler with a
  // NON-empty body is refused, because that one must additionally afford its body's first statement.
  //
  // This is asserted as a discriminating PAIR at the same budget rather than as a single delivery,
  // so it pins the `bodyHasStatements` arm specifically: a mutation that dropped the arm (charging
  // and gating both bodies alike) would deliver both, and a mutation that applied the body gate to
  // every handler would deliver neither. Only the real rule delivers exactly one.
  const isProfileStart = (event) =>
    event.kind === "instruction" &&
    event.payload.statement_kind === "ProfileStatement";
  // `when "start" [ … ]` fires immediately at registration during a batch run. Each program's
  // ProfileStatement `instruction` events are: [0] the `when` registration statement itself, and —
  // only if the handler is actually delivered — [1] the handler's own fire block-head.
  const budget = 2;
  const empty = execute('when "start" [ ]\nprint 9', doc, {
    instructionBudget: budget,
  });
  const nonEmpty = execute('when "start" [ print 1 ]\nprint 9', doc, {
    instructionBudget: budget,
  });
  // The empty-bodied handler WAS delivered: its block-head is present.
  assert.equal(empty.events.filter(isProfileStart).length, 2);
  // The non-empty twin at the very same budget was NOT: it could not afford its body's first
  // statement, so the guard refused it before any block-head — no orphan "started but ran nothing".
  assert.equal(nonEmpty.events.filter(isProfileStart).length, 1);
  // Both runs halt on the budget, not on a suppressed handler, and neither printed.
  for (const result of [empty, nonEmpty]) {
    assert.deepEqual(printedValues(result), []);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].params.limit, "instruction-budget");
  }
  // The empty handler's block-head is the LAST event — it was delivered, then the budget stopped the
  // following statement, leaving no orphan (a start with no body IS a full delivery of an empty body).
  assert.ok(isProfileStart(empty.events[empty.events.length - 1]));
  // With enough budget for the trailing statement, the empty handler still fires and `print 9` runs —
  // identical handler delivery, just more budget for what follows.
  const atBudget3 = execute('when "start" [ ]\nprint 9', doc, {
    instructionBudget: 3,
  });
  assert.deepEqual(printedValues(atBudget3), [[9]]);
  assert.equal(atBudget3.events.filter(isProfileStart).length, 2);
});

// --- Cross-thread cancellation (the Web-Worker `Atomics`-backed signal) ---------------------------
// `CancellationSignal` (evaluate.ts:151-174) documents the realistic deployment: `execute()` runs in
// a Web Worker whose `aborted` getter reads a `SharedArrayBuffer` the main thread's Stop button
// writes with `Atomics.store`. Such a getter is FAITHFUL yet can return `false` at a handler's
// dispatch guard and `true` a moment later at the body's first-statement gate (the OS suspended the
// worker in between and the main thread aborted). These tests model that with a getter that flips
// after a set number of reads — the shape a real Atomics buffer produces — and prove the dispatch
// guard stops delivery cleanly with no orphan handler-start. (A JSON conformance fixture cannot
// express a signal that flips mid-run — the same limitation the harness notes for `executeOptions.signal`
// — so this cross-thread case is proven here, through the public `execute()`, not by a fixture.)

/**
 * A faithful stand-in for the documented `Atomics`-backed worker signal: `aborted` reads `false`
 * for the first `flipAfter` reads, then `true` for every read after — exactly what a
 * `SharedArrayBuffer` flipped by the main thread mid-run looks like to the worker's getter.
 */
function signalAbortingAfter(flipAfter) {
  let reads = 0;
  return {
    get aborted() {
      reads += 1;
      return reads > flipAfter;
    },
  };
}

test("a cross-thread abort at a handler dispatch boundary starts no orphan handler", () => {
  // Two on_key handlers become due in one tick. A signal that flips to aborted just as dispatch
  // reaches the SECOND handler must stop it BEFORE its block-head — no orphan handler-start, and its
  // `print 2` never runs. We sweep the flip point to find the boundary that lands between the two
  // handlers, robust to the exact number of `aborted` reads the run makes.
  const source = [
    'on_key "x" [ print 1 ]',
    'on_key "x" [ print 2 ]',
    "wait 1",
  ].join("\n");
  const hostInput = { events: [{ tick: 1, kind: "key", key: "x" }] };
  let halted = null;
  for (let flipAfter = 1; flipAfter <= 60; flipAfter++) {
    const probe = execute(source, doc, {
      signal: signalAbortingAfter(flipAfter),
      hostInput,
    });
    if (
      probe.diagnostics.length === 1 &&
      probe.diagnostics[0].params.limit === "cancelled" &&
      printedValues(probe).length === 1 &&
      printedValues(probe)[0][0] === 1
    ) {
      halted = probe;
      break;
    }
  }
  assert.ok(
    halted,
    "expected a flip point where exactly the first handler completes then the run is cancelled",
  );
  // Only handler 1 fired; handler 2 was guarded before its block-head by the abort check.
  assert.deepEqual(printedValues(halted), [[1]]);
  assert.equal(halted.diagnostics[0].code, "ol-limit");
  assert.equal(halted.diagnostics[0].params.limit, "cancelled");
  // No orphan: the trace ends on the first handler's `print`, not a bare second handler-start.
  const last = halted.events[halted.events.length - 1];
  assert.equal(last.kind, "print");
  assert.deepEqual(last.payload.values, [1]);
});

test("a cross-thread abort suppresses even an empty handler's delivery (abort is ungated by body)", () => {
  // The empty-body exemption is for the BUDGET branch only — a cancelled run must stop delivery of
  // every kind, including a zero-cost empty handler. A `when "start" [ ]` fires immediately at
  // registration; a cross-thread signal that flips to aborted AFTER registration but AT the empty
  // handler's dispatch guard must suppress its fire block-head. This proves the abort branch is NOT
  // gated on `bodyHasStatements` — were it gated, the empty handler would still be delivered here
  // (the test would pass for the wrong reason). We use a faithful getter-flip signal and sweep the
  // flip point to find the one that lands between the `when` registration statement and the empty
  // handler's dispatch, robust to the exact number of `aborted` reads the run makes.
  const source = 'when "start" [ ]';
  const isProfileStart = (event) =>
    event.kind === "instruction" &&
    event.payload.statement_kind === "ProfileStatement";
  let halted = null;
  for (let flipAfter = 1; flipAfter <= 20; flipAfter++) {
    const probe = execute(source, doc, {
      signal: signalAbortingAfter(flipAfter),
    });
    // The target case: the run got far enough to run the `when` registration statement (so its
    // registration `instruction{ProfileStatement}` exists) but was cancelled at the empty handler's
    // dispatch guard, so exactly ONE ProfileStatement (the registration) appears — not two — and the
    // run halted with ol-limit(cancelled).
    if (
      probe.diagnostics.length === 1 &&
      probe.diagnostics[0].params.limit === "cancelled" &&
      probe.events.filter(isProfileStart).length === 1
    ) {
      halted = probe;
      break;
    }
  }
  assert.ok(
    halted,
    "expected a flip point where the when registration ran but the empty handler was cancelled at dispatch",
  );
  assert.equal(halted.diagnostics[0].code, "ol-limit");
  assert.equal(halted.diagnostics[0].params.limit, "cancelled");
  // Exactly one ProfileStatement instruction: the `when` registration statement. The empty handler's
  // OWN fire block-head is absent — it was suppressed at the ungated abort guard, not delivered. Were
  // the abort branch mistakenly gated on `bodyHasStatements`, a second ProfileStatement (the empty
  // handler's fire block-head) would appear here.
  assert.equal(halted.events.filter(isProfileStart).length, 1);
});

test("a cross-thread abort during a long wait with no due handler is observed by the per-tick poll", () => {
  // A long `wait` whose ticks contain NO due handler and which has NO trailing top-level statement
  // isolates the per-tick cancellation poll as the *only* observer of a mid-wait abort: `every 10`
  // is never due within `wait 5`, and nothing follows the wait. So neither a handler's dispatch
  // guard nor a later statement's `checkExecutionLimits` can see the abort — only
  // `dispatchDueHandlers`' own per-tick poll can. A signal that flips mid-pause (flipAfter=4 lands
  // inside the wait loop, past the top-level `wait` statement's own gate) must therefore halt the
  // run with ol-limit(cancelled). If the per-tick poll were removed, the wait would run all five
  // ticks to completion and the run would end cleanly with NO diagnostic — so removing this poll
  // makes the diagnostic assertion below fail, pinning it against silent removal (the F3/inert-test
  // failure mode).
  const source = ["every 10 [ print 1 ]", "wait 5"].join("\n");
  const result = execute(source, doc, {
    signal: signalAbortingAfter(4),
  });
  // The `every 10` handler is never due within five ticks, so it never fires regardless.
  assert.deepEqual(printedValues(result), []);
  // Only the per-tick poll can observe the mid-wait abort here: it must halt with ol-limit(cancelled).
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.equal(result.diagnostics[0].params.limit, "cancelled");
  // Prove the abort was observed INSIDE the wait loop, not before it. Two independent signals, both
  // required: (1) the `wait` STATEMENT was reached and began — its `instruction` event (the sole
  // top-level `Call` in this program) is present, so a hypothetical poll that aborted *before*
  // entering the wait loop could not produce this stream; (2) the `wait` never emits its COMPLETION
  // primitive, so it was interrupted mid-pause rather than running all five ticks out. Entered-but-
  // not-completed is exactly the mid-wait-abort signature the per-tick poll is responsible for, which
  // keeps the poll the thing under test.
  const waitStatementEntered = result.events.some(
    (event) =>
      event.kind === "instruction" && event.payload.statement_kind === "Call",
  );
  assert.ok(waitStatementEntered);
  assert.ok(primitiveNames(result).includes("every"));
  assert.ok(!primitiveNames(result).includes("wait"));
});

test("a runaway handler body halts with ol-limit(instruction-budget), not an infinite loop", () => {
  // An `on_key` body with an unbounded `forever` is bounded by the instruction budget — the handler
  // cannot hang the run. Proves the safety budget reaches inside handler bodies.
  const source = ['on_key "x" [ forever [ print 1 ] ]', "wait 1"].join("\n");
  const result = execute(source, doc, {
    instructionBudget: 50,
    hostInput: { events: [{ tick: 1, kind: "key", key: "x" }] },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.equal(result.diagnostics[0].params.limit, "instruction-budget");
});

// --- hostInput is host CONTEXT, never observable in the stream -----------------------------------

test("no injected tick/key/coordinate leaks into any event payload", () => {
  const source = ['on_key "x" [ print 1 ]', "wait 1"].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "x" }] },
  });
  assert.deepEqual(result.diagnostics, []);
  for (const event of result.events) {
    const keys = Object.keys(event.payload);
    assert.ok(!keys.includes("tick"), `event ${event.kind} leaked a tick`);
    assert.ok(!keys.includes("key"), `event ${event.kind} leaked a key`);
    assert.ok(
      !keys.includes("coordinate"),
      `event ${event.kind} leaked a coordinate`,
    );
  }
});

test("hostInput may be supplied in any order; it is sorted by tick per run", () => {
  const source = [
    'on_key "x" [ print 1 ]',
    "on_click [ print 2 ]",
    "wait 2",
  ].join("\n");
  // click at tick 2 listed BEFORE key at tick 1 — must still fire key (tick 1) then click (tick 2).
  const result = execute(source, doc, {
    hostInput: {
      events: [
        { tick: 2, kind: "click" },
        { tick: 1, kind: "key", key: "x" },
      ],
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1], [2]]);
});

test("an empty hostInput array behaves exactly like omitting it", () => {
  const source = ['on_key "x" [ print 1 ]', "wait 1"].join("\n");
  const withEmpty = execute(source, doc, { hostInput: { events: [] } });
  const without = execute(source, doc);
  assert.deepEqual(withEmpty.events, without.events);
  assert.deepEqual(withEmpty.diagnostics, []);
});

// --- A handler block is not a procedure body: `return`/`stop` escaping it is a diagnostic --------
// A delivered `on_key`/`on_click` handler whose body runs `return`/`stop` must surface the same
// `ol-return-outside-proc`/`ol-stop-outside-proc` diagnostic the top level and `when`/`every`
// handlers do — these bodies are NOT procedure bodies. This can only be reached by actually
// delivering a host key/click through `execute()` (a `check` never runs the body), so it lives here.

test("`return` escaping a delivered on_key body halts with ol-return-outside-proc", () => {
  const source = ['on_key "x" [ return 1 ]', "wait 1"].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "x" }] },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-outside-proc");
});

test("`stop` escaping a delivered on_key body halts with ol-stop-outside-proc", () => {
  const source = ['on_key "x" [ stop ]', "wait 1"].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "x" }] },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-stop-outside-proc");
});

test("`return` escaping a delivered on_click body halts with ol-return-outside-proc", () => {
  const source = ["on_click [ return 1 ]", "wait 1"].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 1, kind: "click" }] },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-outside-proc");
});

test("`stop` escaping a delivered on_click body halts with ol-stop-outside-proc", () => {
  const source = ["on_click [ stop ]", "wait 1"].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 1, kind: "click" }] },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-stop-outside-proc");
});

// --- Regression locks for the review-gate findings (rubber-duck, issue #686) --------------------

test("same-kind order is the HANDLERS' registration order, not the host's delivery order", () => {
  // Register on_key "a" then "b"; deliver them REVERSED (b before a) in the same tick. The spec
  // (l.84-89) orders "pending on_key events in registration order" — the handlers' registration
  // order, which host-input order must NOT override. So the output is 1 (handler a) then 2
  // (handler b), never 2 then 1.
  const source = [
    'on_key "a" [ print 1 ]',
    'on_key "b" [ print 2 ]',
    "wait 1",
  ].join("\n");
  const result = execute(source, doc, {
    hostInput: {
      events: [
        { tick: 1, kind: "key", key: "b" },
        { tick: 1, kind: "key", key: "a" },
      ],
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1], [2]]);
});

test("a `wait 0` honors a tick-0 handler's halt instead of swallowing it", () => {
  // `wait 0` is a spec-mandated yield, not a no-op: a current-tick (tick 0) host key whose handler
  // body escapes with `return` MUST surface ol-return-outside-proc and defer the following
  // top-level `print 99`, exactly as an advanced-tick handler would. (Ignoring the wait-0 dispatch
  // verdict swallowed this.)
  const source = ['on_key "x" [ return 1 ]', "wait 0", "print 99"].join("\n");
  const result = execute(source, doc, {
    hostInput: { events: [{ tick: 0, kind: "key", key: "x" }] },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-outside-proc");
  assert.deepEqual(printedValues(result), []);
});

test("a nested `wait` inside a handler cannot overtake older same-tick invocations", () => {
  // Two on_key "k" handlers and an on_click all become due at tick 1. The FIRST key handler runs a
  // nested `wait 1` mid-body. That nested wait must NOT deliver the still-pending click before the
  // rest of THIS tick's earlier-in-order key invocations finish — the whole tick's ordered batch is
  // fixed up front. Expected: 1, then (after the nested wait) 11, then key handler 2, then click 3.
  const source = [
    'on_key "k" [ print 1 wait 1 print 11 ]',
    'on_key "k" [ print 2 ]',
    "on_click [ print 3 ]",
    "wait 2",
  ].join("\n");
  const result = execute(source, doc, {
    hostInput: {
      events: [
        { tick: 1, kind: "key", key: "k" },
        { tick: 1, kind: "click" },
      ],
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1], [11], [2], [3]]);
});

test("a persistent `when` handler fires once per occurrence when its event is pending twice", () => {
  // `when` is PERSISTENT (maintainer ruling #984, `spec/interaction-events.md:210-215`): its block
  // runs "each time the named event occurs, once per occurrence". Two deliveries of the same named
  // event in one tick therefore fire the handler twice, exactly as two presses of the same key fire
  // an `on_key` handler twice. Before the ruling this printed once, from a one-shot `fired` flag.
  const source = ['when "go" [ print 1 ]', "wait 1"].join("\n");
  const result = execute(source, doc, {
    hostInput: {
      events: [
        { tick: 1, kind: "event", event: "go" },
        { tick: 1, kind: "event", event: "go" },
      ],
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1], [1]]);
});

test("a persistent `when` handler fires again when its event occurs on a later tick", () => {
  // The across-tick half of the same ruling, and the case the conformance corpus recorded as
  // measured one-shot behaviour before #984: the same event delivered at tick 1 and tick 2 fires the
  // handler on BOTH ticks. A vendor-prefixed word (`spec/interaction-events.md:207-208`) is used
  // because `"start"`/`"stop"` occur once per run and so cannot tell the two readings apart.
  const source = ['when "acme.shake" [ print 1 ]', "wait 2"].join("\n");
  const result = execute(source, doc, {
    hostInput: {
      events: [
        { tick: 1, kind: "event", event: "acme.shake" },
        { tick: 2, kind: "event", event: "acme.shake" },
      ],
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1], [1]]);
});

// Unit tests for `ExecuteOptions.observedEvents` (issue #876) — the seam that lets a host read the
// trace/event stream *while* a run is suspended inside `hostInput.read`, rather than only when
// `execute()` returns.
//
// It exists to make a normative allowance reachable. `spec/interaction-events.md:168-170`: "While
// `input` is waiting, the implementation MAY continue rendering already-emitted trace events, but
// it MUST NOT run new OpenLogo instructions or event handler blocks until the read finishes or the
// program is cancelled." The reader is called with the prompt and nothing else, so before this
// option a host that blocks inside it — a Worker parked on `Atomics.wait`, which is what #876
// builds — had no way to show the learner what the program had already drawn, and would have had to
// present the question over a blank canvas.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

/** A program that draws, prints, then asks — so a read has a non-trivial prefix to observe. */
const DRAW_PRINT_ASK = [
  "forward 100",
  'print "before"',
  ':distance = input "how far?"',
  "forward :distance",
].join("\n");

test("issue #876: the sink is readable from INSIDE the blocking reader", () => {
  const observed = [];
  let kindsAtRead = null;

  const result = execute(DRAW_PRINT_ASK, doc, {
    observedEvents: observed,
    hostInput: {
      read: () => {
        kindsAtRead = observed.map((event) => event.kind);
        return "40";
      },
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(kindsAtRead, [
    "instruction",
    "move",
    "draw-segment",
    "instruction",
    "print",
    "instruction",
  ]);
});

test("issue #876: the prefix visible at the read is exactly the run's own prefix, not a copy that drifts", () => {
  const observed = [];
  let prefixLengthAtRead = 0;

  const result = execute(DRAW_PRINT_ASK, doc, {
    observedEvents: observed,
    hostInput: {
      read: () => {
        prefixLengthAtRead = observed.length;
        return "40";
      },
    },
  });

  // The sink IS the array `execute()` reports, so the run only ever EXTENDS what the host saw —
  // the same monotonicity the studio's `input` prompt depends on.
  assert.equal(observed, result.events);
  assert.equal(prefixLengthAtRead > 0, true);
  assert.equal(result.events.length > prefixLengthAtRead, true);
  assert.deepEqual(
    result.events.slice(0, prefixLengthAtRead).map((event) => event.kind),
    observed.slice(0, prefixLengthAtRead).map((event) => event.kind),
  );
});

test("issue #876: the run continues past the read, and the later events land in the same sink", () => {
  const observed = [];
  const result = execute(DRAW_PRINT_ASK, doc, {
    observedEvents: observed,
    hostInput: { read: () => "40" },
  });

  assert.deepEqual(result.diagnostics, []);
  // Two `forward`s in total: the one before the read and the one the answer produced.
  assert.equal(
    observed.filter((event) => event.kind === "move").length,
    2,
    "the answer's own movement must be appended to the same sink",
  );
});

test("issue #876: omitting observedEvents changes nothing", () => {
  const withSink = [];
  const seeded = { randomSeed: 7 };
  const a = execute(DRAW_PRINT_ASK, doc, {
    ...seeded,
    observedEvents: withSink,
    hostInput: { read: () => "40" },
  });
  const b = execute(DRAW_PRINT_ASK, doc, {
    ...seeded,
    hostInput: { read: () => "40" },
  });

  assert.deepEqual(a.diagnostics, []);
  assert.deepEqual(b.diagnostics, []);
  assert.deepEqual(
    a.events.map((event) => event.kind),
    b.events.map((event) => event.kind),
  );
});

test("issue #876: a program that fails to parse appends nothing", () => {
  // The parse diagnostics return before any environment exists, so there is no run to observe —
  // and `ExecuteResult.events` is empty for the same reason. A host must not read a stale prefix.
  //
  // Identity is deliberately NOT asserted here: a pre-environment exit never reaches the sink, so
  // it reports its own separate empty array. That is exactly why the documented contract is about
  // the sink's CONTENTS, not about `result.events === observedEvents` — see `ExecuteOptions`.
  const observed = [];
  const result = execute("forward [", doc, { observedEvents: observed });

  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unmatched-bracket"],
  );
  assert.deepEqual(observed, []);
  assert.deepEqual(result.events, []);
});

test("issue #876: a run halted by a runtime diagnostic still leaves its prefix in the sink", () => {
  const observed = [];
  const result = execute("forward 100\nprint :nope", doc, {
    observedEvents: observed,
  });

  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-undefined-var"],
  );
  assert.deepEqual(
    observed.map((event) => event.kind),
    ["instruction", "move", "draw-segment", "instruction"],
    "everything emitted before the failure is observable, so a host can still render it",
  );
});

test("issue #876: the sink is appended to, never cleared — so one array per run", () => {
  // Documented contract: pass a fresh array. Reusing one concatenates, which this pins so the
  // behaviour is a decision rather than an accident a caller discovers in production.
  const shared = [];
  execute('print "first"', doc, { observedEvents: shared });
  const firstLength = shared.length;
  execute('print "second"', doc, { observedEvents: shared });

  assert.equal(shared.length > firstLength, true);
  assert.deepEqual(
    shared
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]),
    ["first", "second"],
  );
});

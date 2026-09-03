// Unit tests for the runtime→host **handler contract** (issues #954 and #975) — the two halves of
// one question: what the runtime tells an interactive host about handlers.
//
// - **Outbound (#954)** — a handler-firing `instruction` event carries a `handler` discriminator
//   naming which block-head fired and its own argument, so a consumer reads a field instead of
//   re-deriving the handler kind from span WIDTH. Proven end-to-end by the conformance fixtures
//   under `tests/conformance/interaction-events/dispatch/`; asserted here only where a unit test
//   discriminates something a fixture cannot (a raising handler, an exhausted budget).
// - **Inbound (#975)** — `ExecuteOptions.handlerRegistrations` answers "which key words currently
//   have handlers" and `ExecuteOptions.handlerDeliveries` answers "was this delivered input
//   handled". These are **host-facing TypeScript API**, not language behavior: a conformant
//   implementation in another language would expose them differently, so they are unit-tested here
//   rather than pinned in the stack-neutral conformance corpus.
//
// Node-version trap: on Node 24+ `--experimental-test-coverage` silently excludes `*.test.mjs`, so
// a local coverage green can be a false positive that CI (Node 22) then fails. Run coverage with
// `npx -y node@22 scripts/coverage.mjs`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "handler-contract.logo";

/** The `handler` payloads of every handler-firing `instruction` event, in emission order. */
function firings(result) {
  return result.events
    .filter((event) => event.kind === "instruction" && event.payload.handler)
    .map((event) => event.payload.handler);
}

/** The values every `print` in the run emitted, flattened, in order. */
function printed(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .flatMap((event) => event.payload.values);
}

test("a registration emits no handler discriminator; only a firing does (#954)", () => {
  const result = execute(`on_key "space" [ print 1 ]\nwait 1`, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "space" }] },
  });
  const instructions = result.events.filter(
    (event) => event.kind === "instruction",
  );
  const registration = instructions.find(
    (event) => event.source_span.start[0] === 1 && !event.payload.handler,
  );
  const firing = instructions.find((event) => event.payload.handler);
  // The exact inference #954 replaces: both start at line 1, column 1 and carry the same
  // `statement_kind`, so before the discriminator they differed only in `end`.
  assert.deepEqual(registration.source_span.start, [1, 1]);
  assert.deepEqual(firing.source_span.start, [1, 1]);
  assert.equal(registration.payload.statement_kind, "ProfileStatement");
  assert.equal(firing.payload.statement_kind, "ProfileStatement");
  assert.notDeepEqual(registration.source_span.end, firing.source_span.end);
  // …and the field, not the width, is now the answer.
  assert.equal(registration.payload.handler, undefined);
  assert.deepEqual(firing.payload.handler, { kind: "on_key", key: "space" });
});

test("each handler kind names its own block-head argument (#954)", () => {
  const result = execute(
    `when "go" [ print 1 ]\non_key "x" [ print 2 ]\non_click [ print 3 ]\nevery 1 [ print 4 ]\nwait 1`,
    doc,
    {
      hostInput: {
        events: [
          { tick: 1, kind: "event", event: "go" },
          { tick: 1, kind: "key", key: "x" },
          { tick: 1, kind: "click" },
        ],
      },
    },
  );
  assert.deepEqual(firings(result), [
    { kind: "when", event: "go" },
    { kind: "on_key", key: "x" },
    { kind: "on_click" },
    { kind: "every", interval: 1 },
  ]);
});

test("the registration log answers which key words have handlers (#975)", () => {
  const handlerRegistrations = [];
  execute(
    `on_key "left" [ forward 1 ]\non_key "space" [ forward 2 ]\nwhen "go" [ forward 3 ]\nevery 4 [ forward 4 ]\non_click [ forward 5 ]`,
    doc,
    { handlerRegistrations },
  );
  const keys = handlerRegistrations
    .filter((entry) => entry.kind === "on_key")
    .map((entry) => entry.key);
  assert.deepEqual(keys, ["left", "space"]);
  // The whole log, in registration order, with each kind carrying its own argument.
  assert.deepEqual(
    handlerRegistrations.map((entry) => entry.kind),
    ["on_key", "on_key", "when", "every", "on_click"],
  );
  assert.equal(handlerRegistrations[3].interval, 4);
  assert.equal(handlerRegistrations[2].event, "go");
  // The registration site, so a host never pairs declarations to registrations by source position.
  assert.deepEqual(handlerRegistrations[0].source_span.start, [1, 1]);
  assert.deepEqual(handlerRegistrations[1].source_span.start, [2, 1]);
});

test("a duplicate registration is logged twice, never collapsed (#975)", () => {
  // `spec/interaction-events.md`: "implementations MUST NOT collapse, deduplicate, or replace
  // registrations", so the log is the registration set and a host counting listeners is not misled.
  const handlerRegistrations = [];
  execute(`repeat 3\n  on_key "space" [ forward 1 ]\nend repeat`, doc, {
    handlerRegistrations,
  });
  assert.equal(handlerRegistrations.length, 3);
});

test("a registration appears in the log only once its statement executes (#975)", () => {
  // The honest limit documented on `HandlerRegistration`: registrations are not knowable before the
  // run. The un-taken branch registers nothing, so the log reports what the program actually did.
  const handlerRegistrations = [];
  execute(
    `if 1 == 2\n  on_key "never" [ forward 1 ]\nend if\non_key "taken" [ forward 1 ]`,
    doc,
    { handlerRegistrations },
  );
  assert.deepEqual(
    handlerRegistrations.map((entry) => entry.key),
    ["taken"],
  );
});

test("a delivery reports how many handlers it ran (#975)", () => {
  const press = { tick: 1, kind: "key", key: "space" };
  const handlerDeliveries = [];
  const result = execute(
    `on_key "space" [ print 1 ]\non_key "space" [ print 2 ]\nwait 1`,
    doc,
    {
      hostInput: { events: [press] },
      handlerDeliveries,
    },
  );
  assert.equal(handlerDeliveries.length, 1);
  assert.equal(handlerDeliveries[0].invocations, 2);
  // The count agrees with what the program itself printed — the report is not a parallel truth.
  assert.deepEqual(printed(result), [1, 2]);
  // `input` is the caller's OWN schedule entry, by identity — asserted with `strictEqual`, because
  // a `deepEqual` would also accept a clone and the documented contract is identity.
  assert.strictEqual(handlerDeliveries[0].input, press);
});

test("a delivery no handler names reports zero, not absence (#975)", () => {
  const handlerDeliveries = [];
  execute(`on_key "space" [ print 1 ]\nwait 1`, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "nothing_listens" }] },
    handlerDeliveries,
  });
  assert.equal(handlerDeliveries.length, 1);
  assert.equal(handlerDeliveries[0].invocations, 0);
});

test("a handler that RAISES still counts as handled (#975)", () => {
  // The axis that broke the event-stream-length proxy: a raising handler SHORTENS the stream, so
  // growth reported "nothing responded" for a handler that plainly responded. The count is taken
  // when the block-head event is emitted, before the body runs, so it cannot invert.
  const handlerDeliveries = [];
  const result = execute(`on_key "space" [ print :nope ]\nwait 1`, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "space" }] },
    handlerDeliveries,
  });
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(printed(result), []);
  assert.equal(handlerDeliveries[0].invocations, 1);
});

test("each delivery is reported separately, in delivery order (#975)", () => {
  const handlerDeliveries = [];
  const result = execute(
    `on_key "a" [ print 1 ]\non_key "b" [ print 2 ]\non_key "b" [ print 3 ]\nwait 3`,
    doc,
    {
      hostInput: {
        events: [
          { tick: 1, kind: "key", key: "a" },
          { tick: 2, kind: "key", key: "zzz" },
          { tick: 3, kind: "key", key: "b" },
        ],
      },
      handlerDeliveries,
    },
  );
  assert.deepEqual(
    handlerDeliveries.map((entry) => entry.invocations),
    [1, 0, 2],
  );
  assert.deepEqual(printed(result), [1, 2, 3]);
});

test("two presses of one key in one tick are two deliveries (#975)", () => {
  // Multiplicity is preserved per occurrence: two presses of `a` against two handlers for `a` run
  // four bodies, credited two-and-two rather than four-and-zero. The flattened claim batch is
  // handler-major/occurrence-minor, so an invocation cannot be attributed back to its occurrence by
  // position after the fact — pairing happens at claim time, which is why this is observed and not
  // re-derived.
  const handlerDeliveries = [];
  const result = execute(
    `on_key "a" [ print 1 ]\non_key "a" [ print 2 ]\nwait 1`,
    doc,
    {
      hostInput: {
        events: [
          { tick: 1, kind: "key", key: "a" },
          { tick: 1, kind: "key", key: "a" },
        ],
      },
      handlerDeliveries,
    },
  );
  assert.deepEqual(
    handlerDeliveries.map((entry) => entry.invocations),
    [2, 2],
  );
  assert.equal(printed(result).length, 4);
});

test("a click reports every registered handler it ran (#975)", () => {
  const handlerDeliveries = [];
  execute(`on_click [ print 1 ]\non_click [ print 2 ]\nwait 2`, doc, {
    hostInput: {
      events: [
        { tick: 1, kind: "click" },
        { tick: 2, kind: "click" },
      ],
    },
    handlerDeliveries,
  });
  assert.deepEqual(
    handlerDeliveries.map((entry) => entry.invocations),
    [2, 2],
  );
});

test("a named event delivery reports its when handlers (#975)", () => {
  const handlerDeliveries = [];
  execute(`when "acme.shake" [ print 1 ]\nwait 1`, doc, {
    hostInput: {
      events: [{ tick: 1, kind: "event", event: "acme.shake" }],
    },
    handlerDeliveries,
  });
  assert.deepEqual(
    handlerDeliveries.map((entry) => entry.invocations),
    [1],
  );
});

test("a delivery the run never reached has no record at all (#975)", () => {
  // Truthful rather than optimistic: the run closes after `wait 1`, so the tick-9 press is never
  // delivered and is absent, instead of appearing with a count it never earned.
  const handlerDeliveries = [];
  execute(`on_key "space" [ print 1 ]\nwait 1`, doc, {
    hostInput: {
      events: [
        { tick: 1, kind: "key", key: "space" },
        { tick: 9, kind: "key", key: "space" },
      ],
    },
    handlerDeliveries,
  });
  assert.equal(handlerDeliveries.length, 1);
  assert.equal(handlerDeliveries[0].invocations, 1);
});

test("a handler stopped by the budget is not counted as having run (#975)", () => {
  // `guardHandlerDispatch` returns before the block-head event is emitted, so nothing ran and
  // nothing is credited — the mirror of the raising-handler case above.
  const handlerDeliveries = [];
  const result = execute(`on_key "space" [ print 1 ]\nwait 1`, doc, {
    hostInput: { events: [{ tick: 1, kind: "key", key: "space" }] },
    handlerDeliveries,
    instructionBudget: 3,
  });
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.equal(firings(result).length, 0);
  assert.equal(handlerDeliveries[0].invocations, 0);
});

test("the sinks change no event, diagnostic, or ordering (#975)", () => {
  // Out-of-band by construction: supplying them only makes facts readable, never different. Compared
  // as serialized JSON, not just structurally, and over a RAISING program as well as a clean one —
  // the error path is where an accidental perturbation is likeliest to hide.
  for (const body of ["print 1", "print :nope"]) {
    const source = `on_key "space" [ ${body} ]\nevery 1 [ print 2 ]\nwait 2`;
    const hostInput = { events: [{ tick: 1, kind: "key", key: "space" }] };
    const withoutSinks = execute(source, doc, { hostInput });
    const withSinks = execute(source, doc, {
      hostInput,
      handlerRegistrations: [],
      handlerDeliveries: [],
    });
    assert.equal(
      JSON.stringify(withSinks.events),
      JSON.stringify(withoutSinks.events),
    );
    assert.equal(
      JSON.stringify(withSinks.diagnostics),
      JSON.stringify(withoutSinks.diagnostics),
    );
  }
});

test("a handler argument is the REGISTERED value, not the source text (#954)", () => {
  // The payload reports the handler's registration-time signature — the evaluated argument fixed when the
  // registration statement ran. Nothing here is recoverable by slicing source text at the span,
  // which is exactly why the runtime has to report it: `:n` is a variable, and the numeric word
  // `"2"` is validated to the NUMBER 2 before the handler is recorded.
  const result = execute(
    `:n = 2\n:k = "space"\nevery :n [ print 1 ]\non_key :k [ print 2 ]\nevery "3" [ print 3 ]\nwait 3`,
    doc,
    { hostInput: { events: [{ tick: 1, kind: "key", key: "space" }] } },
  );
  const seen = firings(result);
  assert.deepEqual(seen[0], { kind: "on_key", key: "space" });
  assert.ok(
    seen.some((handler) => handler.kind === "every" && handler.interval === 2),
    "the `every :n` handler reports the evaluated interval 2",
  );
  const three = seen.find(
    (handler) => handler.kind === "every" && handler.interval === 3,
  );
  assert.ok(three, 'the `every "3"` handler reports a NUMBER, not the word');
  assert.equal(typeof three.interval, "number");
});

test("the payload is registration-time signature, not occurrence metadata (#954)", () => {
  // The `HandlerFiring` invariant, turned into an assertion rather than left as prose. Its
  // observable consequence: because the payload describes the REGISTERED HANDLER and carries
  // nothing about *this* delivery, every firing of one handler reports byte-identical values — no
  // tick, no delivery index, no queue depth, nothing that varies per occurrence.
  //
  // This is the guard the invariant lacked. Two successive prose wordings of it shipped wrong
  // because nothing could falsify them; an occurrence-varying field added later now fails here.
  //
  // **All four handler kinds are driven three times each**, deliberately: an earlier version
  // covering only `on_key`/`every` was measured to MISS an occurrence field added to `when` or
  // `on_click` alone. Note `when` must be driven by a repeated host-delivered event — a
  // `when "start"` fires exactly once and so could not witness a collapse at all.
  const result = execute(
    `when "go" [ print 1 ]\non_key "space" [ print 2 ]\non_click [ print 3 ]\nevery 1 [ print 4 ]\nwait 3`,
    doc,
    {
      hostInput: {
        events: [1, 2, 3].flatMap((tick) => [
          { tick, kind: "event", event: "go" },
          { tick, kind: "key", key: "space" },
          { tick, kind: "click" },
        ]),
      },
    },
  );
  const byKind = new Map();
  for (const handler of firings(result)) {
    byKind.set(handler.kind, [
      ...(byKind.get(handler.kind) ?? []),
      JSON.stringify(handler),
    ]);
  }
  // Control: every kind really did fire three times, so no assertion below passes on an empty set.
  assert.deepEqual([...byKind.keys()].sort(), [
    "every",
    "on_click",
    "on_key",
    "when",
  ]);
  for (const [kind, payloads] of byKind) {
    assert.equal(payloads.length, 3, `${kind} should have fired three times`);
    assert.equal(
      new Set(payloads).size,
      1,
      `${kind} payloads varied across firings: ${payloads.join(" | ")}`,
    );
  }
  // And each payload carries exactly its identifying fields — a new occurrence-varying key would
  // both break the collapse above and widen one of these shapes.
  const shapeOf = (kind) => Object.keys(JSON.parse(byKind.get(kind)[0])).sort();
  assert.deepEqual(shapeOf("when"), ["event", "kind"]);
  assert.deepEqual(shapeOf("on_key"), ["key", "kind"]);
  assert.deepEqual(shapeOf("on_click"), ["kind"]);
  assert.deepEqual(shapeOf("every"), ["interval", "kind"]);
});

test("duplicate registrations are NOT distinguishable in the stream (#954)", () => {
  // The documented limit of the signature, pinned so it cannot be quietly claimed otherwise. The
  // spec requires three distinct handlers here ("MUST NOT collapse, deduplicate, or replace
  // registrations") and all three prove they ran by printing — but their firing events are
  // identical in BOTH payload and source span, so nothing in the stream tells them apart.
  //
  // Asserting the collapse over payload AND span together is the strong form: payload alone would
  // be the weaker claim, since the spans could still have differed. A consumer needing
  // per-registration identity uses `handlerRegistrations`, which reports three entries here.
  const handlerRegistrations = [];
  const result = execute(
    `repeat 3\n  on_key "space" [ print 1 ]\nend repeat\nwait 1`,
    doc,
    {
      hostInput: { events: [{ tick: 1, kind: "key", key: "space" }] },
      handlerRegistrations,
    },
  );
  const firingEvents = result.events.filter(
    (event) => event.kind === "instruction" && event.payload.handler,
  );
  // Controls: three distinct handlers really did register and run, so the collapse below is a
  // statement about three indistinguishable events rather than about one event.
  assert.equal(handlerRegistrations.length, 3);
  assert.equal(firingEvents.length, 3);
  assert.deepEqual(printed(result), [1, 1, 1]);
  const rendered = firingEvents.map((event) =>
    JSON.stringify([event.payload, event.source_span]),
  );
  assert.equal(new Set(rendered).size, 1);
});

test('a `when "start"` handler is credited to no delivery (#975)', () => {
  // `when "start"` fires during registration, not from host input, so it must contribute 0 to every
  // delivery record — otherwise a host would read a press as having run a handler it never touched.
  const handlerDeliveries = [];
  const result = execute(
    `when "start" [ print 1 ]\non_key "space" [ print 2 ]\nwait 1`,
    doc,
    {
      hostInput: { events: [{ tick: 1, kind: "key", key: "space" }] },
      handlerDeliveries,
    },
  );
  // The `start` handler demonstrably ran — the control that stops this passing vacuously.
  assert.deepEqual(firings(result), [
    { kind: "when", event: "start" },
    { kind: "on_key", key: "space" },
  ]);
  assert.deepEqual(printed(result), [1, 2]);
  // …and the press is credited with its own handler only, not with the `start` firing too.
  assert.deepEqual(
    handlerDeliveries.map((entry) => entry.invocations),
    [1],
  );
});

test("an `every` firing is never credited to a delivery (#975)", () => {
  // `every` is tick-driven, not host-driven. A regression that credited due `every` invocations to
  // whichever delivery happened to be in flight would pass every other test in this file.
  const handlerDeliveries = [];
  const result = execute(
    `every 1 [ print 1 ]\non_key "space" [ print 2 ]\nwait 3`,
    doc,
    {
      hostInput: { events: [{ tick: 1, kind: "key", key: "space" }] },
      handlerDeliveries,
    },
  );
  const everyFirings = firings(result).filter(
    (handler) => handler.kind === "every",
  );
  // The control: several `every` firings really did happen alongside the delivery.
  assert.ok(
    everyFirings.length >= 3,
    `expected >= 3, got ${everyFirings.length}`,
  );
  assert.deepEqual(
    handlerDeliveries.map((entry) => entry.invocations),
    [1],
  );
});

test("invocations equal the firing events attributable to the delivery (#954 + #975)", () => {
  // The two halves are two views of ONE fact, and this is the assertion that stops them drifting:
  // the inbound count is incremented at exactly the line the outbound event is emitted.
  //
  // "Attributable to a delivery" means host-DRIVEN firings: `every` is tick-driven, and a
  // `when "start"` fires at registration, so both are excluded. This program deliberately contains
  // neither, so the filter below cannot quietly stand in for a weaker rule.
  const handlerDeliveries = [];
  const result = execute(
    `on_key "a" [ print 1 ]\non_key "a" [ print 2 ]\non_click [ print 3 ]\nwait 2`,
    doc,
    {
      hostInput: {
        events: [
          { tick: 1, kind: "key", key: "a" },
          { tick: 2, kind: "click" },
        ],
      },
      handlerDeliveries,
    },
  );
  const hostDrivenFirings = firings(result).filter(
    (handler) => handler.kind === "on_key" || handler.kind === "on_click",
  );
  assert.equal(firings(result).length, hostDrivenFirings.length);
  const reported = handlerDeliveries.reduce(
    (total, entry) => total + entry.invocations,
    0,
  );
  assert.equal(reported, hostDrivenFirings.length);
  assert.equal(reported, 3);
});

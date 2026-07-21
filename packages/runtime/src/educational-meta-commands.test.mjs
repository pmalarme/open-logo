// Unit tests for issue #332 (A2): executing the Educational profile's four baseline
// meta-commands (`explain`/`why`/`hint`/`debug`, A1 #331's zero-arity `Call`/`ParenCall` nodes)
// and emitting exactly one `tutor-output` event per invocation, using A0 #324's event
// kind/payload contract (`@openlogo/core`'s `events.ts`). Covers: the payload shape per command,
// target-source-span presence/absence, `hint`'s progressive-stage escalation and per-target
// isolation, and the runtime-level `ol-too-many-inputs` rejection of nonzero-input parenthesized
// calls (the gap A1's reviewer flagged — the parser reuses the zero-arity `Call` shape with no
// static arity check for these four commands).

import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function tutorEvents(result) {
  return result.events.filter((event) => event.kind === "tutor-output");
}

// --- each of the four commands emits exactly one tutor-output event ---------------------------

for (const command of ["explain", "why", "hint", "debug"]) {
  test(`bare \`${command}\` as the only statement emits one tutor-output event with no target`, () => {
    const result = execute(command, doc);
    assert.deepEqual(result.diagnostics, []);
    const events = tutorEvents(result);
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.kind, "tutor-output");
    assert.equal(event.payload.command, command);
    assert.equal(Array.isArray(event.payload.segments), true);
    assert.equal(event.payload.segments.length > 0, true);
    for (const segment of event.payload.segments) {
      assert.equal(typeof segment, "string");
      assert.equal(segment.length > 0, true);
    }
  });
}

// --- explain/why/debug: target_source_span is present after a preceding statement, absent -----
// --- when the meta-command is the very first statement executed ------------------------------

for (const command of ["explain", "why", "debug"]) {
  test(`bare \`${command}\` as the first statement omits target_source_span`, () => {
    const result = execute(command, doc);
    const [event] = tutorEvents(result);
    assert.equal(event.payload.target_source_span, undefined);
    assert.equal(event.payload.diagnostic_code, undefined);
  });

  test(`bare \`${command}\` after a preceding statement reports that statement's own span as the target`, () => {
    const result = execute(`forward 10\n${command}`, doc);
    assert.deepEqual(result.diagnostics, []);
    const [event] = tutorEvents(result);
    assert.notEqual(event.payload.target_source_span, undefined);
    // The target is the immediately preceding statement (`forward 10`), not the meta-command
    // call's own span.
    assert.equal(event.payload.target_source_span.start[0], 1);
    assert.notDeepEqual(event.payload.target_source_span, event.source_span);
  });
}

// --- hint: target_source_span is ALWAYS present, falling back to the whole-program span -------

test("bare `hint` as the only statement falls back to the whole-program span as its target", () => {
  const result = execute("hint", doc);
  assert.deepEqual(result.diagnostics, []);
  const [event] = tutorEvents(result);
  assert.equal(event.payload.command, "hint");
  assert.notEqual(event.payload.target_source_span, undefined);
  assert.equal(event.payload.stage, "nudge");
});

test("hint after a preceding statement targets that statement, not the whole program", () => {
  const result = execute("forward 10\nhint", doc);
  const [event] = tutorEvents(result);
  assert.equal(event.payload.target_source_span.start[0], 1);
});

// --- regression: a meta-command as the FIRST statement inside a procedure body must fall back --
// --- to the whole-program span, not the enclosing `procedure-enter` start event ----------------

test("`hint` as the first statement in a called procedure falls back to the whole-program span, not the call site", () => {
  const source = "define ask\nhint\nend\nask";
  const result = execute(source, doc);
  assert.deepEqual(result.diagnostics, []);
  const [event] = tutorEvents(result);
  assert.equal(event.payload.command, "hint");
  // The whole-program span always starts at [1, 1] regardless of where `hint` itself sits in the
  // source; if this instead resolved the enclosing `procedure-enter` event (the `ask` call site
  // on line 4), the target would start at line 4, not the program's own start.
  const { ast: program } = parse(source, doc);
  assert.deepEqual(event.payload.target_source_span, program.source_span);
});

for (const command of ["explain", "why", "debug"]) {
  test(`\`${command}\` as the first statement in a called procedure omits target_source_span, not the call site`, () => {
    const result = execute(`define ask\n${command}\nend\nask`, doc);
    assert.deepEqual(result.diagnostics, []);
    const [event] = tutorEvents(result);
    assert.equal(event.payload.target_source_span, undefined);
  });
}

// --- bare `hint` (no real target) reports "your program", not a false "the most recent ---------
// --- instruction" claim, even though its payload target_source_span falls back to the program --

test("bare `hint` with no real target describes its scope as the whole program, not a false instruction claim", () => {
  const result = execute("hint", doc);
  const [event] = tutorEvents(result);
  assert.equal(
    event.payload.segments.some((segment) => segment.includes("your program")),
    true,
  );
  assert.equal(
    event.payload.segments.some((segment) =>
      segment.includes("the most recent instruction"),
    ),
    false,
  );
});

// --- hint progression: nudge -> concept -> partial -> last-resort -> last-resort (repeats) ----

test("repeated `hint` for the same target escalates one stage per call, capping at last-resort", () => {
  const result = execute("forward 10\nhint\nhint\nhint\nhint\nhint", doc);
  assert.deepEqual(result.diagnostics, []);
  const stages = tutorEvents(result).map((event) => event.payload.stage);
  assert.deepEqual(stages, [
    "nudge",
    "concept",
    "partial",
    "last-resort",
    "last-resort",
  ]);
});

test("`hint` progression is tracked independently per distinct target", () => {
  const result = execute("forward 10\nhint\nback 5\nhint\nhint", doc);
  assert.deepEqual(result.diagnostics, []);
  const stages = tutorEvents(result).map((event) => event.payload.stage);
  // First hint targets `forward 10` (nudge). Then `back 5` runs, and the next two hints target
  // *that* statement instead, starting its OWN progression fresh at nudge.
  assert.deepEqual(stages, ["nudge", "nudge", "concept"]);
});

// --- the tutor-output event's own source_span is always the meta-command call site -------------

test("the tutor-output event's source_span is the meta-command call site, not the target", () => {
  const result = execute("forward 10\nexplain", doc);
  const [event] = tutorEvents(result);
  assert.equal(event.source_span.start[0], 2);
});

// --- runtime rejects nonzero-input parenthesized meta-command calls (A1 reviewer's gap) -------

for (const command of ["explain", "why", "hint", "debug"]) {
  test(`(${command} 1) is rejected at runtime with ol-too-many-inputs`, () => {
    const result = execute(`(${command} 1)`, doc);
    assert.equal(result.diagnostics.length, 1);
    const [diagnostic] = result.diagnostics;
    assert.equal(diagnostic.code, "ol-too-many-inputs");
    assert.deepEqual(tutorEvents(result), []);
  });

  test(`(${command} 1 2) is rejected at runtime with ol-too-many-inputs`, () => {
    const result = execute(`(${command} 1 2)`, doc);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  });
}

// --- case-insensitivity: the four commands match regardless of source-text casing -------------

test("`Explain`/`WHY`/`Hint`/`DEBUG` are recognized case-insensitively", () => {
  const result = execute("Explain\nWHY\nHint\nDEBUG", doc);
  assert.deepEqual(result.diagnostics, []);
  const commands = tutorEvents(result).map((event) => event.payload.command);
  assert.deepEqual(commands, ["explain", "why", "hint", "debug"]);
});

// --- a user-defined procedure named `explain` shadows the meta-command (matching the existing --
// --- Turtle/Data shadowing convention) ---------------------------------------------------------

test("a user-defined procedure named `explain` shadows the baseline meta-command", () => {
  const result = execute("define explain\nprint 42\nend\nexplain", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(tutorEvents(result), []);
  const printed = result.events.filter((event) => event.kind === "print");
  assert.equal(printed.length, 1);
  assert.equal(printed[0].payload.values[0], 42);
});

// --- regression (rubber-duck review, PR #371): a shadowed meta-command NAME must still count --
// --- as a real preceding sibling for target resolution — it ran as an ordinary procedure call, --
// --- not as a meta-command, so a LATER unshadowed meta-command must not skip past it -----------

test("a shadowed `hint` procedure call counts as a real preceding sibling, not a skipped meta-command", () => {
  const source = "define hint\nprint 1\nend\nforward 10\nhint\nexplain";
  const result = execute(source, doc);
  assert.deepEqual(result.diagnostics, []);
  const [event] = tutorEvents(result);
  assert.equal(event.payload.command, "explain");
  // The immediately preceding sibling is line 5's shadowed `hint` procedure call, NOT line 4's
  // `forward 10` — without the shadowing fix, `findPrecedingSiblingStatement` would wrongly
  // treat line 5 as a meta-command to skip past, targeting `forward 10` instead.
  assert.equal(event.payload.target_source_span.start[0], 5);
  const printed = result.events.filter((e) => e.kind === "print");
  assert.equal(printed.length, 1);
});

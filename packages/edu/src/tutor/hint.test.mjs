import assert from "node:assert/strict";
import { test } from "node:test";
import * as Core from "@openlogo/core";
import * as OL from "@openlogo/edu";
import * as Parser from "@openlogo/parser";

/** Builds a minimal, valid `TutorContext` for `hint`, overridable per test. */
function makeHintContext(overrides = {}) {
  const { ast: program } = Parser.parse("forward 80", "main.logo");
  return {
    command: "hint",
    program,
    events: [],
    diagnostics: [],
    level: "2",
    ...overrides,
  };
}

test("hint() starts an untouched target at the nudge stage", () => {
  const context = makeHintContext();
  const output = OL.hint(context);

  assert.equal(output.command, "hint");
  assert.equal(output.stage, "nudge");
  assert.equal(output.segments.length, 1);
  assert.match(output.segments[0], /Look closely at/);
});

test("hint() escalates concept -> partial -> last-resort as priorHintStage advances", () => {
  const stageAfter = {
    nudge: "concept",
    concept: "partial",
    partial: "last-resort",
  };
  for (const [priorHintStage, expectedStage] of Object.entries(stageAfter)) {
    const output = OL.hint(makeHintContext({ priorHintStage }));
    assert.equal(output.stage, expectedStage);
  }
});

test("hint() clamps at last-resort for repeated requests past the final stage", () => {
  const output = OL.hint(makeHintContext({ priorHintStage: "last-resort" }));
  assert.equal(output.stage, "last-resort");
});

test("hint() is a pure function: identical context yields deep-equal output", () => {
  const context = makeHintContext({ priorHintStage: "concept" });
  const first = OL.hint(context);
  const second = OL.hint(context);
  assert.deepEqual(first, second);
});

test('hint() throws when the context\'s command is not "hint"', () => {
  const context = makeHintContext({ command: "explain" });
  assert.throws(
    () => OL.hint(context),
    /requires a TutorContext whose command is "hint"/,
  );
});

test("hint() uses the target's own span, falling back to the whole-program span", () => {
  const { ast: program } = Parser.parse("forward 80\nright 90", "main.logo");
  const withTarget = OL.hint({
    command: "hint",
    program,
    target: program.body[1],
    events: [],
    diagnostics: [],
    level: "1",
  });
  assert.deepEqual(withTarget.target_source_span, program.body[1].source_span);

  const withoutTarget = OL.hint({
    command: "hint",
    program,
    events: [],
    diagnostics: [],
    level: "1",
  });
  assert.deepEqual(withoutTarget.target_source_span, program.source_span);
});

test("hint() names the callee when commandMetadata is known, including procedures", () => {
  const primitiveOutput = OL.hint(
    makeHintContext({
      commandMetadata: { name: "forward", arity: 1, kind: "primitive" },
    }),
  );
  assert.match(primitiveOutput.segments[0], /`forward`/);

  const procedureOutput = OL.hint(
    makeHintContext({
      commandMetadata: { name: "square", arity: 0, kind: "procedure" },
    }),
  );
  assert.match(procedureOutput.segments[0], /your procedure `square`/);

  const noMetadataOutput = OL.hint(makeHintContext());
  assert.match(
    noMetadataOutput.segments[0],
    /the highlighted part of your program/,
  );
});

/** Every learner level `hint` must be able to produce a stage for. */
const ALL_LEVELS = ["1", "2", "3", "4", "5", "6", "7a", "7b", "7c", "8a", "8b"];

/** Every progressive hint stage, in escalation order. */
const ALL_STAGES = ["nudge", "concept", "partial", "last-resort"];

for (const level of ALL_LEVELS) {
  test(`hint() produces a stage-1 nudge for level ${level} without naming the concept`, () => {
    const output = OL.hint(makeHintContext({ level }));
    assert.equal(output.stage, "nudge");
    assert.doesNotMatch(output.segments[0], new RegExp(`level ${level}`));
  });
}

for (const level of ALL_LEVELS) {
  test(`hint() names level ${level}'s concept at the concept stage`, () => {
    const output = OL.hint(makeHintContext({ level, priorHintStage: "nudge" }));
    assert.equal(output.stage, "concept");
    assert.match(output.segments[0], new RegExp(`level ${level}`));
  });
}

for (const level of ALL_LEVELS) {
  for (const stage of ["nudge", "concept", "partial", "last-resort"]) {
    test(`hint() never emits a complete, ready-to-run program at level ${level}, stage after ${stage}`, () => {
      const output = OL.hint(makeHintContext({ level, priorHintStage: stage }));
      const combined = output.segments.join(" ");
      const { diagnostics } = Parser.parse(combined, "hint-output.logo");
      // A byte-identical, ready-to-run OpenLogo solution would parse clean (no diagnostics).
      // Every hint segment is learner-facing prose (and, from "partial" onward, a skeleton built
      // from non-OpenLogo `‹placeholder›` markers), so it must never parse clean.
      assert.ok(
        diagnostics.length > 0,
        `expected hint output at level ${level} to be unparseable as OpenLogo, got: ${combined}`,
      );
    });
  }
}

for (const level of ALL_LEVELS) {
  // priorHintStage: "concept" -> emitted stage "partial"; priorHintStage: "partial" -> emitted
  // stage "last-resort". These are the two stages whose segment includes a skeleton fragment.
  for (const [priorHintStage, expectedStage] of [
    ["concept", "partial"],
    ["partial", "last-resort"],
  ]) {
    test(`hint() 's skeleton fragment alone (not just surrounding prose) is unparseable at level ${level}, stage ${expectedStage}`, () => {
      const output = OL.hint(makeHintContext({ level, priorHintStage }));
      assert.equal(output.stage, expectedStage);
      const segment = output.segments[0];
      // Extract the backtick-quoted skeleton fragment(s) in isolation, stripping the
      // surrounding learner-facing prose entirely, so this assertion cannot pass merely
      // because the prose around a skeleton fails to parse as OpenLogo.
      const skeletonFragments = [...segment.matchAll(/`([^`]+)`/g)].map(
        (match) => match[1],
      );
      assert.ok(
        skeletonFragments.length > 0,
        `expected at least one backtick-quoted skeleton fragment in: ${segment}`,
      );
      for (const fragment of skeletonFragments) {
        assert.ok(
          fragment.includes("‹") && fragment.includes("›"),
          `expected skeleton fragment to use non-OpenLogo ‹placeholder› markers, got: ${fragment}`,
        );
        const { diagnostics } = Parser.parse(fragment, "hint-skeleton.logo");
        assert.ok(
          diagnostics.length > 0,
          `expected skeleton fragment to be unparseable as OpenLogo on its own, got: ${fragment}`,
        );
      }
    });
  }
}

test("hint() progression is deterministic across the full nudge -> last-resort -> last-resort chain", () => {
  const context = makeHintContext({ level: "6" });
  let priorHintStage;
  const seenStages = [];
  for (let i = 0; i < ALL_STAGES.length + 2; i += 1) {
    const output = OL.hint({ ...context, priorHintStage });
    seenStages.push(output.stage);
    priorHintStage = output.stage;
  }
  assert.deepEqual(seenStages, [
    "nudge",
    "concept",
    "partial",
    "last-resort",
    "last-resort",
    "last-resort",
  ]);
});

test("hint()'s tutor-output payload matches the shared TutorOutput/HintTutorOutputPayload shape", () => {
  const output = OL.hint(makeHintContext());
  const event = {
    seq: 0,
    kind: "tutor-output",
    source_span: Core.makeSpan("main.logo", [1, 1], [1, 10]),
    payload: output,
  };
  assert.ok(Core.isEventKind(event.kind));
  assert.equal(event.payload.command, "hint");
  assert.ok(ALL_STAGES.includes(event.payload.stage));
  assert.ok(event.payload.target_source_span !== undefined);
});

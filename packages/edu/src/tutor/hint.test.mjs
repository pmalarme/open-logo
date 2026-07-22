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

// Issue #399: the partial/last-resort skeletons must be *canonically shaped* — not merely
// unparseable-with-placeholders. Each level's skeleton, with its ‹placeholder› markers replaced
// by concrete tokens, must compact (whitespace-insensitively) to a known-canonical OpenLogo
// program that itself parses clean. This catches a non-canonical skeleton — such as the old L5
// `define … local :‹parameter› …` (parameters belong on the `define` header; `local` takes a
// BARE name) or the old L7c `struct … { ‹field›: ‹value› }` (records use `[ ‹field› ]` brackets,
// not dict braces) — that the placeholder-unparseability tests above cannot distinguish from a
// canonical one, because BOTH shapes fail to parse while the ‹markers› are present.
const PLACEHOLDER_FILL = {
  distance: "1",
  angle: "1",
  count: "1",
  sides: "1",
  length: "1",
  value: "1",
  "smaller-input": "1",
  expression: "1",
  condition: "1 > 0",
  name: "n",
  parameter: "n",
  item: "each",
  list: "items",
  key: "color",
  field: "x",
  TypeName: "Point",
  body: "forward 1",
};

/** The single backtick-quoted `‹placeholder›` skeleton fragment from a level's partial hint. */
function skeletonFragment(level) {
  const output = OL.hint(makeHintContext({ level, priorHintStage: "concept" }));
  assert.equal(output.stage, "partial");
  const fragment = [...output.segments[0].matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .find((candidate) => candidate.includes("‹"));
  assert.ok(
    fragment,
    `expected a ‹placeholder› skeleton fragment for level ${level}`,
  );
  return fragment;
}

const fillPlaceholders = (skeleton) =>
  skeleton.replace(/‹([^›]+)›/g, (_, token) => {
    assert.ok(token in PLACEHOLDER_FILL, `no canonical fill for ‹${token}›`);
    return PLACEHOLDER_FILL[token];
  });

// Each level's partial/last-resort skeleton must be *canonically shaped*: with its ‹placeholder›
// markers replaced by concrete tokens, the ACTUAL skeleton string must itself parse as a clean
// OpenLogo program (zero diagnostics). We fill and parse the real skeleton — not a separately
// authored "canonical" program compared by collapsed whitespace — so the test proves the exact
// bytes a learner sees are valid OpenLogo. OpenLogo is line-oriented (spec/execution-model.md:
// 60-69, 197-200): a `define … end` body and successive statements need real newlines, so the
// skeletons carry `\n`; a single-line `define ‹name› :‹parameter› ‹body› end` (issue #418) or the
// old non-canonical `define … local :‹parameter›` / `struct … { ‹field›: ‹value› }` shapes would
// fail to parse once filled, which this test catches.
for (const level of ALL_LEVELS) {
  test(`hint()'s level ${level} skeleton is canonically shaped: the filled skeleton parses clean`, () => {
    const filled = fillPlaceholders(skeletonFragment(level));
    const { diagnostics } = Parser.parse(filled, `filled-level-${level}.logo`);
    assert.deepEqual(
      diagnostics,
      [],
      `level ${level} filled skeleton must parse with zero diagnostics: ${JSON.stringify(filled)}`,
    );
  });
}

test("hint()'s level 5 skeleton puts the parameter on the define header (‹name› :‹parameter›), never via `local :`", () => {
  const skeleton = skeletonFragment("5");
  assert.match(skeleton, /^define ‹name› :‹parameter›/);
  // `local` takes a BARE name (`local total`, per spec/commands.md), never `local :param`; a
  // procedure's parameters are declared on the header. The old skeleton
  // `define ‹name› local :‹parameter› …` violated both rules at once.
  assert.doesNotMatch(skeleton, /local\s*:/);
});

test("hint()'s level 7c record skeleton declares fields with brackets (struct … [ … ]), not dict braces", () => {
  const skeleton = skeletonFragment("7c");
  assert.match(skeleton, /^struct ‹TypeName› \[ ‹field› \]$/);
  assert.doesNotMatch(skeleton, /[{}]/);
});

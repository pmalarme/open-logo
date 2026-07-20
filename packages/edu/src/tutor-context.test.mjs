import assert from "node:assert/strict";
import { test } from "node:test";
import * as Core from "@openlogo/core";
import * as OL from "@openlogo/edu";
import * as Parser from "@openlogo/parser";

test("@openlogo/edu exposes EDU_PACKAGE", () => {
  assert.equal(OL.EDU_PACKAGE, "@openlogo/edu");
});

test("TutorContext is a data-only shape that carries a parsed program, trace events, diagnostics, level, and command metadata", () => {
  const { ast: program } = Parser.parse("forward 80", "main.logo");

  /** @type {OL.TutorContext} */
  const context = {
    command: "explain",
    program,
    target: program.body[0],
    events: [],
    diagnostics: [],
    level: "2",
    commandMetadata: { name: "forward", arity: 1, kind: "primitive" },
  };

  assert.equal(context.command, "explain");
  assert.equal(context.level, "2");
  assert.equal(context.commandMetadata.name, "forward");
  assert.equal(context.priorHintStage, undefined);
});

test("TutorContext's priorHintStage carries the previously shown hint stage for progression", () => {
  const { ast: program } = Parser.parse(
    "repeat 4 [ forward 80 right 90 ]",
    "main.logo",
  );

  /** @type {OL.TutorContext} */
  const context = {
    command: "hint",
    program,
    events: [],
    diagnostics: [],
    level: "2",
    priorHintStage: "nudge",
  };

  assert.equal(context.priorHintStage, "nudge");
});

test("TutorOutput matches the tutor-output event payload shape exactly", () => {
  /** @type {OL.TutorOutput} */
  const output = {
    command: "hint",
    segments: ["Look at the turn after each side."],
    stage: "nudge",
    target_source_span: Core.makeSpan("main.logo", [1, 1], [1, 10]),
  };

  const event = {
    seq: 1,
    kind: "tutor-output",
    source_span: Core.makeSpan("main.logo", [1, 1], [1, 10]),
    payload: output,
  };

  assert.ok(Core.isEventKind(event.kind));
  assert.equal(event.payload.command, "hint");
  assert.equal(event.payload.stage, "nudge");
});

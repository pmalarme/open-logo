// Unit tests for the injectable `tutor-output` template seam (M3-orchestrator ruling on issue
// #332): `defaultTutorTemplate`'s DIAGNOSTIC arm for `why`/`debug` (only reachable in a live
// `execute()` run via cross-run session persistence, a host/studio concern out of this issue's
// scope — see `educational-meta-commands.test.mjs`'s doc comment), `nextHintStage`'s escalation
// table, and `ExecuteOptions.tutorTemplates`/`learnerLevel` actually threading through to a
// caller-supplied template.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "@openlogo/parser";
import {
  defaultTutorTemplate,
  execute,
  nextHintStage,
} from "@openlogo/runtime";

const doc = "acceptance.logo";

function makeContext(overrides) {
  const { ast: program } = parse("forward 10", doc);
  return {
    command: "why",
    program,
    target: undefined,
    events: [],
    diagnostics: [],
    level: "1",
    commandMetadata: undefined,
    priorHintStage: undefined,
    ...overrides,
  };
}

function makeDiagnostic(overrides) {
  return {
    code: "ol-undefined-var",
    source_span: {
      document: doc,
      start: [1, 1],
      end: [1, 5],
    },
    params: {},
    message: "synthetic diagnostic for a direct defaultTutorTemplate unit test",
    stage: "semantic",
    severity: "error",
    ...overrides,
  };
}

// --- defaultTutorTemplate's diagnostic arm (why/debug), only reachable via cross-run session ---
// --- persistence (a host re-invoking why/debug with a halting diagnostic supplied) -------------

test("defaultTutorTemplate emits why's DIAGNOSTIC arm when a diagnostic is in scope", () => {
  const diagnostic = makeDiagnostic();
  const payload = defaultTutorTemplate(
    makeContext({ command: "why", diagnostics: [diagnostic] }),
  );
  assert.equal(payload.command, "why");
  assert.equal(payload.diagnostic_code, "ol-undefined-var");
  assert.deepEqual(payload.target_source_span, diagnostic.source_span);
  assert.equal(payload.segments.length > 0, true);
  assert.equal(
    payload.segments.some((segment) => segment.includes("ol-undefined-var")),
    true,
  );
});

test("defaultTutorTemplate emits debug's DIAGNOSTIC arm when a diagnostic is in scope", () => {
  const diagnostic = makeDiagnostic({ code: "ol-too-many-inputs" });
  const payload = defaultTutorTemplate(
    makeContext({ command: "debug", diagnostics: [diagnostic] }),
  );
  assert.equal(payload.command, "debug");
  assert.equal(payload.diagnostic_code, "ol-too-many-inputs");
  assert.deepEqual(payload.target_source_span, diagnostic.source_span);
  assert.equal(
    payload.segments.some((segment) => segment.includes("ol-too-many-inputs")),
    true,
  );
});

test("defaultTutorTemplate picks the LAST diagnostic when several are in scope", () => {
  const first = makeDiagnostic({ code: "ol-undefined-var" });
  const last = makeDiagnostic({ code: "ol-too-many-inputs" });
  const payload = defaultTutorTemplate(
    makeContext({ command: "why", diagnostics: [first, last] }),
  );
  assert.equal(payload.diagnostic_code, "ol-too-many-inputs");
});

test("defaultTutorTemplate falls back to why's PROGRAM arm when diagnostics is empty", () => {
  const payload = defaultTutorTemplate(
    makeContext({ command: "why", diagnostics: [] }),
  );
  assert.equal(payload.command, "why");
  assert.equal(payload.diagnostic_code, undefined);
});

// --- nextHintStage: the pure escalation table, exercised directly ------------------------------

test("nextHintStage escalates nudge -> concept -> partial -> last-resort, then repeats", () => {
  assert.equal(nextHintStage(undefined), "nudge");
  assert.equal(nextHintStage("nudge"), "concept");
  assert.equal(nextHintStage("concept"), "partial");
  assert.equal(nextHintStage("partial"), "last-resort");
  assert.equal(nextHintStage("last-resort"), "last-resort");
});

// --- ExecuteOptions.tutorTemplates: a caller-supplied template overrides the default -----------

test("ExecuteOptions.tutorTemplates overrides the default template", () => {
  const calls = [];
  const result = execute("forward 10\nexplain", doc, {
    tutorTemplates: (context) => {
      calls.push(context);
      return {
        command: "explain",
        segments: ["custom curriculum-quality prose from a host template"],
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "explain");
  assert.equal(calls[0].level, "1");
  const [event] = result.events.filter((e) => e.kind === "tutor-output");
  assert.deepEqual(event.payload.segments, [
    "custom curriculum-quality prose from a host template",
  ]);
});

// --- ExecuteOptions.learnerLevel: threaded onto every TutorContext this run builds --------------

test("ExecuteOptions.learnerLevel is threaded onto TutorContext.level", () => {
  let observedLevel;
  execute("explain", doc, {
    tutorTemplates: (context) => {
      observedLevel = context.level;
      return { command: "explain", segments: ["ok"] };
    },
    learnerLevel: "5",
  });
  assert.equal(observedLevel, "5");
});

test("learnerLevel defaults to '1' when ExecuteOptions omits it", () => {
  let observedLevel;
  execute("explain", doc, {
    tutorTemplates: (context) => {
      observedLevel = context.level;
      return { command: "explain", segments: ["ok"] };
    },
  });
  assert.equal(observedLevel, "1");
});

// --- commandMetadata: present only when the target is a call, "procedure" vs "primitive" -------

test("commandMetadata identifies a primitive-call target", () => {
  let metadata;
  execute("forward 10\nexplain", doc, {
    tutorTemplates: (context) => {
      metadata = context.commandMetadata;
      return { command: "explain", segments: ["ok"] };
    },
  });
  assert.deepEqual(metadata, { name: "forward", arity: 1, kind: "primitive" });
});

test("commandMetadata identifies a user-defined-procedure-call target", () => {
  let metadata;
  execute("define greet\nprint 1\nend\ngreet\nexplain", doc, {
    tutorTemplates: (context) => {
      metadata = context.commandMetadata;
      return { command: "explain", segments: ["ok"] };
    },
  });
  assert.deepEqual(metadata, { name: "greet", arity: 0, kind: "procedure" });
});

test("commandMetadata is absent when the target is not a call (e.g. a control form)", () => {
  let metadata = "unset";
  execute("if true [ print 1 ]\nexplain", doc, {
    tutorTemplates: (context) => {
      metadata = context.commandMetadata;
      return { command: "explain", segments: ["ok"] };
    },
  });
  assert.equal(metadata, undefined);
});

test("commandMetadata is absent when there is no target at all", () => {
  let metadata = "unset";
  execute("explain", doc, {
    tutorTemplates: (context) => {
      metadata = context.commandMetadata;
      return { command: "explain", segments: ["ok"] };
    },
  });
  assert.equal(metadata, undefined);
});

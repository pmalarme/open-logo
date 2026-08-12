// Unit tests for `input <prompt>` (issue #681, slice I2 — `spec/interaction-events.md:126-137`,
// `spec/conformance.md:167-169`). `input` is the Interaction & Events profile's Kind-R reporter:
// it displays a prompt, waits for the learner to enter one value, and reports a **number** when the
// submitted text parses as an OpenLogo number literal or a **word** preserving the entered text
// otherwise.
//
// Per the maintainer's #657 ruling `input` is tested by **mocking the answer** — the scripted
// answers ride the existing `executeOptions.hostInput` seam as `responses`, a FIFO queue consumed
// in order by each `input` call — and there is **no new event kind**: a read emits the ordinary
// catch-all `primitive` event, so `spec/execution-model.md`'s trace/event registry is unchanged.
//
// The other half of this slice — the normative **blocking** property (`:108-111`) — is
// structurally unprovable from a fixture (a scripted answer returns immediately, so there is no
// "waiting" interval a headless fold can observe) and lives in
// `interaction-input-blocking.test.mjs`.
//
// Node-version trap: on Node 24+ `--experimental-test-coverage` silently excludes `*.test.mjs`, so
// a local coverage green can be a false positive CI (Node 22) then fails. These tests exercise
// every branch of `evaluateInput`, `interpretSubmittedText`, `takeInputResponse`, and
// `isLearnerText`.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  execute,
  interpretSubmittedText,
  isLearnerText,
  takeInputResponse,
} from "@openlogo/runtime";

const doc = "input.logo";

/** Run `source` with `responses` scripted as the answers its `input` reads consume, in order. */
function runWithAnswers(source, responses) {
  return execute(source, doc, { hostInput: { responses } });
}

/** Every non-`instruction` event, so an assertion reads as the program's effects alone. */
function effectEvents(result) {
  return result.events.filter((event) => event.kind !== "instruction");
}

/** The values a program printed, in order — the observable result of each read. */
function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .flatMap((event) => event.payload.values);
}

// --- `spec/interaction-events.md:136-137`: number literal → number, anything else → word ---------

test("a submitted answer that parses as a number literal reports a NUMBER", () => {
  // `spec/interaction-events.md:136-137`: "If the submitted text parses as an OpenLogo number
  // literal, the reporter returns a number." Proven by arithmetic rather than by print text: `41`
  // would print as `41` whether it were the number 41 or the word "41", but only the number can be
  // added to. A regression that always reported a word raises `ol-type` here instead.
  const result = runWithAnswers(':n = input "how old?"\nprint :n + 1', ["41"]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [42]);
});

test("a submitted answer that is not a number literal reports a WORD preserving the entered text", () => {
  // The other half of `:136-137`: "Otherwise it returns a word preserving the entered text."
  const result = runWithAnswers(
    ':name = input "what is your name?"\nprint word "hello " :name',
    ["tom"],
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["hello tom"]);
});

test("the word branch preserves the entered text EXACTLY — no trimming, casing, or escaping", () => {
  // "preserving the entered text" is literal: whatever the learner typed is what the word holds.
  const typed = '  Tom  O"Brien  ';
  const result = runWithAnswers(':name = input "who?"\nprint :name', [typed]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [typed]);
});

test("interpretSubmittedText classifies by the GRAMMAR, so every numeral shape the reader accepts is a number", () => {
  // The number/word decision is delegated to `parse()` rather than a hand-written numeric pattern,
  // so it cannot drift from `spec/grammar.md`'s numeral: decimals, exponents, redundant leading
  // zeros, and the negative literal (`spec/grammar.md:17` — "A leading `-` directly before a
  // numeral, when there is no left operand, is part of a negative numeric literal") all qualify.
  for (const [text, expected] of [
    ["42", 42],
    ["0", 0],
    ["0042", 42],
    ["3.5", 3.5],
    ["1e3", 1000],
    ["2E-2", 0.02],
    ["-5", -5],
    ["  42  ", 42],
  ]) {
    assert.equal(
      interpretSubmittedText(text),
      expected,
      `${JSON.stringify(text)} parses as an OpenLogo number literal`,
    );
  }
});

test("interpretSubmittedText reports a word for anything that is not exactly one clean number literal", () => {
  // Each of these fails a different clause of the rule, and each must fall through to the word
  // branch verbatim:
  //   - "tom"/""/"  "  — not a numeral at all (or nothing at all)
  //   - "true"         — a boolean literal, not a number literal
  //   - "1 + 1"        — an arithmetic call whose *value* is a number but whose text is not a literal
  //   - "42 tom"       — more than one statement
  //   - ".5"/"1e"      — parses only alongside a diagnostic, so it does not parse *cleanly*
  //   - "1,5"          — a locale decimal comma; `spec/grammar.md:17` fixes `.` as the decimal point
  //   - "42\n42"       — TWO clean number literals; a read reports one value, not a program
  for (const text of [
    "tom",
    "",
    "  ",
    "true",
    "false",
    "1 + 1",
    "42 tom",
    ".5",
    "1e",
    "1,5",
    "forty two",
    "42\n42",
  ]) {
    assert.equal(
      interpretSubmittedText(text),
      text,
      `${JSON.stringify(text)} is not a clean single number literal, so it reports the word verbatim`,
    );
  }
});

// --- The after-effects a read produces: the `primitive` event, and downstream events -------------

test("a completed read emits exactly one catch-all `primitive` event naming input — and no new kind", () => {
  // `spec/interaction-events.md:105-106`: "primitives without a more specific kind emit
  // `primitive`". #657 ruled out a new event kind, so this is the ONLY event a read itself adds.
  const result = runWithAnswers('print input "q"', ["tom"]);
  assert.deepEqual(result.diagnostics, []);
  const [primitiveEvent, printEvent] = effectEvents(result);
  assert.equal(primitiveEvent.kind, "primitive");
  assert.deepEqual(primitiveEvent.payload, { name: "input" });
  assert.equal(printEvent.kind, "print");
});

test("the input primitive event leaks neither the prompt nor the submitted text", () => {
  // The stream is headless (`spec/execution-model.md`'s trace registry). The payload's only key is
  // `name`; a regression that smuggled the prompt or the learner's answer in would add a second.
  const result = runWithAnswers('print input "what is your secret?"', [
    "hunter2",
  ]);
  const [primitiveEvent] = effectEvents(result);
  assert.deepEqual(Object.keys(primitiveEvent.payload), ["name"]);
  assert.equal(JSON.stringify(primitiveEvent).includes("hunter2"), false);
  assert.equal(JSON.stringify(primitiveEvent).includes("secret"), false);
});

test("the primitive event carries no turtle_id — a read concerns no turtle", () => {
  // The envelope's optional `turtle-id` addresses the turtle an event concerns
  // (`spec/execution-model.md`'s common event envelope). `input` concerns none, so recording one
  // would make a spec-violating envelope binding on every implementation that replays this stream.
  const result = runWithAnswers('print input "q"', ["tom"]);
  const [primitiveEvent] = effectEvents(result);
  assert.equal("turtle_id" in primitiveEvent, false);
});

test("the primitive event is emitted AFTER the read, and before the next statement runs", () => {
  const result = runWithAnswers(
    'right 90\n:answer = input "q"\nprint :answer',
    ["tom"],
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    [
      "instruction", // right 90
      "turn",
      "instruction", // :answer = input "q"
      "primitive", // ... the read, completed
      "instruction", // print :answer
      "print",
    ],
  );
});

// --- The FIFO queue: consumed in order, once each, run-wide ------------------------------------

test("responses is a FIFO consumed in order by each input call", () => {
  const result = runWithAnswers(
    'print input "a"\nprint input "b"\nprint input "c"',
    ["1", "two", "3"],
  );
  assert.deepEqual(result.diagnostics, []);
  // Order matters and the number/word rule is applied per answer: 1 and 3 are numbers, "two" a word.
  assert.deepEqual(printedValues(result), [1, "two", 3]);
});

test("the FIFO cursor is shared run-wide — reads inside a procedure and a loop draw from the same queue", () => {
  // The cursor lives on the environment, so a read made deep inside a call frame or a loop body
  // continues the same queue rather than restarting it (which would hand out an answer twice).
  const result = runWithAnswers(
    ["define ask_one", '  print input "q"', "end", "repeat 3 [ ask_one ]"].join(
      "\n",
    ),
    ["first", "second", "third"],
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["first", "second", "third"]);
});

test("the FIFO cursor is shared with reads inside an event handler block", () => {
  // A `when "start"` handler fires immediately on registration, so its read takes entry 0 and the
  // later top-level read takes entry 1 — one queue, program order.
  const result = runWithAnswers(
    ['when "start" [ print input "q" ]', 'print input "q"'].join("\n"),
    ["from-handler", "from-top-level"],
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["from-handler", "from-top-level"]);
});

test("takeInputResponse advances one entry per call and reports exhaustion with undefined", () => {
  const consumed = { count: 0 };
  assert.equal(takeInputResponse(["a", "b"], consumed), "a");
  assert.equal(consumed.count, 1);
  assert.equal(takeInputResponse(["a", "b"], consumed), "b");
  assert.equal(consumed.count, 2);
  assert.equal(takeInputResponse(["a", "b"], consumed), undefined);
  // An exhausted queue must not keep advancing the cursor past its length.
  assert.equal(consumed.count, 2);
  assert.equal(takeInputResponse([], { count: 0 }), undefined);
});

// --- The unanswered read: the spec's other ending, never an invented answer ---------------------

test("a read with no scripted answer cancels the run (ol-limit) rather than inventing one", () => {
  // `spec/interaction-events.md:110-111` gives a blocking read exactly two endings: it "finishes or
  // the program is cancelled". A headless run with no answer cannot reach the first, so it takes the
  // second — deliberately, because reporting a made-up empty word would let the program run on as
  // if the learner had answered.
  const result = execute('print input "q"', doc);
  assert.equal(result.diagnostics.length, 1);
  const [finding] = result.diagnostics;
  assert.equal(finding.code, "ol-limit");
  assert.equal(finding.stage, "runtime");
  assert.deepEqual(finding.params, { limit: "cancelled" });
  assert.ok(
    finding.message.includes("input"),
    "the message names the instruction that is waiting",
  );
});

test("an unanswered read emits no primitive event and stops the program there", () => {
  const result = runWithAnswers(
    'print input "a"\nprint input "b"\nprint "never"',
    ["only-one"],
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  // The first read completed (one primitive + its print); the second emitted nothing and the third
  // statement never ran.
  assert.deepEqual(
    effectEvents(result).map((event) => [event.kind, event.payload]),
    [
      ["primitive", { name: "input" }],
      ["print", { values: ["only-one"] }],
    ],
  );
});

test("an empty scripted answer is a real answer — the empty word — not an exhausted queue", () => {
  // `[""]` means the learner submitted nothing but DID answer, which is the word "". Only a queue
  // with no entry left is the cancelled case, so these two must never be conflated.
  const result = runWithAnswers(':answer = input "q"\nprint :answer is empty', [
    "",
  ]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

// --- `spec/interaction-events.md:131`: the prompt must be displayable as learner text ------------

test("a prompt that cannot be displayed as learner text raises ol-type", () => {
  // `spec/interaction-events.md:131`: "Errors: `ol-type` if the prompt cannot be displayed as
  // learner text". A list/dict/record renders as a container view and a turtle as the opaque tag
  // `turtle #<id>` — debugging renderings of a structure, not a question authored for a learner.
  for (const [source, actual] of [
    ["print input [1 2]", "list"],
    ["print input {a: 1}", "dict"],
    ["print input new_turtle", "turtle"],
  ]) {
    const result = runWithAnswers(source, ["tom"]);
    assert.equal(result.diagnostics.length, 1, source);
    const [finding] = result.diagnostics;
    assert.equal(finding.code, "ol-type");
    assert.equal(finding.stage, "runtime");
    assert.deepEqual(finding.params, {
      operation: "input",
      expected: "text",
      actual,
    });
  }
});

test("a rejected prompt consumes no answer and emits no primitive event", () => {
  // The prompt is checked BEFORE the read, so a bad prompt must not silently eat the queue's head —
  // otherwise a later read in a longer program would be answered off-by-one.
  const result = runWithAnswers("print input [1 2]", ["tom"]);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(effectEvents(result), []);
});

test("word, number, and boolean prompts are all displayable learner text", () => {
  // "normally a word" (`:129`) is a description, not a restriction: every scalar renders as exactly
  // the characters shown, so each is a legitimate prompt.
  for (const prompt of ['"how old?"', "42", "true"]) {
    const result = runWithAnswers(`print input ${prompt}`, ["tom"]);
    assert.deepEqual(result.diagnostics, [], `prompt ${prompt}`);
    assert.deepEqual(printedValues(result), ["tom"]);
  }
});

test("isLearnerText accepts exactly the scalars and rejects every structured or opaque value", () => {
  for (const value of ["tom", "", 42, 0, true, false]) {
    assert.equal(isLearnerText(value), true, `${JSON.stringify(value)}`);
  }
  for (const value of [[], [1, 2], new Map()]) {
    assert.equal(isLearnerText(value), false, `${JSON.stringify(value)}`);
  }
});

// --- Arity, guarded at runtime because execute() never runs the static checker -------------------

test("input given no input raises ol-not-enough-inputs at runtime", () => {
  // `execute()` runs `parse()` only, never `check()`, so the reporter guards its own arity exactly
  // as every other reporter does. `(input)` is the parenthesized form a learner can under-supply.
  const result = runWithAnswers("print (input)", ["tom"]);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.equal(result.diagnostics[0].params.callable, "input");
});

test("input given two inputs raises ol-too-many-inputs at runtime", () => {
  const result = runWithAnswers('print (input "a" "b")', ["tom"]);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.equal(result.diagnostics[0].params.callable, "input");
});

test("a failing prompt expression propagates its own diagnostic, not input's", () => {
  const result = runWithAnswers("print input :missing", ["tom"]);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- A user procedure does NOT shadow the primitive, exactly as for every other primitive --------

test("the primitive wins over a same-named user procedure, as it does for every other primitive", () => {
  // `evaluateCall` resolves primitives before `environment.procedures`, so `define input` does not
  // take over the name at runtime — identical to `define random`/`define who`, and deliberately so:
  // a learner is told about the collision by the checker's `ol-reserved-word`
  // (`spec/tooling.md:184`, locked in `packages/parser/src/interaction-tooling.test.mjs`), not by a
  // program that silently changes meaning. Locking it here keeps `input` from drifting into a
  // one-off precedence rule of its own.
  const result = runWithAnswers(
    ["define input :prompt", "  return 7", "end", 'print input "q"'].join("\n"),
    ["tom"],
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["tom"]);
  // It really was the primitive: the read happened, so it emitted its `primitive` event and took
  // the queue's head.
  assert.deepEqual(
    effectEvents(result).map((event) => event.kind),
    ["primitive", "print"],
  );
});

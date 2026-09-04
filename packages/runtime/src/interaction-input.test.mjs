// Unit tests for `input <prompt>` (issue #681, slice I2 — `spec/interaction-events.md:178-189`,
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
// every branch of `evaluateInput`, `interpretSubmittedText`, and `takeInputResponse`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { check, parse } from "@openlogo/parser";
import {
  execute,
  interpretSubmittedText,
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

// --- `spec/interaction-events.md:188-189`: number literal → number, anything else → word ---------

test("a submitted answer that parses as a number literal reports a NUMBER", () => {
  // `spec/interaction-events.md:188-189`: "If the submitted text parses as an OpenLogo number
  // literal, the reporter returns a number."
  //
  // Discriminated by TYPE, not by arithmetic. `:answer + 1` would prove nothing here: OpenLogo's `+`
  // coerces a numeric word (`"42" + 1` reports 43 with no diagnostic — only a non-numeric word like
  // `"tom"` raises `ol-type`), so an implementation that never reported a number at all would still
  // print 43 and pass. `assert.deepEqual` over the printed payload distinguishes the number `42`
  // from the word `"42"`, and `is a "number"` (`spec/grammar.md:236` — `is a` accepts any value)
  // states the same thing in the language itself.
  const result = runWithAnswers(
    ':answer = input "how old?"\nprint :answer\nprint :answer is a "number"',
    ["42"],
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [42, true]);
});

test("arithmetic would NOT discriminate the two branches — the regression guard for this file's own proof", () => {
  // Locks the coercion fact the test above depends on, so a future edit cannot quietly "simplify"
  // the number test back to `print :answer + 1` and reintroduce a false-green proof: with the WORD
  // "42" reported, arithmetic still succeeds and still prints 43. Only the type question separates
  // them.
  const asWord = runWithAnswers(
    ':answer = "42"\nprint :answer + 1\nprint :answer is a "number"',
    [],
  );
  assert.deepEqual(asWord.diagnostics, []);
  assert.deepEqual(printedValues(asWord), [43, false]);
});

test("a submitted answer that is not a number literal reports a WORD preserving the entered text", () => {
  // The other half of `:188-189`: "Otherwise it returns a word preserving the entered text." Asks
  // the SAME type question as the number test above, and gets the opposite answer — which is what
  // makes the two a discriminating pair rather than two runs of one assertion.
  const result = runWithAnswers(
    ':name = input "what is your name?"\nprint word "hello " :name\nprint :name is a "number"',
    ["tom"],
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["hello tom", false]);
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
  // `spec/interaction-events.md:157-158`: "primitives without a more specific kind emit
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
  // `spec/interaction-events.md:162-163` gives a blocking read exactly two endings: it "finishes or
  // the program is cancelled". A headless run with no answer cannot reach the first, so it takes the
  // second — deliberately, because reporting a made-up empty word would let the program run on as
  // if the learner had answered.
  //
  // It reaches that ending through the SHARED cancellation diagnostic. What the spec fixes is the
  // machine-readable half: identity is `code` plus `params` and prose is presentation
  // (`spec/error-model.md:256-261`), so `ol-limit` / `{ limit: "cancelled" }` MUST be the same here
  // as for an externally cancelled run — which is asserted directly against that run below, rather
  // than inferred. The message equality is a STRONGER, NON-NORMATIVE regression guard:
  // `spec/error-model.md:263-266` lets a localized build reword this message, and equal prose does
  // not by itself prove a single builder — two builders could emit the same words. It is asserted
  // because diverging wording is the cheapest early signal that a lookalike builder appeared. The
  // span is what localises the diagnostic to the waiting read.
  const result = execute('print input "q"', doc);
  const cancelled = execute("forward 1", doc, { signal: { aborted: true } });
  assert.equal(result.diagnostics.length, 1);
  const [finding] = result.diagnostics;
  const [externallyCancelled] = cancelled.diagnostics;
  assert.equal(finding.code, "ol-limit");
  assert.equal(finding.stage, "runtime");
  assert.deepEqual(finding.params, { limit: "cancelled" });
  // The identity equality the spec actually fixes, compared against the external path itself.
  assert.equal(finding.code, externallyCancelled.code);
  assert.deepEqual(finding.params, externallyCancelled.params);
  assert.equal(finding.stage, externallyCancelled.stage);
  // Stronger than the spec requires, and deliberately so — see the note above.
  assert.equal(finding.message, externallyCancelled.message);
  // The span covers the `input` call itself, so the learner is pointed at the waiting instruction.
  assert.deepEqual(finding.source_span.start, [1, 7]);
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

// --- `spec/interaction-events.md:181`/`:183`: the prompt MUST be a word ---------------------------

test("a prompt that is not a word raises ol-type", () => {
  // `spec/interaction-events.md:181`/`:183`: "**Args:** one prompt, which MUST be a `word`" /
  // "**Errors:** `ol-type` if the prompt is not a `word`", which the profile's error table (`:427-431`)
  // classes as "an argument has the wrong type".
  //
  // The maintainer's ruling on issue #768 narrowed this from #681's scalar set: `number` and
  // `boolean` are rejected alongside the compound kinds, and `params.expected` is `"word"` — the
  // same identity `word` itself reports for `word "Question" 3` — not the one-off `"text"`. Now that
  // the spec states the rule, the behavior is ALSO bound by conformance fixtures under
  // `tests/conformance/interaction-events/input/`. This loop is what proves the rule holds for ALL
  // SIX rejected kinds in one place: `dict` and `record` would drag the Data profile into an
  // Interaction fixture and `turtle` the Sprites one, for no proof a `list` does not already give.
  for (const [source, actual] of [
    ["print input 42", "number"],
    ["print input true", "boolean"],
    ["print input [1 2]", "list"],
    ["print input {a: 1}", "dict"],
    ["struct point [ x y ]\nprint input point 3 4", "record"],
    ["print input new_turtle", "turtle"],
  ]) {
    const result = runWithAnswers(source, ["tom"]);
    assert.equal(result.diagnostics.length, 1, source);
    const [finding] = result.diagnostics;
    assert.equal(finding.code, "ol-type");
    assert.equal(finding.stage, "runtime");
    assert.deepEqual(finding.params, {
      operation: "input",
      expected: "word",
      actual,
    });
  }
});

test("a rejected prompt never reaches the read — the host reader is never called", () => {
  // The prompt is checked BEFORE the read. A conformance fixture cannot prove that: a
  // source→events fold sees only an absent `primitive`, and absence is not ordering. The live
  // reader seam makes the ordering directly observable — if the check ran after the read, a bad
  // prompt would still have put a question in front of the learner, and on the `responses` path it
  // would have eaten the queue's head, so a later read in a longer program would be answered
  // off-by-one.
  //
  // The valid-prompt CONTROL comes first and is what makes the subject leg mean anything: it proves
  // `reads` is a live instrument that this reader really does advance, so the subject's "still 1"
  // records a read that did not happen rather than a counter that never could. Same control-plus-
  // subject shape the corpus uses for the blocking property (`input-does-not-deliver-handlers` +
  // `input-blocking-control-wait-delivers`).
  let reads = 0;
  const reader = () => {
    reads += 1;
    return "tom";
  };

  const control = execute('print input "who?"', doc, {
    hostInput: { read: reader },
  });
  assert.deepEqual(control.diagnostics, []);
  assert.equal(reads, 1);

  const withReader = execute("print input [1 2]", doc, {
    hostInput: { read: reader },
  });
  assert.equal(reads, 1);
  assert.equal(withReader.diagnostics[0].code, "ol-type");
  assert.deepEqual(effectEvents(withReader), []);

  const withResponses = runWithAnswers("print input [1 2]", ["tom"]);
  assert.equal(withResponses.diagnostics[0].code, "ol-type");
  assert.deepEqual(effectEvents(withResponses), []);
});

test("a word prompt is accepted whatever text it holds, including a numeral", () => {
  // The positive complement of the rejection loop above, and the half that makes the pair
  // discriminating: the check is on the prompt's TYPE, not on how it prints. `input "42"` and
  // `input 42` display the same two characters, yet the pair requires OPPOSITE verdicts on them. So
  // no classifier that looks only at printed form can satisfy both members — it fails whichever one
  // its decision goes against, accepting numerals to fail the rejection loop above or rejecting them
  // to fail here — and an implementation that rejected every prompt fails here too. Neither member
  // alone catches both.
  for (const prompt of ['"how old?"', '"42"', '""']) {
    const result = runWithAnswers(`print input ${prompt}`, ["tom"]);
    assert.deepEqual(result.diagnostics, [], `prompt ${prompt}`);
    assert.deepEqual(printedValues(result), ["tom"]);
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

// --- INVERTED (issue #839): `define input` is rejected at registration, so there is no dispatch --
// --- order left to lock — check() and execute() now agree instead of splitting -------------------

test("`define input` is rejected at registration by BOTH check() and execute(), with the same code and params", () => {
  // Was: "the primitive wins over a same-named user procedure, in a program the checker already
  // rejects" — it locked `execute()`'s dispatch order for a program `check()` rejected, i.e. it
  // locked a cross-stage split. Issue #839 closes that split: the runtime's phase-1 registration
  // (`spec/execution-model.md:82-89`) rejects the declaration itself, so `input` never gets the
  // chance to resolve ahead of `environment.procedures`. `input` is not special here — `define
  // random` and `define who` behave identically.
  const source = [
    "define input :prompt",
    "  return 7",
    "end",
    'print input "q"',
  ].join("\n");

  const { ast } = parse(source, doc);
  const checked = check(ast, {
    profiles: ["core-language", "turtle-rendering", "interaction-events"],
  });
  const checkedIdentity = checked.diagnostics.map((finding) => [
    finding.code,
    finding.params,
  ]);
  assert.deepEqual(checkedIdentity, [["ol-reserved-word", { name: "input" }]]);

  const result = runWithAnswers(source, ["tom"]);
  assert.deepEqual(
    result.diagnostics.map((finding) => [finding.code, finding.params]),
    checkedIdentity,
    "execute() must report the same identity check() does",
  );
  assert.deepEqual(
    result.diagnostics[0].source_span,
    checked.diagnostics[0].source_span,
    "…at the same span",
  );
  // Asserted on the WHOLE event stream: `effectEvents`/`printedValues` are filtered views, and
  // filtering an empty array never calls its predicate, so neither would notice an `instruction`
  // event — or anything else — being emitted before the halt.
  assert.deepEqual(result.events, [], "nothing runs at all");
});

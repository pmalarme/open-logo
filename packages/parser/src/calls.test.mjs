import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for call-form structure and callee-span accuracy (issue #63 — "Calls and arity").
 * These are new cases only: fixed-arity call shape, a nested reporter argument, infix operators
 * binding *inside* a single call argument (not splitting into two arguments), the parenthesized
 * variadic call form's argument count/spans, and the callee span identity that
 * `ol-unknown-command`'s did-you-mean (#9, #117) relies on. `arity.test.mjs` already covers the
 * static arity rule and `unknown-command.test.mjs` already covers the did-you-mean *message* and
 * *params* — neither asserts call-form shape or callee `source_span`, which is this file's focus.
 * Behavior is verified against the built `@openlogo/parser` entry point per the shared black-box
 * convention (co-located `*.test.mjs` importing only `@openlogo/parser`).
 */

const doc = "calls.logo";
const span = (start, end) => ({ document: doc, start, end });

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

test("a fixed-arity call gathers exactly its default-arity argument", () => {
  const [call] = parseClean("print 100").body;
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "print");
  assert.equal(call.args.length, 1);
  assert.equal(call.args[0].kind, "NumberLit");
  assert.equal(call.args[0].value, 100);
});

test("a nested reporter call fills an outer fixed-arity call's argument slot", () => {
  // `power` has default arity 2, so `print power 2 3` reads as `print (power 2 3)`: the outer
  // call's single argument is itself a Call node, not three flattened arguments.
  const [call] = parseClean("print power 2 3").body;
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "print");
  assert.equal(call.args.length, 1);

  const inner = call.args[0];
  assert.equal(inner.kind, "Call");
  assert.equal(inner.callee.name, "power");
  assert.equal(inner.args.length, 2);
  assert.equal(inner.args[0].value, 2);
  assert.equal(inner.args[1].value, 3);
});

test("an infix operator binds inside a fixed-arity call's argument as one expression node", () => {
  // `forward`-shaped call `print 100 + 50` must gather ONE argument — the whole `+` expression —
  // not two arguments `100` and `+ 50`. This is the arg-grouping guarantee the reader's
  // precedence-climbing expression parser gives a fixed-arity call.
  const [call] = parseClean("print 100 + 50").body;
  assert.equal(call.args.length, 1);
  const [arg] = call.args;
  assert.equal(arg.kind, "Call");
  assert.equal(arg.callee.name, "+");
  assert.equal(arg.args.length, 2);
  assert.equal(arg.args[0].value, 100);
  assert.equal(arg.args[1].value, 50);
});

test("an infix operator over a variable binds inside a call argument as one expression node", () => {
  const [, call] = parseClean(":n = 4\nprint :n * 2").body;
  assert.equal(call.args.length, 1);
  const [arg] = call.args;
  assert.equal(arg.kind, "Call");
  assert.equal(arg.callee.name, "*");
  assert.equal(arg.args[0].kind, "VarRef");
  assert.equal(arg.args[0].name, "n");
  assert.equal(arg.args[1].value, 2);
});

test("a parenthesized variadic call gathers every argument, however many are written", () => {
  const [call] = parseClean("(print 1 2 3)").body;
  assert.equal(call.kind, "ParenCall");
  assert.equal(call.callee.name, "print");
  assert.equal(call.args.length, 3);
  assert.deepEqual(
    call.args.map((a) => a.value),
    [1, 2, 3],
  );
});

test("a parenthesized call's callee span excludes the surrounding parentheses", () => {
  const [call] = parseClean("(print 1 2 3)").body;
  // "(print 1 2 3)" — the callee token "print" starts one column after the opening paren.
  assert.deepEqual(call.callee.source_span, span([1, 2], [1, 7]));
  assert.deepEqual(call.source_span, span([1, 1], [1, 14]));
});

test("a bare call's callee span covers only the callee token, not any trailing argument", () => {
  // `fowad` is not a known Core primitive, so its bare default arity falls back to 0 (#9/#117's
  // documented known-gap): the reader gathers no argument, and the trailing `100` is left as a
  // separate stray-token statement with its own diagnostic and its own span. The callee's span on
  // the `Call` node itself must still cover only "fowad".
  const { ast, diagnostics } = OL.parse("fowad 100", doc);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.deepEqual(diagnostics[0].source_span, span([1, 7], [1, 10]));

  const [call] = ast.body;
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "fowad");
  assert.deepEqual(call.callee.source_span, span([1, 1], [1, 6]));
  assert.deepEqual(call.source_span, span([1, 1], [1, 6]));
  assert.equal(call.args.length, 0);
});

test("a parenthesized unknown callee's ol-unknown-command span covers only the callee token", () => {
  // Complements unknown-command.test.mjs (which asserts params/message but not source_span): the
  // did-you-mean diagnostic's span must identify just the misspelled callee, not the whole
  // parenthesized call or its argument — critical for editor squiggles and quick fixes.
  const { ast, diagnostics: parseDiagnostics } = OL.parse("(fowad 100)", doc);
  assert.deepEqual(parseDiagnostics, []);
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-unknown-command");
  assert.deepEqual(finding.params, { name: "fowad" });
  assert.deepEqual(finding.source_span, span([1, 2], [1, 7]));
});

// Unit tests for the dict-literal grammar production `{ key: value … }` (Data profile, issue
// #149): `spec/grammar.md`'s `dict-literal ::= "{" { dict-entry } "}"` and
// `dict-entry ::= dict-key ":" expression`, with `dict-key ::= identifier | number`. This slice
// is parse/lex/highlight only — no runtime evaluation (see @openlogo/runtime's
// `isSupportedExpression`, which always reports a `DictLit` unsupported). Entries are separated
// only by whitespace/newlines, never commas (`spec/grammar.md`); `{ }` (matched braces, zero
// entries) is a valid empty dict, not an error (`spec/error-model.md`); only a genuinely
// unmatched `{`/`}` reports `ol-unmatched-brace`.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "dict-literal.logo";
const parse = (src) => OL.parse(src, doc);
const codesOf = (src) => parse(src).diagnostics.map((d) => d.code);
/** The parsed `<expr>` AST node of a bare `print <expr>` statement. */
const firstArg = (src) => parse(src).ast.body[0].args[0];

test("parses a single-entry dict literal with a bare identifier key", () => {
  const dict = firstArg("print { a: 1 }");
  assert.equal(dict.kind, "DictLit");
  assert.equal(dict.entries.length, 1);
  assert.equal(dict.entries[0].key.kind, "WordLit");
  assert.equal(dict.entries[0].key.value, "a");
  assert.equal(dict.entries[0].value.kind, "NumberLit");
  assert.equal(dict.entries[0].value.value, 1);
  assert.deepEqual(codesOf("print { a: 1 }"), []);
});

test("parses multiple entries on one line, in source order", () => {
  const dict = firstArg("print { a: 1 b: 2 c: 3 }");
  assert.deepEqual(
    dict.entries.map((entry) => entry.key.value),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    dict.entries.map((entry) => entry.value.value),
    [1, 2, 3],
  );
  assert.deepEqual(codesOf("print { a: 1 b: 2 c: 3 }"), []);
});

test("parses entries spread across multiple lines", () => {
  const source = ["print {", "  a: 1", "  b: 2", "}"].join("\n");
  const dict = firstArg(source);
  assert.deepEqual(
    dict.entries.map((entry) => entry.key.value),
    ["a", "b"],
  );
  assert.deepEqual(codesOf(source), []);
});

test("parses a nested expression as an entry's value", () => {
  const dict = firstArg("print { total: 2 + 3 * 4 }");
  const value = dict.entries[0].value;
  assert.equal(value.kind, "Call");
  assert.equal(value.callee.name, "+");
});

test("parses a number literal as a dict key", () => {
  const dict = firstArg('print { 1: "one" 2: "two" }');
  assert.deepEqual(
    dict.entries.map((entry) => entry.key.kind),
    ["NumberLit", "NumberLit"],
  );
  assert.deepEqual(
    dict.entries.map((entry) => entry.key.value),
    [1, 2],
  );
  assert.deepEqual(codesOf('print { 1: "one" 2: "two" }'), []);
});

test("parses a negative number literal as a dict key", () => {
  const dict = firstArg('print { -1: "negative" }');
  assert.equal(dict.entries[0].key.kind, "NumberLit");
  assert.equal(dict.entries[0].key.value, -1);
  assert.deepEqual(codesOf('print { -1: "negative" }'), []);
});

test("accepts a reserved word as a bare dict key", () => {
  // Reserved words are legal dict keys (`spec/data-structures.md:143-171`): the lexer never
  // special-cases them, so `repeat`/`end`/`if` lex as ordinary `name` tokens here too.
  const dict = firstArg("print { repeat: 1 end: 2 if: 3 }");
  assert.deepEqual(
    dict.entries.map((entry) => entry.key.value),
    ["repeat", "end", "if"],
  );
  assert.deepEqual(codesOf("print { repeat: 1 end: 2 if: 3 }"), []);
});

test("parses an empty dict literal `{ }` with zero diagnostics", () => {
  const dict = firstArg("print { }");
  assert.equal(dict.kind, "DictLit");
  assert.deepEqual(dict.entries, []);
  assert.deepEqual(codesOf("print { }"), []);
  // Also valid with no whitespace and spread across a line of its own.
  assert.deepEqual(codesOf("print {}"), []);
  assert.deepEqual(codesOf("print {\n}"), []);
});

test("keeps every entry, including a repeated key — dedup is a runtime concern, not the parser's", () => {
  const dict = firstArg("print { a: 1 a: 2 }");
  assert.equal(dict.entries.length, 2);
  assert.deepEqual(
    dict.entries.map((entry) => entry.value.value),
    [1, 2],
  );
});

test("reports ol-unmatched-brace for an unclosed dict literal", () => {
  assert.deepEqual(codesOf("print { a: 1"), ["ol-unmatched-brace"]);
  const unmatched = parse("print { a: 1").diagnostics[0];
  assert.equal(unmatched.params.delimiter, "{");
});

test("reports ol-unmatched-brace for a stray closing brace", () => {
  assert.deepEqual(codesOf("print }"), ["ol-unmatched-brace"]);
  const unmatched = parse("print }").diagnostics[0];
  assert.equal(unmatched.params.delimiter, "}");
});

test("the dict literal's own source_span covers exactly the braces", () => {
  const dict = firstArg("print { a: 1 }");
  assert.deepEqual(dict.source_span.start, [1, 7]);
  assert.deepEqual(dict.source_span.end, [1, 15]);
});

test("reports a diagnostic when a dict entry is missing its `:` separator", () => {
  // The key `a` parses, but the next token (`b`) is neither `:` nor a valid follow-on, so it is
  // reported as a bad token; the malformed entry is then skipped and parsing resumes, closing the
  // dict at the next `}`.
  assert.deepEqual(codesOf("print { a b }"), [
    "ol-bad-token",
    "ol-unmatched-brace",
  ]);
});

test("reports ol-unmatched-brace when a dict entry is missing its value", () => {
  // After `a:`, the closing `}` is reached before any value expression, so the entry is reported
  // against the (matched, but premature) closing brace.
  assert.deepEqual(codesOf("print { a: }"), ["ol-unmatched-brace"]);
});

test("reports ol-unmatched-brace when a dict key is not an identifier or number", () => {
  // `dict-key ::= identifier | number` (`spec/grammar.md`) — a nested `{ … }` is not a legal key,
  // so it is reported and skipped rather than recursively parsed as a nested dict literal.
  const diagnosticCodes = codesOf("print { { a: 1 }: 2 }");
  assert.ok(diagnosticCodes.includes("ol-unmatched-brace"));
  const first = parse("print { { a: 1 }: 2 }").diagnostics[0];
  assert.equal(first.code, "ol-unmatched-brace");
  assert.equal(first.params.delimiter, "{");
});

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
  // reported as a bad token; the malformed entry is skipped and `b` is retried as a fresh key,
  // which then finds `}` instead of a colon — also reported as a bad token, since that `}` is
  // not actually unmatched: parseDictLiteral's own loop is about to consume it and close the
  // dict correctly right after.
  assert.deepEqual(codesOf("print { a b }"), ["ol-bad-token", "ol-bad-token"]);
});

test("reports ol-bad-token, not ol-unmatched-brace, when a dict entry is missing its value", () => {
  // After `a:`, the closing `}` is reached before any value expression. That `}` still closes
  // the dict correctly on the very next pass, so it is not an unmatched brace — reporting one
  // would be misleading; `ol-bad-token` (a value was expected here) is accurate instead.
  assert.deepEqual(codesOf("print { a: }"), ["ol-bad-token"]);
  const badToken = parse("print { a: }").diagnostics[0];
  assert.equal(badToken.params.text, "}");
});

test("reports ol-bad-token, not ol-unmatched-brace, when a dict entry has neither `:` nor value", () => {
  // `{ a }` is missing both the separator and the value, but its brace still matches.
  assert.deepEqual(codesOf("print { a }"), ["ol-bad-token"]);
  const badToken = parse("print { a }").diagnostics[0];
  assert.equal(badToken.params.text, "}");
});

test("reports exactly one ol-bad-token, not ol-unmatched-brace, when a dict key is a nested dict literal", () => {
  // `dict-key ::= identifier | number` (`spec/grammar.md`) — a nested `{ … }` is not a legal key.
  // Per `spec/error-model.md` and `spec/data-structures.md#dictionaries` (issue #520), this is a
  // grammar-position error, not a brace-matching one: the inner `{` and its balanced nested
  // literal, plus its `: 2` trailing entry, are all skipped as one malformed entry, so exactly
  // one `ol-bad-token` fires for the inner `{` itself — never `ol-unmatched-brace` — and the
  // outer dict literal (whose own braces are correctly matched) still closes cleanly with zero
  // entries.
  const source = "print { { a: 1 }: 2 }";
  assert.deepEqual(codesOf(source), ["ol-bad-token"]);
  const diagnostic = parse(source).diagnostics[0];
  assert.equal(diagnostic.code, "ol-bad-token");
  assert.equal(diagnostic.stage, "parse");
  assert.equal(diagnostic.params.text, "{");
  // The span covers only the inner opening brace (offset 8, the second `{`), not the outer
  // dict's braces and not the `a: 1 }` that follows.
  assert.deepEqual(diagnostic.source_span.start, [1, 9]);
  assert.deepEqual(diagnostic.source_span.end, [1, 10]);
  const dict = firstArg(source);
  assert.equal(dict.kind, "DictLit");
  assert.deepEqual(dict.entries, []);
});

test("a doubly-nested dict literal used as a key is still skipped as one malformed entry", () => {
  // `skipMalformedDictKeyLiteral` tracks brace depth so an inner `{ … }` inside the malformed
  // key cannot end the balanced skip early — a `{ { { a: 1 } }: 2 }` key still yields exactly
  // one `ol-bad-token` for the outermost inner `{`, not one per nesting level.
  assert.deepEqual(codesOf("print { { { a: 1 } }: 2 }"), ["ol-bad-token"]);
});

test("a glued colon-to-name after a malformed nested-dict-key entry still parses as its trailing value", () => {
  // The malformed key's recovery also splices a glued `:name` token exactly like a normal
  // entry's separator (`splitGluedColonToken` only glues onto a following identifier, never a
  // number — see `tokens.ts`'s `:name` lexer rule), so `{ { a:1 }:foo }` — no space anywhere
  // around either colon — still yields exactly one diagnostic, not a second one for the glued
  // `:foo`.
  assert.deepEqual(codesOf("print { { a:1 }:foo }"), ["ol-bad-token"]);
});

test("a `{` in a dict entry's separator position (missing `:`) is unaffected by the nested-key fix", () => {
  // This is a different malformed shape than a nested dict *key* (issue #520): `a` is a valid
  // key that gets consumed, but the `:` separator is missing and a `{` appears where the
  // separator/value was expected instead. `unexpectedInDictEntry` only special-cases a stray
  // `}` there (see its doc comment); an unrelated `{` still falls through to the generic
  // `unexpected()`, which reports the inner dict literal's own opening `{` as
  // `ol-unmatched-brace`, per its normal `spec/error-model.md` meaning: `{ b: 1 }` truly is a
  // new, separately-unmatched-looking dict literal from the parser's point of view here, not a
  // key. Out of scope for issue #520.
  assert.deepEqual(codesOf("print { a { b: 1 } }"), [
    "ol-unmatched-brace",
    "ol-bad-token",
  ]);
});

test("a token that cannot even start a dict-key (e.g. a stray `:`) is reported by parseDictLiteral's own fallback", () => {
  // Unlike the nested-dict-key case (issue #520) or any other malformed entry above,
  // `parseDictEntry` returns `undefined` here *without consuming any token at all* — a bare
  // `:` is neither `number`, `name`, nor `lbrace` — so it is {@link parseDictLiteral}'s own
  // `pos === before` fallback (not `unexpectedInDictEntry`) that reports and skips it, one
  // token at a time: the stray `:` as `ol-bad-token`, then the entry-less `1` closes the loop
  // fine, leaving only the trailing `}` — which is not actually unmatched, so it also reports
  // as `ol-bad-token` rather than `ol-unmatched-brace`.
  assert.deepEqual(codesOf("print { : 1 }"), ["ol-bad-token", "ol-bad-token"]);
  const [first] = parse("print { : 1 }").diagnostics;
  assert.equal(first.params.text, ":");
});

test("a dict-entry colon glued to its value with no gap parses identically to one with a space", () => {
  // The lexer's `:name` rule (tokens.ts) has no notion of "dict-entry separator": `:foo` with
  // zero gap anywhere lexes as one `variable` token. Since whitespace is insignificant around
  // the separator (`spec/grammar.md`), `{ a:foo }` must parse exactly like `{ a: foo }` — a
  // zero-arity call to `foo`, never a `VarRef` — with no diagnostics either way.
  const glued = firstArg("print { a:foo }");
  const spaced = firstArg("print { a: foo }");
  assert.equal(glued.entries[0].value.kind, "Call");
  assert.equal(glued.entries[0].value.callee.name, "foo");
  assert.deepEqual(glued.entries[0].value.args, []);
  assert.equal(spaced.entries[0].value.kind, "Call");
  assert.equal(spaced.entries[0].value.callee.name, "foo");
  assert.deepEqual(codesOf("print { a:foo }"), []);
});

test("a glued dict-entry colon still gathers a multi-argument fixed call", () => {
  const dict = firstArg("print { a:power 2 3 }");
  const value = dict.entries[0].value;
  assert.equal(value.kind, "Call");
  assert.equal(value.callee.name, "power");
  assert.deepEqual(
    value.args.map((arg) => arg.value),
    [2, 3],
  );
  assert.deepEqual(codesOf("print { a:power 2 3 }"), []);
});

test("a glued dict-entry colon before a reserved bare name still parses (not a variable read)", () => {
  // `{ a:true }` is an edge case only because `true` is a reserved boolean literal, not an
  // ordinary identifier — the split must still hand the reader a `name` token that parses as a
  // `BooleanLit`, not silently drop the entry.
  const diagnosticCodes = codesOf("print { a:true }");
  assert.deepEqual(diagnosticCodes, []);
  const dict = firstArg("print { a:true }");
  assert.equal(dict.entries[0].value.kind, "BooleanLit");
  assert.equal(dict.entries[0].value.value, true);
});

// Unit tests for the profile grammar extension point + shared `end<keyword>` block-tail machinery
// (issue #664, slice C2 of epic #658): `spec/grammar.md#profile-grammar-extensions`, plus the
// per-profile forms in `spec/turtles-and-sprites.md:161-170` (`tell`/`ask`/`each`) and
// `spec/interaction-events.md:54-65` (`when`/`every`/`on_key`/`on_click`).
//
// Every registered profile head keyword parses into one shared `ProfileStatement` node, reusing
// the Core `expression` and block productions: a block head accepts either a bracket block or a
// `… end` / `… end <keyword>` long form; a labeled `end` MUST match its opener (a mismatch raises
// `ol-mismatched-end`); the bodyless `tell` command takes an expression and no block. The reader is
// profile-blind — it recognizes these forms structurally regardless of the active profile set, so
// no profile switch reaches the reader (profile legality is the Layer-2 checker's job).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "profile-statement.logo";
const parse = (src) => OL.parse(src, doc);
const codesOf = (src) => parse(src).diagnostics.map((d) => d.code);
/** The first parsed statement node of `src`. */
const first = (src) => parse(src).ast.body[0];

// --- block heads: bracket form ---------------------------------------------

test("`ask :fish [ ... ]` parses into a ProfileStatement with a block body", () => {
  const node = first("ask :fish [ forward 10 ]");
  assert.equal(node.kind, "ProfileStatement");
  assert.equal(node.keyword.name, "ask");
  assert.equal(node.args.length, 1);
  assert.equal(node.args[0].kind, "VarRef");
  assert.equal(node.body.kind, "Block");
  assert.equal(node.body.body.length, 1);
  assert.deepEqual(codesOf("ask :fish [ forward 10 ]"), []);
});

test("`each [ ... ]` parses with no head argument and a block body", () => {
  const node = first("each [ forward 10 ]");
  assert.equal(node.kind, "ProfileStatement");
  assert.equal(node.keyword.name, "each");
  assert.equal(node.args.length, 0);
  assert.equal(node.body.kind, "Block");
  assert.deepEqual(codesOf("each [ forward 10 ]"), []);
});

test("`on_click [ ... ]` parses with no head argument", () => {
  const node = first("on_click [ forward 10 ]");
  assert.equal(node.keyword.name, "on_click");
  assert.equal(node.args.length, 0);
  assert.equal(node.body.body.length, 1);
  assert.deepEqual(codesOf("on_click [ forward 10 ]"), []);
});

test("`when`, `every`, and `on_key` each take one expression plus a block", () => {
  for (const keyword of ["when", "every", "on_key"]) {
    const node = first(`${keyword} :e [ forward 10 ]`);
    assert.equal(node.keyword.name, keyword);
    assert.equal(node.args.length, 1);
    assert.equal(node.body.kind, "Block");
    assert.deepEqual(codesOf(`${keyword} :e [ forward 10 ]`), []);
  }
});

// --- block heads: long form closed by `end` / `end <keyword>` --------------

test("`ask :fish\\n ... \\nend` long form parses one statement with a block body", () => {
  const node = first("ask :fish\n  forward 10\nend");
  assert.equal(node.kind, "ProfileStatement");
  assert.equal(node.keyword.name, "ask");
  assert.equal(node.body.body.length, 1);
  assert.deepEqual(codesOf("ask :fish\n  forward 10\nend"), []);
});

test("a long-form block closed by a matching `end ask` parses cleanly", () => {
  assert.deepEqual(codesOf("ask :fish\n  forward 10\nend ask"), []);
});

test("`each ... end each` and `on_click ... end on_click` accept matching labels", () => {
  assert.deepEqual(codesOf("each\n  forward 10\nend each"), []);
  assert.deepEqual(codesOf("on_click\n  forward 10\nend on_click"), []);
});

test("each event head accepts its own matching `end <keyword>` label", () => {
  for (const keyword of ["when", "every", "on_key"]) {
    assert.deepEqual(
      codesOf(`${keyword} :e\n  forward 10\nend ${keyword}`),
      [],
    );
  }
});

// --- mismatched end --------------------------------------------------------

test("an `ask` block closed by `end each` raises ol-mismatched-end", () => {
  const result = parse("ask :fish\n  forward 10\nend each");
  const mismatch = result.diagnostics.find(
    (d) => d.code === "ol-mismatched-end",
  );
  assert.ok(mismatch, "expected an ol-mismatched-end diagnostic");
  assert.equal(mismatch.params.expected, "ask");
  assert.equal(mismatch.params.actual, "each");
});

test("the mismatched-end span points at the wrong label, not the opener", () => {
  const result = parse("ask :fish\n  forward 10\nend when");
  const mismatch = result.diagnostics.find(
    (d) => d.code === "ol-mismatched-end",
  );
  assert.ok(mismatch);
  // `when` sits on line 3, one column past `end ` (`end ` is columns 1-4).
  assert.deepEqual(mismatch.source_span.start, [3, 5]);
});

test("a `when` block closed by `end on_click` raises ol-mismatched-end", () => {
  const codes = codesOf("when :e\n  forward 10\nend on_click");
  assert.ok(codes.includes("ol-mismatched-end"));
});

// --- missing end -----------------------------------------------------------

test("an unterminated long-form block raises ol-missing-end", () => {
  const codes = codesOf("ask :fish\n  forward 10");
  assert.ok(codes.includes("ol-missing-end"));
});

test("a block head with neither `[` nor a newline body raises ol-missing-end", () => {
  const codes = codesOf("each forward 10");
  assert.ok(codes.includes("ol-missing-end"));
});

// --- missing head argument -------------------------------------------------

test("`ask` with no expression argument raises a diagnostic and no crash", () => {
  const result = parse("ask");
  assert.notEqual(result.diagnostics.length, 0);
  // recovery must not throw and must produce a best-effort tree.
  assert.equal(result.ast.kind, "Program");
});

test("`when` with a missing argument before its block reports a diagnostic", () => {
  const result = parse("when [ forward 10 ]");
  // `[` is not a valid expression start here, so the head arg is missing.
  assert.notEqual(result.diagnostics.length, 0);
});

// --- tell: bodyless mode-switch command ------------------------------------

test("`tell :fish` parses into a ProfileStatement with an arg and no block body", () => {
  const node = first("tell :fish");
  assert.equal(node.kind, "ProfileStatement");
  assert.equal(node.keyword.name, "tell");
  assert.equal(node.args.length, 1);
  assert.equal(node.body, undefined);
  assert.deepEqual(codesOf("tell :fish"), []);
});

test("`tell [ :a :b ]` accepts a list expression argument and takes no block", () => {
  const node = first("tell [ :a :b ]");
  assert.equal(node.keyword.name, "tell");
  assert.equal(node.args[0].kind, "ListLit");
  assert.equal(node.body, undefined);
  assert.deepEqual(codesOf("tell [ :a :b ]"), []);
});

test("`tell` with no argument reports a diagnostic and does not crash", () => {
  const result = parse("tell");
  assert.notEqual(result.diagnostics.length, 0);
  assert.equal(result.ast.kind, "Program");
});

// --- spans -----------------------------------------------------------------

test("a ProfileStatement's span covers the whole form, head keyword to end", () => {
  const node = first("tell :fish");
  assert.deepEqual(node.source_span.start, [1, 1]);
  assert.deepEqual(node.source_span.end, [1, 11]);
});

test("the head keyword carries its own span", () => {
  const node = first("ask :fish [ forward 10 ]");
  assert.deepEqual(node.keyword.source_span.start, [1, 1]);
  assert.deepEqual(node.keyword.source_span.end, [1, 4]);
});

// --- reader is profile-blind: recognized regardless of Core-only context ---

test("profile heads parse structurally with no active-profile input to the reader", () => {
  // `parse` takes only source + document — no profile set — yet the forms parse, proving the
  // reader recognizes them structurally and leaves profile legality to the checker.
  assert.equal(first("ask :fish [ forward 10 ]").kind, "ProfileStatement");
  assert.equal(first("tell :fish").kind, "ProfileStatement");
  assert.equal(first("when :e [ forward 10 ]").kind, "ProfileStatement");
});

// --- Core backward compatibility: a user procedure may shadow a profile head ---

test("`define ask … end` then `ask` parses as a Core procedure, not a profile statement", () => {
  const program = parse("define ask\n  hint\nend\nask").ast;
  const def = program.body.find((n) => n.kind === "ProcedureDef");
  assert.ok(def, "the define should parse as a ProcedureDef");
  assert.equal(def.name.name, "ask");
  // The trailing bare `ask` call must NOT become a ProfileStatement (it is a user-declared name).
  const hasProfileStmt = program.body.some(
    (n) => n.kind === "ProfileStatement",
  );
  assert.equal(hasProfileStmt, false);
  assert.deepEqual(codesOf("define ask\n  hint\nend\nask"), []);
});

test("a user procedure named `tell` shadows the profile mode-switch command", () => {
  const program = parse("define tell :x\n  print :x\nend\ntell 3").ast;
  const hasProfileStmt = program.body.some(
    (n) => n.kind === "ProfileStatement",
  );
  assert.equal(hasProfileStmt, false);
  assert.deepEqual(codesOf("define tell :x\n  print :x\nend\ntell 3"), []);
});

// --- Core-neutrality: define AND call a profile head as an ordinary procedure ---
// spec/interaction-events.md §Profiles and reservation: "An implementation that does not declare
// this profile does not reserve those words except through a vendor extension or an imported
// alias." So a Core-only program must be free to both DECLARE and CALL these words. The reader is
// profile-blind, so this proves the call side (not just the declaration side): a user-declared name
// shadows the profile head, the trailing call parses as a `Call`, and the whole program is diagnostic
// clean under Core-only checking. (End-to-end runtime execution — the call actually running the
// user body — is covered by the runtime/conformance suites; here we prove the parse+check shape this
// slice owns.)

/** The last statement of `src`'s parse tree. */
const last = (src) => {
  const body = parse(src).ast.body;
  return body[body.length - 1];
};
/** Parse-plus-Core-only-check diagnostic codes for `src`. */
const coreCodesOf = (src) => {
  const { ast, diagnostics } = parse(src);
  const checkDiagnostics = OL.check(ast, {
    profiles: ["core-language"],
  }).diagnostics;
  return [...diagnostics, ...checkDiagnostics].map((d) => d.code);
};

test("a Core program can define and call the Sprites head `ask` as an ordinary procedure", () => {
  const src = "define ask :x\n  print :x\nend\nask 5";
  assert.equal(last(src).kind, "Call");
  assert.equal(last(src).callee.name, "ask");
  assert.deepEqual(coreCodesOf(src), []);
});

test("a Core program can define and call the Sprites head `tell` as an ordinary procedure", () => {
  const src = "define tell :x\n  print :x\nend\ntell 9";
  assert.equal(last(src).kind, "Call");
  assert.deepEqual(coreCodesOf(src), []);
});

test("a Core program can define and call the Interaction head `when` as an ordinary procedure", () => {
  const src = "define when :x\n  print :x\nend\nwhen 7";
  assert.equal(last(src).kind, "Call");
  assert.equal(last(src).callee.name, "when");
  assert.deepEqual(coreCodesOf(src), []);
});

// --- Core-neutrality: an UNDECLARED profile head is never silently accepted ---
// The false-accept this slice was flagged to prevent: `tell 5` in a Core-only program must NOT be
// accepted. Because the reader always shapes it into a `ProfileStatement`, the checker gate
// (checker-unknown-command.ts) is what restores parity — `tell` is not visible under Core, so it is
// reported `ol-unknown-command`, exactly as an unknown Core call would be.

test("an undeclared bodyless profile head (`tell 5`) is reported, not silently accepted, in Core", () => {
  const codes = coreCodesOf("tell 5");
  assert.ok(
    codes.includes("ol-unknown-command"),
    "a Core-only `tell 5` must raise ol-unknown-command (no false-accept)",
  );
});

// --- residual delta: a block-form head with no block is a parse error, still no false-accept ---
// An undeclared block-form head with neither `[` nor a newline body (`ask 5`) is rejected by the
// reader with `ol-missing-end` rather than the base's `ol-bad-token`+`ol-unknown-command`. Both
// reject the program (no false-accept); `error-model.md:109` reserves `ol-bad-token` for when no
// more-specific code applies, so `ol-missing-end` is at least as specific. This delta is documented
// in the PR body with the base-vs-new table and the pedagogy note; it is asserted here so a future
// change to it is deliberate.

test("an undeclared block-form head with no block (`ask 5`) is rejected (ol-missing-end), never accepted", () => {
  const codes = coreCodesOf("ask 5");
  assert.ok(
    codes.includes("ol-missing-end"),
    "`ask 5` must be rejected by the reader",
  );
  assert.equal(
    codes.includes("ol-unknown-command"),
    false,
    "the reader bailed before building a ProfileStatement, so the checker gate does not also fire",
  );
});

test("ast.profileStatement omits `body` for a bodyless form", () => {
  const kw = {
    name: "tell",
    source_span: OL.parse("tell", doc).ast.source_span,
  };
  const node = OL.ast.profileStatement(kw, [], undefined, kw.source_span);
  assert.equal("body" in node, false);
});

test("walk visits the head args and the block body of a ProfileStatement", () => {
  const program = parse("ask :fish [ forward 10 ]").ast;
  const kinds = [];
  OL.walk(program, (node) => kinds.push(node.kind));
  assert.ok(kinds.includes("ProfileStatement"));
  assert.ok(kinds.includes("VarRef"), "the head arg is walked");
  assert.ok(kinds.includes("Block"), "the block body is walked");
});

test("walk descends into a bodyless ProfileStatement's argument", () => {
  const program = parse("tell :fish").ast;
  const kinds = [];
  OL.walk(program, (node) => kinds.push(node.kind));
  assert.ok(kinds.includes("ProfileStatement"));
  assert.ok(kinds.includes("VarRef"));
  assert.ok(!kinds.includes("Block"));
});

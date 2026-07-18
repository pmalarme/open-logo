// Unit tests for OpenLogo comment handling (issue #64), validated against the merged parser
// on main. Comments are whitespace per spec/grammar.md:32,68-70: `#` and `//` start line
// comments; `/* */` is a non-nesting block comment; an unterminated block comment raises
// `ol-unclosed-comment` (spec/error-model.md:107). These tests cover cases not already
// exercised by parse.test.mjs's "treats line and block comments as whitespace" test: a
// comment-only program, comment markers as literal text inside strings, blank/comment
// interleaving preserving following spans, and the unclosed-block-comment diagnostic.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "acceptance.logo";
const span = (start, end) => ({ document: doc, start, end });

test("a comment-only program parses to an empty body with no diagnostics", () => {
  const { ast, diagnostics } = OL.parse(
    "# just a comment\n// another comment\n",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.kind, "Program");
  assert.deepEqual(ast.body, []);
});

test("a comment-only program with no trailing newline also parses cleanly", () => {
  const { ast, diagnostics } = OL.parse("# just a comment", doc);

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(ast.body, []);
});

test("comment markers inside a word literal are literal text, not comments", () => {
  const { ast, diagnostics } = OL.parse('print "a # b // c /* d */"', doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 1);
  const word = ast.body[0].args[0];
  assert.equal(word.kind, "WordLit");
  assert.equal(word.value, "a # b // c /* d */");
  assert.deepEqual(word.source_span, span([1, 7], [1, 27]));
});

test("blank lines and a full-line comment between statements do not disturb the next statement's span", () => {
  const src = "print 1\n\n# a comment on its own line\n\nprint 2\n";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 2);
  assert.equal(ast.body[0].args[0].value, 1);
  assert.deepEqual(ast.body[0].source_span, span([1, 1], [1, 8]));
  assert.equal(ast.body[1].args[0].value, 2);
  assert.deepEqual(ast.body[1].source_span, span([5, 1], [5, 8]));
});

test("an unterminated /* block comment raises ol-unclosed-comment with opened_at", () => {
  const src = "print 1\n/* this block comment is never closed\nprint 2\n";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.equal(diagnostics.length, 1);
  const diag = diagnostics[0];
  assert.equal(diag.code, "ol-unclosed-comment");
  assert.equal(diag.stage, "parse");
  assert.equal(diag.severity, "error");
  const openedAt = span([2, 1], [2, 3]);
  assert.deepEqual(diag.source_span, openedAt);
  assert.deepEqual(diag.params, { opened_at: openedAt });

  // The unterminated comment swallows everything after it to end of file, so the
  // would-be second `print 2` statement never appears in the best-effort tree.
  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].args[0].value, 1);
});

test("a non-nesting block comment closes at the first */, ignoring a nested /*", () => {
  const src = "print 1 /* outer /* inner */ print 2";
  const { ast, diagnostics } = OL.parse(src, doc);

  // The comment closes at the first `*/` (non-nesting), so ` print 2` is live source
  // resuming on the same physical line as `print 1` — with no newline between the two
  // statements, the reader raises ol-bad-token for the un-terminated first statement,
  // while still recovering a best-effort tree with both Call nodes.
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(ast.body.length, 2);
  assert.equal(ast.body[0].args[0].value, 1);
  assert.equal(ast.body[1].args[0].value, 2);
});

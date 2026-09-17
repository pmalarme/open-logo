// Unit tests for the hidden `print_under_the_shell` incantation (`under-the-shell.ts`, dispatched
// beside `print` in `execute-internal.ts`). It is deliberately unspecified: no `spec/` entry, no
// `@openlogo/parser` registry row, so `check()` reports `ol-unknown-command` for it while
// `execute()` - which never runs the semantic checker - answers.
//
// The message is NOT written out here. An easter egg whose test file spells it in plain text is
// not hidden at all, and a grep for any line of it would land straight on this file. So the two
// sides of every assertion are two INDEPENDENT encodings of the same text: the module carries it
// under the date-keyed walking shift, this file carries it as base64, and the test passes only if
// decoding each yields the same thing. Either one drifting fails the test, and neither is
// readable at rest.

import assert from "node:assert/strict";
import { test } from "node:test";
import { check, parse } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";
import { walkedBack } from "../dist/under-the-shell.js";

/** The expected message, base64 per line - the second encoding, deliberately not the first. */
const EXPECTED_BASE64 = [
  "SGVsbG8sIENoYXJsaWUuIPCfkKI=",
  "SWYgeW91IGZvdW5kIHRoaXMsIHlvdSBhcmUgYWxyZWFkeSBleHBsb3JpbmcgYmV5b25kIHRoZSBpbnN0cnVjdGlvbnMu",
  "RGFkIGFwcHJvdmVzLiDinaTvuI8=",
  "",
  "SSBidWlsdCB0aGlzIHNvIHlvdSBjb3VsZCBkaXNjb3ZlciBwcm9ncmFtbWluZyB0aGUgd2F5IEkgZGlkOg==",
  "YnkgcGxheWluZywgZXhwbG9yaW5nLCBhbmQgd29uZGVyaW5nICJ3aGF0IGlmPyI=",
  "",
  "Tm93IGdvIG1ha2Ugc29tZXRoaW5nIEkgbmV2ZXIgaW1hZ2luZWQu",
];

/** {@link EXPECTED_BASE64}, woken up - built at test time so the plain text is never at rest. */
const expectedLines = EXPECTED_BASE64.map((line) =>
  Buffer.from(line, "base64").toString("utf8"),
);

/** The `print` payload values emitted by running `source`, one entry per emitted line. */
function printedLines(source) {
  const result = execute(source, "egg.logo");
  assert.deepEqual(result.diagnostics, []);
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

test("the incantation prints the woken message, one print event per line", () => {
  assert.deepEqual(printedLines("print_under_the_shell"), expectedLines);
});

test("the two encodings really are independent - base64 is not the shifted text", () => {
  // Guards against the failure mode where both sides are accidentally the same bytes, which would
  // make the comparison above tautological.
  assert.notDeepEqual(EXPECTED_BASE64, expectedLines);
  assert.ok(
    expectedLines.some((line) => line.length > 0),
    "the expectation decodes to something",
  );
});

test("the walk covers both letter cases and leaves everything else alone", () => {
  // Asserted as properties of the result rather than by quoting it, so every branch of the
  // character walk is exercised without naming what it spells.
  const woken = expectedLines.join("\n");
  assert.ok(/\p{Lu}/u.test(woken), "an uppercase letter walked back");
  assert.ok(/\p{Ll}/u.test(woken), "a lowercase letter walked back");
  assert.ok(/[^\p{L}\s]/u.test(woken), "punctuation carried through untouched");
  assert.ok(
    /[^\p{ASCII}]/u.test(woken),
    "non-ASCII carried through untouched, spending no stride",
  );
});

test("the message keeps its shape, blank lines included", () => {
  const lines = printedLines("print_under_the_shell");
  assert.equal(lines.length, EXPECTED_BASE64.length);
  assert.deepEqual(
    lines.map((line) => line === ""),
    EXPECTED_BASE64.map((line) => line === ""),
  );
});

test("the incantation is recognised in its parenthesized form and regardless of casing", () => {
  assert.deepEqual(printedLines("(print_under_the_shell)"), expectedLines);
  assert.deepEqual(printedLines("PRINT_UNDER_THE_SHELL"), expectedLines);
});

test("a spell is the word, not its arguments - any arity says the same thing", () => {
  assert.deepEqual(printedLines("(print_under_the_shell 1 2)"), expectedLines);
});

test("arguments are deliberately NOT evaluated - a failing operand raises nothing", () => {
  // Load-bearing, so pinned: the egg answers on the word alone and never evaluates operands. An
  // argument that would certainly diagnose if evaluated must still produce the message and no
  // diagnostic. Without this, a refactor that made argument evaluation eager would stay green.
  const divideByZero = execute("print 1 / 0", "control.logo");
  assert.ok(
    divideByZero.diagnostics.length > 0,
    "control: a bare 1 / 0 really does diagnose, so the assertion below means something",
  );
  const result = execute("(print_under_the_shell 1 / 0)", "egg.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]),
    expectedLines,
  );
});

test("a user-defined procedure of the same name wins - the egg never shadows real code", () => {
  // Procedure dispatch runs before the egg's arm in `executeStatements`, so a learner who defines
  // the name themselves gets their own procedure. Pinned because the egg sits early in the chain.
  assert.deepEqual(
    printedLines(
      'define print_under_the_shell\n  print "mine"\nend\nprint_under_the_shell',
    ),
    ["mine"],
  );
});

test("a character that merely case-folds to a letter is walked past, untouched and free", () => {
  // U+212A KELVIN SIGN lowercases to an ASCII "k". A folding walk would rewrite it as a letter AND
  // spend a stride on it, knocking every later letter on the line out of step. Driven through the
  // real decoder rather than asserted about: the fixed message contains no such character, so no
  // assertion over the message could ever catch a regression here.
  assert.equal(
    "\u212A".toLowerCase(),
    "k",
    "the folding hazard this guards against is real",
  );
  assert.deepEqual(walkedBack("\u212A", 5), {
    character: "\u212A",
    isLetter: false,
  });
  // Controls, so the assertion above cannot pass by the walk simply doing nothing at all.
  assert.deepEqual(walkedBack("k", 5), { character: "f", isLetter: true });
  assert.deepEqual(walkedBack("K", 5), { character: "F", isLetter: true });
  // An astral character arrives from `for...of` as one two-code-unit string and is likewise free.
  assert.deepEqual(walkedBack("\u{1F422}", 5), {
    character: "\u{1F422}",
    isLetter: false,
  });
});

test("the incantation does not disturb a surrounding program", () => {
  assert.deepEqual(
    printedLines('print "before"\nprint_under_the_shell\nprint "after"'),
    ["before", ...expectedLines, "after"],
  );
});

test("a near miss is not the incantation and prints nothing", () => {
  assert.deepEqual(printedLines("print_under_the_shel"), []);
});

test("the semantic checker does not know the word - the egg is off the documented path", () => {
  const { ast, diagnostics } = parse("print_under_the_shell", "egg.logo");
  assert.deepEqual(diagnostics, [], "it parses as an ordinary call");
  const codes = check(ast, { source: "print_under_the_shell" }).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
  assert.deepEqual(codes, ["ol-unknown-command"]);
});

// Unit tests for the Data-profile record/struct runtime (issue #329, spec/data-structures.md:
// 252-327): phase-1 `struct` registration + `ol-reserved-word` collisions, the type-name
// constructor (arity == declared field count), `:record.field` read/write, `type_of`, `is_a?` on
// records, and structural record equality. Conformance fixtures under
// tests/conformance/data/struct-runtime/ prove the primary end-to-end shapes; these unit tests
// drive every dynamically-reachable branch (each collision namespace, each arity edge, propagated
// argument-evaluation failures, the record `printedForm`/equality branches) that the coverage gate
// counts and a fixture running in a subprocess cannot reach in isolation.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

function onlyDiagnostic(result) {
  assert.equal(
    result.diagnostics.length,
    1,
    JSON.stringify(result.diagnostics),
  );
  return result.diagnostics[0];
}

// --- constructor + field reads ----------------------------------------------------------------

test("a struct constructor builds a record with fields in declared order", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\nprint :p.x\nprint :p.y",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [3, 4]);
});

test("a struct may be constructed before its textual declaration (phase-1 registration)", () => {
  const result = execute(
    ":p = point 3 4\nprint :p.x\nstruct point [ x y ]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [3]);
});

test("constructor under-supply raises ol-not-enough-inputs (arity == field count)", () => {
  const result = execute("struct point [ x y ]\n:p = point 3", doc);
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-not-enough-inputs");
  assert.deepEqual(diag.params, { callable: "point", expected: 2, actual: 1 });
});

test("constructor over-supply (parenthesized) raises ol-too-many-inputs", () => {
  const result = execute("struct point [ x y ]\n:p = (point 3 4 5)", doc);
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-too-many-inputs");
  assert.deepEqual(diag.params, { callable: "point", expected: 2, actual: 3 });
});

test("a failing constructor argument propagates its diagnostic", () => {
  const result = execute("struct point [ x y ]\n:p = point 3 :missing", doc);
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-undefined-var");
  assert.equal(diag.params.name, "missing");
});

// --- field read/write + reference semantics ---------------------------------------------------

test("writing :record.field mutates the fixed slot in place", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\nprint :p.x\n:p.x = 10\nprint :p.x",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [3, 10]);
});

test("a record is a reference type — aliases observe in-place mutation", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\n:q = :p\n:q.y = 99\nprint :p.y",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [99]);
});

test("writing an unknown field raises ol-unknown-field with write:true", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\n:p.height = 1",
    doc,
  );
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-unknown-field");
  assert.deepEqual(diag.params, {
    type: "point",
    field: "height",
    write: true,
  });
});

test("reading an unknown field raises ol-unknown-field without a write param", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\nprint :p.height",
    doc,
  );
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-unknown-field");
  assert.deepEqual(diag.params, { type: "point", field: "height" });
});

test("records nest and their field chains read and write through", () => {
  const result = execute(
    "struct point [ x y ]\nstruct segment [ head tail ]\n:s = segment (point 1 2) (point 3 4)\nprint :s.head.x\n:s.head.x = 100\nprint :s.head.x\nprint :s.tail.y",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [1, 100, 4]);
});

// --- type_of ----------------------------------------------------------------------------------

test("type_of reports a record's struct type name", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\nprint type_of :p",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["point"]);
});

test("type_of on a non-record raises ol-type", () => {
  const result = execute("print type_of 5", doc);
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-type");
  assert.deepEqual(diag.params, {
    operation: "type_of",
    expected: "record",
    actual: "number",
  });
});

test("(type_of) with no argument raises ol-not-enough-inputs", () => {
  const result = execute("print (type_of)", doc);
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-not-enough-inputs");
  assert.equal(diag.params.callable, "type_of");
});

test("type_of propagates a failing argument's diagnostic", () => {
  const result = execute("print type_of :missing", doc);
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-undefined-var");
  assert.equal(diag.params.name, "missing");
});

test("(type_of a b) with two arguments raises ol-too-many-inputs", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\nprint (type_of :p :p)",
    doc,
  );
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-too-many-inputs");
  assert.equal(diag.params.callable, "type_of");
});

// --- is_a? on records -------------------------------------------------------------------------

test("is_a? on a record matches its own struct type name", () => {
  const result = execute(
    'struct point [ x y ]\n:p = point 3 4\nprint is_a? :p "point"',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("the worded `is a` predicate agrees with is_a? on a record", () => {
  const result = execute(
    'struct point [ x y ]\n:p = point 3 4\nprint :p is a "point"',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test('is_a? :record "record" is false — a record matches only its struct type name', () => {
  const result = execute(
    'struct point [ x y ]\n:p = point 3 4\nprint is_a? :p "record"',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("is_a? on a record with a different struct type word is false", () => {
  const result = execute(
    'struct point [ x y ]\nstruct circle [ r ]\n:p = point 3 4\nprint is_a? :p "circle"',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("is_a? with an unknown type word raises ol-unknown-type", () => {
  const result = execute(
    'struct point [ x y ]\n:p = point 3 4\nprint is_a? :p "circle"',
    doc,
  );
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-unknown-type");
  assert.equal(diag.params.name, "circle");
});

test("is_a? with a non-word type argument raises ol-type", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\nprint is_a? :p 5",
    doc,
  );
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-type");
  assert.equal(diag.params.operation, "is_a?");
});

test("is_a? still recognises the record against a core type word (false)", () => {
  const result = execute(
    'struct point [ x y ]\n:p = point 3 4\nprint is_a? :p "number"',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

// --- structural equality ----------------------------------------------------------------------

test("two records with equal type and fields are ==", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\n:q = point 3 4\nprint :p == :q",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("records with differing fields are not ==", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\n:q = point 5 4\nprint :p == :q",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("records of different struct types are not ==", () => {
  const result = execute(
    "struct point [ x y ]\nstruct pair [ x y ]\n:p = point 3 4\n:q = pair 3 4\nprint :p == :q",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("a record is never == a non-record value", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\nprint :p == 5\nprint :p == [ 1 2 ]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false, false]);
});

test("self-referential records compare == without infinite recursion", () => {
  const result = execute(
    "struct node [ next ]\n:a = node 0\n:a.next = :a\n:b = node 0\n:b.next = :b\nprint :a == :b",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

// --- printedForm (via throw's ol-user-error message) ------------------------------------------

test("throwing a record formats it via printedForm in the ol-user-error message", () => {
  const result = execute("struct point [ x y ]\n:p = point 3 4\nthrow :p", doc);
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-user-error");
  assert.equal(diag.params.message, "point {x: 3 y: 4}");
});

// --- phase-1 ol-reserved-word collisions ------------------------------------------------------

test("a struct type name declared twice raises ol-reserved-word (namespace struct)", () => {
  const result = execute("struct point [ x y ]\nstruct point [ a b ]", doc);
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-reserved-word");
  assert.deepEqual(diag.params, { name: "point", namespace: "struct" });
});

test("a struct name colliding with a reserved word raises ol-reserved-word (reserved)", () => {
  const result = execute("struct if [ x y ]", doc);
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-reserved-word");
  assert.equal(diag.params.namespace, "reserved");
});

test("a struct name colliding with a Core primitive raises ol-reserved-word (primitive)", () => {
  const result = execute("struct print [ x y ]", doc);
  assert.equal(onlyDiagnostic(result).params.namespace, "primitive");
});

test("a struct name colliding with a Turtle primitive raises ol-reserved-word (primitive)", () => {
  const result = execute("struct forward [ x y ]", doc);
  assert.equal(onlyDiagnostic(result).params.namespace, "primitive");
});

test("a struct name colliding with a Data primitive raises ol-reserved-word (primitive)", () => {
  const result = execute("struct dict [ x y ]", doc);
  assert.equal(onlyDiagnostic(result).params.namespace, "primitive");
});

test("a struct name colliding with an Educational primitive raises ol-reserved-word (primitive)", () => {
  const result = execute("struct explain [ x y ]", doc);
  assert.equal(onlyDiagnostic(result).params.namespace, "primitive");
});

test("a struct name colliding with a user procedure raises ol-reserved-word (procedure)", () => {
  const result = execute(
    "define foo\n  return 1\nend\nstruct foo [ x y ]",
    doc,
  );
  const diag = onlyDiagnostic(result);
  assert.equal(diag.code, "ol-reserved-word");
  assert.equal(diag.params.namespace, "procedure");
});

test("only the first collision halts the program (later structs are skipped)", () => {
  const result = execute("struct forward [ x y ]\nstruct back [ a b ]", doc);
  const diag = onlyDiagnostic(result);
  assert.equal(diag.params.name, "forward");
});

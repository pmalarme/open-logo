import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for issue #112 — type/field resolution (`ol-unknown-type` / `ol-unknown-field`).
 * Behavior is verified through the public `@openlogo/parser` surface (`parse` + `check` for the
 * wired `ol-unknown-type` rule, and the exported `resolveRecordField` primitive for the
 * Data-deferred `ol-unknown-field` logic), matching the package's black-box test convention.
 */

function checkSource(source, profiles) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, "unit.logo");
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles }).diagnostics;
}

const typeFindings = (source, profiles) =>
  checkSource(source, profiles).filter((d) => d.code === "ol-unknown-type");

// --- ol-unknown-type: worded `is a <type-word>` -----------------------------

test("flags a worded `is a` predicate whose type word names no known type", () => {
  const diagnostics = typeFindings('print :x is a "bogus_type"', [
    "core-language",
  ]);
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-unknown-type");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { name: "bogus_type" });
  // Span points at the type word itself (`"bogus_type"`), not the whole predicate.
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 15],
    end: [1, 27],
  });
});

test("its message uses the warm lowercase Logo voice", () => {
  const [finding] = typeFindings('print :x is a "bogus_type"', [
    "core-language",
  ]);
  assert.equal(
    finding.message,
    "i don't know the type bogus_type. check the spelling, or declare it with 'struct'.",
  );
});

for (const type of ["number", "word", "list", "boolean"]) {
  test(`leaves a well-formed \`is a "${type}"\` predicate clean`, () => {
    assert.deepEqual(
      typeFindings(`print :x is a "${type}"`, ["core-language"]),
      [],
    );
  });
}

test("matches type words exactly — a wrong-case built-in is unknown", () => {
  const diagnostics = typeFindings('print :x is a "Number"', ["core-language"]);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { name: "Number" });
});

test("does not treat other `is`-predicate forms as type positions", () => {
  const source = "print (:x is empty) and (5 is between 1 and 10)";
  assert.deepEqual(typeFindings(source, ["core-language"]), []);
});

test("does not flag the prefix `is_a?` form's dynamic type argument", () => {
  // `:typeVar` is not statically known to be a word, so speculatively raising ol-unknown-type
  // would be wrong (spec/tooling.md: tools MUST NOT report speculative type errors).
  assert.deepEqual(
    typeFindings("print is_a? 5 :typeVar", ["core-language"]),
    [],
  );
});

test("does not flag a literal type word in call/`is_a?` position", () => {
  // The prefix form's type argument is an ordinary evaluated call argument, not a static type
  // position; only the worded `is a` form is resolved here.
  assert.deepEqual(
    typeFindings('print is_a? 5 "bogus_type"', ["core-language"]),
    [],
  );
});

test("does not raise ol-unknown-type for an unknown callable in call position", () => {
  // A bogus command name is ol-unknown-command's job (#117), never ol-unknown-type.
  assert.deepEqual(typeFindings("(bogus_command 1)", ["core-language"]), []);
});

// --- ol-unknown-type: profile-aware type-word set ---------------------------

test("resolves the Data built-ins only when the Data profile is active", () => {
  assert.deepEqual(
    typeFindings('print :x is a "dict"', ["core-language", "data"]),
    [],
  );
  const withoutData = typeFindings('print :x is a "dict"', ["core-language"]);
  assert.equal(withoutData.length, 1);
  assert.deepEqual(withoutData[0].params, { name: "dict" });
});

test("resolves no built-in type words when Core Language is inactive", () => {
  const diagnostics = typeFindings('print :x is a "number"', []);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { name: "number" });
});

// --- ol-unknown-field: Data-deferred resolution primitive -------------------

const span = { document: "unit.logo", start: [1, 1], end: [1, 5] };

test("resolveRecordField returns undefined for a declared field", () => {
  const result = OL.resolveRecordField({
    type: "point",
    field: "x",
    declaredFields: ["x", "y"],
    write: false,
    span,
  });
  assert.equal(result, undefined);
});

test("resolveRecordField flags an unknown field read", () => {
  const result = OL.resolveRecordField({
    type: "point",
    field: "z",
    declaredFields: ["x", "y"],
    write: false,
    span,
  });
  assert.equal(result.code, "ol-unknown-field");
  assert.equal(result.stage, "semantic");
  assert.equal(result.severity, "error");
  assert.deepEqual(result.params, { type: "point", field: "z" });
  assert.deepEqual(result.source_span, span);
  assert.equal(result.message, "point has no field z. check the spelling.");
});

test("resolveRecordField flags an unknown field write with write: true", () => {
  const result = OL.resolveRecordField({
    type: "point",
    field: "z",
    declaredFields: ["x", "y"],
    write: true,
    span,
  });
  assert.deepEqual(result.params, { type: "point", field: "z", write: true });
  assert.equal(
    result.message,
    "point has no field z, and records can't grow new fields.",
  );
});

// --- ol-unknown-field: static struct-constructor field reads (issue #441) ----

const DATA = ["core-language", "data"];

const fieldFindings = (source, profiles) =>
  checkSource(source, profiles).filter((d) => d.code === "ol-unknown-field");

test("flags an unknown field read on a parenthesized struct-constructor result", () => {
  const diagnostics = fieldFindings(
    "struct point [ x y ]\nprint (point 0 0).z",
    DATA,
  );
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-unknown-field");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { type: "point", field: "z" });
  // Span points at the `.z` field segment (leading dot included), matching the runtime's own
  // ol-unknown-field span so the static and runtime halves are indistinguishable.
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [2, 18],
    end: [2, 20],
  });
  assert.equal(finding.message, "point has no field z. check the spelling.");
});

test("ignores a bare zero-argument call base that is not a struct", () => {
  // A bare 0-arity call (`xcor`) followed by `.z` parses to a postfix over a `Call` base — the
  // non-parenthesized call arm. Its callee is not a declared struct, so no field set is statically
  // known and the rule stays silent (the `ol-unknown-command` it does earn is a different rule's).
  assert.deepEqual(fieldFindings("print xcor.z", DATA), []);
});

test("leaves a declared field read on a struct-constructor result clean", () => {
  assert.deepEqual(
    fieldFindings("struct point [ x y ]\nprint (point 0 0).x", DATA),
    [],
  );
});

test("flags an unknown field read on an assignment's right-hand side", () => {
  const all = checkSource("struct point [ x y ]\n:x = (point 0 0).z", DATA);
  // Exactly one diagnostic: the RHS read is checked; the `:x` target the assignment defines is not
  // itself flagged.
  assert.equal(all.length, 1);
  assert.equal(all[0].code, "ol-unknown-field");
  assert.deepEqual(all[0].params, { type: "point", field: "z" });
});

test("stays silent on an `=` assignment target, leaving it to ol-not-a-place", () => {
  const all = checkSource("struct point [ x y ]\n(point 0 0).z = 1", DATA);
  assert.deepEqual(
    all.filter((d) => d.code === "ol-unknown-field"),
    [],
  );
  // The constructor result is not an assignable place regardless of the field, so ol-not-a-place
  // (out of this rule's scope) is the only diagnostic. (`set (point 0 0).z to 1` never reaches the
  // checker — `set` accepts only a `:name`-rooted place, so it is a parse error, not this rule's.)
  assert.equal(all.length, 1);
  assert.equal(all[0].code, "ol-not-a-place");
});

test("does not statically check a field on a variable base (runtime-authoritative)", () => {
  // The speculation boundary: inferring :p's struct type across assignments is exactly the
  // inference `spec/tooling.md:196` forbids, so `:p.z` is left entirely to the runtime (#329).
  assert.deepEqual(
    fieldFindings("struct point [ x y ]\n:p = point 0 0\nprint :p.z", DATA),
    [],
  );
});

test("does not check struct fields when the Data profile is inactive", () => {
  assert.deepEqual(
    fieldFindings("struct point [ x y ]\nprint (point 0 0).z", [
      "core-language",
    ]),
    [],
  );
});

test("checks only one level deep — a field on a field's value is left to the runtime", () => {
  // `.x` is a declared field (clean); `.foo` reads a field of x's own value, whose type is not
  // statically tracked, so it is not checked.
  assert.deepEqual(
    fieldFindings("struct point [ x y ]\nprint (point 0 0).x.foo", DATA),
    [],
  );
});

test("ignores a bracketed selector on a struct-constructor result", () => {
  // A `[key]` selector is not a `.field` access, so the field rule never fires on it.
  assert.deepEqual(
    fieldFindings("struct point [ x y ]\nprint (point 0 0)[0]", DATA),
    [],
  );
});

test("ignores a postfix whose base is a non-struct call", () => {
  // `first` is a primitive, not a declared struct, so its result has no statically known field set.
  assert.deepEqual(
    fieldFindings("struct point [ x y ]\nprint (first [1 2]).x", DATA),
    [],
  );
});

test("ignores a postfix field read on a list or dict literal base", () => {
  assert.deepEqual(fieldFindings("print [1 2].z", DATA), []);
  assert.deepEqual(fieldFindings("print {a: 1}.z", DATA), []);
});

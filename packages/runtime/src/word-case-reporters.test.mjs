import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const document = "word-case-reporters.logo";

test("word casing composes with reporters without changing the source word", () => {
  const result = execute(
    [
      ':text = "École!42"',
      'print UpPeRcAsE word :text "ß"',
      "print LOWERCASE (uppercase :text)",
      "print :text",
      'print uppercase ""',
      'print lowercase ""',
      'print lowercase "ΟΣ ΟΣΑ"',
    ].join("\n"),
    document,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values),
    [["ÉCOLE!42SS"], ["école!42"], ["École!42"], [""], [""], ["ος οσα"]],
  );
});

for (const reporter of ["uppercase", "lowercase"]) {
  test(`${reporter} propagates operand errors`, () => {
    const result = execute(`print ${reporter} :missing`, document);
    assert.deepEqual(
      result.diagnostics.map(({ code }) => code),
      ["ol-undefined-var"],
    );
  });

  test(`${reporter} rejects non-words without coercion`, () => {
    for (const [source, actual, value] of [
      ["42", "number", 42],
      ["true", "boolean", true],
      ['["logo"]', "list", ["logo"]],
    ]) {
      const result = execute(
        `print ${reporter.toUpperCase()} ${source}`,
        document,
      );
      assert.deepEqual(
        result.diagnostics.map(({ code, params, stage }) => ({
          code,
          params,
          stage,
        })),
        [
          {
            code: "ol-type",
            params: { expected: "word", actual, value, operation: reporter },
            stage: "runtime",
          },
        ],
      );
      assert.equal(
        result.events.some(({ kind }) => kind === "print"),
        false,
      );
    }
  });

  test(`${reporter} requires exactly one input before evaluating operands`, () => {
    for (const [inputs, code, actual] of [
      ["", "ol-not-enough-inputs", 0],
      [" :missing :also_missing", "ol-too-many-inputs", 2],
    ]) {
      const result = execute(`print (${reporter}${inputs})`, document);
      assert.deepEqual(
        result.diagnostics.map(({ code, params, stage }) => ({
          code,
          params,
          stage,
        })),
        [
          {
            code,
            params: { callable: reporter, expected: 1, actual },
            stage: "runtime",
          },
        ],
      );
    }
  });
}

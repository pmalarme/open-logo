import assert from "node:assert/strict";
import test from "node:test";
import { execute } from "@openlogo/runtime";

const document = "core-diagnostic-properties.logo";
const options = { instructionBudget: 32, randomSeed: 123 };
const sampleCount = 32;

function assertRuntimeError(sample, expression, target, code, params) {
  const padding = "\n".repeat(sample % 3);
  const indent = " ".repeat(sample % 7);
  const statement = `${indent}print ${expression}`;
  const source = `print "before"\n${padding}${statement}\nprint "after"`;
  const line = 2 + padding.length;
  const column = statement.indexOf(target, indent.length + "print ".length) + 1;
  assert.ok(column > 0, source);

  const result = execute(source, document, options);
  assert.deepEqual(
    result.diagnostics.map(
      ({ code, params, source_span, stage, severity }) => ({
        code,
        params,
        source_span,
        stage,
        severity,
      }),
    ),
    [
      {
        code,
        params,
        source_span: {
          document,
          start: [line, column],
          end: [line, column + target.length],
        },
        stage: "runtime",
        severity: "error",
      },
    ],
    source,
  );
  assert.deepEqual(
    result.events
      .filter(({ kind }) => kind === "print")
      .map(({ payload }) => payload.values),
    [["before"]],
    source,
  );
}

// spec/execution-model.md#numbers-and-math: "Division or `mod` by zero raises `ol-div-zero`".
test("division and mod by zero preserve the operator and expression span across operands", () => {
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const numerator = sample % 2 === 0 ? sample : -sample - 0.5;
    for (const operation of ["/", "mod"]) {
      const expression = `${numerator} ${operation} 0`;
      assertRuntimeError(sample, `(${expression})`, expression, "ol-div-zero", {
        operation,
      });
    }
  }
});

// spec/error-model.md#normative-code-registry: "`sqrt` received a negative number."
test("negative square roots carry the evaluated value and call span across inputs", () => {
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const value = -sample - 0.5;
    const expression = `sqrt ${value}`;
    assertRuntimeError(sample, expression, expression, "ol-neg-sqrt", {
      value,
    });
  }
});

// spec/commands.md#random: "a non-whole bound raises `ol-type`; then ... `a` greater than `b` raises `ol-range`."
test("random rejects a fractional upper bound before checking range order", () => {
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const low = sample + 10;
    const high = sample + 1;
    const fractionalHigh = high + 0.5;
    assertRuntimeError(
      sample,
      `(random ${low} ${fractionalHigh})`,
      String(fractionalHigh),
      "ol-type",
      {
        expected: "whole number",
        actual: "number",
        value: fractionalHigh,
        operation: "random",
      },
    );
    const reversedRange = `(random ${low} ${high})`;
    assertRuntimeError(sample, reversedRange, reversedRange, "ol-range", {
      operation: "random",
      low,
      high,
    });
  }
});

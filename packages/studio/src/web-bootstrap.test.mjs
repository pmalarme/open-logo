import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

const { DEFAULT_RUN_PROGRAM, formatDiagnosticsSummary } = OL;

test("DEFAULT_RUN_PROGRAM is the canonical acceptance square", () => {
  assert.equal(DEFAULT_RUN_PROGRAM, "repeat 4 [ forward 100 right 90 ]");
});

test("formatDiagnosticsSummary reports a fixed message for an empty list", () => {
  assert.equal(formatDiagnosticsSummary([]), "No diagnostics.");
});

test("formatDiagnosticsSummary renders one line per diagnostic", () => {
  const diagnostics = [
    {
      code: "ol-unknown-command",
      source_span: {
        document: "studio-session",
        start: [1, 1],
        end: [1, 8],
      },
      params: { name: "forward" },
      message: "OpenLogo doesn't know the command 'forward' here.",
      stage: "semantic",
      severity: "error",
    },
    {
      code: "ol-style-todo",
      source_span: {
        document: "studio-session",
        start: [2, 1],
        end: [2, 4],
      },
      params: {},
      message: "Style nit.",
      stage: "semantic",
      severity: "warning",
    },
  ];

  assert.equal(
    formatDiagnosticsSummary(diagnostics),
    "ol-unknown-command (error): OpenLogo doesn't know the command 'forward' here.\n" +
      "ol-style-todo (warning): Style nit.",
  );
});

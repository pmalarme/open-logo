// Regression tests for the **precedence** half of *one fault, one diagnostic*
// (`spec/execution-model.md:750-777`), at the boundary its own doc comment promises: a token whose
// ONLY fault is following an unresolvable callee is suppressed, and nothing else is.
//
// The cross-document case is here because the owning agent for this package demonstrated it was
// broken: every position was keyed `"line:column"` with the `source_span.document` dropped, so a
// perfectly valid `ol-bad-token` in one source was suppressed because a *different* source happened
// to carry an orphan at the same line and column. That is a silently discarded diagnostic inside a
// slice whose entire subject is never silently discarding one.
//
// It is a supported input shape rather than a hypothesis: `applyOneFaultRules` is exported (see
// `index.ts`) precisely so a caller assembling findings itself can apply it, and
// `spec/error-model.md:126` says either span "MAY name a different source document, so an imported module's declaration is an ordinary case".
// `@openlogo/core`'s `faultIdentity` already keys de-duplication on the document; these tests pin
// the precedence half agreeing with it.

import assert from "node:assert/strict";
import test from "node:test";

import { applyOneFaultRules, parse } from "@openlogo/parser";

/** A finding at one position, with the document explicit. */
function finding(code, document, line, column, params) {
  return {
    code,
    source_span: {
      document,
      start: [line, column],
      end: [line, column + 3],
    },
    params,
    message: `${code} ${JSON.stringify(params)}`,
    stage: code === "ol-bad-token" ? "parse" : "semantic",
    severity: "error",
  };
}

const ORPHAN_PROGRAM = parse("fowad 100\n", "a.logo").ast;

test("the orphaned token beside an unresolvable callee is suppressed", () => {
  const kept = applyOneFaultRules(ORPHAN_PROGRAM, [
    finding("ol-unknown-command", "a.logo", 1, 1, { name: "fowad" }),
    finding("ol-bad-token", "a.logo", 1, 7, { text: "100" }),
  ]);
  assert.deepEqual(
    kept.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
  );
});

test("an identical position in a DIFFERENT document is not suppressed", () => {
  // The regression. Both `ol-bad-token`s sit at 1:7; only the one in the document that actually has
  // the unresolvable callee is the orphan. Keying without the document suppressed both.
  const kept = applyOneFaultRules(ORPHAN_PROGRAM, [
    finding("ol-unknown-command", "a.logo", 1, 1, { name: "fowad" }),
    finding("ol-bad-token", "a.logo", 1, 7, { text: "100" }),
    finding("ol-bad-token", "b.logo", 1, 7, { text: "999" }),
  ]);
  assert.deepEqual(
    kept.map((diagnostic) => [
      diagnostic.code,
      diagnostic.source_span.document,
    ]),
    [
      ["ol-unknown-command", "a.logo"],
      ["ol-bad-token", "b.logo"],
    ],
    "a token in another source is not this program's orphan",
  );
});

test("an unresolvable callee in a different document does not create orphans here", () => {
  // The same asymmetry from the other side: the `ol-unknown-command` naming `b.logo` must not make
  // `a.logo`'s token an orphan. With the document dropped from the key it did.
  const kept = applyOneFaultRules(ORPHAN_PROGRAM, [
    finding("ol-unknown-command", "b.logo", 1, 1, { name: "fowad" }),
    finding("ol-bad-token", "a.logo", 1, 7, { text: "100" }),
  ]);
  assert.equal(
    kept.length,
    2,
    "neither finding is the other's orphan across documents",
  );
});

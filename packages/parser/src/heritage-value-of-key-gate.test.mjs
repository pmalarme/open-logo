// Unit tests for the Heritage `value of <dict> for key <key>` reader profile gate — slice H5
// (issue #670) of the Heritage epic. The four-keyword reader `value-of-reader`
// (spec/grammar.md:215) is a Heritage spelling of the Core dict read `:d[:k]`/`:d.key`
// (spec/conformance.md:273), and because it operates on a dict it also needs the Data profile
// (spec/conformance.md:301). Parsing of the form itself (into a `ValueOfKey` node) landed with
// issue #322 and is covered by `value-of-key.test.mjs`; this file targets the *profile gate* added
// by H5 in `checker-heritage-form.ts`:
//
//   - with Heritage INACTIVE (Core only), the reader is rejected with `ol-unknown-command` at the
//     `value` head word, carrying NO did-you-mean (its Core equivalent is the `[]`/`.` selector
//     *syntax*, not a single word — the `ol-unknown-command` no-candidate branch,
//     spec/error-model.md:96);
//   - with Heritage (and Data) ACTIVE, the reader is accepted silently.
//
// The gate must see the reader wherever it appears — top level, nested in blocks, inside `repeat`,
// inside a procedure body — so a form that only works at the top level cannot silently invent a
// semantic difference (the awkward-position discipline H2/H4 reviewers enforced).
//
// The `value`-head findings are isolated with a `.filter(byValueHead)` so an unrelated
// `ol-undefined-var` on a bare `:ages` never masks (or inflates) the gate's own count.
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per @openlogo/core.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "heritage-value-of-key.logo";
const span = (start, end) => ({ document: doc, start, end });

// Heritage depends on Data (spec/conformance.md:301), so the "active" set claims both. Data also
// makes dict literals (`{ … }`) legal so the fixtures can build a dict to read from.
const HERITAGE_ACTIVE = ["core-language", "data", "heritage"];
const CORE_AND_DATA = ["core-language", "data"];

const byValueHead = (d) =>
  d.code === "ol-unknown-command" && d.params.name === "value";

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

function checkSource(source, profiles) {
  const ast = parseClean(source);
  return OL.check(ast, { profiles }).diagnostics;
}

/** Just the gate's own `value`-head findings, ignoring unrelated undefined-var noise. */
function gateFindings(source, profiles) {
  return checkSource(source, profiles).filter(byValueHead);
}

// ---------------------------------------------------------------------------
// Rejected without Heritage (even when Data is active — Data alone is not enough)
// ---------------------------------------------------------------------------

test("without Heritage, `value of … for key` is rejected at the `value` head with no suggestion", () => {
  const findings = gateFindings(
    'print value of :ages for key "tom"\n',
    CORE_AND_DATA,
  );
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.code, "ol-unknown-command");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { name: "value" });
  assert.equal(
    finding.message,
    "i don't know how to value. check the spelling, or define it with 'define'.",
  );
  // `print ` is 6 columns, so `value` spans columns 7..11 (half-open end at 12).
  assert.deepEqual(finding.source_span, span([1, 7], [1, 12]));
});

test("Data alone (Heritage inactive) still rejects the reader — it is a Heritage spelling", () => {
  assert.equal(
    gateFindings('print value of :ages for key "tom"\n', [
      "core-language",
      "data",
    ]).length,
    1,
  );
});

// ---------------------------------------------------------------------------
// Accepted with Heritage + Data active
// ---------------------------------------------------------------------------

test("Heritage active accepts `value of … for key` — no `value`-head finding", () => {
  assert.deepEqual(
    gateFindings('print value of :ages for key "tom"\n', HERITAGE_ACTIVE),
    [],
  );
});

// ---------------------------------------------------------------------------
// Awkward positions: the gate must fire (Core) / stay silent (Heritage) everywhere
// ---------------------------------------------------------------------------

test("the reader is gated inside an inline `[ … ]` block / `repeat`", () => {
  const source = 'repeat 1 [print value of :ages for key "tom"]\n';
  assert.equal(gateFindings(source, CORE_AND_DATA).length, 1);
  assert.deepEqual(gateFindings(source, HERITAGE_ACTIVE), []);
});

test("the reader is gated inside a `define` procedure body", () => {
  const source = 'define lookup :d\n  print value of :d for key "tom"\nend\n';
  assert.equal(gateFindings(source, CORE_AND_DATA).length, 1);
  assert.deepEqual(gateFindings(source, HERITAGE_ACTIVE), []);
});

test("the reader stays silent inside a Heritage `to … end` body when Heritage is active", () => {
  const source = 'to lookup :d\n  print value of :d for key "tom"\nend\n';
  assert.deepEqual(gateFindings(source, HERITAGE_ACTIVE), []);
});

test("every occurrence in a program is reported once each without Heritage", () => {
  const source =
    'print value of :ages for key "tom"\nprint value of :ages for key "sue"\n';
  assert.equal(gateFindings(source, CORE_AND_DATA).length, 2);
});

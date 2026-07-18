# 10. Conformance harness parser integration (M1 update)

- Status: Accepted
- Date: 2026-07-18
- Deciders: OpenLogo maintainer (@pmalarme) + testing
- Supersedes: ADR-0007 decision #2 (placeholder `produce()`)
- Related: ADR-0007 (conformance harness); issue #44 (M1 harness + fixture format);
  [`spec/error-model.md`](../../spec/error-model.md) (diagnostic shape)

## Context

ADR-0007 shipped the conformance harness with a placeholder `produce(source, profiles)` that returned
`{ events: [], diagnostics: [] }` because `@openlogo/runtime` did not exist yet. Issue #9 delivered
`@openlogo/parser` (merged to main at SHA 55695b8, 2026-07-18), and issue #44 asks to wire the real
parser into the harness so conformance fixtures can assert parser behavior (parse diagnostics with
stable `ol-*` codes, source spans, and params per `spec/error-model.md`).

The parser is now the first production implementation artifact. Conformance fixtures can prove it
works, but only if `produce()` calls it instead of returning empty output.

## Decision

Replace the placeholder `produce()` with a real parser integration for M1.

1. **`produce(source, document)` calls `@openlogo/parser`.** It invokes
   `parse(source, document)` and returns `{ events: [], diagnostics }`, where `diagnostics` is the
   array of parse diagnostics emitted by the parser. The `document` parameter is the fixture path,
   which the parser uses in every diagnostic's `source_span.document` field. Events remain empty
   until the runtime lands.

2. **Validate actual diagnostics against the spec shape.** Per `spec/error-model.md:28-38`, every
   diagnostic must have a `message` field. `produce()` validates this requirement by calling
   `validateDiagnostics(diagnostics)` after parsing, which throws if any diagnostic is missing the
   field. This enforces the wire contract without coupling fixtures to English prose — fixtures omit
   `message` (they assert identity via `code` + `params` per error-model.md:193-194), and comparison
   excludes `message` value, but actual emitted diagnostics are validated for spec conformance.

3. **Wire format is pass-through.** The parser already emits diagnostics with `source_span`
   (underscore, matching `spec/error-model.md`), so no conversion is needed. When events land,
   `source-span` (hyphen) per `spec/execution-model.md` will be the runtime's responsibility, not
   the harness.

4. **Extend the corpus with a parser-proving fixture.** Add
   `tests/conformance/core-language/literals/unterminated-string.{logo,expected.json}` that asserts
   an `ol-unclosed-string` diagnostic on `"unclosed` source. This proves `produce()` invokes the
   real parser and the fixture format can assert parse-time behavior. The fixture omits the
   `message` field (canonical format per `shared/conformance-fixture` skill) to avoid coupling to
   English text.

## Consequences

- `npm run conformance` now validates real parser behavior: 3 parser fixtures (assign-and-print,
  empty-program, unterminated-string) plus 1 mismatch self-test (detects-mismatch), total 4 passed,
  exit 0. A real parser defect (wrong diagnostic code, missing span, etc.) exits non-zero with a
  diff.
- The corpus can grow as production stories (#46–#65) add Core Language features: each story extends
  the fixtures to assert its behavior via the now-real `produce()`.
- The validation layer (`validateDiagnostics()`) enforces spec/error-model.md wire requirements
  while keeping fixtures independent of localizable prose, honoring the "diagnostic identity is code
  + params, not message" design (error-model.md:191–194).
- ADR-0007's mechanics (discovery, profile-DAG selection, self-tests, diffing, exit codes) are
  unchanged; only `produce()` evolved from placeholder to real parser integration.

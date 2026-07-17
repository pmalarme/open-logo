---
name: diagnostics
description: >-
  How to emit OpenLogo diagnostics correctly — the normative shape, stable ol-* codes, source
  spans, stages, severity, and did-you-mean — instead of ad-hoc error strings. Use in any parser,
  semantic-analysis, or runtime error path.
created: 2025-06-01T00:00
updated: 2025-06-01T00:00
---

## Purpose

Every OpenLogo error a learner sees must be a structured, stable diagnostic — friendly, precise, and
testable. Diagnostics are owned by `@openlogo/core` and asserted by conformance fixtures.

## Normative shape (from `spec/error-model.md`)

A diagnostic carries:

- **code** — a stable identifier: `ol-*` for errors/semantics, `ol-style-*` for style lints. Codes
  never change meaning once shipped.
- **source_span** — start (and end) line/column into the source.
- **params** — structured values used to render the message (e.g. the bad token, the expected arity).
- **message** — the learner-facing text, generated from code + params (localizable).
- **stage** — `parse`, `semantic`, or `runtime`.
- **severity** — error / warning / info (style lints are typically warning/info).
- **debug** — optional extra detail for tooling, off by default for learners.

## Rules

- **Register every code once** in the `@openlogo/core` diagnostic registry. Never throw bare strings
  or `Error("...")` for language errors.
- Attach an accurate **span** — the studio underlines exactly this range.
- Provide **did-you-mean** where the spec defines it (unknown command/variable close to a known
  name). Keep suggestions deterministic.
- Messages are **kind and concrete**: say what was expected and where, never "syntax error".
- Pick the right **stage**: unknown token = parse; wrong arity/undefined name/ type mismatch caught
  before running = semantic; division by zero / runtime bounds = runtime.

## Procedure

1. Choose or add a code in the `@openlogo/core` registry with its param schema and message template.
2. At the error site, construct the diagnostic with code + span + params (no inline prose).
3. Add a **negative conformance fixture** asserting the exact code, stage, and span
   (`shared/conformance-fixture`).
4. If the message is new/changed, notify `@documentation` and (if learner-facing wording)
   `@ai-tutor`/`@curriculum`.

## Example

Program `forward` (missing input) →

```json
{ "code": "ol-arity", "stage": "semantic", "severity": "error",
  "source_span": { "line": 1, "col": 1 },
  "params": { "name": "forward", "expected": 1, "got": 0 },
  "message": "forward needs 1 input (a distance), but none was given." }
```

(Use the actual code assigned in `spec/error-model.md`; `ol-arity` is illustrative.)

## Checklist
- [ ] Code registered in `@openlogo/core`; no ad-hoc strings.
- [ ] Accurate span + structured params (not string-interpolated).
- [ ] Correct stage + severity.
- [ ] Did-you-mean where the spec defines it.
- [ ] Negative fixture asserts code/stage/span.

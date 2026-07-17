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

- **code** — a stable identifier from the **normative registry** in `spec/error-model.md`: `ol-*` for
  parse/semantic/runtime errors, `ol-style-*` for style lints. Codes never change meaning once shipped.
- **source_span** — a source document plus a character range (or equivalent line/column range).
- **params** — structured values used to render the message (e.g. the bad token, the expected arity).
  `params` are part of the diagnostic identity; empty object is allowed.
- **message** — the learner-facing text, generated from code + params (localizable). Tools MUST NOT
  parse the English message.
- **stage** — `parse`, `semantic`, or `runtime`.
- **severity** — `error` or `warning` **only** (style lints are `warning`). There is no `info`.
- **debug** — optional extra detail for tooling, off by default for learners.

## Rules

- **Use codes from the normative registry** (`spec/error-model.md`). The `ol-*` namespace is
  **reserved by the spec** — never invent an `ol-*` code in implementation code; a genuinely new code
  is a spec change (maintainer-owned). Vendor-specific extensions MUST use a non-`ol-*` namespace.
  Register each code once in the `@openlogo/core` registry; never throw bare strings or `Error("...")`.
- Attach an accurate **span** — the studio underlines exactly this range.
- Provide **did-you-mean** where the spec defines it (unknown command/variable close to a known
  name). Keep suggestions deterministic.
- Messages are **kind and concrete**: say what was expected and where, never "syntax error".
- Pick the right **stage**: unknown token = parse; wrong arity/undefined name/ type mismatch caught
  before running = semantic; division by zero / runtime bounds = runtime.

## Procedure

1. Look up the code in the normative registry (`spec/error-model.md`) with its param schema and
   message template. Do not invent `ol-*` codes — a new one is a maintainer-owned spec change.
2. At the error site, construct the diagnostic with code + source_span + params (no inline prose).
3. Add a **negative conformance fixture** asserting the exact code, stage, and span
   (`shared/conformance-fixture`).
4. If the message is new/changed, notify `@documentation` and (if learner-facing wording)
   `@ai-tutor`/`@curriculum`.

## Example

Program `forward` (missing input) →

```json
{ "code": "ol-not-enough-inputs", "stage": "semantic", "severity": "error",
  "source_span": { "document": "main.logo", "start": [1, 1], "end": [1, 8] },
  "params": { "callable": "forward", "expected": 1, "actual": 0 },
  "message": "forward needs 1 input (a distance), but none was given." }
```

(`ol-not-enough-inputs` and its `callable`/`expected`/`actual` params are the normative code from
`spec/error-model.md`.)

## Checklist
- [ ] Code registered in `@openlogo/core`; no ad-hoc strings.
- [ ] Accurate span + structured params (not string-interpolated).
- [ ] Correct stage + severity.
- [ ] Did-you-mean where the spec defines it.
- [ ] Negative fixture asserts code/stage/span.

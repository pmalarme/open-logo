---
name: syntax-checking
description: >-
  How to build the OpenLogo syntax + semantic checker (the linter/validator, not the highlighter) in
  @openlogo/parser from spec/tooling.md's three layers — parse, semantic, and style lints — emitting
  C10 `ol-*`/`ol-style-*` diagnostics. Use for validation, error reporting, "check" mode, and LSP diagnostics.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Highlighting makes code *readable*; **checking makes it correct.** This is the validator that tells a
learner *what is wrong and how to fix it* — the highest-leverage teaching surface after the turtle.
It is a separate concern from `syntax-highlighting`.

## The three normative layers (`spec/tooling.md`)

1. **Layer 1 — lex & parse checking** (`stage=parse`): structural errors, with recovery so multiple
   independent findings surface in one pass. Codes: `ol-unmatched-bracket`/`-brace`/`-paren`,
   `ol-missing-end`, `ol-mismatched-end`, `ol-unclosed-comment`, `ol-unclosed-string`, `ol-bad-token`
   (incl. commas — OpenLogo has none).
2. **Layer 2 — semantic checking** (`stage=semantic`, after alias/import pre-pass + procedure/struct
   registration, using the **active profile set**): `ol-unknown-command` (with did-you-mean,
   Levenshtein ≤2), `ol-not-enough-inputs`/`-too-many-inputs`, `ol-undefined-var`, `ol-reserved-word`,
   `ol-unknown-type`/`-field`, `ol-not-a-place`, `ol-no-value`, `ol-return-outside-proc`/
   `-in-comprehension`, `ol-duplicate-binder`. Also report *statically knowable* runtime codes
   (`ol-type`, `ol-range`, `ol-not-boolean`) — but never speculate on unknown dynamic values.
3. **Layer 3 — style lints** (`severity=warning`, `ol-style-*`): `ol-style-full-name`,
   `ol-style-equality-confusion`, `ol-style-magic-number`, `ol-style-hidden-abstraction`, etc., sourced
   from `spec/style-guide.md`. May be user-disabled; code identity stays stable when enabled.

## Rules

- **Every finding uses the C10 shape** (`shared/diagnostics`): stable `code`, `source_span`, `params`,
  localizable `message`, `stage`, `severity`, optional `debug`. Identity is the code, never the prose.
- **Never invent a non-style code** when a C10 code applies; vendor rules are namespaced
  (`vendor.ol-*`) and never required for conformance.
- **Profile-aware:** a name unknown in the active profiles is `ol-unknown-command`, not a hard crash.
- **LSP parity:** `publishDiagnostics` and `codeAction` (e.g. `fd`→`forward`, add missing `end`,
  `=`→`==` in a condition) MUST preserve the same codes/spans/params a batch checker produces.

## Procedure

1. Emit findings from `parser` (`check.ts`), reusing the reader/AST — do not re-lex with regex.
2. Cover each row of the Layer 1/2 tables with a fixture (source → expected code + span + params),
   including the worked examples in `tooling.md` (`repeat 4 forward 100` → `ol-missing-end`; `fowad
   100` → `ol-unknown-command`).
3. Hand the same diagnostics to `@openlogo/studio` for inline display and to `@testing` for negative
   fixtures.

## Checklist
- [ ] All three layers implemented; findings use C10 codes from `core`, not ad-hoc strings.
- [ ] Semantic layer is profile-aware; did-you-mean uses Levenshtein ≤2.
- [ ] Style lints are warnings with stable `ol-style-*` codes.
- [ ] Batch and LSP paths produce identical codes/spans/params; fixtures cover the tables.

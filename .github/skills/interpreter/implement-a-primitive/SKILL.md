---
name: implement-a-primitive
description: >-
  How @interpreter implements an OpenLogo primitive/command end to end across @openlogo/core, parser,
  and runtime — signature from spec/commands.md, evaluation from execution-model.md, diagnostics from
  error-model.md, plus trace events and fixtures. Use for any new command or built-in.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Turn a spec command into working, conformant, deterministic behavior — the core loop of the whole
build. Every primitive lands with its diagnostics, trace events, and fixtures in one vertical slice.

## Procedure

1. **Read the signature** in `spec/commands.md` (C3 arity/types) and the behavior in
   `spec/execution-model.md`. Note the profile — implement in DAG order (Core → Turtle & Rendering …).
2. **Values + types** in `@openlogo/core`: ensure the argument/return types exist (`number`, `word`,
   `list`, `boolean`; `dict`/`struct` for Data). Reuse the shared equality/coercion rules.
3. **Parse/AST** with `@language-designer` if new syntax is involved (`interpreter/ast-design`);
   most primitives are ordinary prefix `Call` nodes.
4. **Evaluate** in `@openlogo/runtime`: implement the effect, honor scoping, and run under the
   **cancellable execution budget**. Keep it deterministic and headless.
5. **Emit trace events** (registered in `core`) for any observable effect so `@openlogo/turtle` and
   `@openlogo/studio` can react — never draw or animate from the runtime.
6. **Diagnostics** via `shared/diagnostics`: wrong arity/type/etc. use stable `ol-*` codes with spans
   and did-you-mean — never ad-hoc strings.
7. **Fixtures** via `shared/conformance-fixture`: source → expected events/diagnostics, including
   negative cases. Extend, don't fork, the suite; keep it green.

## Critical rules

- Honor exact vocabulary: `forward`/`back`/`left`/`right`, `define … end`/`return`, `=`/`set … to`,
  `==` compares; Heritage aliases (`fd`, `to`, `make`) share the same semantics.
- Runtime is deterministic + headless; animation and rendering live elsewhere.
- `parser`/`runtime` use `core`'s public API, not its internals.

## Checklist
- [ ] Signature + behavior + profile taken from the spec.
- [ ] Effect + budget + trace events in runtime; types in core.
- [ ] `ol-*` diagnostics with spans; positive + negative fixtures pass.
- [ ] No rendering in runtime; clean package boundaries.

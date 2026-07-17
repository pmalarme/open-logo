---
name: spec-fidelity
description: >-
  How to keep OpenLogo code faithful to the merged spec — the canonical vocabulary (not classic
  Logo) plus a verification checklist to run before writing code and before opening a PR. Use in
  every parser, runtime, docs, curriculum, or test change.
created: 2025-06-01T00:00
updated: 2025-06-01T00:00
---

## Purpose

The `spec/` directory is normative and maintainer-owned. This skill is the fast reference for
matching it exactly and catching the common "classic Logo" mistakes.

## Canonical vocabulary (v0.1)

| Concept | Canonical (Core) | NOT this |
|---|---|---|
| Procedure def | `define … end` with `return` | `to … end` / `output` (those are **Heritage**) |
| Move/turn/pen | `forward`/`back`/`left`/`right`/`pen_up`/`pen_down` (underscored names primary) | `fd`/`bk`/`lt`/`rt`/`pu`/`pd` (**Heritage** aliases) |
| Assign | `<place> = <value>` or `set <place> to <value>` | `make` (**Heritage**) |
| Compare | `==`, `!=`, `<`, `>`, `<=`, `>=` (chainable: `1 < :x < 10`) | using `=` to compare |
| Variable ref | `:name`, nested places `:people.tom.age` | `$name`, arrays |
| Values | `number`, `word` (`"red"`), `list` `[ ]`, `boolean` | null; `dict`/`struct` need the **Data** profile |
| Blocks | `[ … ]` inline or `… end` multiline (always delimited) | significant whitespace |
| Control | `if`, `while`, `repeat`, `forever`, `for … in`, `for … from … to` | — |
| Comprehensions | `map`, `filter`, `reduce` (bracketed expression body) | lambda / first-class procedures |
| Output | `print`, `show` (Core, non-interactive) | `input` (that's **Interaction & Events**) |

## Hard rules (from `spec/README.md` non-goals)

- Lowercase keywords, light punctuation. **No commas, no `f(x,y)` call syntax, no arrays, no lambda,
  no significant whitespace** in v0.1.
- **Geometry is discoverable OpenLogo source** (Geometry profile) — `polygon` etc. are written in
  `.logo` from `repeat`/turns/`define`. Only `grid`/`axes`/`measure` are renderer-backed. Never add
  hidden drawing shortcuts that bypass the learner discovering `repeat`, turns, and procedures.
- Heritage/Localization are **alternate spellings only** — they add no new semantics.
- Every feature belongs to exactly one **profile**; respect the dependency DAG and the minimal path
  **Core Language → Turtle & Rendering** (`spec/conformance.md`).

## Procedure

1. **Before coding**, open the owning spec file(s) and the C3 row in `spec/commands.md`; note the
   exact name, kind (command/reporter/special form), arity, args, result, and errors.
2. **Name things exactly** as the spec does; if you need an alias, confirm it is Heritage/Localization.
3. **Diagnostics** use stable `ol-*` codes only (`shared/diagnostics`), never ad-hoc strings.
4. **Before opening a PR**, run the checklist below.

## Pre-PR checklist
- [ ] Canonical Core names used; Heritage aliases marked as aliases, not Core.
- [ ] `=` assigns, `==` compares; `:name` variables; `define … end` for procedures.
- [ ] Feature assigned to the correct profile; dependencies honored.
- [ ] No commas / lambda / arrays / hidden drawing shortcuts introduced.
- [ ] Behavior matches the exact C3 signature and error cases.

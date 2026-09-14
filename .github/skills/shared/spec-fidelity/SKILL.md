---
name: spec-fidelity
description: >-
  How to keep OpenLogo code faithful to the merged spec — the canonical vocabulary (not classic
  Logo) plus a verification checklist to run before writing code and before opening a PR. Use in
  every parser, runtime, docs, curriculum, or test change. Owns the citation convention: cite the
  spec by section anchor, not by line.
created: 2025-06-01T00:00
updated: 2026-09-14T00:00
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

## Citing the spec — by section anchor, not by line

**Write `spec/<file>.md#a-heading`.** A heading does not move when text is inserted above it; a line
number does, so every `spec/` edit used to drag a mechanical re-pointing pass behind it. An anchor
is not unbreakable — it breaks when its heading is renamed or removed, and where the file has
duplicate headings another one can inherit your slug and retarget the citation **silently**, since
it still resolves — but all of those are rarer and more deliberate than inserting a paragraph. The
decision, the measured churn and the rejected alternatives are in
[ADR-0034](../../../../docs/adr/0034-cite-the-spec-by-section-anchor.md).

- **Default:** the anchor alone — `spec/conformance.md#educational`.
- **A line number only where line precision is genuinely required** (one production, one table row,
  one sentence) — and then **write the anchor too**, so the durable half survives the next spec
  edit. A bare `spec/<file>.md:<line>` citation is the legacy form: still valid, still gated, no
  longer the default. Do not mass-convert existing ones; convert a file's citations when you are in
  it for other work.
- **Quote the words you rely on** where it is natural — the anchor, then the fragment your claim
  rests on in quotation marks. Recommended, not required.
- **Keep a citation on one line**, even if the line runs long. Anchors are long, and an anchor split
  by a line wrap becomes a different, non-existent one — a site in this tree already reads as
  `#collections-`. Today that passes unseen; after #1181 it fails.
- **`#L30` / `#L28-L84` is not an anchor.** GitHub's line fragment is a line claim in anchor
  clothing: it names a position, not a section, and drifts exactly the way a line number does. Not
  the durable form.

**What the gate proves.** Anchor resolution is slice #1181 and **does not exist yet**: today
`npm run spec-citations` enumerates an anchor as a mention and never resolves it, so a renamed or
misspelled heading passes unseen. When #1181 lands, the gate reads the headings of the file an
anchor names and fails when none matches — proving **the heading exists and nothing more**. A
resolving anchor does **not** mean the section supports the claim beside it, and a quote check
proves the words are still present, not that they mean what your sentence says — the wrong-passage
and misstating-prose modes survive an anchor exactly as they survived a line number. Read the
coverage statement the gate prints; never read a green run as "every citation is right".

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
- [ ] New citations name a section anchor; any line number carries its anchor beside it.

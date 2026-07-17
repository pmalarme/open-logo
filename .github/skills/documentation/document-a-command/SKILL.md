---
name: document-a-command
description: >-
  How @documentation writes/updates a command reference entry, tutorial, or example so docs never drift
  from the spec or runtime — signature from spec/commands.md, runnable validated examples, profile +
  level noted. Use for reference docs, tutorials, and examples. Docs sync every slice.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Keep OpenLogo's docs accurate and runnable. Documentation follows the implementation in the same
vertical slice, so the reference always matches real behavior.

## Procedure

1. **Source of truth:** signature from `spec/commands.md` (C3), behavior from `spec/execution-model.md`,
   errors from `spec/error-model.md`. Note the **profile** and the **learner level** it belongs to.
2. **Write the entry:** one-line summary, signature, arguments/return, behavior, `ol-*` errors it can
   raise, and see-also links. Use canonical vocabulary (`shared/spec-fidelity`).
3. **Runnable example:** minimal canonical OpenLogo that demonstrates the command; mark Heritage
   spellings as aliases, not the primary form.
4. **Validate examples against the runtime** (same harness as `@testing`) and highlight code blocks with
   the parser's classifier (`language-designer/syntax-highlighting`) so docs match real tokens.
5. **Sync on change:** when grammar/semantics change, update the affected entries in the **same PR** —
   docs are part of the slice's Definition of Done, not a follow-up.

## Critical rules

- Every code sample runs and is validated — no illustrative-but-wrong snippets.
- Canonical lowercase forms are primary; Heritage aliases clearly labeled.
- Docs update with the code that changed them, never later.

## Checklist
- [ ] Signature/behavior/errors sourced from the spec; profile + level noted.
- [ ] Example is runnable + validated; highlighting via the parser classifier.
- [ ] Heritage aliases labeled; canonical forms primary.
- [ ] Updated in the same PR as the grammar/semantics change.

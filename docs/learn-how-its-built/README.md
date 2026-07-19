# Learn How It's Built

You've drawn with the turtle. Now: how does OpenLogo itself actually work? This series is for
learners who finished the turtle basics and want to open the hood — programming a language, not
just in one.

Every doc here is grounded in the real, shipped code: it points you to the actual files and tests
behind each claim, and every `.logo` sample really runs against the current runtime. No
hand-waving.

**Part of epic [#212](https://github.com/pmalarme/open-logo/issues/212).**

## The set

Suggested reading order — front of the pipeline, to the back, then the workflow, then the story
of how we got here:

| # | Doc | What it covers | Status |
|---|---|---|---|
| 1 | pipeline overview ([#224](https://github.com/pmalarme/open-logo/issues/224)) | From `.logo` text to a moving turtle — the whole pipeline in one picture | planned |
| 2 | the lexer & tokens ([#223](https://github.com/pmalarme/open-logo/issues/223)) | How OpenLogo reads your letters into words | planned |
| 3 | grammar, the reader & the AST ([#220](https://github.com/pmalarme/open-logo/issues/220)) | Turning tokens into a tree | planned |
| 4 | the interpreter & runtime ([#221](https://github.com/pmalarme/open-logo/issues/221)) | How the tree becomes actions | planned |
| 5 | highlighting & the checker ([#226](https://github.com/pmalarme/open-logo/issues/226)) | Coloring code and finding mistakes | planned |
| 6 | how we build OpenLogo ([#219](https://github.com/pmalarme/open-logo/issues/219)) | Epics, slices, milestones, the agent team, CI & the Definition of Done | planned |
| 7 | [M0 & M1 retrospective](m0-m1-retrospective.md) ([#222](https://github.com/pmalarme/open-logo/issues/222)) | What we actually shipped in the first two milestones, and how | **done** |

## Ground rules for this series

- **Plain language first, real names second.** Every idea gets explained in kid-friendly terms
  before we show the exact OpenLogo keyword or file.
- **Canonical OpenLogo vocabulary.** Lowercase keywords, `define … end` (not `to`),
  `forward`/`right`/... (not `fd`/`rt`) — any classic-Logo "Heritage" spelling is explicitly
  labeled as such, never presented as the primary form.
- **Every sample runs.** Every `.logo` snippet in this series is validated against the current
  runtime before it's published — no invented syntax.
- **No drift.** Each doc is technically reviewed by the domain agent who owns that part of the
  codebase, and updated whenever the underlying grammar, semantics, or commands change.

See [`AGENTS.md`](../../AGENTS.md), [`docs/architecture.md`](../architecture.md), and
[`docs/delivery.md`](../delivery.md) for the engineering context this series draws on.

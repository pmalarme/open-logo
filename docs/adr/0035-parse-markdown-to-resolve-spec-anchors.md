# 35. Parse markdown to resolve spec section anchors

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** @pmalarme (maintainer), @orchestrator, @testing
- **Related:** refines [ADR-0005](0005-toolchain.md); builds on
  [ADR-0034](0034-cite-the-spec-by-section-anchor.md) and
  [ADR-0022](0022-documentation-example-gate.md)

## Context

[ADR-0034](0034-cite-the-spec-by-section-anchor.md) made `spec/<file>.md#a-heading` the preferred way
to cite the normative spec, because a heading anchor does not move when text is inserted above it.
Issue #1181 had to make the citation gate **resolve** that form before the convention recommended it:
an unchecked preferred form is worse than the fragile one it replaces.

Resolving an anchor needs two things — the list of headings a document publishes, and the fragment
each is reachable at. The first implementation computed both by hand, reading the document
line-by-line and reimplementing GitHub's slug rule. It was reviewed over **nine rounds** by three
non-author reviewers, and defeated in eight of them, each time by a construct the previous round had
not considered:

| round | what got through, and why it was quiet |
|---|---|
| 3 | HTML blocks opened by `</div>`, `<![CDATA[`, `<?xml`; hex entities; nested-label links |
| 4 | `_` emphasis — which carries no flagged character, and slips through *because* the slug rule keeps `_` so that `` `set_xy` `` is right |
| 5 | `²` — the permit-list was built from `\p{L}\p{N}`, the slug rule's own classes, so it validated the subject against itself |
| 6 | code-span **contents** bypassed the permit-list: `` `m²` `` |
| 7 | container markers *inside* a fence read as closers; tab-indented containers |
| 8 | a fence opened on a list-item **continuation** line |

Every one was the **quiet** direction: the reader invented a slug GitHub does not publish, so citing
the invented one resolved locally and 404'd on GitHub, with no failure anywhere.

Round 8 was decisive. The refusal added to close the container case was justified by *"`spec/` has
none, so it costs nothing"* — and that was **false**: it keyed on a container marker being on the
fence line, while `spec/execution-model.md` uses the continuation spelling at lines 104 and 117.
Re-keying it on real container context would have refused that document, which roughly forty live
anchors point into, turning `npm run spec-citations` red with no route to green except a mass
citation edit that saga #1180 explicitly forbids. The cheap fix was wrong and the correct fix was
unavailable.

Two of three reviewers independently concluded the same thing: *which lines a fenced block covers is
inherited block state, not a property of a line*, so no further pattern closes the class. That is
precisely what CommonMark's container/leaf-block algorithm exists to encode.

## Decision

**Parse the markdown.** `@openlogo`'s spec-citation gate extracts headings with
[`marked`](https://www.npmjs.com/package/marked) and computes fragments with
[`github-slugger`](https://www.npmjs.com/package/github-slugger), both added as **devDependencies**.
The hand-rolled reader is deleted.

The maintainer approved the dependency. This ADR refines [ADR-0005](0005-toolchain.md), which
deliberately keeps the toolchain small.

### Why these two packages

Measured with `npm view <pkg> dependencies`, against a workspace that installs **39** packages in
total:

| package | direct dependencies |
|---|---|
| `marked` | **0** |
| `github-slugger` | **0** |
| `commonmark` | 3 |
| `markdown-it` | 6 |
| `mdast-util-from-markdown` | 12 (and pulls `micromark`, itself 17) |

`github-slugger` is what GitHub's own anchors are generated from, so using it removes a
reimplementation rather than adding a second opinion. `marked` targets **GFM**, which is what GitHub
renders — so for this gate GFM is *more* correct than strict CommonMark, not a compromise.

### What the parse had to buy — both, or it was not worth the dependency

1. **Block structure.** Fences (including inside containers), HTML blocks, indented code, setext
   headings, and headings nested in blockquotes and list items, which GitHub publishes and a flat
   reader cannot see. `spec/execution-model.md` is the acceptance test: it parses correctly and all
   of its live anchors resolve.
2. **Rendered text.** `github-slugger` expects a heading's *rendered* text. `## [Text](target)`
   publishes `#text`, not `#texttarget`; `## A &amp; B` publishes `#a--b`; `` ## ` foo ` `` publishes
   `#foo`, because a code span is trimmed. Slugging the markdown **source** gets all three wrong, and
   no amount of block parsing would have touched them — this is the half a "canary" could never have
   closed.

### What was deleted

The hand-rolled slug rule; the character permit-lists over heading text and code-span contents; the
code-span run pairer; the fence and container scanners; and the refusals for HTML blocks, setext
rules, nested headings and container fences. **A dependency that only adds has not paid for itself.**

One refusal survives, because it is a genuine divergence rather than an approximation: a **GFM emoji
shortcode**, which GitHub renders and `marked` does not implement. A cited document whose headings
contain one is refused rather than answered.

## Consequences

- Anchor resolution is now correct for the block and inline constructs GitHub actually renders, and
  the nine rounds of reviewer reproductions are kept as regression tests. They were the specification
  this was built against.
- The hand-verified slug literals — `` `set_xy` `` keeps its `_`, `Turtle & Rendering` →
  `turtle--rendering`, `` `[text](target)` `` → `texttarget` — became **cross-checks between two
  independent implementations** rather than restatements of our own logic. They agree.
- **The duplicate-slug retargeting bound is unchanged**, and deliberately so. Resolving an anchor
  proves *some* heading claims that slug, never that the section the citation meant still claims it:
  inserting a colliding heading demotes the original, and renaming or removing an earlier duplicate
  promotes a later one into the slug it vacated. Both retarget a citation silently and both leave the
  gate green. That is inherent to slugs, not to any reader, so the parser did not touch it — see
  [ADR-0034](0034-cite-the-spec-by-section-anchor.md).
- Line-form citation handling is untouched; its counters are invariant across this change, which is
  the property #1183's ratchet baseline depends on.
- Two new packages enter dependency review and CodeQL. Both declare zero direct dependencies, so the
  transitive surface added is exactly two.
- `marked` follows GFM, not GitHub's rendering pipeline in full. Where they differ — the emoji
  shortcode above is the known case — the gate refuses rather than guesses.

## Alternatives considered

- **Keep the hand-rolled reader and add a "canary"** that refuses anything it cannot prove. This was
  tried across rounds 4–8. It closed each demonstrated case and was defeated by the next, because the
  canary must detect block structure and block structure is not a property of a line. Round 8 showed
  the failure mode plainly: the refusal's own justification was false about the corpus it protected.
- **`github-slugger` alone.** Insufficient: it expects rendered text and is not a parser, so the
  entire second class above would have remained.
- **A stricter CommonMark parser** (`commonmark`, `markdown-it`, `mdast-util-from-markdown`). More
  dependencies, and strict CommonMark is *further* from what GitHub renders than GFM is.
- **Restrict resolution to documents with flat block structure**, refusing the rest. Honest and loud,
  but it refuses `spec/execution-model.md` today, so the gate fails on the corpus it is meant to
  check — unavailable while #1180 forbids the mass citation edit that would be needed.

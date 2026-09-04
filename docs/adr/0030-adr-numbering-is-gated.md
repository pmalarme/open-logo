# 30. ADR numbering, filename↔heading agreement, and reference resolution are gated

- Status: Accepted
- Date: 2026-09-02
- Deciders: OpenLogo maintainer (@pmalarme) + `@devops`, on issue #1042
- Related: extends [ADR-0021](0021-built-in-names-list-and-ci-gate.md) (a hand-maintained fact that
  nothing re-derives is an unenforced assertion), applies
  [ADR-0000](0000-record-architecture-decisions.md)'s numbering convention, follows
  [ADR-0009](0009-test-layout.md)'s logic-module + thin-CLI split

## Context

An ADR is addressed by its number. `docs/adr/` is the only place in this repository where a
*number* is the primary key of a document, and until this gate **nothing checked those numbers**.

The consequences were not hypothetical. Two Accepted ADRs were created four days apart both
carrying the number `0025`; the duplicate then stood for nearly three days before a human noticed,
and renumbering one of them (issue #1036) turned into a hand audit of every reference in the tree —
the per-reference verdicts are recorded in commit `f3bbc9d1`. A second defect of the same family was
still present when this gate was written, at `492cdff7`:

- `docs/adr/0022-documentation-example-gate.md` opened with the heading `# 21.`, so two documents
  presented the same number to a reader — the filename said one thing and the document said another;
- two links in `.github/skills/shared/definition-of-done/SKILL.md` climbed three directories where
  they needed four, resolving into a `.github/docs/adr/` that has never existed.

Both are mechanical, and none of the Definition-of-Done gates then wired in `ci.yml` looked for
them. It is not that they ignore documentation — `examples` executes every fenced ` ```logo ` block
in `docs/**.md` — but none of them validates an ADR number or resolves an ADR link. `format:check`
does not read markdown at all (`.prettierignore` excludes `docs/`, `.github/` and `*.md`), and
`spec-citations` resolves `spec/<file>.md:<line>` citations, not ADR paths.

The costliest part is not the broken link. An ADR is **immutable once Accepted** for everything that
carries meaning — prose, status, rationale — so while a numbering defect is correctable in place
under the typo carve-out (`AGENTS.md`), as #1036 and this commit's fix to ADR-0022 both did, every
citation written against the wrong number in the meantime has to be re-attributed by hand.

## Decision

**A Definition-of-Done gate checks ADR numbering, and the two live defects are fixed in the same
commit that introduces it.**

`scripts/adr-numbering-gate.mjs` (logic, imported by its tests) plus
`scripts/check-adr-numbering.mjs` (a thin CLI shell) are wired as `npm run adr-numbering` and run
unconditionally in `ci.yml`. It fails when:

1. two ADR files share a number, or a filename is not `NNNN-lowercase-kebab-slug.md`;
2. a document's first level-1 heading does not carry its own filename's number, written unpadded;
3. a markdown link or a written-out `docs/adr/NNNN-….md` path does not resolve to a file that
   exists — resolved **from the directory the reference is written in**, which is what makes a
   wrong `../` depth a failure rather than a coincidence;
4. a link labelled `ADR-NNNN` resolves to something that is not that ADR — a different number, or no
   ADR at all. That mismatch is invisible to a plain link check — the link works — and it is the
   shape that made #1036 hard.

**The gate lands with the fixes, in one commit.** Adding it first would have made the branch red on
arrival; fixing first and gating later leaves a window in which the same defect can reappear.

Three design choices are worth recording because the obvious alternative is wrong in each case, and
in each the alternative was tried first and rejected on a measurement, not on taste:

**It enumerates references by three unioned signals, not by a `docs/adr/` substring.** Diffing the
gate's enumeration against an independently written substring probe over the tracked corpus shows
the substring design missing the *majority* of ADR links: the sibling links ADRs use on each other
name no directory at all. The signals — target names the ADR directory, resolved path lands inside
it, link text carries an `ADR-NNNN` label — each covers a hole the other two have, and the module
note says which. The same diff found a link whose `](` ends one line and whose target opens the
next, which a line-wise matcher had silently dropped.

**It reads all three CommonMark destination spellings**, including `<angle-bracketed>` and titled,
in all three title delimiters. Ignoring them would not merely leave those links unchecked: a titled
link was still seen by the bare-path scan, which resolves from the repository root, so a wrong `../`
depth **passed** — the defect hidden by the very breadth that was supposed to catch it. A link whose
*text* spans lines or nests brackets, a reference-style definition, and an HTML anchor are still
unparsed, and therefore unchecked; none occurs in this repository today. In markdown, a link inside
a fenced block or a code span is skipped: it renders as text, not a link, so auditing it is a false
red. Bare ADR paths stay checked everywhere, backticked or not, because this repository writes real
references that way.

**Its scanned set is tracked files *plus* untracked, non-ignored ones**
(`git ls-files --cached --others --exclude-standard`). `scripts/spec-citations-gate.mjs` walks the
tracked set alone, and its own verification run happened before `git add` — so it had never read its
own source and reported green over a corpus that excluded the file under review. Including
`--others` closes that mechanically rather than by remembering to stage first. In CI the two sets
are identical, because a fresh checkout has no untracked files.

## Consequences

The gate prints its enumeration, its counts, and its own coverage statement on **every** run, so a
check that quietly stops finding anything is visible rather than inferred; none of its own counts is
copied into this record, where it could not be corrected.

**What it does not catch, stated rather than implied:**

- **A bare `ADR-0025` in prose that points at the semantically wrong document.** There is no path to
  resolve — only a number in a sentence. #1036 had to attribute every such reference by hand to
  decide which moved with the renumbered document and which stayed, each resting on surrounding
  prose (one citing a "396 escape" figure that appears in only one ADR; another quoting "the shim
  exposes no compiler API", attributable to a different one); the verdicts are recorded in commit
  `f3bbc9d1`. No filename check reaches that, and this gate does not pretend to. It is the reason a
  renumbering remains a **human** audit.
- **A number claimed on another branch.** The gate reads one tree. Two branches can each take the
  same next-free number and both stay green until the second merges — which happened to this very
  record, drafted as 0029 and renumbered when a concurrently-authored ADR took that number first.
  The duplicate then fails on the merged tree, which is the safety net; nothing warns the author
  before it.
- A heading's *title*, a `#fragment` naming a real heading, reference-style link definitions, HTML
  anchors, and whether the numbers form an unbroken sequence.
- `docs/design-notes/` — the Language Design Records, a sibling family with the same numbering
  convention and the same exposure. The gate takes `--adr-dir`/`--adr-root`, and pointed at that
  family its documents pass the numbering, filename and heading audit today. A run is still **red**,
  though, because the `ADR-` label prefix is hard-coded: every `ADR-NNNN` label in the tree is then
  measured against the wrong family, and an `LDR-NNNN` label goes uncompared. Wiring a second
  invocation means parameterising the label too. It is deliberately out of this slice's write-set
  rather than silently assumed covered.
- A **labelled link that leaves the repository** — an `ADR-NNNN` label over an external URL or a
  bare `#fragment`. There is no repository path to resolve, so the claim cannot be checked; the gate
  prints each one with its file and line, and totals them, rather than dropping them silently.
- A fence nested in a **list item or block quote**, whose container prefix the fence pattern does
  not strip. What happens then depends on the marker — a block-quoted backtick fence still opens a
  code span through its backticks, so a link inside it is skipped, while a tilde one leaves the link
  audited as live. Full container parsing is a markdown parser, which this gate is not, and no
  markdown file in the tracked corpus holds such a fence.
- A **UNC or device-path override** given to `--adr-root`/`--link-base`. `canonicalPath` preserves
  such a root, but `posix.join` collapses the leading `//` while resolving a reference, so identity
  comparison fails and the run goes red. The supported invocations — the npm script, and any
  relative or drive-rooted override — are unaffected; a UNC override is unsupported rather than
  silently wrong, which is why it is written down here.
- A link inside an **HTML comment** or a **four-space indented code block** is audited as live, for
  the same reason: neither container is modelled. Both fail loudly rather than silently, and no such
  link exists in the corpus today, so this is a forward-looking false-red risk rather than a hole.

An illustrative ADR link written into a **source comment** is a link as far as this gate is
concerned — there is no backtick exemption outside markdown, because one would excuse exactly the
code comments the bare-path check exists to cover. Spell such an example out instead of writing it
in link syntax: the gate flagged its own module note for this twice, and the test fixtures name a
`contract/adr` directory for the same reason.

Adding an ADR is now a check that can fail, which is the point: within a tree, a number is either
unique and agreed-upon on both sides, or CI is red.

One instrument among several, and that is deliberate. This gate was reviewed for ten rounds and
still shipped a first version whose two constructed regexes interpolated a command-line argument
raw — a `js/regex-injection` that CodeQL raised in seconds. A mutation battery asks whether the
tests notice the code being broken; it cannot ask what a hostile input would do. The residuals above
say what this gate does not check; this says why no single gate is the answer.

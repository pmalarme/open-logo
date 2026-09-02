# 29. Conformance fixtures may opt in to comparing a diagnostic `message`

- Status: Accepted
- Date: 2026-09-02
- Deciders: OpenLogo maintainer (@pmalarme) + `@documentation`, reviewed by `@testing`, on issue
  #1037. The decision it records was taken across issues #1025 → #1026 and #1028 → #1029.
- Related: refines [ADR-0010](0010-conformance-harness-parser-integration.md) (conformance harness
  parser integration), whose decision #2 states the opposite of what the harness now does;
  [ADR-0007](0007-conformance-harness.md) (conformance harness);
  [`spec/error-model.md`](../../spec/error-model.md#localization-boundary) (the localization
  boundary this opt-in is scoped by)

## Context

[ADR-0010](0010-conformance-harness-parser-integration.md)'s decision #2 says fixtures omit
`message` and that "comparison excludes `message` value". That was true when it was written. It is
now false in both halves, and ADR-0010 is `Status: Accepted` and therefore immutable
([ADR-0000](0000-record-architecture-decisions.md)), so the correction has to be a new record rather
than an edit.

**What the exclusion actually produced.** Measured at `9f738989`, the commit immediately preceding
the merge of #1026: **306** of **632** expected diagnostics, spread across **193** of **934**
`tests/conformance/**/*.expected.json` files, carried a `message` field that no code path read.
(Probe: parse every `*.expected.json` at that tree and count
`Object.hasOwn(diagnostic, "message")`.) ADR-0010's sentence was accurate on its own date, and the
direct evidence is its own commit rather than the later arrival of the flag: at `1abbf732`, which
added ADR-0010, `compare()` built each diagnostic through a projection that omits `message` outright,
under the comment *"Exclude "message" from comparison (prose may change under
localization/rewording)."*

That the corpus could not detect a change to the wording is not inferred from the code's shape; it
is measurable at the current tree. With the message comparison forced off in `compare()` and the
shared repair tail reworded from `choose another name.` to `pick a different name.`, `npm run
conformance` reports **941 passed, 1 failed** — and the single failure is
`_harness-selftest/detects-message-mismatch` reporting that it can no longer detect the mismatch it
exists to detect. Not one ordinary fixture notices. (Measured at `492cdff7`.)

**What was missing was the ADR, specifically.** The decision was not undocumented: the fixture
format documentation in `tests/conformance/README.md` states the opt-in, both rejected directions,
the per-diagnostic grain and the "opt in only where the spec fixes the words" rule for fixture
authors. The loader enforces the structural half of that mechanically — the relationships between
the flag, a `message` and the fixture's polarity — while *which* codes deserve an opt-in stays an
authoring policy no harness can check, since nothing in the fixture format tells it whether the spec
fixes a given code's wording. What did not exist was any **ADR-level** record — searching `docs/adr/`
for the contract finds ADR-0010's sentence and nothing else — so the architecture history said the
opposite of the code, and the decision that replaced it (taken in #1025/#1026, its last hole closed
by #1028/#1029) had no entry in the decision log.

## Decision

**A fixture compares a diagnostic's `message` when, and only when, it sets `"compareMessages": true`
and the individual expected diagnostic carries a `message`.** Both conditions are evaluated in
`compare()` in `scripts/harness/index.mjs`; the per-diagnostic half is what lets one fixture pin the
one sentence the spec fixes while its siblings stay on identity alone.

### 1. Opt-in, not compare-everything

`spec/error-model.md`'s
[Localization boundary](../../spec/error-model.md#localization-boundary) makes diagnostic identity
`code` plus `params`, calls prose "presentation", asks that "Tests and editor tools SHOULD assert
codes and params, not English text", and then positively permits a template author to "reorder,
inflect, or soften prose". Comparing every message would freeze prose the spec says an implementing
stack may change, into a corpus whose whole purpose is to be stack-neutral.

The narrower design — **read the presence of a `message` key as the opt-in** — was built first and
reversed in review, and the reversal is the load-bearing part of this record. PR #1026's review table
records it: `rubber-duck` round 2 found that presence-as-consent "asserted prose retroactively", and
`@testing`, which had endorsed the design in round 1, **explicitly reversed itself** in round 2,
noting it had verified the mechanism but not the policy. Presence-as-consent would have applied to
all 306 messages measured above, every one written while the documented behaviour was that messages
are not compared. Consent cannot be retroactive.

The histogram at `9f738989` shows what such a sweep would have swallowed: 26 distinct codes, led by
`ol-bad-token` (59), `ol-unknown-command` (58) and `ol-type` (44) — and only 22 `ol-reserved-word`,
the one code the opt-in was actually built for.

That code is the case that justifies having an opt-in at all. Its registry row prescribes the
sentence itself — *"Say `{name} is already part of OpenLogo. choose another name.`"* — and then makes
the words *keyword*, *primitive* and *alias* a **MUST NOT** inside it. A MUST NOT on the words of a
message is unenforceable by `code` + `params`, because identity cannot see prose.

### 2. The mechanism is two halves, and only one of them has kill-power

One shared source (`packages/core/src/diagnostic-messages.ts`) *plus* the per-fixture gate.

The source removes the drift between today's producers — three call sites across two packages
(`packages/parser/src/checker-reserved-word.ts`, `packages/parser/src/errors.ts`,
`packages/runtime/src/errors.ts`). What it cannot do is bind a producer that does not call it: a
module constrains its importers, and a fourth site that writes the sentence by hand imports nothing.

The gate constrains the **emitted output**, whoever produced it, and that is measurable rather than
argued. Rewording the shared repair tail at `492cdff7` fails **18** fixtures — precisely the 19
opted-in fixtures minus the self-test, which still passes because the mismatch it expects still
occurs. Identity is untouched by that edit; every one of those 18 failures is prose.

### 3. Three ways a `message` could assert nothing — all now fixture errors

Anything that leaves a `message` unable to assert what it appears to assert is rejected at load
time, so the 306-sentence state cannot recur one fixture at a time:

- a `message` **without** the flag — silently dropped, the original defect;
- the flag **without** any `message` — an opt-in that asserts nothing;
- the flag combined with **`expect: "mismatch"`** (#1028) — different in kind from the other two. It
  does not drop the message; it removes the *guarantee* that the message is what the verdict rests
  on, because an inverted verdict is satisfied by any disagreement at all.

The third carries exactly one exemption:
`_harness-selftest/detects-message-mismatch/detects-message-mismatch.expected.json`, the fixture that
can only demonstrate the comparison firing by expecting it. The exemption is that **complete fixture
name, compared by equality** — deliberately not the `_harness-selftest/` prefix and not the fixture's
own directory, either of which would let a fixture placed beside it inherit the exemption, which is
not what "one fixture" means.

(A fourth load-time rejection, a non-boolean `compareMessages`, is not listed above because it is an
ordinary malformed-input check rather than a way for a well-formed `message` to assert nothing.)

### 4. What deliberately stays outside conformance

The shared `ol-bad-token` opening *"i don't know how to read … here."* is pinned by **unit tests, not
fixtures**, and it spans both stages, so both guards are named here: the parse-stage form in
`packages/parser/src/misplaced-keyword-message.test.mjs` (which asserts `stage === "parse"`) and the
semantic-stage form in `packages/parser/src/checker-profile-word-position.test.mjs` (which asserts
`stage === "semantic"`). Naming only the first would describe half of a contract this section calls
cross-stage.

Its registry row says the message "SHOULD point at the unexpected text and mention the closest legal
form when clear" — a condition to satisfy, not a sentence to reproduce. Freezing our English for it
in a stack-neutral corpus would oblige every conforming implementation to emit our words for a
requirement the spec states as a behaviour. The corpus reflects that: at `492cdff7` all 23 compared
messages are `ol-reserved-word`, and no `ol-bad-token` message is compared anywhere.

### 5. ADR-0010 receives exactly one edit

`refined by ADR-0029` appended to its `Related:` line. `Status:` stays `Accepted`, and its prose,
rationale and consequences are untouched — a refinement records the relationship and corrects
forward (`AGENTS.md`; [ADR-0000](0000-record-architecture-decisions.md)).

## Consequences

- **The gate protects itself, and this was verified rather than assumed.** Silently disabling the
  comparison in `compare()` at `492cdff7` fails `npm run conformance` (**941 passed, 1 failed**) and
  **6** of the 183 tests in `scripts/conformance.test.mjs`. Three of the six name the opt-in
  directly (#1025's comparison test and #1028's two `expect: "mismatch"` tests); the other three
  fail downstream because they run the real corpus. A quiet rollback is therefore not available:
  the property that distinguishes a gate that works from one that worked once is that removing it is
  loud.
- **The corpus has no third state.** Because a `message` and the flag now imply each other in both
  directions, "carries a message" and "is compared on prose" are the same set — 19 files at
  `492cdff7`, by both counts.
- **A fixture author opts in only where the spec fixes the words**, and the fixture format
  documentation in `tests/conformance/README.md` is where that rule is stated for authors.
- **This ADR cites `spec/` by section anchor and quotation rather than by line, deliberately**, and
  the evidence is two observed cases plus one limit of the amendment rules — stated separately,
  because each carries a different part of the argument. First, **line citations in immutable prose
  do rot, and that is observed here rather than predicted.** ADR-0010's `error-model.md:193-194`
  pointed at exactly the text it claims when ADR-0010 was added at `1abbf732` (those lines then read
  *"…the same `ol-*` code and structured params for the same condition. Tests and editor tools SHOULD
  assert codes and params, not English text."*); at `492cdff7` they hold a blank and the
  `## Did-you-mean` heading. The same manifest records the pattern in a sibling record:
  `scripts/spec-citations-exceptions.json` carries `stale-citation` entries for
  `docs/design-notes/0003-…`, whose `spec/commands.md` line numbers now land on blank space — and
  that document is a Language Design Record, not an ADR, but `docs/design-notes/0000-…` makes LDRs
  "immutable once Accepted" under the same convention, so it is not the freely-repairable case it
  might look like. Second, **a defect inside such a record is hard to repair in place**: `AGENTS.md`
  excepts "typo/link fixes", so a re-pointed citation is arguably permitted, but the repository's
  operative practice is the stronger signal — the manifest's permanent entry for
  `docs/adr/0007-conformance-harness.md` reads the rule as *not* permitting the edit and calls itself
  permanent by design, and that entry is a status claim rather than a citation. What has **not** been
  observed in `docs/adr/` is the full compound: a rotted line citation there that also fails CI.
  ADR-0010's escapes only by the accident described next. This ADR declines to rely on that accident.
- **Two independent blind spots keep ADR-0010's own stale citation invisible, and only the second is
  the one people expect.** ADR-0010 cites `error-model.md:193-194` for "identity is `code` +
  `params`"; those lines now hold a blank and the `## Did-you-mean` heading, while the statement
  meant sits under `## Localization boundary`. Running the gate's own `collectCitations()` over
  ADR-0010 returns exactly one citation — its `error-model.md:28-38` reference to the diagnostic
  shape, which is written with the prefix — while the `193-194` reference is **never collected at
  all**, because the scan pattern requires a literal `spec/` prefix that it omits. Written *with*
  the prefix it is collected, and then **resolves cleanly**: `## Did-you-mean` is text, and the gate
  checks that a citation resolves to text, not that the text supports the claim beside it. (Both
  halves measured: the collection counts by calling `collectCitations` on ADR-0010 as written and on
  a prefixed counterfactual, and the resolution by running the gate itself over that counterfactual,
  which reports no finding against ADR-0010.) So a line citation can be invisible outright, or
  visible and shallowly checked. The anchor form this ADR uses trades both for a third, which the
  gate prints on every run: **section anchors are not resolved at all**, so a renamed heading here
  would pass unseen. Quoting the cited sentence is what keeps such a citation recoverable by search.

# Heritage conformance fixtures

Fixtures for the **Heritage** profile — alternate spellings only, no new semantics
(`spec/conformance.md#heritage`). These fixtures were landed by epic **#659**'s slices
(**#667**–**#671**) and the profile is claimed by its terminal slice (**#672**).

**Normative dependencies** (`spec/conformance.md` profile DAG): Heritage depends on
**Core Language**, on **Data** — the `value of … for key` reader operates on dicts — and, since
issue **#860**, on **Turtle & Rendering**: nine of the thirteen alias spellings
(`fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`) spell Turtle & Rendering primitives, so a claimant
owing those aliases must own the primitives they spell, while `pr`/`bf`/`bl`/`se` spell Core ones.
This matches `PROFILE_DEPS.heritage = ["core-language", "data", "turtle-rendering"]` in
`scripts/harness/index.mjs`. Note that a fixture's `profiles` array is the **active profile set**
passed to `check()` (`scripts/harness/index.mjs`'s `produce`), not a conformance claim, so many
fixtures below deliberately activate a minimal set — `make-assigns-like-set` declares bare
`["heritage"]` — and are not obliged to be dependency-closed.

Fixture shape and conventions: see [`../README.md`](../README.md).

Until #672 claims `heritage` in `packages/core/src/host-metadata.ts`'s `SUPPORTED_PROFILES`, the
examples gate SKIPs (with a visible notice) any `spec/examples/*.logo` that requires it — see
`scripts/examples-gate.mjs`. The profile is not yet claimed, but its per-slice behavior is proven
here fixture-by-fixture as each Heritage slice lands:

- `assignment/` — `make` assigns exactly like `set` (slice H2, #667).
- `check/heritage-forms-{accepted-when-active,rejected-in-core}` — the form heads `make`/`to`/
  `output`/`op` are gated on the `heritage` profile (slice H2, #667).
- `check/heritage-aliases-{accepted-when-active,rejected-in-core}` — the ten short command aliases
  `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/`pr` are gated on the `heritage` profile, visible only
  when it is active and otherwise `ol-unknown-command` (slice H3, #668).
- `check/heritage-alias-suggestion-loses-tie-to-full-name` — a did-you-mean tie between a full
  canonical name and a short alias resolves to the full name (`dca` → `dict`, not the alias `cs`),
  per `spec/error-model.md:145-146` (slice H3, #668).
- `execution/heritage-forms-execute-like-core` — the form heads execute through the identical Core
  node kinds (slice H2, #667).
- `execution/heritage-aliases-execute-like-core` — the ten command aliases produce a full event
  stream byte-identical (payloads included) to their Core spellings, the strongest proof of "no new
  semantics" (slice H3, #668).
- `check/heritage-list-reporter-aliases-{accepted-when-active,rejected-in-core}` — the three
  list-reporter aliases `bf`/`bl`/`se` (spellings of `butfirst`/`butlast`/`sentence`) are gated on
  the `heritage` profile, visible only when it is active (with its Data dependency) and otherwise
  `ol-unknown-command`, including composed as `bf bl [ … ]` (slice H4, #669).
- `execution/heritage-list-reporter-aliases-execute-like-core` — the three reporter aliases, in
  expression position (arguments, composed `bf bl :l`, assignment RHS), produce a full event stream
  byte-identical (payloads included) to their Core reporter spellings (slice H4, #669).
- `check/heritage-reporter-alias-arity-canonical-callable` — a parenthesized reporter alias's arity
  diagnostic carries the **canonical** `params.callable` (`butfirst`), byte-identical to its Core
  twin's, never the surface spelling `bf`: structured diagnostic identity is canonical even when the
  spelling is an alias (`spec/error-model.md:235-238`), asserting the field directly (#733).
- `check/heritage-return-alias-canonical-keyword-{outside-proc,in-comprehension}` — the escape
  spellings `output`/`op` carry the **canonical** `params.keyword` (`return`) at BOTH
  `keyword`-carrying control-flow sites, byte-identical to their Core twin's, while the prose
  message still names the learner's own word and the span still covers exactly the surface control
  word. Fixtured per site on purpose: the defect was present at both, and covering one would have
  left the other unprotected (#737).
- `execution/heritage-{output,op}-canonical-keyword-executed-{outside-proc,in-comprehension}` — the
  same property at the **runtime** stage, which is a separate code path: `execute()` runs `parse()`
  only and never `check()`, so `@openlogo/runtime` keeps its own copies of those two rules — copies
  that still emitted the surface spelling after #737 canonicalized the checker, so one program
  reported two identities depending on the entry point. Four fixtures, one per spelling per site,
  each byte-identical in `code`/`params`/`stage`/`severity` to its Core twin under
  `core-language/execution/procedure-return-outside-proc` and
  `core-language/comprehensions/comprehension-return-in-comprehension` (#741).
- `check/heritage-form-head-keyword-casing-clean` — a lowercase Heritage form head (`to`, `output`)
  raises no `ol-style-name-case`. That lint judges casing only, so a hardcoded per-kind canonical
  keyword made it slice past a shorter Heritage spelling and warn about correct code (#737).
- `check/heritage-value-of-key-{accepted-when-active,rejected-in-core}` — the worded dictionary
  reader `value of … for key` is gated on the `heritage` profile (with its Data dependency), visible
  only when active and otherwise `ol-unknown-command` (slice H5, #670).
- `check/heritage-value-of-key-undefined-operand-like-core` — with Heritage ACTIVE the reader raises
  nothing of its own at the semantic stage, so this pins the one thing that stage can prove: the
  reader and the Core `:d["k"]` selector, over the same undefined operand, report byte-identical
  `ol-undefined-var` params naming only the learner's variable. The head word `value` reaches no
  structured param on either side (issue #755).
- `execution/heritage-value-of-key-{reads,missing-key,bad-key-type,non-dict}-like-core` and
  `execution/heritage-value-of-key-{word,boolean,list,turtle}-container-like-core` — the
  reader shares the Core dict read (since #784 it calls the selectors' own `resolveDictSegment`),
  so it produces the same value and the same diagnostics as the Core selector — diagnostics match
  by construction, not just results (slice H5, #670; container matrix #784). Note which Core twin
  each mirrors: a wrong CONTAINER type is the dotted `:d.key` selector's `ol-type` with
  `operation: "field"`, while a wrong KEY type is the `:d[key]` selector's `ol-type` with
  `operation: "index"`. Pairing the container cases with `[key]` is precisely what produced #784.
- `execution/heritage-value-of-key-record-container-rejected` — deliberately NOT a `-like-core`
  fixture, and the one container type with **no** Core twin: the reader's operand is typed
  `dictExpr` (`spec/data-structures.md:268`) so a record is out of range and raises `ol-type`,
  while the Core `.field` selector it otherwise mirrors accepts records and reports
  `ol-unknown-field`. The divergence is spec-mandated, not accidental; the fixture pins it so any
  future change is a reviewed `spec/` decision (#784).
- `check/heritage-tooling-program-{checks-clean,without-heritage-profile}` — a whole program mixing
  all four Heritage shapes checks clean under the profile and is rejected head-by-head
  (`ol-unknown-command`) without it (slice H6, #671).
- The `lt` (→ `left`) command alias's execution/event-stream equivalence was the one alias without a
  positive runtime proof (only recognition); the #672 audit closed that gap by exercising `rt`/`lt`
  back-to-back in `execution/heritage-aliases-execute-like-core`, before claiming the profile.

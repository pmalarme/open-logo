# Heritage conformance fixtures

Fixtures for the **Heritage** profile — alternate spellings only, no new semantics
(`spec/conformance.md#heritage`). These fixtures were landed by epic **#659**'s slices
(**#667**–**#671**) and the profile is claimed by its terminal slice (**#672**).

**Normative dependencies** (`spec/conformance.md` profile DAG): Heritage depends on
**Core Language** and **Data** — the `value of … for key` reader operates on dicts, so it also
needs Data. It does **not** depend on Turtle & Rendering; the short command aliases
(`fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/`pr`) are pure spellings of Core-declared behavior and
add no profile edge. This matches `PROFILE_DEPS.heritage = ["core-language", "data"]` in
`scripts/harness/index.mjs`.

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
- `check/heritage-value-of-key-{accepted-when-active,rejected-in-core}` — the worded dictionary
  reader `value of … for key` is gated on the `heritage` profile (with its Data dependency), visible
  only when active and otherwise `ol-unknown-command` (slice H5, #670).
- `execution/heritage-value-of-key-{reads,missing-key,non-dict}-like-core` — the reader lowers onto
  the Core dict read, so it produces the same value and the same diagnostics (`ol-unknown-key`,
  `ol-type` with `operation: "index"`) as `:dict["key"]` — diagnostics match by construction, not
  just results (slice H5, #670).
- `check/heritage-tooling-program-{checks-clean,without-heritage-profile}` — a whole program mixing
  all four Heritage shapes checks clean under the profile and is rejected head-by-head
  (`ol-unknown-command`) without it (slice H6, #671).
- The `lt` (→ `left`) command alias's execution/event-stream equivalence was the one alias without a
  positive runtime proof (only recognition); the #672 audit closed that gap by exercising `rt`/`lt`
  back-to-back in `execution/heritage-aliases-execute-like-core`, before claiming the profile.

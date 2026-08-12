# Heritage conformance fixtures

Fixtures for the **Heritage** profile — alternate spellings only, no new semantics
(`spec/conformance.md#heritage`). Fixtures land here as epic **#658**'s Heritage terminal
slice (**#672**) implements the profile.

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
- `execution/heritage-forms-execute-like-core` — the form heads execute through the identical Core
  node kinds (slice H2, #667).
- `execution/heritage-aliases-execute-like-core` — the ten command aliases produce a full event
  stream byte-identical (payloads included) to their Core spellings, the strongest proof of "no new
  semantics" (slice H3, #668).

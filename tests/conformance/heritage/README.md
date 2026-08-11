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

Until #672 claims `heritage` in `packages/core/src/host-metadata.ts`'s `SUPPORTED_PROFILES`, the
examples gate SKIPs (with a visible notice) any `spec/examples/*.logo` that requires it — see
`scripts/examples-gate.mjs`. This directory is registration scaffolding (issue #666); it carries no
fixtures yet, and an empty profile fixture set keeps the suite green.

Fixture shape and conventions: see [`../README.md`](../README.md).

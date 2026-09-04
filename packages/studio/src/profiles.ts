/**
 * The studio's **active conformance profile set** (#740) — the one value every profile-aware
 * `@openlogo/parser` entry point the studio calls defaults to: `highlight()` through
 * `highlighter.ts` and `check()` through `diagnostics.ts`. Sharing one default is the point: a
 * learner's program has exactly one profile set, so when neither caller overrides the default, the
 * colors in the editor and the diagnostics in the pane read that program under the same profiles. (A
 * caller that passes its own set can still make the two differ — the shared default is what is
 * guaranteed, not an invariant this module can enforce.)
 *
 * ## Why the host's supported profiles, and not Core Language alone
 * `spec/tooling.md:30` puts the profile block-heads — plus the Sprites mode-switch command `tell` —
 * in the `keyword` class *"while their profile is active"*, and `:31` puts *"a profile word whose
 * profile is inactive"* in `primitive`. The class of `tell`/`ask`/`each`/`when`/`every`/`on_key`/
 * `on_click` is therefore a function of the active set, and a caller that supplies none gets
 * `@openlogo/parser`'s profile-neutral default (`DEFAULT_CHECK_PROFILES`, Core Language alone) —
 * which for the studio would be a false statement about the learner's own environment.
 *
 * The studio has no profile picker, and an OpenLogo program cannot declare its own profiles
 * (`import` loads modules, not profiles), so the learner's active set is simply **whatever this
 * build supports**: `@openlogo/core`'s {@link SUPPORTED_PROFILES}, the same list `getHostMetadata()`
 * publishes for feature detection. A learner really can write `ask :t [ right 90 ]` in this editor
 * (`spec/turtles-and-sprites.md:23`), so `ask` must paint as the `keyword` it is, and the checker —
 * reading the same set — must treat it as an available name rather than an unknown command.
 *
 * What a profile set decides is exactly that: **whether a name works**, never whether a program may
 * declare it. Profile words are built-in names *unconditionally* (`spec/grammar.md:410`), so
 * `ol-reserved-word` is not a profile-conditional judgement and nothing here should be read as
 * making it one.
 *
 * ## Derived and frozen, never re-listed
 * The contents are `SUPPORTED_PROFILES`, not a hand-maintained copy: a second list would drift the
 * first time a profile is claimed or withdrawn, and the studio would then classify a word by a
 * profile its own runtime does not implement — the exact class of false claim `SUPPORTED_PROFILES`
 * exists to prevent. It is a **frozen copy** rather than an alias because this is a public export
 * and `readonly` is erased at runtime: aliasing would hand every consumer a live handle to
 * `@openlogo/core`'s own array. The `readonly CheckProfile[]` annotation is the compile-time proof
 * that every profile this build claims is one the parser knows.
 */

import { SUPPORTED_PROFILES } from "@openlogo/core";
import type { CheckProfile } from "@openlogo/parser";

/**
 * The profile set the studio is running under — a frozen copy of `@openlogo/core`'s
 * `SUPPORTED_PROFILES`, narrowed to the parser's `CheckProfile` vocabulary. See this module's doc
 * comment for why the host's supported profiles are the learner's active profiles.
 */
export const STUDIO_PROFILES: readonly CheckProfile[] = Object.freeze([
  ...SUPPORTED_PROFILES,
]);

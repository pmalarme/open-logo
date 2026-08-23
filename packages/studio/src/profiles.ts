/**
 * The studio's **active conformance profile set** (#740) — the one value every profile-aware
 * `@openlogo/parser` entry point the studio calls reads: `highlight()` through
 * {@link "./highlighter.js"} and `check()` through {@link "./diagnostics.js"}. Both defaulting to
 * the same constant is the point: a learner's program has exactly one profile set, so the colors
 * in the editor and the diagnostics in the pane can never disagree about the same word.
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
 * publishes for feature detection and the same list the studio's runtime registers unconditionally.
 * A learner really can run `ask "a [ right 90 ]` in this editor, so `ask` must paint as the
 * `keyword` it is rather than as an ordinary primitive name.
 *
 * ## Derived, never re-listed
 * This is `SUPPORTED_PROFILES` itself, not a hand-maintained copy. A second list would drift the
 * first time a profile is claimed or withdrawn, and the studio would then color a word by a profile
 * its own runtime does not implement — the exact class of false claim `SUPPORTED_PROFILES` exists to
 * prevent. The `readonly CheckProfile[]` annotation is the compile-time proof that every profile
 * this build claims is one the parser actually knows.
 */

import { SUPPORTED_PROFILES } from "@openlogo/core";
import type { CheckProfile } from "@openlogo/parser";

/**
 * The profile set the studio is running under — `@openlogo/core`'s `SUPPORTED_PROFILES`, narrowed
 * to the parser's `CheckProfile` vocabulary. See this module's doc comment for why the host's
 * supported profiles are the learner's active profiles.
 */
export const STUDIO_PROFILES: readonly CheckProfile[] = SUPPORTED_PROFILES;

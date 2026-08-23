// Unit tests for #740's studio-level active profile set (packages/studio/src/profiles.ts): the one
// constant `highlighter.ts` gives `highlight()` and `diagnostics.ts` gives `check()`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SUPPORTED_PROFILES } from "@openlogo/core";
import { OL_CHECK_PROFILES } from "@openlogo/parser";
import * as OL from "@openlogo/studio";

const { STUDIO_PROFILES } = OL;

test("STUDIO_PROFILES is the host's supported profiles, not a hand-maintained copy", () => {
  // The "derived, never re-listed" invariant: a second list would drift the first time a profile is
  // claimed or withdrawn, and the studio would then classify a word by a profile its own runtime
  // does not implement.
  assert.ok(SUPPORTED_PROFILES.length > 0);
  assert.deepEqual([...STUDIO_PROFILES], [...SUPPORTED_PROFILES]);
});

test("STUDIO_PROFILES is a frozen copy, not a live handle on core's own array", () => {
  // `readonly` is erased at runtime, and this is a public export: aliasing `SUPPORTED_PROFILES`
  // would let any JavaScript consumer mutate `@openlogo/core`'s array through it.
  assert.ok(Object.isFrozen(STUDIO_PROFILES));
  assert.notEqual(STUDIO_PROFILES, SUPPORTED_PROFILES);
  assert.throws(() => {
    STUDIO_PROFILES.push("modules");
  }, TypeError);
  assert.deepEqual([...STUDIO_PROFILES], [...SUPPORTED_PROFILES]);
});

test("every studio profile is a profile the parser knows", () => {
  assert.ok(STUDIO_PROFILES.length > 0);
  for (const profile of STUDIO_PROFILES) {
    assert.ok(
      OL_CHECK_PROFILES.includes(profile),
      `${profile} is not in the parser's OL_CHECK_PROFILES vocabulary`,
    );
  }
});

test("STUDIO_PROFILES is strictly wider than the parser's Core-Language-only default", () => {
  // The reason the studio must supply a set at all: the profiles that own the block-heads #740 is
  // about — Sprites (`tell`/`ask`/`each`) and Interaction & Events (`when`/`every`/`on_key`/
  // `on_click`) — are exactly the ones the parser's own default leaves out.
  assert.ok(STUDIO_PROFILES.includes("core-language"));
  assert.ok(STUDIO_PROFILES.includes("sprites"));
  assert.ok(STUDIO_PROFILES.includes("interaction-events"));
});

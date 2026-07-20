/**
 * A tiny, seeded, deterministic pseudo-random number generator for the Core `random`/`randomize`
 * reporters/command (`spec/commands.md`'s "Math" section, issue #287): "the sequence is
 * deterministic within an implementation" given a seed, and "with no seed the implementation
 * chooses a seed". This is the one narrowly-scoped exception to
 * `runtime.instructions.md`'s "no wall-clock, no randomness outside the seeded rules" — `random`/
 * `randomize` *are* those seeded rules, and every draw still flows through this single, pure,
 * seed-driven generator rather than a bare `Math.random()` call scattered through the evaluator.
 *
 * Mulberry32 (public-domain, a handful of lines) is used purely because it is small, fast, and
 * has good enough statistical spread for a learner-facing language — no cryptographic guarantee
 * is needed or claimed, and the spec itself only promises "controlled unpredictability"
 * (`spec/commands.md`'s `random` entry), not a particular algorithm.
 */

/**
 * The generator's mutable state — a single unsigned 32-bit integer, advanced in place by every
 * draw ({@link nextRandomFloat}). A plain mutable box (mirroring `evaluate.ts`'s
 * `Environment.instructionCount`) rather than a value replaced on every draw: every recursive
 * `evaluate`/`executeStatements` call shares the very same {@link Environment}, so only a shared
 * mutable container lets a `random` draw or a `randomize` reseed made from deep inside a
 * procedure call or loop body be observed by every later draw in the same program run.
 */
export interface RngState {
  state: number;
}

/**
 * Seed a fresh {@link RngState}. With no `seed` supplied, `createEnvironment()`'s default and a
 * no-argument `randomize` both fall back to the host clock — the implementation's own choice of
 * seed, per `spec/commands.md`: "with no seed the implementation chooses a seed". `>>> 0` folds
 * any seed (including a negative or fractional one) into the unsigned 32-bit range the generator
 * operates on.
 */
export function createRngState(seed?: number): RngState {
  return { state: (seed ?? Date.now()) >>> 0 };
}

/**
 * Draw the next float in `[0, 1)` from `rng`, advancing its state in place (the Mulberry32
 * algorithm). {@link nextRandomInt} is the public entry point every `random` call actually uses;
 * this lower-level draw is exported so a unit test can prove the generator's own determinism
 * directly, without going through the integer-scaling step.
 */
export function nextRandomFloat(rng: RngState): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Draw a whole number in `[min, max]` inclusive from `rng` — `random n`'s `[0, n-1]` is the
 * `min: 0, max: n-1` case of `(random a b)`'s general inclusive range
 * (`spec/commands.md`'s `random` entry).
 */
export function nextRandomInt(rng: RngState, min: number, max: number): number {
  return min + Math.floor(nextRandomFloat(rng) * (max - min + 1));
}

/**
 * Turn any {@link OLValue}-shaped seed into a deterministic unsigned 32-bit RNG state: an integer
 * seed is folded directly (`>>> 0`), matching the intuitive "same number in, same sequence out"
 * expectation; any other type (word/list/boolean, or a non-integer number) is hashed from its
 * printed form (FNV-1a, another small/public-domain algorithm) instead of raising `ol-type` —
 * `spec/commands.md`'s `randomize` entry lists "Possible errors: none specified beyond general
 * arity diagnostics" (no type diagnostic, unlike most other Core primitives' entries), so a
 * non-number seed argument is accepted, not rejected.
 */
export function seedFromText(text: string): number {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis.
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

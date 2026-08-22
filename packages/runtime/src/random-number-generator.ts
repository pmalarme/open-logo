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
export interface RandomNumberGeneratorState {
  state: number;
}

/**
 * Seed a fresh {@link RandomNumberGeneratorState}. With no `seed` supplied the state falls back to
 * the host clock — the implementation's own choice of seed, per `spec/commands.md`: "with no seed
 * the implementation chooses a seed". `>>> 0` folds any seed (including a negative or fractional
 * one) into the unsigned 32-bit range the generator operates on.
 *
 * That clock fallback is **this package's only ambient entropy source** — no other code in
 * `@openlogo/runtime` reads a wall clock or `Math.random()`, and the tick clock
 * (`interaction.ts`'s `createTickClock`) is a pure counter. So supplying a seed makes an
 * `execute()` call reproducible, *given host collaborators that are themselves deterministic* —
 * `ExecuteOptions.hostInput.read` and `tutorTemplates` are caller-supplied **functions**, so a
 * caller that makes them stateful can still vary a run's outcome, and `signal` is caller-mutable.
 * That is the caller's own doing, not the runtime's. Pinning the seed is what
 * `ExecuteOptions.randomSeed` (issue #865, see `index.ts`) exists to give a host.
 */
export function createRandomNumberGeneratorState(
  seed?: number,
): RandomNumberGeneratorState {
  return { state: (seed ?? Date.now()) >>> 0 };
}

/**
 * Draw the next float in `[0, 1)` from `randomNumberGenerator`, advancing its state in place (the
 * Mulberry32 algorithm). {@link nextRandomInt} is the public entry point every `random` call
 * actually uses; this lower-level draw is exported so a unit test can prove the generator's own
 * determinism directly, without going through the integer-scaling step.
 */
export function nextRandomFloat(
  randomNumberGenerator: RandomNumberGeneratorState,
): number {
  randomNumberGenerator.state =
    (randomNumberGenerator.state + 0x6d2b79f5) >>> 0;
  let mixedState = randomNumberGenerator.state;
  mixedState = Math.imul(mixedState ^ (mixedState >>> 15), mixedState | 1);
  mixedState ^=
    mixedState + Math.imul(mixedState ^ (mixedState >>> 7), mixedState | 61);
  return ((mixedState ^ (mixedState >>> 14)) >>> 0) / 4294967296;
}

/**
 * Draw a whole number in `[min, max]` inclusive from `randomNumberGenerator` — `random n`'s
 * `[0, n-1]` is the `min: 0, max: n-1` case of `(random a b)`'s general inclusive range
 * (`spec/commands.md`'s `random` entry).
 */
export function nextRandomInt(
  randomNumberGenerator: RandomNumberGeneratorState,
  min: number,
  max: number,
): number {
  return (
    min + Math.floor(nextRandomFloat(randomNumberGenerator) * (max - min + 1))
  );
}

/**
 * The stride a no-argument `randomize` advances the generator's state by ({@link
 * drawImplementationSeed}). Any **odd** constant makes that advance a bijection on the unsigned
 * 32-bit state, so repeated `randomize` visits all 2^32 states before repeating — the property that
 * matters here. This particular value is the 32-bit golden-ratio constant, chosen only because it
 * is the conventional one for this job and is deliberately *different* from the generator's own
 * per-draw increment, so `randomize` is not merely "skip one draw".
 */
const IMPLEMENTATION_RESEED_STRIDE = 0x9e3779b9;

/**
 * Choose the implementation's *own* next seed for a no-argument `randomize`
 * (`spec/execution-model.md:596-597`: "`randomize` with no input uses an implementation seed";
 * `spec/commands.md`'s `randomize` entry: "with no seed the implementation chooses a seed"). Both
 * leave that choice entirely to the implementation, so deriving it from the generator's current
 * state is conforming.
 *
 * Deriving it — rather than reading the clock, which is what a bare `randomize` did before issue
 * #865 — is what makes a **seeded** run deterministic all the way through: such a program would
 * otherwise re-enter wall-clock entropy and undo the pinned
 * {@link createRandomNumberGeneratorState} seed, which is precisely why issue #881 recorded that a
 * host seed alone "is not sufficient on its own". An **unseeded** run is unaffected and retains the
 * prior clock-seeded behavior exactly, because its initial state is still the clock and every seed
 * derived from it descends from that. It also removes a real defect the clock had: two bare
 * `randomize` calls landing within the same millisecond reseeded to the *identical* state, so
 * `randomize` twice produced the very same sequence twice.
 *
 * **Why the state is advanced rather than replaced by a drawn value.** The obvious derivation —
 * feeding {@link nextRandomInt}'s output back in as the new state — is **not injective**: it maps
 * the 32-bit state space through the avalanche mix onto itself, so iterating it walks a rho and
 * settles into a short cycle. Measured on this generator, repeated bare `randomize` entered cycles
 * of period **8,398** (from seed 42) and **42,379** (from seed 0), which would quietly degrade
 * `random` for a program that reseeds in a loop. Adding an odd stride to the counter keeps the full
 * 2^32 period, and costs less. Mulberry32 is itself a counter-based generator (`state += constant`,
 * then mix), so this stays squarely within its design rather than working against it — the mixing
 * that makes successive outputs look independent happens in {@link nextRandomFloat}, not here.
 */
export function drawImplementationSeed(
  randomNumberGenerator: RandomNumberGeneratorState,
): number {
  return (randomNumberGenerator.state + IMPLEMENTATION_RESEED_STRIDE) >>> 0;
}

/**
 * Turn any {@link OLValue}-shaped seed into a deterministic unsigned 32-bit random-number-generator
 * state: an integer seed is folded directly (`>>> 0`), matching the intuitive "same number in,
 * same sequence out" expectation; any other type (word/list/boolean, or a non-integer number) is
 * hashed from its printed form (FNV-1a, another small/public-domain algorithm) instead of raising
 * `ol-type` — `spec/commands.md`'s `randomize` entry lists "Possible errors: none specified beyond
 * general arity diagnostics" (no type diagnostic, unlike most other Core primitives' entries), so
 * a non-number seed argument is accepted, not rejected.
 */
export function seedFromText(text: string): number {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis.
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

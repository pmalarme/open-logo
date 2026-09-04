/**
 * The Sound profile's shared, mutable scheduling state (issue #689,
 * [`spec/interaction-events.md`](../../../spec/interaction-events.md)'s "Sound primitives"
 * section). Today it holds only the tempo, which `set_tempo` writes and emits as its own `sound`
 * event; `note`/`play`/`rest` emit their durations in beats and do not read it. It is modeled
 * headlessly: the runtime only *schedules* sound (updating this state and emitting a `sound` trace
 * event), it never touches an audio device, so durations here are always in **beats**, never
 * wall-clock, keeping replay deterministic — "Implementations that cannot play audio, or that run
 * in a muted classroom environment, MUST still emit `sound` events"
 * (`spec/interaction-events.md`).
 */

/**
 * The Sound profile's mutable state — currently just the current tempo. A plain mutable box
 * (mirroring `evaluate.ts`'s `Environment.instructionCount`/`addressing` and
 * `random-number-generator.ts`'s `RandomNumberGeneratorState`) rather than a value replaced on
 * every change.
 */
export interface SoundState {
  /** The current tempo in beats per minute; a positive number (`set_tempo`'s `ol-range` guard). */
  tempo: number;
}

/**
 * The tempo before any `set_tempo` runs: "The default tempo is 120 beats per minute"
 * (`spec/interaction-events.md:340-341`).
 */
export const DEFAULT_TEMPO = 120;

/**
 * A fresh {@link SoundState} at the program-start default tempo ({@link DEFAULT_TEMPO}). Called once
 * per run when the execution environment is built, so every program begins at 120 bpm regardless of
 * any earlier run's `set_tempo`.
 */
export function createSoundState(): SoundState {
  return { tempo: DEFAULT_TEMPO };
}

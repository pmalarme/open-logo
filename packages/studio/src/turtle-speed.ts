/**
 * The turtle-speed slider → per-tick animation delay mapping (#310). Studio exposes a single
 * "speed" slider ranging from slow to fast, **plus** a dedicated "instant / no animation" end —
 * this module is the one tested place that decides what a raw slider position actually means, so
 * `run-controller.ts` and `web/main.ts` never branch on a slider value themselves
 * (`web/main.ts` stays a thin, branch-free wiring layer per this package's working rules).
 *
 * ## The mapping
 * A slider position is a plain number in `[SPEED_SLIDER_MIN, SPEED_SLIDER_MAX]` (matching a real
 * `<input type="range" min="0" max="100">`). Every value strictly below {@link SPEED_SLIDER_MAX}
 * is a **paced** speed: {@link mapSpeedSliderValueToTickDelayMs} linearly interpolates between
 * {@link SLOWEST_TICK_DELAY_MS} (at `SPEED_SLIDER_MIN`) and {@link FASTEST_PACED_TICK_DELAY_MS}
 * (at `SPEED_SLIDER_MAX - 1`, the fastest **paced** step) — the higher the slider value, the
 * shorter the delay between ticks. `SPEED_SLIDER_MAX` itself is a distinct, dedicated stop beyond
 * "fast": it maps to {@link INSTANT_TICK_DELAY_MS} (`0`), meaning no per-tick delay at all — the
 * acceptance criterion's "figure is drawn with no per-tick delay (`delayMs = 0`)".
 *
 * ## Consuming the mapping
 * - {@link isInstantTickDelay} tells a caller whether a mapped delay means "instant" (`<= 0`)
 *   rather than a genuine pace — `run-controller.ts` uses this to decide whether a run should
 *   play back paced (`TurtleAnimationController.run()`) or drain instantly
 *   (`TurtleAnimationController.seekToEnd()`, via `@openlogo/turtle`'s
 *   `playWithMotionPreference`), the exact same mechanism already used for the OS
 *   `prefers-reduced-motion` preference — the instant slider position **complements** that
 *   existing reduced-motion path (both feed the same `reducedMotion` boolean, combined with `||`)
 *   rather than replacing it.
 * - {@link tickDelayMsToStepsPerSecond} converts a **paced** (non-instant) tick delay into the
 *   `stepsPerSecond` pacing speed `TurtleAnimationController.setSpeed`/its constructor option
 *   expects, so that controller's own internally computed per-call `delayMs` (passed to whatever
 *   `Scheduler` studio injects) works out to exactly the delay this module mapped — callers should
 *   only invoke this for a tick delay that {@link isInstantTickDelay} reports as `false`.
 * - {@link describeSpeedTickDelayMs} renders a short, learner-facing, screen-reader-friendly label
 *   for the current tick delay (e.g. `"Instant (no animation)"` or `"500 ms per step"`) — the
 *   speed control's accessible label text is derived from structured data here, never invented ad
 *   hoc in `web/main.ts`.
 */

/** The slider's minimum position — the slowest paced speed. */
export const SPEED_SLIDER_MIN = 0;

/**
 * The slider's maximum position — the dedicated "instant / no animation" end, distinct from (and
 * one stop beyond) the fastest paced speed.
 */
export const SPEED_SLIDER_MAX = 100;

/** A moderate, middle-of-the-range default a new studio session starts at. */
export const DEFAULT_SPEED_SLIDER_VALUE = 50;

/** The per-tick delay (ms) at the slowest paced speed (`SPEED_SLIDER_MIN`). */
export const SLOWEST_TICK_DELAY_MS = 1000;

/**
 * The per-tick delay (ms) at the fastest **paced** speed — i.e. one slider position below
 * {@link SPEED_SLIDER_MAX}, which instead means "instant" ({@link INSTANT_TICK_DELAY_MS}).
 */
export const FASTEST_PACED_TICK_DELAY_MS = 20;

/** The tick delay meaning "instant / no animation": no per-tick pacing at all. */
export const INSTANT_TICK_DELAY_MS = 0;

/** Clamps `sliderValue` into `[SPEED_SLIDER_MIN, SPEED_SLIDER_MAX]`. */
function clampSliderValue(sliderValue: number): number {
  return Math.min(SPEED_SLIDER_MAX, Math.max(SPEED_SLIDER_MIN, sliderValue));
}

/**
 * Maps a raw speed-slider position to a per-tick animation delay in milliseconds. Out-of-range
 * input is clamped rather than treated as an error — speed is presentation pacing, not a
 * source-level input, matching `@openlogo/turtle`'s own `clampSpeed`'s reasoning for
 * `TurtleAnimationController.setSpeed`.
 *
 * `SPEED_SLIDER_MAX` (and anything clamped up to it) always returns {@link INSTANT_TICK_DELAY_MS}
 * (`0`) — the dedicated "instant / no animation" end. Every other position linearly interpolates
 * between {@link SLOWEST_TICK_DELAY_MS} (slowest, at `SPEED_SLIDER_MIN`) and
 * {@link FASTEST_PACED_TICK_DELAY_MS} (fastest paced, at `SPEED_SLIDER_MAX - 1`).
 */
export function mapSpeedSliderValueToTickDelayMs(sliderValue: number): number {
  const clampedValue = clampSliderValue(sliderValue);
  if (clampedValue >= SPEED_SLIDER_MAX) {
    return INSTANT_TICK_DELAY_MS;
  }
  const pacedSliderRange = SPEED_SLIDER_MAX - SPEED_SLIDER_MIN - 1;
  const fraction = (clampedValue - SPEED_SLIDER_MIN) / pacedSliderRange;
  const pacedDelayRange = SLOWEST_TICK_DELAY_MS - FASTEST_PACED_TICK_DELAY_MS;
  return Math.round(SLOWEST_TICK_DELAY_MS - fraction * pacedDelayRange);
}

/** Whether a mapped tick delay means "instant / no animation" rather than a genuine pace. */
export function isInstantTickDelay(tickDelayMs: number): boolean {
  return tickDelayMs <= INSTANT_TICK_DELAY_MS;
}

/**
 * Converts a **paced** (non-instant) tick delay into the `stepsPerSecond` pacing speed
 * `@openlogo/turtle`'s `TurtleAnimationController` expects, so its own per-call `delayMs`
 * (`1000 / stepsPerSecond`) reconstructs exactly the delay this module mapped. Only meaningful for
 * a tick delay {@link isInstantTickDelay} reports as `false` — callers must not invoke this for an
 * instant (`<= 0`) delay, which is handled entirely through `seekToEnd()`/`reducedMotion` instead
 * (see this module's doc comment).
 */
export function tickDelayMsToStepsPerSecond(tickDelayMs: number): number {
  return 1000 / tickDelayMs;
}

/**
 * A short, learner-facing, screen-reader-friendly description of a tick delay — the speed
 * control's accessible label text, derived from structured data rather than invented ad hoc by a
 * caller.
 */
export function describeSpeedTickDelayMs(tickDelayMs: number): string {
  return isInstantTickDelay(tickDelayMs)
    ? "Instant (no animation)"
    : `${tickDelayMs} ms per step`;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import * as OL from "@openlogo/studio";

const {
  SPEED_SLIDER_MIN,
  SPEED_SLIDER_MAX,
  DEFAULT_SPEED_SLIDER_VALUE,
  SLOWEST_TICK_DELAY_MS,
  FASTEST_PACED_TICK_DELAY_MS,
  INSTANT_TICK_DELAY_MS,
  mapSpeedSliderValueToTickDelayMs,
  isInstantTickDelay,
  tickDelayMsToStepsPerSecond,
  describeSpeedTickDelayMs,
} = OL;

test("mapSpeedSliderValueToTickDelayMs maps the minimum slider value to the slowest tick delay", () => {
  assert.equal(
    mapSpeedSliderValueToTickDelayMs(SPEED_SLIDER_MIN),
    SLOWEST_TICK_DELAY_MS,
  );
});

test("mapSpeedSliderValueToTickDelayMs maps the maximum slider value to the instant tick delay", () => {
  assert.equal(
    mapSpeedSliderValueToTickDelayMs(SPEED_SLIDER_MAX),
    INSTANT_TICK_DELAY_MS,
  );
});

test("mapSpeedSliderValueToTickDelayMs maps one below the maximum to the fastest paced tick delay", () => {
  assert.equal(
    mapSpeedSliderValueToTickDelayMs(SPEED_SLIDER_MAX - 1),
    FASTEST_PACED_TICK_DELAY_MS,
  );
});

test("mapSpeedSliderValueToTickDelayMs interpolates linearly for a mid-range value", () => {
  const midpoint = (SPEED_SLIDER_MIN + (SPEED_SLIDER_MAX - 1)) / 2;
  const tickDelayMs = mapSpeedSliderValueToTickDelayMs(midpoint);
  assert.ok(tickDelayMs < SLOWEST_TICK_DELAY_MS);
  assert.ok(tickDelayMs > FASTEST_PACED_TICK_DELAY_MS);
});

test("mapSpeedSliderValueToTickDelayMs clamps a value below the minimum", () => {
  assert.equal(
    mapSpeedSliderValueToTickDelayMs(SPEED_SLIDER_MIN - 50),
    SLOWEST_TICK_DELAY_MS,
  );
});

test("mapSpeedSliderValueToTickDelayMs clamps a value above the maximum", () => {
  assert.equal(
    mapSpeedSliderValueToTickDelayMs(SPEED_SLIDER_MAX + 50),
    INSTANT_TICK_DELAY_MS,
  );
});

test("mapSpeedSliderValueToTickDelayMs is monotonically non-increasing across the paced range", () => {
  let previousTickDelayMs = Number.POSITIVE_INFINITY;
  for (
    let sliderValue = SPEED_SLIDER_MIN;
    sliderValue < SPEED_SLIDER_MAX;
    sliderValue += 1
  ) {
    const tickDelayMs = mapSpeedSliderValueToTickDelayMs(sliderValue);
    assert.ok(tickDelayMs <= previousTickDelayMs);
    previousTickDelayMs = tickDelayMs;
  }
});

test("DEFAULT_SPEED_SLIDER_VALUE is a paced (non-instant) position within the slider range", () => {
  assert.ok(DEFAULT_SPEED_SLIDER_VALUE >= SPEED_SLIDER_MIN);
  assert.ok(DEFAULT_SPEED_SLIDER_VALUE < SPEED_SLIDER_MAX);
});

test("isInstantTickDelay reports true for the instant tick delay", () => {
  assert.equal(isInstantTickDelay(INSTANT_TICK_DELAY_MS), true);
});

test("isInstantTickDelay reports true for a negative tick delay", () => {
  assert.equal(isInstantTickDelay(-5), true);
});

test("isInstantTickDelay reports false for any paced tick delay", () => {
  assert.equal(isInstantTickDelay(FASTEST_PACED_TICK_DELAY_MS), false);
  assert.equal(isInstantTickDelay(SLOWEST_TICK_DELAY_MS), false);
});

test("tickDelayMsToStepsPerSecond converts a paced tick delay to the matching steps-per-second", () => {
  assert.equal(tickDelayMsToStepsPerSecond(100), 10);
  assert.equal(
    tickDelayMsToStepsPerSecond(FASTEST_PACED_TICK_DELAY_MS),
    1000 / FASTEST_PACED_TICK_DELAY_MS,
  );
});

test("describeSpeedTickDelayMs describes the instant tick delay in learner-facing text", () => {
  assert.equal(
    describeSpeedTickDelayMs(INSTANT_TICK_DELAY_MS),
    "Instant (no animation)",
  );
});

test("describeSpeedTickDelayMs describes a paced tick delay in learner-facing text", () => {
  assert.equal(describeSpeedTickDelayMs(250), "250 ms per step");
});

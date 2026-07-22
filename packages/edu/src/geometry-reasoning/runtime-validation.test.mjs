import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeTurtlePathClosure,
  reasonAboutArc,
  reasonAboutCircle,
  reasonAboutPolygon,
  reasonAboutStar,
} from "@openlogo/edu";
import * as Runtime from "@openlogo/runtime";

/**
 * Cross-validates the formula-based reasoning functions against a *real* execution of the
 * geometry stdlib source (`stdlib/geometry/*.logo`, inlined verbatim below), so this reasoning
 * is proven against the actual runtime and not just against its own formulas
 * (`.github/instructions/edu.instructions.md`'s "Reasoning is deterministic and offline" plus the
 * team agreement's "prove behavior with conformance fixtures, not prose").
 */

const POLYGON_SOURCE = `define polygon :sides :size
  if :sides < 3
    throw "a polygon needs at least 3 sides"
  end if
  if not (:sides == int :sides)
    throw "a polygon needs a whole number of sides"
  end if
  repeat :sides
    forward :size
    right 360 / :sides
  end repeat
end
polygon 5 100`;

const STAR_SOURCE = `define star :points :size (:step 2)
  if not (:points == int :points)
    throw "a star needs a whole number of points"
  end if
  if not (:step is strictly between 1 and :points)
    throw "a star step must be a whole number between 2 and one less than the number of points"
  end if
  if not (:step == int :step)
    throw "a star step must be a whole number"
  end if
  repeat :points
    forward :size
    right 360 * :step / :points
  end repeat
end
star 5 100`;

const CIRCLE_SOURCE = `define circle :radius (:segments 36)
  local side
  if :radius <= 0
    throw "a circle needs a positive radius"
  end if
  if :segments < 3
    throw "a circle needs at least 3 segments"
  end if
  if not (:segments == int :segments)
    throw "a circle needs a whole number of segments"
  end if
  :side = 2 * :radius * sin (180 / :segments)
  repeat :segments
    forward :side
    right 360 / :segments
  end repeat
end
circle 50`;

const ARC_SOURCE = `define arc :angle :radius
  local segments
  local step_angle
  local step_length
  if :angle < 0
    throw "an arc needs an angle of 0 or more"
  end if
  if :radius <= 0
    throw "an arc needs a positive radius"
  end if
  :segments = (int (:angle / 5)) + 1
  :step_angle = :angle / :segments
  :step_length = 2 * :radius * sin (:step_angle / 2)

  left :step_angle / 2
  repeat :segments
    forward :step_length
    left :step_angle
  end repeat
  right :step_angle / 2
end
arc 90 50`;

function executeEvents(source) {
  const { events, diagnostics } = Runtime.execute(source, "main.logo");
  assert.deepEqual(diagnostics, []);
  return events;
}

/** The heading left on the turtle after the last `turn` event in `events`. */
function finalHeadingFromEvents(events) {
  const turnEvents = events.filter((event) => event.kind === "turn");
  return turnEvents[turnEvents.length - 1].payload.to;
}

test("reasonAboutPolygon's turnTotal and closure match a real `polygon 5 100` execution", () => {
  const events = executeEvents(POLYGON_SOURCE);
  const formula = reasonAboutPolygon(5);
  const fromTrace = analyzeTurtlePathClosure(events);
  assert.equal(formula.turnTotal, fromTrace.turnTotal);
  assert.equal(formula.closes, fromTrace.closes);
  assert.equal(finalHeadingFromEvents(events), 0);
});

test("reasonAboutStar's turnTotal and closure match a real `star 5 100` execution", () => {
  const events = executeEvents(STAR_SOURCE);
  const formula = reasonAboutStar(5);
  const fromTrace = analyzeTurtlePathClosure(events);
  assert.equal(formula.turnTotal, fromTrace.turnTotal);
  assert.equal(formula.closes, fromTrace.closes);
  assert.equal(finalHeadingFromEvents(events), 0);
});

test("reasonAboutCircle's turnTotal and closure match a real `circle 50` execution", () => {
  const events = executeEvents(CIRCLE_SOURCE);
  const formula = reasonAboutCircle(50);
  const fromTrace = analyzeTurtlePathClosure(events);
  assert.equal(formula.turnTotal, fromTrace.turnTotal);
  assert.equal(formula.closes, fromTrace.closes);
  assert.equal(finalHeadingFromEvents(events), 0);
});

test("reasonAboutArc's finalHeading matches the heading left by a real `arc 90 50` execution starting at heading 0", () => {
  const events = executeEvents(ARC_SOURCE);
  const formula = reasonAboutArc(90, 50, 0);
  const actualFinalHeading = finalHeadingFromEvents(events);
  assert.ok(Math.abs(formula.finalHeading - actualFinalHeading) < 1e-9);
});

/**
 * `@openlogo/edu`'s deterministic geometric-reasoning primitives — the geometry-teacher's
 * structured-data output contract (`.github/skills/geometry-teacher/geometry-reasoning/SKILL.md`,
 * `spec/geometry-module.md`). Every export here is a pure function over plain numbers or the
 * `@openlogo/core` trace-event stream; none of them draw, mutate state, call an AI provider, or
 * emit learner-facing prose — `@ai-tutor` and `@openlogo/studio` are the layers that phrase this
 * data for a learner.
 */

export type {
  ClosureMisconceptionSignal,
  GeometryReasoningConcept,
} from "./types.js";

export {
  clockwiseTurnDelta,
  degreesToRadians,
  isMultipleOf360,
  normalizeDegrees,
  sumClockwiseTurns,
} from "./degree-math.js";

export { reasonAboutPolygon } from "./polygon-reasoning.js";
export type { PolygonReasoning } from "./polygon-reasoning.js";

export { reasonAboutStar } from "./star-reasoning.js";
export type { StarReasoning } from "./star-reasoning.js";

export { reasonAboutCircle } from "./circle-reasoning.js";
export type { CircleReasoning } from "./circle-reasoning.js";

export { reasonAboutArc } from "./arc-reasoning.js";
export type { ArcReasoning } from "./arc-reasoning.js";

export { analyzeTurtlePathClosure } from "./path-closure-reasoning.js";
export type { TurtlePathClosureReasoning } from "./path-closure-reasoning.js";

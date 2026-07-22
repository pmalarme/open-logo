/**
 * `@openlogo/edu` — learner levels, the deterministic `explain`/`why`/`hint`/`debug` commands,
 * the geometry standard library (discoverable OpenLogo source), the Socratic AI tutor, and the
 * curriculum. Depends on `@openlogo/core` and `@openlogo/runtime`.
 *
 * Issue #189 fixed the read-only `Lesson`/`WorkedExample` data contract. Issue #328 adds the
 * first curriculum content on top of it — Level 1 and Level 2 lessons plus graded `Exercise`s
 * (`./lessons/level-1.ts`, `./lessons/level-2.ts`) — aggregated by `./lessons/registry.ts` into
 * the flat `LESSONS`/`EXERCISES` lists re-exported below. Issue #325 adds Level 3
 * (`./lessons/level-3.ts`, variables). Later levels (B3/B4) add their own `level-N.ts` module and
 * extend the registry additively. The educational meta-commands, geometry stdlib, and AI tutor
 * land in later slices.
 */

/** Marker export so the M0 skeleton is a real ES module; replaced by real exports later. */
export const EDU_PACKAGE = "@openlogo/edu";

export {
  isLearnerLevel,
  isLesson,
  isWorkedExample,
  LEARNER_LEVELS,
} from "./lesson.js";
export type { Lesson, LearnerLevel, WorkedExample } from "./lesson.js";

// A0 (#324): the tutor-output event kind's data-only input/output contracts, shared by the
// A1-A5 slices that give `explain`/`why`/`hint`/`debug` their parser recognition, runtime
// dispatch, and templates. Append-only — this export list is serialized with other in-flight
// edu work (#189 lesson contract, M4 geometry stdlib).
export type {
  TutorCommandMetadata,
  TutorContext,
  TutorLearnerLevel,
  TutorOutput,
} from "./tutor-context.js";

export {
  EXERCISE_DIFFICULTIES,
  isExercise,
  isExerciseDifficulty,
} from "./lessons/exercise.js";
export type { Exercise, ExerciseDifficulty } from "./lessons/exercise.js";

export {
  EXERCISES,
  findExerciseById,
  findLessonById,
  getExercisesByLesson,
  getExercisesByLevel,
  getLessonsByLevel,
  LESSONS,
} from "./lessons/registry.js";

// A3 (#336): the deterministic, offline, template-based `explain`/`why` baseline meta-commands
// (`spec/educational-model.md#explain`, `#why`). Pure functions over the A0 `TutorContext`
// contract above — append-only alongside A4/A5's sibling exports.
export { explain, why } from "./tutor/explain-why.js";

// A4 (#333): the baseline, deterministic `hint` template — a pure TutorContext -> TutorOutput
// mapping implementing the nudge -> concept -> partial -> last-resort progression
// (spec/educational-model.md#hint). No AI, no mutable state; stage progression is threaded in
// via TutorContext.priorHintStage by the runtime dispatch slice (A2, #332).
export { hint } from "./tutor/hint.js";

// A5 (#335): the deterministic, offline, template-based `debug` baseline meta-command.
export { debug } from "./debug.js";

// #342: @geometry-teacher's deterministic geometric-reasoning primitives — exterior angle,
// turn total, closure, and heading facts as structured data, plus a stable-id misconception
// signal for a non-closing path. No AI, no prose, no new trace-event kinds — pure functions over
// shape parameters or the existing `@openlogo/core` trace-event stream
// (`.github/skills/geometry-teacher/geometry-reasoning/SKILL.md`). Append-only, like the exports
// above it.
export type {
  ArcReasoning,
  CircleReasoning,
  ClosureMisconceptionSignal,
  GeometryReasoningConcept,
  PolygonReasoning,
  StarReasoning,
  TurtlePathClosureReasoning,
} from "./geometry-reasoning/index.js";
export {
  analyzeTurtlePathClosure,
  clockwiseTurnDelta,
  degreesToRadians,
  isMultipleOf360,
  normalizeDegrees,
  reasonAboutArc,
  reasonAboutCircle,
  reasonAboutPolygon,
  reasonAboutStar,
  sumClockwiseTurns,
} from "./geometry-reasoning/index.js";

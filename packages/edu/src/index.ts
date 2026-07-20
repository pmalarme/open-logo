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

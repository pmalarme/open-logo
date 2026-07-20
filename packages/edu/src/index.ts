/**
 * `@openlogo/edu` — learner levels, the deterministic `explain`/`why`/`hint`/`debug` commands,
 * the geometry standard library (discoverable OpenLogo source), the Socratic AI tutor, and the
 * curriculum. Depends on `@openlogo/core` and `@openlogo/runtime`.
 *
 * The educational commands and geometry stdlib land in later slices; this is the M0 skeleton.
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

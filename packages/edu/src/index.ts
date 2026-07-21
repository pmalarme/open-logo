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

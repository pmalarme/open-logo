/**
 * The graded-exercise contract, additive to the read-only `Lesson` shape
 * (`../lesson.ts`, issue #189). `Lesson` intentionally carries a single `exercisePrompt`
 * string — it is a data-only contract for the studio lesson pane and does not model a
 * difficulty ramp or a checkable reference solution. This module adds that on top, without
 * touching or duplicating the frozen `Lesson` contract: an `Exercise` always names the
 * `Lesson` it belongs to (`lessonId`), so one lesson can be paired with several graded
 * exercises that ramp from guided to open, per `spec/educational-model.md`'s "change one
 * thing at a time" guidance (see e.g. educational-model.md:87).
 */

import type { LearnerLevel, WorkedExample } from "../lesson.js";
import { isLearnerLevel, isWorkedExample } from "../lesson.js";

/**
 * The three-step difficulty ramp a lesson's exercises climb: `"guided"` names exactly what to
 * change, `"practice"` asks the learner to apply the same idea to a new but similar situation,
 * and `"challenge"` asks for a more open-ended combination of concepts already introduced at
 * the exercise's level.
 */
export const EXERCISE_DIFFICULTIES = [
  "guided",
  "practice",
  "challenge",
] as const;

/** One rung of the {@link EXERCISE_DIFFICULTIES} ramp. */
export type ExerciseDifficulty = (typeof EXERCISE_DIFFICULTIES)[number];

/** Reports whether `value` is one of the normative {@link ExerciseDifficulty} identifiers. */
export function isExerciseDifficulty(
  value: unknown,
): value is ExerciseDifficulty {
  return (
    typeof value === "string" &&
    (EXERCISE_DIFFICULTIES as readonly string[]).includes(value)
  );
}

/**
 * A single graded exercise: a prompt tied to a {@link LearnerLevel} and a rung of the
 * {@link ExerciseDifficulty} ramp, plus a runnable reference solution the exercise is
 * validated against (this package's tests execute every `referenceSolution.source` through
 * `@openlogo/runtime` to guarantee it never drifts from real behavior).
 */
export interface Exercise {
  /** A stable, unique identifier for this exercise (e.g. `"l2-square-repeat-count"`). */
  readonly id: string;
  /** The `Lesson.id` this exercise belongs to. */
  readonly lessonId: string;
  /** The learner level this exercise's prompt is tied to. */
  readonly level: LearnerLevel;
  /** Where this exercise sits on the guided-to-open difficulty ramp. */
  readonly difficulty: ExerciseDifficulty;
  /** What the learner is asked to do, changing one thing at a time. */
  readonly prompt: string;
  /** A runnable, annotated OpenLogo solution to the prompt, validated against the runtime. */
  readonly referenceSolution: WorkedExample;
}

/**
 * A structural type guard for {@link Exercise}, mirroring `isLesson`'s shallow-plus-nested
 * shape check for consumers that load exercise content from an untyped source.
 */
export function isExercise(value: unknown): value is Exercise {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.lessonId === "string" &&
    isLearnerLevel(candidate.level) &&
    isExerciseDifficulty(candidate.difficulty) &&
    typeof candidate.prompt === "string" &&
    isWorkedExample(candidate.referenceSolution)
  );
}

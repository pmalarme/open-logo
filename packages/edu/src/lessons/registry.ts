/**
 * The lesson/exercise registry (issue #328): the single place that aggregates every level's
 * content into flat, level-ordered lists. Later slices (B2/B3/B4 — issues #325/#326/#327) add
 * their own `level-N.ts` module exporting `levelNLessons`/`levelNExercises` and append them
 * here; this keeps each level's authoring additive (a new module + one import/spread pair)
 * instead of every slice editing a shared, ever-growing lesson literal.
 */

import type { Lesson } from "../lesson.js";
import type { Exercise } from "./exercise.js";
import { level1Exercises, level1Lessons } from "./level-1.js";
import { level2Exercises, level2Lessons } from "./level-2.js";
import { level3Exercises, level3Lessons } from "./level-3.js";

/** Every authored {@link Lesson}, in level order. */
export const LESSONS: readonly Lesson[] = [
  ...level1Lessons,
  ...level2Lessons,
  ...level3Lessons,
];

/** Every authored {@link Exercise}, in level order. */
export const EXERCISES: readonly Exercise[] = [
  ...level1Exercises,
  ...level2Exercises,
  ...level3Exercises,
];

/** Returns every {@link Lesson} tied to `level`, in registry order. */
export function getLessonsByLevel(level: Lesson["level"]): readonly Lesson[] {
  return LESSONS.filter((lesson) => lesson.level === level);
}

/** Returns every {@link Exercise} tied to `level`, in registry order. */
export function getExercisesByLevel(
  level: Exercise["level"],
): readonly Exercise[] {
  return EXERCISES.filter((exercise) => exercise.level === level);
}

/** Returns every {@link Exercise} that belongs to the lesson identified by `lessonId`. */
export function getExercisesByLesson(lessonId: string): readonly Exercise[] {
  return EXERCISES.filter((exercise) => exercise.lessonId === lessonId);
}

/** Returns the {@link Lesson} with the given `id`, or `undefined` if none is registered. */
export function findLessonById(id: string): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.id === id);
}

/** Returns the {@link Exercise} with the given `id`, or `undefined` if none is registered. */
export function findExerciseById(id: string): Exercise | undefined {
  return EXERCISES.find((exercise) => exercise.id === id);
}

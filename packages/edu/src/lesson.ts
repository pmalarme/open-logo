/**
 * The lesson-content contract — the single source of truth for a `Lesson` that the studio
 * lesson pane (`@openlogo/studio`, issue #127) reads. It is intentionally **data-only**: no
 * lesson authoring API, no runtime execution, no AI. Those are separate later slices; this
 * slice only fixes the shape so no consumer invents a competing lesson format.
 *
 * The shape follows [`spec/educational-model.md`](../../../spec/educational-model.md), which
 * describes a lesson as teaching one **objective** linked to a learner level, showing one or
 * more **worked examples** (annotated OpenLogo the learner can read/run — see the `explain`
 * template at educational-model.md:447-457), and setting an **exercise prompt** that asks the
 * learner to change one thing at a time (educational-model.md:85). Per educational-model.md:35
 * and :530, a lesson's worked examples must use only concepts already introduced at its level
 * and must never smuggle in a later-level command as a shortcut — this contract does not
 * enforce that (it is a data shape, not a validator), but authors filling it in must honor it.
 */

/**
 * The normative learner-level identifiers from `spec/educational-model.md`'s "8 progressive
 * LEVELS". Level 7 (data structures) and level 8 (algorithms) are each split into named parts
 * (7a/7b/7c, 8a/8b) so a lesson can point at exactly the sub-concept it teaches. Kept as data
 * (`as const`) so {@link LearnerLevel} derives from it, matching the `@openlogo/core` pattern
 * used for `OL_EVENT_KINDS` / `OL_DIAGNOSTIC_CODES`.
 */
export const LEARNER_LEVELS = [
  "1", // movement and drawing
  "2", // patterns and repetition
  "3", // variables
  "4", // conditions
  "5", // functions and procedures
  "6", // geometry and mathematics
  "7a", // lists
  "7b", // dictionaries
  "7c", // records
  "8a", // recursion
  "8b", // comprehensions and destructuring
] as const;

/** One of the 8 progressive learner levels (with 7a/7b/7c and 8a/8b sub-levels). */
export type LearnerLevel = (typeof LEARNER_LEVELS)[number];

/** Reports whether `value` is one of the normative {@link LearnerLevel} identifiers. */
export function isLearnerLevel(value: unknown): value is LearnerLevel {
  return (
    typeof value === "string" &&
    (LEARNER_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * A worked example the learner can read and run: an annotated OpenLogo snippet plus the
 * plain-language "why" that explains it, mirroring the `# why:` comment convention used
 * throughout educational-model.md's own examples.
 */
export interface WorkedExample {
  /** The annotated OpenLogo source the learner can read and run, e.g. including a `# why:` comment. */
  readonly source: string;
  /** The plain-language explanation of what the example shows and why, for learner or teacher reading. */
  readonly explanation: string;
}

/**
 * A single lesson: one objective, tied to one learner level, shown through one or more worked
 * examples, followed by an exercise prompt. This is the read-only contract the studio lesson
 * pane (#127) renders — it must not define its own lesson shape.
 *
 * Every field is `readonly`, and {@link WorkedExample} is likewise read-only, so a `Lesson`
 * value is deep-immutable at the type level: no consumer can reassign a field or push a new
 * worked example onto the array without a type error.
 */
export interface Lesson {
  /** A stable, unique identifier for this lesson (e.g. `"l2-square-repeat"`). */
  readonly id: string;
  /** The learner-facing lesson title. */
  readonly title: string;
  /** The learner level this lesson's objective is tied to. */
  readonly level: LearnerLevel;
  /** The single idea this lesson teaches, in plain language. */
  readonly objective: string;
  /** One or more annotated, runnable OpenLogo examples that demonstrate the objective. */
  readonly workedExamples: readonly WorkedExample[];
  /** What the learner is asked to try next, changing one thing at a time. */
  readonly exercisePrompt: string;
}

/**
 * A structural type guard for {@link Lesson}, for consumers (such as the studio lesson pane)
 * that load lesson content from an untyped source (e.g. JSON) and need to validate its shape
 * before treating it as a `Lesson`. Performs a shallow-plus-worked-examples shape check; it
 * does not enforce the educational-model pedagogy rules (level-appropriate vocabulary, etc.),
 * which are an authoring-time concern outside this data-only contract.
 */
export function isLesson(value: unknown): value is Lesson {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const workedExamples = candidate.workedExamples;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    isLearnerLevel(candidate.level) &&
    typeof candidate.objective === "string" &&
    Array.isArray(workedExamples) &&
    workedExamples.length > 0 &&
    everyWorkedExample(workedExamples) &&
    typeof candidate.exercisePrompt === "string"
  );
}

/**
 * Reports whether every index of `workedExamples` — including sparse ones — holds a
 * {@link WorkedExample}. `Array.prototype.every` silently skips holes in a sparse array
 * (`new Array(1)` never invokes its callback), which would otherwise let a hole through as if
 * it were a valid worked example; iterating by index catches that.
 */
function everyWorkedExample(workedExamples: unknown[]): boolean {
  for (let index = 0; index < workedExamples.length; index += 1) {
    if (
      !Object.hasOwn(workedExamples, index) ||
      !isWorkedExample(workedExamples[index])
    ) {
      return false;
    }
  }
  return true;
}

/** A structural type guard for {@link WorkedExample}. */
export function isWorkedExample(value: unknown): value is WorkedExample {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.source === "string" &&
    typeof candidate.explanation === "string"
  );
}

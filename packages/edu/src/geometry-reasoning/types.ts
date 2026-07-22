/**
 * Shared types for the geometry-teacher's deterministic geometric-reasoning primitives
 * (`spec/geometry-module.md`, `.github/skills/geometry-teacher/geometry-reasoning/SKILL.md`).
 * Every value here is plain, JSON-serializable, structured data — never learner-facing prose.
 * `@ai-tutor` and `@openlogo/studio` turn this data into Socratic dialogue or UI; this module
 * only computes facts and misconception signals, deterministically and offline.
 */

/** A stable, structural label for one geometric-reasoning fact family. */
export type GeometryReasoningConcept =
  | "polygon-exterior-angle"
  | "star-skip-turn"
  | "circle-inscribed-polygon-approximation"
  | "arc-heading-position"
  | "turtle-path-closure";

/**
 * A structured misconception signal — never prose — a caller can pattern-match on by `id`
 * (the skill's "Detect misconceptions ... label them with stable concept ids"). `turnTotal` and
 * `expectedMultipleOf` state how far off closure is without editorializing about why.
 */
export interface ClosureMisconceptionSignal {
  readonly id: "non-closing-path";
  readonly turnTotal: number;
  readonly expectedMultipleOf: 360;
}

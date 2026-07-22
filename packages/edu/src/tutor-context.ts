/**
 * The shared, data-only input/output contracts the baseline `explain`/`why`/`hint`/`debug`
 * meta-commands consume and produce (`spec/educational-model.md#baseline-meta-commands`).
 *
 * `TutorContext`/`TutorLearnerLevel`/`TutorCommandMetadata` originally lived here (A0, #324) as
 * the intended shared contract between `@openlogo/runtime`'s dispatch (issue #332, A2) and this
 * package's per-command templates (A3/A4/A5) — but `@openlogo/runtime` cannot import
 * `@openlogo/edu` (this package depends on `runtime`, not the other way around), and `runtime` is
 * the sole `tutor-output` event emitter, so a type declared edu-only could never actually reach
 * A2's dispatch code. The M3-orchestrator ruling on issue #332 relocated the three types verbatim
 * to `@openlogo/runtime` (which both packages can reference without a cycle); this file is now a
 * thin re-export so every existing `@openlogo/edu` import path (A3/A4/A5's templates, this
 * package's own `index.ts` barrel) keeps working unchanged. No type's shape changed in the move.
 */

export type {
  TutorCommandMetadata,
  TutorContext,
  TutorLearnerLevel,
} from "@openlogo/runtime";

import type { TutorOutputPayload } from "@openlogo/core";

/**
 * The result a baseline meta-command's template produces, matching
 * `TutorOutputPayload`'s shape exactly (`spec/execution-model.md#tutor-output-educational-profile`)
 * so it can be carried verbatim as the payload of the `tutor-output` event
 * {@link TutorContext}'s command emits immediately after producing this result.
 */
export type TutorOutput = TutorOutputPayload;

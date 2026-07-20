/**
 * The shared, data-only input/output contracts the baseline `explain`/`why`/`hint`/`debug`
 * meta-commands consume and produce (`spec/educational-model.md#baseline-meta-commands`,
 * :420-434). This is a **types-only** contract — no template text, no parsing, no runtime
 * dispatch: those land in A1 (#331, parser recognition), A2 (#332, runtime dispatch), and
 * A3/A4/A5 (the per-command templates). Defining the shape here first lets those slices build
 * against one agreed contract instead of freelancing competing ones.
 */

import type {
  Diagnostic,
  TraceEvent,
  TutorCommand,
  TutorHintStage,
  TutorOutputPayload,
} from "@openlogo/core";
import type { AnyNode } from "@openlogo/parser";

/**
 * One of OpenLogo's curriculum levels (`spec/educational-model.md`'s level table: `"1"`
 * movement, `"2"` repetition, `"3"` variables, `"4"` conditions, `"5"` procedures, `"6"`
 * geometry, `"7a"`/`"7b"`/`"7c"` lists/dictionaries/records, `"8a"`/`"8b"` recursion/
 * comprehensions). `TutorContext` treats this as an opaque identifier the caller supplies — it
 * does not itself model curriculum sequencing, lesson content, or level transitions, which is
 * `@openlogo/edu`'s curriculum contract to define separately.
 */
export type TutorLearnerLevel =
  "1" | "2" | "3" | "4" | "5" | "6" | "7a" | "7b" | "7c" | "8a" | "8b";

/**
 * Known metadata about the primitive or procedure a target instruction calls, when the target
 * is a call the tutor can identify (`spec/educational-model.md:420-434`'s "known command
 * metadata" input). Absent when the target is not a call, or no target is selected.
 */
export interface TutorCommandMetadata {
  /** The callee's canonical name (e.g. `"forward"`, or a learner-defined procedure name). */
  readonly name: string;
  /** The callee's arity (parameter count) as known to the parser/runtime. */
  readonly arity: number;
  /** Whether the callee is a built-in primitive or a learner-defined procedure. */
  readonly kind: "primitive" | "procedure";
}

/**
 * The shared input contract for a baseline meta-command invocation
 * (`spec/educational-model.md:420-434`: "the parsed program, source spans, trace events,
 * diagnostics, and known command metadata"), plus the hint-stage progression state the spec
 * requires a host to track itself (`spec/execution-model.md:640-652` — progression state "is a
 * property of the host implementation, not the wire event itself").
 */
export interface TutorContext {
  /** Which baseline meta-command was invoked. */
  readonly command: TutorCommand;
  /** The full parsed program the invocation occurred within. */
  readonly program: AnyNode;
  /**
   * The selected instruction or statement-range the command's output should describe, when one
   * is selected (`explain`/`why`/`debug` MAY concern the whole program instead, per
   * `spec/execution-model.md:626`'s `target-source-span` rule).
   */
  readonly target?: AnyNode;
  /** The trace/event stream produced by execution so far, in increasing `seq` order. */
  readonly events: readonly TraceEvent[];
  /** The `ol-*` diagnostics produced by execution or analysis so far. */
  readonly diagnostics: readonly Diagnostic[];
  /** The learner's active curriculum level. */
  readonly level: TutorLearnerLevel;
  /** Metadata about the callee the target instruction invokes, when known. */
  readonly commandMetadata?: TutorCommandMetadata;
  /**
   * The previous `hint` stage already shown for this `target`'s span, when `command` is
   * `"hint"` and this is a repeated request — used to compute the next stage in the
   * nudge → concept → partial → last-resort progression (`spec/execution-model.md:640-652`).
   * Absent for a `target` whose progression has not started yet, and irrelevant for
   * `explain`/`why`/`debug`.
   */
  readonly priorHintStage?: TutorHintStage;
}

/**
 * The result a baseline meta-command's template produces, matching
 * `TutorOutputPayload`'s shape exactly (`spec/execution-model.md#tutor-output-educational-profile`)
 * so it can be carried verbatim as the payload of the `tutor-output` event
 * {@link TutorContext}'s command emits immediately after producing this result.
 */
export type TutorOutput = TutorOutputPayload;

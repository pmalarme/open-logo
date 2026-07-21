/**
 * The deterministic, offline, template-based `debug` baseline meta-command
 * (`spec/educational-model.md#debug`, `:512-531`). Given a {@link TutorContext} it produces a
 * {@link TutorOutput} that helps a learner inspect what happened **without exposing
 * implementation stack traces or a complete, ready-to-run solution** — the Educational profile's
 * normative guardrail (`spec/conformance.md#educational`).
 *
 * The spec's baseline behavior for `debug` (`spec/educational-model.md:516-523`) is:
 *
 * - Show the current instruction.
 * - Show relevant variable values.
 * - Show turtle state when useful: position, heading, pen, color, width.
 * - For procedures, show a friendly call path.
 * - For errors, include the stable `ol-*` code and a learner message.
 * - Suggest one next investigation step, not a full fix.
 *
 * Every helper below only reads `context` (the parsed program, the selected `target`, the trace
 * events produced so far, and the diagnostics found so far) — the same context value always
 * folds to the same {@link TutorOutput}, with no timing, randomness, or hidden state.
 */

import {
  isDiagnosticCode,
  type ClearPayload,
  type Diagnostic,
  type DiagnosticCode,
  type ColorChangePayload,
  type DebugDiagnosticTutorOutputPayload,
  type DebugProgramTutorOutputPayload,
  type MovePayload,
  type PenChangePayload,
  type PenState,
  type Point,
  type ProcedureEnterPayload,
  type TraceEvent,
  type TurnPayload,
  type WidthChangePayload,
} from "@openlogo/core";
import type { AnyNode } from "@openlogo/parser";
import type { TutorContext, TutorOutput } from "./tutor-context.js";

/**
 * Learner-facing phrases for the statement kinds `debug` can meet as a `target` when no
 * {@link TutorContext.commandMetadata} is available to name a callee (`commandMetadata` is only
 * populated when the target is itself a call, per its own doc comment). Kept as a lookup rather
 * than a long `switch` so the "current instruction" template stays one line per kind, and any
 * kind absent from this map falls back to a generic, still-accurate description.
 */
const STATEMENT_DESCRIPTIONS: Partial<Record<AnyNode["kind"], string>> = {
  Assign: "sets a variable's value",
  Local: "declares a local variable",
  If: "checks a condition",
  While: "repeats while a condition holds",
  Repeat: "repeats a block a fixed number of times",
  Forever: "repeats a block forever",
  ForIn: "repeats once for each item in a list",
  ForRange: "repeats over a range of numbers",
  ProcedureDef: "defines a procedure",
  Return: "returns a value from a procedure",
  Stop: "stops the current procedure",
  Throw: "raises a learner-defined error",
  Block: "runs a block of instructions",
};

/** A {@link Diagnostic} narrowed to the stable `ol-*` registry `debug` is allowed to cite. */
type OlDiagnostic = Diagnostic & { readonly code: DiagnosticCode };

/** `debug` only ever cites an `ol-*` error — never a style warning, which never stops a run. */
function isOlErrorDiagnostic(
  diagnostic: Diagnostic,
): diagnostic is OlDiagnostic {
  return diagnostic.severity === "error" && isDiagnosticCode(diagnostic.code);
}

/** Compares two `[line, column]` positions: negative if `a` is earlier, positive if later, `0` if equal. */
function comparePositions(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

/** Whether two spans describe the exact same source range. */
function spanEquals(
  a: Diagnostic["source_span"],
  b: Diagnostic["source_span"],
): boolean {
  return (
    a.document === b.document &&
    comparePositions(a.start, b.start) === 0 &&
    comparePositions(a.end, b.end) === 0
  );
}

/**
 * Whether `outer` fully encloses `inner` (same document, `outer.start <= inner.start` and
 * `outer.end >= inner.end`). A statement `target`'s span always encloses the span of the
 * sub-expression that actually raised a diagnostic — e.g. `forward :size`'s `Call` span encloses
 * just the `:size` argument's span that `ol-type` points at — so containment, not equality, is
 * the right test for "this diagnostic belongs to this instruction".
 */
function spanContains(
  outer: Diagnostic["source_span"],
  inner: Diagnostic["source_span"],
): boolean {
  return (
    outer.document === inner.document &&
    comparePositions(outer.start, inner.start) <= 0 &&
    comparePositions(outer.end, inner.end) >= 0
  );
}

/**
 * Picks the `ol-*` error `debug` should explain: when a specific `target` is selected, only the
 * error whose span it encloses (or exactly matches) — never an unrelated error, which would
 * misattribute a failure to an instruction that didn't cause it. When no `target` is selected
 * (the whole program is in view), the first error `debug` was given (`context.diagnostics` is
 * supplied in the host's own deterministic order), since there is no narrower instruction to
 * misattribute it to.
 */
function findRelevantErrorDiagnostic(
  context: TutorContext,
): OlDiagnostic | undefined {
  const errorDiagnostics = context.diagnostics.filter(isOlErrorDiagnostic);
  if (errorDiagnostics.length === 0) {
    return undefined;
  }
  if (context.target === undefined) {
    return errorDiagnostics[0];
  }
  const targetSpan = context.target.source_span;
  return errorDiagnostics.find(
    (diagnostic) =>
      spanEquals(diagnostic.source_span, targetSpan) ||
      spanContains(targetSpan, diagnostic.source_span),
  );
}

/**
 * Names the current instruction (`spec/educational-model.md:518`'s "Show the current
 * instruction"): the callee name when `target` is a call `commandMetadata` identifies, a
 * template phrase for other statement kinds, or a whole-program fallback when nothing is
 * selected.
 */
function describeCurrentInstruction(context: TutorContext): string {
  const { target, commandMetadata } = context;
  if (target === undefined) {
    return "You're looking at the whole program.";
  }
  if (commandMetadata !== undefined) {
    if (commandMetadata.kind === "special-form") {
      return `The current instruction is the \`${commandMetadata.name}\` control form.`;
    }
    if (commandMetadata.kind === "procedure") {
      return `The current instruction calls the \`${commandMetadata.name}\` procedure.`;
    }
    return `The current instruction calls \`${commandMetadata.name}\`.`;
  }
  const description = STATEMENT_DESCRIPTIONS[target.kind];
  if (description !== undefined) {
    return `The current instruction ${description}.`;
  }
  return `The current instruction is a \`${target.kind}\`.`;
}

/**
 * Collects the `:name`s of variables read directly by `target` (`spec/educational-model.md:519`'s
 * "Show relevant variable values"): the name itself when `target` is a bare `:name` read, or
 * every `:name` argument of a call. `debug` has no runtime variable snapshot to read from — only
 * the parsed program, spans, trace events, and diagnostics (`spec/educational-model.md:435`) — so
 * it names the variables in play rather than inventing a value it was never given.
 */
function collectVariableNames(target: AnyNode | undefined): readonly string[] {
  if (target === undefined) {
    return [];
  }
  if (target.kind === "VarRef") {
    return [target.name];
  }
  if (target.kind === "Call" || target.kind === "ParenCall") {
    const names = new Set<string>();
    for (const arg of target.args) {
      if (arg.kind === "VarRef") {
        names.add(arg.name);
      }
    }
    return [...names];
  }
  return [];
}

/** Reads a `string` param off a diagnostic, when present, without assuming its shape. */
function stringParam(diagnostic: Diagnostic, key: string): string | undefined {
  const value = diagnostic.params[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Describes the variables `target` reads, when any (`spec/educational-model.md:519`). When the
 * relevant diagnostic carries `expected`/`actual` type params (as `ol-type` diagnostics do), the
 * segment names the mismatch directly; otherwise it just lists the variables in play so a
 * learner knows where to look next.
 */
function variableValuesSegment(
  context: TutorContext,
  diagnostic: OlDiagnostic | undefined,
): string | undefined {
  const names = collectVariableNames(context.target);
  if (names.length === 0) {
    return undefined;
  }
  const list = names.map((name) => `\`:${name}\``).join(" and ");
  if (diagnostic !== undefined && names.length === 1) {
    const expected = stringParam(diagnostic, "expected");
    const actual = stringParam(diagnostic, "actual");
    if (expected !== undefined && actual !== undefined) {
      return `${list} currently holds a \`${actual}\` value, but this line needs a \`${expected}\`.`;
    }
  }
  return `Variables used here: ${list}.`;
}

/**
 * Folds the trace so far into the turtle state fields `debug` reports when they were ever set
 * (`spec/educational-model.md:520`'s "Show turtle state when useful: position, heading, pen,
 * color, width"). Only the state-bearing event kinds change anything; every other kind is
 * ignored, matching the fold-only-what-matters pattern `@openlogo/turtle`'s state reducer uses
 * for the same event stream.
 */
function turtleStateSegment(events: readonly TraceEvent[]): string | undefined {
  let position: Point | undefined;
  let heading: number | undefined;
  let pen: PenState | undefined;
  let color: string | undefined;
  let width: number | undefined;

  for (const event of events) {
    switch (event.kind) {
      case "move": {
        const payload = event.payload as MovePayload;
        position = payload.to;
        heading = payload.heading;
        break;
      }
      case "turn": {
        heading = (event.payload as TurnPayload).to;
        break;
      }
      case "pen-change": {
        pen = (event.payload as PenChangePayload).to;
        break;
      }
      case "color-change": {
        color = (event.payload as ColorChangePayload).to;
        break;
      }
      case "width-change": {
        width = (event.payload as WidthChangePayload).to;
        break;
      }
      case "clear": {
        // Mirrors `@openlogo/turtle`'s `reduceTurtleState` (`spec/rendering.md`'s "`clear_screen`
        // ... homes the turtle"): a `clear_screen` clear homes position and heading; a plain
        // `clean` clear only clears the drawing and leaves turtle state untouched.
        if ((event.payload as ClearPayload).mode === "clear_screen") {
          position = [0, 0];
          heading = 0;
        }
        break;
      }
      default:
        break;
    }
  }

  if (
    position === undefined &&
    heading === undefined &&
    pen === undefined &&
    color === undefined &&
    width === undefined
  ) {
    return undefined;
  }

  const parts: string[] = [];
  if (position !== undefined) {
    parts.push(`position (${position[0]}, ${position[1]})`);
  }
  if (heading !== undefined) {
    parts.push(`heading ${heading}`);
  }
  if (pen !== undefined) {
    parts.push(`pen ${pen}`);
  }
  if (color !== undefined) {
    parts.push(`color \`${color}\``);
  }
  if (width !== undefined) {
    parts.push(`width ${width}`);
  }
  return `Turtle state so far: ${parts.join(", ")}.`;
}

/**
 * Reconstructs which procedures are still open at the end of the trace
 * (`spec/educational-model.md:521`'s "For procedures, show a friendly call path"): every
 * `procedure-enter` pushes its callee's name, every `procedure-exit` pops one — the same
 * enter/exit pairing the trace/event contract itself guarantees
 * (`spec/execution-model.md:606-648`) — leaving only the frames still active. When the target
 * itself is a completed procedure call (its enter/exit pair already closed, so no frame is left
 * open), the target's own `commandMetadata` still names the procedure it invoked — showing that
 * single-name path is more useful to a learner than showing nothing.
 */
function callPathSegment(context: TutorContext): string | undefined {
  const openFrames: string[] = [];
  for (const event of context.events) {
    if (event.kind === "procedure-enter") {
      openFrames.push((event.payload as ProcedureEnterPayload).name);
    } else if (event.kind === "procedure-exit") {
      openFrames.pop();
    }
  }
  if (openFrames.length > 0) {
    return `Call path: ${openFrames.map((name) => `\`${name}\``).join(" → ")}.`;
  }
  if (context.commandMetadata?.kind === "procedure") {
    return `Call path: \`${context.commandMetadata.name}\`.`;
  }
  return undefined;
}

/**
 * The one next investigation step `debug` suggests (`spec/educational-model.md:523`'s "Suggest
 * one next investigation step, not a full fix"). Never a corrected program — only where to look
 * next — so it can never violate the Educational profile's no-full-solution guardrail.
 */
function nextStepSegment(
  context: TutorContext,
  diagnostic: OlDiagnostic | undefined,
): string {
  if (diagnostic === undefined) {
    return "No error is associated with this instruction. Try changing one input at a time and running `debug` again to see what changes.";
  }
  const names = collectVariableNames(context.target);
  if (names.length > 0) {
    const list = names.map((name) => `\`:${name}\``).join(" and ");
    const verb = names.length === 1 ? "gets its value" : "get their values";
    return `Try tracing back where ${list} ${verb} before this line runs.`;
  }
  const calleeName = context.commandMetadata?.name;
  if (calleeName !== undefined) {
    return `Look at what \`${calleeName}\` receives here and compare it with what \`${calleeName}\` expects.`;
  }
  return "Look closely at this line's inputs and compare them with what it expects.";
}

/**
 * The deterministic, offline, template-based `debug` baseline meta-command
 * (`spec/educational-model.md#debug`). Same `context` in, byte-identical {@link TutorOutput}
 * out — every helper above only reads `context`, never the wall clock, randomness, or any
 * outside state.
 */
export function debug(context: TutorContext): TutorOutput {
  const diagnostic = findRelevantErrorDiagnostic(context);
  const segments: string[] = [describeCurrentInstruction(context)];

  const variables = variableValuesSegment(context, diagnostic);
  if (variables !== undefined) {
    segments.push(variables);
  }

  const turtleState = turtleStateSegment(context.events);
  if (turtleState !== undefined) {
    segments.push(turtleState);
  }

  const callPath = callPathSegment(context);
  if (callPath !== undefined) {
    segments.push(callPath);
  }

  if (diagnostic !== undefined) {
    segments.push(`Diagnostic \`${diagnostic.code}\`: ${diagnostic.message}`);
  }

  segments.push(nextStepSegment(context, diagnostic));

  // `segments` is never empty: describeCurrentInstruction() unconditionally seeds it above, and
  // nextStepSegment() unconditionally appends below, so this cast only names the invariant the
  // TutorOutput contract requires (`readonly [string, ...string[]]`) — it asserts no new fact.
  const nonEmptySegments = segments as [string, ...string[]];

  if (diagnostic !== undefined) {
    return {
      command: "debug",
      segments: nonEmptySegments,
      diagnostic_code: diagnostic.code,
      target_source_span: diagnostic.source_span,
    } satisfies DebugDiagnosticTutorOutputPayload;
  }

  if (context.target !== undefined) {
    return {
      command: "debug",
      segments: nonEmptySegments,
      target_source_span: context.target.source_span,
    } satisfies DebugProgramTutorOutputPayload;
  }

  return {
    command: "debug",
    segments: nonEmptySegments,
  } satisfies DebugProgramTutorOutputPayload;
}

/**
 * The deterministic, offline, template-based `explain`/`why` baseline meta-commands
 * (`spec/educational-model.md#explain`, `spec/educational-model.md#why`), the Educational
 * profile's M3 slice A3 (issue #336). Pure functions over the shared {@link TutorContext}
 * contract from A0 (#324) — no parsing, no runtime dispatch, no AI: same input always produces
 * byte-identical output, and neither ever prints a complete ready-to-run solution
 * (`spec/conformance.md#educational`).
 */

import {
  isDiagnosticCode,
  type ColorChangePayload,
  type Diagnostic,
  type DiagnosticCode,
  type DrawSegmentPayload,
  type PenChangePayload,
  type Point,
  type PrintPayload,
  type ProcedureExitPayload,
  type ReturnPayload,
  type SourceSpan,
  type TraceEvent,
  type TurnPayload,
  type WidthChangePayload,
} from "@openlogo/core";
import type { AnyNode } from "@openlogo/parser";
import { walk } from "@openlogo/parser";
import { printedForm } from "@openlogo/runtime";
import type {
  TutorCommandMetadata,
  TutorContext,
  TutorLearnerLevel,
  TutorOutput,
} from "../tutor-context.js";

/** A short description of one known Core command or special form, for `explain`. */
interface CommandDescription {
  readonly kind: "primitive" | "special-form";
  readonly effect: string;
  readonly inputs: string;
}

/**
 * Curated descriptions for the Core commands and special forms the M1-M5 curriculum levels
 * introduce (`spec/educational-model.md`'s "Concept to command map"). A name absent here still
 * gets a generic, honest description — this table only makes the common case read naturally; it
 * is never the sole source of truth for what a command does.
 */
const KNOWN_COMMAND_DESCRIPTIONS: Readonly<Record<string, CommandDescription>> =
  {
    forward: {
      kind: "primitive",
      effect:
        "moves the turtle forward along its current heading, drawing a line while the pen is down",
      inputs: "how far to move, in steps",
    },
    back: {
      kind: "primitive",
      effect: "moves the turtle backward along its current heading",
      inputs: "how far to move, in steps",
    },
    left: {
      kind: "primitive",
      effect: "turns the turtle counterclockwise",
      inputs: "how many degrees to turn",
    },
    right: {
      kind: "primitive",
      effect: "turns the turtle clockwise",
      inputs: "how many degrees to turn",
    },
    pen_up: {
      kind: "primitive",
      effect: "lifts the pen so movement stops drawing",
      inputs: "no inputs",
    },
    pen_down: {
      kind: "primitive",
      effect: "lowers the pen so movement draws a line",
      inputs: "no inputs",
    },
    set_color: {
      kind: "primitive",
      effect: "changes the pen color used for new lines",
      inputs: "the color to use",
    },
    set_width: {
      kind: "primitive",
      effect: "changes how thick new lines are drawn",
      inputs: "the line width to use",
    },
    set_background: {
      kind: "primitive",
      effect: "changes the background color of the scene",
      inputs: "the background color to use",
    },
    home: {
      kind: "primitive",
      effect: "moves the turtle back to the starting position and heading",
      inputs: "no inputs",
    },
    clear_screen: {
      kind: "primitive",
      effect: "erases the drawing and returns the turtle home",
      inputs: "no inputs",
    },
    show_turtle: {
      kind: "primitive",
      effect: "makes the turtle avatar visible",
      inputs: "no inputs",
    },
    hide_turtle: {
      kind: "primitive",
      effect: "hides the turtle avatar",
      inputs: "no inputs",
    },
    print: {
      kind: "primitive",
      effect: "shows a value to the learner",
      inputs: "the value to show",
    },
    repeat: {
      kind: "special-form",
      effect: "runs its block a fixed number of times",
      inputs: "how many times to run the block",
    },
    while: {
      kind: "special-form",
      effect: "keeps running its block as long as a condition stays true",
      inputs: "the condition checked before each run",
    },
    forever: {
      kind: "special-form",
      effect: "keeps running its block until execution stops",
      inputs: "no inputs",
    },
    if: {
      kind: "special-form",
      effect: "chooses which block to run based on a condition",
      inputs: "the condition that picks the block",
    },
    define: {
      kind: "special-form",
      effect: "teaches OpenLogo a new procedure the learner can call by name",
      inputs: "the procedure name and its parameters",
    },
    return: {
      kind: "special-form",
      effect: "answers a value from the current procedure",
      inputs: "the value to answer",
    },
    local: {
      kind: "special-form",
      effect: "declares a new variable in the current scope",
      inputs: "the variable name(s) to declare",
    },
    set: {
      kind: "special-form",
      effect: "changes the value stored in a place",
      inputs: "the place and the new value",
    },
  };

/**
 * Maps an AST node kind that is a control/binding special form (rather than a `Call`) to its
 * canonical name, for {@link resolveCommandName} when the caller's {@link TutorContext} does not
 * supply {@link TutorCommandMetadata} (`spec/educational-model.md:451`'s "Name the command or
 * special form" requirement covers these forms too).
 */
const SPECIAL_FORM_NAMES: Readonly<Partial<Record<AnyNode["kind"], string>>> = {
  Repeat: "repeat",
  While: "while",
  Forever: "forever",
  If: "if",
  ProcedureDef: "define",
  Return: "return",
  Local: "local",
  Assign: "set",
};

/** The resolved name + kind of the instruction {@link explain}/{@link why} describe. */
interface ResolvedCommand {
  readonly name: string;
  readonly kind: "primitive" | "special-form" | "procedure";
}

/**
 * Resolves the command/special-form name and kind for `target`, preferring the caller-supplied
 * {@link TutorCommandMetadata} (the authoritative source when known) and falling back to the
 * AST node kind for control/binding forms that are never `Call` nodes. Returns `undefined` when
 * `target` names no single instruction (e.g. the whole program, or a `Block`) — `explain`/`why`
 * then describe the target's shape instead of a specific command.
 */
function resolveCommandName(
  target: AnyNode,
  commandMetadata: TutorCommandMetadata | undefined,
): ResolvedCommand | undefined {
  if (commandMetadata) {
    return { name: commandMetadata.name, kind: commandMetadata.kind };
  }
  const specialFormName = SPECIAL_FORM_NAMES[target.kind];
  if (specialFormName !== undefined) {
    return { name: specialFormName, kind: "special-form" };
  }
  if (target.kind === "Call" || target.kind === "ParenCall") {
    return { name: target.canonical ?? target.callee.name, kind: "primitive" };
  }
  return undefined;
}

/** Looks up a curated description, falling back to an honest generic one when unknown. */
function describeCommand(resolved: ResolvedCommand): CommandDescription {
  // `Object.hasOwn` guards against a learner-defined name (e.g. `constructor`, `toString`)
  // accidentally resolving to an inherited `Object.prototype` member instead of falling
  // through to the honest generic description below.
  if (Object.hasOwn(KNOWN_COMMAND_DESCRIPTIONS, resolved.name)) {
    return KNOWN_COMMAND_DESCRIPTIONS[resolved.name] as CommandDescription;
  }
  return {
    kind: resolved.kind === "special-form" ? "special-form" : "primitive",
    effect: `runs the \`${resolved.name}\` instruction`,
    inputs: "its inputs, as written",
  };
}

/**
 * Short curriculum-level concept phrases, one per {@link TutorLearnerLevel}, drawn verbatim from
 * `spec/educational-model.md`'s "Concept to command map" table so `explain`'s level-link bullet
 * (`spec/educational-model.md:454`) stays grounded in the normative level table rather than
 * inventing new wording per command.
 */
const LEVEL_CONCEPTS: Readonly<Record<TutorLearnerLevel, string>> = {
  "1": "movement with visible feedback",
  "2": "repetition — a visible pattern becomes one named rule",
  "3": "variable naming — one value can control many instructions",
  "4": "comparison and choice between explicit booleans",
  "5": "procedures — teaching OpenLogo a discovered pattern",
  "6": "derived geometry, turtle placement, and number tools",
  "7a": "lists — ordered memory for paths, scores, and steps",
  "7b": "dictionaries — named memory for meaningful lookup",
  "7c": "records — fixed fields that keep related facts together",
  "8a": "recursion — a rule that solves a smaller version of itself",
  "8b": "comprehensions and destructuring over data",
};

function levelSentence(level: TutorLearnerLevel): string {
  return `This idea belongs to level ${level} of the curriculum: ${LEVEL_CONCEPTS[level]}.`;
}

/** Counts the direct statements of a `Program` or `Block` node, for the whole-target fallback. */
function statementCount(node: AnyNode): number | undefined {
  if (node.kind === "Program" || node.kind === "Block") {
    return node.body.length;
  }
  return undefined;
}

/**
 * `explain` — describes what a selected instruction or short program does in learner language
 * (`spec/educational-model.md#explain`). Baseline behavior: name the command/special form, say
 * what inputs it uses, say its visible/stored effect, link the idea to the current level, and
 * avoid rewriting the learner's whole program.
 */
export function explain(context: TutorContext): TutorOutput {
  const target = context.target ?? context.program;
  const resolved = resolveCommandName(target, context.commandMetadata);

  if (!resolved) {
    const count = statementCount(target);
    const segments: [string, ...string[]] = [
      count === undefined
        ? "This selection is not a single instruction, so there is no one command to name."
        : `This part of the program runs ${count} step${count === 1 ? "" : "s"} in order.`,
      levelSentence(context.level),
    ];
    return {
      command: "explain",
      segments,
      target_source_span: context.target?.source_span,
    };
  }

  const description = describeCommand(resolved);
  const kindPhrase =
    resolved.kind === "special-form"
      ? "special form"
      : resolved.kind === "procedure"
        ? "procedure the learner defined"
        : "built-in command";

  const segments: [string, ...string[]] = [
    `\`${resolved.name}\` is a ${kindPhrase}.`,
    `Its input is ${description.inputs}.`,
    `Running it ${description.effect}.`,
    levelSentence(context.level),
  ];

  return {
    command: "explain",
    segments,
    target_source_span: context.target?.source_span,
  };
}

/** Reports whether two source spans identify the same range in the same document. */
function spansEqual(a: SourceSpan, b: SourceSpan): boolean {
  return (
    a.document === b.document &&
    a.start[0] === b.start[0] &&
    a.start[1] === b.start[1] &&
    a.end[0] === b.end[0] &&
    a.end[1] === b.end[1]
  );
}

/** Compares two `(line, column)` positions: negative when `a` comes before `b`. */
function comparePositions(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  return a[0] - b[0] || a[1] - b[1];
}

/**
 * Reports whether `inner` falls entirely within `outer`, in the same document — used to match a
 * diagnostic (often pinpointing a nested expression, e.g. `:missing` inside `forward :missing`)
 * against the wider instruction the learner selected, rather than requiring an exact span match.
 */
function spanContains(outer: SourceSpan, inner: SourceSpan): boolean {
  return (
    outer.document === inner.document &&
    comparePositions(outer.start, inner.start) <= 0 &&
    comparePositions(inner.end, outer.end) <= 0
  );
}

/**
 * A {@link Diagnostic} narrowed to a stable `ol-*` code — the only kind `why`'s diagnostic arm
 * carries (`spec/educational-model.md#why`'s "error" cause is always a normative diagnostic,
 * never a style lint).
 */
interface OlDiagnostic extends Diagnostic {
  readonly code: DiagnosticCode;
}

/**
 * Finds the diagnostic `why` should explain: one contained within `target`'s span (a diagnostic
 * commonly pinpoints a nested expression, e.g. `:missing` inside `forward :missing`, so
 * containment — not exact equality — is what matches "the source instruction") when a target is
 * selected, otherwise the most recent diagnostic (`spec/educational-model.md#why`'s "When an
 * error happened, link to the diagnostic shape in error-model.md"). Style lints (`ol-style-*`)
 * never explain an error's cause, so only stable `ol-*` codes are considered.
 */
function findRelevantDiagnostic(
  context: TutorContext,
  target: AnyNode,
): OlDiagnostic | undefined {
  const olDiagnostics = context.diagnostics.filter(
    (diagnostic): diagnostic is OlDiagnostic =>
      isDiagnosticCode(diagnostic.code),
  );
  if (olDiagnostics.length === 0) {
    return undefined;
  }
  if (context.target) {
    return olDiagnostics.find((diagnostic) =>
      spanContains(target.source_span, diagnostic.source_span),
    );
  }
  return olDiagnostics[olDiagnostics.length - 1];
}

/**
 * Describes one trace event's effect in one plain-language sentence. Only ever called with an
 * effect event — {@link findRelevantEvent} filters out the `instruction`/`procedure-enter`
 * start events before selecting what to describe, so this never has to (issue #435).
 */
function describeEvent(event: TraceEvent): string {
  switch (event.kind) {
    case "move": {
      const { from, to } = event.payload as { from: Point; to: Point };
      return `The turtle moved from (${from[0]}, ${from[1]}) to (${to[0]}, ${to[1]}).`;
    }
    case "draw-segment": {
      const { from, to, color, width } = event.payload as DrawSegmentPayload;
      return `The turtle drew a ${color} line, width ${width}, from (${from[0]}, ${from[1]}) to (${to[0]}, ${to[1]}).`;
    }
    case "turn": {
      const { from, to } = event.payload as TurnPayload;
      return `The turtle's heading changed from ${from} to ${to} degrees.`;
    }
    case "pen-change": {
      const { to } = event.payload as PenChangePayload;
      return `The pen changed to ${to}.`;
    }
    case "width-change": {
      const { to } = event.payload as WidthChangePayload;
      return `The pen width changed to ${to}.`;
    }
    case "color-change": {
      const { from, to } = event.payload as ColorChangePayload;
      return `The pen color changed from ${from} to ${to}.`;
    }
    case "background-change": {
      const { color } = event.payload as { color: string };
      return `The background color changed to ${color}.`;
    }
    case "print": {
      const { values } = event.payload as PrintPayload;
      return `OpenLogo showed ${values.map((value) => printedForm(value)).join(", ")}.`;
    }
    case "return": {
      const { value } = event.payload as ReturnPayload;
      return `The procedure answered ${printedForm(value)}.`;
    }
    case "procedure-exit": {
      const { name, result } = event.payload as ProcedureExitPayload;
      return result === null
        ? `\`${name}\` finished without answering a value.`
        : `\`${name}\` finished and answered ${printedForm(result)}.`;
    }
    case "clear": {
      const { mode } = event.payload as { mode: string };
      return `The drawing was cleared (${mode}).`;
    }
    default:
      return `A \`${event.kind}\` change happened.`;
  }
}

/**
 * Finds the AST node whose own `source_span` exactly matches `span` and names a single
 * instruction — used to recover which instruction caused a trace event when the caller selected
 * no explicit `target` (`why`'s "identify the source instruction" baseline behavior still
 * applies even when the learner asks about the program as a whole).
 */
function findInstructionAtSpan(
  program: AnyNode,
  span: SourceSpan,
): AnyNode | undefined {
  let found: AnyNode | undefined;
  walk(program, (node) => {
    if (
      !found &&
      spansEqual(node.source_span, span) &&
      resolveCommandName(node, undefined)
    ) {
      found = node;
    }
  });
  return found;
}

/**
 * The two `kind`s the runtime pushes as bookkeeping *before* their effect
 * (`spec/execution-model.md:575`, `packages/core/src/events.ts`'s `OL_EVENT_KINDS`): every
 * statement — including the `why`/`explain` meta-command's own — gets an `instruction` start
 * event, and every procedure call gets a `procedure-enter` start event before its body runs.
 * Neither describes anything that actually happened yet, so `findRelevantEvent` must never
 * select one as "the effect" to explain (issue #435).
 */
const START_EVENT_KINDS: ReadonlySet<TraceEvent["kind"]> = new Set([
  "instruction",
  "procedure-enter",
]);

/**
 * Finds the trace event `why` should explain: the most recent *effect* event (never an
 * `instruction`/`procedure-enter` start event, see {@link START_EVENT_KINDS}) whose
 * `source_span` is contained by `target` when a target is selected — a selected range (e.g. a
 * `repeat` body) only carries child-instruction spans in the trace, never its own enclosing
 * span — otherwise the most recent effect event overall
 * (`spec/educational-model.md#why`'s "Use the turtle state or variable value at that moment").
 */
function findRelevantEvent(
  context: TutorContext,
  target: AnyNode,
): TraceEvent | undefined {
  for (let index = context.events.length - 1; index >= 0; index -= 1) {
    const event = context.events[index];
    if (!event || START_EVENT_KINDS.has(event.kind)) {
      continue;
    }
    if (
      !context.target ||
      spanContains(target.source_span, event.source_span)
    ) {
      return event;
    }
  }
  return undefined;
}

/**
 * `why` — uses the execution trace to answer why something happened, pointing to the
 * instruction, state, or comparison that caused the result (`spec/educational-model.md#why`).
 * Baseline behavior: identify the source instruction, use the turtle/variable state at that
 * moment, explain the cause in one or two steps, and link to the `ol-*` diagnostic shape when
 * the cause was an error.
 */
export function why(context: TutorContext): TutorOutput {
  const target = context.target ?? context.program;
  const diagnostic = findRelevantDiagnostic(context, target);

  if (diagnostic) {
    return {
      command: "why",
      segments: [diagnostic.message, `Diagnostic: \`${diagnostic.code}\`.`],
      diagnostic_code: diagnostic.code,
      target_source_span: diagnostic.source_span,
    };
  }

  let resolved = resolveCommandName(target, context.commandMetadata);
  const event = findRelevantEvent(context, target);
  let eventTargetSpan = context.target?.source_span;

  // With no explicit target, recover which instruction actually caused the event by looking up
  // the AST node at the event's own span — otherwise `why` would always give a generic cause
  // when the learner asks "why" about the program as a whole. Even when no AST node matches,
  // the event's own span still identifies exactly what is being described.
  if (event) {
    if (!resolved) {
      const instruction = findInstructionAtSpan(
        context.program,
        event.source_span,
      );
      if (instruction) {
        resolved = resolveCommandName(instruction, undefined);
      }
    }
    eventTargetSpan ??= event.source_span;
  }

  if (!event) {
    return {
      command: "why",
      segments: [
        resolved
          ? `\`${resolved.name}\` has not run yet, so there is no recorded state to explain.`
          : "Nothing has run yet, so there is no recorded state to explain.",
      ],
      target_source_span: context.target?.source_span,
    };
  }

  const causeSentence = resolved
    ? `This happened because \`${resolved.name}\` ran.`
    : context.target
      ? "This happened because the selected instruction ran."
      : "This happened while running this part of the program.";

  return {
    command: "why",
    segments: [describeEvent(event), causeSentence],
    target_source_span: eventTargetSpan,
  };
}

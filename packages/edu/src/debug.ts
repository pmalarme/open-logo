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
  isTurtleSpecificEventKind,
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
  type SpawnTurtlePayload,
  type TraceEvent,
  type TurnPayload,
  type TurtleId,
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
 * The turtle-state fields `debug` reports for one turtle
 * (`spec/educational-model.md:520`'s "Show turtle state when useful: position, heading, pen,
 * color, width"). Mutable while {@link foldTurtleStatesByIdentity} accumulates into it; each
 * field stays absent until an event sets it, so `debug` only ever reports what the trace
 * actually says about that turtle.
 */
interface FoldedTurtleState {
  position?: Point;
  heading?: number;
  pen?: PenState;
  color?: string;
  width?: number;
}

/** The trace's turtle state, one entry per turtle, keyed by turtle identity. */
type TurtleStatesByIdentity = ReadonlyMap<TurtleId, FoldedTurtleState>;

/**
 * The turtle an event's envelope identifies, for every consumer in this file: the `turtle_id` when
 * it actually identifies a turtle, and {@link MAIN_TURTLE_ID} otherwise.
 *
 * `Number.isFinite` — never the global `isFinite`, which coerces, so `isFinite("1")` is `true`. An
 * id that is `NaN`, an infinity, or not a number at all names no turtle, so it is treated exactly
 * like an **absent** id, which this file already resolves to the single default turtle. Applying
 * that test in one place is the point: while the fold admitted any id and only the population
 * count screened them, the two disagreed about what an identity is, and a `NaN` key leaked into
 * the report as `turtle #NaN` — and, worse, into the clause sort, where `left - right` returns
 * `NaN`, making the comparator non-transitive and scrambling the order of the perfectly
 * legitimate turtles around it. One admission rule removes all of that by construction.
 */
function identifiedTurtle(turtleId: TurtleId | undefined): TurtleId {
  return Number.isFinite(turtleId) ? (turtleId as TurtleId) : MAIN_TURTLE_ID;
}

/**
 * The reserved id of the **main turtle** — the single default turtle every program starts with,
 * the one Turtle & Rendering commands drive before any `new_turtle`. It is `0` to match
 * `@openlogo/runtime`'s `MAIN_TURTLE_ID` (the allocator that seeds the `turtle_id` this fold
 * routes on) and `@openlogo/turtle`'s reducer constant of the same name, so a per-turtle event
 * stamped with `turtle_id: 0` and an un-stamped main-turtle event (no `turtle_id`, emitted before
 * any `tell`) fold into the *same* turtle here — exactly as `@openlogo/turtle`'s `reduceTurtleState`
 * already folds them for the renderer. `debug` agreeing with the renderer about who is where is the
 * whole point of issues #738/#889; disagreeing was the defect they removed.
 *
 * Declared locally, mirroring `@openlogo/turtle`'s own local declaration and for the same reason:
 * `@openlogo/runtime` does not export it, and `@openlogo/edu` must not take a dependency on
 * `@openlogo/turtle` to reach a single number.
 */
const MAIN_TURTLE_ID: TurtleId = 0;

/**
 * Folds the trace so far into one {@link FoldedTurtleState} **per turtle**, keyed by the
 * `turtle_id` the envelope attributes each event to. Only the state-bearing event kinds change
 * anything; every other kind is ignored, matching the fold-only-what-matters pattern
 * `@openlogo/turtle`'s state reducer uses for the same event stream.
 *
 * Partitioning by identity is the whole point (issue #891). This fold used to run every event
 * through a single set of variables, so under Sprites a `tell [ :a :b ]` reported one *blended*
 * state — last write wins per field — that no turtle ever actually had: position and heading
 * from whichever turtle moved last, color from whichever set one last.
 * `spec/turtles-and-sprites.md:113` requires the identities to exist precisely "so animation,
 * stepping, `why`, and `debug` can explain which turtle moved or changed", and names `debug`
 * among the consumers the rule exists for.
 *
 * An absent `turtle_id` folds into {@link MAIN_TURTLE_ID}, not into a bucket of its own. The
 * producer omits the id exactly when no explicit `tell`/`ask`/`each` addressing is in force
 * (:113 scopes the identity requirement to explicit addressing), and the turtle acting then is
 * the main turtle — the same one a `tell [ who ]` later stamps as `turtle_id: 0`. Keeping them
 * apart would let one turtle be reported twice, at two different positions, whenever a program
 * interleaves addressed and unaddressed movement (`forward 5` / `ask who [ forward 5 ]` /
 * `forward 5`) — with the addressed clause frozen at a stale position. `@openlogo/turtle`'s
 * `reduceTurtleState` already folds the two together for the renderer, so splitting them here is
 * also exactly how `debug` would start contradicting the picture on screen again.
 *
 * A `clear` is deliberately **not** a state-bearing kind, in either mode (issue #738).
 * `spec/turtles-and-sprites.md:113` is explicit that "consumers MUST NOT read a `clear` event as an
 * instruction to move a turtle: a turtle's position and heading change only through the events that
 * report that turtle's movement" — and it names `debug` among the consumers that rule exists for.
 * This fold used to home on `clear{mode:"clear_screen"}`, mirroring `@openlogo/turtle`'s
 * `reduceTurtleState`; that mirroring was safe only while `clear_screen` homed whichever turtle was
 * current. Now that it homes **every addressed turtle** — and so homes *none* when the addressed set
 * is empty — the `clear` says nothing about the turtle this fold is following, and folding it made
 * `debug` report `(0, 0)`/`0` for a `tell [ ] / clear_screen` the runtime had left untouched.
 *
 * Nothing is lost by dropping it: this reads the events of the run it is inside, and since issue
 * #847 that producer emits an explicit `move`/`turn` pair for every turtle it actually homes, which
 * the arms below already fold — now per turtle, so a multi-turtle homing is reported once per
 * turtle instead of collapsing into one. `reduceTurtleState` keeps its `clear` branch for the
 * different job it has — reducing an arbitrary producer's stream, where `spec/rendering.md:153`'s
 * payload discriminator may be the only record of the homing.
 */
function foldTurtleStatesByIdentity(
  events: readonly TraceEvent[],
): TurtleStatesByIdentity {
  const turtleStates = new Map<TurtleId, FoldedTurtleState>();

  /**
   * The bucket `event` belongs to, created on first use. Every id goes through
   * {@link identifiedTurtle}, so an absent id and one that names no turtle land in the same
   * place — the single default turtle — and `0`, a real id (the main turtle's, which a
   * `tell [ who ]` stamps), is preserved rather than coerced away as a falsy value would be.
   */
  const stateFor = (turtleId: TurtleId | undefined): FoldedTurtleState => {
    const key = identifiedTurtle(turtleId);
    let state = turtleStates.get(key);
    if (state === undefined) {
      state = {};
      turtleStates.set(key, state);
    }
    return state;
  };

  for (const event of events) {
    switch (event.kind) {
      case "move": {
        const payload = event.payload as MovePayload;
        const state = stateFor(event.turtle_id);
        state.position = payload.to;
        state.heading = payload.heading;
        break;
      }
      case "turn": {
        stateFor(event.turtle_id).heading = (event.payload as TurnPayload).to;
        break;
      }
      case "pen-change": {
        stateFor(event.turtle_id).pen = (event.payload as PenChangePayload).to;
        break;
      }
      case "color-change": {
        stateFor(event.turtle_id).color = (
          event.payload as ColorChangePayload
        ).to;
        break;
      }
      case "width-change": {
        stateFor(event.turtle_id).width = (
          event.payload as WidthChangePayload
        ).to;
        break;
      }
      default:
        break;
    }
  }

  return turtleStates;
}

/**
 * Renders one turtle's folded state as the comma-separated field list `debug` reports, in the
 * fixed order `spec/educational-model.md:520` lists them ("position, heading, pen, color,
 * width"). Empty when the bucket describes nothing — see {@link turtleStateSegment}, which drops
 * such a turtle rather than emitting a clause with no fields in it.
 */
function describeFoldedTurtleState(state: FoldedTurtleState): string {
  const parts: string[] = [];
  if (state.position !== undefined) {
    parts.push(`position (${state.position[0]}, ${state.position[1]})`);
  }
  if (state.heading !== undefined) {
    parts.push(`heading ${state.heading}`);
  }
  if (state.pen !== undefined) {
    parts.push(`pen ${state.pen}`);
  }
  if (state.color !== undefined) {
    parts.push(`color \`${state.color}\``);
  }
  if (state.width !== undefined) {
    parts.push(`width ${state.width}`);
  }
  return parts.join(", ");
}

/**
 * How many turtles the trace shows to be in play: the main turtle, which every program starts
 * with, plus every turtle the stream names — by acting (any turtle-specific event carrying its
 * identity) or by being created (a `spawn-turtle` event, `spec/turtles-and-sprites.md`'s "Turtle
 * creation", whose payload "MUST identify the newly created turtle"). Turtles are never destroyed
 * in v0.1 — the runtime's `TurtleWorld` exposes no removal at all — so a turtle named anywhere in
 * the trace is still in play at the end of it.
 *
 * This is the *world* population, deliberately not "how many turtles changed state". The two
 * differ exactly where it matters: `:a = new_turtle` / `ask :a [ forward 5 ]` gives one turtle
 * state but two live turtles, and it is the reported turtle's **identity** that a learner needs
 * there — otherwise `debug` prints the same sentence it prints for a bare `forward 5`, which
 * describes a different turtle.
 *
 * Both sources are needed, because `debug` reads whatever stream a host hands it, not only this
 * runtime's. Counting spawns alone would miss a turtle that acts without the trace showing its
 * creation; counting actors alone would miss a turtle that exists but has never acted. The actor
 * scan spans **every** turtle-specific kind (`@openlogo/core`'s {@link isTurtleSpecificEventKind},
 * the shared classification issue #764 exists to stop each consumer re-deriving), not merely the
 * five kinds this file folds into reported fields: a `shape-change` or a `stamp` names its turtle
 * just as surely as a `move` does, even though `debug` reports no shape.
 *
 * Every id is screened by {@link identifiedTurtle}, the same admission rule the fold uses, so an
 * off-contract id can neither invent a second turtle here nor become a bucket there.
 */
function countLiveTurtles(events: readonly TraceEvent[]): number {
  const liveTurtleIds = new Set<TurtleId>([MAIN_TURTLE_ID]);
  for (const event of events) {
    if (isTurtleSpecificEventKind(event.kind)) {
      liveTurtleIds.add(identifiedTurtle(event.turtle_id));
    }
    if (event.kind === "spawn-turtle") {
      liveTurtleIds.add(
        identifiedTurtle((event.payload as SpawnTurtlePayload).turtle_id),
      );
    }
  }
  return liveTurtleIds.size;
}

/**
 * The turtle-state segment `debug` reports (`spec/educational-model.md:520`), naming **which**
 * turtle each state belongs to as soon as there is more than one turtle it could be.
 *
 * Three shapes, all sharing the `Turtle state so far:` opening so a consumer can still find the
 * segment by that prefix:
 *
 * - No turtle has any state to report — no segment at all.
 * - One turtle's state in a **one-turtle world**: its fields alone, unnamed. Nothing exists to
 *   confuse it with, so naming it would add nothing — and since such a world can only ever be the
 *   main turtle, every Turtle & Rendering program's wording stays byte-identical to what it was
 *   before `debug` became per-turtle.
 * - Otherwise: one clause per turtle, `turtle #<id>` in **ascending id** order.
 *
 * The trigger is the **live-turtle count** ({@link countLiveTurtles}), not the number of turtles
 * with state. Keying it on state alone made `:a = new_turtle` / `ask :a [ forward 5 ]` — the
 * simplest Sprites program there is — report `position (0, 5)` unnamed, the exact sentence a bare
 * `forward 5` produces for the *main* turtle, even though the turtle that moved was `#1` and the
 * main turtle had not moved at all. `spec/rendering.md:193` makes identification a MUST in that
 * situation ("Implementations with multiple turtles MUST identify the active turtle or addressed
 * turtle set"), and `@openlogo/turtle`'s accessible state region already names turtles on this
 * same trigger — "once the world holds more than one live turtle" (`a11y.ts`, issue #749) — so
 * keying `debug` on anything else would have the two describers of one stream disagree about who
 * is where. The population counts every identity the trace names, whether by a `spawn-turtle` or
 * by any turtle-specific event, so a host that feeds `debug` per-turtle events without the spawns
 * that produced them still gets named clauses.
 *
 * `turtle #<id>` is the identity a turtle value prints as — `@openlogo/runtime`'s `printedForm`
 * renders `turtle #<id>` from `@openlogo/core`'s `OLTurtle.id` — so `debug`'s clauses match what
 * `print who` or `print :friend` just showed the learner (`spec/turtles-and-sprites.md:39`, `:85`).
 * The tag is not spelled out in `spec/*.md`; the runtime is its normative source here, and the
 * test alongside this reads it back through `printedForm` so the two cannot drift apart.
 *
 * Ordering by id rather than by when each turtle last acted is deliberate.
 * `spec/turtles-and-sprites.md:113` requires that "the result never depends on the order the
 * turtles were listed in: `tell [ :a :b ]` and `tell [ :b :a ]` home the same two turtles" — and
 * those two forms genuinely do emit their per-turtle events in opposite orders, so reporting the
 * last turtle to act (or reporting in event order) would make `debug`'s answer depend on the
 * listing order the spec says it must not.
 *
 * The reported subject is **every turtle the trace gave state**, not the addressed set in force at
 * the end. This segment is a history ("state so far"), so a turtle that moved and was then
 * un-addressed still has a position a learner may be asking about, while a turtle that is
 * addressed but has never acted has nothing to report — reporting the addressed set instead would
 * invert both. Turtles whose bucket describes no field at all are dropped rather than emitted as
 * an empty clause.
 */
function turtleStateSegment(events: readonly TraceEvent[]): string | undefined {
  const described = [...foldTurtleStatesByIdentity(events)]
    .map(([turtleId, state]): readonly [TurtleId, string] => [
      turtleId,
      describeFoldedTurtleState(state),
    ])
    .filter(([, fields]) => fields !== "")
    .sort(([left], [right]) => left - right);

  const [first] = described;
  if (first === undefined) {
    return undefined;
  }

  // The count alone decides this. Every bucket key is an admitted identity, so a population of one
  // means every event resolved to the main turtle and `described` holds exactly this one entry —
  // no separate length check is needed, and adding one back would only hide that invariant.
  if (countLiveTurtles(events) < 2) {
    return `Turtle state so far: ${first[1]}.`;
  }

  const clauses = described.map(
    ([turtleId, fields]) => `turtle #${turtleId} — ${fields}`,
  );
  return `Turtle state so far: ${clauses.join("; ")}.`;
}

/**
 * Reconstructs which procedures are still open at the end of the trace
 * (`spec/educational-model.md:521`'s "For procedures, show a friendly call path"): every
 * `procedure-enter` pushes its callee's name, every `procedure-exit` pops one — the same
 * enter/exit pairing the trace/event contract registers and illustrates
 * (`spec/execution-model.md:894-960,1038-1076`) — leaving only the frames still active. When the
 * target itself is a completed procedure call (its enter/exit pair already closed, so no frame is
 * left open), the target's own `commandMetadata` still names the procedure it invoked — showing
 * that single-name path is more useful to a learner than showing nothing.
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

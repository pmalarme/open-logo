/**
 * Shared statement-execution core for `index.ts`'s {@link execute} — and, separately, this
 * package's own tests exercising `forever` loop mechanics. **Not part of `@openlogo/runtime`'s
 * public API**: `package.json`'s `exports` map only ever resolves the bare `"@openlogo/runtime"`
 * specifier to `dist/index.js`, and `index.ts` never re-exports anything from this file, so no
 * external consumer can reach {@link executeWithForeverIterationLimitForTests} through the
 * package. Only a same-package relative import straight into `dist/execute-internal.js` (which
 * `repeat-forever-repcount.test.mjs` uses) can — this is deliberate: it keeps the test-only
 * `forever` iteration cap architecturally unreachable from `execute()` or any real caller, not
 * just unreachable by convention/naming.
 *
 * Issue #97 adds user-procedure call execution: {@link executeStatements} now returns an
 * {@link ExecSignal} — `"normal"`/`"halt"` (its original two outcomes, renamed) plus `"return"`/
 * `"stop"` — so a control form's body (`If`/`While`/`Repeat`/`Forever`/`ForIn`/`ForRange`)
 * transparently propagates a `return`/`stop` up to the nearest enclosing procedure, rather than
 * only stopping its own loop (`spec/execution-model.md:340-349`). {@link runProcedure} is the
 * shared call mechanics reachable from both a statement-position call (dispatched directly, right
 * here) and an expression-position call (`evaluate.ts`'s `evaluateCall`, via the `callProcedure`
 * callback threaded onto `Environment` — see `evaluate.ts`'s doc comment for why a direct import
 * back into this file would be a cycle).
 */

import type {
  AxesOverlayPayload,
  BackgroundChangePayload,
  ClearPayload,
  ColorChangePayload,
  Diagnostic,
  DrawSegmentPayload,
  FillPayload,
  GridOverlayPayload,
  MeasureOverlayPayload,
  MelodyStep,
  MovePayload,
  OLValue,
  PenChangePayload,
  Point,
  PrintPayload,
  ProcedureEnterPayload,
  ProcedureExitPayload,
  ReturnPayload,
  ShapeChangePayload,
  SoundPayload,
  SourceSpan,
  StampPayload,
  TraceEvent,
  TurnPayload,
  TurtleId,
  TutorCommand,
  VisibilityChangePayload,
  WidthChangePayload,
} from "@openlogo/core";
import { OLTurtle, makeSpan, typeNameOf } from "@openlogo/core";
import type {
  BlockNode,
  CallNode,
  ExpressionNode,
  ParenCallNode,
  ProcedureDefNode,
  ProfileStatementNode,
  ProgramNode,
  StatementNode,
  StructDefNode,
} from "@openlogo/parser";
import {
  corePrimitiveArity,
  dataPrimitiveArity,
  educationalPrimitiveArity,
  geometryPrimitiveArity,
  interactionPrimitiveArity,
  isReservedWord,
  parse,
  soundPrimitiveArity,
  turtlePrimitiveArity,
  walk,
} from "@openlogo/parser";
import { normalizeColor } from "./color.js";
import { isRecognizedShape, normalizeShape } from "./shape.js";
import { isValidPitch } from "./pitch.js";
import {
  bindElement,
  checkExecutionLimits,
  createDefaultTurtleState,
  createTurtleAddressing,
  evaluate,
  executeAdd,
  executeAssign,
  executeClear,
  executeInsert,
  executeRemove,
  executeRemoveKey,
  findDuplicateBinderName,
  isSupportedArgument,
  pendingExecutionHalt,
  printedForm,
  pushLoopFrame,
  snapshotValue,
  requireNumber,
  requireWholeNumber,
  turtleStateFor,
  type AssignResult,
  type Environment,
  type EvalResult,
  type Frame,
  type ProcedureRegistry,
  type StructRegistry,
  type TurtleAddressing,
} from "./evaluate.js";
import { runtimeDiag } from "./errors.js";
import {
  claimDueEveryHandlers,
  claimPendingClickHandlers,
  claimPendingEventHandlers,
  claimPendingKeyHandlers,
  createEventHandlerRegistry,
  createTickClock,
  emitEveryPrimitive,
  emitOnClickPrimitive,
  emitOnKeyPrimitive,
  emitWhenPrimitive,
  enqueueHostInput,
  isWaitCall,
  pendingHandlersFor,
  registerEveryHandler,
  registerOnClickHandler,
  registerOnKeyHandler,
  registerWhenHandler,
  runWait,
  STANDARD_EVENT_WORDS,
  validateTickCount,
  type EveryHandler,
  type HostInputEvent,
  type OnClickHandler,
  type OnKeyHandler,
  type WhenHandler,
} from "./interaction.js";
import type {
  ExecuteOptions,
  ExecuteResult,
  InstructionPayload,
} from "./index.js";
import {
  createRandomNumberGeneratorState,
  seedFromText,
} from "./random-number-generator.js";
import { createSoundState } from "./sound-state.js";
import type { TutorCommandMetadata, TutorContext } from "./tutor-context.js";
import { defaultTutorTemplate } from "./tutor-templates.js";
import type { TutorLearnerLevel } from "./tutor-context.js";
import { normalizeHeading } from "./turtle-math.js";
import { MAIN_TURTLE_ID, TurtleWorld } from "./turtle-world.js";

/**
 * Is `statement` a call to `print` — the single-value `print value` form or the parenthesized
 * variadic `(print a b …)` form (`spec/commands.md:142-158`)? Accepts both the plain infix
 * `Call` form (`print 1`) and the explicit-parentheses `ParenCall` form (`(print 1 2)`) — both
 * share the same callee/args shape (see `evaluate.ts`'s `ArithmeticCallNode`). Matches
 * regardless of argument count: a zero-argument `print`/`(print)` is handled separately in
 * {@link executeStatements}, since `execute()` runs `parse()` only (not the semantic checker), so
 * the checker's static `ol-not-enough-inputs` rule never sees it here.
 */
function isPrintCall(
  statement: StatementNode,
): statement is CallNode | ParenCallNode {
  return (
    (statement.kind === "Call" || statement.kind === "ParenCall") &&
    statement.callee.name.toLowerCase() === "print"
  );
}

/**
 * Is `statement` a call to `show` — the single-value `show value` form (`spec/commands.md:160-
 * 175`, issue #234)? Accepts both the plain infix `Call` form (`show 1`) and the explicit-
 * parentheses `ParenCall` form (`(show 1)`). Unlike {@link isPrintCall}'s `print`, `show` has no
 * documented parenthesized variadic form — its signature is strictly `show value` — so
 * {@link executeStatements} enforces exactly one argument itself, the same way `execute()` is the
 * sole enforcement point for every list reporter's arity (`evaluate.ts`'s `requireMinArgs` doc
 * comment) since it never runs the semantic checker.
 *
 * Returns a plain `boolean` — not a `statement is CallNode | ParenCallNode` predicate — because
 * {@link isPrintCall}'s own predicate check runs first and its matching arm always `continue`s,
 * which narrows `statement`'s type to exclude `CallNode | ParenCallNode` for every statement that
 * reaches this call; a type predicate here would then narrow that already-excluded type to
 * `never`. Matches {@link isProcedureCallStatement}'s convention of an explicit `as` cast instead.
 */
function isShowCall(statement: StatementNode): boolean {
  return (
    (statement.kind === "Call" || statement.kind === "ParenCall") &&
    statement.callee.name.toLowerCase() === "show"
  );
}

/**
 * Is `statement` a call to `randomize` — the bare `randomize` (no seed) or parenthesized
 * `(randomize seed)` form (`spec/commands.md`'s `randomize` entry, issue #287)? Same shape and
 * rationale as {@link isShowCall} — a plain `boolean`, not a `statement is …` type predicate,
 * since `isPrintCall`'s negative branch already narrowed `statement` away from
 * `CallNode | ParenCallNode` by the time execution reaches this check.
 */
function isRandomizeCall(statement: StatementNode): boolean {
  return (
    (statement.kind === "Call" || statement.kind === "ParenCall") &&
    statement.callee.name.toLowerCase() === "randomize"
  );
}

/**
 * Is `statement` a call to `forward`/`back` (issue #200, Core Turtle movement — the Heritage
 * `fd`/`bk` aliases are a separate M5 slice)? Accepts both the plain infix `Call` form
 * (`forward 100`) and the explicit-parentheses `ParenCall` form (`(forward 100)`). A plain
 * `boolean` — not a `statement is CallNode | ParenCallNode` type predicate — matching
 * {@link isProcedureCallStatement}'s convention rather than {@link isPrintCall}'s: `execute-
 * Statements` already narrowed `statement` away from `CallNode | ParenCallNode` entirely once
 * `isPrintCall`'s (unsound, since it covers only `print`) type predicate's negative branch was
 * taken above, so a second full type-predicate guard over the same node kinds would narrow to
 * `never` here instead. The call site casts back to `CallNode | ParenCallNode` explicitly, same
 * as {@link isProcedureCallStatement}'s caller does.
 */
function isTurtleMoveCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return name === "forward" || name === "back";
}

/**
 * Move the turtle `distance` units along its current heading and emit the `move` effect-event
 * `spec/execution-model.md:592-593` requires, reporting the position change and heading. A
 * `draw-segment` reporting the same endpoints plus the pen color/width active at the moment the
 * segment is created (`spec/rendering.md`'s "Line segments" section) follows it **only while the
 * pen is down** (`environment.turtle.penDown`) — `spec/rendering.md`'s "Line segments" section: a segment
 * is drawn only while the pen is down; while up, the turtle still moves (and still emits `move`)
 * but leaves no trail (issue #206, `pen_up`/`pen_down`). `distance` is negative for `back`
 * (`back n` == `forward -n`, `spec/commands.md:1215`), positive for `forward`.
 *
 * Movement math is `spec/execution-model.md:545-546`'s `(x + d·sin h, y + d·cos h)`: heading `0`
 * points up (`+y`), and `right` turns clockwise, so increasing heading rotates the direction of
 * travel clockwise from up — exactly what `Math.sin`/`Math.cos` of a heading measured clockwise
 * from the `+y` axis produce once converted from degrees to radians.
 */
function moveTurtle(
  environment: Environment,
  distance: number,
  source_span: SourceSpan,
): void {
  const { turtle } = environment;
  const heading = turtle.heading;
  const radians = (heading * Math.PI) / 180;
  const from: Point = [turtle.x, turtle.y];
  const to: Point = [
    turtle.x + distance * Math.sin(radians),
    turtle.y + distance * Math.cos(radians),
  ];
  turtle.x = to[0];
  turtle.y = to[1];
  environment.events.push({
    seq: environment.events.length,
    kind: "move",
    source_span,
    payload: { from, to, heading } satisfies MovePayload,
  });
  if (turtle.penDown) {
    environment.events.push({
      seq: environment.events.length,
      kind: "draw-segment",
      source_span,
      payload: {
        from,
        to,
        color: turtle.color,
        width: turtle.width,
      } satisfies DrawSegmentPayload,
    });
  }
}

/**
 * Validate and run a `forward`/`back` statement matched by {@link isTurtleMoveCall}: exactly one
 * numeric argument (`ol-not-enough-inputs`/`ol-too-many-inputs`/`ol-type` otherwise, via
 * {@link requireNumber}), negated for `back` (`back n` == `forward -n`), then delegated to
 * {@link moveTurtle}. Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success (including the "left un-evaluated" case for
 * an unsupported argument expression, mirroring `print`'s handling).
 *
 * Deliberately a separate, non-inlined function rather than inline logic inside
 * {@link executeStatements}: `executeStatements` recurses (through {@link runProcedureBody} /
 * {@link runProcedure} / {@link evaluate}'s `callProcedure` callback) once per nested procedure
 * call, so every local variable declared directly in its body adds to the native stack frame
 * reserved on *every* recursive level — even for recursion that never touches `forward`/`back`.
 * Keeping this branch's locals in their own (non-recursive) function keeps `executeStatements`'s
 * own frame small, which is what lets `execution-budget.test.mjs`'s 1000-deep
 * `recursionDepthLimit` override actually complete without hitting the real (V8) native stack
 * limit first.
 */
function executeTurtleMoveCall(
  moveCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = moveCall.callee.name;
  if (moveCall.args.length !== 1) {
    return halt(
      moveCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            moveCall.callee.source_span,
            callableName,
            1,
            moveCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            moveCall.callee.source_span,
            callableName,
            1,
            moveCall.args.length,
          ),
    );
  }
  const [arg] = moveCall.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const distance = requireNumber(
    argResult.value,
    arg.source_span,
    callableName.toLowerCase(),
  );
  if (!distance.ok) {
    return halt(distance.diagnostic);
  }
  if (!Number.isFinite(distance.value)) {
    // `requireNumber` accepts `Infinity`/`-Infinity` (reachable via arithmetic overflow, e.g.
    // `power 10 1000` — see `comparison-equality.test.mjs`), but `moveTurtle`'s `d·sin h`/`d·cos h`
    // can turn that into `NaN` whenever `sin`/`cos` of the heading is exactly `0` (IEEE 754
    // `0 * Infinity` is `NaN`), silently corrupting the emitted position instead of raising a
    // diagnostic (`spec/execution-model.md:517` — "OpenLogo never exposes NaN or Infinity as
    // learner-facing results").
    return halt(
      runtimeDiag.nonFiniteDistance(arg.source_span, {
        operation: callableName.toLowerCase() as "forward" | "back",
        value: String(distance.value),
      }),
    );
  }
  const signedDistance =
    callableName.toLowerCase() === "back" ? -distance.value : distance.value;
  moveTurtle(environment, signedDistance, moveCall.source_span);
  return undefined;
}

/**
 * Is `statement` a call to `left`/`right` (issue #201, Core Turtle turning — the Heritage
 * `lt`/`rt` aliases are a separate M5 slice)? Same shape/convention as {@link isTurtleMoveCall}:
 * accepts both the plain infix `Call` form (`right 90`) and the explicit-parentheses `ParenCall`
 * form (`(right 90)`), and is a plain `boolean` rather than a type predicate for the same
 * type-narrowing reason documented on {@link isTurtleMoveCall}.
 */
function isTurtleTurnCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return name === "left" || name === "right";
}

/**
 * Turn the turtle by `deltaDegrees` (positive turns clockwise, i.e. `right`; negative turns
 * counter-clockwise, i.e. `left` — `spec/execution-model.md:537`) and emit the `turn` effect-event
 * `spec/execution-model.md:594` requires (`{from, to}`, both headings in degrees). The new heading
 * is normalized to `[0,360)` (`spec/execution-model.md:538`) — never left negative or `>= 360`.
 *
 * Turning has no `move`/`draw-segment` counterpart: it only rotates, never translates, so no
 * position or drawing event follows it.
 */
function turnTurtle(
  environment: Environment,
  deltaDegrees: number,
  source_span: SourceSpan,
): void {
  const { turtle } = environment;
  const from = turtle.heading;
  const to = normalizeHeading(from + deltaDegrees);
  turtle.heading = to;
  environment.events.push({
    seq: environment.events.length,
    kind: "turn",
    source_span,
    payload: { from, to } satisfies TurnPayload,
  });
}

/**
 * Validate and run a `left`/`right` statement matched by {@link isTurtleTurnCall}: exactly one
 * numeric argument (`ol-not-enough-inputs`/`ol-too-many-inputs`/`ol-type` otherwise, via
 * {@link requireNumber}), negated for `left` (turning counter-clockwise is a negative heading
 * delta, since `right`/clockwise is positive — `spec/execution-model.md:537`), then delegated to
 * {@link turnTurtle}. Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success (including the "left un-evaluated" case for
 * an unsupported argument expression, mirroring `forward`/`back`'s handling).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleTurnCall(
  turnCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = turnCall.callee.name;
  if (turnCall.args.length !== 1) {
    return halt(
      turnCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            turnCall.callee.source_span,
            callableName,
            1,
            turnCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            turnCall.callee.source_span,
            callableName,
            1,
            turnCall.args.length,
          ),
    );
  }
  const [arg] = turnCall.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const angle = requireNumber(
    argResult.value,
    arg.source_span,
    callableName.toLowerCase(),
  );
  if (!angle.ok) {
    return halt(angle.diagnostic);
  }
  if (!Number.isFinite(angle.value)) {
    // Same rationale as `executeTurtleMoveCall`'s non-finite-distance guard: `requireNumber`
    // accepts `Infinity`/`-Infinity` (reachable via arithmetic overflow), but `Infinity % 360` is
    // `NaN`, which would otherwise corrupt the turtle's heading instead of raising a diagnostic
    // (`spec/execution-model.md:517`).
    return halt(
      runtimeDiag.nonFiniteAngle(arg.source_span, {
        operation: callableName.toLowerCase() as "left" | "right",
        value: String(angle.value),
      }),
    );
  }
  const signedAngle =
    callableName.toLowerCase() === "left" ? -angle.value : angle.value;
  turnTurtle(environment, signedAngle, turnCall.source_span);
  return undefined;
}

/**
 * Is `statement` a call to `pen_up`/`pen_down` (issue #206, Core pen state — the Heritage `pu`/
 * `pd` aliases are a separate M5 slice)? Same shape/convention as {@link isTurtleMoveCall}/
 * {@link isTurtleTurnCall}: accepts both the plain infix `Call` form (`pen_up`) and the
 * explicit-parentheses `ParenCall` form (`(pen_up)`), and is a plain `boolean` rather than a type
 * predicate for the same type-narrowing reason documented on {@link isTurtleMoveCall}.
 */
function isTurtlePenCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return name === "pen_up" || name === "pen_down";
}

/**
 * Set the turtle's pen state and emit the `pen-change` effect-event `spec/rendering.md`'s "Line
 * segments" section requires (`{from, to}`, both `"up"`/`"down"`) — mirrors {@link turnTurtle}'s
 * `{from, to}` shape. Always emits the event, even when the pen was already in the requested state
 * (calling `pen_down` twice in a row is not an error, and the learner still gets a confirming
 * event each time — the same "unconditional emit" choice {@link turnTurtle} makes).
 *
 * Setting has no `move`/`draw-segment` counterpart: it never moves or turns the turtle, so no
 * position or heading event follows it. It is, however, the reason {@link moveTurtle}'s
 * `draw-segment` is now conditional on `environment.turtle.penDown`.
 */
function setPen(
  environment: Environment,
  penDown: boolean,
  source_span: SourceSpan,
): void {
  const { turtle } = environment;
  const from = turtle.penDown ? "down" : "up";
  const to = penDown ? "down" : "up";
  turtle.penDown = penDown;
  environment.events.push({
    seq: environment.events.length,
    kind: "pen-change",
    source_span,
    payload: { from, to } satisfies PenChangePayload,
  });
}

/**
 * Validate and run a `pen_up`/`pen_down` statement matched by {@link isTurtlePenCall}: exactly
 * zero arguments (`ol-too-many-inputs` otherwise — `pen_up`/`pen_down`'s registered arity is `0`,
 * `packages/parser/src/signatures.ts`, so a call can never be parsed with fewer than zero
 * arguments, only more via the parenthesized form, e.g. `(pen_up 1)`), then delegated to
 * {@link setPen}. Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success.
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtlePenCall(
  penCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = penCall.callee.name;
  if (penCall.args.length !== 0) {
    return halt(
      runtimeDiag.tooManyInputs(
        penCall.callee.source_span,
        callableName,
        0,
        penCall.args.length,
      ),
    );
  }
  setPen(
    environment,
    callableName.toLowerCase() === "pen_down",
    penCall.source_span,
  );
  return undefined;
}

/**
 * Is `statement` a call to `show_turtle`/`hide_turtle` (issue #207, Core turtle-avatar
 * visibility — the Heritage `st`/`ht` aliases are a separate M5 slice)? Same shape/convention as
 * {@link isTurtlePenCall}.
 */
function isTurtleVisibilityCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return name === "show_turtle" || name === "hide_turtle";
}

/**
 * Set the turtle's visibility and emit the `visibility-change` effect-event
 * `spec/rendering.md`'s "Turtle avatar and shapes" section requires (`{from, to}`, both
 * `boolean`) — mirrors {@link setPen}'s `{from, to}` shape. Always emits the event, even when the
 * turtle was already in the requested visibility (calling `show_turtle` twice in a row is not an
 * error, and the learner still gets a confirming event each time — the same "unconditional emit"
 * choice {@link turnTurtle}/{@link setPen} make).
 *
 * Unlike {@link setPen}, visibility has no `move`/`draw-segment` interaction at all: a hidden
 * turtle still moves, turns, and draws exactly as when visible (`spec/rendering.md`'s "Turtle
 * avatar and shapes" section) — `visible` is purely a display flag for the renderer, never a
 * gate `moveTurtle` checks.
 */
function setVisibility(
  environment: Environment,
  visible: boolean,
  source_span: SourceSpan,
): void {
  const { turtle } = environment;
  const from = turtle.visible;
  turtle.visible = visible;
  environment.events.push({
    seq: environment.events.length,
    kind: "visibility-change",
    source_span,
    payload: { from, to: visible } satisfies VisibilityChangePayload,
  });
}

/**
 * Validate and run a `show_turtle`/`hide_turtle` statement matched by
 * {@link isTurtleVisibilityCall}: exactly zero arguments (`ol-too-many-inputs` otherwise —
 * `show_turtle`/`hide_turtle`'s registered arity is `0`, `packages/parser/src/signatures.ts`, so a
 * call can never be parsed with fewer than zero arguments, only more via the parenthesized form,
 * e.g. `(show_turtle 1)`), then delegated to {@link setVisibility}. Returns an {@link ExecSignal}
 * to halt on, or `undefined` for {@link executeStatements} to `continue` on success.
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleVisibilityCall(
  visibilityCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = visibilityCall.callee.name;
  if (visibilityCall.args.length !== 0) {
    return halt(
      runtimeDiag.tooManyInputs(
        visibilityCall.callee.source_span,
        callableName,
        0,
        visibilityCall.args.length,
      ),
    );
  }
  setVisibility(
    environment,
    callableName.toLowerCase() === "show_turtle",
    visibilityCall.source_span,
  );
  return undefined;
}

/**
 * Is `statement` a call to `clear_screen`/`clean` (issue #204, Core drawing/turtle reset — the
 * Heritage `cs` alias is a separate M5 slice, deliberately left unregistered so it still raises
 * `ol-unknown-command` at this milestone). Same shape/convention as {@link isTurtleVisibilityCall}.
 */
function isTurtleClearCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return name === "clear_screen" || name === "clean";
}

/**
 * Clear the drawing and, for `clear_screen` only, silently home the turtle's position and
 * heading — emitting exactly one `clear` event (`spec/rendering.md`'s "Clear operations" table:
 * `clean` clears drawing only, `clear_screen` clears drawing and homes position+heading; both
 * leave pen state, color, width, visibility, and background unchanged).
 *
 * `clear_screen`'s homing is deliberately a *silent* internal state reset — no `move`/`turn`
 * event fires alongside it. `@openlogo/turtle`'s scene/state reducers (issues #211/#213, already
 * merged) fold a `clear{mode:"clear_screen"}` event into a position/heading reset themselves, so
 * emitting `move`/`turn` here as well would double-home the reducer's turtle state. This mirrors
 * how {@link setVisibility}/{@link setPen} emit only their own single event, not a compound one.
 *
 * Still exactly one `clear` event, but a `clear_screen` under explicit addressing (`tell`/`ask`/
 * `each`) carries the homed turtle's `turtle_id` (`addressing.currentId`) so a per-turtle state
 * reducer homes the turtle the runtime actually homed rather than assuming the main turtle; `clean`
 * (drawing-only, homes no turtle) never carries one, and before any `tell` even `clear_screen` stays
 * un-stamped, exactly as the pre-slice Turtle & Rendering `clear` fixtures expect.
 */
function clearScreen(
  environment: Environment,
  mode: "clear_screen" | "clean",
  source_span: SourceSpan,
): void {
  const { turtle, addressing } = environment;
  if (mode === "clear_screen") {
    turtle.x = 0;
    turtle.y = 0;
    turtle.heading = 0;
  }
  // The canvas clear is emitted once (not per turtle — see {@link isPerTurtleCommand}). Only
  // `clear_screen` homes a turtle, and it homes the *current* one; once `tell`/`ask`/`each` has made
  // the addressed set explicit that current turtle need not be the main turtle, so its single `clear`
  // event carries `addressing.currentId` — exactly the `turtle_id` {@link stampTurtleId} would put on
  // a per-turtle event — letting a per-turtle state reducer home the turtle the runtime actually
  // homed instead of guessing the main turtle. `clean` changes no turtle (it only clears the
  // drawing), so it never carries a `turtle_id`; and before any `tell` (`explicit === false`) even a
  // `clear_screen` stays un-stamped, matching every Turtle & Rendering `clear` fixture emitted before
  // this slice.
  const turtle_id =
    mode === "clear_screen" && addressing.explicit
      ? addressing.currentId
      : undefined;
  environment.events.push({
    seq: environment.events.length,
    kind: "clear",
    source_span,
    ...(turtle_id === undefined ? {} : { turtle_id }),
    payload: { mode } satisfies ClearPayload,
  });
}

/**
 * Validate and run a `clear_screen`/`clean` statement matched by {@link isTurtleClearCall}:
 * exactly zero arguments (`ol-too-many-inputs` otherwise), then delegated to
 * {@link clearScreen}. Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success.
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleClearCall(
  clearCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = clearCall.callee.name;
  if (clearCall.args.length !== 0) {
    return halt(
      runtimeDiag.tooManyInputs(
        clearCall.callee.source_span,
        callableName,
        0,
        clearCall.args.length,
      ),
    );
  }
  clearScreen(
    environment,
    callableName.toLowerCase() === "clear_screen" ? "clear_screen" : "clean",
    clearCall.source_span,
  );
  return undefined;
}

/**
 * Is `statement` a call to `set_color` or its Turtle & Rendering-profile alias `setcolor` (issue
 * #208; `spec/commands.md:1521`). Not Heritage — same rationale as {@link isTurtlePositionCall}'s
 * `setxy`. Same shape/convention as {@link isTurtleVisibilityCall}.
 */
function isTurtleColorCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return name === "set_color" || name === "setcolor";
}

/**
 * Validate and run a `set_color`/`setcolor` statement matched by {@link isTurtleColorCall}:
 * exactly one argument (`ol-not-enough-inputs`/`ol-too-many-inputs` otherwise), validated by
 * {@link normalizeColor} against the three accepted color forms
 * (`spec/commands.md`'s "Colors" section) — an unknown word, a wrong-length or out-of-range-
 * component `[r g b]` list, or a malformed hex word all raise `ol-bad-color`
 * (`runtimeDiag.badColor`). On success, sets `turtle.color` and emits a `color-change` event
 * (`{from, to}`, mirroring {@link turnTurtle}'s shape — `spec/rendering.md`'s "Color" section:
 * "Color state is part of turtle state"). Unlike {@link moveTurtle}, there is no `move`/
 * `draw-segment` interaction: changing the pen color affects only *future* segments, which already
 * capture `turtle.color` at draw time (see {@link moveTurtle}/{@link moveTurtleTo}'s
 * `DrawSegmentPayload`) — no zero-length segment is drawn for the color change itself. Returns an
 * {@link ExecSignal} to halt on, or `undefined` for {@link executeStatements} to `continue` on
 * success (including the "left un-evaluated" case for an unsupported argument expression,
 * mirroring `set_heading`/`seth`'s handling).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleColorCall(
  colorCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = colorCall.callee.name;
  if (colorCall.args.length !== 1) {
    return halt(
      colorCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            colorCall.callee.source_span,
            callableName,
            1,
            colorCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            colorCall.callee.source_span,
            callableName,
            1,
            colorCall.args.length,
          ),
    );
  }
  const [arg] = colorCall.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const operation = callableName.toLowerCase() as "set_color" | "setcolor";
  const color = normalizeColor(argResult.value);
  if (color === undefined) {
    return halt(
      runtimeDiag.badColor(arg.source_span, {
        operation,
        value: argResult.value,
      }),
    );
  }
  const { turtle } = environment;
  const from = turtle.color;
  turtle.color = color;
  environment.events.push({
    seq: environment.events.length,
    kind: "color-change",
    source_span: colorCall.source_span,
    payload: { from, to: color } satisfies ColorChangePayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `set_background` or its Turtle & Rendering-profile alias `setbg` (issue
 * #208; `spec/commands.md:1539`). Not Heritage — same rationale as {@link isTurtlePositionCall}'s
 * `setxy`. Same shape/convention as {@link isTurtleColorCall}.
 */
function isTurtleBackgroundCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return name === "set_background" || name === "setbg";
}

/**
 * Validate and run a `set_background`/`setbg` statement matched by
 * {@link isTurtleBackgroundCall}: exactly one argument (`ol-not-enough-inputs`/
 * `ol-too-many-inputs` otherwise), validated by {@link normalizeColor} the same way
 * {@link executeTurtleColorCall} does (`ol-bad-color` on an unaccepted form). On success, emits a
 * `background-change` event carrying only the new color (`spec/rendering.md`'s "Background"
 * section: "The background is a scene property, not a segment" — there is no prior-value pairing
 * to report, unlike {@link ColorChangePayload}'s `{from, to}`). The runtime does not track
 * background as turtle state at all: `clear_screen`/`clean` leave it unchanged
 * (`spec/rendering.md`'s "Clear operations" table), and no other command reads it back, so there
 * is nothing for a runtime-side field to serve — the scene's background is `@openlogo/turtle`'s
 * own reducer state, folded from this event. Returns an {@link ExecSignal} to halt on, or
 * `undefined` for {@link executeStatements} to `continue` on success (including the "left
 * un-evaluated" case for an unsupported argument expression, mirroring
 * {@link executeTurtleColorCall}'s handling).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleBackgroundCall(
  backgroundCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = backgroundCall.callee.name;
  if (backgroundCall.args.length !== 1) {
    return halt(
      backgroundCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            backgroundCall.callee.source_span,
            callableName,
            1,
            backgroundCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            backgroundCall.callee.source_span,
            callableName,
            1,
            backgroundCall.args.length,
          ),
    );
  }
  const [arg] = backgroundCall.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const operation = callableName.toLowerCase() as "set_background" | "setbg";
  const color = normalizeColor(argResult.value);
  if (color === undefined) {
    return halt(
      runtimeDiag.badColor(arg.source_span, {
        operation,
        value: argResult.value,
      }),
    );
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "background-change",
    source_span: backgroundCall.source_span,
    payload: { color } satisfies BackgroundChangePayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `set_width` or its Turtle & Rendering-profile alias `setwidth` (issue
 * #209; `spec/commands.md:1556`). Not Heritage — same rationale as {@link isTurtlePositionCall}'s
 * `setxy`. Same shape/convention as {@link isTurtleColorCall}.
 */
function isTurtleWidthCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return name === "set_width" || name === "setwidth";
}

/**
 * Validate and run a `set_width`/`setwidth` statement matched by {@link isTurtleWidthCall}: exactly
 * one numeric argument (`ol-not-enough-inputs`/`ol-too-many-inputs`/`ol-type` otherwise, via
 * {@link requireNumber}), which must additionally be positive and finite
 * (`spec/commands.md`'s `set_width` entry: "The width MUST be a positive number") or
 * `runtimeDiag.nonPositiveWidth` raises `ol-range` — folding `Infinity` into the same guard as `0`/
 * negative widths for the same "never expose Infinity to a learner" reason documented on
 * {@link executeTurtleMoveCall}'s `nonFiniteDistance` check. On success, sets `turtle.width` and
 * emits a `width-change` event (`{from, to}`, mirroring {@link executeTurtleColorCall}'s
 * `color-change` shape — `spec/rendering.md`'s "Width" section). Like color, there is no
 * `move`/`draw-segment` interaction: changing the pen width affects only *future* segments, which
 * already capture `turtle.width` at draw time (see {@link moveTurtle}/{@link moveTurtleTo}'s
 * `DrawSegmentPayload`). Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success (including the "left un-evaluated" case for
 * an unsupported argument expression, mirroring {@link executeTurtleColorCall}'s handling).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleWidthCall(
  widthCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = widthCall.callee.name;
  if (widthCall.args.length !== 1) {
    return halt(
      widthCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            widthCall.callee.source_span,
            callableName,
            1,
            widthCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            widthCall.callee.source_span,
            callableName,
            1,
            widthCall.args.length,
          ),
    );
  }
  const [arg] = widthCall.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const operation = callableName.toLowerCase() as "set_width" | "setwidth";
  const width = requireNumber(argResult.value, arg.source_span, operation);
  if (!width.ok) {
    return halt(width.diagnostic);
  }
  if (!Number.isFinite(width.value) || width.value <= 0) {
    return halt(
      runtimeDiag.nonPositiveWidth(arg.source_span, {
        operation,
        value: String(width.value),
      }),
    );
  }
  const { turtle } = environment;
  const from = turtle.width;
  turtle.width = width.value;
  environment.events.push({
    seq: environment.events.length,
    kind: "width-change",
    source_span: widthCall.source_span,
    payload: { from, to: width.value } satisfies WidthChangePayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `fill` (issue #210; `spec/rendering.md`'s "Fill" section). Same
 * shape/convention as {@link isTurtleClearCall} — a bare 0-arity turtle command with no Turtle &
 * Rendering-profile alias.
 */
function isTurtleFillCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "fill";
}

/**
 * Validate and run a `fill` statement matched by {@link isTurtleFillCall}: exactly zero arguments
 * (`ol-too-many-inputs` otherwise), then emit a `fill` event carrying the current pen color
 * (`spec/rendering.md`'s "Fill" section — the current pen color unless a vendor extension exposes
 * a separate fill color; `spec/rendering.md`'s "Color" section: "a segment, fill, or stamp
 * captures the color at the moment its event is applied"). No turtle-state change: `fill` affects
 * only the retained scene, which is `@openlogo/turtle`'s reducer's job (issue #213) — the runtime
 * only emits the one event. Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success.
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleFillCall(
  fillCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = fillCall.callee.name;
  if (fillCall.args.length !== 0) {
    return halt(
      runtimeDiag.tooManyInputs(
        fillCall.callee.source_span,
        callableName,
        0,
        fillCall.args.length,
      ),
    );
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "fill",
    source_span: fillCall.source_span,
    payload: { color: environment.turtle.color } satisfies FillPayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `stamp` (issue #210; `spec/rendering.md`'s "Turtle avatar and shapes"
 * section). Same shape/convention as {@link isTurtleFillCall}.
 */
function isTurtleStampCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "stamp";
}

/**
 * Validate and run a `stamp` statement matched by {@link isTurtleStampCall}: exactly zero
 * arguments (`ol-too-many-inputs` otherwise), then emit a `stamp` event snapshotting the turtle
 * avatar's current position, heading, shape, and pen color (`spec/rendering.md`'s "Turtle avatar
 * and shapes" section) into the retained scene. Independent of pen state — a stamp is recorded
 * even with the pen up, unlike {@link moveTurtle}'s `draw-segment`, since stamping the avatar is
 * not drawing a line (`spec/rendering.md`'s "Turtle avatar and shapes" section: the avatar and its
 * stamps are separate from the pen's drawn path). No turtle-state change: the runtime only emits
 * the one event. Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success.
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleStampCall(
  stampCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = stampCall.callee.name;
  if (stampCall.args.length !== 0) {
    return halt(
      runtimeDiag.tooManyInputs(
        stampCall.callee.source_span,
        callableName,
        0,
        stampCall.args.length,
      ),
    );
  }
  const { turtle } = environment;
  environment.events.push({
    seq: environment.events.length,
    kind: "stamp",
    source_span: stampCall.source_span,
    payload: {
      position: [turtle.x, turtle.y],
      heading: turtle.heading,
      shape: turtle.shape,
      color: turtle.color,
    } satisfies StampPayload,
  });
  return undefined;
}

/**
 * `grid`'s default guide-line spacing in canvas units (`spec/geometry-module.md:272`: "Default
 * grid spacing is `20` canvas units"). `grid` takes no arguments (Kind C, arity 0), so this is the
 * only spacing the runtime ever emits — a future slice adding a `grid :spacing` overload would
 * change the arity table and this call site together, not this constant alone.
 */
const DEFAULT_GRID_SPACING = 20;

/**
 * Is `statement` a call to `grid` (issue #341; `spec/geometry-module.md:268-280`). Same
 * shape/convention as {@link isTurtleStampCall}.
 */
function isTurtleGridCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "grid";
}

/**
 * Validate and run a `grid` statement matched by {@link isTurtleGridCall}: exactly zero arguments
 * (`ol-too-many-inputs` otherwise), then emit one `overlay` event carrying a
 * {@link GridOverlayPayload} at the spec's default spacing of `20` canvas units
 * (`spec/geometry-module.md:272`). `grid` is Kind C — it creates or refreshes a persistent
 * renderer overlay, never turtle position, heading, pen, color, or width, and the overlay
 * survives `clean` (`@openlogo/turtle`'s `overlay.ts` reducer has no `clear` case, so this event
 * is never undone by one). No turtle-state change: the runtime only emits the one event. Returns
 * an {@link ExecSignal} to halt on, or `undefined` for {@link executeStatements} to `continue` on
 * success.
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleGridCall(
  gridCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = gridCall.callee.name;
  if (gridCall.args.length !== 0) {
    return halt(
      runtimeDiag.tooManyInputs(
        gridCall.callee.source_span,
        callableName,
        0,
        gridCall.args.length,
      ),
    );
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "overlay",
    source_span: gridCall.source_span,
    payload: {
      overlay: "grid",
      spacing: DEFAULT_GRID_SPACING,
    } satisfies GridOverlayPayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `axes` (issue #341; `spec/geometry-module.md:282-292`). Same
 * shape/convention as {@link isTurtleGridCall}.
 */
function isTurtleAxesCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "axes";
}

/**
 * Validate and run an `axes` statement matched by {@link isTurtleAxesCall}: exactly zero
 * arguments (`ol-too-many-inputs` otherwise), then emit one `overlay` event carrying an
 * {@link AxesOverlayPayload}. `axes` is Kind C — the crossed axes overlay through the origin
 * (the turtle's `home` position, `spec/geometry-module.md:286`) never changes turtle state and
 * survives `clean`. No turtle-state change: the runtime only emits the one event. Returns an
 * {@link ExecSignal} to halt on, or `undefined` for {@link executeStatements} to `continue` on
 * success.
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleAxesCall(
  axesCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = axesCall.callee.name;
  if (axesCall.args.length !== 0) {
    return halt(
      runtimeDiag.tooManyInputs(
        axesCall.callee.source_span,
        callableName,
        0,
        axesCall.args.length,
      ),
    );
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "overlay",
    source_span: axesCall.source_span,
    payload: {
      overlay: "axes",
    } satisfies AxesOverlayPayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `measure` (issue #341; `spec/geometry-module.md:296-306`). Same
 * shape/convention as {@link isTurtleGridCall}.
 */
function isTurtleMeasureCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "measure";
}

/**
 * Validate and run a `measure` statement matched by {@link isTurtleMeasureCall}: exactly zero
 * arguments (`ol-too-many-inputs` otherwise), then emit one `overlay` event snapshotting the
 * turtle's current position and heading into a {@link MeasureOverlayPayload} — mirroring
 * {@link executeTurtleStampCall}'s position/heading snapshot. `measure` is Kind C: "It returns no
 * value and does not change the turtle state" (`spec/geometry-module.md:298`). No turtle-state
 * change: the runtime only emits the one event. Returns an {@link ExecSignal} to halt on, or
 * `undefined` for {@link executeStatements} to `continue` on success.
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleMeasureCall(
  measureCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = measureCall.callee.name;
  if (measureCall.args.length !== 0) {
    return halt(
      runtimeDiag.tooManyInputs(
        measureCall.callee.source_span,
        callableName,
        0,
        measureCall.args.length,
      ),
    );
  }
  const { turtle } = environment;
  environment.events.push({
    seq: environment.events.length,
    kind: "overlay",
    source_span: measureCall.source_span,
    payload: {
      overlay: "measure",
      position: [turtle.x, turtle.y],
      heading: turtle.heading,
    } satisfies MeasureOverlayPayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `set_shape` (issue #210; `spec/commands.md:1573`). Same
 * shape/convention as {@link isTurtleColorCall} — no Turtle & Rendering-profile alias is
 * registered for `set_shape` (unlike `set_color`/`set_width`/`set_xy`/`set_heading`, which each
 * have a one-word alias).
 */
function isTurtleShapeCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "set_shape";
}

/**
 * Validate and run a `set_shape` statement matched by {@link isTurtleShapeCall}: exactly one
 * argument (`ol-not-enough-inputs`/`ol-too-many-inputs` otherwise), which must be a word
 * (`ol-type`, `expected: "word"`, otherwise — mirrors `evaluate.ts`'s `evaluateThing`'s
 * non-word check) naming one of the recognized shapes (`packages/runtime/src/shape.ts`'s
 * {@link isRecognizedShape}) — an unrecognized shape word is *also* `ol-type`, but with
 * `expected: "shape"` instead of `expected: "word"`: `spec/commands.md`'s `set_shape` entry
 * specifies no dedicated code ("Possible errors: none specified in C3 beyond general type and
 * arity diagnostics"), because the shape set is open/implementation-defined
 * (`spec/rendering.md`'s "Turtle avatar and shapes" section: MUST support the default, SHOULD
 * support the portable set, MAY support more) rather than the closed palette `set_color` has —
 * so there is no enumerable `value` set to anchor a dedicated `ol-bad-shape` code the way
 * `ol-bad-color` anchors `set_color`'s. `error-model.md` treats `params` as part of a diagnostic's
 * identity, so these are two distinct `ol-type` identities differentiated by `expected`/`value`,
 * not one code overloaded ambiguously.
 *
 * On success, sets `turtle.shape` and emits a `shape-change` event (`{from, to}`, mirroring
 * {@link executeTurtleColorCall}'s `color-change` shape). No `move`/`draw-segment` interaction:
 * changing the shape affects only how the avatar is drawn/stamped going forward, not the drawn
 * path. Returns an {@link ExecSignal} to halt on, or `undefined` for {@link executeStatements} to
 * `continue` on success (including the "left un-evaluated" case for an unsupported argument
 * expression, mirroring {@link executeTurtleColorCall}'s handling).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleShapeCall(
  shapeCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = shapeCall.callee.name;
  if (shapeCall.args.length !== 1) {
    return halt(
      shapeCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            shapeCall.callee.source_span,
            callableName,
            1,
            shapeCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            shapeCall.callee.source_span,
            callableName,
            1,
            shapeCall.args.length,
          ),
    );
  }
  const [arg] = shapeCall.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  if (typeof argResult.value !== "string") {
    return halt(
      runtimeDiag.placeType(arg.source_span, {
        expected: "word",
        actual: typeNameOf(argResult.value),
        value: argResult.value,
        operation: "set_shape",
      }),
    );
  }
  if (!isRecognizedShape(argResult.value)) {
    return halt(
      runtimeDiag.unknownShape(arg.source_span, {
        value: argResult.value,
        operation: "set_shape",
      }),
    );
  }
  const shape = normalizeShape(argResult.value);
  const { turtle } = environment;
  const from = turtle.shape;
  turtle.shape = shape;
  environment.events.push({
    seq: environment.events.length,
    kind: "shape-change",
    source_span: shapeCall.source_span,
    payload: { from, to: shape } satisfies ShapeChangePayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `home`/`set_xy` or `set_xy`'s Turtle & Rendering-profile alias `setxy`
 * (issue #202, Core absolute positioning; `spec/commands.md:1279`). Unlike `forward`'s `fd`,
 * `setxy`/`seth` are **not** Heritage — `spec/conformance.md:105-117`'s Heritage short-alias list
 * is closed and does not include them, so they are registered (with `set_xy`'s arity) in
 * `packages/parser/src/signatures.ts` and dispatched identically here. Same shape/convention as
 * {@link isTurtleMoveCall}.
 */
function isTurtlePositionCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return name === "home" || name === "set_xy" || name === "setxy";
}

/**
 * Move the turtle directly to an absolute `to` position (as opposed to {@link moveTurtle}'s
 * relative distance-along-the-current-heading move) and emit the same `move`/conditional
 * `draw-segment` pair `moveTurtle` does — `home`'s jump to `(0,0)` and `set_xy`'s jump to an
 * arbitrary point are both "the turtle moved from A to B", just computed differently. Heading is
 * unaffected (the `move` event's `heading` field reports the turtle's current heading, unchanged
 * by a position-only move — `set_heading`/`home`'s own heading reset is a separate `turn` event
 * via {@link setHeadingTo}).
 */
function moveTurtleTo(
  environment: Environment,
  to: Point,
  source_span: SourceSpan,
): void {
  const { turtle } = environment;
  const from: Point = [turtle.x, turtle.y];
  turtle.x = to[0];
  turtle.y = to[1];
  environment.events.push({
    seq: environment.events.length,
    kind: "move",
    source_span,
    payload: { from, to, heading: turtle.heading } satisfies MovePayload,
  });
  if (turtle.penDown) {
    environment.events.push({
      seq: environment.events.length,
      kind: "draw-segment",
      source_span,
      payload: {
        from,
        to,
        color: turtle.color,
        width: turtle.width,
      } satisfies DrawSegmentPayload,
    });
  }
}

/**
 * Set the turtle's heading directly to an absolute, already-normalized `to` value (as opposed to
 * {@link turnTurtle}'s relative delta turn) and emit the same `turn` event `turnTurtle` does. `to`
 * must already be normalized to `[0,360)` (via {@link normalizeHeading}) — this helper does not
 * normalize again, matching {@link turnTurtle}'s own division of labor (it normalizes, this
 * doesn't need to since both its callers already have).
 */
function setHeadingTo(
  environment: Environment,
  to: number,
  source_span: SourceSpan,
): void {
  const { turtle } = environment;
  const from = turtle.heading;
  turtle.heading = to;
  environment.events.push({
    seq: environment.events.length,
    kind: "turn",
    source_span,
    payload: { from, to } satisfies TurnPayload,
  });
}

/**
 * Validate and run a `home`/`set_xy`/`setxy` statement matched by {@link isTurtlePositionCall}.
 * `home` takes zero arguments and resets both position (to `(0,0)`) and heading (to `0`) — it is a
 * move like any other, so it emits `move`/conditional `draw-segment` (via {@link moveTurtleTo})
 * followed by `turn` (via {@link setHeadingTo}) (`spec/commands.md:1259-1274`). `set_xy`/`setxy`
 * takes exactly two numeric arguments and moves the turtle to that absolute position, leaving
 * heading untouched (`spec/commands.md:1276-1291`). Diagnostics: `ol-not-enough-inputs`/
 * `ol-too-many-inputs` for the wrong argument count, `ol-type` for a non-number `set_xy` argument
 * (via {@link requireNumber}), `ol-range` ({@link runtimeDiag.nonFiniteCoordinate}) for a
 * `set_xy` argument that is `Infinity`/`-Infinity` (same "never expose a non-finite learner-facing
 * result" rationale as {@link executeTurtleMoveCall}'s non-finite-distance guard —
 * `spec/execution-model.md:517`). Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success (including the "left un-evaluated" case for
 * an unsupported argument expression, mirroring `forward`/`back`'s handling).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtlePositionCall(
  positionCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = positionCall.callee.name;
  const isHome = callableName.toLowerCase() === "home";
  const expectedArgs = isHome ? 0 : 2;
  if (positionCall.args.length !== expectedArgs) {
    return halt(
      positionCall.args.length < expectedArgs
        ? runtimeDiag.notEnoughInputs(
            positionCall.callee.source_span,
            callableName,
            expectedArgs,
            positionCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            positionCall.callee.source_span,
            callableName,
            expectedArgs,
            positionCall.args.length,
          ),
    );
  }
  if (isHome) {
    moveTurtleTo(environment, [0, 0], positionCall.source_span);
    setHeadingTo(environment, 0, positionCall.source_span);
    return undefined;
  }
  const [xArg, yArg] = positionCall.args as [ExpressionNode, ExpressionNode];
  if (
    !isSupportedArgument(xArg, environment) ||
    !isSupportedArgument(yArg, environment)
  ) {
    return undefined;
  }
  const xResult = evaluate(xArg, environment);
  if (!xResult.ok) {
    return halt(xResult.diagnostic);
  }
  const yResult = evaluate(yArg, environment);
  if (!yResult.ok) {
    return halt(yResult.diagnostic);
  }
  const operation = callableName.toLowerCase() as "set_xy" | "setxy";
  const x = requireNumber(xResult.value, xArg.source_span, operation);
  if (!x.ok) {
    return halt(x.diagnostic);
  }
  const y = requireNumber(yResult.value, yArg.source_span, operation);
  if (!y.ok) {
    return halt(y.diagnostic);
  }
  if (!Number.isFinite(x.value)) {
    return halt(
      runtimeDiag.nonFiniteCoordinate(xArg.source_span, {
        operation,
        axis: "x",
        value: String(x.value),
      }),
    );
  }
  if (!Number.isFinite(y.value)) {
    return halt(
      runtimeDiag.nonFiniteCoordinate(yArg.source_span, {
        operation,
        axis: "y",
        value: String(y.value),
      }),
    );
  }
  moveTurtleTo(environment, [x.value, y.value], positionCall.source_span);
  return undefined;
}

/**
 * Is `statement` a call to `set_heading` or its Turtle & Rendering-profile alias `seth`
 * (issue #202; `spec/commands.md:1296`). Not Heritage — same rationale as
 * {@link isTurtlePositionCall}'s `setxy`. Same shape/convention as {@link isTurtleMoveCall}.
 */
function isTurtleHeadingCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return name === "set_heading" || name === "seth";
}

/**
 * Validate and run a `set_heading`/`seth` statement matched by {@link isTurtleHeadingCall}: exactly one
 * numeric argument (`ol-not-enough-inputs`/`ol-too-many-inputs`/`ol-type` otherwise, via
 * {@link requireNumber}), normalized to `[0,360)` (the same {@link normalizeHeading} `left`/
 * `right` use — `spec/commands.md:1300`, "Implementations normalize headings to [0,360)"), then
 * delegated to {@link setHeadingTo}. Unlike `left`/`right`, the argument is the turtle's new
 * *absolute* heading, not a delta — so it is normalized directly rather than added to the current
 * heading first. Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success (including the "left un-evaluated" case for
 * an unsupported argument expression, mirroring `left`/`right`'s handling).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeTurtleHeadingCall(
  headingCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = headingCall.callee.name;
  if (headingCall.args.length !== 1) {
    return halt(
      headingCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            headingCall.callee.source_span,
            callableName,
            1,
            headingCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            headingCall.callee.source_span,
            callableName,
            1,
            headingCall.args.length,
          ),
    );
  }
  const [arg] = headingCall.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const angle = requireNumber(
    argResult.value,
    arg.source_span,
    callableName.toLowerCase(),
  );
  if (!angle.ok) {
    return halt(angle.diagnostic);
  }
  if (!Number.isFinite(angle.value)) {
    // Same rationale as `executeTurtleTurnCall`'s non-finite-angle guard: `requireNumber` accepts
    // `Infinity`/`-Infinity`, but `Infinity % 360` is `NaN`, which would otherwise corrupt the
    // turtle's heading instead of raising a diagnostic (`spec/execution-model.md:517`).
    return halt(
      runtimeDiag.nonFiniteHeading(arg.source_span, {
        operation: callableName.toLowerCase() as "set_heading" | "seth",
        value: String(angle.value),
      }),
    );
  }
  setHeadingTo(
    environment,
    normalizeHeading(angle.value),
    headingCall.source_span,
  );
  return undefined;
}

/**
 * Is `statement` a call to `set_tempo` (issue #689; `spec/interaction-events.md:259-272`). Same
 * shape/convention as {@link isTurtleWidthCall} — a Sound-profile primitive with a single numeric
 * argument. Sound command names are ordinary primitive names (not reserved block-heads) when the
 * profile is present, so this is a plain `Call`/`ParenCall` callee-name match.
 */
function isSoundSetTempoCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "set_tempo";
}

/**
 * Validate and run a `set_tempo` statement matched by {@link isSoundSetTempoCall}: exactly one
 * numeric argument (`ol-not-enough-inputs`/`ol-too-many-inputs`/`ol-type` otherwise, via
 * {@link requireNumber}), which must additionally be positive and finite
 * (`spec/interaction-events.md:262` — "one positive number") or `runtimeDiag.nonPositiveTempo`
 * raises `ol-range` — folding `Infinity` into the same guard as `0`/negative, exactly as
 * {@link executeTurtleWidthCall} does for a width. On success, sets `environment.sound.tempo` (the
 * shared tempo `note`/`play`/`rest` will read once #690/#691 land) and emits one `sound` event
 * carrying a {@link SetTempoSoundPayload}, AFTER the tempo state has been updated
 * (`spec/interaction-events.md`'s trace-stream rule: "Sound commands emit `sound` events after
 * sound state has been scheduled"). Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success (including the "left un-evaluated" case for an
 * unsupported argument expression, mirroring {@link executeTurtleWidthCall}).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeSoundSetTempoCall(
  tempoCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = tempoCall.callee.name;
  if (tempoCall.args.length !== 1) {
    return halt(
      tempoCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            tempoCall.callee.source_span,
            callableName,
            1,
            tempoCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            tempoCall.callee.source_span,
            callableName,
            1,
            tempoCall.args.length,
          ),
    );
  }
  const [arg] = tempoCall.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const tempo = requireNumber(argResult.value, arg.source_span, "set_tempo");
  if (!tempo.ok) {
    return halt(tempo.diagnostic);
  }
  if (!Number.isFinite(tempo.value) || tempo.value <= 0) {
    return halt(
      runtimeDiag.nonPositiveTempo(arg.source_span, {
        value: String(tempo.value),
      }),
    );
  }
  environment.sound.tempo = tempo.value;
  environment.events.push({
    seq: environment.events.length,
    kind: "sound",
    source_span: tempoCall.source_span,
    payload: {
      command: "set_tempo",
      beats_per_minute: tempo.value,
    } satisfies SoundPayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `beep` (issue #689; `spec/interaction-events.md:309-324`). Same
 * shape/convention as {@link isTurtleGridCall} — a bare 0-arity Sound-profile primitive.
 */
function isSoundBeepCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "beep";
}

/**
 * Validate and run a `beep` statement matched by {@link isSoundBeepCall}: exactly zero arguments
 * (`ol-too-many-inputs` otherwise), then emit one `sound` event carrying a {@link BeepSoundPayload}.
 * `beep` schedules "one short implementation-defined alert sound" (`spec/interaction-events.md:317`)
 * — the runtime models that scheduling purely as the event emission, never as a real audio device,
 * so the event is emitted unconditionally even in a muted environment ("Implementations that cannot
 * play audio, or that run in a muted classroom environment, MUST still emit `sound` events"),
 * keeping replay deterministic. No sound-state change: `beep` carries no parameters. Returns an
 * {@link ExecSignal} to halt on, or `undefined` for {@link executeStatements} to `continue` on
 * success.
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeSoundBeepCall(
  beepCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = beepCall.callee.name;
  if (beepCall.args.length !== 0) {
    return halt(
      runtimeDiag.tooManyInputs(
        beepCall.callee.source_span,
        callableName,
        0,
        beepCall.args.length,
      ),
    );
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "sound",
    source_span: beepCall.source_span,
    payload: { command: "beep" } satisfies SoundPayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `note` (issue #690; `spec/interaction-events.md:274-291`). Same
 * shape/convention as {@link isSoundSetTempoCall} — an ordinary Sound-profile primitive-name match
 * (`note` takes a pitch word and a duration number).
 */
function isSoundNoteCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "note";
}

/**
 * Validate and run a `note <pitch-word> <duration>` statement matched by {@link isSoundNoteCall}:
 * exactly two arguments (`ol-not-enough-inputs`/`ol-too-many-inputs` otherwise). The first MUST be a
 * word (`ol-type`, `expected: "word"`) naming a well-formed scientific-pitch-notation pitch
 * (`ol-type`, `expected: "pitch"`, via `runtimeDiag.invalidPitch` — mirroring `set_shape`'s
 * word-then-recognized two-stage check); the second MUST be a positive finite number
 * (`ol-type` via {@link requireNumber}, then `ol-range` via `runtimeDiag.nonPositiveDuration`).
 *
 * On success it schedules the pitched sound — headlessly, so scheduling *is* reading the current
 * tempo from `environment.sound.tempo` (`set_tempo`'s state; the beat `duration` is interpreted at
 * that tempo) and emitting one `sound` event carrying a {@link NoteSoundPayload}, AFTER the sound
 * has been scheduled (`spec/interaction-events.md`'s trace-stream rule: "Sound commands emit
 * `sound` events after sound state has been scheduled"). The event is emitted unconditionally even
 * in a muted environment ("Implementations that cannot play audio … MUST still emit `sound`
 * events"), so replay never depends on audio availability. Returns an {@link ExecSignal} to halt
 * on, or `undefined` for {@link executeStatements} to `continue` on success (including the "left
 * un-evaluated" case for an unsupported argument expression).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeSoundNoteCall(
  noteCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = noteCall.callee.name;
  if (noteCall.args.length !== 2) {
    return halt(
      noteCall.args.length < 2
        ? runtimeDiag.notEnoughInputs(
            noteCall.callee.source_span,
            callableName,
            2,
            noteCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            noteCall.callee.source_span,
            callableName,
            2,
            noteCall.args.length,
          ),
    );
  }
  const [pitchArg, durationArg] = noteCall.args as [
    ExpressionNode,
    ExpressionNode,
  ];
  // Validate the pitch fully before looking at the duration argument at all: the pitch is the
  // first operand, so its diagnostic must win over anything about the duration. Preflighting both
  // args together would let an unsupported *duration* expression (e.g. `note "bad" forward`)
  // short-circuit to `undefined` and silently swallow the pitch's `ol-type` (rubber-duck, #690).
  if (!isSupportedArgument(pitchArg, environment)) {
    return undefined;
  }
  const pitchResult = evaluate(pitchArg, environment);
  if (!pitchResult.ok) {
    return halt(pitchResult.diagnostic);
  }
  if (typeof pitchResult.value !== "string") {
    return halt(
      runtimeDiag.placeType(pitchArg.source_span, {
        expected: "word",
        actual: typeNameOf(pitchResult.value),
        value: pitchResult.value,
        operation: "note",
      }),
    );
  }
  if (!isValidPitch(pitchResult.value)) {
    return halt(
      runtimeDiag.invalidPitch(pitchArg.source_span, {
        value: pitchResult.value,
        operation: "note",
      }),
    );
  }
  if (!isSupportedArgument(durationArg, environment)) {
    return undefined;
  }
  const durationResult = evaluate(durationArg, environment);
  if (!durationResult.ok) {
    return halt(durationResult.diagnostic);
  }
  const duration = requireNumber(
    durationResult.value,
    durationArg.source_span,
    "note",
  );
  if (!duration.ok) {
    return halt(duration.diagnostic);
  }
  if (!Number.isFinite(duration.value) || duration.value <= 0) {
    return halt(
      runtimeDiag.nonPositiveDuration(durationArg.source_span, {
        operation: "note",
        value: String(duration.value),
      }),
    );
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "sound",
    source_span: noteCall.source_span,
    payload: {
      command: "note",
      pitch: pitchResult.value,
      duration: duration.value,
    } satisfies SoundPayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `rest` (issue #690; `spec/interaction-events.md:326-341`). Same
 * shape/convention as {@link isSoundSetTempoCall} — a single-numeric-argument Sound-profile
 * primitive.
 */
function isSoundRestCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "rest";
}

/**
 * Validate and run a `rest <duration>` statement matched by {@link isSoundRestCall}: exactly one
 * numeric argument (`ol-not-enough-inputs`/`ol-too-many-inputs`/`ol-type` otherwise, via
 * {@link requireNumber}), which MUST be a positive finite number (`ol-range` via
 * `runtimeDiag.nonPositiveDuration` otherwise — folding `Infinity` in like `note`'s duration and
 * `set_tempo`'s tempo). On success it schedules silence for `duration` beats at the current tempo
 * and emits one `sound` event carrying a {@link RestSoundPayload}, "so replay tools can show the
 * silent interval" (`spec/interaction-events.md`), AFTER the silence has been scheduled and
 * unconditionally even in a muted environment. `rest` changes no sound state — silence is modeled
 * purely as the event. Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success (including the "left un-evaluated" case).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeSoundRestCall(
  restCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = restCall.callee.name;
  if (restCall.args.length !== 1) {
    return halt(
      restCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            restCall.callee.source_span,
            callableName,
            1,
            restCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            restCall.callee.source_span,
            callableName,
            1,
            restCall.args.length,
          ),
    );
  }
  const [arg] = restCall.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const duration = requireNumber(argResult.value, arg.source_span, "rest");
  if (!duration.ok) {
    return halt(duration.diagnostic);
  }
  if (!Number.isFinite(duration.value) || duration.value <= 0) {
    return halt(
      runtimeDiag.nonPositiveDuration(arg.source_span, {
        operation: "rest",
        value: String(duration.value),
      }),
    );
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "sound",
    source_span: restCall.source_span,
    payload: {
      command: "rest",
      duration: duration.value,
    } satisfies SoundPayload,
  });
  return undefined;
}

/**
 * Is `statement` a call to `play` (issue #691; `spec/interaction-events.md:293-307`). Same
 * shape/convention as {@link isSoundSetTempoCall} — an ordinary Sound-profile primitive-name match
 * (`play` takes one melody list).
 */
function isSoundPlayCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "play";
}

/**
 * Validate and run a `play <melody-list>` statement matched by {@link isSoundPlayCall}: exactly one
 * argument (`ol-not-enough-inputs`/`ol-too-many-inputs` otherwise) that MUST be a list (`ol-type`,
 * `expected: "list"`). The melody list is pitch/duration pairs in sequence, so "The list length
 * MUST be even" (`spec/interaction-events.md:301-303`) — an odd length raises `ol-range`
 * ({@link runtimeDiag.oddMelodyLength}). Each pair is then resolved in order: the pitch MUST be a
 * word that is either the literal `"rest"` or a well-formed scientific-pitch-notation pitch accepted
 * by `note` (`ol-type`, reusing `note`'s two-stage `expected: "word"`/`expected: "pitch"` checks),
 * and the duration MUST be a positive finite number (`ol-type` via {@link requireNumber}, then
 * `ol-range` via {@link runtimeDiag.nonPositiveDuration}, folding `Infinity` in exactly like `note`).
 * Validation is left-to-right and halts on the first offending element, so the earliest error wins.
 *
 * On success `play` genuinely *sequences* the melody — every step is resolved to a `{ pitch,
 * duration }` {@link MelodyStep} (durations in beats, interpreted at the current tempo by replay
 * tools, never converted here — `spec/interaction-events.md:284-285`) — and emits exactly one
 * `sound` event carrying the whole ordered melody ({@link PlaySoundPayload}), AFTER the melody has
 * been scheduled (`spec/interaction-events.md`'s trace-stream rule: "Sound commands emit `sound`
 * events after sound state has been scheduled"). The event is emitted unconditionally even in a
 * muted environment. `play` changes no sound state — the beat-resolved melody lives entirely in the
 * event, so the headless stream ({@link import("./sound-state.js").SoundState} holds only tempo)
 * stays self-sufficient. Returns an {@link ExecSignal} to halt on, or `undefined` for
 * {@link executeStatements} to `continue` on success (including the "left un-evaluated" case).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link executeTurtleMoveCall}.
 */
function executeSoundPlayCall(
  playCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = playCall.callee.name;
  if (playCall.args.length !== 1) {
    return halt(
      playCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            playCall.callee.source_span,
            callableName,
            1,
            playCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            playCall.callee.source_span,
            callableName,
            1,
            playCall.args.length,
          ),
    );
  }
  const [melodyArg] = playCall.args as [ExpressionNode];
  if (!isSupportedArgument(melodyArg, environment)) {
    return undefined;
  }
  const melodyResult = evaluate(melodyArg, environment);
  if (!melodyResult.ok) {
    return halt(melodyResult.diagnostic);
  }
  if (!Array.isArray(melodyResult.value)) {
    return halt(
      runtimeDiag.placeType(melodyArg.source_span, {
        expected: "list",
        actual: typeNameOf(melodyResult.value),
        value: melodyResult.value,
        operation: "play",
      }),
    );
  }
  const elements = melodyResult.value;
  const melody: MelodyStep[] = [];
  // Validate elements strictly left-to-right so the EARLIEST offending element wins, exactly like
  // `note` validates its pitch before its duration (rubber-duck, #691): an up-front parity check
  // would let an odd-length list mask an earlier bad pitch/duration (e.g. `play ["c4" 0 "e4"]` must
  // report the `0` duration, not the odd length). The odd-length `ol-range` is therefore raised only
  // when the loop reaches a final pitch with no duration partner, after every earlier pair passed.
  for (let index = 0; index < elements.length; index += 2) {
    const pitchValue = elements[index];
    if (typeof pitchValue !== "string") {
      return halt(
        runtimeDiag.placeType(melodyArg.source_span, {
          expected: "word",
          actual: typeNameOf(pitchValue),
          value: pitchValue,
          operation: "play",
        }),
      );
    }
    if (pitchValue !== "rest" && !isValidPitch(pitchValue)) {
      return halt(
        runtimeDiag.invalidPitch(melodyArg.source_span, {
          value: pitchValue,
          operation: "play",
        }),
      );
    }
    if (index + 1 >= elements.length) {
      // A well-formed pitch with no duration partner: the list is odd-length. `spec/
      // interaction-events.md`'s `play` entry: "The list length MUST be even" -> `ol-range`.
      return halt(
        runtimeDiag.oddMelodyLength(melodyArg.source_span, {
          length: elements.length,
        }),
      );
    }
    const durationValue = elements[index + 1];
    const duration = requireNumber(
      durationValue,
      melodyArg.source_span,
      "play",
    );
    if (!duration.ok) {
      return halt(duration.diagnostic);
    }
    if (!Number.isFinite(duration.value) || duration.value <= 0) {
      return halt(
        runtimeDiag.nonPositiveDuration(melodyArg.source_span, {
          operation: "play",
          value: String(duration.value),
        }),
      );
    }
    melody.push({ pitch: pitchValue, duration: duration.value });
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "sound",
    source_span: playCall.source_span,
    payload: {
      command: "play",
      melody,
    } satisfies SoundPayload,
  });
  return undefined;
}

/**
 * Sentinel {@link dispatchSoundCommand} returns when `statement` isn't any recognized Sound-profile
 * command, so {@link executeStatements} can fall through to its other statement-kind checks.
 * Distinct from `undefined`, which means a sound command ran successfully (the same "handled,
 * continue" meaning {@link NOT_A_TURTLE_COMMAND} carries for turtle commands).
 */
const NOT_A_SOUND_COMMAND = Symbol("not-a-sound-command");

/**
 * Single entry point {@link executeStatements} calls to try every Sound-profile command in one
 * step (issue #689 registers `set_tempo`/`beep`; #690/#691 add `note`/`play`/`rest` here). Kept as
 * its own dispatcher — like {@link dispatchTurtleCommand} — so `executeStatements`'s own stack frame
 * stays fixed regardless of how many sound commands exist (the recursion-depth rationale that
 * dispatcher's doc comment records).
 */
function dispatchSoundCommand(
  statement: StatementNode,
  environment: Environment,
): ExecSignal | undefined | typeof NOT_A_SOUND_COMMAND {
  if (isSoundSetTempoCall(statement)) {
    return executeSoundSetTempoCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isSoundBeepCall(statement)) {
    return executeSoundBeepCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isSoundNoteCall(statement)) {
    return executeSoundNoteCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isSoundRestCall(statement)) {
    return executeSoundRestCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isSoundPlayCall(statement)) {
    return executeSoundPlayCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  return NOT_A_SOUND_COMMAND;
}

/**
 * Sentinel `dispatchTurtleCommand` returns when `statement` isn't any recognized turtle command,
 * so {@link executeStatements} can fall through to its other statement-kind checks. Distinct from
 * `undefined`, which `dispatchTurtleCommand` returns when a turtle command ran successfully (the
 * same "handled, continue" meaning every `executeTurtle*Call` helper already uses).
 */
const NOT_A_TURTLE_COMMAND = Symbol("not-a-turtle-command");

/**
 * Validate and run a `wait <n>` statement matched by {@link isWaitCall} (issue #680,
 * `spec/interaction-events.md`, `wait <n>`): exactly one numeric argument
 * (`ol-not-enough-inputs`/`ol-too-many-inputs` on the wrong arity, `ol-type` on a non-number via
 * {@link requireNumber}), which MUST be a non-negative whole number
 * (`ol-type`/`ol-range` otherwise, via {@link validateTickCount}) — then the pause + trailing
 * `primitive` event are produced by {@link runWait}. Returns an {@link ExecSignal} to halt on, or
 * `undefined` for {@link executeStatements} to `continue` on success (including the "left
 * un-evaluated" case for an unsupported argument expression, mirroring the turtle commands).
 *
 * Deliberately a separate, non-inlined function — same stack-frame-size rationale documented on
 * {@link dispatchTurtleCommand}: `executeStatements` recurses once per procedure call, so this
 * argument-gating logic stays out of its body.
 */
function executeWaitCall(
  waitCall: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  const callableName = waitCall.callee.name;
  if (waitCall.args.length !== 1) {
    return halt(
      waitCall.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            waitCall.callee.source_span,
            callableName,
            1,
            waitCall.args.length,
          )
        : runtimeDiag.tooManyInputs(
            waitCall.callee.source_span,
            callableName,
            1,
            waitCall.args.length,
          ),
    );
  }
  const [arg] = waitCall.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const ticks = requireNumber(argResult.value, arg.source_span, "wait");
  if (!ticks.ok) {
    return halt(ticks.diagnostic);
  }
  const count = validateTickCount(ticks.value, arg.source_span);
  if (!count.ok) {
    return halt(count.diagnostic);
  }
  // Dispatch every due handler on each tick the pause advances through, in the normative same-tick
  // order (`when` → `on_key` → `on_click` → due `every`, `spec/interaction-events.md:84-89`) —
  // `dispatchDueHandlers` composes the four buckets and first moves any host-scheduled key/click/
  // named events due at this tick into the pending queues. The callback stashes any halting
  // `ExecSignal` a handler produces (`interaction.ts`'s dispatch is a plain boolean to stay free of
  // the evaluator's control-flow types), returning `true` to abort the remaining ticks; we read the
  // stashed signal back after `runWait` returns and propagate it. This is what makes registered
  // `every`/`on_key`/`on_click` handlers "still fire" while a `wait` pause elapses, only the
  // top-level instructions after the `wait` being deferred (`spec/interaction-events.md:113-118`).
  let dispatchSignal: ExecSignal | undefined;
  const interrupted = runWait(
    environment.tickClock,
    environment.events,
    count.value,
    waitCall.source_span,
    (tick) => {
      const signal = dispatchDueHandlers(
        tick,
        environment,
        waitCall.source_span,
      );
      if (signal.kind !== "normal") {
        dispatchSignal = signal;
        return true;
      }
      return false;
    },
  );
  if (interrupted && dispatchSignal) {
    return dispatchSignal;
  }
  return undefined;
}

/**
 * Is `statement` a `when <event-word> <block>` handler registration (issue #682,
 * `spec/interaction-events.md`'s `### when <event-word> <block>`)? `when` is a profile block-head
 * the reader lowers to a {@link ProfileStatementNode} (C2 #664's `PROFILE_STATEMENT_FORMS`), NOT an
 * ordinary `Call`, so it is matched here by node kind + head keyword rather than by callee name.
 * A plain `boolean` (not a type predicate) to match the surrounding turtle/wait dispatch
 * convention; the caller narrows via a cast at the single call site, exactly as `executeWaitCall`
 * does.
 */
function isWhenStatement(statement: StatementNode): boolean {
  return (
    statement.kind === "ProfileStatement" &&
    statement.keyword.name.toLowerCase() === "when"
  );
}

/**
 * The non-consuming halt gate every handler invocation passes BEFORE emitting its block-head
 * `instruction` event (issue #686, slice I7). Returns an `ol-limit` {@link ExecSignal} to halt with
 * when the run has been cancelled, or when a non-empty handler body's instruction budget is already
 * too near exhaustion to run even one statement — otherwise `undefined` to proceed.
 *
 * Placing it here, at the single entry every `invoke*Handler` shares, guards BOTH handler-delivery
 * paths uniformly: the immediate `when "start"` fire during registration ({@link fireEvent}) and the
 * tick-driven same-tick dispatch ({@link dispatchDueHandlers}). An exhausted budget or a cancelled
 * run must "stop future handler delivery" (`spec/interaction-events.md`'s "Errors and cancellation")
 * on every path — so a handler that would begin only to be immediately halted is not started at all,
 * and the trace never shows a handler that emitted its block-head yet produced no effect (an
 * incoherent partial delivery). {@link pendingExecutionHalt} is non-consuming, so a handler that DOES
 * run still costs only its body's instructions; an **empty**-bodied handler is always delivered (its
 * block-head emitted) at an exhausted budget because it has no statement gate and costs nothing —
 * `bodyHasStatements` gates the budget branch accordingly. Cancellation, by contrast, is re-checked
 * here ungated by `bodyHasStatements`: the Web-Worker `Atomics` deployment ({@link CancellationSignal})
 * can flip `aborted` between this guard and the body's first-statement gate, so without an abort check
 * a handler cancelled at its dispatch boundary — or any empty handler, which never reaches a body
 * gate — would emit an orphan block-head after cancellation (the review-gate finding that reversed an
 * earlier decline).
 */
function guardHandlerDispatch(
  handler: { keyword: { source_span: SourceSpan }; block: BlockNode },
  environment: Environment,
): ExecSignal | undefined {
  const limitDiagnostic = pendingExecutionHalt(
    environment,
    handler.keyword.source_span,
    handler.block.body.length > 0,
  );
  return limitDiagnostic ? halt(limitDiagnostic) : undefined;
}

/**
 * Run one `when` handler's block for a fired event (`spec/interaction-events.md`'s "Trace stream
 * integration"): first emit the `instruction` event for the block-head that caused the handler to
 * run — carrying the `when` keyword's own span, so replay attributes the run to the registration
 * site — then execute the handler body, whose own effects emit the ordinary after-effect events.
 * Marks the handler `fired` so a one-shot event (`"start"`/`"stop"`) never delivers it twice.
 * Returns the body's {@link ExecSignal} so a `halt` (a runtime error or a cancelled budget inside
 * the handler) propagates and stops the whole run, per `spec/interaction-events.md`'s
 * "Errors and cancellation". A `return`/`stop` that escapes the handler body is converted HERE into
 * its `ol-return-outside-proc`/`ol-stop-outside-proc` diagnostic (a handler block is not a procedure
 * body, exactly like the top level), rather than being returned raw: a `when "start"` handler fires
 * synchronously during registration, so a raw `return`/`stop` signal would otherwise be caught by an
 * enclosing procedure call and silently consumed as that procedure's own `return`/`stop`. Converting
 * at the boundary makes the diagnostic independent of whether the `when` was registered inside a
 * procedure.
 */
function invokeWhenHandler(
  handler: WhenHandler,
  environment: Environment,
): ExecSignal {
  const guard = guardHandlerDispatch(handler, environment);
  if (guard) {
    return guard;
  }
  handler.fired = true;
  environment.events.push({
    seq: environment.events.length,
    kind: "instruction",
    source_span: handler.keyword.source_span,
    payload: {
      statement_kind: "ProfileStatement",
    } satisfies InstructionPayload,
  });
  const signal = executeStatements(handler.block.body, handler.environment);
  if (signal.kind === "return") {
    return halt(
      runtimeDiag.returnOutsideProc(signal.source_span, signal.keyword),
    );
  }
  if (signal.kind === "stop") {
    return halt(runtimeDiag.stopOutsideProc(signal.source_span));
  }
  return signal;
}

/**
 * Deliver `event` to every not-yet-fired `when` handler registered for it, in registration order
 * (`spec/interaction-events.md`'s "Time, ticks, and handlers": pending `when` events fire in
 * registration order). Snapshots the pending set first ({@link pendingHandlersFor} returns a fresh
 * array) so a handler that registers another handler for the same event mid-dispatch does not
 * extend the sequence being delivered now — that newly-registered handler follows its own
 * registration path. Firing an event with no registered handler is a well-defined no-op. Stops at
 * the first handler that halts, returning its {@link ExecSignal}; returns {@link NORMAL_SIGNAL} when
 * every handler completed normally.
 */
function fireEvent(event: string, environment: Environment): ExecSignal {
  for (const handler of pendingHandlersFor(environment.eventHandlers, event)) {
    const signal = invokeWhenHandler(handler, environment);
    if (signal.kind !== "normal") {
      return signal;
    }
  }
  return NORMAL_SIGNAL;
}

/**
 * Register a `when <event-word> <block>` handler (issue #682, `spec/interaction-events.md`'s
 * `### when <event-word> <block>`): evaluate the single event argument, require it to be a word
 * (`ol-type` via {@link runtimeDiag.whenEventNotWord} otherwise), record the handler on the
 * environment's registry in registration order, then emit the `primitive` event **after** the
 * handler is registered (spec: "Event registration forms emit `primitive` events after the handler
 * is registered"). Finally, because a batch `execute()` run has already started, a `"start"` handler
 * is already being delivered, so it fires immediately after registration (spec: registering "does
 * not run its block immediately unless the triggering event is already being delivered"); every
 * other event — including `"stop"` — is registered but not delivered in a headless batch run (see
 * {@link STANDARD_EVENT_WORDS}), so its handler does not fire here.
 *
 * `block` is the handler body the reader always attaches to a `when` block-head (`hasBlock: true`,
 * `parser.ts`'s `parseProfileStatement`), recovered here by a cast since a `when` node reaching the
 * runtime always has one (see the inline note on the cast).
 *
 * Returns an {@link ExecSignal} to halt/propagate on (a non-word event, or a signal that escaped an
 * immediately-fired `"start"` handler), or `undefined` for {@link executeStatements} to `continue`
 * on — including the "argument left un-evaluated" case, mirroring {@link executeWaitCall} and the
 * turtle commands.
 */
function executeWhenStatement(
  statement: ProfileStatementNode,
  environment: Environment,
): ExecSignal | undefined {
  const [eventArg] = statement.args as [ExpressionNode];
  if (!isSupportedArgument(eventArg, environment)) {
    return undefined;
  }
  const eventResult = evaluate(eventArg, environment);
  if (!eventResult.ok) {
    return halt(eventResult.diagnostic);
  }
  if (typeof eventResult.value !== "string") {
    return halt(
      runtimeDiag.whenEventNotWord(eventArg.source_span, {
        actual: typeNameOf(eventResult.value),
      }),
    );
  }
  const event = eventResult.value;
  // The reader always attaches a block to a `when` block-head (`hasBlock: true`, and
  // `parseProfileStatement` returns `undefined` — failing the whole parse, which `runProgram` bails
  // on before `execute()` runs — if the body is missing), so `body` is guaranteed present for any
  // `when` node reaching the runtime. The optional `body` on `ProfileStatementNode` exists only
  // because the bodyless `tell` mode-switch shares that node kind; a cast (not a runtime guard)
  // records that invariant without adding an unreachable branch.
  const block = statement.body as BlockNode;
  registerWhenHandler(
    environment.eventHandlers,
    event,
    block,
    statement.keyword,
    environment,
  );
  emitWhenPrimitive(environment.events, statement.source_span);
  if (event === STANDARD_EVENT_WORDS.start) {
    const signal = fireEvent(event, environment);
    if (signal.kind !== "normal") {
      return signal;
    }
  }
  return undefined;
}

/**
 * Sentinel `dispatchProfileStatement` returns when a {@link ProfileStatementNode} is not a Sprites
 * addressing form this slice runs (`tell`/`ask`; `each` lands in #676; the Interaction event heads
 * are their own profile), so {@link executeStatements} can fall through. Distinct from `undefined`
 * ("handled, continue") and an {@link ExecSignal} ("handled, halt"), mirroring
 * {@link NOT_A_TURTLE_COMMAND}.
 */
const NOT_A_PROFILE_STATEMENT = Symbol("not-a-profile-statement");

/**
 * Coerce one turtle value or a list of turtle values into the ids an addressing form should address
 * (`spec/turtles-and-sprites.md:46` "Its input is either one turtle value or a list whose items are
 * turtle values"). `operation` is the head keyword (`"tell"` or `"ask"`) the `ol-type` diagnostic
 * names. Returns the ids on success, or the `ol-type` diagnostic to halt on when the input is a
 * non-turtle, or a list containing a non-turtle value (`spec/turtles-and-sprites.md:176-177`). The
 * whole form fails on the first non-turtle item — the addressed set is left unchanged — so a
 * partially-valid list never half-addresses.
 */
function turtleIdsFor(
  value: OLValue,
  source_span: SourceSpan,
  operation: "tell" | "ask",
): { ok: true; ids: TurtleId[] } | { ok: false; diagnostic: Diagnostic } {
  if (value instanceof OLTurtle) {
    return { ok: true, ids: [value.id] };
  }
  if (Array.isArray(value)) {
    const ids: TurtleId[] = [];
    for (const item of value) {
      if (!(item instanceof OLTurtle)) {
        return {
          ok: false,
          diagnostic: runtimeDiag.tellNotATurtle(source_span, {
            expected: "turtle",
            actual: typeNameOf(item),
            value: item,
            operation,
          }),
        };
      }
      ids.push(item.id);
    }
    return { ok: true, ids };
  }
  return {
    ok: false,
    diagnostic: runtimeDiag.tellNotATurtle(source_span, {
      expected: "turtle",
      actual: typeNameOf(value),
      value,
      operation,
    }),
  };
}

/**
 * Run a `tell <turtle|turtle-list>` statement (Sprites profile,
 * `spec/turtles-and-sprites.md`'s "Addressing model"): `tell` is a command (no block) that
 * **sets the addressed set** for every subsequent turtle command until the next `tell`. Evaluates
 * its single argument, coerces it to turtle ids ({@link turtleIdsFor} — `ol-type` on a non-turtle),
 * replaces {@link TurtleAddressing.ids}, marks addressing explicit so per-turtle events now carry a
 * `turtle-id`, and re-points {@link Environment.turtle} at the first addressed turtle so the
 * movement reporters and `who` report it. An empty turtle list is a valid (if unusual) addressed
 * set — subsequent commands then apply to no turtle — and the current-turtle pointer falls back to
 * the main turtle so `who` and the movement reporters stay consistent.
 * Returns an {@link ExecSignal} to halt on, or `undefined` to continue (including the "argument
 * expression not yet evaluable" deferral every other command uses).
 */
function executeTell(
  statement: ProfileStatementNode,
  environment: Environment,
): ExecSignal | undefined {
  // `tell`'s single-argument arity is enforced at parse/check time (its `PROFILE_STATEMENT_FORMS`
  // entry is `argCount: 1`), so exactly one argument always reaches here.
  const [arg] = statement.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const ids = turtleIdsFor(argResult.value, arg.source_span, "tell");
  if (!ids.ok) {
    return halt(ids.diagnostic);
  }
  // `tell` persistently points the addressed set at `ids` — the same pointing rule `ask` applies for
  // the duration of its block ({@link pointAddressedSet}), so `who` and the state reporters never
  // diverge between the two forms. When the addressed set is empty (`tell [ ]`) the current turtle
  // falls back to the main turtle, matching `who`'s own empty-set fallback.
  pointAddressedSet(environment.addressing, ids.ids, environment);
  return undefined;
}

/**
 * Point the addressed set at `ids` and re-derive the current turtle from its first member (the main
 * turtle when the set is empty), the one rule `tell`/`ask` share so `who` and the state reporters
 * (`xcor`/`ycor`/`heading`/`pos`) never diverge (`spec/turtles-and-sprites.md:44,113`). Marks
 * addressing explicit so per-turtle events now carry a `turtle-id`. `currentId` is the single source
 * of truth; {@link Environment.turtle} is its derived cache, written together here.
 */
function pointAddressedSet(
  addressing: TurtleAddressing,
  ids: TurtleId[],
  environment: Environment,
): void {
  addressing.ids = ids;
  addressing.explicit = true;
  const [firstId = MAIN_TURTLE_ID] = ids;
  addressing.currentId = firstId;
  environment.turtle = turtleStateFor(addressing, firstId);
}

/**
 * Run an `ask <turtle|turtle-list> <block>` statement (Sprites profile,
 * `spec/turtles-and-sprites.md:58`): `ask` is a special form that **temporarily** runs its block for
 * the given turtle(s), then **restores the previous addressed set** after the block finishes — "The
 * previous addressed set is restored after the block finishes." Unlike the persistent `tell`, the
 * scope lasts exactly the block's duration.
 *
 * The save/restore covers every exit path — normal completion **and** an abnormal one (a runtime
 * `halt`, a `stop`, a `return`/`output`/`op` propagating out of the block, or a `throw` surfaced as a
 * `halt`): the block runs inside a `try` whose `finally` restores the snapshot, so a block that
 * errors mid-way never leaks its addressed set to the code that follows (the classic scope leak).
 * Restoration is exactly one level deep, so nested `ask` (and `ask` inside a `tell` scope) each
 * unwind their own level (`spec/turtles-and-sprites.md` "Addressing model").
 *
 * Evaluates its single argument, coerces it to turtle ids ({@link turtleIdsFor} — `ol-type` on a
 * non-turtle, leaving the addressed set unchanged), points the addressed set at them
 * ({@link pointAddressedSet}), runs the block, and restores. Returns the block's {@link ExecSignal}
 * (so a `stop`/`return`/`halt` still propagates to the caller after restoration), or `undefined` to
 * continue, including the "argument not yet evaluable" deferral every other command uses.
 */
function executeAsk(
  statement: ProfileStatementNode,
  environment: Environment,
): ExecSignal | undefined {
  // `ask`'s single-argument arity and mandatory block are enforced at parse/check time (its
  // `PROFILE_STATEMENT_FORMS` entry is `argCount: 1, hasBlock: true`), so exactly one argument and a
  // block always reach here.
  const [arg] = statement.args as [ExpressionNode];
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const argResult = evaluate(arg, environment);
  if (!argResult.ok) {
    return halt(argResult.diagnostic);
  }
  const ids = turtleIdsFor(argResult.value, arg.source_span, "ask");
  if (!ids.ok) {
    return halt(ids.diagnostic);
  }
  const { addressing } = environment;
  // Snapshot the addressed set (ids, current turtle, explicit flag) so the block runs scoped and the
  // previous set is restored afterward, on every exit path (`spec/turtles-and-sprites.md:58,69`).
  const savedIds = addressing.ids;
  const savedCurrentId = addressing.currentId;
  const savedExplicit = addressing.explicit;
  // `hasBlock: true` guarantees the reader attached a block; the cast records that invariant the same
  // way `executeWhenStatement` does.
  const block = statement.body as BlockNode;
  try {
    pointAddressedSet(addressing, ids.ids, environment);
    const signal = executeStatements(block.body, environment);
    // A block that runs to completion returns the `normal` signal; `ask` is a statement, not a
    // reporter, so it must fall through to the next statement — return `undefined` ("handled,
    // continue"). A non-normal signal (`stop`/`return`/`output`/`op`/`halt`) still propagates out so
    // it unwinds the enclosing procedure or program, exactly as it would without the `ask`.
    return signal.kind === "normal" ? undefined : signal;
  } finally {
    // Restore exactly one level: the saved ids, explicit flag, and current turtle (with its derived
    // state cache), so an `ask` at top level before any `tell` leaves addressing implicit again and
    // its events carry no `turtle-id`, and a nested `ask`/`tell` scope unwinds to precisely the set
    // that was active before this `ask`.
    addressing.ids = savedIds;
    addressing.explicit = savedExplicit;
    addressing.currentId = savedCurrentId;
    environment.turtle = turtleStateFor(addressing, savedCurrentId);
  }
}

/**
 * Is `statement` an `every <n> <block>` handler registration (issue #683, slice I4,
 * `spec/interaction-events.md`'s `### every <n> <block>`)? Like `when`, `every` is a profile
 * block-head the reader lowers to a {@link ProfileStatementNode} (C2 #664's
 * `PROFILE_STATEMENT_FORMS`), NOT an ordinary `Call`, so it is matched here by node kind + head
 * keyword rather than by callee name. A plain `boolean` (not a type predicate) to match the
 * surrounding turtle/wait/`when` dispatch convention; the caller narrows via a cast at the single
 * call site, exactly as {@link isWhenStatement} does.
 */
function isEveryStatement(statement: StatementNode): boolean {
  return (
    statement.kind === "ProfileStatement" &&
    statement.keyword.name.toLowerCase() === "every"
  );
}

/**
 * Run one `every` handler's block for a due tick (`spec/interaction-events.md`'s "Trace stream
 * integration"): emit the `instruction` event for the block-head that caused the handler to run —
 * carrying the `every` keyword's own span, so replay attributes each repeated run to the
 * registration site — then execute the handler body, whose own effects emit the ordinary
 * after-effect events. Unlike {@link invokeWhenHandler}'s one-shot `fired`, an `every` handler is
 * marked `running` for the duration of its body and cleared afterwards, so a re-entrant `wait`
 * inside the body cannot deliver a second overlapping invocation of the same handler
 * ({@link claimDueEveryHandlers} consumes but does not re-enter a `running` handler) — the spec's "at most
 * one pending invocation" guarantee, here read conservatively as zero overlap so a body whose own
 * `wait` re-arms the interval can never drive a non-terminating drain. Returns the body's
 * {@link ExecSignal} so a `halt` propagates and stops the whole run ("Errors and cancellation"); a
 * `return`/`stop` that escapes the body is converted HERE into its
 * `ol-return-outside-proc`/`ol-stop-outside-proc` diagnostic (a handler block is not a procedure
 * body, exactly like the top level and {@link invokeWhenHandler}).
 */
function invokeEveryHandler(
  handler: EveryHandler,
  environment: Environment,
): ExecSignal {
  const guard = guardHandlerDispatch(handler, environment);
  if (guard) {
    return guard;
  }
  handler.pending = false;
  handler.running = true;
  environment.events.push({
    seq: environment.events.length,
    kind: "instruction",
    source_span: handler.keyword.source_span,
    payload: {
      statement_kind: "ProfileStatement",
    } satisfies InstructionPayload,
  });
  const signal = executeStatements(handler.block.body, handler.environment);
  handler.running = false;
  if (signal.kind === "return") {
    return halt(
      runtimeDiag.returnOutsideProc(signal.source_span, signal.keyword),
    );
  }
  if (signal.kind === "stop") {
    return halt(runtimeDiag.stopOutsideProc(signal.source_span));
  }
  return signal;
}

/**
 * Run one `on_key` handler's block for a delivered key press (issue #686, slice I7,
 * `spec/interaction-events.md`'s "Trace stream integration"): emit the `instruction` event for the
 * block-head that caused the handler to run — carrying the `on_key` keyword's own span, so replay
 * attributes each run to the registration site — then execute the handler body, whose own effects
 * emit the ordinary after-effect events. `on_key` has no delivery-state flag (a key can be pressed
 * any number of times), so unlike {@link invokeWhenHandler}/{@link invokeEveryHandler} it neither
 * sets nor clears one. Returns the body's {@link ExecSignal} so a `halt` (a runtime error or a
 * cancelled budget inside the handler) propagates and stops the whole run ("Errors and
 * cancellation"); a `return`/`stop` that escapes the body is converted HERE into its
 * `ol-return-outside-proc`/`ol-stop-outside-proc` diagnostic (a handler block is not a procedure
 * body, exactly like the top level and {@link invokeWhenHandler}).
 */
function invokeOnKeyHandler(
  handler: OnKeyHandler,
  environment: Environment,
): ExecSignal {
  const guard = guardHandlerDispatch(handler, environment);
  if (guard) {
    return guard;
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "instruction",
    source_span: handler.keyword.source_span,
    payload: {
      statement_kind: "ProfileStatement",
    } satisfies InstructionPayload,
  });
  const signal = executeStatements(handler.block.body, handler.environment);
  if (signal.kind === "return") {
    return halt(
      runtimeDiag.returnOutsideProc(signal.source_span, signal.keyword),
    );
  }
  if (signal.kind === "stop") {
    return halt(runtimeDiag.stopOutsideProc(signal.source_span));
  }
  return signal;
}

/**
 * Run one `on_click` handler's block for a delivered click (issue #686, slice I7,
 * `spec/interaction-events.md`'s "Trace stream integration"): emit the `instruction` event for the
 * block-head that caused the handler to run — carrying the `on_click` keyword's own span — then
 * execute the handler body. Like {@link invokeOnKeyHandler} it carries no delivery-state flag (the
 * surface can be clicked any number of times). Returns the body's {@link ExecSignal} so a `halt`
 * propagates; a `return`/`stop` that escapes the body is converted HERE into its
 * `ol-return-outside-proc`/`ol-stop-outside-proc` diagnostic, exactly like the other handler kinds.
 */
function invokeOnClickHandler(
  handler: OnClickHandler,
  environment: Environment,
): ExecSignal {
  const guard = guardHandlerDispatch(handler, environment);
  if (guard) {
    return guard;
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "instruction",
    source_span: handler.keyword.source_span,
    payload: {
      statement_kind: "ProfileStatement",
    } satisfies InstructionPayload,
  });
  const signal = executeStatements(handler.block.body, handler.environment);
  if (signal.kind === "return") {
    return halt(
      runtimeDiag.returnOutsideProc(signal.source_span, signal.keyword),
    );
  }
  if (signal.kind === "stop") {
    return halt(runtimeDiag.stopOutsideProc(signal.source_span));
  }
  return signal;
}

/**
 * The unified same-tick handler dispatch (issue #686, slice I7) — the single callback
 * {@link executeWaitCall} hands to {@link runWait}, invoked at every {@link yieldToEventLoop}
 * checkpoint the tick clock reaches (once per elapsed tick, and once for a `wait 0` yield). It
 * imposes the **normative same-tick delivery order** `spec/interaction-events.md` fixes in §Time,
 * ticks, and handlers (l.84-89), delivering in exactly this sequence, each in registration order:
 *
 *   1. pending `when` events        ({@link claimPendingEventHandlers} → {@link invokeWhenHandler})
 *   2. pending `on_key` events      ({@link claimPendingKeyHandlers}   → {@link invokeOnKeyHandler})
 *   3. pending `on_click` events    ({@link claimPendingClickHandlers} → {@link invokeOnClickHandler})
 *   4. due `every` events           ({@link claimDueEveryHandlers}     → {@link invokeEveryHandler})
 *
 * "Registration order" here means the order the **handlers** were registered, primary over the order
 * the host happened to deliver input in: each `claim*` visits its registered handler list in order,
 * so a run is deterministic in the program's own registration order (`spec/interaction-events.md`
 * l.84-89 names no delivery-order concept). The whole tick's ordered invocation batch is built by
 * claiming **all four buckets up front** — each `claim*` empties its pending queue (and
 * `claimDueEveryHandlers` marks its handlers `pending`/advances `nextDueTick`) at claim time — and
 * only then are the bodies run. That up-front claim is what makes a nested `wait` inside a handler
 * body re-entrancy-safe: a same-tick re-entry finds every queue already drained, so it cannot steal
 * a later-in-order invocation (e.g. a pending click) and run it before this tick's earlier handlers
 * finish; newly scheduled input only becomes pending at a strictly later tick.
 *
 * The order is imposed **purely here, at the drain point** — the four registration lists (I3/I5/I6)
 * and the pending host-input queues (this slice) are kept separate precisely so this composition is
 * the only place ordering lives; no registration code participates. Before draining, host-supplied
 * key/click/named events scheduled at or before `tick` are moved into the pending queues
 * ({@link enqueueHostInput}, reading `environment.hostInput` and threading
 * `environment.hostInputConsumed` forward). In a normal headless run `hostInput` is empty, so the
 * pending queues stay empty and only step 4 (`every`, the sole tick-driven kind) can fire — exactly
 * the I5/I6 "registered but not delivered" behavior, reached because nothing was pending.
 *
 * The run stops at the first handler that halts (a runtime error, a `return`/`stop` escaping a
 * handler, or a cancelled/over-budget execution), returning that {@link ExecSignal} without running
 * any later invocation — so once cancellation is observed no further handler of any kind fires,
 * satisfying `spec/interaction-events.md`'s "Errors and cancellation". Returns {@link NORMAL_SIGNAL}
 * when every delivered handler completed normally.
 */
function dispatchDueHandlers(
  tick: number,
  environment: Environment,
  source_span: SourceSpan,
): ExecSignal {
  // Poll cancellation once per tick BEFORE enqueuing host input or claiming any bucket, so a
  // cross-thread abort (the Web-Worker `Atomics` deployment in `CancellationSignal`) is observed
  // even on a tick with no due handler — otherwise a long `wait` with nothing pending would keep
  // advancing its remaining ticks after cancellation, unresponsive until it finishes and the next
  // top-level statement's `checkExecutionLimits` finally sees the abort. Returning a halt here makes
  // `runWait` abort its remaining ticks immediately (`spec/interaction-events.md`'s
  // "Errors and cancellation": a cancelled run stops cleanly, with no further delivery). The
  // per-handler `guardHandlerDispatch` still covers the abort-between-guard-and-body-gate orphan on
  // ticks that DO have handlers; this covers the tick that has none. The `wait` call's own span is
  // threaded in so the diagnostic points at the paused instruction.
  if (environment.signal?.aborted) {
    return halt(runtimeDiag.cancelled(source_span));
  }
  environment.hostInputConsumed.count = enqueueHostInput(
    environment.eventHandlers,
    environment.hostInput,
    tick,
    environment.hostInputConsumed.count,
  );
  // Claim ALL four buckets into one ordered invocation list BEFORE running any body. Each `claim*`
  // empties its pending queue (and `claimDueEveryHandlers` marks its handlers `pending`/advances
  // `nextDueTick`) at claim time, so the whole tick's ordered batch is fixed up front. This is what
  // makes a nested `wait` inside a handler body re-entrancy-safe: when that nested `wait` re-enters
  // this dispatcher at the SAME tick, every queue for this tick is already drained, so it cannot
  // steal a later-in-order invocation (e.g. a pending click) and run it before this tick's earlier
  // handlers finish. Newly scheduled input only becomes pending at a strictly later tick.
  const registry = environment.eventHandlers;
  const invocations: Array<() => ExecSignal> = [];
  for (const handler of claimPendingEventHandlers(registry)) {
    invocations.push(() => invokeWhenHandler(handler, environment));
  }
  for (const handler of claimPendingKeyHandlers(registry)) {
    invocations.push(() => invokeOnKeyHandler(handler, environment));
  }
  for (const handler of claimPendingClickHandlers(registry)) {
    invocations.push(() => invokeOnClickHandler(handler, environment));
  }
  for (const handler of claimDueEveryHandlers(registry, tick)) {
    invocations.push(() => invokeEveryHandler(handler, environment));
  }
  // Each invocation's own `guardHandlerDispatch` (in `invoke*Handler`) checks cancellation/budget
  // BEFORE emitting its block-head event, so once the run has halted no further handler is delivered
  // and none leaves an orphan handler-start in the trace — cancellation "stops future handler
  // delivery" (`spec/interaction-events.md`'s "Errors and cancellation"). The dispatcher just stops
  // at the first non-normal signal.
  for (const invoke of invocations) {
    const signal = invoke();
    if (signal.kind !== "normal") {
      return signal;
    }
  }
  return NORMAL_SIGNAL;
}

/**
 * Register an `every <n> <block>` handler (issue #683, slice I4, `spec/interaction-events.md`'s
 * `### every <n> <block>`): evaluate the single tick-count argument, require it to be a positive
 * whole number (`ol-type` via {@link requireWholeNumber} for a non-whole/non-number count, then
 * `ol-range` via {@link runtimeDiag.everyNonPositive} for zero or negative), record the handler on
 * the environment's registry in registration order, then emit the `primitive` event **after** the
 * handler is registered ("Event registration forms emit `primitive` events after the handler is
 * registered"). Registration never fires the block: unlike `when "start"`, no `every` interval has
 * elapsed at registration time, so an `every` handler first runs only after `n` ticks pass — which
 * in a headless batch run happens only while a `wait` pause advances the clock
 * ({@link dispatchDueHandlers}).
 *
 * `block` is the handler body the reader always attaches to an `every` block-head (`hasBlock: true`,
 * `parser.ts`'s `PROFILE_STATEMENT_FORMS`), recovered here by a cast since an `every` node reaching
 * the runtime always has one (see the inline note, mirroring {@link executeWhenStatement}).
 *
 * Returns an {@link ExecSignal} to halt on (a non-whole or non-positive count), or `undefined` for
 * {@link executeStatements} to `continue` on — including the "argument left un-evaluated" case,
 * mirroring {@link executeWhenStatement}/{@link executeWaitCall} and the turtle commands.
 */
function executeEveryStatement(
  statement: ProfileStatementNode,
  environment: Environment,
): ExecSignal | undefined {
  const [countArg] = statement.args as [ExpressionNode];
  if (!isSupportedArgument(countArg, environment)) {
    return undefined;
  }
  const countResult = evaluate(countArg, environment);
  if (!countResult.ok) {
    return halt(countResult.diagnostic);
  }
  const whole = requireWholeNumber(
    countResult.value,
    countArg.source_span,
    "every",
  );
  if (!whole.ok) {
    return halt(whole.diagnostic);
  }
  if (whole.value <= 0) {
    return halt(
      runtimeDiag.everyNonPositive(countArg.source_span, {
        value: whole.value,
      }),
    );
  }
  // The reader always attaches a block to an `every` block-head (`hasBlock: true`, and
  // `parseProfileStatement` fails the whole parse — which `runProgram` bails on before `execute()`
  // runs — if the body is missing), so `body` is guaranteed present for any `every` node reaching
  // the runtime. The optional `body` on `ProfileStatementNode` exists only because the bodyless
  // `tell` mode-switch shares that node kind; a cast (not a runtime guard) records that invariant.
  const block = statement.body as BlockNode;
  registerEveryHandler(
    environment.eventHandlers,
    whole.value,
    block,
    statement.keyword,
    environment,
    environment.tickClock.tick,
  );
  emitEveryPrimitive(environment.events, statement.source_span);
  return undefined;
}

/**
 * The distinct turtle ids of `ids`, in first-occurrence order — the addressed set read as a genuine
 * **set** (`spec/turtles-and-sprites.md:44` "the addressed **set**"; turtle `==` is keyed on the
 * stable `id`, `spec/execution-model.md:540`). `each` runs its block "once per turtle in the current
 * `tell` or `ask` set" (`spec/turtles-and-sprites.md:71`), so a set that reached `each` with a turtle
 * listed twice (`tell (list :a :a)`, or a list literal built with a repeat) must still run the block
 * **once** for that turtle. Deduplicating here — at the point per-turtle iteration is observable
 * (issue #713) — keeps the decision local to the slice that makes it visible: `tell`/`ask` retain
 * their stored `ids` unchanged, and only `each`'s iteration is set-shaped. First-occurrence order
 * keeps iteration deterministic (the addressed set is insertion-ordered from `tell`/`ask`).
 */
function distinctTurtleIds(ids: readonly TurtleId[]): TurtleId[] {
  const seen = new Set<TurtleId>();
  const result: TurtleId[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * Run an `each <block>` statement (Sprites profile, `spec/turtles-and-sprites.md:71`): `each` runs
 * its block **once per turtle in the current `tell` or `ask` set** — "During each run, `who` reports
 * the turtle for that iteration, and Turtle commands affect only that turtle unless the program
 * changes the addressed set again."
 *
 * Each iteration narrows the addressed set to the single turtle whose turn it is
 * ({@link pointAddressedSet} with `[id]`), so inside the block `who` reports that turtle
 * ({@link TurtleAddressing.currentId}) and a per-turtle command runs once for — and stamps its events
 * with — that turtle only. Iteration order is the addressed set's insertion order, deduplicated by
 * stable id ({@link distinctTurtleIds}), so the same program always produces the same event sequence
 * and a turtle listed twice still runs the block once (issue #713).
 *
 * Like `ask`, the previous addressed set is snapshotted and restored on **every** exit path — normal
 * completion and an abnormal one (a runtime `halt`, a `stop`, a `return`/`output`/`op`, or a `throw`
 * surfaced as a `halt`) — via a `try`/`finally`, so a block that unwinds mid-iteration never leaks an
 * addressed set or a current-turtle pointer to the code that follows. A non-normal signal from any
 * iteration stops the loop immediately and propagates out (so a `stop`/`return` inside `each` unwinds
 * the enclosing procedure, exactly as it would without the `each`). An empty addressed set runs the
 * block zero times. `each` composes with `ask`/`tell`: it iterates whatever set is current when it
 * runs (the `ask` scope inside an `ask`, the `tell` set otherwise), and the enclosing addressing is
 * restored after it, unchanged.
 */
function executeEach(
  statement: ProfileStatementNode,
  environment: Environment,
): ExecSignal | undefined {
  // `each`'s zero-argument arity and mandatory block are enforced at parse/check time (its
  // `PROFILE_STATEMENT_FORMS` entry is `argCount: 0, hasBlock: true`), so a block always reaches here
  // with no arguments to evaluate.
  const { addressing } = environment;
  // Snapshot the addressed set so it is restored after the loop on every exit path (mirroring `ask`).
  const savedIds = addressing.ids;
  const savedCurrentId = addressing.currentId;
  const savedExplicit = addressing.explicit;
  // Snapshot the ids to iterate before the loop begins, so a block that changes the world mid-loop
  // (e.g. a nested `tell` in an early iteration) cannot change which turtles `each` visits.
  const iterationIds = distinctTurtleIds(addressing.ids);
  // `hasBlock: true` guarantees the reader attached a block; the cast records that invariant the same
  // way `executeAsk`/`executeWhenStatement` do.
  const block = statement.body as BlockNode;
  try {
    for (const id of iterationIds) {
      // Narrow the addressed set to this one turtle so the block runs scoped to it: `who` reports it
      // and its per-turtle commands run once, stamped with its id. `explicit` is forced true so the
      // events carry a `turtle_id` even when `each` runs at top level with only the implicit default
      // turtle addressed (a single-turtle `each` still attributes its events).
      pointAddressedSet(addressing, [id], environment);
      const signal = executeStatements(block.body, environment);
      // A non-normal signal (`stop`/`return`/`output`/`op`/`halt`) stops the loop and propagates out,
      // so a diagnostic or early exit in one iteration is never masked by a later one.
      if (signal.kind !== "normal") {
        return signal;
      }
    }
    // Every iteration completed normally: `each` is a statement, so fall through to the next one.
    return undefined;
  } finally {
    // Restore exactly one level: the addressed set active before `each`, its explicit flag, and the
    // current turtle (with its derived state cache), so `each` composes with the enclosing `tell`/
    // `ask` scope and leaves it exactly as it found it.
    addressing.ids = savedIds;
    addressing.explicit = savedExplicit;
    addressing.currentId = savedCurrentId;
    environment.turtle = turtleStateFor(addressing, savedCurrentId);
  }
}

/**
 * Is `statement` an `on_key <key-word> <block>` handler registration (issue #684, slice I5,
 * `spec/interaction-events.md`'s `### on_key <key-word> <block>`)? `on_key` is a profile block-head
 * the reader lowers to a {@link ProfileStatementNode} (C2 #664's `PROFILE_STATEMENT_FORMS`), NOT an
 * ordinary `Call`, so it is matched here by node kind + head keyword rather than by callee name. A
 * plain `boolean` (not a type predicate) to match the surrounding turtle/wait/`when`/`every`
 * dispatch convention; the caller narrows via a cast at the single call site, exactly as
 * {@link isWhenStatement} does.
 */
function isOnKeyStatement(statement: StatementNode): boolean {
  return (
    statement.kind === "ProfileStatement" &&
    statement.keyword.name.toLowerCase() === "on_key"
  );
}

/**
 * Register an `on_key <key-word> <block>` handler (issue #684, slice I5,
 * `spec/interaction-events.md`'s `### on_key <key-word> <block>`): evaluate the single key argument,
 * require it to be a word (`ol-type` via {@link runtimeDiag.onKeyKeyNotWord} otherwise, exactly as
 * `when` validates its event word), record the handler on the environment's registry in registration
 * order, then emit the `primitive` event **after** the handler is registered (spec: "Event
 * registration forms emit `primitive` events after the handler is registered").
 *
 * Registration never fires the block: a key press is host input, and in a headless batch `execute()`
 * run there is no keyboard, so an `on_key` handler is registered but never delivered — exactly like a
 * `when "stop"` handler in a headless run. Synthesizing a key press is a host concern outside this
 * slice; the `on-key-registered-not-delivered` fixture locks that narrowing so it is falsifiable
 * rather than silently omitted.
 *
 * `block` is the handler body the reader always attaches to an `on_key` block-head (`hasBlock: true`,
 * `parser.ts`'s `PROFILE_STATEMENT_FORMS`), recovered here by a cast since an `on_key` node reaching
 * the runtime always has one (see the inline note, mirroring {@link executeWhenStatement}).
 *
 * Returns an {@link ExecSignal} to halt on (a non-word key), or `undefined` for
 * {@link executeStatements} to `continue` on — including the "argument left un-evaluated" case,
 * mirroring {@link executeWhenStatement}/{@link executeEveryStatement} and the turtle commands.
 */
function executeOnKeyStatement(
  statement: ProfileStatementNode,
  environment: Environment,
): ExecSignal | undefined {
  const [keyArg] = statement.args as [ExpressionNode];
  if (!isSupportedArgument(keyArg, environment)) {
    return undefined;
  }
  const keyResult = evaluate(keyArg, environment);
  if (!keyResult.ok) {
    return halt(keyResult.diagnostic);
  }
  if (typeof keyResult.value !== "string") {
    return halt(
      runtimeDiag.onKeyKeyNotWord(keyArg.source_span, {
        actual: typeNameOf(keyResult.value),
      }),
    );
  }
  const key = keyResult.value;
  // The reader always attaches a block to an `on_key` block-head (`hasBlock: true`, and
  // `parseProfileStatement` fails the whole parse — which `runProgram` bails on before `execute()`
  // runs — if the body is missing), so `body` is guaranteed present for any `on_key` node reaching
  // the runtime. The optional `body` on `ProfileStatementNode` exists only because the bodyless
  // `tell` mode-switch shares that node kind; a cast (not a runtime guard) records that invariant.
  const block = statement.body as BlockNode;
  registerOnKeyHandler(
    environment.eventHandlers,
    key,
    block,
    statement.keyword,
    environment,
  );
  emitOnKeyPrimitive(environment.events, statement.source_span);
  return undefined;
}

/**
 * Is `statement` an `on_click <block>` handler registration (issue #685, slice I6,
 * `spec/interaction-events.md`'s `### on_click <block>`)? `on_click` is a profile block-head the
 * reader lowers to a {@link ProfileStatementNode} (C2 #664's `PROFILE_STATEMENT_FORMS`), NOT an
 * ordinary `Call`, so it is matched here by node kind + head keyword rather than by callee name. A
 * plain `boolean` (not a type predicate) to match the surrounding turtle/wait/`when`/`every`/`on_key`
 * dispatch convention; the caller narrows via a cast at the single call site, exactly as
 * {@link isOnKeyStatement} does.
 */
function isOnClickStatement(statement: StatementNode): boolean {
  return (
    statement.kind === "ProfileStatement" &&
    statement.keyword.name.toLowerCase() === "on_click"
  );
}

/**
 * Register an `on_click <block>` handler (issue #685, slice I6,
 * `spec/interaction-events.md`'s `### on_click <block>`): record the handler on the environment's
 * registry in registration order, then emit the `primitive` event **after** the handler is registered
 * (spec: "Event registration forms emit `primitive` events after the handler is registered").
 *
 * `on_click` takes **no argument** — it is the only Interaction & Events block-head that takes just a
 * block (`spec/interaction-events.md` §Profile grammar: "`on_click` takes none") — so there is no
 * argument to evaluate or type-check, and the spec lists its errors as **none**. Registration never
 * fires the block: a click is host input, and in a headless batch `execute()` run there is no pointer
 * device, so an `on_click` handler is registered but never delivered — exactly like a `when "stop"`
 * (I3) or an `on_key` (I5) handler in a headless run. Synthesizing a click is a host concern outside
 * this slice; the `on-click-registered-not-delivered` fixture locks that narrowing so it is
 * falsifiable rather than silently omitted.
 *
 * `block` is the handler body the reader always attaches to an `on_click` block-head (`hasBlock: true`,
 * `parser.ts`'s `PROFILE_STATEMENT_FORMS`), recovered here by a cast since an `on_click` node reaching
 * the runtime always has one (see the inline note, mirroring {@link executeOnKeyStatement}).
 *
 * Returns `void`, not an {@link ExecSignal}: unlike its argument-taking siblings
 * ({@link executeOnKeyStatement} can fail its word-type check), `on_click` takes no argument and the
 * spec lists its errors as **none** — registration cannot fail — so there is never a signal to halt
 * on and the caller simply `continue`s. A bad `on_click` (a stray argument) is caught earlier, at
 * parse time, before `execute()` runs.
 */
function executeOnClickStatement(
  statement: ProfileStatementNode,
  environment: Environment,
): void {
  // The reader always attaches a block to an `on_click` block-head (`hasBlock: true`, and
  // `parseProfileStatement` fails the whole parse — which `runProgram` bails on before `execute()`
  // runs — if the body is missing), so `body` is guaranteed present for any `on_click` node reaching
  // the runtime. The optional `body` on `ProfileStatementNode` exists only because the bodyless
  // `tell` mode-switch shares that node kind; a cast (not a runtime guard) records that invariant.
  const block = statement.body as BlockNode;
  registerOnClickHandler(
    environment.eventHandlers,
    block,
    statement.keyword,
    environment,
  );
  emitOnClickPrimitive(environment.events, statement.source_span);
}

/**
 * Try to run `statement` as a Sprites addressing statement — `tell` (SP2, issue #674) sets the
 * addressed set persistently, `ask` (SP3, issue #675) runs its block for a scoped set and then
 * restores the previous one, and `each` (SP4, issue #676) runs its block once per turtle in the
 * current set; the Interaction & Events heads register their own handling upstream. Returns
 * {@link NOT_A_PROFILE_STATEMENT} when `statement` is not an addressing statement this dispatcher
 * runs — either because it is not a `ProfileStatement` at all, or because it is one whose keyword no
 * addressing form matches (a defensive guard against a head being registered in the parser's
 * `PROFILE_STATEMENT_FORMS` without a runtime handler) — so {@link executeStatements} falls through to
 * its remaining checks. Both cases share the single final `return`, so the guard stays covered by the
 * ordinary non-`ProfileStatement` path even once every registered head is handled elsewhere (#732).
 */
function dispatchProfileStatement(
  statement: StatementNode,
  environment: Environment,
): ExecSignal | undefined | typeof NOT_A_PROFILE_STATEMENT {
  if (statement.kind === "ProfileStatement") {
    const keyword = statement.keyword.name.toLowerCase();
    if (keyword === "tell") {
      return executeTell(statement, environment);
    }
    if (keyword === "ask") {
      return executeAsk(statement, environment);
    }
    if (keyword === "each") {
      return executeEach(statement, environment);
    }
  }
  return NOT_A_PROFILE_STATEMENT;
}

/**
 * Whether `statement` is a **per-turtle** turtle command — one whose effect and events belong to a
 * specific turtle, so under `tell` it runs once for each addressed turtle
 * (`spec/turtles-and-sprites.md:113`): movement (`forward`/`back`), turning (`left`/`right`), pen
 * (`pen_up`/`pen_down`), absolute position (`home`/`set_xy`), heading (`set_heading`), visibility
 * (`show_turtle`/`hide_turtle`), color (`set_color`), width (`set_width`), `fill`, `stamp`, and
 * `set_shape`.
 *
 * The canvas-global turtle commands are deliberately excluded: `set_background`, `grid`, `axes`, and
 * `measure` describe the drawing surface, not one turtle's avatar, so they run once regardless of
 * how many turtles are addressed. `clear_screen`/`clean` is also excluded — it clears the whole
 * canvas (one `clear` event) and homes only the current turtle; a per-turtle multiplication would
 * emit N `clear` events for one canvas clear, which no renderer expects. Under explicit addressing
 * that single event is stamped with the homed turtle's `turtle_id` (see {@link clearScreen}), so it
 * stays one event yet still names which turtle was homed (`clearScreen`'s doc comment).
 */
function isPerTurtleCommand(statement: StatementNode): boolean {
  return (
    isTurtleMoveCall(statement) ||
    isTurtleTurnCall(statement) ||
    isTurtlePenCall(statement) ||
    isTurtlePositionCall(statement) ||
    isTurtleHeadingCall(statement) ||
    isTurtleVisibilityCall(statement) ||
    isTurtleColorCall(statement) ||
    isTurtleWidthCall(statement) ||
    isTurtleFillCall(statement) ||
    isTurtleStampCall(statement) ||
    isTurtleShapeCall(statement)
  );
}

/**
 * Run one per-turtle command once for **every** addressed turtle
 * (`spec/turtles-and-sprites.md:113` "When multiple turtles are addressed by `tell`, a turtle
 * command applies once for each addressed turtle"), pointing {@link Environment.turtle} at each
 * addressed turtle's own stored state ({@link Environment.addressing}) in turn so the existing
 * single-turtle executors ({@link dispatchTurtleCommandOnce}) mutate the right per-turtle state
 * unchanged. After each turtle's run, the events that turtle produced are stamped with its
 * `turtle-id` — but only once `tell` has made the addressed set explicit
 * ({@link TurtleAddressing.explicit}); before any `tell` the implicit default main turtle's events
 * carry no `turtle-id`, exactly as every Core/Turtle & Rendering fixture expects. A halting outcome
 * from any addressed turtle stops the loop immediately, so a diagnostic on one turtle is not masked
 * by a later turtle's success.
 *
 * Each iteration points the current turtle ({@link TurtleAddressing.currentId} and its derived
 * {@link Environment.turtle} cache) at the turtle whose turn it is, so a `who` evaluated *inside* the
 * command's argument (e.g. `forward some_proc` where `some_proc` reads `who`) reports the turtle
 * actually running the command, not the first addressed one (`spec/turtles-and-sprites.md:26`).
 *
 * This per-iteration re-pointing is transient — it must not outlive the statement, because merely
 * iterating the addressed set does not change it. After the loop the current turtle is re-derived
 * from the addressed set's first turtle ({@link TurtleAddressing.ids}, the main turtle when it is
 * empty). That one rule handles both cases correctly: with no nested `tell`, `ids` is still the
 * original set, so the current turtle returns to its first member; a `tell` run inside the argument
 * evaluation legitimately replaced `ids` with its own set, so re-deriving from `ids[0]` honors that
 * nested `tell` — even when it ran in an early iteration and a later iteration re-pointed
 * `currentId` transiently in between.
 */
function runPerTurtleCommand(
  statement: StatementNode,
  environment: Environment,
): ExecSignal | undefined {
  const { addressing } = environment;
  // Snapshot the addressed ids so a command that mutates the world mid-loop (e.g. a nested `tell`
  // during argument evaluation) cannot change which turtles this one statement applies to.
  const addressedIds = [...addressing.ids];
  let outcome: ExecSignal | undefined;
  for (const id of addressedIds) {
    addressing.currentId = id;
    environment.turtle = turtleStateFor(addressing, id);
    const firstEventIndex = environment.events.length;
    outcome = dispatchTurtleCommandOnce(statement, environment) as
      ExecSignal | undefined;
    if (addressing.explicit) {
      stampTurtleId(environment, firstEventIndex, id);
    }
    if (outcome) {
      break;
    }
  }
  // Re-derive the current turtle from the addressed set's first member: the per-iteration
  // re-pointing above is transient, and `addressing.ids` now holds whatever set is in effect — the
  // original one when no nested `tell` ran, or the nested `tell`'s set when one did. Either way its
  // first turtle (the main turtle when empty) is the current turtle, keeping `who` and the state
  // reporters in agreement.
  const [firstId = MAIN_TURTLE_ID] = addressing.ids;
  addressing.currentId = firstId;
  environment.turtle = turtleStateFor(addressing, firstId);
  return outcome;
}

/**
 * Stamp `turtle_id` onto the turtle-specific events emitted at or after `firstEventIndex` — the
 * events one addressed turtle's command run just produced (`spec/turtles-and-sprites.md:113`:
 * turtle-specific events "MUST" carry the acting turtle's identity). Only events that do **not**
 * already carry a `turtle_id` are stamped: an event that arrives with its own authoritative id — a
 * `spawn-turtle` emitted by a `new_turtle` evaluated in the command's argument position, or an event
 * a nested per-turtle command already stamped — keeps that id, so the acting turtle's id is never
 * written over another turtle's. The payload is untouched.
 */
function stampTurtleId(
  environment: Environment,
  firstEventIndex: number,
  id: TurtleId,
): void {
  const produced = environment.events.slice(firstEventIndex);
  const stamped = produced.map((event) =>
    event.turtle_id === undefined ? { ...event, turtle_id: id } : event,
  );
  environment.events.splice(firstEventIndex, produced.length, ...stamped);
}

/**
 * Single entry point {@link executeStatements} calls to try every turtle command in one step.
 * A per-turtle command ({@link isPerTurtleCommand}) runs once for each addressed turtle via
 * {@link runPerTurtleCommand}; a canvas-global turtle command (`set_background`/`grid`/`axes`/
 * `measure`/`clear_screen`) runs exactly once via {@link dispatchTurtleCommandOnce}. Returns the
 * {@link NOT_A_TURTLE_COMMAND} sentinel when `statement` is neither.
 */
function dispatchTurtleCommand(
  statement: StatementNode,
  environment: Environment,
): ExecSignal | undefined | typeof NOT_A_TURTLE_COMMAND {
  if (isPerTurtleCommand(statement)) {
    return runPerTurtleCommand(statement, environment);
  }
  return dispatchTurtleCommandOnce(statement, environment);
}

/**
 * Validate and run a single turtle command against {@link Environment.turtle} (the current turtle).
 * This is the original per-command dispatch — every `isTurtleXCall`/`executeTurtleXCall` branch —
 * now reached once per addressed turtle for a per-turtle command ({@link runPerTurtleCommand}) or
 * once for a canvas-global one ({@link dispatchTurtleCommand}).
 */
function dispatchTurtleCommandOnce(
  statement: StatementNode,
  environment: Environment,
): ExecSignal | undefined | typeof NOT_A_TURTLE_COMMAND {
  if (isTurtleMoveCall(statement)) {
    return executeTurtleMoveCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleTurnCall(statement)) {
    return executeTurtleTurnCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtlePenCall(statement)) {
    return executeTurtlePenCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtlePositionCall(statement)) {
    return executeTurtlePositionCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleHeadingCall(statement)) {
    return executeTurtleHeadingCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleVisibilityCall(statement)) {
    return executeTurtleVisibilityCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleClearCall(statement)) {
    return executeTurtleClearCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleColorCall(statement)) {
    return executeTurtleColorCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleBackgroundCall(statement)) {
    return executeTurtleBackgroundCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleWidthCall(statement)) {
    return executeTurtleWidthCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleFillCall(statement)) {
    return executeTurtleFillCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleStampCall(statement)) {
    return executeTurtleStampCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleGridCall(statement)) {
    return executeTurtleGridCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleAxesCall(statement)) {
    return executeTurtleAxesCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleMeasureCall(statement)) {
    return executeTurtleMeasureCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isTurtleShapeCall(statement)) {
    return executeTurtleShapeCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  return NOT_A_TURTLE_COMMAND;
}

/**
 * Dispatch the statements that write a place or mutate a list/dict value in place — `Assign`
 * (`set … to` / `<place> = …`) plus the five Data-profile mutators `add`/`remove`/`insert`/
 * `clear` (issue #188, `spec/data-structures.md:73-93`) and `RemoveKey` (dict key deletion, issue
 * #322, `spec/data-structures.md:229`) — to their evaluators in `evaluate.ts`. Returns the
 * evaluator's {@link AssignResult} (a clean `ok`, or its `ol-type`/`ol-range` diagnostic), or
 * `undefined` when `statement` is none of them — so {@link executeStatements} falls through to its
 * remaining handlers.
 *
 * `Assign` and the five mutators share one dispatch — and therefore one result local in
 * {@link executeStatements} — on purpose. `executeStatements` recurses once per procedure call, so
 * every extra local it declares widens the per-level stack frame; a *second* result local there for
 * the mutators pushed the 600-deep `recursionDepthLimit: 1000` regression test
 * (`execution-budget.test.mjs`) over the native call-stack limit, exactly as {@link executeShowCall}'s
 * doc comment warns. Folding them together keeps that frame at its original width.
 */
function dispatchAssignOrListMutator(
  statement: StatementNode,
  environment: Environment,
): AssignResult | undefined {
  switch (statement.kind) {
    case "Assign":
      return executeAssign(statement, environment);
    case "Add":
      return executeAdd(statement, environment);
    case "Remove":
      return executeRemove(statement, environment);
    case "Insert":
      return executeInsert(statement, environment);
    case "Clear":
      return executeClear(statement, environment);
    case "RemoveKey":
      return executeRemoveKey(statement, environment);
    default:
      return undefined;
  }
}

/**
 * Executes a `print value1 [value2 ...]` statement (`spec/commands.md`'s `print`) once
 * {@link executeStatements} has confirmed it via {@link isPrintCall}. Extracted into its own
 * function for the same reason {@link dispatchTurtleCommand}'s doc comment gives: `executeStatements`
 * recurses once per procedure call, so keeping this arity/evaluation/snapshot logic (including the
 * per-print `snapshotValue` memo, issue #495's point-in-time-snapshot rule) out of its body keeps
 * its own stack frame size fixed — inlining it there is exactly what pushed the 600-deep
 * `recursionDepthLimit: 1000` regression test (`execution-budget.test.mjs`) over the native
 * call-stack limit.
 *
 * All arguments are evaluated first into `rawValues`, and only once every argument has finished
 * evaluating is that whole list snapshotted, in one pass sharing a single memo (issue #543): a
 * later argument's evaluation can mutate a live value an earlier argument also reads, and the
 * spec's snapshot rule requires the entire payload to reflect state as of the *whole
 * statement's* evaluation — not, incorrectly, each argument's own evaluation instant.
 */
function executePrintCall(
  statement: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  if (statement.args.length === 0) {
    return halt(
      runtimeDiag.notEnoughInputs(
        statement.callee.source_span,
        statement.callee.name,
        1,
        0,
      ),
    );
  }
  // Only evaluate a `print` whose every operand is an expression kind this issue's
  // evaluator gives meaning to (Core literals, arithmetic, variable/place reads, user
  // procedure calls). `(print 1 :ages.tom)` and similar still emit their `instruction`
  // event but are left un-evaluated for the slice that implements the unsupported
  // operand's expression kind.
  if (!statement.args.every((arg) => isSupportedArgument(arg, environment))) {
    return undefined;
  }
  const rawValues: OLValue[] = [];
  let failure: Diagnostic | undefined;
  for (const arg of statement.args) {
    const result = evaluate(arg, environment);
    if (!result.ok) {
      failure = result.diagnostic;
      break;
    }
    rawValues.push(result.value);
  }
  if (failure) {
    return halt(failure);
  }
  // Every argument is evaluated first, and only *then* is the whole argument list snapshotted
  // in one pass sharing a single memo (`spec/execution-model.md`'s point-in-time-snapshot rule):
  // a later argument's evaluation may mutate a live value an earlier argument also reads (e.g.
  // `(print :l (mutate))` where `mutate` does `add 2 to :l`), and the snapshot rule requires
  // every part of this event's payload to reflect state as of the *whole statement's*
  // evaluation, not each argument's own evaluation instant.
  const memo = new Map<object, OLValue>();
  const values = rawValues.map((value) => snapshotValue(value, memo));
  environment.events.push({
    seq: environment.events.length,
    kind: "print",
    source_span: statement.source_span,
    payload: { values } satisfies PrintPayload,
  });
  return undefined;
}

/**
 * Executes a `show value` statement (issue #234, `spec/commands.md`'s `show`) once
 * {@link executeStatements} has confirmed it via {@link isShowCall}. Extracted into its own
 * function for the same reason {@link dispatchTurtleCommand}'s doc comment gives: `executeStatements`
 * recurses once per procedure call, so keeping this arity/evaluation logic out of its body keeps
 * its own stack frame size fixed — inlining it there pushed the 600-deep `recursionDepthLimit:
 * 1000` regression test (`execution-budget.test.mjs`) over the native call-stack limit.
 */
function executeShowCall(
  statement: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  if (statement.args.length === 0) {
    return halt(
      runtimeDiag.notEnoughInputs(
        statement.callee.source_span,
        statement.callee.name,
        1,
        0,
      ),
    );
  }
  if (statement.args.length > 1) {
    return halt(
      runtimeDiag.tooManyInputs(
        statement.callee.source_span,
        statement.callee.name,
        1,
        statement.args.length,
      ),
    );
  }
  // Same unsupported-operand deferral as `print` uses inline in `executeStatements`: only
  // evaluate `show` when its one operand is an expression kind this issue's evaluator gives
  // meaning to.
  const arg = statement.args[0] as ExpressionNode;
  if (!isSupportedArgument(arg, environment)) {
    return undefined;
  }
  const result = evaluate(arg, environment);
  if (!result.ok) {
    return halt(result.diagnostic);
  }
  // `show` shares `print`'s trace-event kind and rendering rule (`printedForm`, `evaluate.ts`'s
  // doc comment near its definition) — the spec gives it "implementation-defined presentation
  // details" but no distinct payload shape from `print`'s.
  environment.events.push({
    seq: environment.events.length,
    kind: "print",
    source_span: statement.source_span,
    payload: { values: [snapshotValue(result.value)] } satisfies PrintPayload,
  });
  return undefined;
}

/**
 * Executes a `randomize`/`(randomize seed)` statement (issue #287, `spec/commands.md`'s
 * `randomize` entry) once {@link executeStatements} has confirmed it via {@link isRandomizeCall}.
 * Reseeds the shared {@link Environment.randomNumberGenerator} generator *in place* — mutating its
 * `state` field rather than replacing `environment.randomNumberGenerator` itself — so every environment
 * sharing this same box (every nested procedure-call/loop-body environment spread from this one
 * via `execute-internal.ts`'s `{...environment, frames: […]}` pattern) observes the reseed. Extracted
 * into its own top-level function for the same stack-depth reason {@link executeShowCall}'s doc
 * comment gives.
 *
 * With no seed, a fresh implementation-chosen seed is drawn
 * ({@link createRandomNumberGeneratorState}'s own `Date.now()` fallback — the entry: "With no seed
 * the implementation chooses a seed"). With a seed, the entry documents no type restriction at
 * all ("Possible errors: none specified beyond
 * general arity diagnostics" — deliberately omitting the "type" diagnostics every sibling entry
 * with an argument lists), so every {@link OLValue} is a valid seed: a number seeds directly
 * (truncated to a whole 32-bit value), and any other type — word/list/boolean, or a non-integer
 * number — is folded through {@link seedFromText} on its printed form instead of being rejected.
 */
function executeRandomizeCall(
  statement: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal | undefined {
  if (statement.args.length > 1) {
    return halt(
      runtimeDiag.tooManyInputs(
        statement.callee.source_span,
        statement.callee.name,
        1,
        statement.args.length,
      ),
    );
  }
  if (statement.args.length === 0) {
    environment.randomNumberGenerator.state =
      createRandomNumberGeneratorState().state;
    return undefined;
  }
  // Same unsupported-operand deferral as `show`/`print` use: only evaluate the seed when it is
  // an expression kind this issue's evaluator gives meaning to.
  const seedNode = statement.args[0] as ExpressionNode;
  if (!isSupportedArgument(seedNode, environment)) {
    return undefined;
  }
  const result = evaluate(seedNode, environment);
  if (!result.ok) {
    return halt(result.diagnostic);
  }
  const value = result.value;
  environment.randomNumberGenerator.state =
    typeof value === "number"
      ? Math.trunc(value) >>> 0
      : seedFromText(printedForm(value));
  return undefined;
}

/**
 * Is `statement` a call to one of the four Educational-profile baseline meta-commands
 * (`explain`/`why`/`hint`/`debug`, `spec/educational-model.md#baseline-meta-commands`)? A1
 * (issue #331) parses all four as ordinary zero-arity `Call`/`ParenCall` nodes — no dedicated AST
 * node kind — matching the existing Turtle/Data precedent ({@link isShowCall}/
 * {@link isRandomizeCall} above), so this predicate has the identical shape: a plain `boolean`
 * checking `statement.callee.name` case-insensitively against the four command names.
 */
function isEducationalMetaCommandCall(
  statement: StatementNode,
): statement is CallNode | ParenCallNode {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  const name = statement.callee.name.toLowerCase();
  return (
    name === "explain" || name === "why" || name === "hint" || name === "debug"
  );
}

/**
 * The statement immediately preceding `statement` in `statements` (the same statement LIST it
 * appears in — top-level program body, or a specific `if`/`while`/`repeat`/`for`/procedure
 * body), skipping past any OTHER Educational meta-command call — {@link TutorContext.target}'s
 * resolution rule (the M3-orchestrator's ruling on issue #332: a purely structural/AST rule,
 * never an event-log scan). `undefined` when `statement` is the first entry, or every earlier
 * entry is itself a meta-command call.
 *
 * `procedures` is `environment.procedures` — the SAME registry {@link executeStatements} itself
 * consults ({@link isProcedureCallStatement}) to let a learner-defined procedure shadow one of
 * the four meta-command names (matching the existing Turtle/Data shadowing convention). A
 * candidate is only skipped as "just a meta-command call" when it is BOTH syntactically one of
 * the four names AND not shadowed by a procedure — a candidate line like `hint` that a `define
 * hint … end` shadows was executed as an ordinary procedure call, so it is a real preceding
 * sibling here too, exactly as it was for {@link executeStatements}'s own dispatch. Without this
 * check, a shadowed candidate would be wrongly skipped even though the run just treated it as a
 * real statement.
 *
 * This is simpler than — and supersedes — an earlier event-log-based approach, and inherently
 * avoids that approach's `procedure-enter` bug class: a meta-command with no preceding sibling in
 * its OWN statement list (whether at top level or as the first statement of a procedure/loop
 * body) simply has no target here, with no need to reason about trace-event kinds at all.
 * Skipping past sibling meta-commands (rather than returning the immediately previous entry
 * unconditionally) is what keeps a run of CONSECUTIVE meta-commands (e.g. `hint` called three
 * times in a row with nothing in between) all resolving to the SAME real target, rather than
 * each one targeting the previous meta-command's own call site — without that skip, `hint`'s
 * progression (`spec/execution-model.md:641-652`, "for the SAME target") could never observe two
 * calls sharing one target.
 */
function findPrecedingSiblingStatement(
  statements: readonly StatementNode[],
  statement: StatementNode,
  procedures: ProcedureRegistry,
): StatementNode | undefined {
  const index = statements.indexOf(statement);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = statements[cursor];
    if (
      candidate !== undefined &&
      !(
        isEducationalMetaCommandCall(candidate) &&
        !procedures.has(candidate.callee.name.toLowerCase())
      )
    ) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * {@link TutorCommandMetadata} for `target`, when the runtime can identify one:  only when
 * `target` is itself a call (`Call`/`ParenCall`) — `spec/educational-model.md:420-434`'s "known
 * command metadata" input. `kind` is `"procedure"` when the callee names a learner-defined
 * procedure in scope (`environment.procedures`), otherwise `"primitive"` — a call-position node
 * is never itself a control/binding special form (`if`/`repeat`/`define`/… each parse as their
 * OWN dedicated `StatementNode` kind, not a `Call`), so this function never returns
 * `kind: "special-form"`. `undefined` when `target` is absent or not a call.
 */
function commandMetadataFor(
  target: StatementNode | undefined,
  procedures: ProcedureRegistry,
): TutorCommandMetadata | undefined {
  if (
    target === undefined ||
    (target.kind !== "Call" && target.kind !== "ParenCall")
  ) {
    return undefined;
  }
  const name = target.callee.name;
  return {
    name,
    arity: target.args.length,
    kind: procedures.has(name.toLowerCase()) ? "procedure" : "primitive",
  };
}

/**
 * Executes one of the four Educational baseline meta-commands once
 * {@link isEducationalMetaCommandCall} has confirmed the statement. Three responsibilities:
 *
 * 1. Reject any nonzero-input parenthesized form — `(explain 1)`, `(hint "x" "y")`, etc. — at
 *    runtime with the stable `ol-too-many-inputs` diagnostic (reusing
 *    {@link runtimeDiag.tooManyInputs} with `expected: 0`, exactly like every other arity
 *    violation in this file). This is the A1 reviewer's flagged gap: A1 reuses the ordinary
 *    zero-arity `Call`/`ParenCall` shape with no static arity check, matching Turtle/Data
 *    precedent, so nothing before this point ever rejects it.
 * 2. Build a {@link TutorContext} from runtime-available data alone — never from edu's
 *    curriculum knowledge, which this package must not import (issue #332's architecture
 *    constraint) — using {@link findPrecedingSiblingStatement} for `target` and
 *    {@link commandMetadataFor} for `commandMetadata`. `diagnostics` is always `[]` in a live
 *    single `execute()` run: a runtime diagnostic halts `executeStatements` immediately and
 *    terminally, so a meta-command in the SAME run can never observe one from its own execution.
 *    Cross-run session persistence (a host re-invoking `why`/`debug` after a halted run with the
 *    halting diagnostic supplied) is a host/studio concern (C2), out of this issue's scope — but
 *    see `educational-meta-commands.test.mjs` for direct unit tests of the diagnostic-arm
 *    construction path via a synthetic `TutorContext`.
 * 3. Call `environment.tutorTemplate` (the resolved `ExecuteOptions.tutorTemplates`, or
 *    {@link defaultTutorTemplate}) and faithfully emit whichever `TutorOutputPayload` arm it
 *    returns as exactly one `tutor-output` event — this function never chooses pedagogy or the
 *    diagnostic-vs-program arm itself (the M3-orchestrator's injectable-template ruling). For
 *    `hint`, the returned payload's `stage` is persisted into `environment.hintProgress` keyed by
 *    the resolved target (or whole-program) span, so a later `hint` for the SAME target sees it
 *    as `priorHintStage`.
 */
function executeEducationalMetaCommand(
  statement: CallNode | ParenCallNode,
  statements: readonly StatementNode[],
  environment: Environment,
): ExecSignal | undefined {
  const command = statement.callee.name.toLowerCase() as TutorCommand;
  if (statement.args.length > 0) {
    return halt(
      runtimeDiag.tooManyInputs(
        statement.callee.source_span,
        statement.callee.name,
        0,
        statement.args.length,
      ),
    );
  }

  const target = findPrecedingSiblingStatement(
    statements,
    statement,
    environment.procedures,
  );
  const targetOrProgramSpan =
    target?.source_span ?? environment.program.source_span;
  const hintKey = hintTargetKey(targetOrProgramSpan);
  const priorHintStage =
    command === "hint" ? environment.hintProgress.get(hintKey) : undefined;

  const context: TutorContext = {
    command,
    program: environment.program,
    target,
    events: environment.events,
    diagnostics: [],
    level: environment.learnerLevel,
    commandMetadata: commandMetadataFor(target, environment.procedures),
    priorHintStage,
  };

  const payload = environment.tutorTemplate(context);
  if (payload.command === "hint") {
    environment.hintProgress.set(hintKey, payload.stage);
  }

  environment.events.push({
    seq: environment.events.length,
    kind: "tutor-output",
    source_span: statement.source_span,
    payload,
  });
  return undefined;
}

/**
 * Sentinel `dispatchShowRandomizeOrEducationalCommand` returns when `statement` is none of
 * `show`/`randomize`/the four Educational meta-commands, so {@link executeStatements} can fall
 * through to its other statement-kind checks. Distinct from `undefined`, which means "handled,
 * continue" (same convention as {@link NOT_A_TURTLE_COMMAND}/`dispatchTurtleCommand`).
 */
const NOT_A_SHOW_RANDOMIZE_OR_EDUCATIONAL_COMMAND = Symbol(
  "not-a-show-randomize-or-educational-command",
);

/**
 * Single entry point {@link executeStatements} calls to try `show`, `randomize`, and the four
 * Educational meta-commands (`explain`/`why`/`hint`/`debug`, issue #332) in one step — the same
 * amortization {@link dispatchTurtleCommand}'s doc comment explains: folding multiple
 * single-command predicate/dispatch pairs behind one call site keeps `executeStatements`'s own
 * body (and so every stack frame in a deep recursive program) from growing with each additional
 * statement kind it recognizes. `show` (issue #234) and `randomize` (issue #287) were already
 * combined here for exactly this reason — the doc comment on the original two-command version
 * of this function recorded that "the second inline check alone was enough to push the 600-deep
 * `recursionDepthLimit: 1000` regression test over the native call-stack limit under coverage
 * instrumentation" — and issue #332's own first attempt (a separate
 * `dispatchEducationalMetaCommand` call site right after this one) reproduced precisely that
 * regression, so the four meta-commands are folded into this SAME dispatcher rather than added
 * as a new one. `statements` (the full statement list `statement` appears in) is threaded through
 * only for the educational branch's sibling-statement lookup — `show`/`randomize` ignore it.
 */
function dispatchShowRandomizeOrEducationalCommand(
  statement: StatementNode,
  statements: readonly StatementNode[],
  environment: Environment,
): ExecSignal | undefined | typeof NOT_A_SHOW_RANDOMIZE_OR_EDUCATIONAL_COMMAND {
  if (isShowCall(statement)) {
    return executeShowCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isRandomizeCall(statement)) {
    return executeRandomizeCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  if (isEducationalMetaCommandCall(statement)) {
    return executeEducationalMetaCommand(statement, statements, environment);
  }
  return NOT_A_SHOW_RANDOMIZE_OR_EDUCATIONAL_COMMAND;
}

/**
 * Serializes a `SourceSpan` into a stable string key for {@link Environment.hintProgress} —
 * `document` plus both endpoints, so two different spans (even in the same document) never
 * collide, and the whole-program fallback span (a distinct, wider span than any single
 * statement) gets its own independent progression, per
 * `spec/execution-model.md:641-652`'s "observable ordering ... for a given target-source-span
 * value" requirement.
 */
function hintTargetKey(span: SourceSpan): string {
  return `${span.document}:${span.start[0]}:${span.start[1]}:${span.end[0]}:${span.end[1]}`;
}

/**
 * Evaluate an `if`/`while` condition and require it to be a boolean — there is no truthiness
 * (`spec/execution-model.md:365-369`, `spec/error-model.md:121`). `operation` names the leading
 * form (`"if"`/`"while"`) for the `ol-not-boolean` diagnostic's `params.operation`, reusing the
 * `runtimeDiag.notBoolean` builder issue #95 added for `and`/`or`/`not` rather than duplicating it.
 * Returns the propagated evaluation failure, the `ol-not-boolean` diagnostic, or the boolean.
 */
function evaluateCondition(
  condition: ExpressionNode,
  environment: Environment,
  operation: "if" | "while",
):
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly diagnostic: Diagnostic } {
  const result = evaluate(condition, environment);
  if (!result.ok) {
    return result;
  }
  if (typeof result.value !== "boolean") {
    return {
      ok: false,
      diagnostic: runtimeDiag.notBoolean(condition.source_span, {
        actual: typeNameOf(result.value),
        operation,
      }),
    };
  }
  return { ok: true, value: result.value };
}

/**
 * The outcome of running a list of statements. `"normal"` is a clean run through every statement;
 * `"halt"` is the pre-existing "stopped on a diagnostic" outcome, just renamed to make room for
 * the two new control-transfer outcomes issue #97 adds: `"return"` (a `return`/`output`/`op`
 * reached, carrying its value and the exact keyword spelling used, for the
 * `ol-return-outside-proc` diagnostic if it escapes every enclosing procedure) and `"stop"` (a
 * `stop` reached). Every control-form body below (`If`/`While`/`Repeat`/`Forever`/`ForIn`/
 * `ForRange`) now propagates ANY non-`"normal"` signal straight up unchanged rather than only
 * checking for `"halt"` — this is what makes a `stop`/`return` nested inside a loop inside a
 * procedure exit the whole procedure, not just that loop (`spec/execution-model.md:340-349`).
 * {@link runProcedure} is the only place that ever *consumes* a `"return"`/`"stop"` signal; if one
 * reaches {@link runProgram}'s top level instead, no procedure was there to catch it, so it is
 * converted to `ol-return-outside-proc`/`ol-stop-outside-proc`.
 */
type ExecSignal =
  | { readonly kind: "normal" }
  | { readonly kind: "halt"; readonly diagnostic: Diagnostic }
  | {
      readonly kind: "return";
      readonly value: OLValue;
      readonly source_span: SourceSpan;
      readonly keyword: "return" | "output" | "op";
    }
  | { readonly kind: "stop"; readonly source_span: SourceSpan };

const NORMAL_SIGNAL: ExecSignal = { kind: "normal" };

function halt(diagnostic: Diagnostic): ExecSignal {
  return { kind: "halt", diagnostic };
}

/**
 * Every `ProcedureDef` in `program`, keyed by its lowercased name — a whole-program scan (not
 * just the top-level statement list) so a procedure may be called before its textual `define`
 * (`spec/execution-model.md:328-333`), mirroring the static checker's `collectProcedureArities`/
 * `collectVisibleNames` (`packages/parser/src/checker-arity.ts`) exactly, including "a later
 * `define` of the same name overwrites the earlier one here" — redefinition itself is
 * `ol-reserved-word`'s concern (issue #113), not this collection's.
 */
function collectProcedures(program: ProgramNode): ProcedureRegistry {
  const procedures = new Map<string, ProcedureDefNode>();
  walk(program, (node) => {
    if (node.kind === "ProcedureDef") {
      procedures.set(node.name.name.toLowerCase(), node);
    }
  });
  return procedures;
}

/** The outcome of {@link collectStructs}: either the built registry, or the first collision found. */
type StructCollection =
  | { readonly ok: true; readonly structs: StructRegistry }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * Is `name` already a primitive in ANY profile's callable table? `struct` registers a constructor
 * in the callable namespace, so a struct type name that shadows any built-in command/reporter —
 * Core, Turtle, Data, Educational, the Geometry overlay (`grid`/`axes`/`measure`), the
 * Interaction & Events `wait`, or Sound (`set_tempo`/`beep`) — is a collision regardless of which
 * profiles a given program happens to touch, mirroring how {@link runProgram} runs every profile's
 * primitives unconditionally (`execute()` does not gate by profile).
 */
function isPrimitiveName(name: string): boolean {
  return (
    corePrimitiveArity(name) !== undefined ||
    turtlePrimitiveArity(name) !== undefined ||
    dataPrimitiveArity(name) !== undefined ||
    educationalPrimitiveArity(name) !== undefined ||
    geometryPrimitiveArity(name) !== undefined ||
    interactionPrimitiveArity(name) !== undefined ||
    soundPrimitiveArity(name) !== undefined
  );
}

/**
 * The runtime phase-1 struct registration guard (issue #329): every top-level `struct <name>
 * [ field… ]` registers its type name → declaration in the callable namespace BEFORE any statement
 * runs, so a struct may be constructed before its textual declaration and so `type_of`/`is_a?` see
 * every struct type up front — exactly mirroring {@link collectProcedures}'s whole-program pre-scan
 * for `define`. Unlike procedures, a struct name that collides with a reserved word, a primitive
 * (any profile), an already-collected procedure, or an earlier `struct` of the same name raises
 * `ol-reserved-word` here at phase-1 (`spec/data-structures.md:264`), at `stage: "runtime"` —
 * because `execute()` runs `parse()` only, never `check()`, so the parser's `checker-reserved-word`
 * rule never runs. The `namespace` priority (`reserved` → `primitive` → `procedure` → `struct`)
 * matches that checker's "more fundamental category wins" ordering, extended with `struct` for a
 * duplicate type name. The first collision found (in source order) halts the whole program.
 */
function collectStructs(
  program: ProgramNode,
  procedures: ProcedureRegistry,
): StructCollection {
  const structs = new Map<string, StructDefNode>();
  let collision: Diagnostic | undefined;
  walk(program, (node) => {
    if (collision !== undefined || node.kind !== "StructDef") {
      return;
    }
    const name = node.name.name;
    const namespace = isReservedWord(name)
      ? "reserved"
      : isPrimitiveName(name)
        ? "primitive"
        : procedures.has(name.toLowerCase())
          ? "procedure"
          : structs.has(name.toLowerCase())
            ? "struct"
            : undefined;
    if (namespace !== undefined) {
      collision = runtimeDiag.reservedWord(
        node.name.source_span,
        name,
        namespace,
      );
      return;
    }
    structs.set(name.toLowerCase(), node);
  });
  if (collision !== undefined) {
    return { ok: false, diagnostic: collision };
  }
  return { ok: true, structs };
}

/**
 * Is `statement` a call — bare or parenthesized — to a name that {@link Environment.procedures}
 * knows, i.e. a user-procedure call in statement (command) position (`star 5 100`, as opposed to
 * expression/reporter position, e.g. `print area :r`, which `evaluate.ts`'s `evaluateCall`
 * dispatches instead via `environment.callProcedure`)?
 */
function isProcedureCallStatement(
  statement: StatementNode,
  procedures: ProcedureRegistry,
): boolean {
  return (
    (statement.kind === "Call" || statement.kind === "ParenCall") &&
    procedures.has(statement.callee.name.toLowerCase())
  );
}

/**
 * The result of one procedure invocation: `ok:false` propagates a diagnostic (an arity mismatch,
 * a failed argument/default evaluation, or a diagnostic that halted the body); `ok:true` carries
 * `result` — the `return`ed value, or `null` for a command (the body finished, or `stop`ped,
 * without ever reaching `return`). A dedicated type, not {@link EvalResult}, since `result` can be
 * `null` (a command) where {@link OLValue} cannot.
 */
type ProcedureOutcome =
  | { readonly ok: true; readonly result: OLValue | null }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * Run one invocation of the user procedure `def` denotes, called via `node` (its callee span is
 * used for every diagnostic below, matching the static checker's `checker-arity.ts` convention of
 * pointing at the callee, not the whole call). Shared by both a statement-position call
 * (dispatched directly in {@link executeStatements}) and an expression-position call
 * (`evaluate.ts`'s `evaluateCall`, via `environment.callProcedure` — see this file's header comment for
 * why that indirection exists).
 *
 * Arity is checked BEFORE evaluating any argument, exactly like the static checker's
 * `arityRule` (`packages/parser/src/checker-arity.ts`): `actual < required` is
 * `ol-not-enough-inputs`, `actual > max` is `ol-too-many-inputs` — both share that rule's
 * `{callable, expected, actual}` param shape so the two stages agree on diagnostic identity
 * (issue #111 / #97). The reader already caps a bare `Call` to a user procedure at its required
 * parameter count (it stops gathering arguments at the first optional/parenthesized-default
 * parameter), so `actual > max` is only actually reachable for the parenthesized form in
 * practice — but the check itself does not special-case `node.kind`, matching `arityRule` exactly.
 *
 * Each supplied argument is evaluated left to right in the CALLER's environment, before the
 * callee frame exists. The callee then runs in a FRESH frame stacked only on the shared root
 * frame (`environment.frames[environment.frames.length - 1]`, never the caller's own local frame(s)) — lexical
 * scoping: the callee cannot see the caller's parameters or locals unless passed as an argument
 * (`spec/execution-model.md:316-320`). Its own `repeatTurns` starts empty: `repcount` is tied to
 * the lexical nesting of `repeat` within the currently-running body, and a callee begins a new
 * body, so it starts with no active `repeat` turn of its own (an assumption called out in this
 * issue's PR, since the spec does not spell out `repcount` across a call boundary explicitly).
 * Every parameter without a supplied argument (an omitted optional) has its `defaultValue`
 * evaluated in the NEW callee frame, in parameter order, so an earlier parameter's bound value is
 * visible to a later parameter's default expression; a failure there (e.g. `ol-div-zero`)
 * propagates exactly like a failed supplied-argument evaluation.
 *
 * A `procedure-enter` event carries the callee's name and every bound argument value (required
 * ones as supplied, optional ones with their default already applied) in parameter order,
 * pushed before the body runs; a `procedure-exit` event carries the callee's name and its result
 * — the `return`ed value, or `null` for a command (fell through, or `stop`ped) — pushed after,
 * but only on a clean or `return`/`stop` outcome (a `"halt"` outcome skips it, matching the
 * existing convention that a diagnostic stops the trace with no further events at all). This
 * ordering reproduces the spec's worked recursive-call trace exactly
 * (`spec/execution-model.md:606-648`).
 *
 * Before any of that, the call is checked against `environment.callDepth`'s length — the current
 * procedure-call nesting depth — against {@link Environment.recursionDepthLimit}: exceeding it
 * raises `ol-limit` at the callee span instead of recursing further, so an unbounded recursive
 * procedure degrades to a friendly diagnostic rather than a host `RangeError: Maximum call stack
 * size exceeded` (`spec/execution-model.md:551-557`). A depth marker is pushed once the check
 * passes and popped in a `finally` covering the rest of this function, so it is removed on every
 * exit path — a clean return, a `stop`, or a diagnostic partway through argument/default
 * evaluation or the body itself. `recursionDepthLimit` defaults to
 * {@link DEFAULT_RECURSION_DEPTH_LIMIT} but is configurable per `execute()` call (issue #102) —
 * this is the previously hardcoded ceiling `MAX_PROCEDURE_CALL_DEPTH` promoted to a field of
 * {@link Environment}, not a new mechanism.
 */
function runProcedure(
  node: CallNode | ParenCallNode,
  environment: Environment,
): ProcedureOutcome {
  environment.lastCallSpan.span = node.callee.source_span;
  if (environment.callDepth.length >= environment.recursionDepthLimit) {
    return {
      ok: false,
      diagnostic: runtimeDiag.recursionLimit(
        node.callee.source_span,
        environment.recursionDepthLimit,
      ),
    };
  }
  environment.callDepth.push(environment.callDepth.length + 1);
  try {
    return runProcedureBody(node, environment);
  } finally {
    environment.callDepth.pop();
  }
}

/**
 * Builds a {@link ProcedureEnterPayload} whose `args` are point-in-time snapshots
 * (issue #495's rule, `spec/execution-model.md`'s effect-event-snapshot section) rather than
 * the live bound-argument values, sharing a single memo across all of a call's arguments so
 * two arguments that alias the same live value (e.g. `(foo :l :l)`) remain aliased in the
 * snapshot too. Extracted into its own function — rather than inlined at
 * {@link runProcedureBody}'s `procedure-enter` push — for the same stack-frame-size reason
 * {@link executePrintCall}'s doc comment gives: `runProcedureBody` is on the
 * `recursionDepthLimit`-checked recursive call path, so any inline growth there (a `Map`
 * allocation, a `.map()` call) risks reproducing the 600-deep `recursionDepthLimit: 1000`
 * regression (`execution-budget.test.mjs`) over the native call-stack limit.
 */
function snapshotProcedureEnterPayload(
  name: string,
  args: readonly OLValue[],
): ProcedureEnterPayload {
  const memo = new Map<object, OLValue>();
  return { name, args: args.map((arg) => snapshotValue(arg, memo)) };
}

/** The body of {@link runProcedure}, run once the recursion-depth check and push have happened. */
function runProcedureBody(
  node: CallNode | ParenCallNode,
  environment: Environment,
): ProcedureOutcome {
  const name = node.callee.name.toLowerCase();
  const def = environment.procedures.get(name) as ProcedureDefNode;
  const required = def.params.filter(
    (param) => param.defaultValue === undefined,
  ).length;
  const max = def.params.length;
  const actual = node.args.length;
  if (actual < required) {
    return {
      ok: false,
      diagnostic: runtimeDiag.notEnoughInputs(
        node.callee.source_span,
        node.callee.name,
        required,
        actual,
      ),
    };
  }
  if (actual > max) {
    return {
      ok: false,
      diagnostic: runtimeDiag.tooManyInputs(
        node.callee.source_span,
        node.callee.name,
        max,
        actual,
      ),
    };
  }

  const argValues: OLValue[] = [];
  for (const arg of node.args) {
    const result = evaluate(arg, environment);
    if (!result.ok) {
      return { ok: false, diagnostic: result.diagnostic };
    }
    argValues.push(result.value);
  }

  const calleeFrame: Frame = new Map();
  const calleeEnv: Environment = {
    ...environment,
    frames: [
      calleeFrame,
      environment.frames[environment.frames.length - 1] as Frame,
    ],
    repeatTurns: [],
  };
  const boundArgs: OLValue[] = [];
  for (const [index, param] of def.params.entries()) {
    if (index < argValues.length) {
      const value = argValues[index] as OLValue;
      calleeFrame.set(param.name.name.toLowerCase(), value);
      boundArgs.push(value);
      continue;
    }
    // An omitted optional's default is evaluated in the callee frame, once its earlier
    // (already-bound) siblings are in place, so a later default may reference an earlier
    // parameter (e.g. a hypothetical `(:step 100) (:points (:step))`).
    const defaultResult = evaluate(
      param.defaultValue as ExpressionNode,
      calleeEnv,
    );
    if (!defaultResult.ok) {
      return { ok: false, diagnostic: defaultResult.diagnostic };
    }
    calleeFrame.set(param.name.name.toLowerCase(), defaultResult.value);
    boundArgs.push(defaultResult.value);
  }

  environment.events.push({
    seq: environment.events.length,
    kind: "procedure-enter",
    source_span: node.source_span,
    payload: snapshotProcedureEnterPayload(def.name.name, boundArgs),
  });

  const signal = executeStatements(def.body.body, calleeEnv);
  if (signal.kind === "halt") {
    return { ok: false, diagnostic: signal.diagnostic };
  }
  const result = signal.kind === "return" ? signal.value : null;

  environment.events.push({
    seq: environment.events.length,
    kind: "procedure-exit",
    source_span: node.source_span,
    payload: {
      name: def.name.name,
      // Snapshotted inline (issue #495), unlike `procedure-enter`'s payload just above, which
      // uses the extracted `snapshotProcedureEnterPayload` helper: an equivalent extracted
      // helper here was tried and regressed the 600-deep `recursionDepthLimit: 1000` regression
      // test (`execution-budget.test.mjs`) over the native call-stack limit, since this push is
      // in `runProcedureBody`'s own frame on the recursion-depth-checked call path — every byte
      // added to this frame's own size is multiplied by the recursion depth. `procedure-enter`'s
      // extraction stayed under that budget; this one and `executeStatements`'s `"Return"`
      // branch below did not, so both are inlined as the smallest correct fix instead.
      result: result === null ? null : snapshotValue(result),
    } satisfies ProcedureExitPayload,
  });

  return { ok: true, result };
}

/**
 * Call a user procedure from an expression/reporter position (`print area :r`): like
 * {@link runProcedure}, but a command result (`null` — the procedure never reached `return`)
 * is `ol-no-output` here, since a value is required in this position
 * (`spec/execution-model.md:346-349`). Wired onto every execution `Environment`'s
 * `callProcedure` field so `evaluate.ts`'s `evaluateCall` can reach it without importing this
 * module (see this file's header comment).
 */
function callProcedureAsValue(
  node: CallNode | ParenCallNode,
  environment: Environment,
): EvalResult {
  const outcome = runProcedure(node, environment);
  if (!outcome.ok) {
    return outcome;
  }
  if (outcome.result === null) {
    return {
      ok: false,
      diagnostic: runtimeDiag.noOutput(
        node.callee.source_span,
        node.callee.name,
      ),
    };
  }
  return { ok: true, value: outcome.result };
}

/**
 * Execute `statements` in order, mutating `environment.events` in place with one `instruction` event per
 * statement plus whatever effect events that statement's kind produces, and returns an
 * {@link ExecSignal} describing how the run ended: `"normal"` on a clean run through every
 * statement, `"halt"` with the diagnostic that stopped it, or — issue #97 — `"return"`/`"stop"`
 * when a `return`/`stop` was reached and needs to keep propagating up to its enclosing procedure
 * (or, if there is none, to {@link runProgram}'s top level). This is the shared statement-
 * execution core for both the top-level program body ({@link runProgram}), a procedure's own body
 * ({@link runProcedure}), and a control form's block body (the `If`/`While`/`Repeat`/`Forever`
 * handling below) — a block is just another list of statements run against the same threaded
 * {@link Environment} (`spec/execution-model.md:316-327`), so nested control forms, further-nested
 * blocks, and procedure bodies all recurse through this same function without their own copy of
 * the dispatch logic.
 *
 * An `Assign` statement (`:place = value`, `set place to value`) is executed via
 * {@link executeAssign}; it never emits its own event (there is no dedicated event kind for
 * assignment in the trace/event registry) but a failure — `ol-not-a-place` for a reporter/call
 * target, or a diagnostic propagated from evaluating the value/an intermediate postfix segment —
 * stops execution exactly like a print failure does. A `.field`-bearing target is Data-profile
 * and deferred: `executeAssign` leaves it silently un-executed rather than raising.
 *
 * A `print` statement (`print value` or the parenthesized variadic `(print a b …)`) additionally
 * evaluates every operand, left to right, and — once all of them evaluate cleanly — emits a
 * `print` event carrying every value, but only when {@link isSupportedExpression} says this
 * issue's evaluator gives *each* operand a value; otherwise the whole statement is left
 * un-evaluated for a future slice (e.g. `print :ages.tom` — dotted-field reads land with the
 * Data profile). A zero-argument `print`/`(print)` raises `ol-not-enough-inputs` (issue #98):
 * `execute()` runs `parse()` only, so the semantic checker's static arity rule — which cannot
 * itself catch an open-variadic parenthesized under-supply, `packages/parser/src/checker-arity.ts`
 * — never runs here, and this is the only guard against silently treating a callee-only `print`
 * as a no-op. If evaluating an operand raises a runtime diagnostic (`ol-div-zero`, `ol-neg-sqrt`,
 * `ol-type`, `ol-undefined-var`, `ol-range`), execution stops there: the events emitted so far are
 * kept and the diagnostic is returned, exactly as a parse-stage failure returns diagnostics
 * instead of a trace — later operands of that same `print` are never evaluated.
 *
 * A `Call`/`ParenCall` statement whose callee names a user procedure (issue #97,
 * {@link isProcedureCallStatement}) runs it via {@link runProcedure} for its side effects only —
 * a command result (`null`) is perfectly fine to discard in statement position, so `ol-no-output`
 * never fires here (only {@link callProcedureAsValue}'s expression-position path raises it). Any
 * OTHER call (a callee this issue's evaluator does not know — neither a Core primitive/operator
 * nor a user procedure) still emits its `instruction` event but is left un-evaluated, same as
 * before.
 *
 * A `Return`/`Stop`/`Throw` statement (issue #97) always returns its own {@link ExecSignal}
 * unconditionally, regardless of whether a procedure is actually running: `Return`'s value is
 * evaluated first — gated by {@link isSupportedExpression}, same "defer if unsupported"
 * convention as `print` — and pushes a `return` event before returning `{kind:"return", …}`;
 * `Stop` returns `{kind:"stop", …}` with no event of its own (the enclosing `procedure-exit`'s
 * `result:null` already conveys it); `Throw`'s value is likewise evaluated first (a word is used
 * as the message verbatim, any other value via its printed form, matching `print`'s own
 * rendering) and becomes `{kind:"halt", diagnostic: ol-user-error}`. Whichever signal comes out is
 * either consumed by the nearest enclosing {@link runProcedure} call, or — if it escapes every
 * enclosing procedure — converted by {@link runProgram} into `ol-return-outside-proc`/
 * `ol-stop-outside-proc`.
 *
 * An `If` statement (issue #100) evaluates `condition` — requiring a boolean, `ol-not-boolean`
 * otherwise (`spec/execution-model.md:365-369`) — and runs exactly one branch: `thenBody` when
 * `condition` is `true`, `elseBody` when it is `false` and present, or neither (no further events)
 * when it is `false` and there is no `else`. Both the bracketed and long-form `… end` bodies parse
 * to the identical `BlockNode` shape, so they execute identically — there is nothing here that
 * distinguishes them. Per the block-result rule (`spec/execution-model.md:214-227`), a bracketed
 * `if`/`while` body runs for effect only: a trailing bare-value expression's value is silently
 * discarded (no value-producing event, no diagnostic) — which already falls out of this function,
 * since a statement kind this issue does not evaluate (a bare arithmetic expression, a call to
 * anything other than `print`) still emits its `instruction` event but never reaches a branch that
 * evaluates or emits a value for it.
 *
 * A `While` statement (issue #100) re-evaluates `condition` before every pass — including the
 * first — running `body` each time it holds and stopping the moment it is `false`
 * (`spec/execution-model.md:365-369`); a condition that never becomes `false` runs forever, same
 * as any other unbounded loop in this issue's scope (the cancellable execution budget is a later,
 * separate slice).
 *
 * A `Repeat` statement (issue #104) evaluates `count`, then validates it TYPE then RANGE, in that
 * exact order (`spec/execution-model.md:367-369`): a non-whole-number count raises `ol-type`
 * ({@link requireWholeNumber}); otherwise a negative count raises `ol-range`
 * (`runtimeDiag.negativeCount`); `repeat 0` runs `body` zero times with no diagnostic. Each pass
 * pushes that pass's 1-based turn onto `environment.repeatTurns` before running `body` and pops it after —
 * even on a diagnostic, the stack for `repcount` is only ever this scoped, so a nested `repeat`
 * inside `body` sees its own turn on top of the outer one, and `repcount` always reads the
 * innermost.
 *
 * A `Forever` statement (issue #104) repeats `body` without bound — cancellation and the
 * execution budget are a later, separate slice (#102) — up to `foreverIterationLimit` passes when
 * one is supplied. That limit is a **test-only** knob only reachable via
 * {@link executeWithForeverIterationLimitForTests}, never via `execute()`; no production caller
 * ever passes it, so every real `forever` genuinely never terminates, same as an always-`true`
 * `while`.
 *
 * A `ForIn` statement (issue #103) evaluates `iterable` — it must be a list, `ol-type` otherwise
 * (`spec/execution-model.md:375-376`; Core `for ... in` is list-only, dict iteration is a later
 * profile) — then runs `body` once per element, in order, binding `binder` fresh each pass via
 * `evaluate.ts`'s {@link pushLoopFrame}. A bare-name binder binds the whole element; a
 * destructuring binder (`evaluate.ts`'s {@link bindElement}) binds each of its names positionally
 * from the element, which must
 * itself be a list of exactly that many items (`ol-range` otherwise —
 * `spec/execution-model.md:435-439`). A duplicate name within one destructuring pattern
 * (`for [:x :x] in ...`) raises `ol-duplicate-binder`, checked once up front via
 * {@link findDuplicateBinderName} since it is a static property of the pattern, not the data.
 *
 * A `ForRange` statement (issue #103) evaluates `from`/`to`/`by` (default step `1`) — each must be
 * a number, `ol-type` otherwise ({@link requireNumber}, which unlike `repeat`'s count is not
 * restricted to whole numbers) — then iterates `variable` from `from` to `to` inclusive, adding
 * `step` each pass: with a positive step the body runs while `variable` is at most `to`, with a
 * negative step while it is at least `to` (`spec/execution-model.md:370-375`). A step pointing
 * away from `to` (e.g. `from 1 to 5 by -1`) runs `body` zero times, no diagnostic; a step of `0`
 * raises `ol-range` (`runtimeDiag.forStepZero`) since it would otherwise never reach `to`.
 * `variable` is bound fresh each pass via {@link pushLoopFrame}, same as `ForIn`'s binder.
 *
 * Both loops' binders are fresh **body-local** bindings (`spec/execution-model.md:435-437`): each
 * pass runs `body` against a *new* {@link Environment} with one extra frame in front of `environment`'s
 * own frames, so the binding is visible inside `body` but never leaks past the loop — `environment` itself
 * is never mutated. `environment.repeatTurns` (same array reference) and `environment.foreverIterationLimit` are
 * threaded through unchanged, so a `repeat`'s `repcount` and a `forever`'s test-only iteration cap
 * both still work correctly across a nested `for`. Every control-form body below propagates ANY
 * non-`"normal"` signal from `executeStatements` straight back up — including `"return"`/`"stop"`
 * — so a `stop` or `return` nested inside a loop nested inside a procedure exits the *procedure*,
 * not just that loop (`spec/execution-model.md:340-349`).
 *
 * Statement kinds this issue does not give meaning to (e.g. a bare arithmetic expression, or any
 * call this evaluator does not know) still emit their `instruction` event but do not evaluate —
 * that is each statement kind's own future slice to add.
 *
 * Issue #102: before pushing that `instruction` event, every pass through this loop calls
 * {@link checkExecutionLimits} — the shared cancellation/instruction-budget gate — and halts with
 * its `ol-limit` diagnostic instead of emitting the event or dispatching the statement. This is
 * why a `forever`/`while`/`repeat`/`for` loop or a procedure call is always budgeted and
 * cancellable no matter how deeply nested: they all recurse back into this same function for
 * their body. A loop whose body is empty gets its own equivalent check directly in its own pass
 * (see e.g. `While`/`Forever` below) since it would otherwise never reach this loop at all.
 */
/**
 * Executes a statement-position user-procedure call (`star 5 100`) once
 * {@link isProcedureCallStatement} has confirmed it. Extracted into its own function for the same
 * reason {@link executeShowCall}'s doc comment gives: `executeStatements` recurses once per
 * procedure call, so keeping this argument-gating logic out of its body keeps its own stack frame
 * size fixed — inlining an `isSupportedExpression` gate directly there pushed the 600-deep
 * `recursionDepthLimit: 1000` regression test (`execution-budget.test.mjs`) over the native
 * call-stack limit.
 *
 * Unlike an expression-position call (`print area :r`), which only ever reaches `runProcedure`
 * after `evaluate.ts`'s own `isSupportedExpression` gate already checked every argument, a
 * statement-position call is dispatched straight from `executeStatements` — so this is the one
 * call site that must gate its own arguments. An argument this issue's evaluator cannot yet give
 * meaning to (e.g. a dict literal, `star { a: 1 }`) leaves the whole call un-evaluated, same as
 * the "instruction event but no evaluation" convention documented above, rather than reaching
 * `evaluate()` and throwing.
 */
function executeProcedureCallStatement(
  call: CallNode | ParenCallNode,
  environment: Environment,
): ExecSignal {
  if (!call.args.every((arg) => isSupportedArgument(arg, environment))) {
    return NORMAL_SIGNAL;
  }
  const outcome = runProcedure(call, environment);
  if (!outcome.ok) {
    return halt(outcome.diagnostic);
  }
  return NORMAL_SIGNAL;
}

/**
 * Normalize a Heritage short command alias to its Core spelling for execution (issue #668). When
 * `statement` is a `Call`/`ParenCall` carrying a `canonical` name (the reader sets it only for the
 * ten Heritage aliases `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/`pr`), this returns a shallow
 * copy whose `callee.name` is that Core name, preserving the original `callee.source_span` (so
 * diagnostics still point at the alias the learner wrote) and `args`. Every other statement — and
 * every Core-spelled call, which has no `canonical` — is returned unchanged, so this is a strict
 * no-op outside Heritage and the existing execution behavior is bit-for-bit identical.
 *
 * A user procedure whose name is the alias's surface spelling shadows the alias: `define fd :x … end`
 * makes `fd` the user's procedure, exactly as `define forward :x … end` shadows the Core `forward`.
 * The reader sets `canonical` profile-blind (it cannot see the program's procedures), so the guard
 * lives here — when the surface name is a registered procedure we leave the callee untouched so it
 * dispatches to the user procedure, never silently rewriting `fd` to `forward`. (Canonicalizing to a
 * name that *is* a user procedure — `fd` when the program defines `forward` — is intended and stays:
 * the alias dispatches to whatever `forward` means.)
 *
 * This is the single dispatch chokepoint: because the callee name is normalized here, before any
 * `is*Call` predicate or executor runs, `fd 10` executes through the exact same path as
 * `forward 10` and emits an identical event stream — including the `primitive`/`procedure-enter`/
 * `procedure-exit` payload names, which therefore carry the canonical Core name, never the surface
 * alias (`spec/conformance.md#heritage` — "alternate spellings only, no new semantics").
 */
function canonicalizeHeritageAliasCall(
  statement: StatementNode,
  procedures: ProcedureRegistry,
): StatementNode {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return statement;
  }
  const canonical = statement.canonical;
  if (canonical === undefined) {
    return statement;
  }
  if (procedures.has(statement.callee.name.toLowerCase())) {
    return statement;
  }
  return {
    ...statement,
    callee: { ...statement.callee, name: canonical },
  };
}

function executeStatements(
  statements: readonly StatementNode[],
  environment: Environment,
): ExecSignal {
  for (const rawStatement of statements) {
    // Heritage short command aliases (`fd`/`bk`/…/`pr`, issue #668) are "alternate spellings only —
    // no new semantics" (`spec/conformance.md:146`): the reader recorded the Core name the alias
    // spells on the node's `canonical` field. Normalizing the callee to that Core name ONCE here —
    // the single dispatch chokepoint — makes every downstream `is*Call` predicate and executor,
    // plus every emitted event payload (`instruction`, `primitive`, `procedure-enter/exit`), fire
    // exactly as they do for the Core spelling, with no per-command alias handling and no divergent
    // code path. A Core-spelled statement carries no `canonical`, so this is a no-op for it and the
    // entire existing behavior is bit-for-bit unchanged.
    const statement = canonicalizeHeritageAliasCall(
      rawStatement,
      environment.procedures,
    );
    const limitDiagnostic = checkExecutionLimits(
      environment,
      statement.source_span,
    );
    if (limitDiagnostic) {
      return halt(limitDiagnostic);
    }
    environment.events.push({
      seq: environment.events.length,
      kind: "instruction",
      source_span: statement.source_span,
      payload: { statement_kind: statement.kind } satisfies InstructionPayload,
    });

    const writeResult = dispatchAssignOrListMutator(statement, environment);
    if (writeResult !== undefined) {
      if (!writeResult.ok) {
        return halt(writeResult.diagnostic);
      }
      continue;
    }

    if (isProcedureCallStatement(statement, environment.procedures)) {
      const signal = executeProcedureCallStatement(
        statement as CallNode | ParenCallNode,
        environment,
      );
      if (signal.kind === "halt") {
        return signal;
      }
      continue;
    }

    if (isPrintCall(statement)) {
      const signal = executePrintCall(statement, environment);
      if (signal !== undefined) {
        if (signal.kind === "halt") {
          return signal;
        }
      }
      continue;
    }

    const showRandomizeOrEducationalOutcome =
      dispatchShowRandomizeOrEducationalCommand(
        statement,
        statements,
        environment,
      );
    if (
      showRandomizeOrEducationalOutcome !==
      NOT_A_SHOW_RANDOMIZE_OR_EDUCATIONAL_COMMAND
    ) {
      if (showRandomizeOrEducationalOutcome) {
        return showRandomizeOrEducationalOutcome;
      }
      continue;
    }

    const turtleOutcome = dispatchTurtleCommand(statement, environment);
    if (turtleOutcome !== NOT_A_TURTLE_COMMAND) {
      if (turtleOutcome) {
        return turtleOutcome;
      }
      continue;
    }

    if (isWaitCall(statement)) {
      const waitOutcome = executeWaitCall(
        statement as unknown as CallNode | ParenCallNode,
        environment,
      );
      if (waitOutcome) {
        return waitOutcome;
      }
      continue;
    }

    if (isWhenStatement(statement)) {
      const whenOutcome = executeWhenStatement(
        statement as ProfileStatementNode,
        environment,
      );
      if (whenOutcome) {
        return whenOutcome;
      }
      continue;
    }

    if (isEveryStatement(statement)) {
      const everyOutcome = executeEveryStatement(
        statement as ProfileStatementNode,
        environment,
      );
      if (everyOutcome) {
        return everyOutcome;
      }
      continue;
    }

    if (isOnKeyStatement(statement)) {
      const onKeyOutcome = executeOnKeyStatement(
        statement as ProfileStatementNode,
        environment,
      );
      if (onKeyOutcome) {
        return onKeyOutcome;
      }
      continue;
    }

    if (isOnClickStatement(statement)) {
      executeOnClickStatement(statement as ProfileStatementNode, environment);
      continue;
    }

    const soundOutcome = dispatchSoundCommand(statement, environment);
    if (soundOutcome !== NOT_A_SOUND_COMMAND) {
      if (soundOutcome) {
        return soundOutcome;
      }
      continue;
    }

    const profileOutcome = dispatchProfileStatement(statement, environment);
    if (profileOutcome !== NOT_A_PROFILE_STATEMENT) {
      if (profileOutcome) {
        return profileOutcome;
      }
      continue;
    }

    if (statement.kind === "Return") {
      if (!isSupportedArgument(statement.value, environment)) {
        continue;
      }
      const result = evaluate(statement.value, environment);
      if (!result.ok) {
        return halt(result.diagnostic);
      }
      environment.events.push({
        seq: environment.events.length,
        kind: "return",
        // Snapshotted inline (issue #495) rather than via an extracted helper — see
        // `runProcedureBody`'s `procedure-exit` push's comment: `executeStatements` is on the
        // same recursion-depth-checked call path, and an extracted helper here reproduced the
        // 600-deep `recursionDepthLimit: 1000` regression (`execution-budget.test.mjs`), so this
        // is the smallest correct fix instead.
        source_span: statement.source_span,
        payload: { value: snapshotValue(result.value) } satisfies ReturnPayload,
      });
      return {
        kind: "return",
        value: result.value,
        source_span: statement.source_span,
        keyword: statement.keyword,
      };
    }

    if (statement.kind === "Stop") {
      return { kind: "stop", source_span: statement.source_span };
    }

    if (statement.kind === "Throw") {
      if (!isSupportedArgument(statement.value, environment)) {
        continue;
      }
      const result = evaluate(statement.value, environment);
      if (!result.ok) {
        return halt(result.diagnostic);
      }
      const message =
        typeof result.value === "string"
          ? result.value
          : printedForm(result.value);
      return halt(runtimeDiag.userError(statement.source_span, message));
    }

    if (statement.kind === "If") {
      if (!isSupportedArgument(statement.condition, environment)) {
        continue;
      }
      const condition = evaluateCondition(
        statement.condition,
        environment,
        "if",
      );
      if (!condition.ok) {
        return halt(condition.diagnostic);
      }
      const branch = condition.value
        ? statement.thenBody.body
        : (statement.elseBody?.body ?? []);
      const signal = executeStatements(branch, environment);
      if (signal.kind !== "normal") {
        return signal;
      }
      continue;
    }

    if (statement.kind === "While") {
      if (!isSupportedArgument(statement.condition, environment)) {
        continue;
      }
      for (;;) {
        const limitDiagnostic = checkExecutionLimits(
          environment,
          statement.source_span,
        );
        if (limitDiagnostic) {
          return halt(limitDiagnostic);
        }
        const condition = evaluateCondition(
          statement.condition,
          environment,
          "while",
        );
        if (!condition.ok) {
          return halt(condition.diagnostic);
        }
        if (!condition.value) {
          break;
        }
        const signal = executeStatements(statement.body.body, environment);
        if (signal.kind !== "normal") {
          return signal;
        }
      }
      continue;
    }

    if (statement.kind === "Repeat") {
      if (!isSupportedArgument(statement.count, environment)) {
        continue;
      }
      const countResult = evaluate(statement.count, environment);
      if (!countResult.ok) {
        return halt(countResult.diagnostic);
      }
      const whole = requireWholeNumber(
        countResult.value,
        statement.count.source_span,
        "repeat",
      );
      if (!whole.ok) {
        return halt(whole.diagnostic);
      }
      if (whole.value < 0) {
        return halt(
          runtimeDiag.negativeCount(statement.count.source_span, {
            operation: "repeat",
            value: whole.value,
          }),
        );
      }
      for (let turn = 1; turn <= whole.value; turn++) {
        const limitDiagnostic = checkExecutionLimits(
          environment,
          statement.source_span,
        );
        if (limitDiagnostic) {
          return halt(limitDiagnostic);
        }
        environment.repeatTurns.push(turn);
        const signal = executeStatements(statement.body.body, environment);
        environment.repeatTurns.pop();
        if (signal.kind !== "normal") {
          return signal;
        }
      }
      continue;
    }

    if (statement.kind === "Forever") {
      let turn = 1;
      while (
        environment.foreverIterationLimit === undefined ||
        turn <= environment.foreverIterationLimit
      ) {
        const limitDiagnostic = checkExecutionLimits(
          environment,
          statement.source_span,
        );
        if (limitDiagnostic) {
          return halt(limitDiagnostic);
        }
        const signal = executeStatements(statement.body.body, environment);
        if (signal.kind !== "normal") {
          return signal;
        }
        turn++;
      }
      continue;
    }

    if (statement.kind === "ForIn") {
      if ("kind" in statement.binder) {
        const duplicate = findDuplicateBinderName(statement.binder);
        if (duplicate !== undefined) {
          return halt(
            runtimeDiag.duplicateBinder(duplicate.source_span, duplicate.name),
          );
        }
      }
      if (!isSupportedArgument(statement.iterable, environment)) {
        continue;
      }
      const iterableResult = evaluate(statement.iterable, environment);
      if (!iterableResult.ok) {
        return halt(iterableResult.diagnostic);
      }
      if (!Array.isArray(iterableResult.value)) {
        return halt(
          runtimeDiag.forInNotList(statement.iterable.source_span, {
            actual: typeNameOf(iterableResult.value),
            value: iterableResult.value,
          }),
        );
      }
      for (const element of iterableResult.value) {
        const limitDiagnostic = checkExecutionLimits(
          environment,
          statement.source_span,
        );
        if (limitDiagnostic) {
          return halt(limitDiagnostic);
        }
        const bound = bindElement(statement.binder, element);
        if (!bound.ok) {
          return halt(bound.diagnostic);
        }
        const signal = executeStatements(
          statement.body.body,
          pushLoopFrame(environment, bound.bindings),
        );
        if (signal.kind !== "normal") {
          return signal;
        }
      }
      continue;
    }

    if (statement.kind === "ForRange") {
      if (
        !isSupportedArgument(statement.from, environment) ||
        !isSupportedArgument(statement.to, environment) ||
        (statement.by !== undefined &&
          !isSupportedArgument(statement.by, environment))
      ) {
        continue;
      }
      const fromResult = evaluate(statement.from, environment);
      if (!fromResult.ok) {
        return halt(fromResult.diagnostic);
      }
      const from = requireNumber(
        fromResult.value,
        statement.from.source_span,
        "for",
      );
      if (!from.ok) {
        return halt(from.diagnostic);
      }
      const toResult = evaluate(statement.to, environment);
      if (!toResult.ok) {
        return halt(toResult.diagnostic);
      }
      const to = requireNumber(toResult.value, statement.to.source_span, "for");
      if (!to.ok) {
        return halt(to.diagnostic);
      }
      let step = 1;
      if (statement.by !== undefined) {
        const byResult = evaluate(statement.by, environment);
        if (!byResult.ok) {
          return halt(byResult.diagnostic);
        }
        const by = requireNumber(
          byResult.value,
          statement.by.source_span,
          "for",
        );
        if (!by.ok) {
          return halt(by.diagnostic);
        }
        if (by.value === 0) {
          return halt(runtimeDiag.forStepZero(statement.by.source_span));
        }
        step = by.value;
      }
      // Recompute each pass's value from `from` and the pass count (rather than repeatedly
      // adding `step` to a running total) so IEEE-754 rounding cannot drift the running value
      // away from its true multiple of `step` over many passes. A step whose exact decimal
      // value cannot be represented exactly in binary floating point (e.g. `0.1`) would
      // otherwise sometimes land a hair past `to` — silently dropping the inclusive endpoint
      // (`from 0 to 0.3 by 0.1` would stop at `0.2`, since the fourth running total is
      // `0.30000000000000004`, not `0.3`). The boundary comparison tolerates only a few ULPs of
      // `current`/`to` themselves (`Number.EPSILON` scaled to their own magnitude) — not a
      // fraction of `step` — so it absorbs that per-pass representation error without ALSO
      // admitting a pass that is genuinely beyond `to` (e.g. `from 0 to 0.9999999995 by 1` must
      // still run only once, at `0`).
      for (let turn = 0; ; turn += 1) {
        const current = from.value + turn * step;
        const epsilon =
          Number.EPSILON * Math.max(1, Math.abs(current), Math.abs(to.value));
        const withinBound =
          step > 0
            ? current <= to.value + epsilon
            : current >= to.value - epsilon;
        if (!withinBound) {
          break;
        }
        const limitDiagnostic = checkExecutionLimits(
          environment,
          statement.source_span,
        );
        if (limitDiagnostic) {
          return halt(limitDiagnostic);
        }
        const signal = executeStatements(
          statement.body.body,
          pushLoopFrame(
            environment,
            new Map([[statement.variable.name.toLowerCase(), current]]),
          ),
        );
        if (signal.kind !== "normal") {
          return signal;
        }
      }
    }
  }

  return NORMAL_SIGNAL;
}

/**
 * Default instruction-execution budget and procedure-call recursion-depth limit applied by
 * {@link createExecutionEnvironment} when a real `execute()` call's {@link ExecuteOptions} does
 * not override them (issue #102, `spec/execution-model.md:551-557`). `DEFAULT_RECURSION_DEPTH_LIMIT`
 * is the exact value this file previously hardcoded as `MAX_PROCEDURE_CALL_DEPTH` — only its name
 * and configurability changed, not the default behavior, so existing recursion-limit tests need
 * no update. `DEFAULT_INSTRUCTION_BUDGET` is generous enough that any ordinary, terminating
 * program — including one with tens of thousands of loop passes — completes without ever coming
 * close to it, while still being finite, so a `forever`/`while true [ ]` with no other exit halts
 * in bounded time even when the caller supplies no `signal` to cancel it explicitly.
 */
export const DEFAULT_RECURSION_DEPTH_LIMIT = 500;
export const DEFAULT_INSTRUCTION_BUDGET = 1_000_000;

/**
 * The highest procedure-call recursion depth the interpreter will honor regardless of what a
 * caller configures via {@link ExecuteOptions.recursionDepthLimit} — the reconciliation issue #726
 * requires between OpenLogo's *language-level* depth budget and the *host's* native call stack.
 *
 * OpenLogo's recursion-depth budget is a language limit; V8's call stack is a host limit, and each
 * OpenLogo procedure frame costs several native frames along the
 * `evaluate` → `evaluateCall` → `callProcedure` → `runProcedure` → `runProcedureBody` →
 * `executeStatements` chain. If a caller sets `recursionDepthLimit` higher than the host stack can
 * actually hold, the native stack overflows *first* and the learner gets a raw
 * `RangeError: Maximum call stack size exceeded` with no source span and no learner-facing meaning
 * — which `spec/error-model.md` (stable `ol-*` codes, always a span) and the team working
 * agreement §8 (a budget that keeps runaway programs *stable*) both forbid. So the configured
 * limit is **clamped** to this ceiling: the interpreter promises no depth it cannot deliver, and
 * the `ol-limit`/`recursion-depth` diagnostic reports the depth it actually enforced.
 *
 * The value is chosen with a **documented headroom margin**. Measured cold (worst-case, no JIT
 * warmup) on Node 22 — the `.nvmrc`/CI pin and the authoritative host for this repo — the real
 * interpreter overflows its default-stack recursion at roughly 800 OpenLogo frames, and that
 * figure drifts *down* as the evaluator gains features (every M5 slice adds frames to the hot
 * chain — the very drift that turned #722 into the trigger for this bug). Pinning the ceiling to
 * {@link DEFAULT_RECURSION_DEPTH_LIMIT} (500) keeps a comfortable ~40% margin below that cold
 * floor, so ordinary programs are unaffected (they never reach 500) and a future slice adding a
 * frame to the chain does not silently erode the guarantee. It is deliberately equal to the
 * default rather than higher: a caller *raising* the budget must not be able to push past what the
 * host can survive.
 *
 * This is a ceiling, not a guarantee the host can always honor it: a host with an unusually small
 * stack (a browser tab — V8 stacks there are typically smaller than Node's — or a
 * `--stack-size`-reduced Node) can still overflow below 500. That residual case is caught at the
 * `runProgram` boundary (see its escaped-`RangeError` guard) and likewise turned into an
 * `ol-limit`/`recursion-depth` diagnostic, so a raw host error can never escape to the caller.
 */
export const HOST_SAFE_RECURSION_DEPTH = DEFAULT_RECURSION_DEPTH_LIMIT;

/** {@link ExecuteOptions.learnerLevel}'s default when a caller does not supply one — the
 * first/movement level (`spec/educational-model.md`'s level table), the least-prior-knowledge
 * assumption when a caller does not track curriculum progression itself. */
export const DEFAULT_LEARNER_LEVEL: TutorLearnerLevel = "1";

/**
 * Resolve one of {@link ExecuteOptions}' two numeric limits, falling back to `fallback` for any
 * value that would not actually behave as a finite cap: `undefined` (omitted), `NaN`,
 * non-positive, or non-finite (`Infinity`/`-Infinity`). Issue #102's whole premise is that
 * `forever`/unbounded recursion are safe *only because* they are always budgeted — a caller
 * passing `instructionBudget: Infinity` (or `NaN`, which every `>` comparison against it treats
 * as automatically satisfied — never budget-exceeded) must not be able to silently disable that
 * guarantee. Falling back to the production default (rather than throwing) keeps a mistaken
 * caller's program merely generously bounded instead of unboundedly hung, without adding a new
 * `ol-*` diagnostic for what is a caller-side options-validation concern, not a language error.
 */
function resolvePositiveFiniteLimit(
  value: number | undefined,
  fallback: number,
): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/**
 * The recursion-depth limit `execute()` will *actually* enforce for a given
 * {@link ExecuteOptions.recursionDepthLimit} request — the single, observable definition of the
 * clamp. A requested limit is first normalised by {@link resolvePositiveFiniteLimit} (omitted /
 * `NaN` / non-positive / non-finite → {@link DEFAULT_RECURSION_DEPTH_LIMIT}) and then capped at
 * {@link HOST_SAFE_RECURSION_DEPTH}, because the interpreter's own depth counter must trip before
 * the host's native stack can overflow (issue #726).
 *
 * This makes the clamp a *readable contract* rather than a silent narrowing: a host or the studio
 * can call this to learn the effective ceiling before running, and a test locks it (requesting
 * `1000` yields `500`) so the next person to change {@link HOST_SAFE_RECURSION_DEPTH} has a failing
 * assertion telling them what capability they are altering. **A caller can no longer obtain
 * recursion deeper than {@link HOST_SAFE_RECURSION_DEPTH}** — that configurability is deliberately
 * removed here, since a limit the host cannot honour is a promise the implementation cannot keep;
 * the guard layer ({@link recoverFromNativeStackOverflow}) still protects any host whose stack is
 * smaller than the clamp.
 */
export function resolveEffectiveRecursionDepthLimit(
  requested: number | undefined,
): number {
  return Math.min(
    resolvePositiveFiniteLimit(requested, DEFAULT_RECURSION_DEPTH_LIMIT),
    HOST_SAFE_RECURSION_DEPTH,
  );
}

/**
 * Build a fresh execution environment for running `program` from the top: the root/global frame,
 * no active `repeat` turn, `program`'s whole-program {@link ProcedureRegistry} and
 * {@link StructRegistry} (collected by {@link collectProcedures}/{@link collectStructs} and passed
 * in by {@link runProgram}, which runs the struct phase-1 collision check first), an empty event
 * sink, `foreverIterationLimit` threaded through
 * unchanged, an empty `callDepth` stack ({@link runProcedure} checks and pushes/pops it), and
 * `callProcedure` wired to {@link callProcedureAsValue} — unlike
 * `evaluate.ts`'s bare `createEnvironment()` (whose `callProcedure` stub is intentionally
 * unreachable, for expression-only tests with no procedures in scope), this is the environment
 * every real statement/expression in `program` actually runs against. Issue #287 adds
 * `randomNumberGenerator`, the shared seeded `random`/`randomize` generator state, freshly seeded
 * per run ({@link createRandomNumberGeneratorState}'s own `Date.now()` fallback) so two separate
 * `execute()` calls are independent even before either program ever calls `randomize`.
 *
 * Issue #102: `options` supplies the three execution-safety gates `spec/execution-model.md:
 * 551-557` requires — `instructionBudget`/`recursionDepthLimit` fall back to
 * {@link DEFAULT_INSTRUCTION_BUDGET}/{@link DEFAULT_RECURSION_DEPTH_LIMIT} when omitted OR when
 * supplied but not a usable finite positive limit (see {@link resolvePositiveFiniteLimit} — a
 * caller cannot disable the safety gate by passing `Infinity`/`NaN`/a non-positive number);
 * `signal` is threaded through unchanged (`undefined` when the caller supplied none, which
 * `checkExecutionLimits` treats as "never cancelled"). `source` (issue #156) is `runProgram`'s own
 * `source` argument, threaded onto the environment so `executeAssign`'s `ol-not-a-place` guard can
 * slice the exact assignment-target surface text out of it. Issue #332 threads `program` itself
 * onto the environment (`TutorContext.program`, and the source of `hint`'s whole-program fallback
 * span via `program.source_span`) and a fresh `hintProgress` map per run, so the Educational
 * profile's `hint` progression (`spec/execution-model.md:641-652`) starts over — every target
 * begins at `"nudge"` — for each new `execute()` call. `tutorTemplate` resolves
 * `options?.tutorTemplates` to {@link defaultTutorTemplate} when omitted, and `learnerLevel`
 * resolves `options?.learnerLevel` to {@link DEFAULT_LEARNER_LEVEL} when omitted (the
 * M3-orchestrator's injectable-template ruling on issue #332).
 */
/**
 * Copy `hostInput` into a fresh array sorted by non-decreasing `tick`, returning a frozen empty
 * array when a caller supplies none (issue #686, slice I7). {@link dispatchDueHandlers} advances a
 * single forward cursor ({@link Environment.hostInputConsumed}) through this array at every
 * {@link yieldToEventLoop} checkpoint, so it MUST be tick-ordered for that cursor to enqueue each
 * entry exactly once; sorting here — once, at environment construction — lets a caller pass
 * host-input in any order. The sort is *stable* (Array.prototype.sort is spec-guaranteed stable), so
 * two entries scheduled at the same tick stay in caller-supplied order and therefore enqueue into
 * their pending queue in that order — the deterministic tie-break the same-tick dispatch order
 * relies on. A defensive copy so a caller's array is never mutated and the environment's view cannot
 * change after construction.
 */
function sortHostInputByTick(
  hostInput: readonly HostInputEvent[] | undefined,
): readonly HostInputEvent[] {
  if (hostInput === undefined || hostInput.length === 0) {
    return EMPTY_HOST_INPUT;
  }
  return [...hostInput].sort((left, right) => left.tick - right.tick);
}

/** The shared frozen empty host-input array every normal headless run gets (issue #686): no key,
 * click, or named event is ever pending, so the I5/I6 never-fires behavior holds because nothing was
 * queued. Frozen so an accidental push can never leak input into an unrelated run. */
const EMPTY_HOST_INPUT: readonly HostInputEvent[] = Object.freeze([]);

function createExecutionEnvironment(
  program: ProgramNode,
  procedures: ProcedureRegistry,
  structs: StructRegistry,
  foreverIterationLimit: number | undefined,
  options: ExecuteOptions | undefined,
  source: string,
): Environment {
  const turtle = createDefaultTurtleState();
  return {
    frames: [new Map()],
    repeatTurns: [],
    procedures,
    structs,
    events: [],
    foreverIterationLimit,
    callDepth: [],
    recursionDepthLimit: resolveEffectiveRecursionDepthLimit(
      options?.recursionDepthLimit,
    ),
    lastCallSpan: { span: null },
    instructionBudget: resolvePositiveFiniteLimit(
      options?.instructionBudget,
      DEFAULT_INSTRUCTION_BUDGET,
    ),
    instructionCount: { count: 0 },
    signal: options?.signal,
    turtle,
    turtleWorld: new TurtleWorld(),
    addressing: createTurtleAddressing(turtle),
    randomNumberGenerator: createRandomNumberGeneratorState(),
    tickClock: createTickClock(),
    sound: createSoundState(),
    eventHandlers: createEventHandlerRegistry(),
    hostInput: sortHostInputByTick(options?.hostInput),
    hostInputConsumed: { count: 0 },
    source,
    program,
    hintProgress: new Map(),
    tutorTemplate: options?.tutorTemplates ?? defaultTutorTemplate,
    learnerLevel: options?.learnerLevel ?? DEFAULT_LEARNER_LEVEL,
    callProcedure: callProcedureAsValue,
  };
}

/**
 * Whether `error` is a genuine native stack-overflow, across every JS engine OpenLogo runs on
 * (Node and the studio's browser targets — Chromium, Firefox, Safari; see
 * `docs/adr/0013-studio-editor-component.md`). Each engine reserves a distinct, stable signature for
 * stack exhaustion, and *only* for that condition:
 * - V8 (Node, Chromium) and JavaScriptCore (Safari): a `RangeError` whose message is
 *   `Maximum call stack size exceeded`.
 * - SpiderMonkey (Firefox): an `InternalError` whose message is `too much recursion` (its class is
 *   *not* `RangeError`, so an `instanceof RangeError` gate would let a real Firefox overflow escape
 *   raw — reintroducing issue #726 on that target).
 *
 * Matching these known signatures (rather than merely `instanceof RangeError`) is what keeps
 * {@link recoverFromNativeStackOverflow} from misclassifying an *unrelated* error — e.g. a
 * `RangeError` thrown by an injected `tutorTemplates` callback or an option getter — as a
 * learner-facing recursion overflow; those must surface as the integration bugs they are. The
 * property access is guarded defensively so a thrown non-`Error` value (or one with no string
 * `message`) can never itself throw here.
 */
function isNativeStackOverflow(error: unknown): boolean {
  if (!(error instanceof Error) || typeof error.message !== "string") {
    return false;
  }
  return (
    error.message === "Maximum call stack size exceeded" ||
    error.message === "too much recursion"
  );
}

/**
 * Convert an error that escaped the `parse` → execute pipeline into an {@link ExecuteResult}, per
 * issue #726's first acceptance criterion: recursion (or any nesting) that exceeds what the host
 * stack can support must stop with an `ol-*` diagnostic carrying a source span, never a raw
 * `RangeError` reaching the caller.
 *
 * The interpreter clamps `recursionDepthLimit` to {@link HOST_SAFE_RECURSION_DEPTH} so its own
 * depth counter normally trips before V8's native stack does. But two things can still overflow the
 * native stack before that counter fires: a host with an unusually small stack — a browser tab (V8
 * stacks there are typically smaller than Node's) or a `--stack-size`-reduced Node — recursing
 * below the ceiling, and deeply nested *expression* evaluation or *parsing* (which the depth
 * counter does not bound at all). A native stack overflow surfaces with an engine-specific
 * signature (`RangeError: Maximum call stack size exceeded` on V8/JSC, `InternalError: too much
 * recursion` on Firefox), matched by {@link isNativeStackOverflow}. So *only* a genuine overflow is
 * rewritten into the `ol-limit`/`recursion-depth` diagnostic — carrying `fallbackSpan` (the deepest
 * procedure call reached, or the whole-program/whole-source span when the overflow preceded any
 * call). The partial event trace collected so far is preserved (empty when the overflow happened
 * during parsing), matching how a language-level `halt` returns its events. Any other error —
 * including an unrelated `RangeError` thrown by an injected callback such as `tutorTemplates`, which
 * must surface as the integration bug it is rather than a bogus learner-facing recursion diagnostic
 * — is a genuine bug and is rethrown unchanged.
 *
 * Extracted into its own function (rather than inlined in the `catch`) so both arms — the overflow
 * rewrite and the rethrow of an unrelated error — are directly and deterministically unit testable,
 * and so a caller can supply whichever span best explains the overflow.
 */
function recoverFromNativeStackOverflow(
  error: unknown,
  fallbackSpan: SourceSpan,
  events: readonly TraceEvent[],
  recursionDepthLimit: number,
): ExecuteResult {
  if (isNativeStackOverflow(error)) {
    return {
      events: [...events],
      diagnostics: [
        runtimeDiag.recursionLimit(fallbackSpan, recursionDepthLimit),
      ],
    };
  }
  throw error;
}

/**
 * **Test-only.** Direct handle on {@link recoverFromNativeStackOverflow} so both of its arms — the
 * `RangeError` → `ol-limit` rewrite and the rethrow of any other error — are covered
 * deterministically, without having to provoke a real, host-dependent native stack overflow inside
 * the test process. Never re-exported by `index.ts`; reachable only by this package's own tests
 * importing this module by relative path (see the header comment and
 * {@link executeWithForeverIterationLimitForTests}).
 */
export function recoverFromNativeStackOverflowForTests(
  error: unknown,
  fallbackSpan: SourceSpan,
  events: readonly TraceEvent[],
  recursionDepthLimit: number,
): ExecuteResult {
  return recoverFromNativeStackOverflow(
    error,
    fallbackSpan,
    events,
    recursionDepthLimit,
  );
}

/**
 * A {@link SourceSpan} covering `source` in its entirety (line 1, column 1 to just past the last
 * character), used as the {@link recoverFromNativeStackOverflow} fallback span when a native stack
 * overflow happens during parsing — before any AST node or procedure call exists to point at. It
 * still gives the learner a document-anchored diagnostic rather than a bare host trace.
 */
function wholeSourceSpan(source: string, document: string): SourceSpan {
  let line = 1;
  let column = 1;
  for (const character of source) {
    if (character === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return makeSpan(document, [1, 1], [line, column]);
}

/**
 * Parse `source` and run it, sharing {@link execute}'s and
 * {@link executeWithForeverIterationLimitForTests}'s logic. `foreverIterationLimit` is
 * `undefined` for every real `execute()` call — see `index.ts`'s `execute()` doc comment — so a
 * `forever` loop never stops on its OWN account there; it is still budgeted and cancellable via
 * `options` (issue #102). Only the test-only entry point below ever supplies
 * `foreverIterationLimit`.
 *
 * A `"return"`/`"stop"` signal that escapes {@link executeStatements} unconsumed means it was
 * never inside any procedure ({@link runProcedure} always consumes its own body's signal before
 * it reaches here) — this is `ol-return-outside-proc`/`ol-stop-outside-proc` (issue #97), the
 * runtime's own copy of the semantic checker's rule of the same name
 * (`packages/parser/src/checker-control-flow.ts`, issue #114), at `stage: "runtime"` since
 * `execute()` runs `parse()` only, never `check()`.
 */
export function runProgram(
  source: string,
  document: string,
  foreverIterationLimit: number | undefined,
  options?: ExecuteOptions,
): ExecuteResult {
  // Issue #726: the whole `parse` → execute pipeline runs inside one guard. On a host whose native
  // stack is smaller than `HOST_SAFE_RECURSION_DEPTH` assumes, or for deeply nested expressions /
  // parsing (which the recursion-depth counter does not bound), V8 can still overflow with a raw
  // `RangeError`. That must never escape to the caller — `spec/error-model.md` requires a stable
  // `ol-*` code with a source span. `environment` is captured as it becomes available so the guard
  // can point at the deepest procedure call reached; before it exists (an overflow during parsing)
  // the guard falls back to a whole-source span.
  let environment: Environment | undefined;
  try {
    const { ast: program, diagnostics } = parse(source, document);
    if (diagnostics.length > 0) {
      return { events: [], diagnostics };
    }

    const procedures = collectProcedures(program);
    const structResult = collectStructs(program, procedures);
    if (!structResult.ok) {
      return { events: [], diagnostics: [structResult.diagnostic] };
    }

    environment = createExecutionEnvironment(
      program,
      procedures,
      structResult.structs,
      foreverIterationLimit,
      options,
      source,
    );
    const signal = executeStatements(program.body, environment);
    const diagnostic =
      signal.kind === "halt"
        ? signal.diagnostic
        : signal.kind === "return"
          ? runtimeDiag.returnOutsideProc(signal.source_span, signal.keyword)
          : signal.kind === "stop"
            ? runtimeDiag.stopOutsideProc(signal.source_span)
            : undefined;
    return {
      events: environment.events,
      diagnostics: diagnostic ? [diagnostic] : [],
    };
  } catch (error) {
    return recoverFromNativeStackOverflow(
      error,
      environment?.lastCallSpan.span ?? wholeSourceSpan(source, document),
      environment?.events ?? [],
      environment?.recursionDepthLimit ?? HOST_SAFE_RECURSION_DEPTH,
    );
  }
}

/**
 * **Test-only.** Identical to `execute()` except a `forever` loop in `source` stops on its own
 * (with no diagnostic) after `foreverIterationLimit` passes, so a unit test can exercise
 * `forever`'s loop mechanics without hanging the test process. Deliberately lives in this
 * module — never re-exported by `index.ts` — rather than as an optional parameter on `execute()`,
 * so the bound can never leak into a real caller's `execute()` invocation and is not reachable via
 * the `"@openlogo/runtime"` package specifier at all (see this file's header comment). Runs with
 * the same default instruction budget/recursion-depth limit as a real `execute()` call (issue
 * #102) — `foreverIterationLimit` is a distinct, additional test-only cap that stops a `forever`
 * long before it could ever reach the production budget, so the two mechanisms do not interact
 * in this package's own test suite. Only this package's own tests, importing this file directly
 * by relative path, ever call it.
 */
export function executeWithForeverIterationLimitForTests(
  source: string,
  document: string,
  foreverIterationLimit: number,
): ExecuteResult {
  return runProgram(source, document, foreverIterationLimit, undefined);
}

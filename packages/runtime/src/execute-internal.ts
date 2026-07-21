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
  BackgroundChangePayload,
  ClearPayload,
  ColorChangePayload,
  Diagnostic,
  DrawSegmentPayload,
  FillPayload,
  MovePayload,
  OLValue,
  PenChangePayload,
  Point,
  PrintPayload,
  ProcedureEnterPayload,
  ProcedureExitPayload,
  ReturnPayload,
  ShapeChangePayload,
  SourceSpan,
  StampPayload,
  TurnPayload,
  TutorCommand,
  TutorHintStage,
  TutorOutputPayload,
  VisibilityChangePayload,
  WidthChangePayload,
} from "@openlogo/core";
import { typeNameOf } from "@openlogo/core";
import type {
  CallNode,
  ExpressionNode,
  ParenCallNode,
  ProcedureDefNode,
  ProgramNode,
  StatementNode,
} from "@openlogo/parser";
import { parse, walk } from "@openlogo/parser";
import { normalizeColor } from "./color.js";
import { isRecognizedShape, normalizeShape } from "./shape.js";
import {
  bindElement,
  checkExecutionLimits,
  createDefaultTurtleState,
  evaluate,
  executeAssign,
  findDuplicateBinderName,
  isSupportedExpression,
  printedForm,
  pushLoopFrame,
  requireNumber,
  requireWholeNumber,
  type Environment,
  type EvalResult,
  type Frame,
  type ProcedureRegistry,
} from "./evaluate.js";
import { runtimeDiag } from "./errors.js";
import type {
  ExecuteOptions,
  ExecuteResult,
  InstructionPayload,
} from "./index.js";
import {
  createRandomNumberGeneratorState,
  seedFromText,
} from "./random-number-generator.js";
import { normalizeHeading } from "./turtle-math.js";

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
  if (!isSupportedExpression(arg, environment.procedures)) {
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
  if (!isSupportedExpression(arg, environment.procedures)) {
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
 */
function clearScreen(
  environment: Environment,
  mode: "clear_screen" | "clean",
  source_span: SourceSpan,
): void {
  const { turtle } = environment;
  if (mode === "clear_screen") {
    turtle.x = 0;
    turtle.y = 0;
    turtle.heading = 0;
  }
  environment.events.push({
    seq: environment.events.length,
    kind: "clear",
    source_span,
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
  if (!isSupportedExpression(arg, environment.procedures)) {
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
  if (!isSupportedExpression(arg, environment.procedures)) {
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
  if (!isSupportedExpression(arg, environment.procedures)) {
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
  if (!isSupportedExpression(arg, environment.procedures)) {
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
    !isSupportedExpression(xArg, environment.procedures) ||
    !isSupportedExpression(yArg, environment.procedures)
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
  if (!isSupportedExpression(arg, environment.procedures)) {
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
 * Sentinel `dispatchTurtleCommand` returns when `statement` isn't any recognized turtle command,
 * so {@link executeStatements} can fall through to its other statement-kind checks. Distinct from
 * `undefined`, which `dispatchTurtleCommand` returns when a turtle command ran successfully (the
 * same "handled, continue" meaning every `executeTurtle*Call` helper already uses).
 */
const NOT_A_TURTLE_COMMAND = Symbol("not-a-turtle-command");

/**
 * Single entry point {@link executeStatements} calls to try every turtle command in one step.
 * Each new turtle command (`#202`/`#204`/`#207`/`#210`, …) should add its `isTurtleXCall`/
 * `executeTurtleXCall` pair and one more branch **here**, not in `executeStatements` itself
 * (issue #209 added the `set_width` branch this way, following issue #208's `set_color`/
 * `set_background` branches):
 * `executeStatements` recurses once per procedure call (via `runProcedureBody`/`runProcedure`),
 * so every local variable/branch added directly to its body grows *every* stack frame in a deep
 * recursive program. Growing this dispatcher instead keeps `executeStatements`'s own frame size
 * fixed regardless of how many turtle commands exist — confirmed necessary when adding the
 * `pen_up`/`pen_down` branch here (issue #206) pushed a 600-deep `recursionDepthLimit: 1000`
 * regression test (`execution-budget.test.mjs`) over the native call-stack limit until the three
 * previously-inline branches (`forward`/`back`, `left`/`right`, `pen_up`/`pen_down`) were
 * consolidated into this single call.
 */
function dispatchTurtleCommand(
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
  if (isTurtleShapeCall(statement)) {
    return executeTurtleShapeCall(
      statement as unknown as CallNode | ParenCallNode,
      environment,
    );
  }
  return NOT_A_TURTLE_COMMAND;
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
  if (!isSupportedExpression(arg, environment.procedures)) {
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
    payload: { values: [result.value] } satisfies PrintPayload,
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
  if (!isSupportedExpression(seedNode, environment.procedures)) {
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
 * The `target-source-span` a baseline meta-command reports on, resolved deterministically from
 * runtime-available state alone (`spec/educational-model.md`'s baseline: "the parsed program,
 * source spans, trace events, diagnostics, and known command metadata") — never from edu's
 * curriculum knowledge, which this package must not import (issue #332's architecture
 * constraint).
 *
 * By the time {@link executeStatements} dispatches a meta-command statement, it has ALREADY
 * pushed that statement's own unconditional `instruction` event onto `environment.events` (see
 * the top of its loop) — so the meta-command's own instruction event is always the LAST entry.
 * Scanning backward from just before it, the first event that is itself neither a START event
 * (`instruction` or `procedure-enter` — `packages/core/src/events.ts`'s `OL_EVENT_KINDS` groups
 * these as "emitted before their effect") nor a `tutor-output` is the last real EFFECT of
 * whatever executed before the meta-command, in real execution order (flattened across any
 * nested loop/procedure calls sharing this same `environment.events` array). Both kinds of start
 * event carry no new information beyond the effect that follows them — `procedure-enter` in
 * particular must be skipped too, or a meta-command that is the very FIRST statement inside a
 * procedure body would wrongly resolve its enclosing `procedure-enter` (the call that invoked
 * it) as "the last thing done", rather than correctly falling back to `environment.programSpan`
 * (see `hint`'s branch in {@link executeEducationalMetaCommand}). Skipping past any
 * `tutor-output` events is what keeps a run of
 * CONSECUTIVE meta-commands (e.g. `hint` called three times in a row with nothing in between)
 * all resolving to the SAME target — the last real action — rather than each one targeting the
 * previous meta-command's own call site. Without that skip, `hint`'s progression
 * (`spec/execution-model.md:641-652`, "for the SAME target") could never observe two calls
 * sharing one target, since every call's own instruction event would differ. That prior effect
 * event's own `source_span` is the most specific deterministic "what was just done" the runtime
 * can point to, so it is the resolved target. `undefined` when no such event exists (the
 * meta-command — possibly preceded only by other meta-commands, or nested only inside
 * `procedure-enter` start events — is effectively the first real thing executed).
 */
function resolveTutorTargetSpan(
  environment: Environment,
): SourceSpan | undefined {
  const events = environment.events;
  // events[length - 1] is this meta-command's own just-pushed `instruction` event; scan strictly
  // before it.
  for (let index = events.length - 2; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event !== undefined &&
      event.kind !== "instruction" &&
      event.kind !== "procedure-enter" &&
      event.kind !== "tutor-output"
    ) {
      return event.source_span;
    }
  }
  return undefined;
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

const HINT_STAGE_ORDER: readonly TutorHintStage[] = [
  "nudge",
  "concept",
  "partial",
  "last-resort",
];

/**
 * Advances (and records) the progression stage for a `hint` targeting `span` — the first `hint`
 * for a given target starts at `"nudge"`; every later `hint` for that SAME target escalates one
 * stage, capping at `"last-resort"`, which then repeats rather than ever producing a full
 * solution (`spec/execution-model.md:640-652`). Mutates `environment.hintProgress` in place, so
 * every environment sharing that same map (every nested procedure-call/loop-body environment
 * spread from the top-level one) observes later calls' escalation — matching the
 * `randomNumberGenerator`/`turtle` shared-mutable-box convention used throughout this file.
 */
function nextHintStage(
  environment: Environment,
  span: SourceSpan,
): TutorHintStage {
  const key = hintTargetKey(span);
  const previous = environment.hintProgress.get(key);
  const previousIndex = previous ? HINT_STAGE_ORDER.indexOf(previous) : -1;
  const nextIndex = Math.min(previousIndex + 1, HINT_STAGE_ORDER.length - 1);
  const stage = HINT_STAGE_ORDER[nextIndex] as TutorHintStage;
  environment.hintProgress.set(key, stage);
  return stage;
}

/**
 * Deterministic, non-curriculum `segments` text for each baseline meta-command (and, for `hint`,
 * each progressive stage) — satisfies {@link TutorOutputSegments}'s non-empty-tuple requirement
 * with fixed, generic boilerplate rather than any target-derived pedagogy. Writing actual
 * learner-facing curriculum prose from the target statement's real semantics is @openlogo/edu's
 * job (issues #333-#335 — the A3/A4/A5 slices this deliberately leaves untouched); this runtime
 * only has to produce SOME deterministic, non-empty, non-solution-revealing text so the
 * `tutor-output` event it emits conforms to A0's wire contract.
 */
function tutorOutputSegments(
  command: TutorCommand,
  hintStage: TutorHintStage | undefined,
  hasTarget: boolean,
): readonly [string, ...string[]] {
  const scope = hasTarget ? "the most recent instruction" : "your program";
  switch (command) {
    case "explain":
      return [`Here is what ${scope} does.`];
    case "why":
      return [`Here is why ${scope} behaves the way it does.`];
    case "debug":
      return [`Here is what to check about ${scope}.`];
    case "hint": {
      switch (hintStage) {
        case "concept":
          return [`Think about the concept behind ${scope}.`];
        case "partial":
          return [`Here is a partial idea to move ${scope} forward.`];
        case "last-resort":
          return [
            `Here is a strong nudge for ${scope} — try it yourself first.`,
          ];
        default:
          return [`Here is a small nudge about ${scope}.`];
      }
    }
  }
}

/**
 * Executes one of the four Educational baseline meta-commands once
 * {@link isEducationalMetaCommandCall} has confirmed the statement. Two responsibilities, per the
 * A1 reviewer's flagged gap (A1 reuses the ordinary zero-arity `Call`/`ParenCall` shape with no
 * static arity check, matching Turtle/Data precedent, so nothing before this point ever rejects
 * `(explain 1)`):
 *
 * 1. Reject any nonzero-input parenthesized form — `(explain 1)`, `(hint "x" "y")`, etc. — at
 *    runtime with the stable `ol-too-many-inputs` diagnostic (reusing
 *    {@link runtimeDiag.tooManyInputs} with `expected: 0`, exactly like every other arity
 *    violation in this file).
 * 2. Otherwise, gather the deterministic runtime context (the resolved target span, and for
 *    `hint`, the progression stage) and emit exactly one `tutor-output` event whose payload
 *    matches A0's discriminated {@link TutorOutputPayload} union.
 *
 * Never emits the `diagnostic_code` (`why`/`debug`'s diagnostic arm): a runtime diagnostic halts
 * `executeStatements` immediately and terminally (only one ever surfaces per `execute()` call),
 * so a meta-command can never observe "the" diagnostic from its OWN run — there is no diagnostic
 * left standing by the time this function could report on it. Always the non-diagnostic
 * ("Program") arm.
 */
function executeEducationalMetaCommand(
  statement: CallNode | ParenCallNode,
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

  if (command === "hint") {
    const rawTargetSpan = resolveTutorTargetSpan(environment);
    const targetSpan = rawTargetSpan ?? environment.programSpan;
    const stage = nextHintStage(environment, targetSpan);
    environment.events.push({
      seq: environment.events.length,
      kind: "tutor-output",
      source_span: statement.source_span,
      payload: {
        command: "hint",
        stage,
        target_source_span: targetSpan,
        segments: tutorOutputSegments(
          "hint",
          stage,
          rawTargetSpan !== undefined,
        ),
      } satisfies TutorOutputPayload,
    });
    return undefined;
  }

  const targetSpan = resolveTutorTargetSpan(environment);
  const segments = tutorOutputSegments(
    command,
    undefined,
    targetSpan !== undefined,
  );
  const payload: TutorOutputPayload =
    command === "explain"
      ? targetSpan === undefined
        ? { command: "explain", segments }
        : { command: "explain", segments, target_source_span: targetSpan }
      : command === "why"
        ? targetSpan === undefined
          ? { command: "why", segments }
          : { command: "why", segments, target_source_span: targetSpan }
        : targetSpan === undefined
          ? { command: "debug", segments }
          : { command: "debug", segments, target_source_span: targetSpan };
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
 * as a new one.
 */
function dispatchShowRandomizeOrEducationalCommand(
  statement: StatementNode,
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
    return executeEducationalMetaCommand(statement, environment);
  }
  return NOT_A_SHOW_RANDOMIZE_OR_EDUCATIONAL_COMMAND;
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
      calleeFrame.set(param.name.name, value);
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
    calleeFrame.set(param.name.name, defaultResult.value);
    boundArgs.push(defaultResult.value);
  }

  environment.events.push({
    seq: environment.events.length,
    kind: "procedure-enter",
    source_span: node.source_span,
    payload: {
      name: def.name.name,
      args: boundArgs,
    } satisfies ProcedureEnterPayload,
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
    payload: { name: def.name.name, result } satisfies ProcedureExitPayload,
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
  if (
    !call.args.every((arg) =>
      isSupportedExpression(arg, environment.procedures),
    )
  ) {
    return NORMAL_SIGNAL;
  }
  const outcome = runProcedure(call, environment);
  if (!outcome.ok) {
    return halt(outcome.diagnostic);
  }
  return NORMAL_SIGNAL;
}

function executeStatements(
  statements: readonly StatementNode[],
  environment: Environment,
): ExecSignal {
  for (const statement of statements) {
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

    if (statement.kind === "Assign") {
      const result = executeAssign(statement, environment);
      if (!result.ok) {
        return halt(result.diagnostic);
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
      if (
        statement.args.every((arg) =>
          isSupportedExpression(arg, environment.procedures),
        )
      ) {
        const values: OLValue[] = [];
        let failure: Diagnostic | undefined;
        for (const arg of statement.args) {
          const result = evaluate(arg, environment);
          if (!result.ok) {
            failure = result.diagnostic;
            break;
          }
          values.push(result.value);
        }
        if (failure) {
          return halt(failure);
        }
        environment.events.push({
          seq: environment.events.length,
          kind: "print",
          source_span: statement.source_span,
          payload: { values } satisfies PrintPayload,
        });
      }
      continue;
    }

    const showRandomizeOrEducationalOutcome =
      dispatchShowRandomizeOrEducationalCommand(statement, environment);
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

    if (statement.kind === "Return") {
      if (!isSupportedExpression(statement.value, environment.procedures)) {
        continue;
      }
      const result = evaluate(statement.value, environment);
      if (!result.ok) {
        return halt(result.diagnostic);
      }
      environment.events.push({
        seq: environment.events.length,
        kind: "return",
        source_span: statement.source_span,
        payload: { value: result.value } satisfies ReturnPayload,
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
      if (!isSupportedExpression(statement.value, environment.procedures)) {
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
      if (!isSupportedExpression(statement.condition, environment.procedures)) {
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
      if (!isSupportedExpression(statement.condition, environment.procedures)) {
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
      if (!isSupportedExpression(statement.count, environment.procedures)) {
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
      if (!isSupportedExpression(statement.iterable, environment.procedures)) {
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
        !isSupportedExpression(statement.from, environment.procedures) ||
        !isSupportedExpression(statement.to, environment.procedures) ||
        (statement.by !== undefined &&
          !isSupportedExpression(statement.by, environment.procedures))
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
            new Map([[statement.variable.name, current]]),
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
 * Build a fresh execution environment for running `program` from the top: the root/global frame,
 * no active `repeat` turn, `program`'s whole-program {@link ProcedureRegistry}
 * ({@link collectProcedures}), an empty event sink, `foreverIterationLimit` threaded through
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
 * slice the exact assignment-target surface text out of it. Issue #332 adds `programSpan`
 * (`program`'s own `source_span`, the whole-program fallback `hint` falls back to) and a fresh
 * `hintProgress` map per run, so the Educational profile's `hint` progression
 * (`spec/execution-model.md:641-652`) starts over — every target begins at `"nudge"` — for each
 * new `execute()` call.
 */
function createExecutionEnvironment(
  program: ProgramNode,
  foreverIterationLimit: number | undefined,
  options: ExecuteOptions | undefined,
  source: string,
): Environment {
  return {
    frames: [new Map()],
    repeatTurns: [],
    procedures: collectProcedures(program),
    events: [],
    foreverIterationLimit,
    callDepth: [],
    recursionDepthLimit: resolvePositiveFiniteLimit(
      options?.recursionDepthLimit,
      DEFAULT_RECURSION_DEPTH_LIMIT,
    ),
    instructionBudget: resolvePositiveFiniteLimit(
      options?.instructionBudget,
      DEFAULT_INSTRUCTION_BUDGET,
    ),
    instructionCount: { count: 0 },
    signal: options?.signal,
    turtle: createDefaultTurtleState(),
    randomNumberGenerator: createRandomNumberGeneratorState(),
    source,
    programSpan: program.source_span,
    hintProgress: new Map(),
    callProcedure: callProcedureAsValue,
  };
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
  const { ast: program, diagnostics } = parse(source, document);
  if (diagnostics.length > 0) {
    return { events: [], diagnostics };
  }

  const environment = createExecutionEnvironment(
    program,
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

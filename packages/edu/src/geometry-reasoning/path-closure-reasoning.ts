/**
 * Deterministic closure reasoning over an *arbitrary* turtle path's trace events — the
 * misconception-detection primitive (`.github/skills/geometry-teacher/geometry-reasoning/SKILL.md`).
 * Unlike the per-shape reasoning modules (`polygon-reasoning.ts`, etc.), which compute their facts
 * from the shape's own parameters, this module reads the `move`/`turn` events a program already
 * emitted (`@openlogo/core`'s trace/event contract — no new event kind is added here) and folds
 * them into both a positional and a heading verdict, so it can flag a path that never returns to
 * its start position and heading as a **structured signal**, never a thrown runtime error.
 *
 * Spec closure (`spec/geometry-module.md:65,184`) requires the turtle to return to **both** its
 * start position **and** its start heading — a turn total that is a multiple of `360` is
 * necessary but not sufficient (a bare `forward 100` never turns at all, yet plainly does not
 * close). `headingCloses`/`positionCloses`/`closes` below are each computed straight from the
 * trace's own absolute positions and headings (`move.to`/`move.heading`, `turn.to`), so — unlike
 * `turnTotal` below — they never depend on reconstructing a turn's direction from `{from, to}`
 * alone and are correct for paths that turn left, right, or both.
 */

import type {
  MovePayload,
  Point,
  TraceEvent,
  TurnPayload,
} from "@openlogo/core";
import { clockwiseTurnDelta, isMultipleOf360 } from "./degree-math.js";
import type { ClosureMisconceptionSignal } from "./types.js";

/** How close a final position may sit to the start position and still count as "closes" —
 * mirrors `degree-math.ts`'s `CLOSURE_TOLERANCE_DEGREES`, absorbing the same floating-point
 * rounding the spec calls out for every derived shape. */
const POSITION_CLOSURE_TOLERANCE = 1e-6;

/** Structured reasoning about whether a turtle path closes, folded from its trace events. */
export interface TurtlePathClosureReasoning {
  readonly concept: "turtle-path-closure";
  /** The sum of every `turn` event's reconstructed clockwise delta, in emission order. Every
   * geometry-stdlib shape (`polygon`, `star`, `circle`) only ever turns `right`, so this matches
   * their own exterior-angle formulas exactly; a single turn event of more than 180 degrees the
   * *other* direction cannot be told apart from its clockwise equivalent by `{from, to}` alone —
   * `headingCloses`/`closes` below do not rely on this reconstruction, so that ambiguity can
   * never cause a false closure verdict. */
  readonly turnTotal: number;
  /** How many `turn` events the path contains. */
  readonly turnCount: number;
  /** The reconstructed clockwise delta of every `turn` event, in emission order — e.g. a
   * five-sided polygon's `[72, 72, 72, 72, 72]`. Exposed so a caller can inspect the turn-by-turn
   * shape of a path, not just its total. */
  readonly headingDeltas: readonly number[];
  /** The position of the first `move` event's `from` (or `[0, 0]` if the path never moves). */
  readonly startPosition: Point;
  /** The position of the last `move` event's `to` (equal to `startPosition` if the path never
   * moves). */
  readonly finalPosition: Point;
  /** Euclidean distance between `startPosition` and `finalPosition`. */
  readonly displacement: number;
  /** The heading before the path's first `move`/`turn` event (or `0` if the path has neither). */
  readonly startHeading: number;
  /** The heading after the path's last `move`/`turn` event (equal to `startHeading` if the path
   * has neither). */
  readonly finalHeading: number;
  /** Whether `finalHeading` returns to `startHeading` (a whole multiple of `360` apart),
   * computed directly from the trace's absolute headings — never from `turnTotal`. */
  readonly headingCloses: boolean;
  /** Whether `finalPosition` returns to `startPosition`, within {@link POSITION_CLOSURE_TOLERANCE}. */
  readonly positionCloses: boolean;
  /** `headingCloses && positionCloses` — spec closure requires both (`spec/geometry-module.md`'s
   * "the turtle returns to its starting position and original heading"). */
  readonly closes: boolean;
  /** Present only when `closes` is `false`: a structured, stable-id misconception signal a
   * caller (`@ai-tutor`, `@openlogo/studio`) can phrase without this module ever emitting prose
   * or throwing. */
  readonly misconception?: ClosureMisconceptionSignal;
}

/**
 * Folds every `move`/`turn` event in `events` (typically `@openlogo/runtime`'s `execute(source,
 * document).events`) into a positional and heading closure verdict. A path with no `move`/`turn`
 * events at all is trivially closed (it never moved away from `[0, 0]` or turned away from
 * heading `0`) — the same way a bare `forward 100` neither turns nor closes a shape it never
 * attempted to draw, but (unlike before) is now correctly reported as `closes: false` because it
 * *does* displace the turtle from its start position.
 */
export function analyzeTurtlePathClosure(
  events: readonly TraceEvent[],
): TurtlePathClosureReasoning {
  let startPosition: Point | undefined;
  let finalPosition: Point | undefined;
  let startHeading: number | undefined;
  let finalHeading: number | undefined;
  const headingDeltas: number[] = [];

  for (const event of events) {
    if (event.kind === "move") {
      const { from, to, heading } = event.payload as MovePayload;
      startPosition ??= from;
      finalPosition = to;
      startHeading ??= heading;
      finalHeading = heading;
    } else if (event.kind === "turn") {
      const { from, to } = event.payload as TurnPayload;
      startHeading ??= from;
      finalHeading = to;
      headingDeltas.push(clockwiseTurnDelta(from, to));
    }
  }

  const resolvedStartPosition: Point = startPosition ?? [0, 0];
  const resolvedFinalPosition: Point = finalPosition ?? resolvedStartPosition;
  const resolvedStartHeading = startHeading ?? 0;
  const resolvedFinalHeading = finalHeading ?? resolvedStartHeading;

  const turnTotal = headingDeltas.reduce((sum, delta) => sum + delta, 0);
  const displacement = Math.hypot(
    resolvedFinalPosition[0] - resolvedStartPosition[0],
    resolvedFinalPosition[1] - resolvedStartPosition[1],
  );
  const headingCloses = isMultipleOf360(
    resolvedFinalHeading - resolvedStartHeading,
  );
  const positionCloses = displacement < POSITION_CLOSURE_TOLERANCE;
  const closes = headingCloses && positionCloses;

  return {
    concept: "turtle-path-closure",
    turnTotal,
    turnCount: headingDeltas.length,
    headingDeltas,
    startPosition: resolvedStartPosition,
    finalPosition: resolvedFinalPosition,
    displacement,
    startHeading: resolvedStartHeading,
    finalHeading: resolvedFinalHeading,
    headingCloses,
    positionCloses,
    closes,
    misconception: closes
      ? undefined
      : {
          id: "non-closing-path",
          turnTotal,
          expectedMultipleOf: 360,
          displacement,
        },
  };
}

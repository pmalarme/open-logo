/**
 * Deterministic closure reasoning over an *arbitrary* turtle path's trace events — the
 * misconception-detection primitive (`.github/skills/geometry-teacher/geometry-reasoning/SKILL.md`).
 * Unlike the per-shape reasoning modules (`polygon-reasoning.ts`, etc.), which compute their facts
 * from the shape's own parameters, this module reads the `turn` events a program already emitted
 * (`@openlogo/core`'s trace/event contract — no new event kind is added here) and folds them into
 * a turn total, so it can flag a path that never turns all the way around as a **structured
 * signal**, never a thrown runtime error.
 */

import type { TraceEvent } from "@openlogo/core";
import { isMultipleOf360, sumClockwiseTurns } from "./degree-math.js";
import type { ClosureMisconceptionSignal } from "./types.js";

/** Structured reasoning about whether a turtle path closes, folded from its trace events. */
export interface TurtlePathClosureReasoning {
  readonly concept: "turtle-path-closure";
  /** The sum of every `turn` event's reconstructed clockwise delta, in emission order. */
  readonly turnTotal: number;
  /** How many `turn` events the path contains. */
  readonly turnCount: number;
  /** Whether `turnTotal` is a whole multiple of `360`, so the turtle ends facing its start
   * heading. */
  readonly closes: boolean;
  /** Present only when `closes` is `false`: a structured, stable-id misconception signal a
   * caller (`@ai-tutor`, `@openlogo/studio`) can phrase without this module ever emitting prose
   * or throwing. */
  readonly misconception?: ClosureMisconceptionSignal;
}

/**
 * Folds every `turn` event in `events` (typically `@openlogo/runtime`'s `execute(source,
 * document).events`) into a turn total and closure verdict. A path that never turns is trivially
 * "closed" at `turnTotal === 0` (a multiple of `360`) — the same way a bare `forward 100` neither
 * closes nor fails to close a shape it never attempted to draw.
 */
export function analyzeTurtlePathClosure(
  events: readonly TraceEvent[],
): TurtlePathClosureReasoning {
  const turnTotal = sumClockwiseTurns(events);
  const turnCount = events.filter((event) => event.kind === "turn").length;
  const closes = isMultipleOf360(turnTotal);
  return {
    concept: "turtle-path-closure",
    turnTotal,
    turnCount,
    closes,
    misconception: closes
      ? undefined
      : { id: "non-closing-path", turnTotal, expectedMultipleOf: 360 },
  };
}

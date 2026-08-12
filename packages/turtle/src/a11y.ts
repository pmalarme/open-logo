/**
 * Rendering accessibility primitives (`spec/rendering.md#accessibility`): a textual, non-visual
 * turtle-state description and color-independent feedback descriptors for rendering state that
 * would otherwise be shown by color alone. This module is pure, deterministic, and DOM-free —
 * it produces plain strings/data, never DOM nodes or ARIA attributes. The actual keyboard
 * operability and screen-reader wiring (focus order, live regions, accessible names) is a host
 * UI concern layered on top of these primitives (Studio's job, tracked separately) — this
 * package only supplies the render-agnostic content that wiring needs to expose.
 */

import type { Point } from "@openlogo/core";
import type { TurtleState } from "./state.js";
import { type TurtleWorldState, activeTurtleState } from "./world-state.js";

/**
 * Optional context for {@link describeTurtleState} beyond the turtle state itself.
 */
export interface TurtleStateDescriptionOptions {
  /**
   * The source text of the instruction currently executing, when available. `@openlogo/turtle`
   * has no access to the original source string (only `source_span` positions travel with trace
   * events) — the caller (which does hold the source) slices the text using the `instruction`
   * event's `source_span` and passes it in here. Omit when no instruction is currently active
   * (e.g. before the first step, or after the stream is exhausted).
   */
  readonly currentInstruction?: string;
}

/**
 * The shared body of the non-visual state description: `subject` (what the sentence is about)
 * followed by position, heading, pen up/down, pen color and width, always; visibility and the
 * current source instruction are appended only when they add information (hidden, or an
 * instruction is available).
 */
function describeState(
  subject: string,
  state: TurtleState,
  options: TurtleStateDescriptionOptions,
): string {
  const [x, y] = state.position;
  const parts = [
    `${subject} at x ${x} y ${y} heading ${state.heading} degrees`,
    `pen ${state.penDown ? "down" : "up"}`,
    `color ${state.color} width ${state.width}`,
  ];
  if (!state.visible) {
    parts.push("hidden");
  }
  if (options.currentInstruction !== undefined) {
    parts.push(`instruction "${options.currentInstruction}"`);
  }
  return parts.join(" ");
}

/**
 * Builds the textual, non-visual turtle-state description required by
 * `spec/rendering.md#non-visual-state-descriptions`: position, heading, pen up/down, pen color
 * and width, always; visibility and the current source instruction are appended only when they
 * add information (hidden, or an instruction is available) — this keeps the common case
 * byte-identical to the spec's own worked example. For a visible turtle at world `(100, 0)`,
 * heading `90`, pen down, color `"black"`, width `1`, and no known current instruction, this
 * produces exactly `"turtle at x 100 y 0 heading 90 degrees pen down color black width 1"`,
 * matching `spec/rendering.md`'s example text verbatim.
 *
 * This describes **one** turtle, so it never names an identity: with a single turtle there is
 * nothing to disambiguate. A host driving several turtles calls
 * {@link describeTurtleWorldState} instead, which satisfies `spec/rendering.md:191`'s
 * "Implementations with multiple turtles MUST identify the active turtle or addressed turtle set".
 *
 * Deterministic: the same state (and options) always produce the same string, with no locale,
 * timing, or rendering dependency.
 */
export function describeTurtleState(
  state: TurtleState,
  options: TurtleStateDescriptionOptions = {},
): string {
  return describeState("turtle", state, options);
}

/**
 * Builds the non-visual state description for a whole {@link TurtleWorldState}: the **active**
 * turtle's state (`spec/rendering.md:115` — the avatar "indicates the active turtle's position,
 * heading, visibility, and shape"), identified by which turtle it is whenever the program drives
 * more than one.
 *
 * `spec/rendering.md:191` makes that identification a MUST: "Implementations with multiple turtles
 * MUST identify the active turtle or addressed turtle set." So a world holding several turtles is
 * described as `active turtle <n> of <total> at x … y … heading … degrees pen … color … width …`,
 * where `<n>` is the active turtle's 1-based position in creation order — a stable, learner-facing
 * ordinal rather than the internal `turtle_id`, which is an allocator detail no OpenLogo program
 * can print.
 *
 * A world holding just the main turtle — every Turtle & Rendering program, and every Sprites
 * program before its first `new_turtle` — has nothing to disambiguate, so it produces exactly
 * {@link describeTurtleState}'s wording, byte for byte, including the spec's own worked example
 * text. That is the compatibility property this function is built around: adding multi-turtle
 * identification must not perturb single-turtle announcements.
 */
export function describeTurtleWorldState(
  world: TurtleWorldState,
  options: TurtleStateDescriptionOptions = {},
): string {
  const state = activeTurtleState(world);
  const ids = [...world.turtles.keys()];
  if (ids.length < 2) {
    return describeState("turtle", state, options);
  }
  const ordinal = ids.indexOf(world.activeTurtleId) + 1;
  return describeState(
    `active turtle ${ordinal} of ${ids.length}`,
    state,
    options,
  );
}

/**
 * One kind of rendering state that `spec/rendering.md#color-independent-feedback` requires to
 * never be color-only: the currently executing step, a pen-up movement preview, which turtle
 * currently has focus, and where a runtime error occurred.
 */
export type ColorIndependentCueKind =
  "current-step" | "pen-up-preview" | "turtle-focus" | "error-location";

/**
 * A render-agnostic descriptor for one color-independent cue: plain text plus a small set of
 * non-color carriers (`spec/rendering.md`: "text, shape, position, line pattern, iconography, or
 * labels"). This is data, not a DOM node or a drawing call — a renderer or Studio's UI decides
 * how to actually present `icon`/`linePattern`/`position` (e.g. an outline, a badge, an ARIA
 * label); this module only guarantees the information is available without relying on color.
 */
export interface ColorIndependentCue {
  /** Which kind of otherwise-color-only state this cue describes. */
  readonly kind: ColorIndependentCueKind;
  /** A human-readable label — always present, so text alone is sufficient on its own. */
  readonly text: string;
  /** A short, color-independent glyph/label a renderer MAY show instead of (or with) color. */
  readonly icon: string;
  /** A line pattern a renderer MAY use in place of a color distinction, when relevant. */
  readonly linePattern?: "solid" | "dashed" | "dotted";
  /** The world position the cue refers to, when it refers to one. */
  readonly position?: Point;
}

/**
 * Describes the currently executing step without relying on a color highlight alone
 * (`spec/rendering.md`: "current-step highlighting … SHOULD also use text, shape, position, line
 * pattern, iconography, or labels"). `sourceInstruction` is the same already-sliced instruction
 * text {@link describeTurtleState} accepts.
 */
export function describeCurrentStepCue(
  sourceInstruction: string,
): ColorIndependentCue {
  return {
    kind: "current-step",
    text: `current step: ${sourceInstruction}`,
    icon: "\u25B6", // "▶"
    linePattern: "solid",
  };
}

/**
 * Describes a pen-up movement preview without relying on color alone — a dashed line pattern
 * plus text distinguish a pen-up move from an ordinary drawn segment.
 */
export function describePenUpPreviewCue(): ColorIndependentCue {
  return {
    kind: "pen-up-preview",
    text: "pen up (not drawing)",
    icon: "\u270E", // "✎"
    linePattern: "dashed",
  };
}

/**
 * Describes which turtle currently has focus, by position and label rather than color alone
 * (`spec/rendering.md`: "Implementations with multiple turtles MUST identify the active turtle
 * or addressed turtle set" plus the color-independent-feedback requirement for "turtle focus").
 */
export function describeTurtleFocusCue(position: Point): ColorIndependentCue {
  const [x, y] = position;
  return {
    kind: "turtle-focus",
    text: `turtle focus at x ${x} y ${y}`,
    icon: "\u25CE", // "◎"
    position,
  };
}

/**
 * Describes a runtime error's location without relying on a red mark alone
 * (`spec/rendering.md`: "an error location can be shown with a message and source highlight, not
 * only a red mark"). `message` is the learner-facing diagnostic text (e.g. an `ol-*` message),
 * already produced by the diagnostics layer — this module only carries it alongside a
 * color-independent icon.
 */
export function describeErrorLocationCue(message: string): ColorIndependentCue {
  return {
    kind: "error-location",
    text: `error: ${message}`,
    icon: "\u26A0", // "⚠"
  };
}

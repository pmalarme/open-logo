/**
 * Rendering accessibility primitives (`spec/rendering.md#accessibility`): a textual, non-visual
 * turtle-state description and color-independent feedback descriptors for rendering state that
 * would otherwise be shown by color alone. This module is pure, deterministic, and DOM-free —
 * it produces plain strings/data, never DOM nodes or ARIA attributes. The actual keyboard
 * operability and screen-reader wiring (focus order, live regions, accessible names) is a host
 * UI concern layered on top of these primitives (Studio's job, tracked separately) — this
 * package only supplies the render-agnostic content that wiring needs to expose.
 */

import type { Point, TurtleId } from "@openlogo/core";
import { INITIAL_TURTLE_STATE, type TurtleState } from "./state.js";
import type { TurtleWorldState } from "./world-state.js";

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
 * The addressing clause plus the turtle state that follows it — or `null` when the world carries no
 * addressing worth announcing (or none this function can honestly speak for), in which case
 * {@link describeTurtleWorldState} falls back to the plain last-acted wording.
 */
interface AddressedSubject {
  readonly subject: string;
  readonly state: TurtleState;
}

/** `#1 #2 #3` — each addressed turtle under the identity an OpenLogo program prints for it. */
function listTurtleIds(ids: readonly TurtleId[]): string {
  return ids.map((id) => `#${id}`).join(" ");
}

/**
 * The addressing clause: which turtles a subsequent turtle command will drive.
 *
 * The empty set (`tell [ ]`) is called out in words rather than left silent. `spec/turtles-and-
 * sprites.md` defines no current turtle there, and the stream says so explicitly by reporting
 * `current_turtle_id: null` — deliberately leaving the display fallback to this consumer — so the
 * text states plainly that nothing is addressed instead of implying some turtle is about to be
 * driven.
 */
function addressingClause(ids: readonly TurtleId[]): string {
  if (ids.length === 0) {
    return "no addressed turtles";
  }
  const noun = ids.length === 1 ? "turtle" : "turtles";
  return `addressed ${noun} ${listTurtleIds(ids)}`;
}

/**
 * Builds the addressing half of the description from {@link TurtleWorldState.addressedTurtleIds},
 * which `reduceTurtleWorldState` folds from the stream's addressing snapshots (issue #770).
 *
 * The wording decision, and why (`@turtle-engine` + `@learner-experience`, issue #770):
 * `describeState` describes **one** turtle's position/heading/pen/color/width, and a *set* has no
 * single position. The sentence therefore answers the two questions separately —
 * `addressed turtles #1 #2. last acted turtle #2 at x … y … heading … degrees pen … color … width …`
 * — naming the addressed set, then describing the turtle that most recently *changed*:
 *
 * - **Identify the set, don't enumerate it.** Repeating every addressed turtle's full attributes was
 *   rejected: this is a single `aria-live="polite"` region a screen reader re-reads *in full* on
 *   every change, so `tell [ :a :b :c :d ]` / `repeat 100 [ forward 1 ]` would replace one sentence
 *   per tick with four — a wall of speech burying the change a learner was listening for — while
 *   `spec/rendering.md:191` asks only that the addressed set be *identified*. Every turtle's avatar
 *   stays on the canvas, and the per-turtle states stay published on
 *   {@link TurtleWorldState.turtles} for a future inspect-each-turtle affordance.
 * - **Keep describing the turtle that acted.** The numbers stay those of
 *   {@link TurtleWorldState.lastActedTurtleId}, because this region is also how a non-visual user
 *   follows *progress* (`spec/rendering.md:193`: the drawing surface must not be the only way to
 *   understand program progress). Describing the restored/current turtle instead would silently drop
 *   what just happened: after `ask :b [ set_color "blue" ]` the region would report `:a`, still
 *   black — never announcing that `:b` turned blue at all, since the block's restore lands in the
 *   same step as its last inner instruction (a step spans one `instruction` event to the next).
 *   Naming the set *and* describing the acting turtle reports both halves of that step honestly.
 * - **Only when they differ.** When the addressed set is exactly the turtle that last acted — every
 *   single-turtle program, and the common `tell :b` / `forward 10` — there is nothing to
 *   disambiguate, so this returns `null` and the text stays the plain wording #749 baselined, byte
 *   for byte, including `spec/rendering.md`'s own worked example.
 *
 * {@link TurtleWorldState.currentTurtleId} is deliberately *not* read here: it is the `who` pointer
 * the stream reports, kept on the world for `why`/`debug` and any consumer that needs it, but the
 * subject of this sentence is what changed, and the set clause already covers what is addressed.
 *
 * Returns `null` — falling back to the last-acted wording — when the world carries no addressing at
 * all (only constructible by hand, since {@link TurtleWorldState} requires the fields), when the
 * last-acted turtle is not live (nothing honest to describe), or when the set names a turtle the
 * world does not hold, keeping the same "never announce an identity no live turtle has" promise
 * {@link describeTurtleWorldState} already made.
 */
function describeAddressedTurtles(
  world: TurtleWorldState,
): AddressedSubject | null {
  const ids = world.addressedTurtleIds;
  const state = world.turtles.get(world.lastActedTurtleId);
  if (ids === undefined || state === undefined) {
    return null;
  }
  if (ids.length === 1 && ids[0] === world.lastActedTurtleId) {
    return null;
  }
  if (!ids.every((id) => world.turtles.has(id))) {
    return null;
  }
  return {
    subject: `${addressingClause(ids)}. last acted turtle #${world.lastActedTurtleId}`,
    state,
  };
}

/**
 * Builds the non-visual state description for a whole {@link TurtleWorldState}: which turtles are
 * addressed, and the state of the turtle that most recently acted — each identified by name
 * whenever the program drives more than one turtle.
 *
 * `spec/rendering.md:191` makes that identification a MUST: "Implementations with multiple turtles
 * MUST identify the active turtle or addressed turtle set." A world holding several turtles is
 * therefore described as `turtle #<id> at x … y … heading … degrees pen … color … width …`, using
 * **exactly the identity the language itself prints** for a turtle value: `@openlogo/runtime`'s
 * `printedForm` renders a turtle as `turtle #<id>` from `@openlogo/core`'s `OLTurtle.id`
 * (`packages/runtime/src/evaluate.ts`), which is what a learner sees from `print who` or
 * `print :friend` (`spec/turtles-and-sprites.md:39`, `:85`). A screen-reader user therefore hears
 * the same name in the state region that the output pane gives them, and can match the two without
 * seeing the drawing. Any second numbering — a creation-order ordinal, say — would be off by one
 * against `print who` for every turtle, which defeats the purpose of the MUST.
 *
 * Once the addressed set is *not* simply the turtle that last acted — `tell [ :a :b ]`, an
 * `ask`/`each` block that has just restored, or `tell [ ]` — naming a single turtle cannot satisfy
 * that MUST, so the sentence leads with the set: `addressed turtles #1 #2. last acted turtle #2 at
 * x …`. {@link describeAddressedTurtles} carries that decision and the reasoning behind it,
 * including the empty-set (`tell [ ]`) wording.
 *
 * A world holding just the main turtle — every Turtle & Rendering program, and every Sprites
 * program before its first `new_turtle` — has nothing to disambiguate, so it produces exactly
 * {@link describeTurtleState}'s wording, byte for byte, including the spec's own worked example
 * text. That is the compatibility property this function is built around: adding multi-turtle
 * identification must not perturb single-turtle announcements. A world whose addressing (or, absent
 * that, whose `lastActedTurtleId`) names no live turtle — only constructible by hand — is described
 * at the program-start defaults *without* a name, rather than announcing an identity nothing in the
 * world corresponds to.
 */
export function describeTurtleWorldState(
  world: TurtleWorldState,
  options: TurtleStateDescriptionOptions = {},
): string {
  const addressed = describeAddressedTurtles(world);
  if (addressed !== null) {
    return describeState(addressed.subject, addressed.state, options);
  }
  const state = world.turtles.get(world.lastActedTurtleId);
  if (state === undefined || world.turtles.size < 2) {
    return describeState("turtle", state ?? INITIAL_TURTLE_STATE, options);
  }
  return describeState(`turtle #${world.lastActedTurtleId}`, state, options);
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

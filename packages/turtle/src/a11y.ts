/**
 * Rendering accessibility primitives (`spec/rendering.md#accessibility`): a textual, non-visual
 * turtle-state description and color-independent feedback descriptors for rendering state that
 * would otherwise be shown by color alone. This module is pure, deterministic, and DOM-free —
 * it produces plain strings/data, never DOM nodes or ARIA attributes. The actual keyboard
 * operability and screen-reader wiring (focus order, live regions, accessible names) is a host
 * UI concern layered on top of these primitives (Studio's job, tracked separately) — this
 * package only supplies the render-agnostic content that wiring needs to expose.
 *
 * Issue #778 settled the two **presentation** questions this text had been answering by accident,
 * both of them audible on every tick of a live region: every number is rounded for speech by
 * {@link formatDescribedNumber}, and a multi-line instruction is reduced to a speakable line by
 * {@link summarizeSourceInstruction}. Both are text-only; nothing they touch reaches the turtle
 * state, the event stream, the scene, or an exporter.
 */

import type { Point, TurtleId } from "@openlogo/core";
import { INITIAL_TURTLE_STATE, type TurtleState } from "./state.js";
import type { TurtleWorldState } from "./world-state.js";

/**
 * Decimal places a number is rounded to before it appears in a spoken description (issue #778).
 *
 * Why this exists at all: turtle positions and headings are IEEE-754 doubles produced by
 * `d·sin θ`/`d·cos θ`, so a closed square lands on `x 1.4210854715202004e-14` rather than `x 0`,
 * and a 7-pointed star turns to `heading 154.28571428571428`. Read verbatim into a live region
 * (`spec/rendering.md`'s Non-visual state descriptions), that is what an assistive-technology user
 * hears on **every** tick — measured on this tree, 917/1423 of the region texts produced by the
 * runnable `spec/examples` carried such an `x`, 950/1423 a `y`, and 311/1423 a `heading`.
 *
 * Why 3: `svg.ts`'s `COORDINATE_PRECISION` already fixes 3 decimal places as this package's
 * documented, stable precision for serialized numbers — the precision `spec/rendering.md`'s Export
 * determinism section requires be documented. Reusing that number keeps one numeric convention in
 * the package instead of inventing a second. The two are deliberately **not** the same constant:
 * `svg.ts` formats viewport-mapped device coordinates for a file, this formats world coordinates
 * for speech, so the values are not equal and neither should follow the other if it changes.
 *
 * This is presentation only. {@link TurtleState.position} and `heading`, the trace events, the
 * scene, and every exporter are untouched — the program's own `print xcor` still reports the exact
 * value through `@openlogo/runtime`'s `formatNumber` (`docs/learn-how-its-built/
 * extra-why-coordinates-show-decimals.md` teaches learners exactly that), which is a different
 * package this rounding cannot reach.
 */
const DESCRIBED_NUMBER_PRECISION = 3;

/**
 * Renders a number for a spoken description: rounded to {@link DESCRIBED_NUMBER_PRECISION} places,
 * then printed **without trailing zeros**, so a whole value stays whole (`100`, never `100.000`)
 * and `spec/rendering.md:193`'s worked example — `turtle at x 100 y 0 heading 90 degrees pen down
 * color black width 1` — remains byte-identical. That no-trailing-zeros rule is the same one the
 * language itself uses for `print` (`spec/execution-model.md:19,498-500`, implemented as
 * `@openlogo/runtime`'s `formatNumber`), reimplemented here rather than imported because
 * `@openlogo/turtle` must not depend on `@openlogo/runtime`.
 *
 * A magnitude at or above `1e21` still renders in exponent form, because `toFixed` itself switches
 * to exponent notation there. No program that draws on a canvas reaches such a coordinate, so this
 * is left as the honest rendering of a genuinely huge number rather than special-cased.
 */
function formatDescribedNumber(value: number): string {
  // `Number(...)` drops the trailing zeros `toFixed` pads with, and normalizes the `-0` that
  // rounding a tiny negative (`-1.47e-14`) produces, so it is spoken as `0` and not `-0`.
  return `${Number(value.toFixed(DESCRIBED_NUMBER_PRECISION))}`;
}

/**
 * Renders a heading for a spoken description. Identical to {@link formatDescribedNumber} except
 * that a heading which *rounds up* to a full turn is spoken as `0`, because
 * `spec/rendering.md:67` and `spec/execution-model.md:619` both normalize headings into `[0,360)`
 * — `heading 360 degrees` names a value the model never holds.
 *
 * This is reachable, not defensive: measured on this tree, `right 359.9999` and
 * `repeat 3 / right 119.99999999 / end repeat` are both diagnostic-free Turtle & Rendering
 * programs whose live region announced `heading 360 degrees` with the plain formatter. Rounding
 * can only ever reach `360` and never exceed it, since the value it rounds is already below `360`.
 */
function formatDescribedHeading(heading: number): string {
  const rounded = Number(heading.toFixed(DESCRIBED_NUMBER_PRECISION));
  return `${rounded === 360 ? 0 : rounded}`;
}

/**
 * Reduces an already-sliced source instruction to a single line safe to speak (issue #778).
 *
 * `spec/rendering.md` asks the state description for the "current source instruction when available
 * from `source-span`". When that span covers a block, the sliced text is the **whole** block, and
 * splicing it verbatim into a live region is wrong twice over: it re-reads the entire body on every
 * tick, and it presents instructions that are *not* current as if they were — driving
 * `spec/examples/09-sprites.logo` announces `current instruction ask :leader [ / set_shape
 * "turtle" / …` while the instruction that actually just ran is the `ask` head alone. Measured on
 * this tree, the runnable examples produce 56 distinct multi-line instruction heads, including
 * every handler form (`every 30 [`, `on_key "left" [`, `on_click [`).
 *
 * So the head line is spoken and the rest is replaced by a count: `ask :leader [ plus 4 more
 * lines`. The head line is the instruction the learner can act on; the count keeps the region
 * honest about having shortened something, which a bare first line would not. A single-line
 * instruction is returned trimmed and otherwise untouched, so every existing announcement is
 * byte-identical.
 *
 * The marker is made of **words**, with no ellipsis or brackets: a screen reader's punctuation
 * verbosity is a user setting, and commonly omits punctuation entirely, so a `…` or `(…)` marker
 * may or may not be spoken. There is no screen reader in CI to measure that against, so this picks
 * the form whose meaning does not depend on the setting at all. What *is* measured here is the
 * shape of the string: it never contains a newline, and it names no line other than the head.
 *
 * The count is of the span's remaining lines, blank ones included — it describes the source, not
 * the non-blank subset of it. An instruction whose head line is empty has nothing to name, so it
 * returns `""` and the caller omits the clause rather than speaking a bare label; only a span
 * pointing outside the current source can reach that.
 */
export function summarizeSourceInstruction(instructionText: string): string {
  const firstNewlineIndex = instructionText.indexOf("\n");
  if (firstNewlineIndex === -1) {
    return instructionText.trim();
  }
  const headLine = instructionText.slice(0, firstNewlineIndex).trim();
  if (headLine === "") {
    return "";
  }
  const remainingLineCount = instructionText
    .slice(firstNewlineIndex + 1)
    .split("\n").length;
  const lineNoun = remainingLineCount === 1 ? "line" : "lines";
  return `${headLine} plus ${remainingLineCount} more ${lineNoun}`;
}

/**
 * Optional context for {@link describeTurtleState} beyond the turtle state itself.
 */
export interface TurtleStateDescriptionOptions {
  /**
   * The source text of the instruction currently executing, when available. `@openlogo/turtle`
   * has no access to the original source string (only `source_span` positions travel with trace
   * events) — the caller (which does hold the source) slices the text using the `instruction`
   * event's `source_span` and passes it in here. Omit when no instruction is currently active
   * (e.g. before the first step, or after the stream is exhausted). A multi-line slice is reduced
   * to one speakable line by {@link summarizeSourceInstruction} (#778), so a caller passes the
   * slice exactly as cut and never has to shorten it first.
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
    `${subject} at x ${formatDescribedNumber(x)} y ${formatDescribedNumber(y)} heading ${formatDescribedHeading(state.heading)} degrees`,
    `pen ${state.penDown ? "down" : "up"}`,
    `color ${state.color} width ${formatDescribedNumber(state.width)}`,
  ];
  if (!state.visible) {
    parts.push("hidden");
  }
  if (options.currentInstruction !== undefined) {
    parts.push(
      `instruction "${summarizeSourceInstruction(options.currentInstruction)}"`,
    );
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
 * {@link describeTurtleWorldState} instead, which satisfies `spec/rendering.md:193`'s
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
 * `addressed turtles #1 #2. turtle #2 at x … y … heading … degrees pen … color … width …` — naming
 * the addressed set, then describing the turtle {@link TurtleWorldState.lastActedTurtleId} names:
 * the one the most recent per-turtle command drove, or the main turtle before any command has:
 *
 * - **Identify the set, don't enumerate it.** Repeating every addressed turtle's full attributes was
 *   rejected: this is a single `aria-live="polite"` region a screen reader re-reads *in full* on
 *   every change, so `tell [ :a :b :c :d ]` / `repeat 100 [ forward 1 ]` would replace one sentence
 *   per tick with four — a wall of speech burying the change a learner was listening for — while
 *   `spec/rendering.md:193` asks only that the addressed set be *identified*. Every turtle's avatar
 *   stays on the canvas, and the per-turtle states stay published on
 *   {@link TurtleWorldState.turtles} for a future inspect-each-turtle affordance.
 * - **Describe the turtle a command last drove.** The numbers are those of
 *   {@link TurtleWorldState.lastActedTurtleId}, because this region is also how a non-visual user
 *   follows *progress* (`spec/rendering.md:195`: the drawing surface must not be the only way to
 *   understand program progress). Describing the restored/current turtle instead would silently drop
 *   what just happened: after `ask :b [ set_color "blue" ]` the region would report `:a`, still
 *   black — never announcing that `:b` turned blue at all, since the block's restore lands in the
 *   same step as its last inner instruction (a step spans one `instruction` event to the next).
 *   Naming the set *and* describing the acting turtle reports both halves of that step honestly.
 * - **Name that turtle, don't label it.** The state clause keeps the plain `turtle #<id> at …`
 *   subject {@link describeTurtleState}/#749 already established, rather than a "last acted turtle
 *   #<id>" label. A label would be an *assertion*, and it would sometimes be a false one: at program
 *   start {@link TurtleWorldState.lastActedTurtleId} is seeded to the main turtle, which has not
 *   acted at all, so `tell :friend` in a fresh program would claim the main turtle "last acted";
 *   and after `tell [ :a :b ]` / `forward 10` **both** turtles moved, so singling one out as *the*
 *   turtle that acted under-reports the broadcast. Naming asserts nothing beyond "this is the turtle
 *   these numbers are about", which is exactly what is true — and it gives every announcement, with
 *   or without an addressing clause, one identical state-sentence shape for a listener to learn.
 * - **Only when they differ.** When the addressed set is exactly the turtle that last acted — every
 *   Turtle & Rendering program, and the common `tell :b` / `forward 10` — there is nothing to
 *   disambiguate, so this returns `null` and the text stays the plain wording #749 baselined:
 *   `turtle #<id> at …` once the world holds more than one turtle, and the unnamed `turtle at …`
 *   (byte for byte, including `spec/rendering.md`'s own worked example) while it holds one.
 *
 * {@link TurtleWorldState.currentTurtleId} is deliberately *not* read here: it is the `who` pointer
 * the stream reports, kept on the world for `why`/`debug` and any consumer that needs it, but the
 * subject of this sentence is the turtle a command last drove, and the set clause already covers
 * what is addressed.
 *
 * Returns `null` — falling back to that same plain wording — when the world carries no
 * addressing at all (only constructible by hand, since {@link TurtleWorldState} requires the
 * fields), when the last-acted turtle is not live (nothing honest to describe), or when the set
 * names a turtle the world does not hold, keeping the same "never announce an identity no live
 * turtle has" promise {@link describeTurtleWorldState} already made.
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
    subject: `${addressingClause(ids)}. turtle #${world.lastActedTurtleId}`,
    state,
  };
}

/**
 * Builds the non-visual state description for a whole {@link TurtleWorldState}: the state of the
 * turtle {@link TurtleWorldState.lastActedTurtleId} names, named once the world holds more than one
 * live turtle (#749), and preceded by the addressed turtle set whenever that set is not exactly
 * `[lastActedTurtleId]` (#770) — two independent triggers, either of which can fire without the
 * other.
 *
 * `spec/rendering.md:193` makes that identification a MUST: "Implementations with multiple turtles
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
 * that MUST, so the sentence leads with the set: `addressed turtles #1 #2. turtle #2 at x …`.
 * {@link describeAddressedTurtles} carries that decision and the reasoning behind it, including the
 * empty-set (`tell [ ]`) wording.
 *
 * For a world folded from a well-formed program stream, the unnamed, `spec/rendering.md`-verbatim
 * wording is produced under one exact condition: the
 * world holds **one** live turtle and its addressed set is that same turtle. That covers every
 * Turtle & Rendering program — which is the compatibility property this function is built around,
 * since adding multi-turtle identification must not perturb single-turtle announcements — and a
 * Sprites program only until it changes either half of that condition. `:friend = new_turtle` alone
 * changes it: a second live turtle appears while addressing stays put, so the text becomes the
 * named `turtle #0 at …` (#749's rule, unchanged here). `tell [ ]` changes the other half, and is
 * then said out loud; no Turtle & Rendering program can reach it, since `tell` is a Sprites
 * primitive.
 *
 * The totality fallbacks below reach that same unnamed wording from further states, which is
 * why the condition above is scoped to a folded world: none of them is reachable by running a
 * program. They are ordered so the text never announces an identity nothing in the world
 * corresponds to. Addressing that is **missing** (a hand-built world predating the fields) or
 * **unusable** (a set naming a turtle the world does not hold) is ignored in favor of the plain
 * last-acted wording — that turtle's **real** state, named `turtle #<id> at …` in a multi-turtle
 * world or unnamed in a one-turtle world. Only the third state, a `lastActedTurtleId` that itself
 * names no live turtle — leaving no honest subject at all — falls back to the program-start
 * defaults. All three are constructible only by hand, since every world this package folds carries
 * addressing and keeps both identities live.
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
    text: `current step: ${summarizeSourceInstruction(sourceInstruction)}`,
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
    text: `turtle focus at x ${formatDescribedNumber(x)} y ${formatDescribedNumber(y)}`,
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
